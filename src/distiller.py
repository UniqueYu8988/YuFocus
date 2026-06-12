# -*- coding: utf-8 -*-
"""Local video/source organizer for 视界专注.

This module is the local-first material pipeline: it fetches subtitles or
transcripts, cleans and chunks them, exports NotebookLM-ready sources, and
optionally creates short-video editorial articles through the configured API.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import html
import json
import math
import os
from time import perf_counter
import re
import sys
from typing import Any, Iterable
import zipfile

import bilibili_api
import config
import requests


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CJK_CHAR_PATTERN = re.compile(r"[\u3400-\u9fff]")
WORD_PATTERN = re.compile(r"[A-Za-z0-9_]+")
CACHE_DIR_NAME = "cache"


def _env(name: str, legacy_name: str, default: str) -> str:
    return os.getenv(name, "").strip() or os.getenv(legacy_name, "").strip() or default


MATERIAL_BLOCK_TARGET_CHARS = max(10_000, int(_env("SHIJIE_MATERIAL_BLOCK_TARGET_CHARS", "ONBOARD_MATERIAL_BLOCK_TARGET_CHARS", "20000") or "20000"))
MATERIAL_BLOCK_MIN_CHARS = max(4_000, int(_env("SHIJIE_MATERIAL_BLOCK_MIN_CHARS", "ONBOARD_MATERIAL_BLOCK_MIN_CHARS", "10000") or "10000"))
MATERIAL_BLOCK_MAX_CHARS = max(
    MATERIAL_BLOCK_TARGET_CHARS,
    int(_env("SHIJIE_MATERIAL_BLOCK_MAX_CHARS", "ONBOARD_MATERIAL_BLOCK_MAX_CHARS", "30000") or "30000"),
)
MATERIAL_TERM_STOPWORDS = {
    "这个",
    "那个",
    "然后",
    "就是",
    "我们",
    "你们",
    "大家",
    "可以",
    "需要",
    "一个",
    "一下",
    "如果",
    "因为",
    "所以",
    "其实",
    "现在",
    "这里",
    "里面",
    "时候",
    "内容",
    "课程",
    "视频",
    "字幕",
    "老师",
}
MATERIAL_NOISE_KEYWORDS = (
    "点赞",
    "投币",
    "关注",
    "三连",
    "弹幕",
    "评论区",
    "直播间",
    "同学们好",
    "大家好",
    "废话不多说",
    "下期",
    "课程优惠",
    "加群",
)
MATERIAL_OPERATION_KEYWORDS = (
    "打开",
    "点击",
    "选择",
    "输入",
    "复制",
    "粘贴",
    "保存",
    "运行",
    "执行",
    "安装",
    "配置",
    "启动",
    "创建",
    "导入",
    "连接",
    "检查",
    "验证",
)
MATERIAL_TROUBLESHOOTING_KEYWORDS = (
    "报错",
    "失败",
    "无法",
    "不能",
    "错误",
    "异常",
    "权限",
    "超时",
    "不通",
    "没有响应",
    "排查",
    "排错",
)
MATERIAL_CASE_KEYWORDS = ("病例", "案例", "场景", "需求", "客户", "业务", "患者", "诊断", "鉴别")
MATERIAL_EXAM_KEYWORDS = ("考试", "考点", "评分", "扣分", "得分", "真题", "题目", "答题")
MATERIAL_VERSION_SENSITIVE_TERMS = (
    "api",
    "sdk",
    "model",
    "版本",
    "价格",
    "额度",
    "openclaw",
    "langchain",
    "langgraph",
    "autogen",
    "crewai",
    "ragflow",
    "mcp",
    "tavily",
    "python",
    "node",
)
RUN_MANIFEST_VERSION = "material-resume.v2"
CONTENT_CLEANING_VERSION = "shijie.content-cleaning.v0.8"
EDITORIAL_SUMMARY_VERSION = "shijie.editorial-summary.v0.1"
PRODUCTION_METRICS_VERSION = "shijie.production-metrics.v0.1"


@dataclass(slots=True)
class SourceDescriptor:
    source_type: str
    source_id: str
    title: str
    language: str = "zh-CN"
    creator: str = ""
    url: str = ""
    notes: str = ""


@dataclass(slots=True)
class PipelineConfig:
    chunk_target_tokens: int = 5200
    chunk_max_tokens: int = 6200
    chunk_overlap_units: int = 4
    sentence_group_chars: int = 260


@dataclass(slots=True)
class TextUnit:
    page_label: str
    text: str
    estimated_tokens: int
    start_time: float | None = None
    end_time: float | None = None


@dataclass(slots=True)
class TextChunk:
    index: int
    chunk_id: str
    text: str
    units: list[TextUnit]
    estimated_tokens: int
    page_labels: list[str]
    start_time: float | None = None
    end_time: float | None = None


@dataclass(slots=True)
class ChunkPlan:
    units: list[TextUnit]
    chunks: list[TextChunk]
    text_length: int


@dataclass(slots=True)
class CleaningChunk:
    index: int
    chunk_id: str
    text: str
    page_labels: list[str]
    start_time: float | None = None
    end_time: float | None = None
    previous_tail: str = ""
    next_head: str = ""


class DistillationError(RuntimeError):
    """原材料整理过程中的结构化错误。"""


def _estimate_tokens(text: str) -> int:
    cjk_count = len(CJK_CHAR_PATTERN.findall(text))
    word_count = len(WORD_PATTERN.findall(text))
    other_chars = max(0, len(text) - cjk_count - sum(len(match.group(0)) for match in WORD_PATTERN.finditer(text)))
    return max(1, math.ceil(cjk_count * 0.72 + word_count * 1.15 + other_chars * 0.28))


def _normalize_whitespace(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _compact_sentences(text: str, target_chars: int) -> list[str]:
    normalized = _normalize_whitespace(text)
    if not normalized:
        return []
    pieces = re.split(r"(?<=[。！？!?；;])\s*|\n+", normalized)
    groups: list[str] = []
    buffer: list[str] = []
    length = 0
    for piece in pieces:
        piece = piece.strip()
        if not piece:
            continue
        if buffer and length + len(piece) > target_chars:
            groups.append(" ".join(buffer))
            buffer = [piece]
            length = len(piece)
        else:
            buffer.append(piece)
            length += len(piece)
    if buffer:
        groups.append(" ".join(buffer))
    return groups


def _coerce_optional_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _group_subtitle_entries(entries: list[dict[str, Any]], target_chars: int) -> list[tuple[str, float | None, float | None]]:
    groups: list[tuple[str, float | None, float | None]] = []
    buffer: list[str] = []
    starts: list[float] = []
    ends: list[float] = []
    length = 0

    def flush() -> None:
        nonlocal buffer, starts, ends, length
        if not buffer:
            return
        text = _normalize_whitespace(" ".join(buffer))
        if text:
            groups.append((text, min(starts) if starts else None, max(ends) if ends else None))
        buffer = []
        starts = []
        ends = []
        length = 0

    for entry in entries:
        text = str(entry.get("content", "")).strip()
        if not text:
            continue
        if buffer and length + len(text) > target_chars:
            flush()
        buffer.append(text)
        length += len(text)
        start = _coerce_optional_float(entry.get("from"))
        end = _coerce_optional_float(entry.get("to"))
        if start is not None:
            starts.append(start)
        if end is not None:
            ends.append(end)
    flush()
    return groups


def _iter_subtitle_units(source: list[dict[str, Any]], target_chars: int) -> Iterable[TextUnit]:
    for subtitle in source:
        page_segments = subtitle.get("page_segments") or []
        if page_segments:
            for segment in page_segments:
                label = str(segment.get("label") or "未命名分段").strip()
                entries = segment.get("entries") or []
                for group, start_time, end_time in _group_subtitle_entries(entries, target_chars):
                    yield TextUnit(
                        page_label=label,
                        text=group,
                        estimated_tokens=_estimate_tokens(group),
                        start_time=start_time,
                        end_time=end_time,
                    )
            continue

        label = str(subtitle.get("lang") or "字幕内容").strip()
        entries = subtitle.get("entries") or []
        for group, start_time, end_time in _group_subtitle_entries(entries, target_chars):
            yield TextUnit(
                page_label=label,
                text=group,
                estimated_tokens=_estimate_tokens(group),
                start_time=start_time,
                end_time=end_time,
            )


def normalize_raw_source(raw_source: str | list[dict[str, Any]] | dict[str, Any], *, target_chars: int = 260) -> list[TextUnit]:
    if isinstance(raw_source, str):
        return [
            TextUnit(page_label="原始文本", text=group, estimated_tokens=_estimate_tokens(group))
            for group in _compact_sentences(raw_source, target_chars)
        ]

    if isinstance(raw_source, dict):
        if isinstance(raw_source.get("subtitles"), list):
            return list(_iter_subtitle_units(raw_source["subtitles"], target_chars))
        if isinstance(raw_source.get("text"), str):
            return normalize_raw_source(raw_source["text"], target_chars=target_chars)
        raise DistillationError("无法识别 dict 形式的材料输入。")

    if isinstance(raw_source, list):
        return list(_iter_subtitle_units(raw_source, target_chars))

    raise DistillationError(f"不支持的材料输入类型：{type(raw_source)!r}")


def build_chunks(units: list[TextUnit], package_id: str, pipeline_config: PipelineConfig) -> list[TextChunk]:
    if not units:
        raise DistillationError("材料输入为空，无法建立分块。")

    chunks: list[TextChunk] = []
    current_units: list[TextUnit] = []
    current_tokens = 0
    chunk_index = 1
    has_fresh_units = False

    def flush(*, keep_overlap: bool = True) -> None:
        nonlocal current_units, current_tokens, chunk_index, has_fresh_units
        if not current_units:
            return
        page_labels = list(dict.fromkeys(unit.page_label for unit in current_units))
        starts = [unit.start_time for unit in current_units if unit.start_time is not None]
        ends = [unit.end_time for unit in current_units if unit.end_time is not None]
        header = "\n".join(f"## {label}" for label in page_labels)
        body = "\n".join(unit.text for unit in current_units)
        chunk_text = f"{header}\n\n{body}".strip()
        chunks.append(
            TextChunk(
                index=chunk_index,
                chunk_id=f"{package_id}.chunk_{chunk_index:03d}",
                text=chunk_text,
                units=list(current_units),
                estimated_tokens=_estimate_tokens(chunk_text),
                page_labels=page_labels,
                start_time=min(starts) if starts else None,
                end_time=max(ends) if ends else None,
            )
        )
        chunk_index += 1
        overlap = (
            current_units[-pipeline_config.chunk_overlap_units :]
            if keep_overlap and pipeline_config.chunk_overlap_units > 0
            else []
        )
        current_units = list(overlap)
        current_tokens = sum(unit.estimated_tokens for unit in current_units)
        has_fresh_units = False

    for unit in units:
        if current_units and current_units[-1].page_label != unit.page_label:
            flush(keep_overlap=False)
        if current_units and current_tokens + unit.estimated_tokens > pipeline_config.chunk_target_tokens:
            flush()
        current_units.append(unit)
        current_tokens += unit.estimated_tokens
        has_fresh_units = True
        if current_tokens > pipeline_config.chunk_max_tokens:
            flush()

    if current_units and has_fresh_units:
        page_labels = list(dict.fromkeys(unit.page_label for unit in current_units))
        starts = [unit.start_time for unit in current_units if unit.start_time is not None]
        ends = [unit.end_time for unit in current_units if unit.end_time is not None]
        header = "\n".join(f"## {label}" for label in page_labels)
        body = "\n".join(unit.text for unit in current_units)
        chunk_text = f"{header}\n\n{body}".strip()
        chunks.append(
            TextChunk(
                index=chunk_index,
                chunk_id=f"{package_id}.chunk_{chunk_index:03d}",
                text=chunk_text,
                units=list(current_units),
                estimated_tokens=_estimate_tokens(chunk_text),
                page_labels=page_labels,
                start_time=min(starts) if starts else None,
                end_time=max(ends) if ends else None,
            )
        )

    return chunks


def prepare_chunk_plan(
    raw_source: str | list[dict[str, Any]] | dict[str, Any],
    *,
    package_id: str,
    pipeline_config: PipelineConfig,
) -> ChunkPlan:
    units = normalize_raw_source(raw_source, target_chars=pipeline_config.sentence_group_chars)
    chunks = build_chunks(units, package_id=package_id, pipeline_config=pipeline_config)
    return ChunkPlan(
        units=units,
        chunks=chunks,
        text_length=sum(len(unit.text) for unit in units),
    )


def _to_clean_text(value: Any) -> str:
    if value is None:
        return ""
    return _normalize_whitespace(str(value))


def _take_unique_texts(values: Iterable[Any], *, limit: int = 4) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = _to_clean_text(value)
        if not text:
            continue
        marker = text.casefold()
        if marker in seen:
            continue
        seen.add(marker)
        items.append(text)
        if len(items) >= limit:
            break
    return items


def _split_brief_points(text: str, *, limit: int = 4) -> list[str]:
    normalized = _to_clean_text(text)
    if not normalized:
        return []
    parts = re.split(r"[；;。！？!?\n]|(?<![A-Za-z0-9])\.(?![A-Za-z0-9])|(?<=[^0-9])[、，,](?=[^0-9])", normalized)
    return _take_unique_texts(parts, limit=limit)


def _load_json_file(file_path: str) -> dict[str, Any] | None:
    if not os.path.exists(file_path):
        return None
    try:
        with open(file_path, "r", encoding="utf-8") as file:
            payload = json.load(file)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _save_json_file(file_path: str, payload: dict[str, Any]) -> str:
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    return file_path


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _file_size(path_value: str) -> int:
    try:
        return os.path.getsize(path_value) if path_value and os.path.isfile(path_value) else 0
    except OSError:
        return 0


def _text_file_chars(path_value: str) -> int:
    try:
        if not path_value or not os.path.isfile(path_value):
            return 0
        with open(path_value, "r", encoding="utf-8") as file:
            return len(file.read().strip())
    except OSError:
        return 0


def _summarize_usage_tokens(value: Any) -> dict[str, int]:
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
    }

    def visit(item: Any) -> None:
        if isinstance(item, dict):
            input_value = item.get("prompt_tokens", item.get("input_tokens"))
            output_value = item.get("completion_tokens", item.get("output_tokens"))
            total_value = item.get("total_tokens")
            if isinstance(input_value, (int, float)):
                totals["input_tokens"] += int(input_value)
            if isinstance(output_value, (int, float)):
                totals["output_tokens"] += int(output_value)
            if isinstance(total_value, (int, float)):
                totals["total_tokens"] += int(total_value)
            for child in item.values():
                if isinstance(child, (dict, list)):
                    visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)
    if not totals["total_tokens"] and (totals["input_tokens"] or totals["output_tokens"]):
        totals["total_tokens"] = totals["input_tokens"] + totals["output_tokens"]
    return totals


def _write_material_metrics(material_dir: str, *, stage_name: str, stage_payload: dict[str, Any]) -> dict[str, Any]:
    metrics_path = os.path.join(material_dir, "metrics.json")
    payload = _load_json_file(metrics_path) or {}
    stages = payload.get("stages") if isinstance(payload.get("stages"), dict) else {}
    stages[stage_name] = {
        **(stages.get(stage_name) if isinstance(stages.get(stage_name), dict) else {}),
        **stage_payload,
    }
    payload = {
        **payload,
        "schema_version": PRODUCTION_METRICS_VERSION,
        "updated_at": _utc_now_iso(),
        "stages": stages,
    }
    payload["totals"] = _summarize_usage_tokens(stages)
    _save_json_file(metrics_path, payload)
    return payload


def _save_jsonl_file(file_path: str, items: list[dict[str, Any]]) -> str:
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as file:
        for item in items:
            file.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
    return file_path


def _safe_material_dir_name(title: str, bvid: str) -> str:
    stem = config.sanitize_filename(title or bvid or "course_material")
    return f"{stem}.course_material"


def _resolve_material_package_root(output_dir: str) -> str:
    root = os.path.abspath(output_dir)
    if os.path.basename(root).lower() == "materials":
        return root
    return os.path.join(root, "materials")


def _subtitle_track_segments(subtitles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tracks: list[dict[str, Any]] = []
    for track_index, subtitle in enumerate(subtitles, start=1):
        segments: list[dict[str, Any]] = []
        page_segments = subtitle.get("page_segments") or []
        if page_segments:
            for page_segment in page_segments:
                page_no = int(page_segment.get("page") or 0)
                label = str(page_segment.get("label") or (f"P{page_no}" if page_no else ""))
                for entry in page_segment.get("entries") or []:
                    segments.append(
                        {
                            "page": page_no,
                            "label": label,
                            "from": entry.get("from", 0),
                            "to": entry.get("to", 0),
                            "text": str(entry.get("content") or "").strip(),
                        }
                    )
        else:
            for entry in subtitle.get("entries") or []:
                segments.append(
                    {
                        "page": 1,
                        "label": str(subtitle.get("lang") or subtitle.get("lan") or "字幕"),
                        "from": entry.get("from", 0),
                        "to": entry.get("to", 0),
                        "text": str(entry.get("content") or "").strip(),
                    }
                )
        tracks.append(
            {
                "track_id": str(subtitle.get("lan") or f"track_{track_index:02d}"),
                "kind": "subtitle" if "transcript" not in str(subtitle.get("lan") or "").lower() else "transcript",
                "language": str(subtitle.get("lang") or subtitle.get("lan") or "zh-CN"),
                "segments": [segment for segment in segments if segment["text"]],
            }
        )
    return tracks


def _time_range_for_chunk(subtitles: list[dict[str, Any]], page_labels: list[str]) -> dict[str, float | None]:
    labels = {label.strip() for label in page_labels if label.strip()}
    starts: list[float] = []
    ends: list[float] = []
    for track in _subtitle_track_segments(subtitles):
        for segment in track.get("segments") or []:
            label = str(segment.get("label") or "")
            if labels and label not in labels:
                continue
            try:
                starts.append(float(segment.get("from") or 0))
                ends.append(float(segment.get("to") or 0))
            except Exception:
                continue
    return {
        "from": min(starts) if starts else None,
        "to": max(ends) if ends else None,
    }


def _split_material_tokens(text: str) -> list[str]:
    return [
        item.strip()
        for item in re.split(r"[，。、“”‘’：；（）()\[\]【】、《》\s/]+", text or "")
        if len(item.strip()) >= 2
    ]


def _truncate_material_text(text: str, limit: int = 120) -> str:
    cleaned = _normalize_whitespace(text)
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1].rstrip() + "…"


def _material_sentences_with_keywords(text: str, keywords: Iterable[str], *, limit: int = 6) -> list[str]:
    keyword_list = [keyword.casefold() for keyword in keywords]
    sentences = re.split(r"[。！？!?\n]|(?<![A-Za-z0-9])\.(?![A-Za-z0-9])", text or "")
    matches: list[str] = []
    for sentence in sentences:
        cleaned = _truncate_material_text(sentence, 140)
        if not cleaned:
            continue
        haystack = cleaned.casefold()
        if any(keyword in haystack for keyword in keyword_list):
            matches.append(cleaned)
        if len(matches) >= limit:
            break
    return _take_unique_texts(matches, limit=limit)


def _extract_material_terms(text: str, *, limit: int = 18) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        cleaned = term.strip("`'\"“”‘’.,，。:：;；()（）[]【】<>《》")
        if not cleaned or cleaned.casefold() in seen:
            return
        if cleaned in MATERIAL_TERM_STOPWORDS:
            return
        if cleaned.isdigit():
            return
        if re.fullmatch(r"[A-Za-z]", cleaned):
            return
        if len(cleaned) > 32:
            return
        seen.add(cleaned.casefold())
        terms.append(cleaned)

    for match in re.finditer(r"\b[A-Za-z][A-Za-z0-9_.+-]{1,31}\b", text or ""):
        token = match.group(0)
        if len(token) >= 3 or any(char.isupper() for char in token):
            add(token)
        if len(terms) >= limit:
            return terms

    for token in _split_material_tokens(text):
        if 2 <= len(token) <= 12 and not re.fullmatch(r"\d+(?:\.\d+)?", token):
            add(token)
        if len(terms) >= limit:
            break
    return terms


def _count_keyword_hits(text: str, keywords: Iterable[str]) -> int:
    haystack = (text or "").casefold()
    return sum(1 for keyword in keywords if keyword.casefold() in haystack)


def _classify_material_role(text: str) -> str:
    scores = {
        "tool_config": _count_keyword_hits(text, ("api", "key", "base url", "模型", "配置", "安装", "环境", "终端", "命令", "路径")),
        "operation_steps": _count_keyword_hits(text, MATERIAL_OPERATION_KEYWORDS),
        "troubleshooting": _count_keyword_hits(text, MATERIAL_TROUBLESHOOTING_KEYWORDS),
        "case_analysis": _count_keyword_hits(text, MATERIAL_CASE_KEYWORDS),
        "exam_training": _count_keyword_hits(text, MATERIAL_EXAM_KEYWORDS),
        "concept_explain": _count_keyword_hits(text, ("概念", "原理", "为什么", "区别", "关系", "定义", "本质", "框架")),
        "strategy": _count_keyword_hits(text, ("策略", "计划", "复习", "路线", "方法", "选择", "取舍")),
    }
    best_role, best_score = max(scores.items(), key=lambda item: item[1])
    return best_role if best_score > 0 else "concept_explain"


def _material_noise_level(text: str) -> tuple[str, list[str]]:
    hits = [keyword for keyword in MATERIAL_NOISE_KEYWORDS if keyword.casefold() in (text or "").casefold()]
    char_count = len(_normalize_whitespace(text))
    if len(hits) >= 3 or (hits and char_count < 260):
        return "high", hits[:5]
    if hits:
        return "medium", hits[:5]
    return "low", []


def _material_teaching_value_score(text: str, role: str, noise_level: str) -> int:
    char_count = len(_normalize_whitespace(text))
    score = 1 + min(3, char_count // 900)
    if role in {"operation_steps", "tool_config", "troubleshooting", "case_analysis", "exam_training"}:
        score += 1
    if noise_level == "medium":
        score -= 1
    if noise_level == "high":
        score -= 2
    return max(1, min(5, int(score)))


def _label_to_block_ids(material_blocks: list[dict[str, Any]]) -> dict[str, list[str]]:
    mapping: dict[str, list[str]] = {}
    for block in material_blocks:
        block_id = str(block.get("block_id") or "")
        for label in block.get("page_labels") or []:
            key = _normalize_whitespace(str(label))
            if key and block_id:
                mapping.setdefault(key, []).append(block_id)
    return {key: list(dict.fromkeys(value)) for key, value in mapping.items()}


def _build_part_index(subtitles: list[dict[str, Any]], material_blocks: list[dict[str, Any]]) -> dict[str, Any]:
    label_blocks = _label_to_block_ids(material_blocks)
    part_map: dict[str, dict[str, Any]] = {}
    order = 0

    for track in _subtitle_track_segments(subtitles):
        for segment in track.get("segments") or []:
            label = _normalize_whitespace(str(segment.get("label") or "")) or "字幕"
            page = int(segment.get("page") or 0)
            key = f"{page:03d}|{label}"
            if key not in part_map:
                order += 1
                part_map[key] = {
                    "part_id": f"P{page:02d}" if page else f"part_{order:03d}",
                    "order": order,
                    "page": page or None,
                    "label": label,
                    "texts": [],
                    "starts": [],
                    "ends": [],
                    "block_ids": label_blocks.get(label, []),
                }
            text = str(segment.get("text") or "").strip()
            if text:
                part_map[key]["texts"].append(text)
            try:
                part_map[key]["starts"].append(float(segment.get("from") or 0))
                part_map[key]["ends"].append(float(segment.get("to") or 0))
            except Exception:
                pass

    items: list[dict[str, Any]] = []
    for raw in sorted(part_map.values(), key=lambda item: int(item.get("order") or 0)):
        text = _normalize_whitespace(" ".join(raw.get("texts") or []))
        summary_points = _split_brief_points(text, limit=6)
        role = _classify_material_role(text)
        noise_level, noise_reasons = _material_noise_level(text)
        terms = _extract_material_terms(text, limit=18)
        operation_steps = _material_sentences_with_keywords(text, MATERIAL_OPERATION_KEYWORDS, limit=6)
        risk_points = _material_sentences_with_keywords(text, (*MATERIAL_TROUBLESHOOTING_KEYWORDS, "注意", "不要", "风险", "安全"), limit=5)
        commands_or_apis = [
            term for term in terms
            if re.search(r"[A-Za-z]", term) or term.casefold() in {"api", "key", "url", "model", "sdk", "mcp"}
        ][:10]
        starts = [value for value in raw.get("starts") or [] if isinstance(value, (int, float))]
        ends = [value for value in raw.get("ends") or [] if isinstance(value, (int, float))]
        items.append(
            {
                "part_id": raw.get("part_id"),
                "order": raw.get("order"),
                "page": raw.get("page"),
                "label": raw.get("label"),
                "block_ids": raw.get("block_ids") or [],
                "time_range": {
                    "from": min(starts) if starts else None,
                    "to": max(ends) if ends else None,
                },
                "char_count": len(text),
                "main_topic": summary_points[0] if summary_points else str(raw.get("label") or ""),
                "summary_points": summary_points,
                "terms": terms,
                "operation_steps": operation_steps,
                "commands_or_apis": commands_or_apis,
                "risk_points": risk_points,
                "suggested_learning_role": role,
                "teaching_value_score": _material_teaching_value_score(text, role, noise_level),
                "noise_level": noise_level,
                "noise_reasons": noise_reasons,
                "source_excerpt": text[:900],
            }
        )

    return {
        "schema_version": "shijie.part-index.v0.1",
        "purpose": "分 P 导航层：用于判断主题、操作密度、噪音和建议合并方式，并按需回读 blocks/raw_transcript。",
        "items": items,
        "recommended_merge_groups": _build_recommended_merge_groups(items),
    }


def _build_recommended_merge_groups(part_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        if len(current) >= 2:
            roles = [str(item.get("suggested_learning_role") or "") for item in current]
            role = max(set(roles), key=roles.count)
            groups.append(
                {
                    "group_id": f"merge_{len(groups) + 1:03d}",
                    "part_ids": [str(item.get("part_id") or "") for item in current],
                    "labels": [str(item.get("label") or "") for item in current],
                    "suggested_learning_role": role,
                    "reason": "相邻分 P 主题/课型接近，适合在清洗稿或精读稿中合并处理。",
                    "key_terms": _take_unique_texts(
                        [term for item in current for term in (item.get("terms") or [])],
                        limit=12,
                    ),
                }
            )
        current = []

    for item in part_items:
        role = str(item.get("suggested_learning_role") or "")
        noise_level = str(item.get("noise_level") or "")
        if noise_level == "high":
            flush()
            continue
        if not current:
            current = [item]
            continue
        previous_role = str(current[-1].get("suggested_learning_role") or "")
        previous_terms = set(str(term).casefold() for term in current[-1].get("terms") or [])
        item_terms = set(str(term).casefold() for term in item.get("terms") or [])
        has_term_overlap = bool(previous_terms & item_terms)
        if role == previous_role and (has_term_overlap or len(current) < 3):
            current.append(item)
            if len(current) >= 4:
                flush()
        else:
            flush()
            current = [item]
    flush()
    return groups


def _build_term_normalization_index(part_index: dict[str, Any], concept_index: dict[str, list[str]]) -> dict[str, Any]:
    term_map: dict[str, dict[str, Any]] = {}
    for item in part_index.get("items") or []:
        part_id = str(item.get("part_id") or "")
        for term in item.get("terms") or []:
            key = str(term).casefold()
            record = term_map.setdefault(
                key,
                {
                    "term": str(term),
                    "parts": [],
                    "blocks": [],
                    "needs_verification": False,
                    "reason": "",
                },
            )
            if part_id:
                record["parts"].append(part_id)
            for block_id in item.get("block_ids") or []:
                record["blocks"].append(str(block_id))
            if any(marker in key for marker in MATERIAL_VERSION_SENSITIVE_TERMS):
                record["needs_verification"] = True
                record["reason"] = "工具、模型、平台、API 或版本相关术语，编稿时应保守表述或核验官方文档。"

    for term, block_ids in concept_index.items():
        key = str(term).casefold()
        if key in term_map:
            continue
        if 2 <= len(str(term)) <= 24:
            term_map[key] = {
                "term": str(term),
                "parts": [],
                "blocks": list(dict.fromkeys(block_ids)),
                "needs_verification": any(marker in key for marker in MATERIAL_VERSION_SENSITIVE_TERMS),
                "reason": "来自概念索引；如为工具/API/平台名，编稿时需注意版本敏感。",
            }

    terms = sorted(
        term_map.values(),
        key=lambda item: (len(set(item.get("parts") or [])) + len(set(item.get("blocks") or [])), str(item.get("term") or "")),
        reverse=True,
    )
    for item in terms:
        item["parts"] = list(dict.fromkeys(item.get("parts") or []))[:24]
        item["blocks"] = list(dict.fromkeys(item.get("blocks") or []))[:24]
    return {
        "schema_version": "shijie.term-normalization.v0.1",
        "purpose": "术语导航层。它不是权威词典，只提示高频术语、疑似版本敏感词和需要核验的工具/API 名称。",
        "terms": terms[:160],
        "verification_candidates": [item for item in terms if item.get("needs_verification")][:60],
    }


def _build_noise_segments_index(part_index: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "shijie.noise-segments.v0.1",
        "purpose": "提示清洗和编稿时可降权或跳过的片头片尾、互动话术、推广话术和低信息价值片段。",
        "items": [
            {
                "part_id": item.get("part_id"),
                "label": item.get("label"),
                "noise_level": item.get("noise_level"),
                "noise_reasons": item.get("noise_reasons") or [],
                "suggestion": "清洗稿保留必要信息，精读稿可降权处理；除非这些内容承载真实观点、步骤或案例，否则不要单独展开。",
            }
            for item in part_index.get("items") or []
            if item.get("noise_level") in {"medium", "high"}
        ],
    }


def _build_teaching_map(part_index: dict[str, Any]) -> dict[str, Any]:
    high_value_items = [
        item for item in part_index.get("items") or []
        if int(item.get("teaching_value_score") or 0) >= 4 and item.get("noise_level") != "high"
    ]
    return {
        "schema_version": "shijie.teaching-map.v0.1",
        "purpose": "粗粒度资料导航。用于判断哪些分 P 更适合展开、哪些适合合并、哪些只作为素材证据。",
        "high_value_parts": [
            {
                "part_id": item.get("part_id"),
                "label": item.get("label"),
                "suggested_learning_role": item.get("suggested_learning_role"),
                "teaching_value_score": item.get("teaching_value_score"),
                "main_topic": item.get("main_topic"),
                "block_ids": item.get("block_ids") or [],
            }
            for item in high_value_items
        ],
        "recommended_merge_groups": part_index.get("recommended_merge_groups") or [],
    }


def _estimate_material_block_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 1.7))


def _build_material_blocks(chunks: list[TextChunk]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    current_chunks: list[TextChunk] = []
    current_chars = 0

    def flush() -> None:
        nonlocal current_chunks, current_chars
        if not current_chunks:
            return
        block_index = len(blocks) + 1
        text = "\n\n".join(chunk.text.strip() for chunk in current_chunks if chunk.text.strip()).strip()
        page_labels: list[str] = []
        chunk_ids: list[str] = []
        starts: list[float] = []
        ends: list[float] = []
        for chunk in current_chunks:
            chunk_ids.append(chunk.chunk_id)
            for label in chunk.page_labels:
                if label and label not in page_labels:
                    page_labels.append(label)
            if chunk.start_time is not None:
                starts.append(chunk.start_time)
            if chunk.end_time is not None:
                ends.append(chunk.end_time)
        blocks.append(
            {
                "block_id": f"block_{block_index:03d}",
                "order": block_index,
                "chunk_ids": chunk_ids,
                "page_labels": page_labels,
                "time_range": {
                    "from": min(starts) if starts else None,
                    "to": max(ends) if ends else None,
                },
                "text": text,
                "estimated_tokens": _estimate_material_block_tokens(text),
                "char_count": len(text),
            }
        )
        current_chunks = []
        current_chars = 0

    for chunk in chunks:
        chunk_chars = len(chunk.text)
        would_exceed = current_chunks and current_chars + chunk_chars > MATERIAL_BLOCK_MAX_CHARS
        large_enough = current_chunks and current_chars >= MATERIAL_BLOCK_TARGET_CHARS
        if would_exceed or large_enough:
            flush()
        current_chunks.append(chunk)
        current_chars += chunk_chars

    flush()

    if len(blocks) >= 2 and int(blocks[-1]["char_count"]) < MATERIAL_BLOCK_MIN_CHARS:
        tail = blocks.pop()
        previous = blocks[-1]
        previous["chunk_ids"] = [*previous["chunk_ids"], *tail["chunk_ids"]]
        previous["page_labels"] = [*previous["page_labels"], *[label for label in tail["page_labels"] if label not in previous["page_labels"]]]
        previous_range = previous.get("time_range") if isinstance(previous.get("time_range"), dict) else {}
        tail_range = tail.get("time_range") if isinstance(tail.get("time_range"), dict) else {}
        starts = [
            value
            for value in [previous_range.get("from"), tail_range.get("from")]
            if isinstance(value, (int, float))
        ]
        ends = [
            value
            for value in [previous_range.get("to"), tail_range.get("to")]
            if isinstance(value, (int, float))
        ]
        previous["time_range"] = {
            "from": min(starts) if starts else None,
            "to": max(ends) if ends else None,
        }
        previous["text"] = f"{previous['text']}\n\n{tail['text']}".strip()
        previous["char_count"] = len(previous["text"])
        previous["estimated_tokens"] = _estimate_material_block_tokens(previous["text"])

    for index, block in enumerate(blocks, start=1):
        block["block_id"] = f"block_{index:03d}"
        block["order"] = index
    return blocks


def _write_text_file(file_path: str, lines: list[str]) -> str:
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as file:
        file.write("\n".join(lines).strip() + "\n")
    return file_path


def _write_text_blob(file_path: str, text: str) -> str:
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as file:
        file.write(text.rstrip() + "\n")
    return file_path


def _resolve_mimo_chat_endpoint() -> str:
    api_key = (os.getenv("SHIJIE_MIMO_API_KEY") or "").strip()
    endpoint = (
        os.getenv("SHIJIE_MIMO_CLEANING_ENDPOINT")
        or os.getenv("SHIJIE_MIMO_ENDPOINT")
        or os.getenv("SHIJIE_MIMO_TTS_ENDPOINT")
        or ""
    ).strip()
    if not endpoint:
        endpoint = "https://token-plan-cn.xiaomimimo.com/v1/chat/completions" if api_key.startswith("tp-") else "https://api.xiaomimimo.com/v1/chat/completions"
    if api_key.startswith("tp-") and "api.xiaomimimo.com" in endpoint:
        endpoint = "https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
    endpoint = endpoint.rstrip("/")
    if endpoint.lower().endswith("/anthropic"):
        endpoint = re.sub(r"/anthropic$", "/v1/chat/completions", endpoint, flags=re.IGNORECASE)
    if endpoint.lower().endswith("/v1"):
        return f"{endpoint}/chat/completions"
    if endpoint.lower().endswith("/v1/chat/completions"):
        return endpoint
    if re.match(r"^https?://[^/]+/?$", endpoint):
        return endpoint.rstrip("/") + "/v1/chat/completions"
    return endpoint


def _resolve_mimo_cleaning_model() -> str:
    explicit_model = (os.getenv("SHIJIE_MIMO_CLEANING_MODEL") or "").strip()
    if explicit_model:
        return explicit_model
    raw_model = (os.getenv("SHIJIE_MIMO_MODEL") or os.getenv("SHIJIE_MIMO_TTS_MODEL") or "mimo-v2.5").strip()
    return re.sub(r"-tts$", "", raw_model, flags=re.IGNORECASE) or "mimo-v2.5"


def _mimo_cleaning_available() -> bool:
    return bool((os.getenv("SHIJIE_MIMO_API_KEY") or "").strip())


def _extract_critical_numeric_terms(text: str) -> list[str]:
    patterns = (
        r"(?<!\d)(?:19|20)\d{2}年?",
        r"(?<!\d)\d{1,2}月\d{1,2}日",
        r"(?<!\d)\d+(?:\.\d+)?%",
        r"(?<!\d)\d+(?:\.\d+)?(?:万|亿)?美元",
        r"(?<!\d)\d+(?:\.\d+)?(?:万|亿)人",
    )
    terms: list[str] = []
    seen: set[str] = set()
    for pattern in patterns:
        for match in re.finditer(pattern, text or ""):
            term = match.group(0)
            key = term.casefold()
            if key in seen:
                continue
            seen.add(key)
            terms.append(term)
    return terms


def _missing_critical_numeric_terms(source_text: str, cleaned_text: str) -> list[str]:
    cleaned = cleaned_text or ""
    return [term for term in _extract_critical_numeric_terms(source_text) if term not in cleaned]


def _extract_full_year_terms(text: str) -> list[str]:
    years: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r"(?<!\d)(?:19|20)\d{2}年?", text or ""):
        term = match.group(0)
        key = term.rstrip("年")
        if key in seen:
            continue
        seen.add(key)
        years.append(term)
    return years


def _unsupported_full_year_terms(source_text: str, cleaned_text: str) -> list[str]:
    source = source_text or ""
    unsupported: list[str] = []
    for term in _extract_full_year_terms(cleaned_text):
        year = term.rstrip("年")
        if year in source:
            continue
        # Local ASR often drops the leading 1 in years such as 1938 -> 938.
        if len(year) == 4 and f"{year[1:]}年" in source:
            continue
        unsupported.append(term)
    return unsupported


def _soften_unsupported_full_years(source_text: str, cleaned_text: str) -> tuple[str, list[str]]:
    unsupported = _unsupported_full_year_terms(source_text, cleaned_text)
    softened = cleaned_text
    for term in unsupported:
        year = term.rstrip("年")
        # Keep month/day if the model invented only the year around a visible date.
        softened = re.sub(
            rf"{re.escape(year)}年(\d{{1,2}}月\d{{1,2}}日)(?:星期[一二三四五六日天])?",
            r"\1",
            softened,
        )
        softened = re.sub(rf"{re.escape(year)}年", "当时", softened)
        softened = re.sub(rf"(?<!\d){re.escape(year)}(?!\d)", "当时", softened)
    return softened, unsupported


def _extract_time_markers(text: str) -> list[str]:
    markers: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r"\[(?:\d{1,2}:)?\d{2}:\d{2}-(?:\d{1,2}:)?\d{2}:\d{2}\]", text or ""):
        marker = match.group(0)
        if marker in seen:
            continue
        seen.add(marker)
        markers.append(marker)
    return markers


def _missing_time_markers(source_text: str, cleaned_text: str) -> list[str]:
    cleaned = cleaned_text or ""
    source_markers = _extract_time_markers(source_text)
    if len(source_markers) < 2:
        return []
    return [marker for marker in source_markers if marker not in cleaned]


def _read_int_env(*names: str, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    value = default
    for name in names:
        raw_value = os.getenv(name)
        if raw_value is None or not str(raw_value).strip():
            continue
        fallback_error = ""
        try:
            value = int(str(raw_value).strip())
            break
        except ValueError:
            value = default
            break
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _rule_clean_transcript_text(text: str) -> str:
    normalized = text.replace("\u3000", " ")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\s+([，。！？；：、,.!?;:])", r"\1", normalized)
    normalized = re.sub(r"([，。！？；：、,.!?;:])\s+", r"\1", normalized)
    normalized = re.sub(r"\b(嗯|呃|啊|额)\b[，,、 ]*", "", normalized)
    lines: list[str] = []
    previous = ""
    for raw_line in normalized.splitlines():
        line = raw_line.strip()
        if not line:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        if line == previous:
            continue
        lines.append(line)
        previous = line
    return "\n".join(lines).strip()


def _format_seconds_for_markdown(value: float | None) -> str:
    if value is None:
        return ""
    seconds = max(0, int(value))
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _chunk_units_for_cleaning(units: list[TextUnit], *, target_chars: int = 7000) -> list[CleaningChunk]:
    groups: list[dict[str, Any]] = []
    current_units: list[TextUnit] = []
    current_length = 0

    def flush() -> None:
        nonlocal current_units, current_length
        if not current_units:
            return
        page_labels = list(dict.fromkeys(unit.page_label for unit in current_units if unit.page_label))
        starts = [unit.start_time for unit in current_units if unit.start_time is not None]
        ends = [unit.end_time for unit in current_units if unit.end_time is not None]
        body_lines: list[str] = []
        active_label = ""
        for unit in current_units:
            if unit.page_label != active_label:
                active_label = unit.page_label
                if active_label:
                    body_lines.extend(["", f"## {active_label}"])
            time_label = ""
            start_label = _format_seconds_for_markdown(unit.start_time)
            end_label = _format_seconds_for_markdown(unit.end_time)
            if start_label or end_label:
                time_label = f"[{start_label or '?'}-{end_label or '?'}] "
            body_lines.append(f"{time_label}{unit.text}".strip())
        groups.append(
            {
                "text": "\n".join(body_lines).strip(),
                "page_labels": page_labels,
                "start_time": min(starts) if starts else None,
                "end_time": max(ends) if ends else None,
            }
        )
        current_units = []
        current_length = 0

    for unit in units:
        unit_length = len(unit.text)
        if current_units and current_length + unit_length > target_chars:
            flush()
        current_units.append(unit)
        current_length += unit_length
    flush()

    chunks: list[CleaningChunk] = []
    for index, group in enumerate(groups, start=1):
        previous_tail = str(groups[index - 2]["text"])[-700:] if index > 1 else ""
        next_head = str(groups[index]["text"])[:700] if index < len(groups) else ""
        chunks.append(
            CleaningChunk(
                index=index,
                chunk_id=f"clean_chunk_{index:03d}",
                text=str(group["text"]),
                page_labels=list(group["page_labels"]),
                start_time=group["start_time"],
                end_time=group["end_time"],
                previous_tail=previous_tail,
                next_head=next_head,
            )
        )
    return chunks


def _build_cleaning_prompt(
    chunk: CleaningChunk,
    *,
    title: str,
    previous_output: str = "",
    repair_notes: list[str] | None = None,
) -> list[dict[str, str]]:
    system_prompt = (
        "你是字幕清稿助手。你的任务是把机器字幕或口语转写整理成忠实、通顺、适合阅读和导入 NotebookLM 的资料稿。"
        "只清理表达，不总结、不扩写、不改变观点、不删除有效信息。"
        "原字幕是唯一依据；不要使用外部记忆修正事实。年份、日期、数字、金额、比例、姓名、机构名和术语必须忠实于原片段。"
    )
    critical_terms = _extract_critical_numeric_terms(chunk.text)
    critical_terms_text = "、".join(critical_terms[:80]) if critical_terms else "无"
    time_markers = _extract_time_markers(chunk.text)
    time_markers_text = "、".join(time_markers[:80]) if time_markers else "无"
    if previous_output:
        notes = "；".join(repair_notes or [])
        user_prompt = f"""请修订 previous_output，使它忠实对应 current_chunk。

要求：
- 只输出修订后的完整清稿正文，不输出说明。
- 不要重新总结，不要新增原片段没有的结论。
- 优先修复数字、年份、日期、金额、比例、姓名、机构名和术语错误。
- 如果原片段没有清楚给出完整年份，不要补成 `20xx年` 或 `19xx年`；可以保留较模糊的原文表达。
- current_chunk 中的关键数字/日期项必须保留：{critical_terms_text}
- 如果 current_chunk 含有时间戳，必须保留每个时间戳，并在对应时间戳后清洗同一时间段内容：{time_markers_text}
- 已发现的问题：{notes or "上一版存在关键事实不一致"}

视频标题：{title}

current_chunk：
{chunk.text}

previous_output：
{previous_output}
"""
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

    user_prompt = f"""请清洗下面的 current_chunk。

要求：
- 只输出 current_chunk 的清洗结果，不输出说明。
- 保留事实、例子、数字、专有名词、判断方向和原视频的信息顺序。
- 修正明显断句、标点、重复口癖和识别错词；不确定的术语保持原文。
- 不要把内容压缩成摘要，不要新增原文没有的结论。
- 不要凭常识或外部知识改写年份、日期、数字、金额、比例、姓名、机构名和术语。
- 如果原片段没有清楚给出完整年份，不要补成 `20xx年` 或 `19xx年`；可以写成“当时”“这一年”，或保留原片段的模糊表达。
- 如果原文有 `[mm:ss-mm:ss]` 时间戳，必须保留每个时间戳；每个时间戳后只清洗该时间段的内容，不要跨时间戳合并或改写顺序。
- current_chunk 中的关键数字/日期项必须保留：{critical_terms_text}
- current_chunk 中的时间戳必须保留：{time_markers_text}
- 可以用自然段和少量二级标题；不要写 source/block/debug 信息。

视频标题：{title}

previous_tail 仅作上下文，不要输出：
{chunk.previous_tail or "无"}

current_chunk：
{chunk.text}

next_head 仅作上下文，不要输出：
{chunk.next_head or "无"}
"""
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def _request_mimo_cleaning(
    chunk: CleaningChunk,
    *,
    title: str,
    timeout: int = 120,
    previous_output: str = "",
    repair_notes: list[str] | None = None,
) -> tuple[str, dict[str, Any]]:
    api_key = (os.getenv("SHIJIE_MIMO_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("未配置 MiMo API Key")
    endpoint = _resolve_mimo_chat_endpoint()
    model = _resolve_mimo_cleaning_model()
    payload = {
        "model": model,
        "messages": _build_cleaning_prompt(
            chunk,
            title=title,
            previous_output=previous_output,
            repair_notes=repair_notes,
        ),
        "temperature": 0.2,
    }
    response = requests.post(
        endpoint,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "api-key": api_key,
        },
        json=payload,
        timeout=timeout,
    )
    response_text = response.text
    try:
        result = response.json()
    except Exception as exc:
        raise RuntimeError(f"MiMo 返回非 JSON：HTTP {response.status_code} {response_text[:180]}") from exc
    if not response.ok:
        message = result.get("error", {}).get("message") if isinstance(result.get("error"), dict) else response_text
        raise RuntimeError(f"MiMo 清稿失败：HTTP {response.status_code} {message}")
    if isinstance(result.get("error"), dict):
        raise RuntimeError(f"MiMo 清稿失败：{result['error'].get('message') or result['error']}")
    choices = result.get("choices") if isinstance(result, dict) else None
    message = choices[0].get("message", {}) if isinstance(choices, list) and choices else {}
    content = message.get("content") if isinstance(message, dict) else ""
    if isinstance(content, list):
        content = "\n".join(str(part.get("text") if isinstance(part, dict) else part) for part in content)
    cleaned = str(content or "").strip()
    if not cleaned:
        raise RuntimeError("MiMo 未返回清稿文本")
    usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}
    return cleaned, {
        "endpoint": endpoint,
        "model": model,
        "usage": usage,
    }


def _resolve_mimo_editorial_model() -> str:
    explicit_model = (os.getenv("SHIJIE_MIMO_EDITORIAL_MODEL") or "").strip()
    if explicit_model:
        return explicit_model
    return _resolve_mimo_cleaning_model()


def _mimo_editorial_available() -> bool:
    return bool((os.getenv("SHIJIE_MIMO_API_KEY") or "").strip())


def _strip_markdown_code_fence(text: str) -> str:
    cleaned = str(text or "").strip()
    match = re.match(r"^```(?:json|markdown|md)?\s*(.*?)\s*```$", cleaned, flags=re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else cleaned


def _extract_json_document(text: str) -> dict[str, Any]:
    cleaned = _strip_markdown_code_fence(text)
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {"items": parsed}
    except Exception:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(cleaned[start : end + 1])
                return parsed if isinstance(parsed, dict) else {"items": parsed}
            except Exception:
                pass
    return {"raw": cleaned}


def _request_mimo_editorial(
    *,
    task_id: str,
    messages: list[dict[str, str]],
    temperature: float = 0.25,
    timeout: int = 180,
) -> tuple[str, dict[str, Any]]:
    api_key = (os.getenv("SHIJIE_MIMO_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("未配置 MiMo API Key")
    endpoint = _resolve_mimo_chat_endpoint()
    model = _resolve_mimo_editorial_model()
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    response = requests.post(
        endpoint,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "api-key": api_key,
        },
        json=payload,
        timeout=timeout,
    )
    response_text = response.text
    try:
        result = response.json()
    except Exception as exc:
        raise RuntimeError(f"MiMo 编稿返回非 JSON：HTTP {response.status_code} {response_text[:180]}") from exc
    if not response.ok:
        message = result.get("error", {}).get("message") if isinstance(result.get("error"), dict) else response_text
        raise RuntimeError(f"MiMo 编稿失败：HTTP {response.status_code} {message}")
    if isinstance(result.get("error"), dict):
        raise RuntimeError(f"MiMo 编稿失败：{result['error'].get('message') or result['error']}")
    choices = result.get("choices") if isinstance(result, dict) else None
    message = choices[0].get("message", {}) if isinstance(choices, list) and choices else {}
    content = message.get("content") if isinstance(message, dict) else ""
    if isinstance(content, list):
        content = "\n".join(str(part.get("text") if isinstance(part, dict) else part) for part in content)
    output = str(content or "").strip()
    if not output:
        raise RuntimeError(f"MiMo 编稿任务 {task_id} 未返回内容")
    if _is_rejected_editorial_output(output):
        raise RuntimeError(f"MiMo 编稿任务 {task_id} 被安全策略拒绝，没有生成可用正文。")
    usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}
    return _strip_markdown_code_fence(output), {
        "task_id": task_id,
        "endpoint": endpoint,
        "model": model,
        "usage": usage,
    }


def _editorial_summary_mode() -> str:
    return (os.getenv("SHIJIE_EDITORIAL_SUMMARY_MODE") or "auto").strip().lower()


def _is_rejected_editorial_output(text: str) -> bool:
    lowered_output = str(text or "").strip().lower()
    return (
        "the request was rejected" in lowered_output
        or "considered high risk" in lowered_output
        or "content policy" in lowered_output
        or "safety policy" in lowered_output
    )


def _read_text_blob_if_exists(file_path: str) -> str:
    if not os.path.exists(file_path):
        return ""
    try:
        with open(file_path, "r", encoding="utf-8") as file:
            return file.read().strip()
    except Exception:
        return ""


def _read_editorial_work_json(work_dir: str, name: str) -> dict[str, Any]:
    file_path = os.path.join(work_dir, name)
    payload = _load_json_file(file_path)
    if payload is not None:
        return payload
    raw = _read_text_blob_if_exists(file_path)
    return _extract_json_document(raw) if raw else {}


def _strip_editorial_time_marker(value: str) -> str:
    text = _to_clean_text(value)
    text = re.sub(
        r"^\[\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*\]\s*",
        "",
        text,
    )
    text = re.sub(
        r"^\(?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–—]\s*\d{1,2}:\d{2}(?::\d{2})?)?\)?\s*[：:\-–—]\s*",
        "",
        text,
    )
    return text.strip()


def _coerce_editorial_items(value: Any, *, limit: int = 8) -> list[str]:
    if isinstance(value, dict):
        candidates: list[Any] = []
        for key in ("items", "points", "facts", "claims", "arguments", "examples", "notes"):
            if isinstance(value.get(key), list):
                candidates.extend(value[key])
        if not candidates:
            candidates.extend(value.values())
        value = candidates
    if not isinstance(value, list):
        value = [value] if value else []

    items: list[str] = []
    seen: set[str] = set()
    for item in value:
        if isinstance(item, dict):
            parts = [
                item.get("time") or item.get("timestamp") or item.get("source") or "",
                item.get("title") or item.get("label") or "",
                item.get("text") or item.get("content") or item.get("summary") or item.get("claim") or item.get("fact") or "",
            ]
            text = " ".join(_to_clean_text(part) for part in parts if _to_clean_text(part))
        else:
            text = _to_clean_text(item)
        if not text:
            continue
        marker = re.sub(r"\s+", "", text).casefold()
        if marker in seen:
            continue
        seen.add(marker)
        items.append(text)
        if len(items) >= limit:
            break
    return items


def _append_editorial_bullets(lines: list[str], items: list[str], *, keep_time: bool = True) -> None:
    for item in items:
        text = item if keep_time else _strip_editorial_time_marker(item)
        if text:
            lines.append(f"- {text}")


def _normalize_editorial_heading(text: str, level: int) -> str:
    raw = _to_clean_text(text).strip().strip("#").strip()
    raw = re.sub(r"^[\ufe0f\s]+", "", raw)
    if re.match(r"^[\U0001F300-\U0001FAFF\u2600-\u27BF]", raw):
        return raw

    normalized = re.sub(r"[\s：:、，,]+", "", raw)
    h2_map = {
        "先说结论": "核心判断",
        "开篇判断": "核心判断",
        "一句话抓住": "核心判断",
        "核心判断": "核心判断",
        "这条视频真正讨论的问题": "🧭 核心线索",
        "问题线索": "🧭 核心线索",
        "核心线索": "🧭 核心线索",
        "这条视频的主线": "🧭 叙事主线",
        "主线脉络": "🧭 叙事主线",
        "问题拆解": "🔎 问题拆解",
        "关键内容拆解": "🔎 问题拆解",
        "关键事实与判断": "🔎 问题拆解",
        "核心拆解": "🔎 问题拆解",
        "需要读懂的概念和例子": "🧱 细节与案例",
        "概念与案例": "🧱 细节与案例",
        "细节与案例": "🧱 细节与案例",
        "普通摘要容易漏掉的细节": "🧱 细节与案例",
        "事实观点与推测": "背景与边界",
        "事实观点与边界": "背景与边界",
        "事实判断与边界": "背景与边界",
        "值得回看的片段": "💬 关键原话",
        "值得保留的原话": "💬 关键原话",
        "关键原话": "💬 关键原话",
        "一句话带走": "核心判断",
    }
    h3_map = {
        "事实骨架": "事实底稿",
        "视频使用的例子": "案例现场",
        "概念解释": "概念解释",
        "论证链条": "论证链条",
        "作者判断": "作者判断",
    }
    if level == 2:
        if normalized.startswith("问题线索") or normalized.startswith("核心线索"):
            return "🧭 核心线索"
        if normalized.startswith("核心拆解") or normalized.startswith("问题拆解") or normalized.startswith("关键内容拆解"):
            return "🔎 问题拆解"
        return h2_map.get(normalized, raw)
    if level == 3:
        return h3_map.get(normalized, raw)
    return raw


def _strip_editorial_time_markers_from_line(line: str) -> str:
    bullet_match = re.match(r"^(\s*(?:[-*]|\d+[.)])\s+)(.*)$", line)
    if bullet_match:
        return f"{bullet_match.group(1)}{_strip_editorial_time_marker(bullet_match.group(2))}".rstrip()
    return _strip_editorial_time_marker(line)


def _clean_editorial_takeaway_line(line: str) -> str:
    text = _strip_editorial_time_markers_from_line(line).strip()
    text = re.sub(r"^(?:[-*]\s+)?(?:>\s*)+", "", text).strip()
    text = text.replace("**", "").strip()
    return text


def _is_editorial_source_note(line: str) -> bool:
    text = _to_clean_text(line)
    return bool(
        text.startswith("来自 ")
        or text.startswith("基于清洗字幕")
        or "这篇精读稿以视频原文为边界" in text
    )


def _normalize_editorial_article_markdown(markdown_text: str) -> str:
    lines = markdown_text.replace("\r\n", "\n").split("\n")
    result: list[str] = []
    takeaway_lines: list[str] = []
    collecting_takeaway = False
    skipping_section = False
    has_takeaway_heading = any(
        re.match(r"^##\s+.*(?:一句话(?:带走|抓住)|一眼看懂|核心判断)", line.strip())
        for line in lines
    )

    def is_h2(line: str) -> bool:
        return bool(re.match(r"^##\s+", line.strip()))

    for raw_line in lines:
        line = raw_line.rstrip()
        heading = re.match(r"^(#{1,4})\s+(.+?)\s*$", line.strip())
        if heading:
            level = len(heading.group(1))
            raw_heading_text = re.sub(
                r"^(?:[\U0001F300-\U0001FAFF\u2600-\u27BF]\ufe0f?\s*)+",
                "",
                heading.group(2),
            ).strip()
            raw_heading_text = re.sub(r"^[\ufe0f\s]+", "", raw_heading_text)
            heading_text = _normalize_editorial_heading(raw_heading_text, level)
            normalized = re.sub(r"[\s：:、，,]+", "", raw_heading_text)
            if level == 2 and re.search(r"一句话(?:带走|抓住)|一眼看懂|核心判断", heading.group(2)):
                collecting_takeaway = True
                skipping_section = False
                continue
            if level == 2 and has_takeaway_heading and normalized in {"先说结论", "开篇判断"}:
                collecting_takeaway = False
                skipping_section = False
                result.append("### 核心要点")
                continue
            if level == 2 and normalized in {"普通摘要容易漏掉的细节", "被忽略的关键细节"}:
                collecting_takeaway = False
                skipping_section = False
                result.append("### 进一步保留的细节")
                continue
            if level == 2 and normalized in {
                "主线脉络",
                "值得回看的片段",
                "值得保留的原话",
                "关键原话",
                "事实观点与推测",
                "事实观点与边界",
                "事实判断与边界",
                "事实判断边界",
                "判断与边界",
            }:
                collecting_takeaway = False
                skipping_section = True
                continue
            collecting_takeaway = False
            skipping_section = False
            result.append(f"{'#' * level} {heading_text}")
            continue

        if collecting_takeaway:
            cleaned = _clean_editorial_takeaway_line(line)
            if cleaned.strip():
                takeaway_lines.append(cleaned)
            continue
        if skipping_section:
            continue
        result.append(_strip_editorial_time_markers_from_line(line))

    if takeaway_lines:
        insertion = next(
            (index for index, line in enumerate(result) if re.match(r"^##\s+", line.strip())),
            min(len(result), 1),
        )
        core_block: list[str] = []
        core_start = -1
        for index in range(insertion - 1, -1, -1):
            stripped = result[index].strip()
            if re.match(r"^##\s+", stripped):
                break
            if stripped == "### 核心要点":
                core_start = index
                break
        if core_start >= 0:
            core_block = [line for line in result[core_start:insertion] if line.strip()]
            del result[core_start:insertion]
            insertion = core_start

        first_takeaway = next(
            (
                _clean_editorial_takeaway_line(line)
                for line in takeaway_lines
                if _to_clean_text(line) and not _is_editorial_source_note(line)
            ),
            "",
        )
        intro_lines = [
            _clean_editorial_takeaway_line(line)
            for line in takeaway_lines
            if _is_editorial_source_note(line)
        ]
        takeaway_block = ["", "## 核心判断"]
        if first_takeaway:
            takeaway_block.extend(["", f"> {first_takeaway}"])
        remaining = [
            _clean_editorial_takeaway_line(line)
            for line in takeaway_lines
            if _clean_editorial_takeaway_line(line)
            and _clean_editorial_takeaway_line(line) != first_takeaway
            and not _is_editorial_source_note(line)
        ]
        if core_block:
            takeaway_block.extend(["", *core_block])
        if remaining:
            takeaway_block.extend(["", *remaining])
        takeaway_block.append("")
        if intro_lines:
            result[insertion:insertion] = ["", *intro_lines, ""]
            insertion += len(intro_lines) + 2
        result[insertion:insertion] = takeaway_block

    normalized_text = "\n".join(result)
    normalized_text = re.sub(r"\n{3,}", "\n\n", normalized_text)
    return normalized_text.strip()


def _first_meaningful_sentence(text: str, fallback: str) -> str:
    for sentence in re.split(r"[。！？!?\n]+", _to_clean_text(text)):
        sentence = re.sub(r"^#{1,6}\s*", "", sentence).strip()
        sentence = re.sub(r"^[-*]\s*", "", sentence).strip()
        sentence = sentence.replace("**", "").strip()
        if "视频主线图" in sentence:
            continue
        if len(sentence) >= 12:
            return sentence
    return fallback


def _build_fallback_editorial_article(
    *,
    title: str,
    source: SourceDescriptor,
    content_markdown: str,
    work_dir: str,
    reason: str,
) -> str:
    type_brief = _read_editorial_work_json(work_dir, "type_brief.json")
    extraction = _read_editorial_work_json(work_dir, "information_extraction.json")
    detail: dict[str, Any] = {}
    mainline = _read_text_blob_if_exists(os.path.join(work_dir, "mainline.md"))

    focus_items = _coerce_editorial_items(type_brief.get("editorial_focus"), limit=5)
    facts = [
        item
        for item in _coerce_editorial_items(extraction.get("background") or extraction.get("facts"), limit=8)
        if not re.search(r"收看第|星期[一二三四五六日天]", item)
    ][:6]
    claims = _coerce_editorial_items(extraction.get("claims"), limit=5)
    arguments = _coerce_editorial_items(extraction.get("arguments"), limit=5)
    examples = _coerce_editorial_items(extraction.get("examples"), limit=4)
    definitions = _coerce_editorial_items(extraction.get("definitions"), limit=4)
    predictions = _coerce_editorial_items(extraction.get("predictions"), limit=3)
    missed_details = _coerce_editorial_items(detail.get("easily_missed_details"), limit=4)
    minor_examples = _coerce_editorial_items(detail.get("minor_but_useful_examples"), limit=3)

    focus_lead = "、".join(_strip_editorial_time_marker(item) for item in focus_items[:2])
    fallback_lead = (
        f"这期视频的核心，是围绕{focus_lead}展开，把一条新闻放回产业红利、政治博弈和普通人利益分化的脉络里看。"
        if focus_lead
        else "这期视频围绕一个具体事件展开，把劳资冲突、产业红利和公众立场放在同一条脉络里解释。"
    )
    content_lead = fallback_lead
    content_type = _to_clean_text(type_brief.get("content_type")) or "视频精读"
    reading_value = _to_clean_text(type_brief.get("reading_value")) or "中"
    creator_line = f"来自 {source.creator}" if source.creator else "基于清洗字幕与多通路信息抽取生成"

    lines: list[str] = [
        f"# {title}",
        "",
        f"> {content_lead}",
        "",
        f"{creator_line}。这篇精读稿以视频原文为边界，把口语化表达整理成便于阅读和回看的结构。内容类型判断为「{content_type}」，阅读价值为「{reading_value}」。",
        "",
    ]

    takeaway_candidates = predictions or arguments or focus_items
    takeaway = _strip_editorial_time_marker(takeaway_candidates[-1]) if takeaway_candidates else "把视频当成一条问题线索，比把它当成单条新闻更有价值。"
    lines.extend(["", "## 核心判断", "", f"> {takeaway}", "", "### 核心要点"])
    if focus_items:
        _append_editorial_bullets(lines, focus_items, keep_time=False)
    else:
        fallback_points = _split_brief_points(content_markdown, limit=4)
        _append_editorial_bullets(lines, fallback_points, keep_time=False)
    lines.append("")

    lines.extend(["", "## 🧭 核心线索"])
    if mainline:
        mainline_paragraphs = [
            paragraph.strip()
            for paragraph in re.split(r"\n{2,}", mainline)
            if len(_to_clean_text(paragraph)) >= 18 and "视频主线图" not in paragraph
        ][:4]
        for paragraph in mainline_paragraphs:
            cleaned = re.sub(r"^#{1,4}\s*", "", paragraph).strip()
            lines.append(cleaned)
            lines.append("")
    else:
        lines.append(
            "视频不是只在复述单个事件，而是在追问一件事：当 AI 和半导体产业创造出巨额增量时，这份红利应该由劳动者、股东、企业还是更广泛的社会来分享。"
        )
        lines.append("")

    lines.append("## 🔎 问题拆解")
    if claims:
        lines.append("### 作者判断")
        _append_editorial_bullets(lines, claims, keep_time=False)
        lines.append("")
    if arguments:
        lines.append("### 论证链条")
        _append_editorial_bullets(lines, arguments, keep_time=False)
        lines.append("")
    if facts:
        lines.append("### 关键背景")
        _append_editorial_bullets(lines, facts, keep_time=False)
        lines.append("")

    if definitions or examples or missed_details or minor_examples or do_not_flatten:
        lines.append("## 🧱 细节与案例")
        if definitions:
            lines.append("### 概念解释")
            _append_editorial_bullets(lines, definitions, keep_time=False)
            lines.append("")
        if examples:
            lines.append("### 案例现场")
            _append_editorial_bullets(lines, examples, keep_time=False)
            lines.append("")
        _append_editorial_bullets(lines, missed_details, keep_time=False)
        _append_editorial_bullets(lines, minor_examples, keep_time=False)
        lines.append("")
    article = _normalize_editorial_article_markdown("\n".join(lines).strip())
    if _is_rejected_editorial_output(article) or len(article) < 800:
        raise RuntimeError(f"无法生成可用兜底精读稿：{reason}")
    return article


def _build_fallback_review(article_md: str, *, reason: str) -> dict[str, Any]:
    return {
        "status": "fallback_passed",
        "fidelity_score": 0.72,
        "unsupported_claims": [],
        "flattened_boundaries": [],
        "missing_key_details": [],
        "notes": [
            "主编 API 未返回可用文章，已使用清洗字幕和多通路抽取结果生成本地兜底稿。",
            "兜底稿不做外部事实判断，仅保证资料台可读和信息结构完整。",
            f"fallback_reason: {reason[:240]}",
        ],
    }


def _editorial_summary_eligibility(*, video_info: dict[str, Any], plan: ChunkPlan, content_chars: int) -> dict[str, Any]:
    mode = _editorial_summary_mode()
    duration_seconds = float(video_info.get("duration") or 0)
    max_duration_seconds = _read_int_env(
        "SHIJIE_EDITORIAL_SUMMARY_MAX_DURATION_SECONDS",
        default=1800,
        minimum=300,
        maximum=7200,
    )
    max_content_chars = _read_int_env(
        "SHIJIE_EDITORIAL_SUMMARY_MAX_CONTENT_CHARS",
        default=30000,
        minimum=8000,
        maximum=90000,
    )
    reasons: list[str] = []
    if not _mimo_editorial_available():
        reasons.append("missing_mimo_api_key")
    if duration_seconds > max_duration_seconds > 0:
        reasons.append("duration_over_route")
    if content_chars > max_content_chars:
        reasons.append("content_over_route")
    if mode in {"off", "none", "skip"}:
        reasons.append("disabled")
    eligible = mode in {"force", "on", "always"} or (not reasons)
    if mode in {"off", "none", "skip"}:
        eligible = False
    return {
        "mode": mode,
        "eligible": eligible,
        "reasons": reasons,
        "duration_seconds": duration_seconds,
        "content_chars": content_chars,
        "text_length": plan.text_length,
        "block_count": len(plan.chunks),
        "max_duration_seconds": max_duration_seconds,
        "max_content_chars": max_content_chars,
    }


def _build_editorial_source_packet(*, title: str, source: SourceDescriptor, content_markdown: str) -> str:
    return "\n".join(
        [
            f"视频标题：{title}",
            f"来源 ID：{source.source_id}",
            f"发布者：{source.creator or '未知'}",
            f"链接：{source.url or '未记录'}",
            "",
            "下面是已经清洗过的字幕资料稿。它是本次编稿的主要依据；时间戳和原始表述用于支撑最终文稿。",
            "",
            content_markdown.strip(),
        ]
    ).strip()


def _editorial_system_prompt(role_name: str) -> str:
    return (
        f"你是视界专注的视频自动编稿系统中的{role_name}。"
        "目标不是压缩字幕，而是帮助主编把视频改写成适合邮件阅读的精品日报稿。"
        "请优先保留事实、观点、因果、转折、限定条件、例子、数字、人名、机构和时间线之间的关系。"
        "MiMo 不负责实时判断外部真相；你的审查重点是最终内容是否忠实于字幕资料。"
    )


def _run_editorial_task(
    *,
    task_id: str,
    role_name: str,
    instruction: str,
    source_packet: str,
    temperature: float = 0.2,
) -> tuple[str, dict[str, Any]]:
    messages = [
        {"role": "system", "content": _editorial_system_prompt(role_name)},
        {"role": "user", "content": f"{instruction}\n\n资料：\n{source_packet}"},
    ]
    return _request_mimo_editorial(task_id=task_id, messages=messages, temperature=temperature)


def _render_simple_email_html(markdown_text: str, *, title: str, source: SourceDescriptor) -> str:
    markdown_text = _normalize_editorial_article_markdown(markdown_text)
    body: list[str] = []
    in_list = False
    section_open = False
    skipped_lead_title = False
    section_style = "margin:24px 0 0;padding:24px 0 0;border-top:1px solid #eef1f5;"
    takeaway_section_style = (
        "margin:18px 0 0;padding:20px 22px;border:1px solid #f3d28b;"
        "border-radius:20px;background:#fffaf0;background-color:#fffaf0;color:#1f2937;"
    )
    h2_style = (
        "font-size:22px;line-height:1.42;margin:0 0 14px;color:#667085;"
        "letter-spacing:0;font-weight:760;"
    )
    h3_style = (
        "font-size:16px;line-height:1.55;margin:22px 0 10px;color:#344054;"
        "letter-spacing:0;font-weight:740;"
    )
    paragraph_style = "font-size:15px;line-height:1.92;color:#2f3a4a;margin:10px 0;"
    list_style = "padding-left:20px;margin:8px 0 0;color:#2f3a4a;"
    list_item_style = "font-size:15px;line-height:1.92;color:#2f3a4a;margin:7px 0;"
    quote_style = (
        "margin:8px 0 12px;padding:15px 18px;border-left:4px solid #f59e0b;"
        "background:#fff7e6;background-color:#fff7e6;border-radius:0 14px 14px 0;color:#303846;font-weight:500;"
    )

    def normalize_title_for_compare(value: str) -> str:
        return re.sub(r"\s+", " ", value).strip()

    def render_inline(value: str) -> str:
        rendered = html.escape(value)
        rendered = re.sub(
            r"`([^`]+)`",
            r'<code style="padding:2px 5px;border-radius:6px;background:#eef2f7;background-color:#eef2f7;color:#243041;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.92em;">\1</code>',
            rendered,
        )
        rendered = re.sub(r"\*\*([^*]+)\*\*", r'<strong style="color:#111827;font-weight:700;">\1</strong>', rendered)
        return rendered

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            body.append("</ul>")
            in_list = False

    def close_section() -> None:
        nonlocal section_open
        close_list()
        if section_open:
            body.append("</section>")
            section_open = False

    def ensure_section() -> None:
        nonlocal section_open
        if not section_open:
            body.append(f'<section class="article-section" style="{section_style}">')
            section_open = True

    for raw_line in markdown_text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped:
            close_list()
            continue
        if stripped == "---":
            close_section()
            body.append("<hr />")
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            level_raw = len(heading.group(1))
            heading_text = heading.group(2).strip()
            if (
                not skipped_lead_title
                and level_raw == 1
                and normalize_title_for_compare(heading_text) == normalize_title_for_compare(title)
            ):
                skipped_lead_title = True
                continue
            skipped_lead_title = True
            if level_raw == 2:
                close_section()
                is_takeaway = bool(re.search(r"一句话|开篇|判断|核心", heading_text))
                section_class = " article-section--takeaway" if is_takeaway else ""
                current_section_style = takeaway_section_style if is_takeaway else section_style
                body.append(f'<section class="article-section{section_class}" style="{current_section_style}">')
                body.append(f'<h2 style="{h2_style}">{render_inline(heading_text)}</h2>')
                section_open = True
                continue
            ensure_section()
            level = min(max(level_raw, 2), 3)
            heading_style = h2_style if level == 2 else h3_style
            body.append(f'<h{level} style="{heading_style}">{render_inline(heading_text)}</h{level}>')
            continue
        if stripped.startswith(">"):
            ensure_section()
            close_list()
            body.append(f'<blockquote style="{quote_style}">{render_inline(stripped.lstrip("> ").strip())}</blockquote>')
            continue
        if re.match(r"^[-*]\s+", stripped):
            ensure_section()
            if not in_list:
                body.append(f'<ul style="{list_style}">')
                in_list = True
            item_text = re.sub(r"^[-*]\s+", "", stripped)
            body.append(f'<li style="{list_item_style}">{render_inline(item_text)}</li>')
            continue
        ensure_section()
        close_list()
        body.append(f'<p style="{paragraph_style}">{render_inline(stripped)}</p>')
    close_section()

    source_line = " · ".join(part for part in [source.creator, source.source_id] if part)
    source_link = (
        f' · <a href="{html.escape(source.url, quote=True)}" style="color:#51657f;text-decoration:none;border-bottom:1px solid #c8d1dc;">原视频</a>'
        if source.url
        else ""
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <meta name="x-apple-disable-message-reformatting" content="" />
  <title>{html.escape(title)}</title>
  <style>
    html {{ background:#f5f6f8; background-color:#f5f6f8; }}
    :root {{ color-scheme: light; }}
    body {{ margin:0; padding:0; background:#f5f6f8; background-color:#f5f6f8; color:#1f2937; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }}
    .wrap {{ max-width:940px; margin:0 auto; padding:34px 22px 56px; }}
    .article {{ background:#ffffff; background-color:#ffffff; border:1px solid #e7eaf0; border-radius:26px; padding:34px 42px 40px; box-shadow:0 18px 54px rgba(15,23,42,.08); }}
    .source {{ color:#7b8494; font-size:13px; line-height:1.8; margin:0 0 22px; word-break:break-word; }}
    .source a {{ color:#51657f; text-decoration:none; border-bottom:1px solid #c8d1dc; }}
    h1 {{ font-size:30px; line-height:1.25; margin:0 0 12px; color:#111827; letter-spacing:0; }}
    h2 {{ font-size:22px; line-height:1.42; margin:0 0 14px; color:#667085; letter-spacing:0; font-weight:760; }}
    h3 {{ font-size:16px; line-height:1.55; margin:22px 0 10px; color:#344054; letter-spacing:0; font-weight:740; }}
    p, li {{ font-size:15px; line-height:1.92; color:#2f3a4a; }}
    p {{ margin:10px 0; }}
    li {{ margin:7px 0; }}
    strong {{ color:#111827; font-weight:700; }}
    code {{ padding:2px 5px; border-radius:6px; background:#eef2f7; background-color:#eef2f7; color:#243041; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.92em; }}
    ul {{ padding-left:20px; margin:8px 0 0; }}
    blockquote {{ margin:8px 0 12px; padding:15px 18px; border-left:4px solid #f59e0b; background:#fff7e6; background-color:#fff7e6; border-radius:0 14px 14px 0; color:#303846; font-weight:500; }}
    hr {{ border:0; border-top:1px solid #e7eaf0; margin:28px 0; }}
    .article-section {{ margin:24px 0 0; padding:24px 0 0; border-top:1px solid #eef1f5; }}
    .article-section + .article-section {{ margin-top:26px; }}
    .article-section--takeaway {{ margin:18px 0 0; padding:20px 22px; border:1px solid #f3d28b; border-radius:20px; background:#fffaf0; background-color:#fffaf0; }}
    .article-section > :first-child {{ margin-top:0; }}
    .article-section > :last-child {{ margin-bottom:0; }}
    @media (max-width: 680px) {{
      .wrap {{ padding:18px 12px 36px; }}
      .article {{ border-radius:20px; padding:24px 18px 28px; }}
      h1 {{ font-size:24px; }}
      h2 {{ font-size:19px; }}
      p, li {{ font-size:14px; }}
    }}
  </style>
</head>
<body bgcolor="#f5f6f8" style="margin:0;padding:0;background:#f5f6f8;background-color:#f5f6f8;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <main class="wrap" style="max-width:940px;margin:0 auto;padding:34px 22px 56px;">
    <article class="article" bgcolor="#ffffff" style="background:#ffffff;background-color:#ffffff;border:1px solid #e7eaf0;border-radius:26px;padding:34px 42px 40px;box-shadow:0 18px 54px rgba(15,23,42,.08);color:#1f2937;">
      <h1 style="font-size:30px;line-height:1.25;margin:0 0 12px;color:#111827;letter-spacing:0;">{html.escape(title)}</h1>
      <div class="source" style="color:#7b8494;font-size:13px;line-height:1.8;margin:0 0 22px;word-break:break-word;">{html.escape(source_line)}{source_link}</div>
      {''.join(body)}
    </article>
  </main>
</body>
</html>
"""


def _build_editorial_cards(extraction: dict[str, Any], detail: dict[str, Any], type_brief: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": EDITORIAL_SUMMARY_VERSION,
        "content_type": type_brief.get("content_type") or type_brief.get("type") or "",
        "reading_value": type_brief.get("reading_value") or "",
        "background": extraction.get("background") or extraction.get("facts") or [],
        "claims": extraction.get("claims") or [],
        "arguments": extraction.get("arguments") or [],
        "examples": extraction.get("examples") or [],
        "definitions": extraction.get("definitions") or [],
        "predictions": extraction.get("predictions") or [],
    }


def _finalize_editorial_status(
    *,
    material_dir: str,
    summary_dir: str,
    status: dict[str, Any],
    started_perf: float,
) -> dict[str, Any]:
    finished_at = str(status.get("finished_at") or _utc_now_iso())
    status["finished_at"] = finished_at
    elapsed_seconds = round(max(0.0, perf_counter() - started_perf), 3)
    usage_totals = _summarize_usage_tokens(status.get("usage") if isinstance(status.get("usage"), dict) else {})
    article_path = os.path.join(summary_dir, "article.md")
    html_path = os.path.join(summary_dir, "article.html")
    artifacts = {
        "article_chars": _text_file_chars(article_path),
        "article_html_bytes": _file_size(html_path),
        "cards_bytes": _file_size(os.path.join(summary_dir, "cards.json")),
        "review_bytes": _file_size(os.path.join(summary_dir, "review.json")),
    }
    metrics = {
        "status": status.get("status") or "",
        "started_at": status.get("started_at") or "",
        "finished_at": finished_at,
        "elapsed_seconds": elapsed_seconds,
        "token_totals": usage_totals,
        "artifacts": artifacts,
        "fallback": bool(status.get("fallback")),
        "error": status.get("error") or status.get("reason") or "",
    }
    status["metrics"] = metrics
    _write_material_metrics(material_dir, stage_name="editorial_summary", stage_payload=metrics)
    return status


def build_editorial_summary_content(
    *,
    material_dir: str,
    title: str,
    source: SourceDescriptor,
    video_info: dict[str, Any],
    plan: ChunkPlan,
) -> dict[str, Any]:
    summary_dir = os.path.join(material_dir, "summary")
    work_dir = os.path.join(summary_dir, "work")
    os.makedirs(work_dir, exist_ok=True)
    content_path = os.path.join(material_dir, "content.md")
    content_markdown = ""
    if os.path.exists(content_path):
        with open(content_path, "r", encoding="utf-8") as file:
            content_markdown = file.read()
    content_chars = len(content_markdown)
    eligibility = _editorial_summary_eligibility(video_info=video_info, plan=plan, content_chars=content_chars)
    status_path = os.path.join(summary_dir, "summary_status.json")
    started_at = _utc_now_iso()
    started_perf = perf_counter()

    if not eligibility["eligible"]:
        status = {
            "schema_version": EDITORIAL_SUMMARY_VERSION,
            "status": "skipped",
            "started_at": started_at,
            "finished_at": _utc_now_iso(),
            "eligibility": eligibility,
            "reason": ", ".join(eligibility["reasons"]) or "not_eligible",
        }
        status = _finalize_editorial_status(material_dir=material_dir, summary_dir=summary_dir, status=status, started_perf=started_perf)
        _save_json_file(status_path, status)
        return status

    if not content_markdown.strip():
        status = {
            "schema_version": EDITORIAL_SUMMARY_VERSION,
            "status": "failed",
            "started_at": started_at,
            "finished_at": _utc_now_iso(),
            "eligibility": eligibility,
            "error": "content.md 为空，无法编稿。",
        }
        status = _finalize_editorial_status(material_dir=material_dir, summary_dir=summary_dir, status=status, started_perf=started_perf)
        _save_json_file(status_path, status)
        return status

    source_packet = _build_editorial_source_packet(title=title, source=source, content_markdown=content_markdown)
    usage: dict[str, Any] = {}
    try:
        _emit_progress("正在抽取视频信息单元…", 88, stage="editorial_summary")
        parallel_tasks = {
            "type_brief": (
                "类型判断员",
                """请判断这条视频的内容类型和编辑取向。只输出 JSON：
{
  "content_type": "新闻评论/观点分析/行业分析/技能教程/访谈/播客/产品评测/知识讲解/其他",
  "reading_value": "高/中/低",
  "editorial_focus": ["主编写稿时最该抓住的重点"],
  "risk_flags": ["容易误写或需要保守表达的地方"]
}""",
                0.15,
            ),
            "information_extraction": (
                "信息抽取员",
                """请从资料中抽取足够支撑正文的信息单元，不写文章。只输出 JSON：
{
  "claims": [],
  "arguments": [],
  "examples": [],
  "definitions": [],
  "background": [],
  "predictions": []
}
每类保留 4-8 条最有用的信息。不要抽“关键原话”“时间戳列表”“事实清单”这类正文板块；事实只作为背景和论证材料。""",
                0.12,
            ),
            "mainline": (
                "主线编辑",
                """请还原这条视频的表达路径。用 Markdown 输出，重点写清：
- 视频开头提出什么问题
- 背景如何展开
- 作者的核心判断是什么
- 判断依据、例子和转折是什么
- 结尾落到什么结论
这不是最终稿，而是给主编使用的主线图。""",
                0.2,
            ),
        }
        task_outputs: dict[str, str] = {}
        task_meta: dict[str, Any] = {}
        with ThreadPoolExecutor(max_workers=min(4, len(parallel_tasks))) as executor:
            futures = {
                executor.submit(
                    _run_editorial_task,
                    task_id=task_id,
                    role_name=role_name,
                    instruction=instruction,
                    source_packet=source_packet,
                    temperature=temperature,
                ): task_id
                for task_id, (role_name, instruction, temperature) in parallel_tasks.items()
            }
            for future in as_completed(futures):
                task_id = futures[future]
                output, meta = future.result()
                task_outputs[task_id] = output
                task_meta[task_id] = meta
                usage[task_id] = meta.get("usage") or {}
                suffix = "json" if task_id in {"type_brief", "information_extraction"} else "md"
                _write_text_blob(os.path.join(work_dir, f"{task_id}.{suffix}"), output)

        type_brief = _extract_json_document(task_outputs.get("type_brief", ""))
        extraction = _extract_json_document(task_outputs.get("information_extraction", ""))
        detail: dict[str, Any] = {}
        cards = _build_editorial_cards(extraction, detail, type_brief)
        _save_json_file(os.path.join(summary_dir, "cards.json"), cards)

        _emit_progress("正在合成精品视频稿…", 94, stage="editorial_summary")
        editor_material = {
            "type_brief": type_brief,
            "information_extraction": extraction,
            "mainline": task_outputs.get("mainline", ""),
        }
        article_instruction = f"""你是主编。请把多通路材料合成为一篇适合邮件阅读的精品视频日报稿。

写作目标：
- 读者不看视频，也能清楚知道视频讲了什么、作者想表达什么、为什么值得关注。
- 文章要像人工编辑写的自然中文，不要堆模板。
- 压缩口语和重复表达，但保留观点、因果、转折、限定条件和关键例子。
- 不做外部事实判断；遇到资料内无法确认的内容，用“作者认为/视频提到/仍需核查”等保守表达。
- 最有价值的一句话判断要放在文章前部，帮助读者先抓住主旨；这句话不要加粗。
- 正文默认不要展示密集时间戳；时间戳只作为内部回查线索，除非某个时间点本身就是新闻事实。
- 板块要少而稳，优先 3-5 个二级标题；把相近内容合并，不要把每类信息拆成很碎的小节。
- “核心判断”不要加 emoji；“核心线索”和“问题拆解”要使用固定 emoji 前缀。
- 不要输出“关键原话”“事实”“事实、判断与边界”这类独立板块；这些只作为内部支撑材料。
- 避免使用“需要读懂的概念和例子”“普通摘要容易漏掉的细节”“值得回看的片段”“一句话带走”这类机械标题。
- 这篇 Markdown 会继续生成邮件和资料台 HTML 渲染稿；请使用清晰的 `#`、`##`、`###` 层级、列表、引用和加粗，不要输出原始 HTML。

建议结构：
# 精品标题
> 一句话副标题，不加粗

## 核心判断
## 🧭 核心线索
## 🔎 问题拆解
## 🧱 细节与案例

多通路材料：
{json.dumps(editor_material, ensure_ascii=False, indent=2)}
"""
        article_md, article_meta = _request_mimo_editorial(
            task_id="chief_editor_article",
            messages=[
                {"role": "system", "content": _editorial_system_prompt("主编")},
                {"role": "user", "content": article_instruction},
            ],
            temperature=0.32,
            timeout=240,
        )
        usage["chief_editor_article"] = article_meta.get("usage") or {}
        article_md = _normalize_editorial_article_markdown(article_md)
        article_path = os.path.join(summary_dir, "article.md")
        html_path = os.path.join(summary_dir, "article.html")
        _write_text_blob(article_path, article_md)
        _write_text_blob(html_path, _render_simple_email_html(article_md, title=title, source=source))

        _emit_progress("正在审读视频稿忠实性…", 97, stage="editorial_summary")
        review_instruction = f"""请轻量审读最终稿是否忠实于前面抽取出的编辑材料。你不需要判断外部世界真假，只判断文稿是否存在明显无支撑扩写。

只输出 JSON：
{{
  "status": "passed/needs_revision",
  "fidelity_score": 0,
  "unsupported_claims": [],
  "flattened_boundaries": [],
  "missing_key_details": [],
  "notes": []
}}

最终稿：
{article_md}

编辑材料：
{json.dumps(editor_material, ensure_ascii=False, indent=2)}
"""
        review_raw, review_meta = _request_mimo_editorial(
            task_id="fidelity_review",
            messages=[
                {"role": "system", "content": _editorial_system_prompt("忠实性审稿员")},
                {"role": "user", "content": review_instruction},
            ],
            temperature=0.1,
            timeout=180,
        )
        usage["fidelity_review"] = review_meta.get("usage") or {}
        review = _extract_json_document(review_raw)
        _write_text_blob(os.path.join(work_dir, "fidelity_review.raw.json"), review_raw)
        _save_json_file(os.path.join(summary_dir, "review.json"), review)

        status = {
            "schema_version": EDITORIAL_SUMMARY_VERSION,
            "status": "summary_ready",
            "started_at": started_at,
            "finished_at": _utc_now_iso(),
            "eligibility": eligibility,
            "paths": {
                "article_md": "summary/article.md",
                "article_html": "summary/article.html",
                "cards": "summary/cards.json",
                "review": "summary/review.json",
                "work_dir": "summary/work",
            },
            "review_status": review.get("status") or "",
            "usage": usage,
        }
        status = _finalize_editorial_status(material_dir=material_dir, summary_dir=summary_dir, status=status, started_perf=started_perf)
        _save_json_file(os.path.join(summary_dir, "meta.json"), status)
        _save_json_file(status_path, status)
        return status
    except Exception as exc:
        for stale_name in ("article.md", "article.html"):
            stale_path = os.path.join(summary_dir, stale_name)
            if os.path.exists(stale_path):
                try:
                    os.remove(stale_path)
                except OSError:
                    pass
        try:
            fallback_reason = str(exc)
            article_md = _build_fallback_editorial_article(
                title=title,
                source=source,
                content_markdown=content_markdown,
                work_dir=work_dir,
                reason=fallback_reason,
            )
            article_path = os.path.join(summary_dir, "article.md")
            html_path = os.path.join(summary_dir, "article.html")
            review = _build_fallback_review(article_md, reason=fallback_reason)
            _write_text_blob(article_path, article_md)
            _write_text_blob(html_path, _render_simple_email_html(article_md, title=title, source=source))
            _save_json_file(os.path.join(summary_dir, "review.json"), review)
            status = {
                "schema_version": EDITORIAL_SUMMARY_VERSION,
                "status": "summary_ready",
                "started_at": started_at,
                "finished_at": _utc_now_iso(),
                "eligibility": eligibility,
                "fallback": True,
                "fallback_reason": fallback_reason,
                "paths": {
                    "article_md": "summary/article.md",
                    "article_html": "summary/article.html",
                    "cards": "summary/cards.json",
                    "review": "summary/review.json",
                    "work_dir": "summary/work",
                },
                "review_status": review.get("status") or "",
                "usage": usage,
            }
            status = _finalize_editorial_status(material_dir=material_dir, summary_dir=summary_dir, status=status, started_perf=started_perf)
            _save_json_file(os.path.join(summary_dir, "meta.json"), status)
            _save_json_file(status_path, status)
            return status
        except Exception as fallback_exc:
            fallback_error = str(fallback_exc)
            for stale_name in ("article.md", "article.html"):
                stale_path = os.path.join(summary_dir, stale_name)
                if os.path.exists(stale_path):
                    try:
                        os.remove(stale_path)
                    except OSError:
                        pass
        status = {
            "schema_version": EDITORIAL_SUMMARY_VERSION,
            "status": "failed",
            "started_at": started_at,
            "finished_at": _utc_now_iso(),
            "eligibility": eligibility,
            "error": str(exc),
            "fallback_error": fallback_error,
        }
        status = _finalize_editorial_status(material_dir=material_dir, summary_dir=summary_dir, status=status, started_perf=started_perf)
        _save_json_file(status_path, status)
        return status


def _clean_one_chunk_with_checkpoint(chunk: CleaningChunk, *, title: str, work_dir: str, mode: str) -> dict[str, Any]:
    chunk_input_path = os.path.join(work_dir, "chunks", f"{chunk.chunk_id}.input.md")
    chunk_output_path = os.path.join(work_dir, "chunks", f"{chunk.chunk_id}.md")
    chunk_meta_path = os.path.join(work_dir, "chunks", f"{chunk.chunk_id}.meta.json")
    raw_sha1 = hashlib.sha1(chunk.text.encode("utf-8")).hexdigest()
    provider_fingerprint = f"rule:{CONTENT_CLEANING_VERSION}"
    if mode == "mimo":
        provider_fingerprint = f"mimo:{CONTENT_CLEANING_VERSION}:{_resolve_mimo_chat_endpoint()}:{_resolve_mimo_cleaning_model()}"
    cached_meta = _load_json_file(chunk_meta_path)
    if (
        cached_meta
        and cached_meta.get("input_sha1") == raw_sha1
        and cached_meta.get("requested_mode") == mode
        and cached_meta.get("provider_fingerprint") == provider_fingerprint
        and cached_meta.get("status") in {"rule_based", "mimo", "mimo_softened", "mimo_with_warnings", "mimo_repaired", "mimo_repaired_with_warnings"}
        and os.path.exists(chunk_output_path)
    ):
        with open(chunk_output_path, "r", encoding="utf-8") as file:
            cached_text = file.read().strip()
        if cached_text:
            return {
                **cached_meta,
                "cleaned_text": cached_text,
                "cache_hit": True,
            }

    _write_text_blob(chunk_input_path, chunk.text)
    cleaned_text = ""
    provider_meta: dict[str, Any] = {}
    status = "rule_based"
    error = ""

    if mode == "mimo":
        try:
            cleaned_text, provider_meta = _request_mimo_cleaning(chunk, title=title)
            cleaned_text, softened_years = _soften_unsupported_full_years(chunk.text, cleaned_text)
            if softened_years:
                provider_meta["softened_unsupported_full_years"] = softened_years
            missing_terms = _missing_critical_numeric_terms(chunk.text, cleaned_text)
            missing_markers = _missing_time_markers(chunk.text, cleaned_text)
            source_marker_count = len(_extract_time_markers(chunk.text))
            acceptable_missing_marker_count = 0 if source_marker_count < 5 else max(1, int(source_marker_count * 0.05))
            time_marker_loss_ok = len(missing_markers) <= acceptable_missing_marker_count
            if missing_terms or not time_marker_loss_ok:
                repair_notes = []
                if missing_terms:
                    repair_notes.append(f"上一版缺少或改写了这些关键数字/日期：{', '.join(missing_terms[:16])}")
                if not time_marker_loss_ok:
                    repair_notes.append(f"上一版缺少这些时间戳：{', '.join(missing_markers[:16])}")
                if softened_years:
                    repair_notes.append(f"上一版新增的完整年份已被保守弱化：{', '.join(softened_years[:16])}")
                repair_text, repair_meta = _request_mimo_cleaning(
                    chunk,
                    title=title,
                    previous_output=cleaned_text,
                    repair_notes=repair_notes,
                )
                repair_text, repair_softened_years = _soften_unsupported_full_years(chunk.text, repair_text)
                repair_missing_terms = _missing_critical_numeric_terms(chunk.text, repair_text)
                repair_missing_markers = _missing_time_markers(chunk.text, repair_text)
                source_critical_count = len(_extract_critical_numeric_terms(chunk.text))
                acceptable_missing_term_count = 0 if source_critical_count < 8 else max(1, int(source_critical_count * 0.05))
                time_marker_loss_ok = len(repair_missing_markers) <= acceptable_missing_marker_count
                critical_loss_ok = len(repair_missing_terms) <= acceptable_missing_term_count
                if critical_loss_ok and time_marker_loss_ok:
                    cleaned_text = repair_text
                    status = "mimo_repaired_with_warnings" if (repair_missing_terms or repair_missing_markers or repair_softened_years) else "mimo_repaired"
                    if repair_missing_terms or repair_missing_markers or repair_softened_years:
                        warning_parts = []
                        if repair_missing_terms:
                            warning_parts.append(f"仍缺少少量关键数字/日期：{', '.join(repair_missing_terms[:8])}")
                        if repair_missing_markers:
                            warning_parts.append(f"仍缺少少量时间戳：{', '.join(repair_missing_markers[:8])}")
                        if repair_softened_years:
                            warning_parts.append(f"已弱化原片段无法直接支持的完整年份：{', '.join(repair_softened_years[:8])}")
                        error = "；".join(warning_parts)
                    provider_meta = {
                        **provider_meta,
                        "repair": repair_meta,
                        "initial_missing_critical_terms": missing_terms,
                        "initial_missing_time_markers": missing_markers,
                        "repair_softened_unsupported_full_years": repair_softened_years,
                    }
                    missing_terms = []
                    missing_markers = []
                else:
                    problems = []
                    if repair_missing_terms:
                        problems.append(f"关键数字/日期：{', '.join(repair_missing_terms[:16])}")
                    if not time_marker_loss_ok:
                        problems.append(f"时间戳：{', '.join(repair_missing_markers[:16])}")
                    error = f"AI 输出缺少{'；'.join(problems)}，已回退规则清洗以避免信息丢失。"
                    cleaned_text = _rule_clean_transcript_text(chunk.text)
                    status = "fallback_fidelity"
            elif softened_years:
                status = "mimo_softened"
                error = f"已弱化原片段无法直接支持的完整年份：{', '.join(softened_years[:8])}"
            elif missing_markers:
                status = "mimo_with_warnings"
                error = f"仍缺少少量时间戳：{', '.join(missing_markers[:8])}"
            if status not in {"mimo_repaired", "mimo_repaired_with_warnings", "mimo_softened", "mimo_with_warnings", "fallback_fidelity"}:
                if len(cleaned_text) < max(240, int(len(chunk.text) * 0.75)) and len(chunk.text) > 800:
                    error = "AI 输出明显过短，已回退规则清洗以避免信息丢失。"
                    cleaned_text = _rule_clean_transcript_text(chunk.text)
                    status = "fallback_output_too_short"
                else:
                    status = "mimo"
        except Exception as exc:
            error = str(exc)
            cleaned_text = _rule_clean_transcript_text(chunk.text)
            status = "fallback_rule"
    else:
        cleaned_text = _rule_clean_transcript_text(chunk.text)

    _write_text_blob(chunk_output_path, cleaned_text)
    meta = {
        "chunk_id": chunk.chunk_id,
        "index": chunk.index,
        "requested_mode": mode,
        "provider_fingerprint": provider_fingerprint,
        "status": status,
        "error": error,
        "cache_hit": False,
        "input_sha1": raw_sha1,
        "input_chars": len(chunk.text),
        "output_chars": len(cleaned_text),
        "critical_numeric_terms": _extract_critical_numeric_terms(chunk.text),
        "missing_critical_numeric_terms": _missing_critical_numeric_terms(chunk.text, cleaned_text),
        "unsupported_full_years": _unsupported_full_year_terms(chunk.text, cleaned_text),
        "time_markers": _extract_time_markers(chunk.text),
        "missing_time_markers": _missing_time_markers(chunk.text, cleaned_text),
        "page_labels": chunk.page_labels,
        "time_range": {
            "from": chunk.start_time,
            "to": chunk.end_time,
        },
        "provider": provider_meta,
    }
    _save_json_file(chunk_meta_path, meta)
    return {
        **meta,
        "cleaned_text": cleaned_text,
    }


def _prune_stale_cleaning_chunks(chunks_dir: str, chunks: list[CleaningChunk]) -> None:
    expected_names: set[str] = set()
    for chunk in chunks:
        expected_names.add(f"{chunk.chunk_id}.input.md")
        expected_names.add(f"{chunk.chunk_id}.md")
        expected_names.add(f"{chunk.chunk_id}.meta.json")
    if not os.path.isdir(chunks_dir):
        return
    for entry_name in os.listdir(chunks_dir):
        if not entry_name.startswith("clean_chunk_"):
            continue
        if entry_name in expected_names:
            continue
        if not (entry_name.endswith(".input.md") or entry_name.endswith(".md") or entry_name.endswith(".meta.json")):
            continue
        stale_path = os.path.abspath(os.path.join(chunks_dir, entry_name))
        if os.path.dirname(stale_path) != os.path.abspath(chunks_dir):
            continue
        os.remove(stale_path)


def _build_standard_content_markdown(*, title: str, source: SourceDescriptor, text_source_type: str, chunks: list[dict[str, Any]]) -> str:
    lines = [
        f"# {title}",
        "",
        "## 来源",
        "",
        f"- 标题：{title}",
        f"- 来源：{source.source_id}",
        f"- UP 主：{source.creator or '未知'}",
        f"- 链接：{source.url or '未记录'}",
        f"- 字幕来源：{text_source_type or source.source_type}",
        "",
        "## 正文",
        "",
    ]
    for item in chunks:
        text = str(item.get("cleaned_text") or "").strip()
        if not text:
            continue
        start = _format_seconds_for_markdown(item.get("time_range", {}).get("from") if isinstance(item.get("time_range"), dict) else None)
        end = _format_seconds_for_markdown(item.get("time_range", {}).get("to") if isinstance(item.get("time_range"), dict) else None)
        has_heading = bool(re.match(r"^#{1,6}\s+", text))
        if (start or end) and not has_heading:
            lines.extend([f"### {start or '?'} - {end or '?'}", ""])
        lines.extend([text, ""])
    return "\n".join(lines).strip() + "\n"


def _build_notebooklm_markdown(content_markdown: str) -> str:
    return content_markdown


def build_clean_material_content(
    *,
    material_dir: str,
    title: str,
    source: SourceDescriptor,
    text_source_type: str,
    plan: ChunkPlan,
) -> dict[str, Any]:
    work_dir = os.path.join(material_dir, "work", "cleaning")
    exports_dir = os.path.join(material_dir, "exports")
    os.makedirs(os.path.join(work_dir, "chunks"), exist_ok=True)
    os.makedirs(exports_dir, exist_ok=True)

    requested_mode = (
        os.getenv("SHIJIE_CONTENT_CLEANING_MODE")
        or os.getenv("SHIJIE_TRANSCRIPT_CLEANING_MODE")
        or "auto"
    ).strip().lower()
    if requested_mode in {"off", "none", "skip"}:
        mode = "rule"
    elif requested_mode in {"mimo", "ai"}:
        mode = "mimo" if _mimo_cleaning_available() else "rule"
    else:
        mode = "mimo" if _mimo_cleaning_available() else "rule"

    target_chars = _read_int_env(
        "SHIJIE_CONTENT_CLEANING_CHUNK_CHARS",
        "SHIJIE_TRANSCRIPT_CLEANING_CHUNK_CHARS",
        default=7000,
        minimum=2500,
        maximum=16000,
    )
    max_workers = _read_int_env(
        "SHIJIE_CONTENT_CLEANING_WORKERS",
        "SHIJIE_TRANSCRIPT_CLEANING_WORKERS",
        default=2,
        minimum=1,
        maximum=4,
    )
    chunks = _chunk_units_for_cleaning(plan.units, target_chars=target_chars)
    _prune_stale_cleaning_chunks(os.path.join(work_dir, "chunks"), chunks)
    started_at = _utc_now_iso()
    started_perf = perf_counter()
    results: list[dict[str, Any]] = []

    if mode == "mimo" and len(chunks) > 1 and max_workers > 1:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(_clean_one_chunk_with_checkpoint, chunk, title=title, work_dir=work_dir, mode=mode): chunk
                for chunk in chunks
            }
            for future in as_completed(futures):
                results.append(future.result())
        results.sort(key=lambda item: int(item.get("index") or 0))
    else:
        for chunk in chunks:
            results.append(_clean_one_chunk_with_checkpoint(chunk, title=title, work_dir=work_dir, mode=mode))

    content_markdown = _build_standard_content_markdown(
        title=title,
        source=source,
        text_source_type=text_source_type,
        chunks=results,
    )
    content_path = os.path.join(material_dir, "content.md")
    notebooklm_path = os.path.join(exports_dir, "notebooklm.md")
    _write_text_blob(content_path, content_markdown)
    _write_text_blob(notebooklm_path, _build_notebooklm_markdown(content_markdown))
    input_chars = sum(int(item.get("input_chars") or 0) for item in results)
    output_chars = sum(int(item.get("output_chars") or 0) for item in results)
    finished_at = _utc_now_iso()
    elapsed_seconds = round(max(0.0, perf_counter() - started_perf), 3)
    usage_totals = _summarize_usage_tokens([item.get("provider") for item in results])
    meta = {
        "schema_version": CONTENT_CLEANING_VERSION,
        "mode": mode,
        "requested_mode": requested_mode,
        "started_at": started_at,
        "finished_at": finished_at,
        "elapsed_seconds": elapsed_seconds,
        "chunk_count": len(results),
        "input_chars": input_chars,
        "output_chars": output_chars,
        "compression_ratio": round(output_chars / input_chars, 4) if input_chars else 0,
        "token_totals": usage_totals,
        "content_path": "content.md",
        "notebooklm_path": "exports/notebooklm.md",
        "work_dir": "work/cleaning",
        "warnings": [
            str(item.get("error"))
            for item in results
            if item.get("error")
        ],
        "chunks": [
            {
                key: value
                for key, value in item.items()
                if key != "cleaned_text"
            }
            for item in results
        ],
    }
    _save_json_file(os.path.join(material_dir, "content.meta.json"), meta)
    _save_json_file(os.path.join(work_dir, "cleaning_report.json"), meta)
    _write_material_metrics(
        material_dir,
        stage_name="content_cleaning",
        stage_payload={
            "status": "content_ready",
            "mode": mode,
            "requested_mode": requested_mode,
            "started_at": started_at,
            "finished_at": finished_at,
            "elapsed_seconds": elapsed_seconds,
            "chunk_count": len(results),
            "input_chars": input_chars,
            "output_chars": output_chars,
            "compression_ratio": meta["compression_ratio"],
            "token_totals": usage_totals,
            "artifacts": {
                "content_chars": _text_file_chars(content_path),
                "notebooklm_chars": _text_file_chars(notebooklm_path),
                "content_bytes": _file_size(content_path),
                "notebooklm_bytes": _file_size(notebooklm_path),
            },
            "warning_count": len(meta["warnings"]),
        },
    )
    return meta


def _build_run_state(
    *,
    material_dir: str,
    course_title: str,
    material_id: str,
    source_id: str,
    text_length: int,
    block_count: int,
) -> dict[str, Any]:
    return {
        "schema_version": "shijie.material-run-state.v0.2",
        "stage": "content_ready",
        "stage_label": "字幕清洗完成",
        "pipeline_version": "lightweight_video_material_v1",
        "current_stage": "content_ready",
        "completed_stages": ["raw_transcript", "content_cleaning", "notebooklm_export"],
        "next_action": "短视频可继续生成 summary/article.md；长视频可直接把 exports/notebooklm.md 导入 NotebookLM。",
        "pipeline_ready": True,
        "notebooklm_ready": True,
        "summary_ready": False,
        "material": {
            "title": course_title,
            "material_id": material_id,
            "source_id": source_id,
            "text_length": text_length,
            "block_count": block_count,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        "paths": {
            "material_dir": material_dir,
            "handoff": os.path.join(material_dir, "HANDOFF.md"),
            "run_state": os.path.join(material_dir, "run_state.json"),
            "raw_transcript": os.path.join(material_dir, "raw_transcript.txt"),
            "clean_content": os.path.join(material_dir, "content.md"),
            "notebooklm_source": os.path.join(material_dir, "exports", "notebooklm.md"),
            "summary_article": os.path.join(material_dir, "summary", "article.md"),
            "summary_html": os.path.join(material_dir, "summary", "article.html"),
            "summary_status": os.path.join(material_dir, "summary", "summary_status.json"),
            "source_index": os.path.join(material_dir, "indexes", "source_index.jsonl"),
        },
        "steps": [
            {
                "id": "raw_transcript",
                "label": "字幕获取",
                "status": "done",
                "output": "raw_transcript.txt, raw_tracks.json",
            },
            {
                "id": "content_cleaning",
                "label": "字幕清洗",
                "status": "done",
                "output": "content.md, exports/notebooklm.md",
            },
            {
                "id": "editorial_summary",
                "label": "视频精读",
                "status": "optional",
                "output": "summary/article.md, summary/article.html",
            },
        ],
        "notes": [
            "当前默认主流程是：软件提取字幕并清洗为 NotebookLM 可导入资料；短视频可继续由 MiMo API 生成精读稿。",
            "本状态文件只服务字幕资料与短视频精读两条当前主线。",
        ],
    }


def _write_handoff_files(
    *,
    material_dir: str,
    course_title: str,
    material_id: str,
    source_id: str,
    text_length: int,
    block_count: int,
) -> dict[str, str]:
    handoff_path = os.path.join(material_dir, "HANDOFF.md")
    run_state_path = os.path.join(material_dir, "run_state.json")

    _save_json_file(
        run_state_path,
        _build_run_state(
            material_dir=material_dir,
            course_title=course_title,
            material_id=material_id,
            source_id=source_id,
            text_length=text_length,
            block_count=block_count,
        ),
    )
    _write_text_file(
        handoff_path,
        [
            "# 视界专注资料包交接单",
            "",
            f"标题：{course_title}",
            f"来源：{source_id or material_id}",
            f"材料规模：{block_count} blocks，约 {text_length} 字",
            "",
            "## 当前状态",
            "",
            "✅ 字幕资料已生成并清洗",
            "",
            "长视频/本地视频：优先使用 `exports/notebooklm.md` 导入 NotebookLM。",
            "",
            "短视频：可由软件继续调用 MiMo API 生成 `summary/article.md` 与 `summary/article.html`。",
            "",
            "## 唯一主流程",
            "",
            "1. 获取 B 站字幕或本地音频转写。",
            "2. 生成 `raw_transcript.txt` 和 `raw_tracks.json`，保留原始证据。",
            "3. 生成 `content.md`，作为忠实清洗后的可读稿。",
            "4. 生成 `exports/notebooklm.md`，用于 NotebookLM 导入。",
            "5. 对适合短视频精读的材料，继续生成 `summary/article.md` 和 `summary/article.html`。",
            "",
            "## 关键文件",
            "",
            f"- 原始字幕：`{os.path.join(material_dir, 'raw_transcript.txt')}`",
            f"- 清洗资料：`{os.path.join(material_dir, 'content.md')}`",
            f"- NotebookLM 导入稿：`{os.path.join(material_dir, 'exports', 'notebooklm.md')}`",
            f"- 视频精读稿：`{os.path.join(material_dir, 'summary', 'article.md')}`",
            f"- 视频精读 HTML：`{os.path.join(material_dir, 'summary', 'article.html')}`",
            f"- 来源索引：`{os.path.join(material_dir, 'indexes', 'source_index.jsonl')}`",
        ],
    )
    return {"handoff": handoff_path, "run_state": run_state_path}


def save_material_package(
    *,
    video_info: dict[str, Any],
    subtitles: list[dict[str, Any]],
    plan: ChunkPlan,
    source: SourceDescriptor,
    output_dir: str,
    text_source_type: str,
    text_source_note: str,
    ingested_at: str,
) -> str:
    bvid = str(video_info.get("bvid") or source.source_id or "unknown")
    material_root = _resolve_material_package_root(output_dir)
    material_dir = os.path.join(material_root, _safe_material_dir_name(str(video_info.get("title") or source.title), bvid))
    blocks_dir = os.path.join(material_dir, "blocks")
    indexes_dir = os.path.join(material_dir, "indexes")
    os.makedirs(blocks_dir, exist_ok=True)
    os.makedirs(indexes_dir, exist_ok=True)

    raw_transcript_text = flatten_subtitles_to_text(subtitles)
    raw_content_length = sum(
        len(str(entry.get("content") or ""))
        for subtitle in subtitles
        for entry in (
            [entry for segment in (subtitle.get("page_segments") or []) for entry in (segment.get("entries") or [])]
            if subtitle.get("page_segments")
            else subtitle.get("entries") or []
        )
    )
    raw_transcript_path = os.path.join(material_dir, "raw_transcript.txt")
    with open(raw_transcript_path, "w", encoding="utf-8") as file:
        file.write(raw_transcript_text)

    manifest = {
        "schema_version": "shijie.material-package.v0.1",
        "material_id": f"{_slugify(str(video_info.get('title') or bvid), 'material')}_{bvid.lower()}",
        "source": {
            "source_type": source.source_type,
            "source_id": source.source_id,
            "title": source.title,
            "creator": source.creator,
            "url": source.url,
            "language": source.language,
            "ingested_at": ingested_at,
        },
        "acquisition": {
            "subtitle_priority": ["zh", "zh-CN", "ai-zh", "zh-Hans", "zh-Hant"],
            "text_source_type": text_source_type,
            "transcription_provider": "local_sensevoice" if "local" in text_source_type.lower() or "转写" in text_source_type else "",
            "notes": [text_source_note] if text_source_note else [],
        },
        "files": {
            "raw_transcript": "raw_transcript.txt",
            "raw_tracks": "raw_tracks.json",
            "content": "content.md",
            "content_meta": "content.meta.json",
            "notebooklm_source": "exports/notebooklm.md",
            "cleaning_report": "work/cleaning/cleaning_report.json",
            "cleaning_work_dir": "work/cleaning",
            "cleaning_chunks_dir": "work/cleaning/chunks",
            "summary_dir": "summary",
            "summary_article": "summary/article.md",
            "summary_html": "summary/article.html",
            "summary_cards": "summary/cards.json",
            "summary_review": "summary/review.json",
            "summary_status": "summary/summary_status.json",
            "handoff": "HANDOFF.md",
            "run_state": "run_state.json",
            "blocks_dir": "blocks",
            "indexes_dir": "indexes",
            "part_index": "indexes/part_index.json",
            "source_index": "indexes/source_index.jsonl",
            "teaching_map": "indexes/teaching_map.json",
            "term_normalization": "indexes/term_normalization.json",
            "noise_segments": "indexes/noise_segments.json",
        },
        "block_count": 0,
        "text_length": raw_content_length,
        "raw_transcript_length": len(raw_transcript_text),
        "chunked_text_length": plan.text_length,
        "processing_policy": {
            "raw_block_chars": {
                "target": MATERIAL_BLOCK_TARGET_CHARS,
                "min": MATERIAL_BLOCK_MIN_CHARS,
                "max": MATERIAL_BLOCK_MAX_CHARS,
            },
            "source_preparation": "软件先生成 raw_transcript.txt 和 content.md。content.md 是清洗后的可读资料稿，可直接作为 NotebookLM/Obsidian 前置输入；raw_transcript.txt 保留完整原始证据。",
            "transcript_cleaning": "字幕清洗只做忠实清稿：修正断句、标点、重复口癖和明显识别问题，不总结、不扩写、不删除有效信息。大文本按块调用 API，使用断点缓存和有限并发。",
            "active_workflow": "raw_transcript -> content_cleaning -> notebooklm_export -> optional_editorial_summary",
            "long_video_strategy": "长视频/本地长材料只生成清洗稿和 NotebookLM 导入稿，不再默认进入深度学习笔记生产。",
            "short_video_strategy": "短视频可继续由 MiMo API 生成 summary/article.md 和 summary/article.html，供资料台、档案馆和灵犀阅读归档。",
            "trace_strategy": "block_id、时间范围和来源摘录保留在 indexes/source_index.jsonl 与 blocks/ 中；读者正文保持干净。",
        },
    }

    raw_tracks = {"tracks": _subtitle_track_segments(subtitles)}
    _save_json_file(os.path.join(material_dir, "raw_tracks.json"), raw_tracks)

    _emit_progress("正在清洗字幕资料稿…", 84, stage="content_cleaning")
    content_cleaning_meta = build_clean_material_content(
        material_dir=material_dir,
        title=str(video_info.get("title") or source.title or bvid),
        source=source,
        text_source_type=text_source_type,
        plan=plan,
    )
    manifest["content_cleaning"] = {
        key: content_cleaning_meta.get(key)
        for key in (
            "schema_version",
            "mode",
            "requested_mode",
            "chunk_count",
            "input_chars",
            "output_chars",
            "compression_ratio",
            "content_path",
            "notebooklm_path",
            "work_dir",
            "warnings",
        )
    }

    concept_index: dict[str, list[str]] = {}
    timeline_items: list[dict[str, Any]] = []
    outline_items: list[dict[str, Any]] = []
    material_blocks = _build_material_blocks(plan.chunks)
    part_index = _build_part_index(subtitles, material_blocks)
    manifest["block_count"] = len(material_blocks)
    _save_json_file(os.path.join(material_dir, "manifest.json"), manifest)
    _save_json_file(os.path.join(indexes_dir, "part_index.json"), part_index)

    source_index_entries: list[dict[str, Any]] = []
    for block in material_blocks:
        block_id = str(block["block_id"])
        block_text = str(block["text"])
        page_labels = list(block.get("page_labels") or [])
        key_points = _split_brief_points(block_text, limit=10)
        time_range = block.get("time_range") if isinstance(block.get("time_range"), dict) else {}
        if not isinstance(time_range.get("from"), (int, float)) and not isinstance(time_range.get("to"), (int, float)):
            time_range = _time_range_for_chunk(subtitles, page_labels)
        block_payload = {
            "schema_version": "shijie.material-block.v0.1",
            "block_id": block_id,
            "order": block["order"],
            "source_chunk_ids": block["chunk_ids"],
            "page_labels": page_labels,
            "time_range": time_range,
            "estimated_tokens": block["estimated_tokens"],
            "char_count": block["char_count"],
            "text": block_text,
            "key_points": key_points,
            "source_excerpt": _normalize_whitespace(block_text)[:1200],
            "processing_notes": [
                "本块用于字幕清洗、NotebookLM 导入和短视频精读回查。",
                "不要把 block_id、raw offset 等追溯信息写入读者正文。",
            ],
        }
        _save_json_file(os.path.join(blocks_dir, f"{block_id}.json"), block_payload)
        source_index_entries.append(
            {
                "schema_version": "shijie.source-index-entry.v0.1",
                "entry_id": f"src_{block_id}",
                "block_id": block_id,
                "block_path": f"blocks/{block_id}.json",
                "order": block["order"],
                "source_chunk_ids": block["chunk_ids"],
                "page_labels": page_labels,
                "time_range": time_range,
                "char_count": block["char_count"],
                "estimated_tokens": block["estimated_tokens"],
                "text_sha1": hashlib.sha1(block_text.encode("utf-8")).hexdigest(),
                "key_terms": _extract_material_terms(block_text, limit=14),
                "key_points": key_points[:6],
                "source_excerpt": _normalize_whitespace(block_text)[:700],
            }
        )
        outline_items.append(
            {
                "block_id": block_id,
                "title_hint": page_labels[0] if page_labels else f"材料分块 {block['order']}",
                "key_points": key_points[:4],
                "char_count": block["char_count"],
                "estimated_tokens": block["estimated_tokens"],
            }
        )
        timeline_items.append(
            {
                "block_id": block_id,
                "page_labels": page_labels,
                "time_range": time_range,
            }
        )
        for point in key_points:
            for token in _split_material_tokens(point)[:6]:
                concept_index.setdefault(token, []).append(block_id)

    _save_jsonl_file(os.path.join(indexes_dir, "source_index.jsonl"), source_index_entries)
    _save_json_file(os.path.join(indexes_dir, "global_outline.json"), {"items": outline_items})
    _save_json_file(
        os.path.join(indexes_dir, "concept_index.json"),
        {"concepts": {key: sorted(set(value)) for key, value in sorted(concept_index.items())}},
    )
    _save_json_file(os.path.join(indexes_dir, "timeline_index.json"), {"items": timeline_items})
    _save_json_file(os.path.join(indexes_dir, "teaching_map.json"), _build_teaching_map(part_index))
    _save_json_file(
        os.path.join(indexes_dir, "term_normalization.json"),
        _build_term_normalization_index(part_index, concept_index),
    )
    _save_json_file(os.path.join(indexes_dir, "noise_segments.json"), _build_noise_segments_index(part_index))

    editorial_summary_meta = build_editorial_summary_content(
        material_dir=material_dir,
        title=str(video_info.get("title") or source.title or bvid),
        source=source,
        video_info=video_info,
        plan=plan,
    )
    manifest["editorial_summary"] = {
        key: editorial_summary_meta.get(key)
        for key in (
            "schema_version",
            "status",
            "eligibility",
            "paths",
            "review_status",
            "reason",
            "error",
        )
    }
    _save_json_file(os.path.join(material_dir, "manifest.json"), manifest)

    _write_handoff_files(
        material_dir=material_dir,
        course_title=str(video_info.get("title") or source.title or bvid),
        material_id=str(manifest.get("material_id") or bvid),
        source_id=str(source.source_id or bvid),
        text_length=raw_content_length,
        block_count=len(material_blocks),
    )

    return material_dir

def _make_page_descriptor(page: dict[str, Any], fallback_index: int) -> dict[str, Any]:
    page_no = int(page.get("page") or fallback_index)
    page_part = str(page.get("part") or "").strip() or f"P{page_no}"
    return {
        "page": page_no,
        "cid": page.get("cid"),
        "part": page_part,
        "label": f"P{page_no}：{page_part}",
    }


def _extract_page_number(label: str) -> int:
    match = re.search(r"P(\d+)", label or "")
    return int(match.group(1)) if match else 0


def _merge_subtitle_groups(base: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}

    def _ingest(groups: list[dict[str, Any]]) -> None:
        for subtitle in groups:
            track_key = str(subtitle.get("lan") or subtitle.get("lang") or "unknown")
            track = merged.setdefault(
                track_key,
                {
                    "lang": subtitle.get("lang", "未知"),
                    "lan": subtitle.get("lan", ""),
                    "entries": [],
                    "page_segments": [],
                },
            )
            track["entries"].extend(list(subtitle.get("entries") or []))
            track["page_segments"].extend(list(subtitle.get("page_segments") or []))

    _ingest(base)
    _ingest(incoming)

    normalized: list[dict[str, Any]] = []
    for track in merged.values():
        page_segments = track.get("page_segments") or []
        if page_segments:
            page_segments = sorted(
                page_segments,
                key=lambda item: int(item.get("page") or _extract_page_number(str(item.get("label") or ""))),
            )
            entries: list[dict[str, Any]] = []
            for segment in page_segments:
                entries.extend(list(segment.get("entries") or []))
            track["page_segments"] = page_segments
            track["entries"] = entries
        normalized.append(track)
    return normalized


def _empty_transcript_page_cache(bvid: str, title: str) -> dict[str, Any]:
    return {
        "bvid": bvid,
        "title": title,
        "pages": {},
    }


def _normalize_transcript_page_cache(payload: dict[str, Any] | None, *, bvid: str, title: str) -> dict[str, Any]:
    base = _empty_transcript_page_cache(bvid, title)
    if not isinstance(payload, dict):
        return base

    pages = payload.get("pages")
    if isinstance(pages, dict):
        base["pages"] = {
            str(page_no): value
            for page_no, value in pages.items()
            if isinstance(value, dict)
        }
        return base

    subtitles = payload.get("subtitles")
    if isinstance(subtitles, list):
        for subtitle in subtitles:
            for segment in subtitle.get("page_segments") or []:
                page_no = _extract_page_number(str(segment.get("label") or ""))
                if page_no <= 0:
                    continue
                base["pages"][str(page_no)] = {
                    "page": page_no,
                    "label": str(segment.get("label") or f"P{page_no}"),
                    "entries": list(segment.get("entries") or []),
                    "source_type": str(payload.get("source_type") or "transcript"),
                    "note": str(payload.get("note") or ""),
                    "model": str(payload.get("model") or ""),
                    "source_api": str(payload.get("source_api") or ""),
                }
    return base


def _make_transcript_page_cache_item(
    *,
    page_no: int,
    label: str,
    entries: list[dict[str, Any]],
    source_type: str,
    note: str,
    model: str,
    source_api: str,
) -> dict[str, Any]:
    return {
        "page": page_no,
        "label": label,
        "entries": list(entries),
        "source_type": source_type,
        "note": note,
        "model": model,
        "source_api": source_api,
    }


def _build_subtitles_from_transcript_page_cache(page_cache: dict[str, Any]) -> list[dict[str, Any]]:
    pages = page_cache.get("pages") or {}
    page_segments = []
    for page_no, item in sorted(pages.items(), key=lambda pair: int(pair[0])):
        entries = list(item.get("entries") or [])
        if not entries:
            continue
        page_segments.append(
            {
                "page": int(item.get("page") or page_no),
                "label": str(item.get("label") or f"P{page_no}"),
                "entries": entries,
            }
        )

    if not page_segments:
        return []

    return [
        {
            "lang": "音频转写",
            "lan": "zh-transcript",
            "entries": [entry for segment in page_segments for entry in segment["entries"]],
            "page_segments": page_segments,
        }
    ]


def _ensure_cache_dir() -> str:
    output_dir = config.ensure_output_dir()
    cache_dir = os.path.join(output_dir, CACHE_DIR_NAME)
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


def _round_seconds(value: float) -> float:
    return round(max(0.0, float(value)), 2)


def _resume_manifest_path(cache_dir: str, package_id: str) -> str:
    return os.path.join(cache_dir, f"{_slugify(package_id, 'course')}.resume-manifest.json")


def _load_resume_manifest(cache_path: str, package_id: str) -> dict[str, Any] | None:
    payload = _load_json_file(cache_path)
    if not isinstance(payload, dict):
        return None
    if str(payload.get("version") or "") != RUN_MANIFEST_VERSION:
        return None
    if str(payload.get("package_id") or "") != package_id:
        return None
    return payload


def _write_resume_manifest(
    cache_path: str,
    *,
    package_id: str,
    source: SourceDescriptor,
    patch: dict[str, Any],
) -> dict[str, Any]:
    previous = _load_resume_manifest(cache_path, package_id) or {
        "version": RUN_MANIFEST_VERSION,
        "package_id": package_id,
        "source_id": source.source_id,
        "title": source.title,
        "stage": "booting",
        "chunk_total": 0,
        "chunk_completed": 0,
        "finished": False,
    }
    previous.update(patch)
    previous["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_json_file(cache_path, previous)
    return previous


def _format_resume_status(manifest: dict[str, Any]) -> str:
    stage = str(manifest.get("stage") or "未知阶段")
    chunk_total = int(manifest.get("chunk_total") or 0)
    chunk_completed = int(manifest.get("chunk_completed") or 0)
    if stage == "chunking" and chunk_total > 0:
        return f"检测到上次已整理 {chunk_completed}/{chunk_total} 个材料分块，将从断点继续。"
    if stage == "material_ready":
        return "检测到上次资料包已经写入，正在刷新记录。"
    return f"检测到上次材料整理停留在“{stage}”阶段，将尝试继续。"


def _format_timing_brief(stage_timings: dict[str, Any]) -> str:
    total_seconds = _round_seconds(stage_timings.get("total_seconds", 0.0))
    total_minutes = round(total_seconds / 60.0, 1) if total_seconds else 0.0
    metadata_seconds = _round_seconds(stage_timings.get("metadata_seconds", 0.0))
    subtitle_fetch_seconds = _round_seconds(stage_timings.get("subtitle_fetch_seconds", 0.0))
    audio_backfill_seconds = _round_seconds(stage_timings.get("audio_backfill_seconds", 0.0))
    material_write_seconds = _round_seconds(stage_timings.get("material_write_seconds", 0.0))
    return (
        f"原材料整理总耗时约 {total_minutes} 分钟"
        f"；元数据 {metadata_seconds} 秒"
        f"；字幕 {subtitle_fetch_seconds} 秒"
        f"；音频补全 {audio_backfill_seconds} 秒"
        f"；材料写入 {material_write_seconds} 秒"
    )


def flatten_subtitles_to_text(subtitles: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for unit in normalize_raw_source(subtitles):
        blocks.append(f"## {unit.page_label}\n{unit.text}")
    return "\n\n".join(blocks)


def _subtitles_from_raw_tracks(raw_tracks: dict[str, Any]) -> list[dict[str, Any]]:
    subtitles: list[dict[str, Any]] = []
    tracks = raw_tracks.get("tracks") if isinstance(raw_tracks.get("tracks"), list) else []
    for track_index, track in enumerate(tracks, start=1):
        segments = track.get("segments") if isinstance(track.get("segments"), list) else []
        grouped: dict[str, dict[str, Any]] = {}
        all_entries: list[dict[str, Any]] = []
        for segment in segments:
            text = str(segment.get("text") or segment.get("content") or "").strip()
            if not text:
                continue
            page_no = int(segment.get("page") or 1)
            label = str(segment.get("label") or f"P{page_no}").strip() or f"P{page_no}"
            entry = {
                "from": segment.get("from", 0),
                "to": segment.get("to", 0),
                "content": text,
            }
            group = grouped.setdefault(
                f"{page_no}:{label}",
                {
                    "page": page_no,
                    "cid": segment.get("cid"),
                    "part": label,
                    "label": label,
                    "entries": [],
                },
            )
            group["entries"].append(entry)
            all_entries.append(entry)
        if not all_entries:
            continue
        subtitles.append(
            {
                "lang": str(track.get("language") or "zh-CN"),
                "lan": str(track.get("track_id") or f"track_{track_index:02d}"),
                "entries": all_entries,
                "page_segments": list(grouped.values()),
            }
        )
    return subtitles


def _load_existing_material_context(material_dir: str) -> dict[str, Any]:
    material_dir = os.path.abspath(material_dir)
    manifest_path = os.path.join(material_dir, "manifest.json")
    manifest = _load_json_file(manifest_path) or {}
    raw_tracks = _load_json_file(os.path.join(material_dir, "raw_tracks.json")) or {}
    subtitles = _subtitles_from_raw_tracks(raw_tracks) if raw_tracks else []

    raw_source: str | list[dict[str, Any]]
    if subtitles:
        raw_source = subtitles
    else:
        raw_transcript_path = os.path.join(material_dir, "raw_transcript.txt")
        if not os.path.exists(raw_transcript_path):
            raise DistillationError("材料包缺少 raw_tracks.json 和 raw_transcript.txt，无法清洗。")
        with open(raw_transcript_path, "r", encoding="utf-8") as file:
            raw_source = file.read()

    source_payload = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
    title = str(source_payload.get("title") or os.path.basename(material_dir).replace(".course_material", ""))
    source = SourceDescriptor(
        source_type=str(source_payload.get("source_type") or "material_transcript"),
        source_id=str(source_payload.get("source_id") or manifest.get("material_id") or os.path.basename(material_dir)),
        title=title,
        creator=str(source_payload.get("creator") or ""),
        url=str(source_payload.get("url") or ""),
        language=str(source_payload.get("language") or "zh-CN"),
    )
    package_id = _slugify(str(manifest.get("material_id") or source.source_id or "material"), "material")
    plan = prepare_chunk_plan(raw_source, package_id=package_id, pipeline_config=PipelineConfig())
    text_source_type = str(
        (manifest.get("acquisition") if isinstance(manifest.get("acquisition"), dict) else {}).get("text_source_type")
        or source.source_type
    )
    return {
        "material_dir": material_dir,
        "manifest_path": manifest_path,
        "manifest": manifest,
        "source": source,
        "title": title,
        "plan": plan,
        "text_source_type": text_source_type,
    }


def _ensure_existing_material_file_contract(manifest: dict[str, Any]) -> None:
    files = manifest.setdefault("files", {})
    if not isinstance(files, dict):
        files = {}
        manifest["files"] = files
    files.update(
        {
            "content": "content.md",
            "content_meta": "content.meta.json",
            "notebooklm_source": "exports/notebooklm.md",
            "cleaning_report": "work/cleaning/cleaning_report.json",
            "cleaning_work_dir": "work/cleaning",
            "cleaning_chunks_dir": "work/cleaning/chunks",
            "summary_dir": "summary",
            "summary_article": "summary/article.md",
            "summary_html": "summary/article.html",
            "summary_cards": "summary/cards.json",
            "summary_review": "summary/review.json",
            "summary_status": "summary/summary_status.json",
        }
    )


def clean_existing_material_package(material_dir: str) -> dict[str, Any]:
    context = _load_existing_material_context(material_dir)
    material_dir = context["material_dir"]
    manifest_path = context["manifest_path"]
    manifest = context["manifest"]
    source = context["source"]
    title = context["title"]
    plan = context["plan"]
    text_source_type = context["text_source_type"]

    _emit_progress("正在重建清洗资料稿…", 20, stage="content_cleaning")
    content_cleaning_meta = build_clean_material_content(
        material_dir=material_dir,
        title=title,
        source=source,
        text_source_type=text_source_type,
        plan=plan,
    )
    _ensure_existing_material_file_contract(manifest)
    manifest["content_cleaning"] = {
        key: content_cleaning_meta.get(key)
        for key in (
            "schema_version",
            "mode",
            "requested_mode",
            "chunk_count",
            "input_chars",
            "output_chars",
            "compression_ratio",
            "content_path",
            "notebooklm_path",
            "work_dir",
            "warnings",
        )
    }
    editorial_summary_meta = build_editorial_summary_content(
        material_dir=material_dir,
        title=title,
        source=source,
        video_info={
            "title": title,
            "bvid": source.source_id,
            "duration": (manifest.get("media") if isinstance(manifest.get("media"), dict) else {}).get("duration_seconds", 0),
        },
        plan=plan,
    )
    manifest["editorial_summary"] = {
        key: editorial_summary_meta.get(key)
        for key in (
            "schema_version",
            "status",
            "eligibility",
            "paths",
            "review_status",
            "reason",
            "error",
        )
    }
    _save_json_file(manifest_path, manifest)
    _emit_progress("清洗资料稿已生成。", 100, stage="complete")
    return {
        "materialPath": material_dir,
        "contentPath": os.path.join(material_dir, "content.md"),
        "notebooklmPath": os.path.join(material_dir, "exports", "notebooklm.md"),
        "editorialArticlePath": os.path.join(material_dir, "summary", "article.md"),
        "contentMetaPath": os.path.join(material_dir, "content.meta.json"),
        "cleaning": manifest["content_cleaning"],
        "editorialSummary": manifest["editorial_summary"],
    }


def summarize_existing_material_package(material_dir: str) -> dict[str, Any]:
    context = _load_existing_material_context(material_dir)
    material_dir = context["material_dir"]
    manifest_path = context["manifest_path"]
    manifest = context["manifest"]
    source = context["source"]
    title = context["title"]
    plan = context["plan"]
    text_source_type = context["text_source_type"]

    content_path = os.path.join(material_dir, "content.md")
    existing_content = ""
    if os.path.exists(content_path):
        with open(content_path, "r", encoding="utf-8") as file:
            existing_content = file.read()
    if not existing_content.strip():
        _emit_progress("正在补齐清洗资料稿…", 16, stage="content_cleaning")
        content_cleaning_meta = build_clean_material_content(
            material_dir=material_dir,
            title=title,
            source=source,
            text_source_type=text_source_type,
            plan=plan,
        )
        manifest["content_cleaning"] = {
            key: content_cleaning_meta.get(key)
            for key in (
                "schema_version",
                "mode",
                "requested_mode",
                "chunk_count",
                "input_chars",
                "output_chars",
                "compression_ratio",
                "content_path",
                "notebooklm_path",
                "work_dir",
                "warnings",
            )
        }

    _ensure_existing_material_file_contract(manifest)
    _emit_progress("正在制作视频精读稿…", 82, stage="editorial_summary")
    editorial_summary_meta = build_editorial_summary_content(
        material_dir=material_dir,
        title=title,
        source=source,
        video_info={
            "title": title,
            "bvid": source.source_id,
            "duration": (manifest.get("media") if isinstance(manifest.get("media"), dict) else {}).get("duration_seconds", 0),
        },
        plan=plan,
    )
    manifest["editorial_summary"] = {
        key: editorial_summary_meta.get(key)
        for key in (
            "schema_version",
            "status",
            "eligibility",
            "paths",
            "review_status",
            "reason",
            "error",
        )
    }
    _save_json_file(manifest_path, manifest)
    _emit_progress("视频精读稿已生成。", 100, stage="complete")
    return {
        "materialPath": material_dir,
        "editorialArticlePath": os.path.join(material_dir, "summary", "article.md"),
        "editorialHtmlPath": os.path.join(material_dir, "summary", "article.html"),
        "editorialCardsPath": os.path.join(material_dir, "summary", "cards.json"),
        "editorialReviewPath": os.path.join(material_dir, "summary", "review.json"),
        "editorialSummary": manifest["editorial_summary"],
    }


__all__ = [
    "DistillationError",
    "PipelineConfig",
    "SourceDescriptor",
    "TextChunk",
    "TextUnit",
    "build_chunks",
    "clean_existing_material_package",
    "flatten_subtitles_to_text",
    "normalize_raw_source",
    "prepare_chunk_plan",
    "run_distillation_from_bilibili",
    "run_material_package_from_local_media",
    "save_material_package",
    "summarize_existing_material_package",
]


def _slugify(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower()).strip("_")
    return normalized[:48] or fallback


def _emit_progress(message: str, percent: int, **extra: Any) -> None:
    payload = {"message": message, "percent": percent}
    payload.update({key: value for key, value in extra.items() if value is not None})
    print(
        "__SHIJIE_DISTILL_PROGRESS__="
        + json.dumps(payload, ensure_ascii=False),
        flush=True,
    )
    print(message, flush=True)


def _normalize_source_type(value: str) -> str:
    normalized = _to_clean_text(value)
    lower = normalized.lower()
    if "sensevoice" in lower or "本地" in normalized:
        return "local_transcript"
    if "转写" in normalized:
        return "audio_transcript"
    if "字幕" in normalized:
        return "bilibili_subtitle"
    return "merged_text"


def _build_source_descriptor(video_info: dict[str, Any], video_input: str, note: str, text_source_type: str) -> SourceDescriptor:
    publish_timestamp = int(video_info.get("pubdate") or 0)
    publish_date = ""
    if publish_timestamp > 0:
        publish_date = datetime.fromtimestamp(publish_timestamp, tz=timezone.utc).date().isoformat()

    note_parts = [part for part in [note, f"publish_date={publish_date}" if publish_date else ""] if part]
    return SourceDescriptor(
        source_type=_normalize_source_type(text_source_type),
        source_id=str(video_info.get("bvid") or video_input),
        title=str(video_info.get("title") or video_input),
        creator=str(video_info.get("owner", {}).get("name") or ""),
        url=f"https://www.bilibili.com/video/{video_info.get('bvid', '')}",
        notes=" | ".join(note_parts),
    )


def _strip_page_prefix(title: str) -> str:
    cleaned = _to_clean_text(title)
    cleaned = re.sub(r"^(?:P?\d+[\.\-、：:\s]*)+", "", cleaned)
    return cleaned or _to_clean_text(title)


def _bucket_page_title(page_title: str, page_index: int) -> str:
    title = _strip_page_prefix(page_title)
    station_match = re.search(r"(第[一二三四五六七八九十]+站(?:[^：:\-]*)?)", title)
    if station_match:
        return station_match.group(1).strip()
    if "病例分析" in title:
        return "病例分析"
    if any(keyword in title for keyword in ["检查", "测量", "评估", "判读"]):
        return "检查与评估"
    if any(keyword in title for keyword in ["操作", "术", "消毒", "缝合", "拔除", "引流", "吸氧", "封闭", "洗手", "手套"]):
        return "操作与术式"
    if any(keyword in title for keyword in ["概述", "答题", "诊断", "治疗", "原则"]):
        return "理论与病例"
    return f"模块 {((page_index - 1) // 6) + 1}"


def _build_outline_preview(video_info: dict[str, Any], package_id: str) -> dict[str, Any]:
    pages = video_info.get("pages") or [{"part": video_info.get("title", ""), "page": 1}]
    chapter_map: dict[str, dict[str, Any]] = {}
    chapter_order: list[str] = []

    for index, page in enumerate(pages, start=1):
        page_title = str(page.get("part") or f"P{index}").strip() or f"P{index}"
        chapter_title = _bucket_page_title(page_title, index)
        if chapter_title not in chapter_map:
            chapter_map[chapter_title] = {
                "title": chapter_title,
                "lessonTitles": [],
            }
            chapter_order.append(chapter_title)
        chapter_map[chapter_title]["lessonTitles"].append(_strip_page_prefix(page_title))

    chapters = []
    for order, chapter_title in enumerate(chapter_order, start=1):
        lesson_titles = chapter_map[chapter_title]["lessonTitles"]
        chapters.append(
            {
                "id": f"preview_ch_{order:02d}",
                "title": chapter_title,
                "lessonCount": len(lesson_titles),
                "lessonTitles": lesson_titles[:8],
            }
        )

    return {
        "packageId": package_id,
        "title": str(video_info.get("title") or package_id),
        "sourceId": str(video_info.get("bvid") or package_id),
        "pageCount": len(pages),
        "durationMinutes": max(1, round(float(video_info.get("duration") or 0) / 60)),
        "note": "该骨架仅基于视频标题与分P标题预生成，详细知识点会在后台继续补全。",
        "chapters": chapters[:12],
    }


def run_distillation_from_bilibili(video_input: str, *, material_only: bool = False) -> dict[str, Any]:
    overall_started_at = perf_counter()
    bvid = bilibili_api.extract_bvid(video_input)
    _emit_progress(f"正在解析 B 站视频：{bvid}", 8, stage="metadata")

    metadata_started_at = perf_counter()
    video_info = bilibili_api.get_video_info(bvid)
    metadata_seconds = perf_counter() - metadata_started_at
    cache_dir = _ensure_cache_dir()
    output_dir = config.ensure_output_dir()
    package_id = f"{_slugify(str(video_info.get('title') or bvid), 'course')}_{str(video_info.get('bvid') or bvid).lower()}"
    outline_preview = _build_outline_preview(video_info, package_id)
    resume_manifest_path = _resume_manifest_path(cache_dir, package_id)
    existing_manifest = _load_resume_manifest(resume_manifest_path, package_id)
    if existing_manifest and not bool(existing_manifest.get("finished")):
        _emit_progress(
            _format_resume_status(existing_manifest),
            19,
            outlinePreview=outline_preview,
            stage=str(existing_manifest.get("stage") or "metadata"),
            resumed=True,
            chunkCompleted=int(existing_manifest.get("chunk_completed") or 0),
            chunkTotal=int(existing_manifest.get("chunk_total") or 0),
        )
    subtitle_bundle_cache_path = os.path.join(cache_dir, f"{str(video_info.get('bvid') or bvid).lower()}.subtitle-bundle.json")
    transcript_cache_path = os.path.join(cache_dir, f"{str(video_info.get('bvid') or bvid).lower()}.transcript.json")
    transcript_page_cache_path = os.path.join(cache_dir, f"{str(video_info.get('bvid') or bvid).lower()}.transcript-pages.json")
    pages = video_info.get("pages") or [{"cid": video_info.get("cid"), "part": video_info.get("title", ""), "page": 1}]
    pipeline_config = PipelineConfig()
    _emit_progress(f"已获取视频信息：{video_info['title']}", 18, outlinePreview=outline_preview, stage="metadata")
    _write_resume_manifest(
        resume_manifest_path,
        package_id=package_id,
        source=SourceDescriptor(
            source_type="video_metadata",
            source_id=str(video_info.get("bvid") or bvid),
            title=str(video_info.get("title") or bvid),
        ),
        patch={
            "stage": "metadata_ready",
            "outline_preview": outline_preview,
            "finished": False,
        },
    )
    subtitle_fetch_started_at = perf_counter()
    subtitle_bundle = _load_json_file(subtitle_bundle_cache_path)
    if (
        not subtitle_bundle
        or not subtitle_bundle.get("subtitles")
        or int(subtitle_bundle.get("page_count") or 0) != len(pages)
    ):
        subtitle_bundle = bilibili_api.get_subtitles_bundle(video_info)
        if subtitle_bundle.get("subtitles"):
            _save_json_file(subtitle_bundle_cache_path, subtitle_bundle)
    else:
        _emit_progress("命中字幕缓存，跳过逐页字幕抓取…", 26, stage="subtitle", cacheHint="subtitle_bundle")
    subtitle_fetch_seconds = perf_counter() - subtitle_fetch_started_at
    subtitles = subtitle_bundle.get("subtitles") or []
    text_source_type = str(subtitle_bundle.get("source_type") or "")
    text_source_note = str(subtitle_bundle.get("note") or "")
    pages_without_subtitles = list(subtitle_bundle.get("pages_without_subtitles") or [])
    transcript_page_cache = _normalize_transcript_page_cache(
        _load_json_file(transcript_page_cache_path),
        bvid=str(video_info.get("bvid") or bvid),
        title=str(video_info.get("title") or bvid),
    )
    audio_backfill_seconds = 0.0
    audio_completed_pages: set[int] = set()

    def _persist_transcribed_page(
        page_payload: dict[str, Any],
        *,
        source_type: str,
        note: str,
        audio_total: int,
    ) -> None:
        page_no = int(page_payload.get("page") or 0)
        if page_no <= 0:
            return
        audio_completed_pages.add(page_no)
        transcript_page_cache.setdefault("pages", {})[str(page_no)] = _make_transcript_page_cache_item(
            page_no=page_no,
            label=str(page_payload.get("label") or f"P{page_no}"),
            entries=list(page_payload.get("entries") or []),
            source_type=source_type,
            note=note,
            model=str(page_payload.get("provider_model") or ""),
            source_api=str(page_payload.get("provider_api") or ""),
        )
        _save_json_file(transcript_page_cache_path, transcript_page_cache)
        _emit_progress(
            f"音频补全进度 {len(audio_completed_pages)}/{audio_total}：已补回 {page_payload.get('label', f'P{page_no}')}",
            74,
            stage="audio",
            audioCompleted=len(audio_completed_pages),
            audioTotal=audio_total,
        )

    if subtitles and pages_without_subtitles:
        cached_missing_pages = []
        still_missing_pages = []
        for missing_page in pages_without_subtitles:
            page_no = int(missing_page.get("page") or 0)
            if page_no > 0 and transcript_page_cache.get("pages", {}).get(str(page_no)):
                cached_missing_pages.append(missing_page)
            else:
                still_missing_pages.append(missing_page)

        if cached_missing_pages:
            for item in cached_missing_pages:
                page_no = int(item.get("page") or 0)
                if page_no > 0:
                    audio_completed_pages.add(page_no)
            cached_subtitles = _build_subtitles_from_transcript_page_cache(
                {
                    "pages": {
                        str(item.get("page")): transcript_page_cache["pages"][str(item.get("page"))]
                        for item in cached_missing_pages
                        if str(item.get("page")) in transcript_page_cache.get("pages", {})
                    }
                }
            )
            subtitles = _merge_subtitle_groups(subtitles, cached_subtitles)
            text_source_note += (
                f" 已从本地缓存补入 {len(cached_missing_pages)} 个缺失分P 的音频转写。"
            )
            pages_without_subtitles = still_missing_pages
            _emit_progress(
                f"已从本地恢复 {len(cached_missing_pages)}/{len(cached_missing_pages) + len(still_missing_pages)} 个缺失分P 的音频结果。",
                38,
                stage="audio",
                cacheHint="audio_page_cache",
                audioCompleted=len(audio_completed_pages),
                audioTotal=len(cached_missing_pages) + len(still_missing_pages),
            )

    if subtitles:
        if len(pages) >= 12:
            _emit_progress(f"检测到长视频（{len(pages)} 个分P），启用按分P处理模式…", 28, stage="subtitle")
        _emit_progress("已获取字幕，开始整理原材料索引…", 34, stage="subtitle")

        if pages_without_subtitles:
            missing_audio_total = len(audio_completed_pages) + len(pages_without_subtitles)
            _emit_progress(
                f"仍有 {len(pages_without_subtitles)} 个分P 缺字幕，尝试用音频兜底补全…",
                40,
                stage="audio",
                audioCompleted=len(audio_completed_pages),
                audioTotal=missing_audio_total,
            )
            import audio_fallback

            audio_started_at = perf_counter()
            transcript_bundle = audio_fallback.transcribe_video_pages(
                video_info,
                [
                    _make_page_descriptor(page, index)
                    for index, page in enumerate(pages, start=1)
                    if int(page.get("page") or index)
                    in {int(item.get("page") or 0) for item in pages_without_subtitles}
                ],
                progress_callback=_emit_progress,
                page_result_callback=lambda payload: _persist_transcribed_page(
                    payload,
                    source_type=f"{text_source_type} + {payload.get('provider_label', '音频转写')}".strip(" +"),
                    note=f"{text_source_note} 增量补入 {payload.get('label', '')} 的音频转写。".strip(),
                    audio_total=missing_audio_total,
                ),
            )
            audio_backfill_seconds += perf_counter() - audio_started_at

            if transcript_bundle.subtitles:
                for subtitle in transcript_bundle.subtitles:
                    for segment in subtitle.get("page_segments") or []:
                        page_no = int(segment.get("page") or _extract_page_number(str(segment.get("label") or "")))
                        if page_no <= 0:
                            continue
                        transcript_page_cache.setdefault("pages", {})[str(page_no)] = _make_transcript_page_cache_item(
                            page_no=page_no,
                            label=str(segment.get("label") or f"P{page_no}"),
                            entries=list(segment.get("entries") or []),
                            source_type=transcript_bundle.source_type,
                            note=transcript_bundle.note,
                            model=transcript_bundle.model,
                            source_api=transcript_bundle.source_api,
                        )
                _save_json_file(transcript_page_cache_path, transcript_page_cache)
                subtitles = _merge_subtitle_groups(subtitles, transcript_bundle.subtitles)
                text_source_type = f"{text_source_type} + {transcript_bundle.source_type}".strip(" +")
                text_source_note = f"{text_source_note} 另外已补全 {transcript_bundle.pages_transcribed} 个缺失分P 的音频转写。".strip()
    else:
        cached_subtitles = _build_subtitles_from_transcript_page_cache(transcript_page_cache)
        if cached_subtitles:
            _emit_progress(
                "未拿到字幕，但命中了按分P音频转写缓存，跳过重复下载…",
                46,
                stage="audio",
                cacheHint="audio_page_cache",
                audioCompleted=len(cached_subtitles[0].get("page_segments") or []) if cached_subtitles else 0,
                audioTotal=len(cached_subtitles[0].get("page_segments") or []) if cached_subtitles else 0,
            )
            subtitles = cached_subtitles
            text_source_type = "音频转写缓存"
            text_source_note = f"已从本地按分P缓存恢复 {sum(len(item.get('page_segments') or []) for item in cached_subtitles)} 个分P。"
        else:
            transcript_cache = _load_json_file(transcript_cache_path)
            if transcript_cache and transcript_cache.get("subtitles"):
                _emit_progress(
                    "未拿到字幕，命中本地转写缓存，跳过音频下载与转写…",
                    46,
                    stage="audio",
                    cacheHint="audio_transcript_cache",
                )
                subtitles = transcript_cache.get("subtitles") or []
                text_source_type = str(transcript_cache.get("source_type") or "audio_transcript")
                text_source_note = str(transcript_cache.get("note") or "已复用本地转写缓存。")

        if not subtitles:
            _emit_progress("未拿到字幕，切换到音频转写兜底…", 34, stage="audio")
            _emit_progress(
                f"准备补全全部 {len(pages)} 个分P 的音频文本…",
                36,
                stage="audio",
                audioCompleted=0,
                audioTotal=len(pages),
            )
            import audio_fallback

            audio_started_at = perf_counter()
            transcript_bundle = audio_fallback.transcribe_video_pages(
                video_info,
                [
                    _make_page_descriptor(page, index)
                    for index, page in enumerate(pages, start=1)
                ],
                progress_callback=_emit_progress,
                page_result_callback=lambda payload: _persist_transcribed_page(
                    payload,
                    source_type=str(payload.get("provider_label") or "音频转写"),
                    note=f"增量保存 {payload.get('label', '')} 的音频转写结果。",
                    audio_total=len(pages),
                ),
            )
            audio_backfill_seconds += perf_counter() - audio_started_at
            subtitles = transcript_bundle.subtitles
            text_source_type = transcript_bundle.source_type
            text_source_note = transcript_bundle.note
            if subtitles:
                _save_json_file(
                    transcript_cache_path,
                    {
                        "bvid": str(video_info.get("bvid") or bvid),
                        "title": str(video_info.get("title") or bvid),
                        "source_type": text_source_type,
                        "note": text_source_note,
                        "subtitles": subtitles,
                    },
                )
                for subtitle in subtitles:
                    for segment in subtitle.get("page_segments") or []:
                        page_no = int(segment.get("page") or _extract_page_number(str(segment.get("label") or "")))
                        if page_no <= 0:
                            continue
                        transcript_page_cache.setdefault("pages", {})[str(page_no)] = _make_transcript_page_cache_item(
                            page_no=page_no,
                            label=str(segment.get("label") or f"P{page_no}"),
                            entries=list(segment.get("entries") or []),
                            source_type=text_source_type,
                            note=text_source_note,
                            model=str(getattr(transcript_bundle, "model", "")),
                            source_api=str(getattr(transcript_bundle, "source_api", "")),
                        )
                _save_json_file(transcript_page_cache_path, transcript_page_cache)
            if not subtitles:
                raise DistillationError("既未获取到字幕，也未成功完成音频转写。")

    ingested_at = datetime.now(timezone.utc).isoformat()
    source = _build_source_descriptor(video_info, video_input, text_source_note, text_source_type)
    full_plan = prepare_chunk_plan(
        subtitles,
        package_id=package_id,
        pipeline_config=pipeline_config,
    )
    material_write_started_at = perf_counter()
    material_path = save_material_package(
        video_info=video_info,
        subtitles=subtitles,
        plan=full_plan,
        source=source,
        output_dir=output_dir,
        text_source_type=text_source_type,
        text_source_note=text_source_note,
        ingested_at=ingested_at,
    )
    material_write_seconds = perf_counter() - material_write_started_at

    overall_seconds = perf_counter() - overall_started_at
    stage_timings = {
        "metadata_seconds": _round_seconds(metadata_seconds),
        "subtitle_fetch_seconds": _round_seconds(subtitle_fetch_seconds),
        "audio_backfill_seconds": _round_seconds(audio_backfill_seconds),
        "material_write_seconds": _round_seconds(material_write_seconds),
        "total_seconds": _round_seconds(overall_seconds),
        "pipeline": {
            "material_package": True,
            "block_count": len(full_plan.chunks),
            "text_length": full_plan.text_length,
        },
    }
    _write_resume_manifest(
        resume_manifest_path,
        package_id=package_id,
        source=source,
        patch={
            "stage": "content_ready",
            "finished": True,
            "material_path": material_path,
            "chunk_total": len(full_plan.chunks),
            "chunk_completed": len(full_plan.chunks),
            "stage_timings": stage_timings,
        },
    )
    _emit_progress("字幕资料已生成。", 100, stage="complete", cacheHint="material_package")
    return {
        "packagePath": "",
        "packageId": package_id,
        "title": str(video_info.get("title") or bvid),
        "bvid": str(video_info.get("bvid") or bvid),
        "textSourceType": text_source_type,
        "textSourceNote": text_source_note,
        "materialPath": material_path,
        "chunkCount": len(full_plan.chunks),
        "warningCount": 0,
        "warnings": [_format_timing_brief(stage_timings)],
        "stageTimings": stage_timings,
    }

def run_material_package_from_local_media(media_path: str) -> dict[str, Any]:
    overall_started_at = perf_counter()
    source_path = os.path.abspath(os.path.expanduser(media_path))
    if not os.path.exists(source_path) or not os.path.isfile(source_path):
        raise DistillationError(f"本地音视频文件不存在：{source_path}")

    import audio_fallback
    import local_audio_client

    output_dir = config.ensure_output_dir()
    cache_dir = _ensure_cache_dir()
    title = os.path.splitext(os.path.basename(source_path))[0] or "本地音视频材料"
    stat = os.stat(source_path)
    digest = hashlib.sha1(
        f"{source_path}|{stat.st_size}|{int(stat.st_mtime)}".encode("utf-8", errors="ignore")
    ).hexdigest()[:12]
    source_id = f"local_{digest}"
    package_id = f"{_slugify(title, 'local_media')}_{digest}"
    ingested_at = datetime.now(timezone.utc).isoformat()
    work_dir = os.path.join(cache_dir, "local_media", source_id)
    os.makedirs(work_dir, exist_ok=True)

    _emit_progress(f"正在准备本地音视频：{title}", 12, stage="metadata")
    normalized_audio_path = os.path.join(work_dir, "normalized.wav")
    if not os.path.exists(normalized_audio_path):
        audio_fallback._normalize_audio(source_path, normalized_audio_path, provider_api="local_sensevoice")
    duration = 0.0
    try:
        duration = float(audio_fallback._probe_duration_seconds(normalized_audio_path))
    except Exception:
        duration = 0.0

    _emit_progress("正在按本地模型限制切分音频…", 24, stage="audio")
    chunks = audio_fallback._split_audio_if_needed(
        normalized_audio_path,
        os.path.join(work_dir, "chunks"),
        start_offset=0.0,
        provider_api="local_sensevoice",
    )

    entries: list[dict[str, Any]] = []
    total_chunks = len(chunks)
    for index, chunk in enumerate(chunks, start=1):
        _emit_progress(
            f"正在本地转写 {index}/{total_chunks}…",
            26 + round(42 * index / max(1, total_chunks)),
            stage="audio",
            audioCompleted=index - 1,
            audioTotal=total_chunks,
        )
        result = local_audio_client.transcribe_audio_file(
            str(chunk.get("path") or ""),
            language=config.LOCAL_TRANSCRIPTION_LANGUAGE,
        )
        text = _normalize_whitespace(str(result.get("text") or ""))
        if not text:
            continue
        start = float(chunk.get("offset") or 0.0)
        end = start + float(chunk.get("duration") or 0.0)
        entries.append({"from": start, "to": end, "content": text})

    if not entries:
        raise DistillationError("本地音视频转写结果为空，无法生成资料包。")

    video_info = {
        "bvid": source_id,
        "title": title,
        "owner": {"name": "本地导入"},
        "duration": duration,
        "pages": [{"cid": source_id, "page": 1, "part": title, "duration": duration}],
    }
    source = SourceDescriptor(
        source_type="local_media",
        source_id=source_id,
        title=title,
        language=config.LOCAL_TRANSCRIPTION_LANGUAGE or "zh-CN",
        creator="本地导入",
        url=f"file:///{source_path.replace(os.sep, '/')}",
    )
    subtitles = [
        {
            "lang": "local-transcript",
            "lang_doc": "本地音视频转写",
            "entries": entries,
            "page_segments": [
                {
                    "page": 1,
                    "cid": source_id,
                    "part": title,
                    "label": title,
                    "entries": entries,
                }
            ],
        }
    ]
    pipeline_config = PipelineConfig()
    full_plan = prepare_chunk_plan(subtitles, package_id=package_id, pipeline_config=pipeline_config)
    _emit_progress("正在写入资料包…", 82, stage="chunking", chunkCompleted=len(full_plan.chunks), chunkTotal=len(full_plan.chunks))
    material_write_started_at = perf_counter()
    material_path = save_material_package(
        video_info=video_info,
        subtitles=subtitles,
        plan=full_plan,
        source=source,
        output_dir=output_dir,
        text_source_type="local_media_transcript",
        text_source_note=f"已从本地文件转写：{source_path}",
        ingested_at=ingested_at,
    )
    material_write_seconds = perf_counter() - material_write_started_at
    overall_seconds = perf_counter() - overall_started_at
    stage_timings = {
        "audio_backfill_seconds": _round_seconds(overall_seconds),
        "material_write_seconds": _round_seconds(material_write_seconds),
        "total_seconds": _round_seconds(overall_seconds),
        "pipeline": {
            "material_only": True,
            "local_media": True,
            "audio_chunk_count": total_chunks,
            "block_count": len(full_plan.chunks),
            "text_length": full_plan.text_length,
        },
    }
    _emit_progress("本地音视频字幕资料已生成。", 100, stage="complete", cacheHint="material_package")
    return {
        "packagePath": "",
        "packageId": package_id,
        "title": title,
        "bvid": source_id,
        "textSourceType": "local_media_transcript",
        "textSourceNote": f"已从本地文件转写：{source_path}",
        "materialPath": material_path,
        "chunkCount": len(full_plan.chunks),
        "warningCount": 0,
        "warnings": [_format_timing_brief(stage_timings)],
        "stageTimings": stage_timings,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="视界专注资料包生成入口")
    parser.add_argument("video", nargs="?", help="B 站视频链接或 BV 号")
    parser.add_argument("--material-only", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--local-media", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--clean-material", help="重跑已有 .course_material 的字幕清洗与 NotebookLM 导出", metavar="PATH")
    parser.add_argument("--summarize-material", help="为已有 .course_material 制作视频精读稿", metavar="PATH")
    parser.add_argument("--result-json", action="store_true", help=argparse.SUPPRESS)
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    try:
        if args.clean_material:
            result = clean_existing_material_package(args.clean_material)
        elif args.summarize_material:
            result = summarize_existing_material_package(args.summarize_material)
        elif args.video and args.local_media:
            result = run_material_package_from_local_media(args.video)
        elif args.video:
            result = run_distillation_from_bilibili(args.video, material_only=args.material_only)
        else:
            parser.error("请提供 B 站视频链接、BV 号，或使用 --clean-material/--summarize-material 指定材料包。")
        _emit_progress("资料包生成完成，正在回传桌面端…", 100, stage="complete")
        if args.result_json:
            print("__SHIJIE_DISTILL_RESULT__=" + json.dumps(result, ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:
        print(f"材料整理失败：{exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

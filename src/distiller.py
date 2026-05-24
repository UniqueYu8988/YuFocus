# -*- coding: utf-8 -*-
"""Local material organizer for Codex learning-note making.

This module is being kept as the local-first material pipeline: it fetches
subtitles/transcripts, cleans and chunks them, and prepares a Codex 原材料包.
It must not be treated as the runtime teacher or the final source of learning
quality. High-quality learning notes are produced later by Codex, then imported
into the desktop learning desk.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import shutil
from time import perf_counter
import re
import sys
from typing import Any, Iterable
import zipfile

import bilibili_api
import config


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CJK_CHAR_PATTERN = re.compile(r"[\u3400-\u9fff]")
WORD_PATTERN = re.compile(r"[A-Za-z0-9_]+")
CACHE_DIR_NAME = "cache"
MATERIAL_BLOCK_TARGET_CHARS = max(10_000, int(os.getenv("ONBOARD_MATERIAL_BLOCK_TARGET_CHARS", "20000") or "20000"))
MATERIAL_BLOCK_MIN_CHARS = max(4_000, int(os.getenv("ONBOARD_MATERIAL_BLOCK_MIN_CHARS", "10000") or "10000"))
MATERIAL_BLOCK_MAX_CHARS = max(
    MATERIAL_BLOCK_TARGET_CHARS,
    int(os.getenv("ONBOARD_MATERIAL_BLOCK_MAX_CHARS", "30000") or "30000"),
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
        "purpose": "给 Codex 的分 P 导航层：先看这里判断主题、操作密度、噪音和建议合并方式，再按需回读 blocks/raw_transcript。",
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
                    "reason": "相邻分 P 主题/课型接近，适合由 Codex 判断是否合并为同一章节或连续学习小节。",
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
                record["reason"] = "工具、模型、平台、API 或版本相关术语，写学习笔记时应保守表述或核验官方文档。"

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
                "reason": "来自概念索引；如为工具/API/平台名，写学习笔记时需注意版本敏感。",
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
        "purpose": "给 GPT/Codex 的术语导航层。它不是权威词典，只提示高频术语、疑似版本敏感词和需要核验的工具/API 名称。",
        "terms": terms[:160],
        "verification_candidates": [item for item in terms if item.get("needs_verification")][:60],
    }


def _build_noise_segments_index(part_index: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "shijie.noise-segments.v0.1",
        "purpose": "提示 GPT/Codex 写学习笔记时可降权或跳过的片头片尾、互动话术、推广话术和低信息价值片段。",
        "items": [
            {
                "part_id": item.get("part_id"),
                "label": item.get("label"),
                "noise_level": item.get("noise_level"),
                "noise_reasons": item.get("noise_reasons") or [],
                "suggestion": "学习笔记可降权处理；除非这些内容承载真实观点、步骤或案例，否则不要单独展开。",
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
        "purpose": "粗粒度学习笔记导航。Codex 可以用它快速判断哪些分 P 更适合展开、哪些适合合并、哪些只作为素材证据。",
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


def _build_initial_trace_map(*, material_id: str, artifact: str) -> dict[str, Any]:
    return {
        "schema_version": "shijie.trace-map.v0.1",
        "material_id": material_id,
        "artifact": artifact,
        "status": "pending_codex_trace",
        "purpose": "旁路追溯表：把最终学习产物的可见章节/节点映射回 source_index 与 blocks；不要写入学生正文。",
        "links": [],
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


def _project_file(*parts: str) -> str:
    return os.path.join(config.PROJECT_ROOT, *parts)


def _copy_project_file_if_exists(source_parts: tuple[str, ...], target_path: str) -> bool:
    source_path = _project_file(*source_parts)
    if not os.path.exists(source_path):
        return False
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    shutil.copyfile(source_path, target_path)
    return True


def _write_text_file(file_path: str, lines: list[str]) -> str:
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as file:
        file.write("\n".join(lines).strip() + "\n")
    return file_path


def _write_authoring_workspace(material_dir: str, *, course_title: str, material_id: str) -> dict[str, str]:
    authoring_dir = os.path.join(material_dir, "authoring")
    schemas_dir = os.path.join(material_dir, "schemas")
    os.makedirs(authoring_dir, exist_ok=True)
    os.makedirs(schemas_dir, exist_ok=True)

    codex_goal_v8_path = os.path.join(authoring_dir, "codex-goal-content-synthesis-v8.md")
    authoring_doc_path = os.path.join(authoring_dir, "content-synthesis-authoring.md")
    readonly_audit_doc_path = os.path.join(authoring_dir, "readonly-synthesis-audit.md")
    codex_copy_path = os.path.join(authoring_dir, "02_start_codex_synthesis.md")
    audit_copy_path = os.path.join(authoring_dir, "03_readonly_synthesis_audit.md")
    plan_path = os.path.join(material_dir, "content_draft", "synthesis_plan.json")

    _copy_project_file_if_exists(("src", "schemas", "content_synthesis_plan.schema.json"), os.path.join(schemas_dir, "content_synthesis_plan.schema.json"))
    _copy_project_file_if_exists(("docs", "content-synthesis-authoring.md"), authoring_doc_path)
    _copy_project_file_if_exists(("docs", "prompts", "codex-goal-content-synthesis-v8.md"), codex_goal_v8_path)
    _copy_project_file_if_exists(("docs", "prompts", "readonly-synthesis-audit.md"), readonly_audit_doc_path)

    if not os.path.exists(codex_goal_v8_path):
        _write_text_file(
            codex_goal_v8_path,
            [
                "# Codex Goal 学习笔记任务 v8",
                "",
                "你是视界专注主生产窗口。请按 v8 流水线生成学习笔记：material_ready -> knowledge_tree_ready -> coverage_ready -> dossier_ready -> partial_learning_notes -> learning_notes_ready。长材料每轮只推进一个阶段，先搭知识树，再做 topic 覆盖，再写正文。",
                "",
                "核心原则：先读 run_state 决定阶段；knowledge_tree_ready 必须先确定主干、分支、子节点、跨章连接和 presentation_policy；coverage_ready 后必须回读 blocks 写 block_reread_ledger 和 section_dossiers；短材料可用 # 标题 + 少量 ## 学习小节，中长材料才使用 ## 大章节和 ### 完整小节。",
            ],
        )

    codex_copy_text = [
        f"/goal 在 `{material_dir}` 执行 `authoring/codex-goal-content-synthesis-v8.md`，按 v8 知识树优先流水线处理《{course_title}》；目标是产出生产侧完整的学习笔记包。Codex 负责把 `run_state.stage` 推进到 `learning_notes_ready`；`importable`、`pipeline_ready` 和 `release_ready` 保持由软件 validator 接管。",
        "",
        "先读取根目录 `run_state.json` 和 `content_draft/work/run_state.json`：这是单次复制入口，同一个 Goal 应自动多轮推进；每一轮最多只过一个阶段闸门。`material_ready` 先到 `knowledge_tree_ready`；`knowledge_tree_ready` 再到 `coverage_ready`；`coverage_ready` 再到 `dossier_ready`；`dossier_ready` 或 `partial_learning_notes` 每轮只深写 1-2 个知识树分支，直到 `learning_notes_ready`。阶段完成不是 Goal 完成，不要跳阶段。",
        "",
        "软件已生成 `indexes/source_index.jsonl`。最终收口时请把正文和导图来源写入 `indexes/learning_notes_trace.json`、`indexes/chapter_mindmap_trace.json`；学生正文保持干净，不写 block/source/debug 信息。",
        "",
        "若材料超过 100000 字、超过 8 blocks，或属于考试/医学/教程等密集材料，即使用户希望直接完成，也只在当前轮推进当前阶段并留下下一轮继续入口；coverage、dossier、draft、导图和 validator 状态分层推进。",
    ]
    _write_text_file(codex_copy_path, codex_copy_text)

    audit_copy_text = [
        "# 只读学习笔记审计",
        "",
        "```text",
        "请担任“视界专注”的只读学习笔记审计 Goal。你的任务是审核学习笔记和章节思维导图质量，不是制作或修改正文。",
        "",
        "原材料包路径：",
        material_dir,
        "",
        "只允许读取 canonical 学习笔记文件，并只允许写入：",
        os.path.join(material_dir, "content_draft", "review_exports"),
        "",
        "禁止修改：",
        "- `content_draft/synthesis_plan.json`",
        "- `content_draft/learning_notes.md`",
        "- `content_draft/chapter_mindmap.md`",
        "",
        "请读取 `authoring/readonly-synthesis-audit.md`、`authoring/content-synthesis-authoring.md`、`content_draft/synthesis_plan.json`、`content_draft/learning_notes.md`、`content_draft/work/evidence_ledger.jsonl`、`content_draft/work/specificity_review.md`、`content_draft/chapter_mindmap.md` 和 `indexes/*trace.json`。",
        "重点判断：是否以视频内容为主体，是否只是字幕压缩版或总结文章，是否丢掉材料的解读方向、具体情境、例子、边界和表达重心；正文是否按材料选择 `compact_notes` 或 `chaptered_notes`，可打开小节是否完整可读而不是一个 topic 一页；章节思维导图是否适合作为学习台对话流中的一整条图文消息展示；长材料 trace map 是否覆盖主要学习单位。",
        "报告开头必须写：`---`、`schema_version: shijie.quality-audit-report.v0.1`、`audit_result: pass | needs_fix | blocked`、`recommended_stage: none | needs_restructure | coverage_ready | dossier_ready | partial_learning_notes | needs_deepening`、`---`。",
        "输出一份中文审计报告到 `content_draft/review_exports/quality_audit_report.md`，只写 front matter、是否通过、主要问题、证据和返工方向。不要直接重写正文，不要设置 release_ready。",
        "```",
    ]
    _write_text_file(audit_copy_path, audit_copy_text)

    return {
        "authoring_dir": authoring_dir,
        "codex_goal_prompt": codex_copy_path,
        "codex_audit_prompt": audit_copy_path,
        "synthesis_plan": plan_path,
    }


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
        "schema_version": "shijie.content-run-state.v0.1",
        "stage": "material_ready",
        "stage_label": "待知识树整理",
        "pipeline_version": "content_synthesis_v8",
        "current_stage": "material_ready",
        "completed_stages": ["material_package"],
        "dirty_outputs": [],
        "importable": False,
        "pipeline_ready": False,
        "audit_ready": False,
        "release_ready": False,
        "resume_instruction": "复制 authoring/02_start_codex_synthesis.md 到 Codex；v8 会在同一个 Goal 中按 run_state 自动多轮推进，每轮只过一个阶段闸门。",
        "next_action": "复制 authoring/02_start_codex_synthesis.md 到 Codex；v8 会在同一个 Goal 中按 run_state 自动多轮推进，每轮只过一个阶段闸门。",
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
            "synthesis_plan": os.path.join(material_dir, "content_draft", "synthesis_plan.json"),
            "learning_notes": os.path.join(material_dir, "content_draft", "learning_notes.md"),
            "chapter_mindmap": os.path.join(material_dir, "content_draft", "chapter_mindmap.md"),
            "source_index": os.path.join(material_dir, "indexes", "source_index.jsonl"),
            "node_contexts_dir": os.path.join(material_dir, "indexes", "node_contexts"),
            "learning_notes_trace": os.path.join(material_dir, "indexes", "learning_notes_trace.json"),
            "chapter_mindmap_trace": os.path.join(material_dir, "indexes", "chapter_mindmap_trace.json"),
            "codex_prompt": os.path.join(material_dir, "authoring", "02_start_codex_synthesis.md"),
            "codex_goal_v8": os.path.join(material_dir, "authoring", "codex-goal-content-synthesis-v8.md"),
            "knowledge_tree": os.path.join(material_dir, "content_draft", "work", "knowledge_tree.json"),
            "tree_outline": os.path.join(material_dir, "content_draft", "work", "tree_outline.md"),
            "structure_review": os.path.join(material_dir, "content_draft", "work", "structure_review.md"),
            "block_digest_dir": os.path.join(material_dir, "content_draft", "work", "block_digest"),
            "topic_inventory": os.path.join(material_dir, "content_draft", "work", "topic_inventory.json"),
            "coverage_matrix": os.path.join(material_dir, "content_draft", "work", "coverage_matrix.json"),
            "block_reread_ledger": os.path.join(material_dir, "content_draft", "work", "block_reread_ledger.jsonl"),
            "codex_readonly_audit_prompt": os.path.join(material_dir, "authoring", "03_readonly_synthesis_audit.md"),
            "validation_report": os.path.join(material_dir, "content_draft", "review_exports", "validation_report.json"),
            "quality_audit_report": os.path.join(material_dir, "content_draft", "review_exports", "quality_audit_report.md"),
            "source_map": os.path.join(material_dir, "content_draft", "work", "source_map.json"),
            "evidence_ledger": os.path.join(material_dir, "content_draft", "work", "evidence_ledger.jsonl"),
            "theme_model": os.path.join(material_dir, "content_draft", "work", "theme_model.json"),
            "specificity_review": os.path.join(material_dir, "content_draft", "work", "specificity_review.md"),
            "thinness_review": os.path.join(material_dir, "content_draft", "work", "thinness_review.md"),
        },
        "stage_outputs": {},
        "steps": [
            {
                "id": "material_package",
                "label": "原材料包",
                "status": "done",
                "output": "manifest.json, raw_transcript.txt, blocks/, indexes/, authoring/",
            },
            {
                "id": "codex_synthesis",
                "label": "Codex v8 学习笔记",
                "status": "next",
                "output": "knowledge_tree_ready -> coverage_ready -> dossier_ready -> partial_learning_notes -> learning_notes_ready",
            },
            {
                "id": "readonly_audit",
                "label": "只读审计",
                "status": "optional",
                "output": "content_draft/review_exports/quality_audit_report.md",
            },
            {
                "id": "import_content",
                "label": "开始学习",
                "status": "pending",
                "output": "content_draft/learning_notes.md",
            },
        ],
        "notes": [
            "当前唯一主流程是：软件生成原材料包 -> Codex Goal v8 知识树优先学习笔记 -> 可选只读审计 -> 进入学习台。",
            "v8 是长材料阶段化的可恢复流水线：knowledge_tree_ready 先定知识树；coverage_ready 只证明 topic 已挂树；dossier_ready 证明已按分支回读 blocks；partial_learning_notes 每轮只深写 1-2 个分支；learning_notes_ready 代表生产侧产物齐备，软件 validator 通过后才能导入学习。",
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
    codex_prompt = os.path.join(material_dir, "authoring", "02_start_codex_synthesis.md")
    goal_v8_prompt = os.path.join(material_dir, "authoring", "codex-goal-content-synthesis-v8.md")
    audit_prompt = os.path.join(material_dir, "authoring", "03_readonly_synthesis_audit.md")
    plan_path = os.path.join(material_dir, "content_draft", "synthesis_plan.json")
    learning_notes_path = os.path.join(material_dir, "content_draft", "learning_notes.md")
    chapter_mindmap_path = os.path.join(material_dir, "content_draft", "chapter_mindmap.md")

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
            "# 视界专注学习笔记交接单",
            "",
            f"标题：{course_title}",
            f"来源：{source_id or material_id}",
            f"材料规模：{block_count} blocks，约 {text_length} 字",
            "",
            "## 当前状态",
            "",
            "✅ 原材料包已生成",
            "",
            "下一步：复制 `authoring/02_start_codex_synthesis.md` 到 Codex。v8 会在同一个 Goal 中自动多轮推进，但每轮只过一个阶段闸门。",
            "",
            "## 唯一主流程",
            "",
            "1. 软件生成完整原材料包。",
            "2. `material_ready`：Codex 先建立 `knowledge_tree.json`、`tree_outline.md` 和 `synthesis_plan.json`，停在 `knowledge_tree_ready`。",
            "3. `knowledge_tree_ready`：Codex 把 topic 挂到知识树节点，建立 block digest、topic inventory、source cards、evidence ledger 和 coverage matrix，停在 `coverage_ready`。",
            "4. `coverage_ready`：Codex 按知识树分支回读 blocks，写 `block_reread_ledger.jsonl`、`section_dossiers/*.md` 和 `thinness_review.md`，停在 `dossier_ready`。",
            "5. `dossier_ready` 或 `partial_learning_notes`：Codex 每轮只深写 1-2 个知识树分支，逐步合并 `learning_notes.md`。",
            "6. 全部高价值分支通过结构复查和 thinness review 后，Codex 写入 `chapter_mindmap.md`、trace map，并标记 `learning_notes_ready`。",
            "7. 回到软件，点击“开始学习”，把结构化资料载入学习台。",
            "",
            "## 关键文件",
            "",
            f"- Codex 总结计划位置：`{plan_path}`",
            f"- Codex 学习笔记入口：`{codex_prompt}`",
            f"- Codex Goal v8 流水线：`{goal_v8_prompt}`",
            f"- Codex 只读审计提示：`{audit_prompt}`",
            f"- 原文旁路索引：`{os.path.join(material_dir, 'indexes', 'source_index.jsonl')}`",
            f"- 正文 trace map：`{os.path.join(material_dir, 'indexes', 'learning_notes_trace.json')}`",
            f"- 学习笔记：`{learning_notes_path}`",
            f"- 章节思维导图：`{chapter_mindmap_path}`",
        ],
    )
    return {"handoff": handoff_path, "run_state": run_state_path}


def save_codex_material_package(
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
    authoring_dir = os.path.join(material_dir, "authoring")
    schemas_dir = os.path.join(material_dir, "schemas")
    content_draft_dir = os.path.join(material_dir, "content_draft")
    review_exports_dir = os.path.join(content_draft_dir, "review_exports")
    work_dir = os.path.join(content_draft_dir, "work")
    node_contexts_dir = os.path.join(indexes_dir, "node_contexts")
    os.makedirs(blocks_dir, exist_ok=True)
    os.makedirs(indexes_dir, exist_ok=True)
    os.makedirs(node_contexts_dir, exist_ok=True)
    os.makedirs(authoring_dir, exist_ok=True)
    os.makedirs(schemas_dir, exist_ok=True)
    os.makedirs(content_draft_dir, exist_ok=True)
    os.makedirs(review_exports_dir, exist_ok=True)
    os.makedirs(os.path.join(work_dir, "writing_packets"), exist_ok=True)
    os.makedirs(os.path.join(work_dir, "source_cards"), exist_ok=True)
    os.makedirs(os.path.join(work_dir, "section_dossiers"), exist_ok=True)
    os.makedirs(os.path.join(work_dir, "drafts"), exist_ok=True)
    if os.path.exists(os.path.join(CURRENT_DIR, "schemas", "codex_material_package.schema.json")):
        shutil.copyfile(
            os.path.join(CURRENT_DIR, "schemas", "codex_material_package.schema.json"),
            os.path.join(schemas_dir, "codex_material_package.schema.json"),
        )
    if os.path.exists(os.path.join(CURRENT_DIR, "schemas", "content_synthesis_plan.schema.json")):
        shutil.copyfile(
            os.path.join(CURRENT_DIR, "schemas", "content_synthesis_plan.schema.json"),
            os.path.join(schemas_dir, "content_synthesis_plan.schema.json"),
        )

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
        "schema_version": "onboard.codex-materials.v0.1",
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
            "handoff": "HANDOFF.md",
            "run_state": "run_state.json",
            "blocks_dir": "blocks",
            "indexes_dir": "indexes",
            "part_index": "indexes/part_index.json",
            "source_index": "indexes/source_index.jsonl",
            "node_contexts_dir": "indexes/node_contexts",
            "learning_notes_trace": "indexes/learning_notes_trace.json",
            "chapter_mindmap_trace": "indexes/chapter_mindmap_trace.json",
            "teaching_map": "indexes/teaching_map.json",
            "term_normalization": "indexes/term_normalization.json",
            "noise_segments": "indexes/noise_segments.json",
            "authoring_dir": "authoring",
            "codex_synthesis_prompt": "authoring/02_start_codex_synthesis.md",
            "codex_goal_v8_prompt": "authoring/codex-goal-content-synthesis-v8.md",
            "codex_readonly_audit_prompt": "authoring/03_readonly_synthesis_audit.md",
            "synthesis_plan": "content_draft/synthesis_plan.json",
            "synthesis_plan_schema": "schemas/content_synthesis_plan.schema.json",
            "content_draft_dir": "content_draft",
            "content_work_dir": "content_draft/work",
            "intake_inventory": "content_draft/work/intake_inventory.md",
            "knowledge_tree": "content_draft/work/knowledge_tree.json",
            "tree_outline": "content_draft/work/tree_outline.md",
            "structure_review": "content_draft/work/structure_review.md",
            "source_map": "content_draft/work/source_map.json",
            "source_cards_dir": "content_draft/work/source_cards",
            "block_digest_dir": "content_draft/work/block_digest",
            "topic_inventory": "content_draft/work/topic_inventory.json",
            "evidence_ledger": "content_draft/work/evidence_ledger.jsonl",
            "coverage_matrix": "content_draft/work/coverage_matrix.json",
            "block_reread_ledger": "content_draft/work/block_reread_ledger.jsonl",
            "theme_model": "content_draft/work/theme_model.json",
            "editorial_contract": "content_draft/work/editorial_contract.md",
            "coverage_gap_report": "content_draft/work/coverage_gap_report.md",
            "section_dossiers_dir": "content_draft/work/section_dossiers",
            "drafts_dir": "content_draft/work/drafts",
            "thinness_review": "content_draft/work/thinness_review.md",
            "editorial_review": "content_draft/work/editorial_review.md",
            "specificity_review": "content_draft/work/specificity_review.md",
            "concept_graph": "content_draft/work/concept_graph.json",
            "learning_notes": "content_draft/learning_notes.md",
            "chapter_mindmap": "content_draft/chapter_mindmap.md",
            "review_exports_dir": "content_draft/review_exports",
            "validation_report": "content_draft/review_exports/validation_report.json",
            "quality_audit_report": "content_draft/review_exports/quality_audit_report.md",
            "block_schema": "schemas/codex_material_package.schema.json#/$defs/materialBlock",
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
            "single_pass_blocks": "每次优先处理 1-3 个 blocks，不要一次性吞完整 raw_transcript.txt。",
            "active_workflow": "material_package -> Codex Goal v8 knowledge_tree_ready -> coverage_ready -> dossier_ready -> partial_learning_notes -> learning_notes_ready -> learning import",
            "coverage_strategy": "长材料第一轮只做到 knowledge_tree_ready；第二轮把 topic 挂到知识树并停在 coverage_ready；第三轮必须按分支回读 blocks 写 block_reread_ledger 和 section_dossiers；后续每轮只深写 1-2 个知识树分支。",
            "review_strategy": "v8 学习笔记以 structure_review、thinness_review 和 specificity_review 作为能否导入学习的质量闸门；文件存在不等于 learning_notes_ready。",
            "presentation_strategy": "短材料或主题集中材料使用 compact_notes：# 标题 + 少量 ## 完整学习小节；中长材料使用 chaptered_notes：## 大章节 + ### 完整小节。不要把单个 topic 拆成一页。",
            "trace_strategy": "source refs、block_id、raw offset 等追溯信息只写入 indexes/source_index.jsonl、indexes/node_contexts/ 和 trace map，学生正文保持干净。",
        },
    }

    raw_tracks = {"tracks": _subtitle_track_segments(subtitles)}
    _save_json_file(os.path.join(material_dir, "raw_tracks.json"), raw_tracks)

    concept_index: dict[str, list[str]] = {}
    timeline_items: list[dict[str, Any]] = []
    outline_items: list[dict[str, Any]] = []
    material_blocks = _build_material_blocks(plan.chunks)
    part_index = _build_part_index(subtitles, material_blocks)
    manifest["block_count"] = len(material_blocks)
    _save_json_file(os.path.join(material_dir, "manifest.json"), manifest)
    _save_json_file(os.path.join(indexes_dir, "part_index.json"), part_index)
    _write_text_file(
        os.path.join(node_contexts_dir, "README.md"),
        [
            "# Node Contexts",
            "",
            "Codex 在 coverage/dossier 阶段可以把知识树节点或分支的原文依据写到这里。",
            "",
            "建议文件名：`branch_001.json`、`node_001_001.json`。学生正文不读取这里。",
        ],
    )
    _save_json_file(
        os.path.join(indexes_dir, "learning_notes_trace.json"),
        _build_initial_trace_map(material_id=str(manifest.get("material_id") or bvid), artifact="learning_notes.md"),
    )
    _save_json_file(
        os.path.join(indexes_dir, "chapter_mindmap_trace.json"),
        _build_initial_trace_map(material_id=str(manifest.get("material_id") or bvid), artifact="chapter_mindmap.md"),
    )

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
            "schema_version": "onboard.material-block.v0.1",
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
            "codex_notes": [
                "本块只限定内容范围，不代表最终学习笔记质量上限。",
                "生成学习笔记时请补足必要定义、因果、场景、步骤和常见误区，但不要脱离视频主线。",
                "如果本块信息量过大，请先生成 block_summary.json，再回读关键原文证据。",
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
    _write_text_file(
        os.path.join(work_dir, "README.md"),
        [
            "# Content Draft Work",
            "",
            "这里保存 Codex Goal v8 的中间工作文件：入口盘点、知识树、结构复查、原文地图、block digest、topic inventory、证据账本、coverage matrix、block_reread_ledger、分支材料包、草稿、薄度复查、编辑复查、具体性复查、概念图和最终自检。",
            "",
            "`content_draft/learning_notes.md` 和 `content_draft/chapter_mindmap.md` 只能由 Codex 在 learning_notes_ready 阶段生成；原材料包阶段不写占位正文。",
        ],
    )
    _write_text_file(
        os.path.join(review_exports_dir, "README.md"),
        [
            "# Review Exports",
            "",
            "第二个只读审计窗口只允许把学习笔记审计报告写到这里。",
            "",
            "标准输出：`quality_audit_report.md`。旧版 `latest-readonly-audit.md` 只作为历史兼容文件。",
        ],
    )
    _write_authoring_workspace(
        material_dir,
        course_title=str(video_info.get("title") or source.title or bvid),
        material_id=str(manifest.get("material_id") or bvid),
    )
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
        return "检测到上次原材料包已经写入，正在刷新制作记录。"
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


__all__ = [
    "DistillationError",
    "PipelineConfig",
    "SourceDescriptor",
    "TextChunk",
    "TextUnit",
    "build_chunks",
    "flatten_subtitles_to_text",
    "normalize_raw_source",
    "prepare_chunk_plan",
    "run_distillation_from_bilibili",
    "run_material_package_from_local_media",
    "save_codex_material_package",
]


def _slugify(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower()).strip("_")
    return normalized[:48] or fallback


def _emit_progress(message: str, percent: int, **extra: Any) -> None:
    payload = {"message": message, "percent": percent}
    payload.update({key: value for key, value in extra.items() if value is not None})
    print(
        "__ONBOARD_DISTILL_PROGRESS__="
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
    codex_material_path = save_codex_material_package(
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
            "stage": "material_ready",
            "finished": True,
            "material_path": codex_material_path,
            "chunk_total": len(full_plan.chunks),
            "chunk_completed": len(full_plan.chunks),
            "stage_timings": stage_timings,
        },
    )
    _emit_progress("Codex 原材料包已生成。", 100, stage="complete", cacheHint="material_package")
    return {
        "packagePath": "",
        "packageId": package_id,
        "title": str(video_info.get("title") or bvid),
        "bvid": str(video_info.get("bvid") or bvid),
        "textSourceType": text_source_type,
        "textSourceNote": text_source_note,
        "materialPath": codex_material_path,
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
        raise DistillationError("本地音视频转写结果为空，无法生成原材料包。")

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
    _emit_progress("正在写入 Codex 原材料包…", 82, stage="chunking", chunkCompleted=len(full_plan.chunks), chunkTotal=len(full_plan.chunks))
    material_write_started_at = perf_counter()
    codex_material_path = save_codex_material_package(
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
    _emit_progress("本地音视频原材料包已生成。", 100, stage="complete", cacheHint="material_package")
    return {
        "packagePath": "",
        "packageId": package_id,
        "title": title,
        "bvid": source_id,
        "textSourceType": "local_media_transcript",
        "textSourceNote": f"已从本地文件转写：{source_path}",
        "materialPath": codex_material_path,
        "chunkCount": len(full_plan.chunks),
        "warningCount": 0,
        "warnings": [_format_timing_brief(stage_timings)],
        "stageTimings": stage_timings,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="视界专注 Codex 原材料包生成入口")
    parser.add_argument("video", nargs="?", help="B 站视频链接或 BV 号")
    parser.add_argument("--material-only", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--local-media", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--result-json", action="store_true", help=argparse.SUPPRESS)
    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    if not args.video:
        parser.error("请提供 B 站视频链接或 BV 号。")

    try:
        if args.local_media:
            result = run_material_package_from_local_media(args.video)
        else:
            result = run_distillation_from_bilibili(args.video, material_only=args.material_only)
        _emit_progress("原材料包生成完成，正在回传桌面端…", 100, stage="complete")
        if args.result_json:
            print("__ONBOARD_DISTILL_RESULT__=" + json.dumps(result, ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:
        print(f"材料整理失败：{exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

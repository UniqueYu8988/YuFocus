# -*- coding: utf-8 -*-
"""Onboard Anything 的课程蒸馏管线。"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
import glob
import hashlib
import json
import math
import os
from time import perf_counter
import re
import sys
from typing import Any, Callable, Iterable

import requests

import bilibili_api
import config


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
COURSE_SCHEMA_PATH = os.path.join(CURRENT_DIR, "schemas", "course_package.schema.json")
JSON_OBJECT_PATTERN = re.compile(r"\{.*\}", re.DOTALL)
CJK_CHAR_PATTERN = re.compile(r"[\u3400-\u9fff]")
WORD_PATTERN = re.compile(r"[A-Za-z0-9_]+")
CACHE_DIR_NAME = ".onboard_cache"
FAST_SYNTH_CHUNK_THRESHOLD = max(0, int(os.getenv("ONBOARD_FAST_SYNTH_CHUNK_THRESHOLD", "1") or "1"))
BATCH_REDUCE_THRESHOLD = max(0, int(os.getenv("ONBOARD_BATCH_REDUCE_THRESHOLD", "12") or "12"))
BATCH_REDUCE_GROUP_SIZE = max(2, int(os.getenv("ONBOARD_BATCH_REDUCE_GROUP_SIZE", "8") or "8"))
CHUNK_DISTILL_CONCURRENCY = max(1, int(os.getenv("ONBOARD_CHUNK_DISTILL_CONCURRENCY", "4") or "4"))
BATCH_REDUCE_CONCURRENCY = max(1, int(os.getenv("ONBOARD_BATCH_REDUCE_CONCURRENCY", "3") or "3"))
FORCE_LOCAL_SYNTH_SHARD_THRESHOLD = max(
    0,
    int(os.getenv("ONBOARD_FORCE_LOCAL_SYNTH_SHARD_THRESHOLD", "4") or "4"),
)
MAX_ROOT_CHAPTERS = max(6, int(os.getenv("ONBOARD_MAX_ROOT_CHAPTERS", "24") or "24"))
MICRO_ROOT_LESSON_THRESHOLD = max(1, int(os.getenv("ONBOARD_MICRO_ROOT_LESSON_THRESHOLD", "2") or "2"))
TARGET_GROUP_LEAF_LESSONS = max(4, int(os.getenv("ONBOARD_TARGET_GROUP_LEAF_LESSONS", "8") or "8"))
STAGE_THEME_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("正则表达式与文本匹配", ("正则", "regex", "匹配", "量词", "分组", "贪婪", "非贪婪", "字符类")),
    ("综合练习与项目演练", ("练习", "项目", "综合应用", "案例", "实训", "题目", "巩固")),
    ("网络请求与爬虫基础", ("爬虫", "http", "https", "url", "robots", "requests", "请求", "响应", "网页")),
    ("数据解析与存储实践", ("json", "xpath", "jsonpath", "excel", "csv", "数据库", "pymongo", "存储", "解析")),
    ("并发异步与采集实战", ("协程", "并发", "异步", "aio", "采集", "壁纸", "音乐爬虫", "批量")),
    ("逆向分析与调试实战", ("逆向", "加密", "断点", "调用栈", "翻译", "网易云", "js", "调试")),
    ("图形界面与工具模块", ("tkinter", "图形界面", "random", "随机数", "界面开发")),
    ("基础入门与语法起步", ("环境", "安装", "配置", "入门", "基础", "起步", "认识", "准备", "变量", "赋值", "输入", "输出")),
    ("语法规则与流程控制", ("条件", "判断", "if", "else", "循环", "for", "while", "break", "continue", "运算符", "比较", "逻辑")),
    ("字符串与常用数据结构", ("字符串", "列表", "元组", "字典", "集合", "切片", "序列", "编码")),
    ("函数设计与作用域", ("函数", "参数", "返回值", "lambda", "闭包", "递归", "作用域", "匿名")),
    ("模块化与面向对象", ("模块", "包", "类", "对象", "封装", "继承", "多态", "魔术方法", "异常")),
    ("文件处理与工程实践", ("文件", "路径", "读写", "io", "目录", "项目", "实战", "综合", "案例")),
    ("诊疗规范与基本操作", ("无菌", "消毒", "洗手", "戴手套", "操作", "检查", "口腔", "诊疗", "护理")),
    ("病例判断与临床思路", ("病例", "病因", "症状", "诊断", "鉴别", "治疗", "并发症", "临床", "病变")),
]
TEACHING_FLOW_BUCKET_HINTS: list[tuple[int, tuple[str, ...]]] = [
    (0, ("导学", "导论", "入门", "起步", "概览", "总览", "先导", "认识", "基础")),
    (1, ("概念", "定义", "原理", "本质", "规则", "特点", "核心", "理解")),
    (2, ("例子", "示例", "案例", "演示", "场景", "体验")),
    (3, ("操作", "实战", "练习", "使用", "流程", "步骤", "方法", "配置", "上手", "技巧")),
    (4, ("易错", "错误", "误区", "陷阱", "注意", "禁忌", "风险")),
    (5, ("复盘", "回顾", "总结", "小测", "测验", "自检", "检查")),
]
CHUNK_CACHE_VERSION = "chunk-shard.v2"
BATCH_CACHE_VERSION = "chunk-batch.v1"
RUN_MANIFEST_VERSION = "distill-resume.v1"

DEFAULT_CHUNK_SHARD_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "chunk_id",
        "course_title_guess",
        "overall_goal_guess",
        "chapters",
        "dependency_graph",
        "assets",
        "gaps",
        "open_questions",
    ],
    "properties": {
        "chunk_id": {"type": "string"},
        "course_title_guess": {"type": "string"},
        "overall_goal_guess": {"type": "string"},
        "chapters": {"type": "array"},
        "dependency_graph": {"type": "array"},
        "assets": {"type": "array"},
        "gaps": {"type": "array"},
        "open_questions": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
}

DEFAULT_BATCH_SHARD_SCHEMA = DEFAULT_CHUNK_SHARD_SCHEMA

CHUNK_SYSTEM_PROMPT = """
你是一个冷酷无情的知识解剖机器。你的任务是从这块网课字幕切片中，提取出纯粹的结构化知识。绝对不要总结！绝对不要用“大家好”、“这段讲了”等废话！

你必须只做三件事：
1. 提取核心概念（名词）。
2. 给出简短的定义、例子或用途。
3. 抽取任何明显的因果关系、先后顺序或前置依赖关系。

铁律：
- 绝对不要输出总结腔、讲课腔、主持人腔。
- 绝对不要把原文改写成流水账。
- 绝对不要编造字幕中没有出现的知识点。
- 如果文本里提到“看图”“看这里”“画面上”“这个表格”“如下图示”但你拿不到视觉信息，必须把它登记为 gaps。
- 你抽取的是知识碎片，不是最终课程包，所以要克制，只保留当前 chunk 能确认的内容。
- 如果证据不足，宁可留空数组，也不要自作聪明脑补。

输出要求：
- 严格以 JSON 格式输出。
- 只输出一个 JSON 对象。
- 不要输出 Markdown，不要输出解释，不要输出代码块。
""".strip()

FINAL_SYSTEM_PROMPT = """
你是一个顶级的课程教研专家。你收到了刚才按顺序提取出来的知识碎片数组。请你将这些碎片进行全局去重、逻辑梳理，并严丝合缝地填入我之前定好的 Course Package JSON Schema 中。重点检查并完善“章节依赖关系（Dependencies）”字段，确保学习主线清晰。

铁律：
- 你必须严格输出 JSON，不得输出 Markdown、解释、前言、后记、代码块。
- 你必须产出的是“可带学课程包”，不是普通总结。
- 你必须全局去重，合并重复概念、重复章节和重复例子。
- 你必须主动梳理学习顺序，补全合理的 dependencies，让学习主线清晰。
- 顶层 chapters 代表真正的学习阶段，不要把零碎小点直接都提升为顶层章节；相邻微小主题应优先合并为同一主线下的 sections / lessons。
- 每个节点都要尽量带上 concepts、examples、checkpoints、common_mistakes。
- 如果信息不足，允许字段为空，但不得编造。
- 如果缺失视觉上下文，必须写入 gaps。
- 任何 node id 必须稳定、唯一、可引用。
""".strip()

BATCH_REDUCE_SYSTEM_PROMPT = """
你是一个课程结构归并器。你收到的是一组按顺序排列的 chunk 知识碎片，它们都属于同一段连续课程内容。

你的目标不是生成最终课程包，而是把这组 chunk 知识碎片归并成一个更紧凑的中间知识包，供后续最终总装使用。

铁律：
- 只输出一个 JSON 对象。
- 不输出 Markdown、解释、前言、代码块。
- 去掉重复概念、重复章节、重复例子。
- 保留学习顺序和依赖线索。
- 不要编造字幕里没有的内容。
- gaps 和 assets 只保留这组 chunk 中能确认的信息。
""".strip()


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
class ModelSettings:
    api_key: str
    base_url: str
    model: str
    timeout: int = 120
    temperature: float = 0.15
    max_tokens: int = 6000
    response_format_json: bool = False


@dataclass(slots=True)
class PipelineConfig:
    chunk_target_tokens: int = 5200
    chunk_max_tokens: int = 6200
    chunk_overlap_units: int = 4
    sentence_group_chars: int = 260
    max_repair_rounds: int = 2
    final_max_tokens: int = 4200


@dataclass(slots=True)
class TextUnit:
    page_label: str
    text: str
    estimated_tokens: int


@dataclass(slots=True)
class TextChunk:
    index: int
    chunk_id: str
    text: str
    units: list[TextUnit]
    estimated_tokens: int
    page_labels: list[str]


@dataclass(slots=True)
class ChunkPlan:
    units: list[TextUnit]
    chunks: list[TextChunk]
    text_length: int
    chunk_signatures: list[str]
    batch_signatures: list[tuple[str, ...]]


@dataclass(slots=True)
class DistillationRun:
    course_package: dict[str, Any]
    chunks: list[TextChunk]
    chunk_shards: list[dict[str, Any]]
    stage_timings: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ChunkWarmupResult:
    chunk_count: int
    batch_count: int
    elapsed_seconds: float
    chunk_elapsed_seconds: float
    batch_elapsed_seconds: float
    cache_ready: bool
    chunk_signatures: list[str] = field(default_factory=list)
    batch_signatures: list[tuple[str, ...]] = field(default_factory=list)


class DistillationError(RuntimeError):
    """蒸馏过程中的结构化错误。"""


class MinimalSchemaValidator:
    """足够覆盖当前 Course Package Schema 的极简校验器。"""

    def __init__(self, schema: dict[str, Any]) -> None:
        self.root_schema = schema

    def validate(self, value: Any) -> list[str]:
        errors: list[str] = []
        self._validate_node(self.root_schema, value, "$", errors)
        return errors

    def _resolve_ref(self, ref: str) -> dict[str, Any]:
        if not ref.startswith("#/"):
            raise DistillationError(f"暂不支持外部 schema 引用：{ref}")
        node: Any = self.root_schema
        for part in ref[2:].split("/"):
            node = node[part]
        if not isinstance(node, dict):
            raise DistillationError(f"schema 引用不是对象：{ref}")
        return node

    def _validate_node(self, schema: dict[str, Any], value: Any, path: str, errors: list[str]) -> None:
        if "$ref" in schema:
            self._validate_node(self._resolve_ref(schema["$ref"]), value, path, errors)
            return

        if "allOf" in schema:
            for child in schema["allOf"]:
                self._validate_node(child, value, path, errors)

        if "const" in schema and value != schema["const"]:
            errors.append(f"{path}: 必须等于常量 {schema['const']!r}")

        if "enum" in schema and value not in schema["enum"]:
            errors.append(f"{path}: 必须属于 {schema['enum']!r}")

        expected_type = schema.get("type")
        if expected_type == "object":
            if not isinstance(value, dict):
                errors.append(f"{path}: 必须是 object")
                return
            properties = schema.get("properties", {})
            required = schema.get("required", [])
            for key in required:
                if key not in value:
                    errors.append(f"{path}.{key}: 缺少必填字段")
            if schema.get("additionalProperties") is False:
                unknown = set(value.keys()) - set(properties.keys())
                for key in sorted(unknown):
                    errors.append(f"{path}.{key}: 不允许出现未声明字段")
            for key, child_schema in properties.items():
                if key in value:
                    self._validate_node(child_schema, value[key], f"{path}.{key}", errors)
            return

        if expected_type == "array":
            if not isinstance(value, list):
                errors.append(f"{path}: 必须是 array")
                return
            min_items = schema.get("minItems")
            if isinstance(min_items, int) and len(value) < min_items:
                errors.append(f"{path}: 至少需要 {min_items} 个元素")
            if schema.get("uniqueItems"):
                seen: set[str] = set()
                for index, item in enumerate(value):
                    marker = json.dumps(item, ensure_ascii=False, sort_keys=True)
                    if marker in seen:
                        errors.append(f"{path}[{index}]: 元素必须唯一")
                    seen.add(marker)
            item_schema = schema.get("items")
            if isinstance(item_schema, dict):
                for index, item in enumerate(value):
                    self._validate_node(item_schema, item, f"{path}[{index}]", errors)
            return

        if expected_type == "string":
            if not isinstance(value, str):
                errors.append(f"{path}: 必须是 string")
                return
            min_length = schema.get("minLength")
            if isinstance(min_length, int) and len(value) < min_length:
                errors.append(f"{path}: 长度不能小于 {min_length}")
            pattern = schema.get("pattern")
            if isinstance(pattern, str) and not re.match(pattern, value):
                errors.append(f"{path}: 不匹配模式 {pattern}")
            return

        if expected_type == "integer":
            if not isinstance(value, int) or isinstance(value, bool):
                errors.append(f"{path}: 必须是 integer")
                return
            minimum = schema.get("minimum")
            if isinstance(minimum, int) and value < minimum:
                errors.append(f"{path}: 不能小于 {minimum}")
            return

        if expected_type == "number":
            if (not isinstance(value, (int, float))) or isinstance(value, bool):
                errors.append(f"{path}: 必须是 number")
                return
            minimum = schema.get("minimum")
            if isinstance(minimum, (int, float)) and value < minimum:
                errors.append(f"{path}: 不能小于 {minimum}")
            return

        if expected_type == "boolean" and not isinstance(value, bool):
            errors.append(f"{path}: 必须是 boolean")


class OpenAICompatibleClient:
    """兼容 OpenAI 风格 chat/completions 的最小客户端。"""

    def __init__(self, settings: ModelSettings) -> None:
        self.settings = settings

    def chat(self, messages: list[dict[str, str]], *, max_tokens: int | None = None) -> str:
        if not self.settings.api_key.strip():
            raise DistillationError("未配置蒸馏模型 API Key。")

        url = self.settings.base_url.rstrip("/") + "/chat/completions"
        body: dict[str, Any] = {
            "model": self.settings.model,
            "messages": messages,
            "temperature": self.settings.temperature,
            "max_tokens": max_tokens or self.settings.max_tokens,
        }
        if self.settings.response_format_json:
            body["response_format"] = {"type": "json_object"}

        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {self.settings.api_key}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=self.settings.timeout,
        )
        if response.status_code >= 400:
            raise DistillationError(f"蒸馏模型调用失败：HTTP {response.status_code} {response.text[:300]}")

        payload = response.json()
        try:
            content = payload["choices"][0]["message"]["content"]
        except Exception as exc:
            raise DistillationError(f"模型返回结构异常：{payload}") from exc

        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(str(item.get("text", "")))
            return "\n".join(parts).strip()
        raise DistillationError(f"未知 content 结构：{content!r}")


def build_default_model_settings() -> ModelSettings:
    return ModelSettings(
        api_key=(os.getenv("ONBOARD_DISTILLER_API_KEY") or config.DISTILLER_API_KEY or config.MINIMAX_API_KEY).strip(),
        base_url=(os.getenv("ONBOARD_DISTILLER_BASE_URL") or config.DISTILLER_BASE_URL or config.MINIMAX_BASE_URL).strip(),
        model=(os.getenv("ONBOARD_DISTILLER_MODEL") or config.DISTILLER_MODEL or config.MINIMAX_MODEL or "MiniMax-M2.7").strip(),
        timeout=int(os.getenv("ONBOARD_DISTILLER_TIMEOUT", "120") or "120"),
    )


def load_course_schema() -> dict[str, Any]:
    with open(COURSE_SCHEMA_PATH, "r", encoding="utf-8") as file:
        return json.load(file)


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


def _iter_subtitle_units(source: list[dict[str, Any]], target_chars: int) -> Iterable[TextUnit]:
    for subtitle in source:
        page_segments = subtitle.get("page_segments") or []
        if page_segments:
            for segment in page_segments:
                label = str(segment.get("label") or "未命名分段").strip()
                entries = segment.get("entries") or []
                text_lines = [
                    f"[{float(entry.get('from', 0.0)):.1f}-{float(entry.get('to', 0.0)):.1f}] {str(entry.get('content', '')).strip()}"
                    for entry in entries
                    if str(entry.get("content", "")).strip()
                ]
                for group in _compact_sentences("\n".join(text_lines), target_chars):
                    yield TextUnit(page_label=label, text=group, estimated_tokens=_estimate_tokens(group))
            continue

        label = str(subtitle.get("lang") or "字幕内容").strip()
        entries = subtitle.get("entries") or []
        text_lines = [
            f"[{float(entry.get('from', 0.0)):.1f}-{float(entry.get('to', 0.0)):.1f}] {str(entry.get('content', '')).strip()}"
            for entry in entries
            if str(entry.get("content", "")).strip()
        ]
        for group in _compact_sentences("\n".join(text_lines), target_chars):
            yield TextUnit(page_label=label, text=group, estimated_tokens=_estimate_tokens(group))


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
        raise DistillationError("无法识别 dict 形式的蒸馏输入。")

    if isinstance(raw_source, list):
        return list(_iter_subtitle_units(raw_source, target_chars))

    raise DistillationError(f"不支持的蒸馏输入类型：{type(raw_source)!r}")


def build_chunks(units: list[TextUnit], package_id: str, pipeline_config: PipelineConfig) -> list[TextChunk]:
    if not units:
        raise DistillationError("蒸馏输入为空，无法建立 chunk。")

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
            )
        )

    return chunks


def _chunk_content_signature(chunk: TextChunk) -> str:
    payload = {
        "text": chunk.text,
        "page_labels": chunk.page_labels,
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(serialized.encode("utf-8")).hexdigest()[:20]


def prepare_chunk_plan(
    raw_source: str | list[dict[str, Any]] | dict[str, Any],
    *,
    package_id: str,
    pipeline_config: PipelineConfig,
) -> ChunkPlan:
    units = normalize_raw_source(raw_source, target_chars=pipeline_config.sentence_group_chars)
    chunks = build_chunks(units, package_id=package_id, pipeline_config=pipeline_config)
    chunk_signatures = [_chunk_content_signature(chunk) for chunk in chunks]
    batch_signatures = [
        tuple(chunk_signatures[index : index + BATCH_REDUCE_GROUP_SIZE])
        for index in range(0, len(chunk_signatures), BATCH_REDUCE_GROUP_SIZE)
    ]
    return ChunkPlan(
        units=units,
        chunks=chunks,
        text_length=sum(len(unit.text) for unit in units),
        chunk_signatures=chunk_signatures,
        batch_signatures=batch_signatures,
    )


def _extract_json_object(text: str) -> dict[str, Any]:
    candidate = text.strip()
    try:
        data = json.loads(candidate)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    starts = [index for index, char in enumerate(candidate) if char == "{"][:128]
    for start in starts:
        try:
            data, _ = decoder.raw_decode(candidate[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            return data

    match = JSON_OBJECT_PATTERN.search(candidate)
    if not match:
        raise DistillationError(f"模型没有返回可解析的 JSON 对象：{candidate[:300]}")

    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise DistillationError(f"JSON 解析失败：{exc}") from exc
    if not isinstance(data, dict):
        raise DistillationError("模型返回的 JSON 根节点不是对象。")
    return data


def _schema_or_errors(schema: dict[str, Any], payload: dict[str, Any]) -> list[str]:
    validator = MinimalSchemaValidator(schema)
    return validator.validate(payload)


def _repair_messages(
    *,
    system_prompt: str,
    user_prompt: str,
    previous_output: str,
    errors: list[str],
) -> list[dict[str, str]]:
    error_block = "\n".join(f"- {error}" for error in errors[:24])
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
        {
            "role": "user",
            "content": (
                "你刚才的 JSON 不合法。请基于原始任务重写完整 JSON。\n"
                "发现的问题如下：\n"
                f"{error_block}\n\n"
                "你上一次的错误输出如下，请不要解释，直接修正为完整 JSON：\n"
                f"{previous_output}"
            ),
        },
    ]


def _normalize_shard_section(item: Any) -> dict[str, Any] | None:
    if isinstance(item, str):
        text = _to_clean_text(item)
        if not text:
            return None
        return {"title": text, "content": text}

    if not isinstance(item, dict):
        return None

    title = _to_clean_text(
        item.get("title")
        or item.get("name")
        or item.get("topic")
        or item.get("label")
        or item.get("concept")
    )
    content = _to_clean_text(
        item.get("content")
        or item.get("summary")
        or item.get("description")
        or item.get("definition")
        or item.get("explanation")
        or item.get("example")
        or item.get("takeaway")
    )

    children_raw = (
        item.get("children")
        or item.get("sections")
        or item.get("lessons")
        or item.get("items")
        or []
    )
    children = [
        normalized_child
        for normalized_child in (_normalize_shard_section(child) for child in children_raw)
        if normalized_child
    ]

    if not title and not content and not children:
        return None

    normalized: dict[str, Any] = {
        "title": title or content or "未命名节点",
        "content": content or title or "",
    }
    if children:
        normalized["children"] = children
    return normalized


def _coerce_string_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
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
    return items


def _coerce_object_list(values: Any) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    return [item for item in values if isinstance(item, dict)]


def _normalize_chunk_like_payload(
    payload: dict[str, Any],
    *,
    expected_chunk_id: str = "",
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return payload

    raw_chapters = payload.get("chapters")
    if not isinstance(raw_chapters, list):
        root_sections = (
            payload.get("sections")
            or payload.get("lessons")
            or payload.get("children")
            or payload.get("items")
            or []
        )
        normalized_root_sections = [
            normalized_item
            for normalized_item in (_normalize_shard_section(item) for item in root_sections)
            if normalized_item
        ]
        if normalized_root_sections or _to_clean_text(payload.get("title")) or _to_clean_text(payload.get("summary")):
            raw_chapters = [
                {
                    "title": _to_clean_text(payload.get("title"))
                    or _to_clean_text(payload.get("course_title_guess"))
                    or "未命名章节",
                    "content": _to_clean_text(payload.get("summary"))
                    or _to_clean_text(payload.get("overall_goal_guess"))
                    or _to_clean_text(payload.get("description")),
                    "children": normalized_root_sections,
                }
            ]
        else:
            raw_chapters = []

    normalized_chapters = [
        normalized_item
        for normalized_item in (_normalize_shard_section(item) for item in raw_chapters)
        if normalized_item
    ]

    normalized = {
        "chunk_id": _to_clean_text(payload.get("chunk_id")) or expected_chunk_id or "chunk_unknown",
        "course_title_guess": _to_clean_text(payload.get("course_title_guess"))
        or _to_clean_text(payload.get("course_title"))
        or _to_clean_text(payload.get("courseName"))
        or _to_clean_text(payload.get("title")),
        "overall_goal_guess": _to_clean_text(payload.get("overall_goal_guess"))
        or _to_clean_text(payload.get("overall_goal"))
        or _to_clean_text(payload.get("goal"))
        or _to_clean_text(payload.get("summary"))
        or _to_clean_text(payload.get("description")),
        "chapters": normalized_chapters,
        "dependency_graph": _coerce_object_list(payload.get("dependency_graph") or payload.get("dependencies")),
        "assets": _coerce_object_list(payload.get("assets") or payload.get("media_assets")),
        "gaps": _coerce_object_list(payload.get("gaps") or payload.get("missing_visuals")),
        "open_questions": _coerce_string_list(
            payload.get("open_questions") or payload.get("questions") or payload.get("unknowns")
        ),
    }
    return normalized


def _call_json_with_validation(
    client: OpenAICompatibleClient,
    *,
    system_prompt: str,
    user_prompt: str,
    schema: dict[str, Any],
    max_tokens: int,
    max_repair_rounds: int,
    normalizer: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    last_output = ""
    last_errors: list[str] = []

    for _ in range(max_repair_rounds + 1):
        try:
            last_output = client.chat(messages, max_tokens=max_tokens)
        except requests.Timeout as exc:
            raise DistillationError(f"蒸馏模型调用超时（>{client.settings.timeout} 秒）。") from exc
        except requests.RequestException as exc:
            raise DistillationError(f"蒸馏模型网络请求失败：{exc}") from exc
        try:
            payload = _extract_json_object(last_output)
            if normalizer:
                payload = normalizer(payload)
            last_errors = _schema_or_errors(schema, payload)
        except DistillationError as exc:
            last_errors = [str(exc)]
        if not last_errors:
            return payload
        messages = _repair_messages(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            previous_output=last_output,
            errors=last_errors,
        )

    raise DistillationError("模型多轮修复后仍未生成合法 JSON：\n" + "\n".join(last_errors[:24]))


def _build_chunk_user_prompt(
    *,
    chunk: TextChunk,
    source: SourceDescriptor,
    package_id: str,
) -> str:
    chunk_contract = json.dumps(DEFAULT_CHUNK_SHARD_SCHEMA, ensure_ascii=False, indent=2)
    return (
        "请阅读下面这段课程原始文本，并抽取一个 chunk shard JSON。\n\n"
        "注意：这不是普通摘要，而是课程知识蒸馏。你要识别它适合如何被讲、先学什么、后学什么、有哪些可教学概念和例子。\n\n"
        "输出 JSON 必须符合下面这个 shard contract：\n"
        f"{chunk_contract}\n\n"
        "字段要求：\n"
        "- chunk_id: 必须使用给定 chunk_id。\n"
        "- course_title_guess: 只写你从文本里推断出的课程标题草案。\n"
        "- overall_goal_guess: 只写这段内容服务于什么总体学习目标。\n"
        "- chapters: 允许输出 chapter / section / lesson 树，但只能基于当前 chunk 的证据，未知信息不要硬补。\n"
        "- dependency_graph: 只写当前 chunk 内能确定的依赖。\n"
        "- assets: 如果文本明确提到图、表、代码片段、演示画面、外链资源，可以登记；否则空数组。\n"
        "- gaps: 只要文本出现视觉缺失、图示缺失、屏幕文字缺失、步骤跳跃，就要记录。\n"
        "- open_questions: 记录当前 chunk 仍无法确定、需要后续 chunk 补全的问题。\n\n"
        "字段之外不允许输出任何额外文字。\n\n"
        f"package_id: {package_id}\n"
        f"chunk_id: {chunk.chunk_id}\n"
        f"chunk_index: {chunk.index}\n"
        f"source_title: {source.title}\n"
        f"source_type: {source.source_type}\n"
        f"page_labels: {json.dumps(chunk.page_labels, ensure_ascii=False)}\n\n"
        "原始文本如下：\n"
        f"{chunk.text}"
    )


def _build_final_user_prompt(
    *,
    package_id: str,
    source: SourceDescriptor,
    chunk_shards: list[dict[str, Any]],
    ingested_at: str,
    text_length: int,
) -> str:
    shard_json = json.dumps(chunk_shards, ensure_ascii=False, indent=2)
    output_skeleton = {
        "schema_version": "onboard.course-package.v0.1",
        "package_id": package_id,
        "source": {
            "source_type": source.source_type,
            "source_id": source.source_id,
            "title": source.title,
            "creator": source.creator,
            "url": source.url,
            "language": source.language,
            "ingested_at": ingested_at,
            "text_length": text_length,
            "notes": source.notes,
        },
        "course": {
            "title": source.title,
            "overall_goal": "",
            "target_audience": "",
            "prerequisites": [],
            "learning_outcomes": [],
            "completion_definition": "",
            "estimated_total_minutes": 0,
        },
        "chapters": [
            {
                "id": "chapter-id",
                "node_type": "chapter",
                "title": "",
                "summary": "",
                "order": 1,
                "learning_objectives": [],
                "dependencies": [],
                "knowledge": {
                    "concepts": [],
                    "examples": [],
                    "checkpoints": [],
                    "common_mistakes": [],
                },
                "children": [],
                "assets": [],
                "gaps": [],
            }
        ],
        "dependency_graph": [],
        "assets": [],
        "gaps": [],
    }
    return (
        "下面是多个 chunk shard，请你把它们合成为唯一一个最终 Course Package。\n\n"
        "最终输出必须满足以下要求：\n"
        "1. 根节点必须是一个 JSON object。\n"
        "2. 必须填成最终课程包数据，而不是复制 schema 说明。\n"
        "3. 不得输出 schema 之外的闲聊文字。\n"
        "4. 必须生成可教学的章节树，并且每个节点都带 knowledge.concepts / examples / checkpoints / common_mistakes。\n"
        "5. dependency_graph 必须引用真实存在的节点 id。\n"
        "6. assets / gaps 即使为空也要保留数组字段。\n"
        "7. 如果多个 shard 内容冲突，优先保留更具体、更可教学、更少废话的版本。\n"
        "8. 如果无法确认某个视觉信息，写入 gaps，不要脑补。\n\n"
        "9. 为了保证响应速度，请输出紧凑课程包：默认 1-3 个 chapter，每个节点只保留最必要的 concepts / examples / checkpoints / common_mistakes。\n"
        "10. 所有 explanation / scenario / takeaway / summary 都要短句，避免冗长段落。\n\n"
        "11. 每个顶层 chapter 内部尽量按“概念理解 -> 示例演示 -> 操作实战 -> 易错提醒 -> 阶段复盘/小测”的顺序组织子节点。\n"
        "12. 每个顶层 chapter 结尾尽量保留一个阶段复盘或小测节点，用来帮助学习者回顾主线。\n\n"
        "绝对禁止输出这些 schema 元字段：$schema、$id、title、description、type、properties、$defs、required、additionalProperties。\n\n"
        "请按这个最终输出骨架来填值。注意：这是输出骨架，不是 schema 文档，不要原样照抄空字段说明。\n"
        f"{json.dumps(output_skeleton, ensure_ascii=False, indent=2)}\n\n"
        "字段形状速记：\n"
        "- 根字段必须包含 schema_version, package_id, source, course, chapters, dependency_graph, assets, gaps。\n"
        "- source 必须包含 source_type, source_id, title, language, ingested_at, text_length。\n"
        "- course 必须包含 title, overall_goal, target_audience, learning_outcomes, completion_definition。\n"
        "- 每个章节节点必须包含 id, node_type, title, summary, order, learning_objectives, dependencies, knowledge, children, assets, gaps。\n"
        "- knowledge 必须包含 concepts, examples, checkpoints, common_mistakes。\n"
        "- dependency_graph 的 from / to 必须引用真实存在的节点 id。\n\n"
        "请使用以下固定 source 元信息：\n"
        f"- schema_version: onboard.course-package.v0.1\n"
        f"- package_id: {package_id}\n"
        f"- source_type: {source.source_type}\n"
        f"- source_id: {source.source_id}\n"
        f"- title: {source.title}\n"
        f"- creator: {source.creator}\n"
        f"- url: {source.url}\n"
        f"- language: {source.language}\n"
        f"- ingested_at: {ingested_at}\n"
        f"- text_length: {text_length}\n"
        f"- notes: {source.notes}\n\n"
        "chunk shards 如下：\n"
        f"{shard_json}"
    )


def _build_batch_reduce_user_prompt(
    *,
    package_id: str,
    source: SourceDescriptor,
    batch_index: int,
    total_batches: int,
    chunk_shards: list[dict[str, Any]],
) -> str:
    shard_json = json.dumps(chunk_shards, ensure_ascii=False, indent=2)
    return (
        "下面是一批按顺序连续出现的 chunk shards，请将它们压缩归并成一个中间 shard。\n\n"
        "这个中间 shard 不是最终课程包，而是为了后续总装准备的更紧凑知识包。\n"
        "你必须保留核心章节、概念、例子、依赖线索、assets 和 gaps，但要去重、收敛、删掉冗余。\n"
        "输出仍然必须严格符合 chunk shard JSON 结构。\n\n"
        f"package_id: {package_id}\n"
        f"source_id: {source.source_id}\n"
        f"source_title: {source.title}\n"
        f"batch_index: {batch_index}/{total_batches}\n\n"
        "本批 chunk shards 如下：\n"
        f"{shard_json}"
    )


def distill_chunks(
    chunks: list[TextChunk],
    *,
    source: SourceDescriptor,
    package_id: str,
    client: OpenAICompatibleClient,
    pipeline_config: PipelineConfig,
    progress_callback: Any | None = None,
    state_callback: Callable[[int, int], None] | None = None,
) -> list[dict[str, Any]]:
    chunk_shards: list[dict[str, Any] | None] = [None] * len(chunks)
    cache_dir = _ensure_cache_dir()

    pending: list[tuple[int, TextChunk, str]] = []
    completed_count = 0

    def _process_chunk(chunk: TextChunk, cache_path: str) -> dict[str, Any]:
        prompt = _build_chunk_user_prompt(chunk=chunk, source=source, package_id=package_id)
        shard = _call_json_with_validation(
            client,
            system_prompt=CHUNK_SYSTEM_PROMPT,
            user_prompt=prompt,
            schema=DEFAULT_CHUNK_SHARD_SCHEMA,
            max_tokens=client.settings.max_tokens,
            max_repair_rounds=pipeline_config.max_repair_rounds,
            normalizer=lambda payload, chunk_id=chunk.chunk_id: _normalize_chunk_like_payload(
                payload,
                expected_chunk_id=chunk_id,
            ),
        )
        shard["chunk_id"] = chunk.chunk_id
        _save_cached_chunk_shard(cache_path, shard)
        return shard

    for position, chunk in enumerate(chunks):
        chunk_key = _chunk_cache_key(chunk, source=source, client=client)
        cache_path = _chunk_cache_path(cache_dir, chunk_key)
        cached_shard = _load_cached_chunk_shard(cache_path, chunk.chunk_id)
        if cached_shard:
            next_completed = completed_count + 1
            if progress_callback:
                progress_callback(
                    f"命中知识分片缓存 {chunk.index}/{len(chunks)}，跳过重复蒸馏…",
                    min(88, 84 + max(1, int((chunk.index / max(1, len(chunks))) * 6))),
                    stage="chunk_distilling",
                    chunkCompleted=next_completed,
                    chunkTotal=len(chunks),
                    cacheHint="chunk_shard",
                )
            chunk_shards[position] = cached_shard
            completed_count = next_completed
            if state_callback:
                state_callback(completed_count, len(chunks))
            continue
        pending.append((position, chunk, cache_path))

    if completed_count and completed_count < len(chunks) and progress_callback:
        progress_callback(
            f"检测到已有 {completed_count}/{len(chunks)} 个知识分片缓存，将从断点继续蒸馏…",
            min(88, 84 + max(1, int((completed_count / max(1, len(chunks))) * 6))),
            stage="chunk_distilling",
            chunkCompleted=completed_count,
            chunkTotal=len(chunks),
            resumed=True,
        )

    if pending and progress_callback:
        progress_callback(
            f"开始并行蒸馏 {len(pending)} 个知识分片（并发 {CHUNK_DISTILL_CONCURRENCY}）…",
            min(88, 84 + max(1, int((completed_count / max(1, len(chunks))) * 6))),
            stage="chunk_distilling",
            chunkCompleted=completed_count,
            chunkTotal=len(chunks),
            resumed=completed_count > 0,
        )

    with ThreadPoolExecutor(max_workers=min(CHUNK_DISTILL_CONCURRENCY, max(1, len(pending)))) as executor:
        future_map = {
            executor.submit(_process_chunk, chunk, cache_path): (position, chunk)
            for position, chunk, cache_path in pending
        }
        for future in as_completed(future_map):
            position, chunk = future_map[future]
            shard = future.result()
            chunk_shards[position] = shard
            completed_count += 1
            if state_callback:
                state_callback(completed_count, len(chunks))
            if progress_callback:
                progress_callback(
                    f"已完成知识分片 {completed_count}/{len(chunks)}，刚完成 chunk {chunk.index}（约 {chunk.estimated_tokens} tokens）…",
                    min(88, 84 + max(1, int((completed_count / max(1, len(chunks))) * 6))),
                    stage="chunk_distilling",
                    chunkCompleted=completed_count,
                    chunkTotal=len(chunks),
                )

    return [item for item in chunk_shards if item]


def _group_chunk_shards(chunk_shards: list[dict[str, Any]], *, group_size: int) -> list[list[dict[str, Any]]]:
    return [chunk_shards[index : index + group_size] for index in range(0, len(chunk_shards), group_size)]


def _estimate_synthesis_input_shard_count(chunk_count: int) -> int:
    if chunk_count <= 0:
        return 0
    if chunk_count <= BATCH_REDUCE_THRESHOLD:
        return chunk_count
    return math.ceil(chunk_count / max(1, BATCH_REDUCE_GROUP_SIZE))


def _estimate_prefetch_reuse_from_plan(
    warmup_result: ChunkWarmupResult,
    full_plan: ChunkPlan,
) -> tuple[int, int, int, int]:
    warm_signatures = warmup_result.chunk_signatures
    full_signatures = full_plan.chunk_signatures
    shared_chunk_count = len(set(warm_signatures) & set(full_signatures))

    warm_groups = warmup_result.batch_signatures
    full_groups = full_plan.batch_signatures
    if len(full_plan.chunks) <= BATCH_REDUCE_THRESHOLD:
        shared_batch_count = 0
        full_batch_total = _estimate_synthesis_input_shard_count(len(full_plan.chunks))
    else:
        shared_batch_count = len(set(warm_groups) & set(full_groups))
        full_batch_total = len(full_groups)

    return shared_chunk_count, len(full_plan.chunks), shared_batch_count, full_batch_total


def reduce_chunk_shards(
    chunk_shards: list[dict[str, Any]],
    *,
    source: SourceDescriptor,
    package_id: str,
    client: OpenAICompatibleClient,
    pipeline_config: PipelineConfig,
    progress_callback: Any | None = None,
    state_callback: Callable[[int, int], None] | None = None,
) -> list[dict[str, Any]]:
    if len(chunk_shards) <= BATCH_REDUCE_THRESHOLD:
        return chunk_shards

    grouped = _group_chunk_shards(chunk_shards, group_size=BATCH_REDUCE_GROUP_SIZE)
    reduced_shards: list[dict[str, Any] | None] = [None] * len(grouped)
    cache_dir = _ensure_cache_dir()
    completed_batches = 0
    pending: list[tuple[int, str, list[dict[str, Any]], str]] = []

    def _process_batch(
        batch_index: int,
        batch_id: str,
        batch_shards: list[dict[str, Any]],
        cache_path: str,
    ) -> dict[str, Any]:
        prompt = _build_batch_reduce_user_prompt(
            package_id=package_id,
            source=source,
            batch_index=batch_index,
            total_batches=len(grouped),
            chunk_shards=batch_shards,
        )
        reduced = _call_json_with_validation(
            client,
            system_prompt=BATCH_REDUCE_SYSTEM_PROMPT,
            user_prompt=prompt,
            schema=DEFAULT_BATCH_SHARD_SCHEMA,
            max_tokens=client.settings.max_tokens,
            max_repair_rounds=pipeline_config.max_repair_rounds,
            normalizer=lambda payload, normalized_batch_id=batch_id: _normalize_chunk_like_payload(
                payload,
                expected_chunk_id=normalized_batch_id,
            ),
        )
        reduced["chunk_id"] = batch_id
        _save_cached_batch_shard(cache_path, reduced)
        return reduced

    for position, batch_shards in enumerate(grouped):
        batch_index = position + 1
        batch_chunk_ids = [str(item.get("chunk_id") or f"chunk_{batch_index}") for item in batch_shards]
        batch_id = f"{package_id}.batch_{batch_index:03d}"
        batch_key = _batch_cache_key(
            package_id=package_id,
            source=source,
            client=client,
            batch_chunk_ids=batch_chunk_ids,
            batch_shards=batch_shards,
        )
        cache_path = _batch_cache_path(cache_dir, batch_key)
        cached_shard = _load_cached_batch_shard(cache_path, batch_id)
        if cached_shard:
            next_completed = completed_batches + 1
            if progress_callback:
                progress_callback(
                    f"命中批次归并缓存 {batch_index}/{len(grouped)}，跳过重复归并…",
                    min(91, 89 + max(1, int((batch_index / max(1, len(grouped))) * 2))),
                    stage="batch_reducing",
                    batchCompleted=next_completed,
                    batchTotal=len(grouped),
                    cacheHint="batch_shard",
                )
            reduced_shards[position] = cached_shard
            completed_batches = next_completed
            if state_callback:
                state_callback(completed_batches, len(grouped))
            continue
        pending.append((position, batch_id, batch_shards, cache_path))

    if completed_batches and completed_batches < len(grouped) and progress_callback:
        progress_callback(
            f"检测到已有 {completed_batches}/{len(grouped)} 个知识批次缓存，将从断点继续归并…",
            min(91, 89 + max(1, int((completed_batches / max(1, len(grouped))) * 2))),
            stage="batch_reducing",
            batchCompleted=completed_batches,
            batchTotal=len(grouped),
            resumed=True,
        )

    if pending and progress_callback:
        progress_callback(
            f"开始并行归并 {len(pending)} 个知识批次（并发 {BATCH_REDUCE_CONCURRENCY}）…",
            min(91, 89 + max(1, int((completed_batches / max(1, len(grouped))) * 2))),
            stage="batch_reducing",
            batchCompleted=completed_batches,
            batchTotal=len(grouped),
            resumed=completed_batches > 0,
        )

    with ThreadPoolExecutor(max_workers=min(BATCH_REDUCE_CONCURRENCY, max(1, len(pending)))) as executor:
        future_map = {
            executor.submit(_process_batch, position + 1, batch_id, batch_shards, cache_path): (position, batch_id)
            for position, batch_id, batch_shards, cache_path in pending
        }
        for future in as_completed(future_map):
            position, batch_id = future_map[future]
            reduced_shards[position] = future.result()
            completed_batches += 1
            if state_callback:
                state_callback(completed_batches, len(grouped))
            if progress_callback:
                progress_callback(
                    f"已完成知识批次 {completed_batches}/{len(grouped)}，刚完成 {batch_id} …",
                    min(91, 89 + max(1, int((completed_batches / max(1, len(grouped))) * 2))),
                    stage="batch_reducing",
                    batchCompleted=completed_batches,
                    batchTotal=len(grouped),
                )

    return [item for item in reduced_shards if item]


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
    parts = re.split(r"[；;。.!?\n]|(?<=[^0-9])[、，,](?=[^0-9])", normalized)
    return _take_unique_texts(parts, limit=limit)


def _make_item_id(node_id: str, kind: str, index: int) -> str:
    anchor = _slugify(node_id, "node")[:20]
    return f"{kind}_{anchor}_{index:02d}"[:64]


def _build_concepts(node_id: str, title: str, text: str) -> list[dict[str, Any]]:
    concepts: list[dict[str, Any]] = []
    if title:
        concepts.append(
            {
                "id": _make_item_id(node_id, "concept", 1),
                "name": title[:64],
                "explanation": text[:240] or f"围绕 {title} 展开的核心知识。",
                "evidence": [],
            }
        )

    for index, point in enumerate(_split_brief_points(text, limit=3), start=2):
        if title and point.casefold() == title.casefold():
            continue
        concepts.append(
            {
                "id": _make_item_id(node_id, "concept", index),
                "name": point[:64],
                "explanation": point[:240],
                "evidence": [],
            }
        )
        if len(concepts) >= 4:
            break

    return concepts


def _build_examples(node_id: str, title: str, text: str) -> list[dict[str, Any]]:
    if not text:
        return []
    return [
        {
            "id": _make_item_id(node_id, "example", 1),
            "title": title[:64] or "示例",
            "scenario": text[:240],
            "takeaway": _split_brief_points(text, limit=1)[0] if _split_brief_points(text, limit=1) else text[:120],
        }
    ]


def _build_knowledge_block(node_id: str, title: str, text: str) -> dict[str, Any]:
    summary = _to_clean_text(text)
    return {
        "concepts": _build_concepts(node_id, title, summary),
        "examples": _build_examples(node_id, title, summary),
        "checkpoints": _take_unique_texts([f"能用自己的话解释 {title}。", *_split_brief_points(summary, limit=2)], limit=3),
        "common_mistakes": [],
    }


def _normalize_asset_refs(values: Iterable[Any], related_node_ids: list[str] | None = None) -> list[dict[str, Any]]:
    related_node_ids = related_node_ids or []
    assets: list[dict[str, Any]] = []
    for index, value in enumerate(_take_unique_texts(values, limit=12), start=1):
        assets.append(
            {
                "id": f"asset_{_slugify(value, f'item_{index}')}",
                "asset_type": "other",
                "title": value[:120],
                "status": "missing",
                "related_node_ids": related_node_ids,
            }
        )
    return assets


def _normalize_gaps(values: Iterable[Any], related_node_ids: list[str] | None = None) -> list[dict[str, Any]]:
    related_node_ids = related_node_ids or []
    gaps: list[dict[str, Any]] = []
    for index, value in enumerate(_take_unique_texts(values, limit=12), start=1):
        gaps.append(
            {
                "id": f"gap_{_slugify(value, f'item_{index}')}",
                "gap_type": "visual_context",
                "severity": "medium",
                "description": value[:240],
                "affected_node_ids": related_node_ids,
            }
        )
    return gaps


def _match_node_id(label: str, title_to_id: dict[str, str]) -> str:
    normalized = _to_clean_text(label).casefold()
    if not normalized:
        return ""
    if normalized in title_to_id:
        return title_to_id[normalized]
    for title, node_id in title_to_id.items():
        if normalized in title or title in normalized:
            return node_id
    return ""


def _make_node_id(kind: str, index: int, title: str, parent_id: str = "") -> str:
    slug = _slugify(title, f"{kind}_{index}")[:18]
    if parent_id:
        return f"{parent_id}.{kind[0]}{index:02d}_{slug}"[:64]
    return f"{kind[:2]}{index:02d}_{slug}"[:64]


def _count_leaf_lessons(node: dict[str, Any]) -> int:
    children = [item for item in (node.get("children") or []) if isinstance(item, dict)]
    if not children:
        return 1 if str(node.get("node_type") or "") == "lesson" else 0
    total = sum(_count_leaf_lessons(child) for child in children)
    return total or (1 if str(node.get("node_type") or "") == "lesson" else 0)


def _derive_group_theme(nodes: list[dict[str, Any]], group_index: int) -> str:
    titles = [_to_clean_text(node.get("title")) for node in nodes]
    titles = [title for title in titles if title]
    if not titles:
        return f"学习阶段 {group_index:02d}"

    common_prefix = os.path.commonprefix(titles).strip(" ·-|:：,，、")
    if len(common_prefix) >= 4:
        return common_prefix[:24]

    first_title = titles[0][:20]
    return first_title or f"学习阶段 {group_index:02d}"


def _derive_group_theme_from_hints(nodes: list[dict[str, Any]]) -> str:
    weighted_haystacks: list[tuple[int, str]] = []
    for node in nodes:
        title = _to_clean_text(node.get("title"))
        summary = _to_clean_text(node.get("summary"))
        if title:
            weighted_haystacks.append((3, title))
        if summary:
            weighted_haystacks.append((1, summary))
        for child in (node.get("children") or []):
            if isinstance(child, dict):
                child_title = _to_clean_text(child.get("title"))
                if child_title:
                    weighted_haystacks.append((2, child_title))

    if not weighted_haystacks:
        return ""

    scored: list[tuple[int, str]] = []
    for label, keywords in STAGE_THEME_HINTS:
        score = 0
        for weight, haystack in weighted_haystacks:
            lowered = haystack.lower()
            score += sum(weight for keyword in keywords if keyword.lower() in lowered)
        if score > 0:
            scored.append((score, label))

    if not scored:
        return ""

    scored.sort(key=lambda item: (-item[0], item[1]))
    return scored[0][1]


def _build_stage_title(nodes: list[dict[str, Any]], group_index: int) -> str:
    hinted_theme = _derive_group_theme_from_hints(nodes)
    if hinted_theme:
        return f"阶段 {group_index:02d} · {hinted_theme}"

    theme = _derive_group_theme(nodes, group_index)
    unique_titles = _take_unique_texts([_to_clean_text(node.get("title")) for node in nodes], limit=3)
    if len(unique_titles) >= 2 and len(theme) < 5:
        theme = "、".join(unique_titles[:2])
    return f"阶段 {group_index:02d} · {theme}"


def _refresh_existing_stage_titles(chapters: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    refreshed: list[dict[str, Any]] = []
    changed = False

    for index, chapter in enumerate(chapters, start=1):
        title = _to_clean_text(chapter.get("title"))
        children = [child for child in (chapter.get("children") or []) if isinstance(child, dict)]
        if not children or not (title.startswith("学习阶段 ") or title.startswith("阶段 ")):
            refreshed.append(chapter)
            continue

        next_title = _build_stage_title(children, index)
        next_summary = _build_stage_summary(children)[:240]
        next_objectives = _build_stage_learning_objectives(children, next_title)
        next_chapter = deepcopy(chapter)
        next_chapter["title"] = next_title[:120]
        next_chapter["summary"] = next_summary
        next_chapter["learning_objectives"] = next_objectives
        next_chapter["knowledge"] = _build_knowledge_block(str(chapter.get("id") or next_title), next_title, next_summary)
        refreshed.append(next_chapter)
        changed = changed or next_title != title or next_summary != _to_clean_text(chapter.get("summary"))

    return refreshed, changed


def _dedupe_stage_titles(chapters: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    suffixes = ["进阶", "实战", "综合", "拓展"]
    seen: dict[str, int] = {}
    refreshed: list[dict[str, Any]] = []
    changed = False

    for chapter in chapters:
        title = _to_clean_text(chapter.get("title"))
        _, _, theme_part = title.partition(" · ")
        title_key = theme_part or title
        count = seen.get(title_key, 0)
        seen[title_key] = count + 1
        if count == 0 or not title:
            refreshed.append(chapter)
            continue

        suffix = suffixes[min(count - 1, len(suffixes) - 1)]
        next_title = f"{title} · {suffix}"
        next_chapter = deepcopy(chapter)
        next_chapter["title"] = next_title[:120]
        summary = _to_clean_text(chapter.get("summary"))
        children = [child for child in (chapter.get("children") or []) if isinstance(child, dict)]
        if children:
            next_chapter["learning_objectives"] = _build_stage_learning_objectives(children, next_title)
            next_chapter["knowledge"] = _build_knowledge_block(str(chapter.get("id") or next_title), next_title, summary)
        refreshed.append(next_chapter)
        changed = True

    return refreshed, changed


def _build_stage_summary(nodes: list[dict[str, Any]]) -> str:
    titles = _take_unique_texts([_to_clean_text(node.get("title")) for node in nodes], limit=4)
    if not titles:
        return "这一阶段会先帮你建立清晰主线，再带你完成关键概念、例子和自检。"
    if len(titles) == 1:
        return f"这一阶段会围绕 {titles[0]} 展开，先建立主线理解，再过一遍关键用法与易错点。"
    preview = "、".join(titles[:3])
    suffix = " 等内容" if len(titles) > 3 else ""
    return f"这一阶段会把 {preview}{suffix} 串成一条更清晰的学习主线，帮助你先理解、再应用、最后完成自检。"


def _build_stage_learning_objectives(nodes: list[dict[str, Any]], stage_title: str) -> list[str]:
    child_titles = []
    for node in nodes:
        child_titles.append(_to_clean_text(node.get("title")))
        for child in (node.get("children") or []):
            if isinstance(child, dict):
                child_titles.append(_to_clean_text(child.get("title")))
    return _take_unique_texts(
        [f"建立 {stage_title} 的整体主线", "知道这一阶段学完后要带走什么", *child_titles],
        limit=4,
    )


def _collect_node_text_fragments(node: dict[str, Any]) -> list[str]:
    fragments = [
        _to_clean_text(node.get("title")),
        _to_clean_text(node.get("summary")),
    ]
    knowledge = node.get("knowledge") if isinstance(node.get("knowledge"), dict) else {}
    fragments.extend(
        _to_clean_text(item)
        for item in (
            *(knowledge.get("checkpoints") or []),
            *(knowledge.get("common_mistakes") or []),
        )
    )
    return [fragment for fragment in fragments if fragment]


def _infer_teaching_flow_bucket(node: dict[str, Any]) -> int:
    haystack = " ".join(_collect_node_text_fragments(node)).casefold()
    if not haystack:
        return 3
    for bucket, keywords in TEACHING_FLOW_BUCKET_HINTS:
        if any(keyword.casefold() in haystack for keyword in keywords):
            return bucket
    return 3


def _resequence_children(children: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sibling_ids = {
        str(child.get("id"))
        for child in children
        if _to_clean_text(child.get("id"))
    }
    previous_id = ""
    resequenced: list[dict[str, Any]] = []
    for order, child in enumerate(children, start=1):
        next_child = deepcopy(child)
        next_child["order"] = order
        child_id = _to_clean_text(next_child.get("id"))
        external_dependencies = [
            dependency
            for dependency in (next_child.get("dependencies") or [])
            if isinstance(dependency, str) and dependency and dependency not in sibling_ids and dependency != child_id
        ]
        if previous_id:
            external_dependencies.append(previous_id)
        next_child["dependencies"] = _take_unique_texts(external_dependencies, limit=8)
        resequenced.append(next_child)
        if child_id:
            previous_id = child_id
    return resequenced


def _collect_stage_common_mistakes(children: list[dict[str, Any]]) -> list[str]:
    mistakes: list[str] = []
    for child in children:
        knowledge = child.get("knowledge") if isinstance(child.get("knowledge"), dict) else {}
        mistakes.extend(
            item
            for item in (knowledge.get("common_mistakes") or [])
            if isinstance(item, str) and _to_clean_text(item)
        )
    return _take_unique_texts(mistakes, limit=4)


def _build_stage_quiz_questions(parent_title: str, children: list[dict[str, Any]], common_mistakes: list[str]) -> list[str]:
    preview_titles = _take_unique_texts([child.get("title") for child in children], limit=3)
    questions: list[str] = []
    if preview_titles:
        questions.append(f"如果要你用自己的话说明“{preview_titles[0]}”在 {parent_title} 里的作用，你会怎么讲？")
    if len(preview_titles) >= 2:
        questions.append(f"学完“{preview_titles[0]}”以后，为什么还要继续掌握“{preview_titles[1]}”？请说出它们之间的衔接。")
    if common_mistakes:
        questions.append(f"有人在这一阶段常犯“{common_mistakes[0]}”这样的错误，你会怎么提醒他纠正？")
    elif preview_titles:
        questions.append(f"如果把 {parent_title} 真正用起来，你觉得最容易忽略的细节会是什么？为什么？")
    return _take_unique_texts(questions, limit=3)


def _build_stage_quiz_examples(node_id: str, questions: list[str]) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    for index, question in enumerate(questions, start=1):
        examples.append(
            {
                "id": _make_item_id(node_id, "example", index),
                "title": f"阶段小测 {index}",
                "scenario": question[:240],
                "takeaway": "先试着用自己的话回答，再回头检查复盘要点。",
            }
        )
    return examples


def _is_stage_recap_node(node: dict[str, Any]) -> bool:
    title = _to_clean_text(node.get("title")).casefold()
    return bool(title) and ("复盘" in title or "小测" in title or "回顾" in title)


def _build_stage_recap_node(parent_node: dict[str, Any], children: list[dict[str, Any]]) -> dict[str, Any] | None:
    base_children = [child for child in children if isinstance(child, dict) and not _is_stage_recap_node(child)]
    if len(base_children) < 2:
        return None

    parent_id = _to_clean_text(parent_node.get("id"))
    parent_title = _to_clean_text(parent_node.get("title")) or "本阶段"
    preview_titles = _take_unique_texts([child.get("title") for child in base_children], limit=3)
    preview_text = "、".join(preview_titles[:3]) if preview_titles else parent_title
    recap_title = "阶段复盘与小测"
    recap_summary = (
        f"回顾 {preview_text} 的关键概念、操作顺序与常见易错点，"
        f"检查自己是否已经把 {parent_title} 的主线真正串起来。"
    )[:240]
    recap_id = _make_node_id("lesson", len(base_children) + 1, recap_title, parent_id)
    common_mistakes = _collect_stage_common_mistakes(base_children)
    quiz_questions = _build_stage_quiz_questions(parent_title, base_children, common_mistakes)
    checkpoints = _take_unique_texts(
        [
            f"能用自己的话串起 {parent_title} 的整体主线。",
            *[f"能解释 {title} 在这一阶段中的作用。" for title in preview_titles[:2]],
            *[f"小测 {index}：{question}" for index, question in enumerate(quiz_questions, start=1)],
            "开始阶段复盘，检查自己是否真的掌握了关键知识点。",
        ],
        limit=6,
    )
    recap_knowledge = _build_knowledge_block(recap_id, recap_title, recap_summary)
    recap_knowledge["checkpoints"] = checkpoints
    recap_knowledge["common_mistakes"] = common_mistakes
    recap_knowledge["examples"] = _build_stage_quiz_examples(recap_id, quiz_questions)
    return {
        "id": recap_id,
        "node_type": "lesson",
        "title": recap_title,
        "summary": recap_summary,
        "order": len(base_children) + 1,
        "learning_objectives": _take_unique_texts(
            [f"完成 {parent_title} 的阶段复盘", *preview_titles, "通过本阶段的小测自检"],
            limit=4,
        ),
        "dependencies": [_to_clean_text(base_children[-1].get("id"))] if _to_clean_text(base_children[-1].get("id")) else [],
        "knowledge": recap_knowledge,
        "children": [],
        "assets": [],
        "gaps": [],
    }


def _restructure_node_for_teaching_flow(node: dict[str, Any], *, is_root_stage: bool = False) -> tuple[dict[str, Any], bool]:
    children = [child for child in (node.get("children") or []) if isinstance(child, dict)]
    if not children:
        return deepcopy(node), False

    changed = False
    next_node = deepcopy(node)
    processed_children: list[dict[str, Any]] = []
    for child in children:
        next_child, child_changed = _restructure_node_for_teaching_flow(child, is_root_stage=False)
        processed_children.append(next_child)
        changed = changed or child_changed

    lesson_only_children = processed_children and all(str(child.get("node_type") or "") == "lesson" for child in processed_children)
    if lesson_only_children:
        sorted_children = sorted(
            processed_children,
            key=lambda item: (_infer_teaching_flow_bucket(item), int(item.get("order") or 0)),
        )
        if [child.get("id") for child in sorted_children] != [child.get("id") for child in processed_children]:
            processed_children = sorted_children
            changed = True

    if is_root_stage:
        recap_node = _build_stage_recap_node(next_node, processed_children)
        base_children = [child for child in processed_children if not _is_stage_recap_node(child)]
        existing_recap = next((child for child in processed_children if _is_stage_recap_node(child)), None)
        if recap_node:
            processed_children = base_children + [recap_node]
            if not existing_recap or existing_recap.get("id") != recap_node.get("id") or existing_recap.get("summary") != recap_node.get("summary"):
                changed = True
        elif existing_recap:
            processed_children = base_children
            changed = True

    resequenced = _resequence_children(processed_children)
    if any(
        child.get("order") != resequenced[index].get("order")
        or child.get("dependencies") != resequenced[index].get("dependencies")
        for index, child in enumerate(processed_children)
    ):
        changed = True

    next_node["children"] = resequenced
    return next_node, changed


def _restructure_course_roots_for_teaching_flow(chapters: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    changed = False
    next_roots: list[dict[str, Any]] = []
    for chapter in chapters:
        next_chapter, chapter_changed = _restructure_node_for_teaching_flow(chapter, is_root_stage=True)
        next_roots.append(next_chapter)
        changed = changed or chapter_changed
    return next_roots, changed


def _group_root_chapters(chapters: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    if len(chapters) <= MAX_ROOT_CHAPTERS:
        return [[chapter] for chapter in chapters]

    groups: list[list[dict[str, Any]]] = []
    buffer: list[dict[str, Any]] = []
    buffer_lessons = 0

    for chapter in chapters:
        leaf_lessons = max(1, _count_leaf_lessons(chapter))
        is_micro = leaf_lessons <= MICRO_ROOT_LESSON_THRESHOLD

        if is_micro:
            buffer.append(chapter)
            buffer_lessons += leaf_lessons
            if len(buffer) >= 2 and buffer_lessons >= TARGET_GROUP_LEAF_LESSONS:
                groups.append(buffer)
                buffer = []
                buffer_lessons = 0
            continue

        if buffer:
            if buffer_lessons + leaf_lessons <= TARGET_GROUP_LEAF_LESSONS or len(buffer) == 1:
                buffer.append(chapter)
                groups.append(buffer)
                buffer = []
                buffer_lessons = 0
            else:
                groups.append(buffer)
                buffer = []
                buffer_lessons = 0
                groups.append([chapter])
        else:
            groups.append([chapter])

    if buffer:
        groups.append(buffer)

    if len(groups) <= MAX_ROOT_CHAPTERS:
        return groups

    merged: list[list[dict[str, Any]]] = []
    merge_span = max(2, math.ceil(len(groups) / MAX_ROOT_CHAPTERS))
    for index in range(0, len(groups), merge_span):
        chunk = groups[index : index + merge_span]
        flattened: list[dict[str, Any]] = []
        for group in chunk:
            flattened.extend(group)
        merged.append(flattened)
    return merged


def _compact_course_package_structure(course_package: dict[str, Any]) -> dict[str, Any]:
    chapters = [item for item in (course_package.get("chapters") or []) if isinstance(item, dict)]
    if len(chapters) <= MAX_ROOT_CHAPTERS:
        refreshed_roots, changed = _refresh_existing_stage_titles(chapters)
        deduped_roots, dedupe_changed = _dedupe_stage_titles(refreshed_roots)
        refreshed_roots, restructure_changed = _restructure_course_roots_for_teaching_flow(deduped_roots)
        changed = changed or dedupe_changed or restructure_changed
        if not changed:
            return course_package
        compacted = dict(course_package)
        compacted["chapters"] = refreshed_roots
        course_meta = dict(compacted.get("course") or {})
        course_meta["learning_outcomes"] = _take_unique_texts(
            [root.get("title") for root in refreshed_roots[:4]]
            + [child.get("title") for root in refreshed_roots for child in (root.get("children") or [])[:1] if isinstance(child, dict)],
            limit=6,
        ) or course_meta.get("learning_outcomes") or ["建立课程主线并完成关键节点学习"]
        compacted["course"] = course_meta
        return compacted

    grouped = _group_root_chapters(chapters)
    if len(grouped) >= len(chapters):
        return course_package

    compacted_roots: list[dict[str, Any]] = []
    for root_index, chapter_group in enumerate(grouped, start=1):
        if len(chapter_group) == 1 and len(grouped) <= MAX_ROOT_CHAPTERS:
            chapter = deepcopy(chapter_group[0])
            chapter["order"] = root_index
            compacted_roots.append(chapter)
            continue

        stage_title = _build_stage_title(chapter_group, root_index)
        stage_id = _make_node_id("chapter", root_index, stage_title)
        section_children: list[dict[str, Any]] = []
        for section_index, chapter in enumerate(chapter_group, start=1):
            section_node = deepcopy(chapter)
            section_node["node_type"] = "section"
            section_node["order"] = section_index
            section_children.append(section_node)

        compacted_roots.append(
            {
                "id": stage_id,
                "node_type": "chapter",
                "title": stage_title[:120],
                "summary": _build_stage_summary(chapter_group)[:240],
                "order": root_index,
                "learning_objectives": _build_stage_learning_objectives(chapter_group, stage_title),
                "dependencies": [compacted_roots[-1]["id"]] if compacted_roots else [],
                "knowledge": _build_knowledge_block(stage_id, stage_title, _build_stage_summary(chapter_group)),
                "children": section_children,
                "assets": [],
                "gaps": [],
            }
        )

    compacted = dict(course_package)
    compacted["chapters"] = compacted_roots

    dependency_graph = [item for item in (course_package.get("dependency_graph") or []) if isinstance(item, dict)]
    existing_markers = {json.dumps(item, ensure_ascii=False, sort_keys=True) for item in dependency_graph}
    for index in range(1, len(compacted_roots)):
        edge = {
            "from": compacted_roots[index - 1]["id"],
            "to": compacted_roots[index]["id"],
            "kind": "recommended",
            "reason": "压缩顶层主线后，按阶段顺序推进更容易建立整体框架。",
        }
        marker = json.dumps(edge, ensure_ascii=False, sort_keys=True)
        if marker not in existing_markers:
            dependency_graph.append(edge)
            existing_markers.add(marker)
    compacted["dependency_graph"] = dependency_graph

    compacted_roots, _ = _dedupe_stage_titles(compacted_roots)
    compacted_roots, _ = _restructure_course_roots_for_teaching_flow(compacted_roots)
    compacted["chapters"] = compacted_roots

    course_meta = dict(compacted.get("course") or {})
    course_meta["learning_outcomes"] = _take_unique_texts(
        [root.get("title") for root in compacted_roots[:4]]
        + [child.get("title") for root in compacted_roots for child in (root.get("children") or [])[:1] if isinstance(child, dict)],
        limit=6,
    ) or course_meta.get("learning_outcomes") or ["建立课程主线并完成关键节点学习"]
    compacted["course"] = course_meta
    return compacted


def _synthesize_course_package_locally(
    *,
    package_id: str,
    source: SourceDescriptor,
    chunk_shards: list[dict[str, Any]],
    text_length: int,
    ingested_at: str,
) -> dict[str, Any]:
    first_shard = chunk_shards[0] if chunk_shards else {}
    raw_chapters = []
    for shard in chunk_shards:
        raw_chapters.extend([item for item in (shard.get("chapters") or []) if isinstance(item, dict)])

    chapters: list[dict[str, Any]] = []
    title_to_id: dict[str, str] = {}
    dependency_graph: list[dict[str, Any]] = []
    previous_chapter_id = ""

    for chapter_index, raw_chapter in enumerate(raw_chapters, start=1):
        chapter_title = _to_clean_text(raw_chapter.get("title")) or f"章节 {chapter_index}"
        chapter_summary = _to_clean_text(raw_chapter.get("content")) or chapter_title
        chapter_id = _make_node_id("chapter", chapter_index, chapter_title)

        lessons: list[dict[str, Any]] = []
        previous_lesson_id = ""
        raw_sections = raw_chapter.get("children") or raw_chapter.get("sections") or raw_chapter.get("lessons") or []
        normalized_sections = [item for item in raw_sections if isinstance(item, dict)]
        if not normalized_sections and chapter_summary:
            normalized_sections = [{"title": chapter_title, "content": chapter_summary}]

        for lesson_index, raw_section in enumerate(normalized_sections, start=1):
            lesson_title = _to_clean_text(raw_section.get("title")) or f"{chapter_title} · 要点 {lesson_index}"
            lesson_summary = _to_clean_text(raw_section.get("content")) or lesson_title
            lesson_id = _make_node_id("lesson", lesson_index, lesson_title, chapter_id)
            lesson_dependencies = [previous_lesson_id] if previous_lesson_id else []
            lesson = {
                "id": lesson_id,
                "node_type": "lesson",
                "title": lesson_title[:120],
                "summary": lesson_summary[:240],
                "order": lesson_index,
                "learning_objectives": _take_unique_texts(
                    [f"理解 {lesson_title}", *_split_brief_points(lesson_summary, limit=2)],
                    limit=3,
                ),
                "dependencies": lesson_dependencies,
                "knowledge": _build_knowledge_block(lesson_id, lesson_title, lesson_summary),
                "children": [],
                "assets": [],
                "gaps": [],
            }
            lessons.append(lesson)
            title_to_id[lesson_title.casefold()] = lesson_id
            if previous_lesson_id:
                dependency_graph.append(
                    {
                        "from": previous_lesson_id,
                        "to": lesson_id,
                        "kind": "prerequisite",
                        "reason": "按课程自然讲解顺序推进。",
                    }
                )
            previous_lesson_id = lesson_id

        chapter_dependencies = [previous_chapter_id] if previous_chapter_id else []
        chapter = {
            "id": chapter_id,
            "node_type": "chapter",
            "title": chapter_title[:120],
            "summary": chapter_summary[:240],
            "order": chapter_index,
            "learning_objectives": _take_unique_texts(
                [f"掌握 {chapter_title}", *[lesson["title"] for lesson in lessons[:2]]],
                limit=3,
            ),
            "dependencies": chapter_dependencies,
            "knowledge": _build_knowledge_block(chapter_id, chapter_title, chapter_summary),
            "children": lessons,
            "assets": [],
            "gaps": [],
        }
        chapters.append(chapter)
        title_to_id[chapter_title.casefold()] = chapter_id
        if previous_chapter_id:
            dependency_graph.append(
                {
                    "from": previous_chapter_id,
                    "to": chapter_id,
                    "kind": "recommended",
                    "reason": "按章节顺序学习更容易形成主线。",
                }
            )
        previous_chapter_id = chapter_id

    if not chapters:
        fallback_title = source.title or first_shard.get("course_title_guess") or "课程概览"
        chapter_id = _make_node_id("chapter", 1, fallback_title)
        chapters = [
            {
                "id": chapter_id,
                "node_type": "chapter",
                "title": fallback_title,
                "summary": _to_clean_text(first_shard.get("overall_goal_guess")) or fallback_title,
                "order": 1,
                "learning_objectives": [f"理解 {fallback_title} 的核心主线"],
                "dependencies": [],
                "knowledge": _build_knowledge_block(chapter_id, fallback_title, _to_clean_text(first_shard.get("overall_goal_guess"))),
                "children": [],
                "assets": [],
                "gaps": [],
            }
        ]
        title_to_id[fallback_title.casefold()] = chapter_id

    for shard in chunk_shards:
        for edge in shard.get("dependency_graph") or []:
            if not isinstance(edge, dict):
                continue
            from_id = _match_node_id(edge.get("from", ""), title_to_id)
            to_id = _match_node_id(edge.get("to", ""), title_to_id)
            if not from_id or not to_id or from_id == to_id:
                continue
            relation = _to_clean_text(edge.get("type")) or _to_clean_text(edge.get("kind")) or "prerequisite"
            kind = "prerequisite" if relation not in {"recommended", "parallel"} else relation
            candidate = {
                "from": from_id,
                "to": to_id,
                "kind": kind,
                "reason": _to_clean_text(edge.get("reason")) or _to_clean_text(edge.get("type")) or "根据知识碎片中的依赖关系整理。",
            }
            marker = json.dumps(candidate, ensure_ascii=False, sort_keys=True)
            if marker not in {json.dumps(item, ensure_ascii=False, sort_keys=True) for item in dependency_graph}:
                dependency_graph.append(candidate)

    learning_outcomes = _take_unique_texts(
        [chapter["title"] for chapter in chapters[:4]]
        + [lesson["title"] for chapter in chapters for lesson in chapter.get("children", [])[:1]],
        limit=5,
    )

    assets = _normalize_asset_refs(
        [asset for shard in chunk_shards for asset in (shard.get("assets") or [])],
    )
    gaps = _normalize_gaps(
        [gap for shard in chunk_shards for gap in (shard.get("gaps") or [])],
    )

    title_guess = _to_clean_text(first_shard.get("course_title_guess")) or source.title or "课程"
    overall_goal = _to_clean_text(first_shard.get("overall_goal_guess")) or f"系统理解 {title_guess} 的核心概念与实践路径。"

    return {
        "schema_version": "onboard.course-package.v0.1",
        "package_id": package_id,
        "source": {
            "source_type": source.source_type,
            "source_id": source.source_id,
            "title": source.title,
            "creator": source.creator,
            "url": source.url,
            "language": source.language,
            "ingested_at": ingested_at,
            "text_length": text_length,
            "notes": source.notes,
        },
        "course": {
            "title": title_guess,
            "subtitle": "",
            "overall_goal": overall_goal,
            "target_audience": "希望快速建立课程主线的中文学习者",
            "prerequisites": [],
            "learning_outcomes": learning_outcomes or [f"理解 {title_guess} 的核心结构"],
            "completion_definition": "完成全部节点学习并通过章节自测。",
            "estimated_total_minutes": max(20, len(chapters) * 12),
        },
        "chapters": chapters,
        "dependency_graph": dependency_graph,
        "assets": assets,
        "gaps": gaps,
    }


def synthesize_course_package(
    *,
    package_id: str,
    source: SourceDescriptor,
    chunk_shards: list[dict[str, Any]],
    client: OpenAICompatibleClient,
    pipeline_config: PipelineConfig,
    text_length: int,
    ingested_at: str,
    progress_callback: Any | None = None,
) -> dict[str, Any]:
    schema = load_course_schema()
    if len(chunk_shards) <= FAST_SYNTH_CHUNK_THRESHOLD or (
        FORCE_LOCAL_SYNTH_SHARD_THRESHOLD > 0 and len(chunk_shards) >= FORCE_LOCAL_SYNTH_SHARD_THRESHOLD
    ):
        if progress_callback:
            progress_callback(
                "命中本地快速合成路径，正在组装课程包…",
                92,
                stage="synthesizing",
                batchCompleted=len(chunk_shards),
                batchTotal=len(chunk_shards),
                cacheHint="local_fast_synth",
            )
        local_package = _synthesize_course_package_locally(
            package_id=package_id,
            source=source,
            chunk_shards=chunk_shards,
            text_length=text_length,
            ingested_at=ingested_at,
        )
        local_package = _compact_course_package_structure(local_package)
        local_errors = MinimalSchemaValidator(schema).validate(local_package)
        if local_errors:
            raise DistillationError("快速合成结果未通过 schema 校验：\n" + "\n".join(local_errors[:20]))
        return local_package

    if progress_callback:
        progress_callback("正在合成最终课程包结构…", 92, stage="synthesizing")
    prompt = _build_final_user_prompt(
        package_id=package_id,
        source=source,
        chunk_shards=chunk_shards,
        ingested_at=ingested_at,
        text_length=text_length,
    )
    try:
        return _compact_course_package_structure(
            _call_json_with_validation(
            client,
            system_prompt=FINAL_SYSTEM_PROMPT,
            user_prompt=prompt,
            schema=schema,
            max_tokens=pipeline_config.final_max_tokens,
            max_repair_rounds=pipeline_config.max_repair_rounds,
            )
        )
    except DistillationError:
        if progress_callback:
            progress_callback("最终结构生成过慢，切换本地保底合成…", 95, stage="synthesizing")
        local_package = _synthesize_course_package_locally(
            package_id=package_id,
            source=source,
            chunk_shards=chunk_shards,
            text_length=text_length,
            ingested_at=ingested_at,
        )
        local_package = _compact_course_package_structure(local_package)
        local_errors = MinimalSchemaValidator(schema).validate(local_package)
        if local_errors:
            raise DistillationError("本地保底合成后仍未通过 schema 校验：\n" + "\n".join(local_errors[:20]))
        return local_package


def distill_to_course_package(
    raw_source: str | list[dict[str, Any]] | dict[str, Any],
    *,
    source: SourceDescriptor,
    package_id: str,
    model_settings: ModelSettings | None = None,
    pipeline_config: PipelineConfig | None = None,
    ingested_at: str,
    progress_callback: Any | None = None,
    resume_manifest_path: str | None = None,
    prepared_plan: ChunkPlan | None = None,
) -> DistillationRun:
    pipeline_started_at = perf_counter()
    pipeline_config = pipeline_config or PipelineConfig()
    model_settings = model_settings or build_default_model_settings()
    client = OpenAICompatibleClient(model_settings)

    normalize_started_at = perf_counter()
    plan = prepared_plan or prepare_chunk_plan(
        raw_source,
        package_id=package_id,
        pipeline_config=pipeline_config,
    )
    units = plan.units
    text_length = plan.text_length
    normalize_seconds = perf_counter() - normalize_started_at

    chunk_build_started_at = perf_counter()
    chunks = plan.chunks
    chunk_build_seconds = perf_counter() - chunk_build_started_at
    if progress_callback:
        progress_callback(
            f"已完成文本切片，共 {len(chunks)} 个 chunk。",
            84,
            stage="chunking",
            chunkCompleted=0,
            chunkTotal=len(chunks),
        )

    chunk_distill_started_at = perf_counter()
    chunk_shards = distill_chunks(
        chunks,
        source=source,
        package_id=package_id,
        client=client,
        pipeline_config=pipeline_config,
        progress_callback=progress_callback,
        state_callback=(
            (lambda completed, total: _write_resume_manifest(
                resume_manifest_path,
                package_id=package_id,
                source=source,
                patch={
                    "stage": "chunk_distilling",
                    "chunk_total": total,
                    "chunk_completed": completed,
                },
            ))
            if resume_manifest_path
            else None
        ),
    )
    chunk_distill_seconds = perf_counter() - chunk_distill_started_at

    batch_reduce_started_at = perf_counter()
    synthesis_input_shards = reduce_chunk_shards(
        chunk_shards,
        source=source,
        package_id=package_id,
        client=client,
        pipeline_config=pipeline_config,
        progress_callback=progress_callback,
        state_callback=(
            (lambda completed, total: _write_resume_manifest(
                resume_manifest_path,
                package_id=package_id,
                source=source,
                patch={
                    "stage": "batch_reducing",
                    "batch_total": total,
                    "batch_completed": completed,
                },
            ))
            if resume_manifest_path
            else None
        ),
    )
    batch_reduce_seconds = perf_counter() - batch_reduce_started_at

    if resume_manifest_path:
        _write_resume_manifest(
            resume_manifest_path,
            package_id=package_id,
            source=source,
            patch={
                "stage": "synthesizing",
                "chunk_total": len(chunks),
                "chunk_completed": len(chunk_shards),
                "batch_total": len(synthesis_input_shards),
                "batch_completed": len(synthesis_input_shards),
            },
        )

    synthesis_started_at = perf_counter()
    course_package = synthesize_course_package(
        package_id=package_id,
        source=source,
        chunk_shards=synthesis_input_shards,
        client=client,
        pipeline_config=pipeline_config,
        text_length=text_length,
        ingested_at=ingested_at,
        progress_callback=progress_callback,
    )
    final_synthesis_seconds = perf_counter() - synthesis_started_at
    warnings = _collect_warnings(chunks, chunk_shards, course_package)
    total_seconds = perf_counter() - pipeline_started_at
    return DistillationRun(
        course_package=course_package,
        chunks=chunks,
        chunk_shards=chunk_shards,
        stage_timings={
            "normalize_source_seconds": _round_seconds(normalize_seconds),
            "chunk_build_seconds": _round_seconds(chunk_build_seconds),
            "chunk_distill_seconds": _round_seconds(chunk_distill_seconds),
            "batch_reduce_seconds": _round_seconds(batch_reduce_seconds),
            "final_synthesis_seconds": _round_seconds(final_synthesis_seconds),
            "total_seconds": _round_seconds(total_seconds),
            "chunk_count": len(chunks),
            "chunk_shard_count": len(chunk_shards),
            "synthesis_input_shard_count": len(synthesis_input_shards),
        },
        warnings=warnings,
    )


def warm_chunk_cache(
    raw_source: str | list[dict[str, Any]] | dict[str, Any],
    *,
    source: SourceDescriptor,
    package_id: str,
    model_settings: ModelSettings | None = None,
    pipeline_config: PipelineConfig | None = None,
) -> ChunkWarmupResult:
    pipeline_config = pipeline_config or PipelineConfig()
    model_settings = model_settings or build_default_model_settings()
    if not model_settings.api_key.strip() or not model_settings.base_url.strip() or not model_settings.model.strip():
        return ChunkWarmupResult(
            chunk_count=0,
            batch_count=0,
            elapsed_seconds=0.0,
            chunk_elapsed_seconds=0.0,
            batch_elapsed_seconds=0.0,
            cache_ready=False,
            chunk_signatures=[],
            batch_signatures=[],
        )

    plan = prepare_chunk_plan(
        raw_source,
        package_id=package_id,
        pipeline_config=pipeline_config,
    )
    if not plan.units:
        return ChunkWarmupResult(
            chunk_count=0,
            batch_count=0,
            elapsed_seconds=0.0,
            chunk_elapsed_seconds=0.0,
            batch_elapsed_seconds=0.0,
            cache_ready=False,
            chunk_signatures=[],
            batch_signatures=[],
        )

    chunks = plan.chunks
    if not chunks:
        return ChunkWarmupResult(
            chunk_count=0,
            batch_count=0,
            elapsed_seconds=0.0,
            chunk_elapsed_seconds=0.0,
            batch_elapsed_seconds=0.0,
            cache_ready=False,
            chunk_signatures=[],
            batch_signatures=[],
        )

    started_at = perf_counter()
    client = OpenAICompatibleClient(model_settings)
    chunk_started_at = perf_counter()
    chunk_shards = distill_chunks(
        chunks,
        source=source,
        package_id=package_id,
        client=client,
        pipeline_config=pipeline_config,
        progress_callback=None,
        state_callback=None,
    )
    chunk_elapsed_seconds = perf_counter() - chunk_started_at

    batch_count = 0
    batch_elapsed_seconds = 0.0
    if len(chunk_shards) > BATCH_REDUCE_THRESHOLD:
        batch_started_at = perf_counter()
        synthesis_input_shards = reduce_chunk_shards(
            chunk_shards,
            source=source,
            package_id=package_id,
            client=client,
            pipeline_config=pipeline_config,
            progress_callback=None,
            state_callback=None,
        )
        batch_elapsed_seconds = perf_counter() - batch_started_at
        batch_count = len(synthesis_input_shards)

    return ChunkWarmupResult(
        chunk_count=len(chunks),
        batch_count=batch_count,
        elapsed_seconds=_round_seconds(perf_counter() - started_at),
        chunk_elapsed_seconds=_round_seconds(chunk_elapsed_seconds),
        batch_elapsed_seconds=_round_seconds(batch_elapsed_seconds),
        cache_ready=True,
        chunk_signatures=plan.chunk_signatures,
        batch_signatures=plan.batch_signatures,
    )


def save_course_package(course_package: dict[str, Any], output_path: str) -> str:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(course_package, file, ensure_ascii=False, indent=2)
    return output_path


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


def _make_page_descriptor(page: dict[str, Any], fallback_index: int) -> dict[str, Any]:
    page_no = int(page.get("page") or fallback_index)
    page_part = str(page.get("part") or "").strip() or f"P{page_no}"
    return {
        "page": page_no,
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


def _hash_subtitles(subtitles: list[dict[str, Any]]) -> str:
    serialized = json.dumps(subtitles, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(serialized.encode("utf-8")).hexdigest()[:16]


def _chunk_cache_key(
    chunk: TextChunk,
    *,
    source: SourceDescriptor,
    client: OpenAICompatibleClient,
) -> str:
    payload = {
        "version": CHUNK_CACHE_VERSION,
        "text": chunk.text,
        "page_labels": chunk.page_labels,
        "source_id": source.source_id,
        "model": client.settings.model,
        "base_url": client.settings.base_url,
        "system_prompt": CHUNK_SYSTEM_PROMPT,
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(serialized.encode("utf-8")).hexdigest()[:20]


def _chunk_cache_path(cache_dir: str, chunk_key: str) -> str:
    return os.path.join(cache_dir, f"{chunk_key}.chunk-shard.json")


def _batch_cache_key(
    *,
    package_id: str,
    source: SourceDescriptor,
    client: OpenAICompatibleClient,
    batch_chunk_ids: list[str],
    batch_shards: list[dict[str, Any]],
) -> str:
    normalized_batch_shards = [{**item, "chunk_id": ""} if isinstance(item, dict) else item for item in batch_shards]
    payload = {
        "version": BATCH_CACHE_VERSION,
        "package_id": package_id,
        "source_id": source.source_id,
        "model": client.settings.model,
        "base_url": client.settings.base_url,
        "system_prompt": BATCH_REDUCE_SYSTEM_PROMPT,
        "chunk_count": len(batch_chunk_ids),
        "batch_shards": normalized_batch_shards,
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(serialized.encode("utf-8")).hexdigest()[:20]


def _batch_cache_path(cache_dir: str, batch_key: str) -> str:
    return os.path.join(cache_dir, f"{batch_key}.batch-shard.json")


def _load_cached_chunk_shard(cache_path: str, chunk_id: str) -> dict[str, Any] | None:
    payload = _load_json_file(cache_path)
    if not payload:
        return None
    shard = payload.get("shard")
    if not isinstance(shard, dict):
        return None
    normalized_shard = dict(shard)
    normalized_shard["chunk_id"] = chunk_id
    errors = _schema_or_errors(DEFAULT_CHUNK_SHARD_SCHEMA, normalized_shard)
    if errors:
        return None
    return normalized_shard


def _save_cached_chunk_shard(cache_path: str, shard: dict[str, Any]) -> str:
    return _save_json_file(
        cache_path,
        {
            "version": CHUNK_CACHE_VERSION,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "shard": shard,
        },
    )


def _load_cached_batch_shard(cache_path: str, batch_id: str) -> dict[str, Any] | None:
    payload = _load_json_file(cache_path)
    if not payload:
        return None
    shard = payload.get("shard")
    if not isinstance(shard, dict):
        return None
    normalized_shard = dict(shard)
    normalized_shard["chunk_id"] = batch_id
    errors = _schema_or_errors(DEFAULT_BATCH_SHARD_SCHEMA, normalized_shard)
    if errors:
        return None
    return normalized_shard


def _save_cached_batch_shard(cache_path: str, shard: dict[str, Any]) -> str:
    return _save_json_file(
        cache_path,
        {
            "version": BATCH_CACHE_VERSION,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "shard": shard,
        },
    )


def _final_cache_key(
    *,
    package_id: str,
    subtitles_hash: str,
    source: SourceDescriptor,
) -> str:
    payload = {
        "version": "final-course-package.v1",
        "package_id": package_id,
        "subtitles_hash": subtitles_hash,
        "source_id": source.source_id,
        "source_type": source.source_type,
        "source_title": source.title,
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(serialized.encode("utf-8")).hexdigest()[:20]


def _final_cache_path(cache_dir: str, cache_key: str) -> str:
    return os.path.join(cache_dir, f"{cache_key}.course-package.cache.json")


def _load_cached_final_package(cache_path: str, bvid: str) -> dict[str, Any] | None:
    payload = _load_json_file(cache_path)
    if not payload:
        return None
    course_package = payload.get("course_package")
    if not isinstance(course_package, dict):
        return None
    source = course_package.get("source") or {}
    if str(source.get("source_id") or "").strip().lower() != bvid.strip().lower():
        return None
    errors = MinimalSchemaValidator(load_course_schema()).validate(course_package)
    if errors:
        return None
    return course_package


def _save_cached_final_package(cache_path: str, course_package: dict[str, Any]) -> str:
    return _save_json_file(
        cache_path,
        {
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "course_package": course_package,
        },
    )


def _read_cached_course_package(output_path: str, bvid: str) -> dict[str, Any] | None:
    payload = _load_json_file(output_path)
    if not payload:
        return None
    source = payload.get("source") or {}
    if str(source.get("source_id") or "").strip().lower() != bvid.strip().lower():
        return None
    errors = MinimalSchemaValidator(load_course_schema()).validate(payload)
    if errors:
        return None
    return payload


def _load_cached_pipeline_meta(cache_dir: str, package_id: str) -> dict[str, Any] | None:
    candidates = sorted(
        glob.glob(os.path.join(cache_dir, f"{package_id}.*.meta.json")),
        key=lambda path: os.path.getmtime(path),
        reverse=True,
    )
    for candidate in candidates:
        payload = _load_json_file(candidate)
        if not isinstance(payload, dict):
            continue
        if str(payload.get("packageId") or "") != package_id:
            continue
        return payload
    return None


def _collect_warnings(
    chunks: list[TextChunk],
    chunk_shards: list[dict[str, Any]],
    course_package: dict[str, Any],
) -> list[str]:
    warnings: list[str] = []
    if len(chunks) > 8:
        warnings.append("原始文本很长，已切成较多 chunk；最终课程结构建议人工 spot check。")
    if not course_package.get("dependency_graph"):
        warnings.append("最终课程包没有依赖边，可能意味着文本更像平铺介绍而非递进课程。")
    if not course_package.get("gaps"):
        shard_gap_count = sum(len(shard.get("gaps") or []) for shard in chunk_shards)
        if shard_gap_count > 0:
            warnings.append("chunk shard 提到过视觉缺口，但最终聚合后 gaps 为空，建议复核。")
    return warnings


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
        "batch_total": 0,
        "batch_completed": 0,
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
    batch_total = int(manifest.get("batch_total") or 0)
    batch_completed = int(manifest.get("batch_completed") or 0)
    if stage == "chunk_distilling" and chunk_total > 0:
        return f"检测到上次已完成 {chunk_completed}/{chunk_total} 个知识分片，将从断点继续。"
    if stage == "batch_reducing" and batch_total > 0:
        return f"检测到上次已完成 {batch_completed}/{batch_total} 个知识批次，将从断点继续。"
    if stage == "synthesizing":
        return "检测到上次已完成分片与批次归并，正在从最终合成阶段继续。"
    return f"检测到上次提炼停留在“{stage}”阶段，将尝试继续。"


def _format_timing_brief(stage_timings: dict[str, Any]) -> str:
    total_seconds = _round_seconds(stage_timings.get("total_seconds", 0.0))
    total_minutes = round(total_seconds / 60.0, 1) if total_seconds else 0.0
    chunk_distill_seconds = _round_seconds(stage_timings.get("chunk_distill_seconds", 0.0))
    batch_reduce_seconds = _round_seconds(stage_timings.get("batch_reduce_seconds", 0.0))
    audio_backfill_seconds = _round_seconds(stage_timings.get("audio_backfill_seconds", 0.0))
    brief = (
        f"总耗时约 {total_minutes} 分钟"
        f"；chunk 蒸馏 {chunk_distill_seconds} 秒"
        f"；批次归并 {batch_reduce_seconds} 秒"
        f"；音频补全 {audio_backfill_seconds} 秒"
    )
    prefetch_chunk_count = int(stage_timings.get("prefetch_reuse_chunk_count") or stage_timings.get("prefetch_chunk_count") or 0)
    prefetch_chunk_warm_seconds = _round_seconds(stage_timings.get("prefetch_chunk_warm_seconds", 0.0))
    prefetch_batch_count = int(stage_timings.get("prefetch_reuse_batch_count") or stage_timings.get("prefetch_batch_count") or 0)
    prefetch_batch_warm_seconds = _round_seconds(stage_timings.get("prefetch_batch_warm_seconds", 0.0))
    prefetch_chunk_ratio = _round_seconds(stage_timings.get("prefetch_reuse_chunk_ratio", 0.0))
    prefetch_batch_ratio = _round_seconds(stage_timings.get("prefetch_reuse_batch_ratio", 0.0))
    if prefetch_chunk_count > 0 and prefetch_chunk_warm_seconds > 0:
        brief += (
            f"；后台预热 {prefetch_chunk_count} 个分片（{prefetch_chunk_warm_seconds} 秒）"
            + (f"，覆盖约 {round(prefetch_chunk_ratio * 100)}%" if prefetch_chunk_ratio > 0 else "")
        )
    if prefetch_batch_count > 0 and prefetch_batch_warm_seconds > 0:
        brief += (
            f"；预热 {prefetch_batch_count} 个批次（{prefetch_batch_warm_seconds} 秒）"
            + (f"，覆盖约 {round(prefetch_batch_ratio * 100)}%" if prefetch_batch_ratio > 0 else "")
        )
    return brief


def flatten_subtitles_to_text(subtitles: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for unit in normalize_raw_source(subtitles):
        blocks.append(f"## {unit.page_label}\n{unit.text}")
    return "\n\n".join(blocks)


__all__ = [
    "CHUNK_SYSTEM_PROMPT",
    "FINAL_SYSTEM_PROMPT",
    "COURSE_SCHEMA_PATH",
    "DistillationError",
    "DistillationRun",
    "ModelSettings",
    "OpenAICompatibleClient",
    "PipelineConfig",
    "SourceDescriptor",
    "TextChunk",
    "build_chunks",
    "build_default_model_settings",
    "distill_to_course_package",
    "flatten_subtitles_to_text",
    "load_course_schema",
    "normalize_raw_source",
    "save_course_package",
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
    if "Groq" in normalized or "转写" in normalized:
        return "groq_transcript"
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


def run_distillation_from_bilibili(video_input: str) -> dict[str, Any]:
    overall_started_at = perf_counter()
    bvid = bilibili_api.extract_bvid(video_input)
    _emit_progress(f"正在解析 B 站视频：{bvid}", 8, stage="metadata")

    metadata_started_at = perf_counter()
    video_info = bilibili_api.get_video_info(bvid)
    metadata_seconds = perf_counter() - metadata_started_at
    cache_dir = _ensure_cache_dir()
    output_dir = config.ensure_output_dir()
    filename = f"{config.sanitize_filename(str(video_info.get('title') or bvid))}.course-package.json"
    output_path = os.path.join(output_dir, filename)
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
            batchCompleted=int(existing_manifest.get("batch_completed") or 0),
            batchTotal=int(existing_manifest.get("batch_total") or 0),
        )
    subtitle_bundle_cache_path = os.path.join(cache_dir, f"{str(video_info.get('bvid') or bvid).lower()}.subtitle-bundle.json")
    transcript_cache_path = os.path.join(cache_dir, f"{str(video_info.get('bvid') or bvid).lower()}.transcript.json")
    transcript_page_cache_path = os.path.join(cache_dir, f"{str(video_info.get('bvid') or bvid).lower()}.transcript-pages.json")
    pages = video_info.get("pages") or [{"cid": video_info.get("cid"), "part": video_info.get("title", ""), "page": 1}]
    pipeline_config = PipelineConfig()
    model_settings = build_default_model_settings()
    warmup_executor: ThreadPoolExecutor | None = None
    warmup_future = None
    warmup_result: ChunkWarmupResult | None = None
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
    cached_pipeline_meta = _load_cached_pipeline_meta(cache_dir, package_id)
    cached_manifest_stage_timings = (
        dict(existing_manifest.get("stage_timings") or {})
        if existing_manifest and isinstance(existing_manifest.get("stage_timings"), dict)
        else {}
    )

    cached_package = _read_cached_course_package(output_path, str(video_info.get("bvid") or bvid))
    if cached_package:
        _emit_progress("命中本地课程包缓存，跳过抓取与蒸馏。", 100, stage="cache", cacheHint="course_package")
        overall_seconds = perf_counter() - overall_started_at
        chunk_count = (
            int(cached_pipeline_meta.get("chunkCount") or 0)
            if cached_pipeline_meta
            else int(existing_manifest.get("chunk_total") or 0) if existing_manifest else 0
        )
        warning_count = int(cached_pipeline_meta.get("warningCount") or 0) if cached_pipeline_meta else 0
        cached_stage_timings = (
            dict(cached_pipeline_meta.get("stageTimings") or {})
            if cached_pipeline_meta and isinstance(cached_pipeline_meta.get("stageTimings"), dict)
            else dict(cached_manifest_stage_timings)
        )
        _write_resume_manifest(
            resume_manifest_path,
            package_id=package_id,
            source=SourceDescriptor(
                source_type=str((cached_package.get("source") or {}).get("source_type") or "cached_course_package"),
                source_id=str((cached_package.get("source") or {}).get("source_id") or bvid),
                title=str(video_info.get("title") or bvid),
            ),
            patch={
                "stage": "completed",
                "finished": True,
                "package_path": output_path,
                "chunk_total": chunk_count,
                "chunk_completed": chunk_count,
                "batch_total": int(((cached_stage_timings.get("pipeline") or {}).get("synthesis_input_shard_count")) or 0),
                "batch_completed": int(((cached_stage_timings.get("pipeline") or {}).get("synthesis_input_shard_count")) or 0),
                "stage_timings": cached_stage_timings,
            },
        )
        return {
            "packagePath": output_path,
            "packageId": str(cached_package.get("package_id") or ""),
            "title": str(video_info.get("title") or bvid),
            "bvid": str(video_info.get("bvid") or bvid),
            "textSourceType": str((cached_package.get("source") or {}).get("source_type") or ""),
            "textSourceNote": str((cached_package.get("source") or {}).get("notes") or "已复用本地课程包缓存。"),
            "chunkCount": chunk_count,
            "warningCount": warning_count,
            "warnings": ["命中本地课程包缓存，已跳过重复提炼。"],
            "stageTimings": {
                **cached_stage_timings,
                "metadata_seconds": _round_seconds(metadata_seconds),
                "cache_total_seconds": _round_seconds(overall_seconds),
                "historical_total_seconds": _round_seconds(cached_stage_timings.get("total_seconds", 0.0)),
                "historical_distill_seconds": _round_seconds(cached_stage_timings.get("distill_seconds", 0.0)),
                "historical_audio_backfill_seconds": _round_seconds(cached_stage_timings.get("audio_backfill_seconds", 0.0)),
                "total_seconds": _round_seconds(overall_seconds),
                "cache_hit": "course_package",
            },
        }

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
    prefetch_chunk_warm_seconds = 0.0
    prefetch_chunk_count = 0
    prefetch_batch_warm_seconds = 0.0
    prefetch_batch_count = 0
    prefetch_reuse_chunk_count = 0
    prefetch_reuse_chunk_total = 0
    prefetch_reuse_batch_count = 0
    prefetch_reuse_batch_total = 0
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
        _emit_progress("已获取字幕，开始蒸馏课程结构…", 34, stage="subtitle")

        if pages_without_subtitles:
            missing_audio_total = len(audio_completed_pages) + len(pages_without_subtitles)
            if os.getenv("ONBOARD_ENABLE_PREFETCH_DISTILL", "1").strip() not in {"0", "false", "False"}:
                warmup_source = _build_source_descriptor(video_info, video_input, text_source_note, text_source_type)
                try:
                    warmup_executor = ThreadPoolExecutor(max_workers=1)
                    warmup_future = warmup_executor.submit(
                        warm_chunk_cache,
                        subtitles,
                        source=warmup_source,
                        package_id=package_id,
                        model_settings=model_settings,
                        pipeline_config=pipeline_config,
                    )
                    _emit_progress(
                        "已拿到部分字幕，后台预热可蒸馏片段，同时补全缺失分P…",
                        36,
                        stage="subtitle",
                        cacheHint="chunk_prefetch",
                    )
                except Exception:
                    warmup_future = None
                    if warmup_executor:
                        warmup_executor.shutdown(wait=False)
                        warmup_executor = None
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
                text_source_type = str(transcript_cache.get("source_type") or "groq_transcript")
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

    if warmup_future is not None:
        try:
            warmup_result = warmup_future.result()
            prefetch_chunk_warm_seconds = float(warmup_result.elapsed_seconds or 0.0)
            prefetch_chunk_count = int(warmup_result.chunk_count or 0)
            prefetch_batch_warm_seconds = float(warmup_result.batch_elapsed_seconds or 0.0)
            prefetch_batch_count = int(warmup_result.batch_count or 0)
            if warmup_result.cache_ready and prefetch_chunk_count > 0:
                _emit_progress(
                    (
                        f"后台预热完成，已有 {prefetch_chunk_count} 个知识分片"
                        + (f"、{prefetch_batch_count} 个知识批次" if prefetch_batch_count > 0 else "")
                        + " 可直接复用缓存。"
                    ),
                    48,
                    stage="audio",
                    cacheHint="chunk_prefetch",
                    chunkCompleted=prefetch_chunk_count,
                    chunkTotal=prefetch_chunk_count,
                    batchCompleted=prefetch_batch_count,
                    batchTotal=prefetch_batch_count,
                )
        except Exception:
            warmup_result = None
        finally:
            if warmup_executor:
                warmup_executor.shutdown(wait=False)

    ingested_at = datetime.now(timezone.utc).isoformat()
    source = _build_source_descriptor(video_info, video_input, text_source_note, text_source_type)
    subtitles_hash = _hash_subtitles(subtitles)
    final_cache_path = _final_cache_path(
        cache_dir,
        _final_cache_key(
            package_id=package_id,
            subtitles_hash=subtitles_hash,
            source=source,
        ),
    )

    cached_final_package = _load_cached_final_package(final_cache_path, str(video_info.get("bvid") or bvid))
    if cached_final_package:
        save_course_package(cached_final_package, output_path)
        _emit_progress("命中最终课程包缓存，跳过结构重建。", 100, stage="cache", cacheHint="final_course_package")
        overall_seconds = perf_counter() - overall_started_at
        chunk_count = (
            int(cached_pipeline_meta.get("chunkCount") or 0)
            if cached_pipeline_meta
            else int(existing_manifest.get("chunk_total") or 0) if existing_manifest else 0
        )
        warning_count = int(cached_pipeline_meta.get("warningCount") or 0) if cached_pipeline_meta else 0
        cached_stage_timings = (
            dict(cached_pipeline_meta.get("stageTimings") or {})
            if cached_pipeline_meta and isinstance(cached_pipeline_meta.get("stageTimings"), dict)
            else dict(cached_manifest_stage_timings)
        )
        _write_resume_manifest(
            resume_manifest_path,
            package_id=package_id,
            source=source,
            patch={
                "stage": "completed",
                "finished": True,
                "package_path": output_path,
                "chunk_total": chunk_count,
                "chunk_completed": chunk_count,
                "batch_total": int(((cached_stage_timings.get("pipeline") or {}).get("synthesis_input_shard_count")) or 0),
                "batch_completed": int(((cached_stage_timings.get("pipeline") or {}).get("synthesis_input_shard_count")) or 0),
                "stage_timings": cached_stage_timings,
            },
        )
        return {
            "packagePath": output_path,
            "packageId": str(cached_final_package.get("package_id") or package_id),
            "title": str(video_info.get("title") or bvid),
            "bvid": str(video_info.get("bvid") or bvid),
            "textSourceType": text_source_type,
            "textSourceNote": text_source_note,
            "chunkCount": chunk_count,
            "warningCount": warning_count,
            "warnings": ["命中最终课程包缓存，已跳过重复结构重建。"],
            "stageTimings": {
                **cached_stage_timings,
                "metadata_seconds": _round_seconds(metadata_seconds),
                "subtitle_fetch_seconds": _round_seconds(subtitle_fetch_seconds),
                "audio_backfill_seconds": _round_seconds(audio_backfill_seconds),
                "cache_total_seconds": _round_seconds(overall_seconds),
                "historical_total_seconds": _round_seconds(cached_stage_timings.get("total_seconds", 0.0)),
                "historical_distill_seconds": _round_seconds(cached_stage_timings.get("distill_seconds", 0.0)),
                "historical_audio_backfill_seconds": _round_seconds(cached_stage_timings.get("audio_backfill_seconds", 0.0)),
                "total_seconds": _round_seconds(overall_seconds),
                "cache_hit": "final_course_package",
            },
        }

    full_plan = prepare_chunk_plan(
        subtitles,
        package_id=package_id,
        pipeline_config=pipeline_config,
    )
    if warmup_result and warmup_result.cache_ready and prefetch_chunk_count > 0:
        try:
            (
                prefetch_reuse_chunk_count,
                prefetch_reuse_chunk_total,
                prefetch_reuse_batch_count,
                prefetch_reuse_batch_total,
            ) = _estimate_prefetch_reuse_from_plan(
                warmup_result,
                full_plan,
            )
            chunk_ratio = (
                prefetch_reuse_chunk_count / prefetch_reuse_chunk_total
                if prefetch_reuse_chunk_total > 0
                else 0.0
            )
            batch_ratio = (
                prefetch_reuse_batch_count / prefetch_reuse_batch_total
                if prefetch_reuse_batch_total > 0
                else 0.0
            )
            ratio_parts = [
                f"预计复用 {prefetch_reuse_chunk_count}/{prefetch_reuse_chunk_total} 个分片"
                if prefetch_reuse_chunk_total > 0
                else "",
                f"{prefetch_reuse_batch_count}/{prefetch_reuse_batch_total} 个批次"
                if prefetch_reuse_batch_total > 0 and prefetch_reuse_batch_count > 0
                else "",
            ]
            ratio_parts = [part for part in ratio_parts if part]
            _emit_progress(
                "后台预热已对齐完整链路，"
                + "，".join(ratio_parts)
                + (
                    f"（分片覆盖 {round(chunk_ratio * 100)}%"
                    + (f"，批次覆盖 {round(batch_ratio * 100)}%" if prefetch_reuse_batch_total > 0 else "")
                    + "）。"
                ),
                52,
                stage="chunking",
                cacheHint="chunk_prefetch",
                chunkCompleted=prefetch_reuse_chunk_count,
                chunkTotal=prefetch_reuse_chunk_total,
                batchCompleted=prefetch_reuse_batch_count,
                batchTotal=prefetch_reuse_batch_total,
                prefetchReuseChunkRatio=_round_seconds(chunk_ratio),
                prefetchReuseBatchRatio=_round_seconds(batch_ratio),
            )
        except Exception:
            prefetch_reuse_chunk_count = 0
            prefetch_reuse_chunk_total = 0
            prefetch_reuse_batch_count = 0
            prefetch_reuse_batch_total = 0

    distill_started_at = perf_counter()
    run = distill_to_course_package(
        subtitles,
        source=source,
        package_id=package_id,
        model_settings=model_settings,
        pipeline_config=pipeline_config,
        ingested_at=ingested_at,
        progress_callback=_emit_progress,
        resume_manifest_path=resume_manifest_path,
        prepared_plan=full_plan,
    )
    distill_seconds = perf_counter() - distill_started_at

    save_course_package(run.course_package, output_path)
    _save_cached_final_package(final_cache_path, run.course_package)
    overall_seconds = perf_counter() - overall_started_at
    stage_timings = {
        "metadata_seconds": _round_seconds(metadata_seconds),
        "subtitle_fetch_seconds": _round_seconds(subtitle_fetch_seconds),
        "audio_backfill_seconds": _round_seconds(audio_backfill_seconds),
        "prefetch_chunk_warm_seconds": _round_seconds(prefetch_chunk_warm_seconds),
        "prefetch_chunk_count": prefetch_chunk_count,
        "prefetch_reuse_chunk_count": prefetch_reuse_chunk_count,
        "prefetch_reuse_chunk_total": prefetch_reuse_chunk_total,
        "prefetch_reuse_chunk_ratio": _round_seconds(
            prefetch_reuse_chunk_count / prefetch_reuse_chunk_total if prefetch_reuse_chunk_total > 0 else 0.0
        ),
        "prefetch_batch_warm_seconds": _round_seconds(prefetch_batch_warm_seconds),
        "prefetch_batch_count": prefetch_batch_count,
        "prefetch_reuse_batch_count": prefetch_reuse_batch_count,
        "prefetch_reuse_batch_total": prefetch_reuse_batch_total,
        "prefetch_reuse_batch_ratio": _round_seconds(
            prefetch_reuse_batch_count / prefetch_reuse_batch_total if prefetch_reuse_batch_total > 0 else 0.0
        ),
        "distill_seconds": _round_seconds(distill_seconds),
        "total_seconds": _round_seconds(overall_seconds),
        "pipeline": run.stage_timings,
    }
    _save_json_file(
        os.path.join(cache_dir, f"{package_id}.{subtitles_hash}.meta.json"),
        {
            "packagePath": output_path,
            "packageId": package_id,
            "bvid": str(video_info.get("bvid") or bvid),
            "chunkCount": len(run.chunks),
            "warningCount": len(run.warnings),
            "sourceType": text_source_type,
            "sourceNote": text_source_note,
            "stageTimings": stage_timings,
        },
    )
    _write_resume_manifest(
        resume_manifest_path,
        package_id=package_id,
        source=source,
        patch={
            "stage": "completed",
            "finished": True,
            "package_path": output_path,
            "chunk_total": len(run.chunks),
            "chunk_completed": len(run.chunk_shards),
            "batch_total": int(run.stage_timings.get("synthesis_input_shard_count") or 0),
            "batch_completed": int(run.stage_timings.get("synthesis_input_shard_count") or 0),
            "stage_timings": stage_timings,
        },
    )

    return {
        "packagePath": output_path,
        "packageId": package_id,
        "title": str(video_info.get("title") or bvid),
        "bvid": str(video_info.get("bvid") or bvid),
        "textSourceType": text_source_type,
        "textSourceNote": text_source_note,
        "chunkCount": len(run.chunks),
        "warningCount": len(run.warnings),
        "warnings": [*run.warnings, _format_timing_brief(stage_timings)],
        "stageTimings": stage_timings,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Onboard Anything 蒸馏入口")
    parser.add_argument("video", nargs="?", help="B 站视频链接或 BV 号")
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
        result = run_distillation_from_bilibili(args.video)
        _emit_progress("课程蒸馏完成，正在回传桌面端…", 100, stage="complete")
        if args.result_json:
            print("__ONBOARD_DISTILL_RESULT__=" + json.dumps(result, ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:
        print(f"蒸馏失败：{exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

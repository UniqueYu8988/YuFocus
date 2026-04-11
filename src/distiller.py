# -*- coding: utf-8 -*-
"""Onboard Anything 的课程蒸馏管线。"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import re
import sys
from typing import Any, Iterable

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
CHUNK_CACHE_VERSION = "chunk-shard.v1"

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
- 每个节点都要尽量带上 concepts、examples、checkpoints、common_mistakes。
- 如果信息不足，允许字段为空，但不得编造。
- 如果缺失视觉上下文，必须写入 gaps。
- 任何 node id 必须稳定、唯一、可引用。
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
class DistillationRun:
    course_package: dict[str, Any]
    chunks: list[TextChunk]
    chunk_shards: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)


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

    def flush() -> None:
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
        overlap = current_units[-pipeline_config.chunk_overlap_units :] if pipeline_config.chunk_overlap_units > 0 else []
        current_units = list(overlap)
        current_tokens = sum(unit.estimated_tokens for unit in current_units)
        has_fresh_units = False

    for unit in units:
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


def _call_json_with_validation(
    client: OpenAICompatibleClient,
    *,
    system_prompt: str,
    user_prompt: str,
    schema: dict[str, Any],
    max_tokens: int,
    max_repair_rounds: int,
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


def distill_chunks(
    chunks: list[TextChunk],
    *,
    source: SourceDescriptor,
    package_id: str,
    client: OpenAICompatibleClient,
    pipeline_config: PipelineConfig,
    progress_callback: Any | None = None,
) -> list[dict[str, Any]]:
    chunk_shards: list[dict[str, Any]] = []
    cache_dir = _ensure_cache_dir()
    for chunk in chunks:
        chunk_key = _chunk_cache_key(chunk, source=source, client=client)
        cache_path = _chunk_cache_path(cache_dir, chunk_key)
        cached_shard = _load_cached_chunk_shard(cache_path, chunk.chunk_id)
        if cached_shard:
            if progress_callback:
                progress_callback(
                    f"命中知识分片缓存 {chunk.index}/{len(chunks)}，跳过重复蒸馏…",
                    min(88, 84 + max(1, int((chunk.index / max(1, len(chunks))) * 6))),
                )
            chunk_shards.append(cached_shard)
            continue
        if progress_callback:
            progress_callback(
                f"正在蒸馏知识分片 {chunk.index}/{len(chunks)}（约 {chunk.estimated_tokens} tokens）…",
                min(88, 84 + max(1, int((chunk.index / max(1, len(chunks))) * 6))),
            )
        prompt = _build_chunk_user_prompt(chunk=chunk, source=source, package_id=package_id)
        shard = _call_json_with_validation(
            client,
            system_prompt=CHUNK_SYSTEM_PROMPT,
            user_prompt=prompt,
            schema=DEFAULT_CHUNK_SHARD_SCHEMA,
            max_tokens=client.settings.max_tokens,
            max_repair_rounds=pipeline_config.max_repair_rounds,
        )
        shard["chunk_id"] = chunk.chunk_id
        _save_cached_chunk_shard(cache_path, shard)
        chunk_shards.append(shard)
    return chunk_shards


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
    if len(chunk_shards) <= FAST_SYNTH_CHUNK_THRESHOLD:
        if progress_callback:
            progress_callback("命中快速合成路径，正在本地组装课程包…", 92)
        local_package = _synthesize_course_package_locally(
            package_id=package_id,
            source=source,
            chunk_shards=chunk_shards,
            text_length=text_length,
            ingested_at=ingested_at,
        )
        local_errors = MinimalSchemaValidator(schema).validate(local_package)
        if local_errors:
            raise DistillationError("快速合成结果未通过 schema 校验：\n" + "\n".join(local_errors[:20]))
        return local_package

    if progress_callback:
        progress_callback("正在合成最终课程包结构…", 92)
    prompt = _build_final_user_prompt(
        package_id=package_id,
        source=source,
        chunk_shards=chunk_shards,
        ingested_at=ingested_at,
        text_length=text_length,
    )
    try:
        return _call_json_with_validation(
            client,
            system_prompt=FINAL_SYSTEM_PROMPT,
            user_prompt=prompt,
            schema=schema,
            max_tokens=pipeline_config.final_max_tokens,
            max_repair_rounds=pipeline_config.max_repair_rounds,
        )
    except DistillationError:
        if progress_callback:
            progress_callback("最终结构生成过慢，切换本地保底合成…", 95)
        local_package = _synthesize_course_package_locally(
            package_id=package_id,
            source=source,
            chunk_shards=chunk_shards,
            text_length=text_length,
            ingested_at=ingested_at,
        )
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
) -> DistillationRun:
    pipeline_config = pipeline_config or PipelineConfig()
    model_settings = model_settings or build_default_model_settings()
    client = OpenAICompatibleClient(model_settings)

    units = normalize_raw_source(raw_source, target_chars=pipeline_config.sentence_group_chars)
    text_length = sum(len(unit.text) for unit in units)
    chunks = build_chunks(units, package_id=package_id, pipeline_config=pipeline_config)
    if progress_callback:
        progress_callback(f"已完成文本切片，共 {len(chunks)} 个 chunk。", 84)
    chunk_shards = distill_chunks(
        chunks,
        source=source,
        package_id=package_id,
        client=client,
        pipeline_config=pipeline_config,
        progress_callback=progress_callback,
    )
    course_package = synthesize_course_package(
        package_id=package_id,
        source=source,
        chunk_shards=chunk_shards,
        client=client,
        pipeline_config=pipeline_config,
        text_length=text_length,
        ingested_at=ingested_at,
        progress_callback=progress_callback,
    )
    warnings = _collect_warnings(chunks, chunk_shards, course_package)
    return DistillationRun(
        course_package=course_package,
        chunks=chunks,
        chunk_shards=chunk_shards,
        warnings=warnings,
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
        "chunk_id": chunk.chunk_id,
        "text": chunk.text,
        "source_id": source.source_id,
        "model": client.settings.model,
        "base_url": client.settings.base_url,
        "system_prompt": CHUNK_SYSTEM_PROMPT,
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(serialized.encode("utf-8")).hexdigest()[:20]


def _chunk_cache_path(cache_dir: str, chunk_key: str) -> str:
    return os.path.join(cache_dir, f"{chunk_key}.chunk-shard.json")


def _load_cached_chunk_shard(cache_path: str, chunk_id: str) -> dict[str, Any] | None:
    payload = _load_json_file(cache_path)
    if not payload:
        return None
    shard = payload.get("shard")
    if not isinstance(shard, dict):
        return None
    if str(shard.get("chunk_id") or "").strip() != chunk_id:
        return None
    errors = _schema_or_errors(DEFAULT_CHUNK_SHARD_SCHEMA, shard)
    if errors:
        return None
    return shard


def _save_cached_chunk_shard(cache_path: str, shard: dict[str, Any]) -> str:
    return _save_json_file(
        cache_path,
        {
            "version": CHUNK_CACHE_VERSION,
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


def _emit_progress(message: str, percent: int) -> None:
    print(
        "__ONBOARD_DISTILL_PROGRESS__="
        + json.dumps({"message": message, "percent": percent}, ensure_ascii=False),
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


def run_distillation_from_bilibili(video_input: str) -> dict[str, Any]:
    bvid = bilibili_api.extract_bvid(video_input)
    _emit_progress(f"正在解析 B 站视频：{bvid}", 8)

    video_info = bilibili_api.get_video_info(bvid)
    cache_dir = _ensure_cache_dir()
    output_dir = config.ensure_output_dir()
    filename = f"{config.sanitize_filename(str(video_info.get('title') or bvid))}.course-package.json"
    output_path = os.path.join(output_dir, filename)
    transcript_cache_path = os.path.join(cache_dir, f"{str(video_info.get('bvid') or bvid).lower()}.transcript.json")
    pages = video_info.get("pages") or [{"cid": video_info.get("cid"), "part": video_info.get("title", ""), "page": 1}]
    _emit_progress(f"已获取视频信息：{video_info['title']}", 18)

    cached_package = _read_cached_course_package(output_path, str(video_info.get("bvid") or bvid))
    if cached_package:
        _emit_progress("命中本地课程包缓存，跳过抓取与蒸馏。", 100)
        return {
            "packagePath": output_path,
            "packageId": str(cached_package.get("package_id") or ""),
            "title": str(video_info.get("title") or bvid),
            "bvid": str(video_info.get("bvid") or bvid),
            "textSourceType": str((cached_package.get("source") or {}).get("source_type") or ""),
            "textSourceNote": str((cached_package.get("source") or {}).get("notes") or "已复用本地课程包缓存。"),
            "chunkCount": 0,
            "warningCount": 0,
            "warnings": ["命中本地课程包缓存，已跳过重复提炼。"],
        }

    subtitle_bundle = bilibili_api.get_subtitles_bundle(video_info)
    subtitles = subtitle_bundle.get("subtitles") or []
    text_source_type = str(subtitle_bundle.get("source_type") or "")
    text_source_note = str(subtitle_bundle.get("note") or "")

    if subtitles:
        _emit_progress("已获取字幕，开始蒸馏课程结构…", 34)
    else:
        transcript_cache = _load_json_file(transcript_cache_path)
        if transcript_cache and transcript_cache.get("subtitles"):
            _emit_progress("未拿到字幕，命中本地转写缓存，跳过音频下载与转写…", 46)
            subtitles = transcript_cache.get("subtitles") or []
            text_source_type = str(transcript_cache.get("source_type") or "groq_transcript")
            text_source_note = str(transcript_cache.get("note") or "已复用本地转写缓存。")
        else:
            _emit_progress("未拿到字幕，切换到音频转写兜底…", 34)
            import audio_fallback

            transcript_bundle = audio_fallback.transcribe_video_pages(
                video_info,
                [
                    {
                        "page": int(page.get("page") or index),
                        "part": str(page.get("part") or "").strip(),
                        "label": f"P{int(page.get('page') or index)}：{str(page.get('part') or '').strip() or f'P{index}'}",
                    }
                    for index, page in enumerate(pages, start=1)
                ],
                progress_callback=_emit_progress,
            )
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
            if not subtitles:
                raise DistillationError("既未获取到字幕，也未成功完成音频转写。")

    package_id = f"{_slugify(str(video_info.get('title') or bvid), 'course')}_{str(video_info.get('bvid') or bvid).lower()}"
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
        _emit_progress("命中最终课程包缓存，跳过结构重建。", 100)
        return {
            "packagePath": output_path,
            "packageId": str(cached_final_package.get("package_id") or package_id),
            "title": str(video_info.get("title") or bvid),
            "bvid": str(video_info.get("bvid") or bvid),
            "textSourceType": text_source_type,
            "textSourceNote": text_source_note,
            "chunkCount": 0,
            "warningCount": 0,
            "warnings": ["命中最终课程包缓存，已跳过重复结构重建。"],
        }

    run = distill_to_course_package(
        subtitles,
        source=source,
        package_id=package_id,
        ingested_at=ingested_at,
        progress_callback=_emit_progress,
    )

    save_course_package(run.course_package, output_path)
    _save_cached_final_package(final_cache_path, run.course_package)
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
        "warnings": run.warnings,
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
        _emit_progress("课程蒸馏完成，正在回传桌面端…", 100)
        if args.result_json:
            print("__ONBOARD_DISTILL_RESULT__=" + json.dumps(result, ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:
        print(f"蒸馏失败：{exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

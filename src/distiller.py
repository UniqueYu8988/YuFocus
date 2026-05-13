# -*- coding: utf-8 -*-
"""Local material organizer for Codex course making.

This module is being kept as the local-first material pipeline: it fetches
subtitles/transcripts, cleans and chunks them, and prepares a Codex 原材料包.
It must not be treated as the runtime teacher or the final source of course
quality. High-quality lessons are produced later by Codex as offline Course
Package JSON, then imported into the desktop learning desk.
"""

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
import shutil
from time import perf_counter
import re
import sys
from typing import Any, Callable, Iterable
import zipfile

import requests

import bilibili_api
import config
from teacher_ready import build_teacher_ready_content


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
COURSE_SCHEMA_PATH = os.path.join(CURRENT_DIR, "schemas", "course_package.schema.json")
JSON_OBJECT_PATTERN = re.compile(r"\{.*\}", re.DOTALL)
CJK_CHAR_PATTERN = re.compile(r"[\u3400-\u9fff]")
WORD_PATTERN = re.compile(r"[A-Za-z0-9_]+")
CACHE_DIR_NAME = "cache"
FAST_SYNTH_CHUNK_THRESHOLD = max(0, int(os.getenv("ONBOARD_FAST_SYNTH_CHUNK_THRESHOLD", "0") or "0"))
BATCH_REDUCE_THRESHOLD = max(0, int(os.getenv("ONBOARD_BATCH_REDUCE_THRESHOLD", "12") or "12"))
BATCH_REDUCE_GROUP_SIZE = max(2, int(os.getenv("ONBOARD_BATCH_REDUCE_GROUP_SIZE", "8") or "8"))
CHUNK_DISTILL_CONCURRENCY = max(1, int(os.getenv("ONBOARD_CHUNK_DISTILL_CONCURRENCY", "4") or "4"))
BATCH_REDUCE_CONCURRENCY = max(1, int(os.getenv("ONBOARD_BATCH_REDUCE_CONCURRENCY", "3") or "3"))
FORCE_LOCAL_SYNTH_SHARD_THRESHOLD = max(
    0,
    int(os.getenv("ONBOARD_FORCE_LOCAL_SYNTH_SHARD_THRESHOLD", "0") or "0"),
)
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
]
CHUNK_CACHE_VERSION = "chunk-shard.v3"
BATCH_CACHE_VERSION = "chunk-batch.v2"
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
你是一个冷酷无情的知识解剖机器。你的任务是从这块网课字幕切片中，提取出“课程范围证据”。绝对不要总结！绝对不要用“大家好”、“这段讲了”等废话！

你必须只做三件事：
1. 提取核心概念（名词）。
2. 给出简短的定义、例子或用途。
3. 抽取任何明显的因果关系、先后顺序或前置依赖关系。

铁律：
- 绝对不要输出总结腔、讲课腔、主持人腔。
- 绝对不要把原文改写成流水账。
- 这一层只做证据抽取，绝对不要编造字幕中没有出现的知识点。
- 如果字幕很薄，也要尽量保留它暗示的主题、概念、使用场景和问题边界，供最终课程增密。
- 如果文本里提到“看图”“看这里”“画面上”“这个表格”“如下图示”但你拿不到视觉信息，必须把它登记为 gaps。
- 你抽取的是知识碎片，不是最终课程包，所以要克制，只保留当前 chunk 能确认的内容。
- 如果证据不足，宁可留空数组，也不要自作聪明脑补。

输出要求：
- 严格以 JSON 格式输出。
- 只输出一个 JSON 对象。
- 不要输出 Markdown，不要输出解释，不要输出代码块。
""".strip()

FINAL_SYSTEM_PROMPT = """
你是一个顶级的课程教研专家。你收到了刚才按顺序提取出来的知识碎片数组。请你把“网课字幕”当作知识范围和证据边界，而不是课程质量上限：字幕负责告诉你这门课应该覆盖什么，最终课程包必须补成真正可教学、可练习、可迁移的课程单元。

请你将这些碎片进行全局去重、逻辑梳理，并严丝合缝地填入我之前定好的 Course Package JSON Schema 中。重点检查并完善“章节依赖关系（Dependencies）”字段，确保学习主线清晰。

铁律：
- 你必须严格输出 JSON，不得输出 Markdown、解释、前言、后记、代码块。
- 你必须产出的是“可带学课程包”，不是普通总结。
- 你必须全局去重，合并重复概念、重复章节和重复例子。
- 你必须主动梳理学习顺序，补全合理的 dependencies，让学习主线清晰。
- 顶层 chapters 代表真正的学习阶段，不要把零碎小点直接都提升为顶层章节；相邻微小主题应优先合并为同一主线下的 sections / lessons。
- 每个节点都要尽量带上 concepts、examples、checkpoints、common_mistakes。
- 每个节点还应尽量补齐 knowledge.source_scope、teaching_expansion、practical_steps、practice_tasks、transfer_prompts、enrichment_notes。
- source_scope 只写字幕/转写中能确认的范围；teaching_expansion / practical_steps / practice_tasks / transfer_prompts 可以做通用教学增补。
- 允许基于公认常识和课程主题做教学解释、应用步骤、练习设计，但不得编造视频中没有出现的专有事实、案例细节、数据来源或作者观点。
- 如果信息不足，不要留成低密度摘要；请至少把“是什么、为什么重要、怎么用、怎么练、容易错在哪”补成可带学结构。
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
- 不要编造字幕里没有的专有事实；但要保留可供最终课程增密的主题范围、场景线索和练习线索。
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
    final_max_tokens: int = int(os.getenv("ONBOARD_DISTILLER_FINAL_MAX_TOKENS", "6000") or "6000")


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
        api_key=os.getenv("ONBOARD_DISTILLER_API_KEY", "").strip(),
        base_url=os.getenv("ONBOARD_DISTILLER_BASE_URL", "").strip(),
        model=os.getenv("ONBOARD_DISTILLER_MODEL", "").strip(),
        timeout=int(os.getenv("ONBOARD_DISTILLER_TIMEOUT", "240") or "240"),
    )


def build_final_synthesis_client(client: OpenAICompatibleClient) -> OpenAICompatibleClient:
    final_timeout = max(
        client.settings.timeout,
        int(os.getenv("ONBOARD_DISTILLER_FINAL_TIMEOUT", "420") or "420"),
    )
    return OpenAICompatibleClient(
        ModelSettings(
            api_key=client.settings.api_key,
            base_url=client.settings.base_url,
            model=client.settings.model,
            timeout=final_timeout,
            temperature=client.settings.temperature,
            max_tokens=client.settings.max_tokens,
            response_format_json=client.settings.response_format_json,
        )
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
                "source_refs": [],
                "dependencies": [],
                "knowledge": {
                    "concepts": [],
                    "examples": [],
                    "checkpoints": [],
                    "common_mistakes": [],
                    "source_scope": [],
                    "teaching_expansion": [],
                    "practical_steps": [],
                    "practice_tasks": [],
                    "transfer_prompts": [],
                    "enrichment_notes": [],
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
        "11. 每个顶层 chapter 内部尽量按“概念理解 -> 示例演示 -> 操作实战 -> 易错提醒”的顺序组织子节点。\n"
        "12. 不要额外生成阶段复盘、测验、自检这类独立节点；每个知识点自己的主动回忆问题写入 teacher_ready_content。\n\n"
        "13. 字幕只负责限定课程范围，不要让字幕的低密度限制课程质量；每个 lesson 尽量补齐 teacher_ready_content / teaching_expansion / practical_steps / practice_tasks / transfer_prompts。\n"
        "14. 学生端正文只放 teacher_ready_content；素材证据、block_id、时间戳、原文摘录必须放 source_refs，不要混进 teaching_markdown。\n\n"
        "绝对禁止输出这些 schema 元字段：$schema、$id、title、description、type、properties、$defs、required、additionalProperties。\n\n"
        "请按这个最终输出骨架来填值。注意：这是输出骨架，不是 schema 文档，不要原样照抄空字段说明。\n"
        f"{json.dumps(output_skeleton, ensure_ascii=False, indent=2)}\n\n"
        "字段形状速记：\n"
        "- 根字段必须包含 schema_version, package_id, source, course, chapters, dependency_graph, assets, gaps。\n"
        "- source 必须包含 source_type, source_id, title, language, ingested_at, text_length。\n"
        "- course 必须包含 title, overall_goal, target_audience, learning_outcomes, completion_definition。\n"
        "- 每个章节节点必须包含 id, node_type, title, summary, order, learning_objectives, dependencies, knowledge, children, assets, gaps。\n"
        "- knowledge 必须包含 concepts, examples, checkpoints, common_mistakes，可额外包含 source_scope, teaching_expansion, practical_steps, practice_tasks, transfer_prompts, enrichment_notes。\n"
        "- 每个 lesson 推荐包含 teacher_ready_content；素材来源、block_id、时间戳、原文摘录放可选 source_refs。\n"
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
    parts = re.split(r"[；;。！？!?\n]|(?<![A-Za-z0-9])\.(?![A-Za-z0-9])|(?<=[^0-9])[、，,](?=[^0-9])", normalized)
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


def _looks_like_setup_topic(title: str, text: str) -> bool:
    haystack = f"{title} {text}".casefold()
    return any(keyword in haystack for keyword in ("安装", "配置", "初始化", "环境", "install", "setup", "npm", "node"))


def _looks_like_usage_topic(title: str, text: str) -> bool:
    haystack = f"{title} {text}".casefold()
    return any(keyword in haystack for keyword in ("使用", "运行", "命令", "流程", "操作", "启动", "执行", "run", "command"))


def _build_teaching_expansion(title: str, summary: str) -> list[str]:
    points = _split_brief_points(summary, limit=3)
    expansions = []
    if summary:
        expansions.append(f"这节不是孤立记忆点，而是要把“{title}”放回实际工作流里理解：{summary[:180]}")
    if points:
        expansions.append(f"学习时先抓住主线：{points[0]}")
    expansions.append(f"判断自己是否学会 {title}，关键看能不能说清它在整套流程里负责哪一步。")
    return _take_unique_texts(expansions, limit=3)


def _build_practical_steps(title: str, summary: str) -> list[str]:
    if _looks_like_setup_topic(title, summary):
        return _take_unique_texts(
            [
                f"先确认当前系统和运行环境是否满足 {title} 的前置条件。",
                f"再按课程提到的命令或入口完成 {title}，不要跳过初始化步骤。",
                "最后做一次最小验证：能启动、能进入项目、能看到预期输出，才算真正完成。",
            ],
            limit=3,
        )
    if _looks_like_usage_topic(title, summary):
        return _take_unique_texts(
            [
                f"先说清 {title} 要解决的具体任务。",
                "再按“输入条件 -> 执行动作 -> 观察结果”的顺序复现一遍。",
                "最后把失败提示、权限问题或环境差异记录下来，方便下次排查。",
            ],
            limit=3,
        )
    return _take_unique_texts(
        [
            f"先用自己的话解释 {title} 的作用。",
            f"再把 {title} 套进一个真实场景，说明它解决哪一步问题。",
            "最后检查自己是否能指出一个常见误区或边界条件。",
        ],
        limit=3,
    )


def _build_practice_tasks(title: str, summary: str) -> list[str]:
    if _looks_like_setup_topic(title, summary):
        return _take_unique_texts(
            [
                f"在一个干净测试目录里复现 {title}，记录每一步命令、输出和遇到的错误。",
                f"写一份 5 行以内的检查清单，说明以后如何快速确认 {title} 是否成功。",
            ],
            limit=2,
        )
    return _take_unique_texts(
        [
            f"用 30 秒口头讲清 {title} 的作用、使用场景和判断标准。",
            f"设计一个自己的小例子，说明 {title} 如何从课程知识变成实际操作。",
        ],
        limit=2,
    )


def _build_transfer_prompts(title: str, summary: str) -> list[str]:
    if _looks_like_setup_topic(title, summary):
        return _take_unique_texts(
            [
                f"如果换到另一台机器或云服务器，你会怎样排查 {title} 是否成功？",
                f"如果 {title} 失败，你会优先检查环境、命令、权限还是网络？为什么？",
            ],
            limit=2,
        )
    return _take_unique_texts(
        [
            f"如果换一个项目，你会如何判断是否需要用到 {title}？",
            f"{title} 和前后相邻步骤之间的边界是什么？",
        ],
        limit=2,
    )


def _build_knowledge_block(node_id: str, title: str, text: str) -> dict[str, Any]:
    summary = _to_clean_text(text)
    scope_points = _take_unique_texts([title, *_split_brief_points(summary, limit=3)], limit=4)
    expansion_points = _build_teaching_expansion(title, summary)
    practical_steps = _build_practical_steps(title, summary)
    practice_tasks = _build_practice_tasks(title, summary)
    transfer_prompts = _build_transfer_prompts(title, summary)
    return {
        "concepts": _build_concepts(node_id, title, summary),
        "examples": _build_examples(node_id, title, summary),
        "checkpoints": _take_unique_texts([f"能用自己的话解释 {title}。", *_split_brief_points(summary, limit=2)], limit=3),
        "common_mistakes": [],
        "source_scope": scope_points,
        "teaching_expansion": expansion_points,
        "practical_steps": practical_steps,
        "practice_tasks": practice_tasks,
        "transfer_prompts": transfer_prompts,
        "enrichment_notes": ["字幕用于限定知识范围；应用步骤和练习为通用教学补充。"],
    }


def _coerce_text_items(value: Any, limit: int = 6) -> list[str]:
    if isinstance(value, list):
        return _take_unique_texts(value, limit=limit)
    text = _to_clean_text(value)
    return [text] if text else []


def _normalize_concept_items(value: Any, node_id: str, title: str, summary: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if isinstance(value, list):
        for index, item in enumerate(value, start=1):
            if isinstance(item, dict):
                name = _to_clean_text(item.get("name")) or _to_clean_text(item.get("title")) or title
                explanation = _to_clean_text(item.get("explanation")) or _to_clean_text(item.get("content")) or summary or name
                evidence = _coerce_text_items(item.get("evidence"), limit=4)
            else:
                name = _to_clean_text(item)
                explanation = name
                evidence = []
            if not name:
                continue
            items.append(
                {
                    "id": _make_item_id(node_id, "concept", index),
                    "name": name[:64],
                    "explanation": explanation[:240] or f"围绕 {name} 展开的核心知识。",
                    "evidence": evidence,
                }
            )
            if len(items) >= 6:
                break
    return items or _build_concepts(node_id, title, summary)


def _normalize_example_items(value: Any, node_id: str, title: str, summary: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if isinstance(value, list):
        for index, item in enumerate(value, start=1):
            if isinstance(item, dict):
                example_title = _to_clean_text(item.get("title")) or title or f"示例 {index}"
                scenario = _to_clean_text(item.get("scenario")) or _to_clean_text(item.get("content")) or summary or example_title
                takeaway = _to_clean_text(item.get("takeaway")) or (_split_brief_points(scenario, limit=1) or [scenario])[0]
            else:
                example_title = title or f"示例 {index}"
                scenario = _to_clean_text(item)
                takeaway = (_split_brief_points(scenario, limit=1) or [scenario])[0] if scenario else example_title
            if not scenario:
                continue
            items.append(
                {
                    "id": _make_item_id(node_id, "example", index),
                    "title": example_title[:64],
                    "scenario": scenario[:240],
                    "takeaway": takeaway[:160],
                }
            )
            if len(items) >= 4:
                break
    return items or _build_examples(node_id, title, summary)


def _normalize_knowledge_block(value: Any, node_id: str, title: str, summary: str) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    fallback = _build_knowledge_block(node_id, title, summary)
    return {
        "concepts": _normalize_concept_items(raw.get("concepts"), node_id, title, summary),
        "examples": _normalize_example_items(raw.get("examples"), node_id, title, summary),
        "checkpoints": _coerce_text_items(raw.get("checkpoints"), limit=6) or fallback["checkpoints"],
        "common_mistakes": _coerce_text_items(raw.get("common_mistakes"), limit=5),
        "source_scope": _coerce_text_items(raw.get("source_scope"), limit=5) or fallback["source_scope"],
        "teaching_expansion": _coerce_text_items(raw.get("teaching_expansion"), limit=4) or fallback["teaching_expansion"],
        "practical_steps": _coerce_text_items(raw.get("practical_steps"), limit=4) or fallback["practical_steps"],
        "practice_tasks": _coerce_text_items(raw.get("practice_tasks"), limit=3) or fallback["practice_tasks"],
        "transfer_prompts": _coerce_text_items(raw.get("transfer_prompts"), limit=3) or fallback["transfer_prompts"],
        "enrichment_notes": _coerce_text_items(raw.get("enrichment_notes"), limit=3) or fallback["enrichment_notes"],
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


def _normalize_source_refs(value: Any) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    raw_refs = value if isinstance(value, list) else []
    allowed_kinds = {"material_block", "subtitle_segment", "transcript_excerpt", "material_package", "note", "other"}

    for item in raw_refs:
        if isinstance(item, dict):
            label = _to_clean_text(item.get("label") or item.get("title") or item.get("block_id") or item.get("excerpt"))
            if not label:
                continue
            kind = _to_clean_text(item.get("kind")) or "other"
            ref: dict[str, Any] = {
                "kind": kind if kind in allowed_kinds else "other",
                "label": label[:160],
            }
            block_id = _to_clean_text(item.get("block_id"))
            if block_id:
                ref["block_id"] = block_id[:80]
            excerpt = _to_clean_text(item.get("excerpt"))
            if excerpt:
                ref["excerpt"] = excerpt[:400]
            uri = _to_clean_text(item.get("uri"))
            if uri:
                ref["uri"] = uri
            time_range = item.get("time_range")
            if isinstance(time_range, dict):
                ref["time_range"] = {
                    "from": time_range.get("from") if isinstance(time_range.get("from"), (int, float)) else None,
                    "to": time_range.get("to") if isinstance(time_range.get("to"), (int, float)) else None,
                }
            refs.append(ref)
        else:
            text = _to_clean_text(item)
            if text:
                refs.append({"kind": "note", "label": text[:160]})
        if len(refs) >= 12:
            break

    return refs


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
            *(knowledge.get("source_scope") or []),
            *(knowledge.get("teaching_expansion") or []),
            *(knowledge.get("practical_steps") or []),
            *(knowledge.get("practice_tasks") or []),
            *(knowledge.get("transfer_prompts") or []),
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


def _is_stage_recap_node(node: dict[str, Any]) -> bool:
    title = _to_clean_text(node.get("title")).casefold()
    return bool(title) and ("阶段复盘" in title or "阶段练习" in title or title in {"复盘", "练习", "回顾"})


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
        base_children = [child for child in processed_children if not _is_stage_recap_node(child)]
        if len(base_children) != len(processed_children):
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


def _collect_course_node_ids(chapters: list[dict[str, Any]]) -> set[str]:
    ids: set[str] = set()

    def visit(node: dict[str, Any]) -> None:
        node_id = _to_clean_text(node.get("id"))
        if node_id:
            ids.add(node_id)
        for child in node.get("children") or []:
            if isinstance(child, dict):
                visit(child)

    for chapter in chapters:
        visit(chapter)
    return ids


def _filter_dependency_graph_by_node_ids(dependency_graph: Any, node_ids: set[str]) -> list[dict[str, Any]]:
    if not isinstance(dependency_graph, list):
        return []
    filtered: list[dict[str, Any]] = []
    for edge in dependency_graph:
        if not isinstance(edge, dict):
            continue
        from_id = _to_clean_text(edge.get("from"))
        to_id = _to_clean_text(edge.get("to"))
        if from_id and to_id and from_id in node_ids and to_id in node_ids:
            raw_kind = _to_clean_text(edge.get("kind")) or _to_clean_text(edge.get("relation"))
            kind_marker = raw_kind.casefold()
            if kind_marker in {"prerequisite", "前置", "依赖", "requires", "required"}:
                kind = "prerequisite"
            elif kind_marker in {"parallel", "并行", "related"}:
                kind = "parallel"
            else:
                kind = "recommended"
            filtered.append(
                {
                    "from": from_id,
                    "to": to_id,
                    "kind": kind,
                    "reason": _to_clean_text(edge.get("reason")) or "按课程学习顺序推荐。",
                }
            )
    return filtered


def _is_schema_safe_id(value: str) -> bool:
    return bool(re.match(r"^[a-z][a-z0-9._-]{1,63}$", value or ""))


def _coerce_positive_int(value: Any, fallback: int) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback


def _normalize_final_course_node(raw: dict[str, Any], *, index: int, parent_id: str = "", depth: int = 0) -> dict[str, Any]:
    title = _to_clean_text(raw.get("title")) or _to_clean_text(raw.get("name")) or f"学习节点 {index}"
    summary = (
        _to_clean_text(raw.get("summary"))
        or _to_clean_text(raw.get("content"))
        or _to_clean_text(raw.get("description"))
        or title
    )
    requested_type = _to_clean_text(raw.get("node_type"))
    node_type = requested_type if requested_type in {"chapter", "section", "lesson"} else ("chapter" if depth == 0 else "lesson")
    node_id = _to_clean_text(raw.get("id"))
    if not _is_schema_safe_id(node_id):
        node_id = _make_node_id(node_type, index, title, parent_id)

    raw_children = raw.get("children") or raw.get("sections") or raw.get("lessons") or []
    children: list[dict[str, Any]] = []
    if isinstance(raw_children, list):
        for child_index, child in enumerate(raw_children, start=1):
            if isinstance(child, dict):
                children.append(
                    _normalize_final_course_node(
                        child,
                        index=child_index,
                        parent_id=node_id,
                        depth=depth + 1,
                    )
                )

    if children and node_type == "lesson":
        node_type = "section"

    normalized_node = {
        "id": node_id,
        "node_type": node_type,
        "title": title[:120],
        "summary": summary[:240],
        "order": _coerce_positive_int(raw.get("order"), index),
        "learning_objectives": _coerce_text_items(raw.get("learning_objectives"), limit=5)
        or _coerce_text_items(raw.get("objectives"), limit=5)
        or _take_unique_texts([f"理解 {title}", *_split_brief_points(summary, limit=2)], limit=3),
        "dependencies": _coerce_text_items(raw.get("dependencies"), limit=8),
        "knowledge": _normalize_knowledge_block(raw.get("knowledge"), node_id, title, summary),
        "children": children,
        "assets": _normalize_asset_refs(raw.get("assets") or [], [node_id]),
        "gaps": _normalize_gaps(raw.get("gaps") or [], [node_id]),
    }
    source_refs = _normalize_source_refs(raw.get("source_refs"))
    if source_refs:
        normalized_node["source_refs"] = source_refs
    teacher_ready = raw.get("teacher_ready_content")
    if isinstance(teacher_ready, dict):
        normalized_node["teacher_ready_content"] = teacher_ready
    elif not children:
        normalized_node["teacher_ready_content"] = build_teacher_ready_content(normalized_node)
    return normalized_node


def _normalize_final_course_package_payload(
    payload: dict[str, Any],
    *,
    package_id: str,
    source: SourceDescriptor,
    ingested_at: str,
    text_length: int,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return payload
    root = payload.get("course_package") or payload.get("package") or payload
    if not isinstance(root, dict):
        root = payload

    raw_chapters = root.get("chapters") or root.get("sections") or root.get("lessons") or []
    chapters = [
        _normalize_final_course_node(chapter, index=index, depth=0)
        for index, chapter in enumerate(raw_chapters, start=1)
        if isinstance(chapter, dict)
    ]
    if not chapters:
        fallback_title = _to_clean_text((root.get("course") or {}).get("title") if isinstance(root.get("course"), dict) else "")
        fallback_title = fallback_title or source.title or "课程概览"
        chapters = [
            _normalize_final_course_node(
                {"title": fallback_title, "summary": _to_clean_text(root.get("summary")) or fallback_title},
                index=1,
                depth=0,
            )
        ]

    course_meta = root.get("course") if isinstance(root.get("course"), dict) else {}
    package = {
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
            "title": _to_clean_text(course_meta.get("title")) or source.title or "课程",
            "subtitle": _to_clean_text(course_meta.get("subtitle")),
            "overall_goal": _to_clean_text(course_meta.get("overall_goal"))
            or _to_clean_text(course_meta.get("goal"))
            or f"系统掌握 {source.title} 的核心知识和实践路径。",
            "target_audience": _to_clean_text(course_meta.get("target_audience")) or "希望跟随视频建立实用能力的中文学习者",
            "prerequisites": _coerce_text_items(course_meta.get("prerequisites"), limit=6),
            "learning_outcomes": _coerce_text_items(course_meta.get("learning_outcomes"), limit=8)
            or _take_unique_texts([chapter["title"] for chapter in chapters], limit=6),
    "completion_definition": _to_clean_text(course_meta.get("completion_definition")) or "完成全部节点学习，并完成每节主动回忆与标准答案对照。",
            "estimated_total_minutes": _coerce_positive_int(
                course_meta.get("estimated_total_minutes"),
                max(20, sum(max(1, len(chapter.get("children") or [])) for chapter in chapters) * 8),
            ),
        },
        "chapters": chapters,
        "dependency_graph": _filter_dependency_graph_by_node_ids(
            root.get("dependency_graph"),
            _collect_course_node_ids(chapters),
        ),
        "assets": _normalize_asset_refs(root.get("assets") or []),
        "gaps": _normalize_gaps(root.get("gaps") or []),
    }
    return _compact_course_package_structure(package)


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
        valid_node_ids = _collect_course_node_ids(refreshed_roots)
        compacted = dict(course_package)
        compacted["chapters"] = refreshed_roots
        compacted["dependency_graph"] = _filter_dependency_graph_by_node_ids(
            course_package.get("dependency_graph"),
            valid_node_ids,
        )
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

    valid_node_ids = _collect_course_node_ids(compacted_roots)
    dependency_graph = _filter_dependency_graph_by_node_ids(course_package.get("dependency_graph"), valid_node_ids)
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


def _build_local_chunk_shards(chunks: list[TextChunk], source: SourceDescriptor) -> list[dict[str, Any]]:
    shards: list[dict[str, Any]] = []
    for chunk in chunks:
        title_hint = _to_clean_text(chunk.page_labels[0] if chunk.page_labels else "") or f"材料分块 {chunk.index}"
        summary_points = _split_brief_points(chunk.text, limit=4)
        summary = "；".join(summary_points) or _normalize_whitespace(chunk.text)[:220]
        lesson_title = title_hint[:80] if title_hint else f"材料分块 {chunk.index}"
        lesson = {
            "title": lesson_title,
            "content": summary,
            "children": [],
        }
        shards.append(
            {
                "chunk_id": chunk.chunk_id,
                "course_title_guess": source.title or "课程原材料",
                "overall_goal_guess": f"基于《{source.title or '课程原材料'}》建立可学习、可回忆的知识主线。",
                "chapters": [
                    {
                        "title": lesson_title,
                        "content": summary,
                        "children": [lesson],
                    }
                ],
                "dependency_graph": [],
                "assets": [],
                "gaps": [],
                "open_questions": [
                    "该节点由本地材料整理生成，需要 Codex 离线补足课程设计、案例、练习和常见误区。"
                ],
            }
        )
    return shards


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
        final_client = build_final_synthesis_client(client)
        def _normalize_final_payload(payload: dict[str, Any]) -> dict[str, Any]:
            return _normalize_final_course_package_payload(
                payload,
                package_id=package_id,
                source=source,
                ingested_at=ingested_at,
                text_length=text_length,
            )

        return _compact_course_package_structure(
            _call_json_with_validation(
            final_client,
            system_prompt=FINAL_SYSTEM_PROMPT,
            user_prompt=prompt,
            schema=schema,
            max_tokens=pipeline_config.final_max_tokens,
            max_repair_rounds=pipeline_config.max_repair_rounds,
            normalizer=_normalize_final_payload,
            )
        )
    except DistillationError as exc:
        if progress_callback:
            progress_callback(
                f"最终结构总装未通过校验，切换本地保底合成：{str(exc)[:120]}",
                95,
                stage="synthesizing",
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

    if not model_settings.api_key.strip() or not model_settings.base_url.strip() or not model_settings.model.strip():
        if progress_callback:
            progress_callback(
                "未启用远程蒸馏模型，正在本地整理可导入课程包…",
                90,
                stage="chunking",
                chunkCompleted=len(chunks),
                chunkTotal=len(chunks),
                cacheHint="local_fast_synth",
            )
        chunk_shards = _build_local_chunk_shards(chunks, source)
        synthesis_started_at = perf_counter()
        course_package = _compact_course_package_structure(
            _synthesize_course_package_locally(
                package_id=package_id,
                source=source,
                chunk_shards=chunk_shards,
                text_length=text_length,
                ingested_at=ingested_at,
            )
        )
        schema = load_course_schema()
        local_errors = MinimalSchemaValidator(schema).validate(course_package)
        if local_errors:
            raise DistillationError("本地材料整理结果未通过 schema 校验：\n" + "\n".join(local_errors[:20]))
        total_seconds = perf_counter() - pipeline_started_at
        return DistillationRun(
            course_package=course_package,
            chunks=chunks,
            chunk_shards=chunk_shards,
            stage_timings={
                "normalize_source_seconds": _round_seconds(normalize_seconds),
                "chunk_build_seconds": _round_seconds(chunk_build_seconds),
                "chunk_distill_seconds": 0.0,
                "batch_reduce_seconds": 0.0,
                "final_synthesis_seconds": _round_seconds(perf_counter() - synthesis_started_at),
                "total_seconds": _round_seconds(total_seconds),
                "chunk_count": len(chunks),
                "chunk_shard_count": len(chunk_shards),
                "synthesis_input_shard_count": len(chunk_shards),
                "local_material_only": True,
            },
            warnings=["未使用远程模型；已生成本地轻量课程包，建议导出原材料后交给 Codex 离线升级。"],
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


def _safe_material_dir_name(title: str, bvid: str) -> str:
    stem = config.sanitize_filename(title or bvid or "course_material")
    return f"{stem}.course_material"


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
                "suggested_lesson_role": role,
                "teaching_value_score": _material_teaching_value_score(text, role, noise_level),
                "noise_level": noise_level,
                "noise_reasons": noise_reasons,
                "source_excerpt": text[:900],
            }
        )

    return {
        "schema_version": "shijie.part-index.v0.1",
        "purpose": "给 GPT/Codex 的分 P 导航层：先看这里判断主题、操作密度、噪音和建议合并方式，再按需回读 blocks/raw_transcript。",
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
            roles = [str(item.get("suggested_lesson_role") or "") for item in current]
            role = max(set(roles), key=roles.count)
            groups.append(
                {
                    "group_id": f"merge_{len(groups) + 1:03d}",
                    "part_ids": [str(item.get("part_id") or "") for item in current],
                    "labels": [str(item.get("label") or "") for item in current],
                    "suggested_lesson_role": role,
                    "reason": "相邻分 P 主题/课型接近，适合由 GPT 判断是否合并为同一 lesson 或同一章节连续小节。",
                    "key_terms": _take_unique_texts(
                        [term for item in current for term in (item.get("terms") or [])],
                        limit=12,
                    ),
                }
            )
        current = []

    for item in part_items:
        role = str(item.get("suggested_lesson_role") or "")
        noise_level = str(item.get("noise_level") or "")
        if noise_level == "high":
            flush()
            continue
        if not current:
            current = [item]
            continue
        previous_role = str(current[-1].get("suggested_lesson_role") or "")
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
                record["reason"] = "工具、模型、平台、API 或版本相关术语，制课时应保守表述或核验官方文档。"

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
                "reason": "来自概念索引；如为工具/API/平台名，制课时需注意版本敏感。",
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
        "purpose": "提示 GPT 课程设计时可降权或跳过的片头片尾、互动话术、推广话术和低教学价值片段。",
        "items": [
            {
                "part_id": item.get("part_id"),
                "label": item.get("label"),
                "noise_level": item.get("noise_level"),
                "noise_reasons": item.get("noise_reasons") or [],
                "suggestion": "课程蓝图可降权处理；除非这些内容承载真实教学目标，否则不要单独成课。",
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
        "purpose": "粗粒度教学导航。GPT 可以用它快速判断哪些分 P 更适合成课、哪些适合合并、哪些只作为素材证据。",
        "high_value_parts": [
            {
                "part_id": item.get("part_id"),
                "label": item.get("label"),
                "suggested_lesson_role": item.get("suggested_lesson_role"),
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


def _write_gpt_designer_workspace(material_dir: str, *, course_title: str, material_id: str) -> dict[str, str]:
    designer_dir = os.path.join(material_dir, "gpt_designer")
    schemas_dir = os.path.join(material_dir, "schemas")
    os.makedirs(designer_dir, exist_ok=True)
    os.makedirs(schemas_dir, exist_ok=True)

    readme_for_gpt_path = os.path.join(material_dir, "README_FOR_GPT.md")
    start_path = os.path.join(designer_dir, "START_GPT_DESIGNER.md")
    chatgpt_prompt_path = os.path.join(designer_dir, "chatgpt-course-designer-v1.md")
    codex_prompt_path = os.path.join(designer_dir, "codex-blueprint-executor-v1.md")
    workflow_path = os.path.join(designer_dir, "gpt-course-designer-workflow.md")
    display_blocks_path = os.path.join(designer_dir, "course-display-blocks-vnext.md")
    template_path = os.path.join(designer_dir, "course_blueprint.template.json")
    chatgpt_copy_path = os.path.join(designer_dir, "01_copy_to_chatgpt.md")
    codex_copy_path = os.path.join(designer_dir, "02_copy_to_codex_after_blueprint.md")
    repair_copy_path = os.path.join(designer_dir, "03_repair_course_after_audit.md")
    zip_path = os.path.join(designer_dir, "gpt_course_design_workspace.zip")
    blueprint_path = os.path.join(material_dir, "course_blueprint.json")

    _copy_project_file_if_exists(("src", "schemas", "course_blueprint.schema.json"), os.path.join(schemas_dir, "course_blueprint.schema.json"))
    _copy_project_file_if_exists(("docs", "prompts", "chatgpt-course-designer-v1.md"), chatgpt_prompt_path)
    _copy_project_file_if_exists(("docs", "prompts", "codex-blueprint-executor-v1.md"), codex_prompt_path)
    _copy_project_file_if_exists(("docs", "course-design", "gpt-course-designer-workflow.md"), workflow_path)
    _copy_project_file_if_exists(("docs", "course-design", "course-display-blocks-vnext.md"), display_blocks_path)

    _save_json_file(
        template_path,
        {
            "schema_version": "shijie.course-blueprint.v0.1",
            "blueprint_id": material_id,
            "course_title": course_title,
            "source_genre": "mixed",
            "learning_intent": "general_learning",
            "course_design_mode": "mixed",
            "source_summary": {
                "source_type": "video_transcript_material_package",
                "source_id": material_id,
                "source_title": course_title,
                "material_scope": "用完整字幕/转写确定知识范围、素材线索、讲解顺序和缺口位置；不要把字幕摘要直接当课程。",
                "known_limits": [],
            },
            "learner_profile": {
                "target_audience": "",
                "assumed_background": [],
                "learning_goal": "",
                "risk_points": [],
            },
            "course_strategy": {
                "course_type_tags": [],
                "design_principles": [],
                "sequence_rationale": "",
                "knowledge_gap_policy": "",
            },
            "chapters": [],
            "global_visual_plan": [],
            "source_coverage_map": [],
            "topic_inventory": [],
            "compression_review": {
                "material_scale": "",
                "lesson_count_rationale": "",
                "minimum_lesson_check": "",
                "compression_risks": [],
                "expansion_recommendation": "",
            },
            "design_review": {
                "strengths": [],
                "risk_points": [],
                "high_density_lessons": [],
                "rejected_alternatives": [],
                "verification_needs": [],
                "software_display_needs": [],
            },
            "codex_execution_policy": {
                "lesson_generation_order": "按章节顺序分批生成，每批 1-3 节；高密度 lesson 单独或小批处理。",
                "quality_bar": [
                    "Codex 先读 course_blueprint.json，再按每节 lesson 的 source_scope 回读本地 blocks/raw_transcript。",
                    "学生端只写 teacher_ready_content；不要暴露字幕证据、材料分析、制课过程或 debug 字段。",
                    "最后运行 python src\\codex_course_packager.py \"<course_material_dir>\" --strict。",
                ],
                "software_display_notes": [],
            },
        },
    )

    _write_text_file(
        readme_for_gpt_path,
        [
            "# README FOR GPT",
            "",
            "1. 先读 `gpt_designer/START_GPT_DESIGNER.md` 和 `gpt_designer/chatgpt-course-designer-v1.md`。",
            "2. 先用 `manifest.json`、`indexes/teaching_map.json`、`indexes/part_index.json`、`indexes/term_normalization.json` 建立课程地图。",
            "3. 再按需要回读 `blocks/block_*.json`；`raw_transcript.txt` 只用于核对关键疑点，不要从头顺序复述。",
            "4. 输出目标只有 `course_blueprint.json`，不要生成最终课程正文。",
            "5. 禁止把视频分 P 直接等同 lesson；允许合并、拆分、重排和舍弃噪音片段。",
            "6. 每章都要设计 `chapter_roadmap`，用于软件里的章节地图按钮；它要用短节点、箭头和关系标签串起本章 lesson。优先填写 `map_label/action_tag/risk_tag/output_tag`，不要设计成横向卡片或大段说明；`edges[].label` 必须说明小节之间的知识推进关系，禁止写“下一步/继续/前一步/先会前一步”这类空标签。每章还要提供 `visual_asset`：`kind=image`、`status=planned`、中文 `alt` 和可用于生成章节学习路线图图片的 `prompt`，不要把图片 prompt 写成封面图或大段文字思维导图。",
            "7. 长材料必须先建立 `topic_inventory` 候选主题池，再写 `compression_review`，说明哪些主题被完整使用、部分使用、合并、跳过，以及当前 lesson 数是否足够。",
            "8. 必须填写 `course_design_mode`，并尽量为每节课填写 `primary_training_action` 和 `training_policy`。`training_policy.must_include` 只放 2-3 个核心训练槽位，不要每节复用同一套全量槽位。",
        ],
    )

    _write_text_file(
        start_path,
        [
            "# START GPT DESIGNER",
            "",
            "这个目录是给 ChatGPT 使用的课程总设计师工作包。ChatGPT 的任务不是生成最终课包，而是完整阅读原材料后，输出给 Codex 执行的 `course_blueprint.json`。",
            "",
            "## 你要上传给 ChatGPT",
            "",
            "推荐直接上传压缩包 `gpt_course_design_workspace.zip`。ChatGPT 不能读取你电脑上的本地路径，所以不要把 `C:\\...` 当作可读取地址发给它。",
            "",
            "如果 ChatGPT 不方便读取压缩包，就把压缩包解开后上传这些内容：",
            "",
            "- `manifest.json`",
            "- `README_FOR_GPT.md`",
            "- `raw_transcript.txt`",
            "- `raw_tracks.json`",
            "- `blocks/`",
            "- `indexes/`",
            "- `schemas/course_blueprint.schema.json`",
            "- `gpt_designer/chatgpt-course-designer-v1.md`",
            "- `gpt_designer/course-display-blocks-vnext.md`",
            "",
            "## ChatGPT 产物",
            "",
            "ChatGPT 最终只需要输出一个 JSON 文件：`course_blueprint.json`。",
            "",
            "优先请 ChatGPT 生成可下载文件，不要把完整 JSON 长文本直接贴在对话正文里。只有当前环境不能生成文件时，才分段输出 JSON。",
            "",
            "把 ChatGPT 输出保存到：",
            "",
            "```text",
            "<本地原材料包>/course_blueprint.json",
            "```",
            "",
            "保存后，新开 Codex 对话，复制 `gpt_designer/02_copy_to_codex_after_blueprint.md` 里的提示，让 Codex 按蓝图和本地完整原材料生成最终课包。",
        ],
    )

    chatgpt_copy_text = [
        "# 复制给 ChatGPT",
        "",
        "```text",
        "请担任“视界专注”的课程总设计师。",
        "",
        f"本次课程名称是《{course_title}》。请把本对话视为《{course_title}》的课程设计工作区；如果系统自动生成对话标题，请优先围绕这个课程名命名。",
        "",
        "我已经上传 `gpt_course_design_workspace.zip`。请读取压缩包内容，不要尝试读取我电脑上的本地路径。",
        "",
        "请先执行压缩包中的：",
        "- `gpt_designer/START_GPT_DESIGNER.md`",
        "- `gpt_designer/chatgpt-course-designer-v1.md`",
        "- `schemas/course_blueprint.schema.json`",
        "",
        "你的目标不是生成最终课程正文，而是完整理解视频/字幕/转写材料，设计一份可交给 Codex 执行的 `course_blueprint.json`。",
        "",
        "请先用 `README_FOR_GPT.md`、`manifest.json`、`indexes/teaching_map.json`、`indexes/part_index.json`、`indexes/term_normalization.json` 建立课程地图；再按需要回读 blocks。`raw_transcript.txt` 只用于核对疑点，不要从头复述。",
        "请使用完整原材料确定知识范围、课程主线、每节课目标、每节课应补足的知识树、展示模块、主动回忆设计和标准答案设计。不要把字幕压缩成低密度摘要，也不要只给一两句泛泛提示。",
        "不要把视频分 P 直接等同 lesson；请在 `source_coverage_map` 里说明核心、合并、部分使用、跳过或噪音片段。",
        "请必须输出 `topic_inventory` 和 `compression_review`：先建立候选主题池，再标注 full/partial/merged/skipped/noise，说明它们进入了哪些 lesson；长材料、跨主题材料、访谈/播客/圆桌/纪录片通常应列出 20-40 个候选高价值主题。同时说明当前 lesson 数为什么足够、哪些主题有被过度合并的风险、如果做深度版应扩展到多少节。",
        "如果材料超过 60 分钟或 3 万字，而你设计少于 8 节，必须给出强理由；如果是 3 小时以上访谈/播客/圆桌且目标是深度学习，通常应优先考虑 12-24 节，而不是 4-6 节导读。",
        "不要为了避免“播客切片感”而把不同认知层强行合并。技术机制、组织观察、产品/商业案例、社会观点、个人成长路径如果都很重要，应拆成不同 lesson 或章节。",
        "请先填写 `source_genre`、`learning_intent` 和 `course_design_mode`。如果材料是访谈、播客、圆桌或纪录片，不要强行做成教程或考试课；优先设计观点地图、论证链、人物/背景、案例、分歧、迁移启发和反思题。",
        "蓝图中必须包含 `design_review`：请列出蓝图强项、生成风险、高密度 lesson、被否定的备选结构、需要核验的事实，以及当前/未来软件最需要的展示块。",
        "请为每节 lesson 尽量填写 `primary_training_action` 和 `training_policy`：语言/语法课要规划识别、解析、改错、转换和产出；操作课要规划步骤、检查点和错误形态；工具课要规划配置、验证和排错；病例课要规划线索、判断、排除和结论；观点课要规划观点重建、反例和迁移。`must_include` 只放 2-3 个最贴合本节动作的 required 槽位，其他放 optional 或不写；不要所有 lesson 复用同一套训练结构。",
        "请为每节 lesson 明确 `content_domain`、`density_mode`、`natural_length_hint`、`target_length_range`、`format_policy`、兼容字段 `preferred_format/primary_format/supporting_formats/avoid_formats`、`teaching_voice`、`completion_signals`、`verification_level`、`can_be_short` 和 `must_expand_reason`。",
        "`natural_length_hint` 和 `target_length_range` 只是自然长度参考，不是字数 KPI；真正目标是满足 `completion_signals`。",
        "请按学习任务选择展示方式，而不是按领域套模板：医学/考试的比较、分类、参数、禁忌证、评分点和鉴别内容可以大量使用表格；医学操作仍优先步骤，病例判断优先判断链；计算机/工具课的安装配置优先步骤和配置走读，排错优先排错树，架构关系优先图示，工具/模型选型才优先表格。",
        "整门课还要设计一个顶层 `course_visual_map`：它供软件顶部“全局地图”按钮使用，是整门课的一张视觉总览提示词，不是章节图拼贴。请使用 `kind=image`、`status=planned`、中文 `alt` 和高质量 `prompt`，目标是生成 16:9 的全局学习地图，突出章节主线、能力成长和关键转折，少文字、强结构，不要画软件按钮、进度条或说明面板。",
        "每章都要设计 `chapter_roadmap`：它供软件顶部“章节地图”按钮使用，不是学生端正文。请根据章节任务选择 workflow、concept_map、decision_tree、operation_flow、exam_strategy、architecture_map、case_reasoning、argument_map 或 viewpoint_map，并用短节点和箭头关系串起本章 lesson，目标是一屏看懂。",
        "`chapter_roadmap.nodes[].lesson_id` 必须指向真实 lesson；节点标题要像地图节点一样短。请优先填写 `map_label`、`micro_question`、`action_tag`、`risk_tag`、`output_tag`；`edges.label` 要写小节之间的知识推进关系，例如“概念变操作”“先识别再纠错”“用规则解释例外”，禁止写“下一步/继续/前一步/先会前一步”；`summary/core_question/key_claim/counterpoint/completion_signal` 是隐藏备注，不要写成长段。",
        "每章 `chapter_roadmap` 还要提供 `visual_asset`：`kind=image`、第一阶段 `status=planned`、可以不填 `uri`，但必须写中文 `alt` 和 `prompt`。这个 prompt 用于生成章节学习路线图图片，不是课程封面、信息海报、Mermaid 图或大段文字思维导图；图中文字要少，只保留 3-7 个短标签，并描述画面风格、主要节点、节点关系、视觉隐喻、色彩布局和禁止事项。",
        "如果本章包含观点分歧、判断取舍、医学鉴别、工程权衡、排错分支或访谈观点，请在 `chapter_roadmap` 中加入 `turning_points`、`tension_edges`、`conflict_nodes` 或 `open_questions`，不要只做线性目录。",
        "每个 `display_plan` 块请写明 `priority`、`why_this_format` 和 `must_follow_with`：`required` 必须落地，`optional` 有空间才写，`avoid_if_redundant` 如果正文已经讲清就不要硬塞。",
        "`teaching_voice` 要告诉 Codex 这节课像什么老师在讲：临床/考试老师、工程导师、案例讨论、带练教练或简洁参考。先有讲课节奏，再选择表格、代码、图示或清单。",
        "请把主动回忆题和标准答案设计成本节专属任务：不要给 Codex 设计“请围绕本节写判断步骤、依据和常见误区”这类通用题干，也不要让标准答案变成跨课程通用骨架。",
        "",
        "最终请生成一个可下载文件 `course_blueprint.json`，内容是符合 `schemas/course_blueprint.schema.json` 的 JSON 对象。不要把完整 JSON 长文本直接贴在对话正文里；如果当前环境不能生成文件，再分段输出 JSON。",
        "```",
    ]
    _write_text_file(chatgpt_copy_path, chatgpt_copy_text)

    codex_copy_text = [
        "# 复制给 Codex",
        "",
        "```text",
        "Use $shijie-course-builder to build a 视界专注 course package from this material folder.",
        "",
        "请担任“视界专注”的课程工程师，读取本地完整原材料包和 ChatGPT 课程总设计师产出的课程蓝图，生成可直接导入视界专注学习台的 Course Package JSON。",
        "如果本地已安装 `shijie-course-builder` skill，请优先按该 skill 的流程执行；如果当前环境没有加载该 skill，则按下面的完整要求执行。",
        "",
        "原材料包路径：",
        material_dir,
        "",
        "课程蓝图路径：",
        blueprint_path,
        "",
        "请先读取并执行：",
        f"{codex_prompt_path}",
        "",
        "工作要求：",
        "1. 以 `course_blueprint.json` 为课程设计总指挥。",
        "2. 先运行蓝图校验：`python src\\validate_course_blueprint.py \"<课程蓝图路径>\"`。如果校验失败，优先修复蓝图结构或明确指出问题，不要带着坏蓝图制课。",
        "3. 先读取蓝图中的 `source_genre`、`learning_intent`、`course_design_mode` 和 `design_review`。如果是访谈、播客、圆桌或纪录片，不要强行做成教程/考试/操作课；优先做观点理解、论证链、案例、分歧、迁移启发和反思题。`design_review` 的风险点、高密度小节、核验需求和展示需求不能写进学生端正文，但要影响制课策略。",
        "4. 先运行覆盖审计：`python src\\coverage_audit.py \"<课程材料目录>\"`。再对照 `manifest.json`、`topic_inventory`、`source_coverage_map`、`compression_review` 和 `indexes/part_index.json` 做人工判断。如果材料超过 60 分钟或 3 万字但蓝图少于 8 节，或 3 小时以上访谈/播客/圆桌只给 4-6 节，请先标记过度压缩风险，列出被合并/弱化/跳过的高价值主题，并说明是否建议扩展蓝图。",
        "5. 先用 `indexes/part_index.json`、`indexes/teaching_map.json`、`indexes/term_normalization.json` 定位相关分 P、术语和 blocks；不要一上来通读 raw_transcript。",
        "6. 按蓝图逐节回读本地 blocks，必要时才用 raw_transcript 核对疑点，并补足知识树、例子、图表、操作步骤、排错和主动回忆设计。",
        "7. 每节课必须保留蓝图课型：`teacher_ready_content.lesson_profile` 写一个主课型，不要全部写 mixed；`teacher_ready_content.lesson_type_tags` 完整保留蓝图的 `lesson_type_tags`。",
        "8. 学生端只显示可学习内容，不暴露字幕证据、材料分析、制课过程、source/evidence/debug。",
        "9. 禁止写一个通用脚本把所有 lesson 套进同一模板；脚本只能用于搬运 JSON、校验 schema、整理文件。每节 `teaching_markdown` 必须按蓝图单独设计。",
        "10. 优先按蓝图里的 `format_policy` 和 `teaching_voice` 决定主表达和讲课节奏；旧字段 `primary_format/supporting_formats/avoid_formats` 只作兼容参考。",
        "10.1 如果蓝图提供 `primary_training_action` 和 `training_policy`，必须把它们变成真实教学动作：识别/分类/解析要有判断例子；改错/转换/产出要有改错或产出任务；操作/配置/排错要有步骤、验证和失败处理；诊断/选择/论证要有线索、依据、排除或反方观点。`must_include` 通常只落地 2-3 个核心槽位，`optional_include` 有空间才写，`avoid_slots` 不要强行实现。",
        "11. 如果蓝图提供 `chapter_roadmap`，必须逐章写入 `outline.draft.json` 的对应 chapter；它用于软件章节地图，不要复制进 lesson 正文。节点 lesson_id 必须对应真实 lesson，标题要短，并保留节点间 `edges` 与 `map_label/micro_question/action_tag/risk_tag/output_tag`；`core_question/key_claim/counterpoint/completion_signal/turning_points/tension_edges/conflict_nodes/open_questions` 也要保留。若提供 `visual_asset`，必须保留到最终课包；没有实际图片时保持 `status=planned`，不要因为缺少 `uri` 删除。",
        "12. 只把 `display_plan.priority=required` 的展示块强制落地；`optional` 有空间才写；`avoid_if_redundant` 已在正文讲清时不要硬塞。落地时表格就是真 Markdown 表格，步骤就是编号列表，检查就是清单，复杂关系才用 Mermaid。",
        "13. 如果蓝图提供 `completion_signals`，优先满足这些行为证据；如果提供 `verification_level`，对版本敏感和官方核验内容保守表述。",
        "14. 按课型硬执行：操作课包含工具/对象准备、动作步骤、口述或提示语、检查点、常见错误；案例课包含判断、依据、鉴别、处理原则、标准答案；问诊、需求调研、排障问询类内容必须写成对方听得懂的问句。",
        "15. 不要使用统一字数线：入口课/总论课/边界课可以短而准；操作课、病例决策课、空间结构课和综合训练课必须展开。真正标准是信息完整度，不是字数。",
        "16. 操作/配置步骤如果单条较长，必须一条一行写成普通编号列表；只有短流程标签才适合横向流程图。",
        "17. 表格只在比较、分类、参数、禁忌证、评分点、鉴别诊断、框架/工具取舍和风险矩阵中自然使用；操作/病例/排错课如果用了表格，必须补清楚如何用表格完成操作、判断或排错。",
        "18. Markdown 表格必须是标准格式：表头行、分隔行、每一行单独换行；不要把表格行压进段落，也不要漏掉最后一列。",
        "19. 列表项必须是完整句子，不要以 `、`、`,`、`;` 开头；二次巩固、复盘、标准答案要写成清晰短句或列表，不要用标点把多个答案硬拼成一段。",
        "20. 主动回忆题必须是本节专属任务，禁止“请围绕某某写出判断步骤、依据和常见误区”这类通用题干。",
        "21. 标准答案按课型写成可背诵分点：概念课写定义/边界/易错点，操作课写步骤/目的/检查点，病例课写线索/依据/排除/结论；必须直接回答本节主动回忆题，禁止输出“先写线索、再判断、再说明理由、最后检查”的通用骨架。",
        "22. 每节交付前做反凑字和反模板审查：这段删掉是否影响学习？这道题和答案复制到另一节是否也成立？如果是，就重写。",
        "23. 如果材料包里存在 `course_draft_archives/`，那只是旧失败产物归档，只能用来理解反例，不能复制、修补或复用里面的 lesson。",
        "24. 生成完 lesson 后再次运行 `python src\\coverage_audit.py \"<课程材料目录>\"`，确认没有长材料短蓝图、高价值主题无承接、全局地图缺失或章节地图过度线性的问题。",
        "24.1 如果覆盖审计报 `roadmap_semantic_duplication`、`roadmap_text_heavy`、`table_heavy_blueprint`、`table_heavy_low_training_density`、`language_training_policy_missing`、`grammar_course_low_example_or_correction_density`、`training_policy_over_uniform` 或 `training_policy_overloaded`，先人工判断，再修复地图短标签、表格滥用或训练分型，不要为了清报告凑字。",
        "25. 最后运行 strict 打包，输出 `course_draft/final.course-package.json`，并把结果发布到 `output/courses/`；strict 下 warning 也必须修复后才能发布；info 只是复核提示，不要为清零 info 凑字。",
        "26. 最终用中文简洁汇报课包路径、lesson 数、auditScore/premiumScore、auditErrors/auditWarnings、coverage-audit 路径和剩余风险；如果触发覆盖审查，也要说明当前课包是导读版还是深度版。",
        "```",
    ]
    _write_text_file(codex_copy_path, codex_copy_text)

    repair_copy_text = [
        "# 复制给 Codex 修复现有课包",
        "",
        "```text",
        "Use $shijie-course-builder to repair and strict-package this 视界专注 course package.",
        "",
        "请担任“视界专注”的课程质量修复工程师。当前 GPT 蓝图已经可用，但 Codex 生成的 course_draft 没有充分执行蓝图，请根据质量报告逐节修复 lesson，并重新 strict 打包发布。",
        "如果本地已安装 `shijie-course-builder` skill，请优先按该 skill 的修复流程执行；如果当前环境没有加载该 skill，则按下面的完整要求执行。",
        "",
        "原材料包路径：",
        material_dir,
        "",
        "课程蓝图路径：",
        blueprint_path,
        "",
        "质量报告路径：",
        os.path.join(material_dir, "course_draft", "final.course-package.quality-report.json"),
        "",
        "请先读取并执行：",
        f"{codex_prompt_path}",
        "",
        "修复重点：",
        "1. 先阅读质量报告中的 issue，不要只修 Markdown 表面格式。",
        "2. 对出现 `compressed_heading_line` 的 lesson，重写 Markdown，保证标题、正文、列表、表格、代码块都有真实换行。",
        "3. 对出现 `display_hint_not_realized` 的 lesson，回到 course_blueprint.json 对应 lesson，只强制落实 `display_plan.priority=required` 的展示块：表格必须是真表格，步骤必须是真编号列表，检查清单必须是真清单；optional 展示块可从 display_hints 移除，不要硬塞。",
        "4. 对出现 `blueprint_executor_template_overused` 或 `reused_generic_diagram` 的 lesson，删除通用模板段落和重复图，按该节自己的目标、材料范围和 Codex instruction 重写。",
        "5. 不要用通用脚本批量套模板；可以用脚本定位文件、校验 JSON、运行打包，但课程正文必须逐节定制。",
        "6. 最后运行 `python src\\codex_course_packager.py \"<course_material_dir>\" --strict`，直到 auditErrors=0 且 auditWarnings=0 后再发布。",
        "```",
    ]
    _write_text_file(repair_copy_path, repair_copy_text)

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        include_roots = [
            "manifest.json",
            "README_FOR_GPT.md",
            "raw_transcript.txt",
            "raw_tracks.json",
            "blocks",
            "indexes",
            "schemas",
            os.path.join("gpt_designer", "START_GPT_DESIGNER.md"),
            os.path.join("gpt_designer", "01_copy_to_chatgpt.md"),
            os.path.join("gpt_designer", "chatgpt-course-designer-v1.md"),
            os.path.join("gpt_designer", "gpt-course-designer-workflow.md"),
            os.path.join("gpt_designer", "course-display-blocks-vnext.md"),
            os.path.join("gpt_designer", "course_blueprint.template.json"),
        ]
        for relative_root in include_roots:
            absolute_root = os.path.join(material_dir, relative_root)
            if os.path.isfile(absolute_root):
                archive.write(absolute_root, relative_root)
                continue
            if os.path.isdir(absolute_root):
                for folder, _, filenames in os.walk(absolute_root):
                    for filename in filenames:
                        absolute_file = os.path.join(folder, filename)
                        if os.path.abspath(absolute_file) == os.path.abspath(zip_path):
                            continue
                        archive.write(absolute_file, os.path.relpath(absolute_file, material_dir))

    return {
        "designer_dir": designer_dir,
        "start": start_path,
        "chatgpt_prompt": chatgpt_prompt_path,
        "chatgpt_copy_prompt": chatgpt_copy_path,
        "codex_blueprint_prompt": codex_copy_path,
        "codex_repair_prompt": repair_copy_path,
        "workspace_zip": zip_path,
        "blueprint": blueprint_path,
    }


def _build_handoff_status(
    *,
    material_dir: str,
    course_title: str,
    material_id: str,
    source_id: str,
    text_length: int,
    block_count: int,
) -> dict[str, Any]:
    return {
        "schema_version": "shijie.handoff.v0.1",
        "stage": "material_ready",
        "stage_label": "待 GPT 设计",
        "next_action": "上传 gpt_designer/gpt_course_design_workspace.zip 到 ChatGPT，并复制 gpt_designer/01_copy_to_chatgpt.md。",
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
            "gpt_workspace_zip": os.path.join(material_dir, "gpt_designer", "gpt_course_design_workspace.zip"),
            "gpt_prompt": os.path.join(material_dir, "gpt_designer", "01_copy_to_chatgpt.md"),
            "course_blueprint": os.path.join(material_dir, "course_blueprint.json"),
            "codex_prompt": os.path.join(material_dir, "gpt_designer", "02_copy_to_codex_after_blueprint.md"),
            "final_course": os.path.join(material_dir, "course_draft", "final.course-package.json"),
        },
        "steps": [
            {
                "id": "material_package",
                "label": "原材料包",
                "status": "done",
                "output": "manifest.json, raw_transcript.txt, blocks/, indexes/, gpt_designer/",
            },
            {
                "id": "gpt_blueprint",
                "label": "GPT 课程蓝图",
                "status": "next",
                "output": "course_blueprint.json",
            },
            {
                "id": "codex_course",
                "label": "Codex 生成课包",
                "status": "pending",
                "output": "course_draft/final.course-package.json",
            },
            {
                "id": "import_course",
                "label": "导入学习台",
                "status": "pending",
                "output": "output/courses/*.course-package.json",
            },
        ],
        "notes": [
            "当前唯一主流程是：软件生成原材料包 -> ChatGPT 输出 course_blueprint.json -> Codex 按蓝图生成课包。",
            "不要把旧 codex_tasks 当作主入口；它们只保留为历史兼容参考。",
            "ChatGPT 不能读取本地路径，必须上传 gpt_course_design_workspace.zip。",
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
    status_path = os.path.join(material_dir, "handoff_status.json")
    gpt_zip = os.path.join(material_dir, "gpt_designer", "gpt_course_design_workspace.zip")
    gpt_prompt = os.path.join(material_dir, "gpt_designer", "01_copy_to_chatgpt.md")
    codex_prompt = os.path.join(material_dir, "gpt_designer", "02_copy_to_codex_after_blueprint.md")
    blueprint_path = os.path.join(material_dir, "course_blueprint.json")
    final_course_path = os.path.join(material_dir, "course_draft", "final.course-package.json")

    _save_json_file(
        status_path,
        _build_handoff_status(
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
            "# 视界专注制课交接单",
            "",
            f"课程：{course_title}",
            f"来源：{source_id or material_id}",
            f"材料规模：{block_count} blocks，约 {text_length} 字",
            "",
            "## 当前状态",
            "",
            "✅ 原材料包已生成",
            "",
            "下一步：上传 `gpt_designer/gpt_course_design_workspace.zip` 到 ChatGPT，并复制 `gpt_designer/01_copy_to_chatgpt.md`。",
            "",
            "## 唯一主流程",
            "",
            "1. 软件生成完整原材料包。",
            "2. ChatGPT 完整阅读 zip，输出 `course_blueprint.json`。",
            "3. 把 `course_blueprint.json` 保存到本材料包根目录。",
            "4. 复制 `gpt_designer/02_copy_to_codex_after_blueprint.md`，新开 Codex 对话制课；该提示会优先调用 `$shijie-course-builder`。",
            "5. Codex Skill 运行 strict 打包，生成 `course_draft/final.course-package.json` 并发布到 `output/courses/`。",
            "6. 回到软件导入最终课包。",
            "",
            "## 关键文件",
            "",
            f"- GPT 上传包：`{gpt_zip}`",
            f"- GPT 复制提示：`{gpt_prompt}`",
            f"- GPT 蓝图保存位置：`{blueprint_path}`",
            f"- Codex 复制提示：`{codex_prompt}`",
            f"- Codex 最终课包：`{final_course_path}`",
            "",
            "## 不要走的旧入口",
            "",
            "`START_HERE.md` 和 `codex_tasks/` 属于旧的 Codex 直制课流程兼容文件。现在主流程以本交接单和 `gpt_designer/` 为准。",
        ],
    )
    return {"handoff": handoff_path, "handoff_status": status_path}


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
    material_dir = os.path.join(output_dir, _safe_material_dir_name(str(video_info.get("title") or source.title), bvid))
    blocks_dir = os.path.join(material_dir, "blocks")
    indexes_dir = os.path.join(material_dir, "indexes")
    tasks_dir = os.path.join(material_dir, "codex_tasks")
    designer_dir = os.path.join(material_dir, "gpt_designer")
    schemas_dir = os.path.join(material_dir, "schemas")
    draft_dir = os.path.join(material_dir, "course_draft")
    lesson_drafts_dir = os.path.join(draft_dir, "lessons")
    os.makedirs(blocks_dir, exist_ok=True)
    os.makedirs(indexes_dir, exist_ok=True)
    os.makedirs(tasks_dir, exist_ok=True)
    os.makedirs(designer_dir, exist_ok=True)
    os.makedirs(schemas_dir, exist_ok=True)
    os.makedirs(lesson_drafts_dir, exist_ok=True)
    if os.path.exists(os.path.join(CURRENT_DIR, "schemas", "codex_material_package.schema.json")):
        shutil.copyfile(
            os.path.join(CURRENT_DIR, "schemas", "codex_material_package.schema.json"),
            os.path.join(schemas_dir, "codex_material_package.schema.json"),
        )
    if os.path.exists(os.path.join(CURRENT_DIR, "schemas", "course_package.schema.json")):
        shutil.copyfile(
            os.path.join(CURRENT_DIR, "schemas", "course_package.schema.json"),
            os.path.join(schemas_dir, "course_package.schema.json"),
        )
    if os.path.exists(os.path.join(CURRENT_DIR, "schemas", "course_blueprint.schema.json")):
        shutil.copyfile(
            os.path.join(CURRENT_DIR, "schemas", "course_blueprint.schema.json"),
            os.path.join(schemas_dir, "course_blueprint.schema.json"),
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
            "readme_for_gpt": "README_FOR_GPT.md",
            "handoff": "HANDOFF.md",
            "handoff_status": "handoff_status.json",
            "blocks_dir": "blocks",
            "indexes_dir": "indexes",
            "part_index": "indexes/part_index.json",
            "teaching_map": "indexes/teaching_map.json",
            "term_normalization": "indexes/term_normalization.json",
            "noise_segments": "indexes/noise_segments.json",
            "gpt_designer_dir": "gpt_designer",
            "gpt_designer_start": "gpt_designer/START_GPT_DESIGNER.md",
            "gpt_designer_prompt": "gpt_designer/chatgpt-course-designer-v1.md",
            "gpt_designer_copy_prompt": "gpt_designer/01_copy_to_chatgpt.md",
            "gpt_upload_workspace_zip": "gpt_designer/gpt_course_design_workspace.zip",
            "course_blueprint": "course_blueprint.json",
            "course_blueprint_schema": "schemas/course_blueprint.schema.json",
            "codex_tasks_dir": "codex_tasks",
            "codex_tasks_legacy_note": "旧 Codex 直制课流程兼容文件；新流程请使用 HANDOFF.md 和 gpt_designer/。",
            "course_draft_dir": "course_draft",
            "lesson_drafts_dir": "course_draft/lessons",
            "start_here": "START_HERE.md",
            "block_schema": "schemas/codex_material_package.schema.json#/$defs/materialBlock",
            "course_package_schema": "schemas/course_package.schema.json",
            "course_package_contract": "codex_tasks/04_course_package_contract.md",
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
            "lesson_batch_size": "每次生成 1-3 节 lesson JSON，然后保存中间结果。",
            "review_strategy": "全局审稿优先读 indexes，再按需要回读 blocks 原文证据。",
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
                "本块只限定知识范围，不代表最终课程质量上限。",
                "生成课程时请补足定义、因果、场景、步骤、练习和常见误区。",
                "如果本块信息量过大，请先生成 block_summary.json，再回读关键原文证据。",
            ],
        }
        _save_json_file(os.path.join(blocks_dir, f"{block_id}.json"), block_payload)
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
    _save_json_file(
        os.path.join(draft_dir, "outline.draft.json"),
        {
            "status": "empty",
            "purpose": "Codex 课程制作窗口在任务 01 后写入课程总大纲草稿。",
            "course_title": str(video_info.get("title") or source.title or ""),
            "modules": [],
        },
    )
    _save_json_file(
        os.path.join(draft_dir, "lesson_manifest.json"),
        {
            "status": "empty",
            "purpose": "记录 course_draft/lessons 下已生成的 lesson 草稿，便于分批制作和断点续作。",
            "lessons": [],
        },
    )
    with open(os.path.join(draft_dir, "review_notes.md"), "w", encoding="utf-8") as file:
        file.write(
            "\n".join(
                [
                    "# Review Notes",
                    "",
                    "这里由 Codex 课程制作窗口记录全局审稿发现：重复、断裂、缺口、术语不一致、难度跳跃、练习质量问题。",
                ]
            )
            + "\n"
        )

    task_files = {
        "00_new_window_prompt.md": [
            "# 新 Codex 课程制作窗口启动提示",
            "",
            "在新的 Codex 窗口中发送下面这段话即可开始制作单个课程包。它故意很短，详细规则都在本目录的任务文件里：",
            "",
            "```text",
            f"请读取并执行这份视界专注材料包的 START_HERE.md：{os.path.join(material_dir, 'START_HERE.md')}",
            "目标：生成可直接导入视界专注学习台的 Course Package JSON。",
            "要求：先设计教学大纲，再分批生成 lesson，最后 strict 打包；不要把字幕证据、原材料分析或制课过程写进学生端正文。",
            "边界：辅助脚本只能放在本材料包的 course_draft/tools/ 或系统临时目录；最终汇报必须用中文，不要输出英文内部备注或自我提醒。",
            "```",
        ],
        "01_design_outline.md": [
            "# 任务 1：设计课程总大纲",
            "",
            "## 必读文件",
            "",
            "- `manifest.json`",
            "- `indexes/global_outline.json`",
            "- `indexes/concept_index.json`",
            "- `indexes/timeline_index.json`",
            "",
            "## 不要做",
            "",
            "- 不要一上来读取 `raw_transcript.txt`。",
            "- 不要把 block 摘要直接改写成课程正文。",
            "- 不要把“视频范围、字幕证据、原文摘录”写进学生端正文。",
            "",
            "## 产物",
            "",
            "把课程总大纲写入 `course_draft/outline.draft.json`。大纲至少包含：",
            "",
            "- `course.title`",
            "- `course.target_audience`",
            "- `course.overall_goal`",
            "- `course.learning_outcomes`",
            "- `chapters[].id/title/summary/lesson_ids`",
            "- 每个 lesson 的 `id`、`title`、`purpose`、`source_block_ids`、`estimated_minutes`",
            "- 课程难度曲线说明，可写入 `course_draft/review_notes.md`",
            "",
            "## 设计原则",
            "",
            "- 视频只限定知识范围，不限定课程质量上限。",
            "- 课程应该像老师直接讲课，不像素材整理说明。",
            "- 普通知识课重概念、因果、例子、迁移。",
            "- 技能/工具课重目标、流程、检查、排错。",
            "- 考试课才强调考点、评分点、易混点和答题表达。",
        ],
        "02_generate_lessons.md": [
            "# 任务 2：按单元生成课程",
            "",
            "## 输入",
            "",
            "- 先读 `course_draft/outline.draft.json`。",
            "- 每次只选择 1-3 个 lesson。",
            "- 每个 lesson 只回读它的 `source_block_ids` 对应的 `blocks/block_XXX.json`。",
            "",
            "## 输出位置",
            "",
            "把每批 lesson 草稿写入 `course_draft/lessons/lesson_XXX.json`，并同步更新 `course_draft/lesson_manifest.json`。",
            "每个 lesson 文件可以是单个 lesson 对象，也可以是 `{ \"lessons\": [...] }` 批量文件。",
            "",
            "## 每个 lesson 必须包含",
            "",
            "- `id`",
            "- `title`",
            "- `summary`",
            "- `learning_objectives`",
            "- `teacher_ready_content.teaching_markdown`",
            "- `teacher_ready_content.quiz_question`",
            "- `teacher_ready_content.standard_answer`",
            "- `teacher_ready_content.key_points`",
            "- `teacher_ready_content.common_mistakes`",
            "- `source_refs`",
            "- 可选：`chapter_id`、`teacher_ready_content.lesson_profile`、`teacher_ready_content.display_hints`、`knowledge.concepts`、`knowledge.examples`、`knowledge.checkpoints`",
            "",
            "## 内容密度目标",
            "",
            "- 不使用统一最低字数线。入口课、总论课、边界课可以短而准；操作课、病例决策课、空间结构课和综合训练课必须展开。",
            "- 推荐长度只作松散参考：入口/总论可以短而准；概念/比较要讲清边界和例子；操作/配置、病例/排错、空间结构和综合训练要按任务自然展开。",
            "- `standard_answer` 不按固定字数补长；要按课型写成可对照、可背诵的分点答案。",
            "- `key_points` 至少 4 条。",
            "- `common_mistakes` 至少 3 条，必须具体到误解、漏步、判断错误或使用场景。",
            "- 按课型补齐最有学习价值的信息：概念课重例子和误区，操作/配置课重步骤、检查和排错，考试课重评分点和答题表达。",
            "- 操作/配置课不要为了讲“为什么”牺牲步骤细节；缺少画面时，要用文字补足顺序、部位、按钮、命令、验证方法和失败处理。",
            "- 如果出现口诀、缩写、顺口溜或编号法，必须逐项展开，不允许只写口诀。例如“内、外、夹、弓、大、立、腕”必须解释成掌心、手背、指缝、指背、拇指、指尖和腕部。",
            "- 避免 150 字以上的大段落。较长解释请拆成短句列表，标准答案尽量一句一行。",
            "- 禁止为了过 audit/premium 追加统一补句或泛化段落。每节写完后检查：删掉这段是否影响学习？是否重复前文？是否只是为了凑字？",
            "- 少量使用视觉重点：核心名词、关键概念、关键参数用 `**加粗**`；判断标准、操作红线、易混淆关键句用 `<u>下划线</u>`。每段通常 1-3 处，不要整段加粗或满屏下划线。",
            "- 不要在正文里手动添加全角空格做首行缩进；学习台会自动给普通段落做阅读式首行缩进。",
            "",
            "## 学生端正文要求",
            "",
            "- 直接进入教学，不写“视频给出的范围”“字幕证据”“我会把它补成一节课”。",
            "- 每关只解决一个清晰学习目标。",
            "- 用户回答后只展示标准答案、关键点、常见误区，不做实时智能判分。",
            "- 字幕原文、时间戳、block_id 只写进 `source_refs`。",
            "- 每节先判断 `lesson_profile`：concept、operation、tool_config、exam、case_analysis、strategy 或 mixed。",
            "- 通识课不要硬写成考试题；技能课不要只讲概念；工具配置课必须写清步骤、验证和排错；考试课才强调评分点和答题表达。",
        ],
        "03_review_course.md": [
            "# 任务 3：全局审稿",
            "",
            "## 审稿顺序",
            "",
            "1. 先读 `course_draft/outline.draft.json` 和 `course_draft/lesson_manifest.json`。",
            "2. 再抽查 `course_draft/lessons/` 中的 lesson。",
            "3. 必要时才回读相关 `blocks/block_XXX.json`。",
            "",
            "## 检查项",
            "",
            "- 是否有重复 lesson。",
            "- 是否有知识断裂或明显缺章。",
            "- 是否有学生端元说明、字幕证据、视频范围暴露。",
            "- 是否有概念课被误写成操作课，或工具课被误写成抽象概念课。",
            "- 标准答案是否足够可对照。",
            "- 常见误区是否有学习价值，而不是泛泛提醒。",
            "- 每节课是否有足够教学密度，而不是 300-500 字短卡片。",
            "- 是否有例子、场景、理由链和排错/迁移提示。",
            "- 难度是否从基础到应用推进。",
            "",
            "把发现写入 `course_draft/review_notes.md`，并修正对应 lesson 草稿。",
        ],
        "04_course_package_contract.md": [
            "# 任务 4：输出 Course Package JSON",
            "",
            "最终只输出一个可导入视界专注的 Course Package JSON，不要输出 Markdown 或解释。",
            "",
            "请使用 `schemas/course_package.schema.json` 作为结构约束。",
            "推荐不要手写最终完整课包；优先让 lesson 草稿保持小文件，然后在项目根目录运行：",
            "",
            "```powershell",
            f"Set-Location \"{config.PROJECT_ROOT}\"",
            f"python src\\codex_course_packager.py \"{material_dir}\" --strict",
            "```",
            "",
            "该命令会读取 `course_draft/outline.draft.json` 和 `course_draft/lessons/*.json`，输出 `course_draft/final.course-package.json` 和质量报告。",
            "默认还会自动复制一份到统一课包目录 `output/courses/`，便于在软件里导入。",
            "",
            "## 最小学习台字段",
            "",
            "- 每个叶子 lesson 必须有 `summary`，作为本关讲解入口。",
            "- `knowledge.concepts` 放核心概念和解释。",
            "- `knowledge.checkpoints` 放用户学完后应该能说出的关键点。",
            "- `knowledge.common_mistakes` 放常见误区。",
            "- `knowledge.source_scope` 只写材料中能确认的范围。",
            "- `knowledge.teaching_expansion` 放 Codex 补充的理解链。",
            "- `knowledge.practical_steps` 放可执行步骤。",
            "- `knowledge.practice_tasks` 放主动练习。",
            "- `knowledge.transfer_prompts` 放主动回忆题或迁移题。",
            "- `teacher_ready_content` 放学生端直接展示的讲解、主动回忆题、标准答案、关键点和常见误区。",
            "- `teacher_ready_content.lesson_profile` 可标注 concept / operation / tool_config / exam / case_analysis / strategy / mixed，用来约束内容重点。",
            "- `teacher_ready_content.teaching_markdown` 可以少量使用 `**加粗**` 和 `<u>下划线</u>` 标出真正影响理解和记忆的重点，但不要为了装饰而强调。",
            "- 不要手动输入全角空格做首行缩进；学习台会在渲染普通段落时统一处理。",
            "- `source_refs` 放 block_id、时间戳、字幕摘录、原材料包路径，默认不进入学生端。",
            "",
            "## 课程设计原则",
            "",
            "- 视频材料只限定知识范围，不限定课程质量上限。",
            "- 不要把字幕摘要当课程。",
            "- 每节课都要能支持：先学、主动回答、看标准解释、进入下一关。",
            "- 每节课按课型自然长短；短课必须短而准，高密度课必须真有案例、步骤、空间示意或排错链。",
            "- 不要设计实时自由问答、阻塞式判分或回炉流程。",
            "- 如果要引用材料证据，请写入 `source_refs`，不要放进学生端 lesson content。",
        ],
        "05_final_checklist.md": [
            "# 任务 5：最终交付检查",
            "",
            "导出最终 Course Package 前，请确认：",
            "",
            "- JSON 根字段包含 `schema_version`、`package_id`、`source`、`course`、`chapters`、`dependency_graph`、`assets`、`gaps`。",
            "- 每个可学习叶子节点都有 `teacher_ready_content`。",
            "- 学生端正文没有 `字幕证据`、`视频给出的范围`、`source`、`evidence`、`block_id` 等调试痕迹。",
            "- `source_refs` 保留 block_id、时间戳或摘录，便于以后追溯。",
            "- 每关都有主动回忆题和标准答案。",
            "- 用户答得好坏都能继续下一关。",
            "",
            "最终建议文件名：`course_draft/final.course-package.json`。",
        ],
        "06_authoring_handbook.md": [
            "# 任务 6：Codex 制课手册",
            "",
            "## 核心目标",
            "",
            "最终交付物只有一个：`course_draft/final.course-package.json`。",
            "这个文件导入“视界专注”后，学生应该能直接学习，而不是看到材料分析、字幕证据或制课过程说明。",
            "",
            "## 工作入口",
            "",
            "- 先读 `START_HERE.md`、`manifest.json`、`indexes/global_outline.json`、`indexes/concept_index.json`、`indexes/timeline_index.json`。",
            "- 不要一开始读取 `raw_transcript.txt`。",
            "- 大文本由文件系统承载长期记忆；Codex 只按任务回读相关 blocks。",
            "",
            "## 两阶段制作",
            "",
            "第一阶段：设计教学大纲，输出 `course_draft/outline.draft.json`。",
            "第二阶段：分批写课程，每次只处理 1-3 个 lesson，只回读相关 1-3 个 blocks。",
            "",
            "## 内容密度目标",
            "",
            "- 不使用统一最低字数线。入口课、总论课、边界课可以短而准；操作课、病例决策课、空间结构课和综合训练课必须展开。",
            "- 推荐长度只作松散参考：入口/总论可以短而准；概念/比较要讲清边界和例子；操作/配置、病例/排错、空间结构和综合训练要按任务自然展开。",
            "- `standard_answer` 不按固定字数补长；概念课写定义/边界/易错点，操作课写步骤/目的/检查点，病例课写线索/依据/排除/结论。",
            "- `key_points` 至少 4 条。",
            "- `common_mistakes` 至少 3 条，必须具体到误解、漏步、判断错误或使用场景。",
            "- 按课型补齐最有学习价值的信息：概念课重例子和误区，操作/配置课重步骤、检查和排错，考试课重评分点和答题表达。",
            "- 操作/配置课不要为了讲“为什么”牺牲步骤细节；缺少画面时，要用文字补足顺序、部位、按钮、命令、验证方法和失败处理。",
            "- 如果出现口诀、缩写、顺口溜或编号法，必须逐项展开，不允许只写口诀。",
            "- 避免 150 字以上的大段落。较长解释请拆成项目符号或短段，标准答案尽量一句一行。",
            "- 禁止为了过 audit/premium 追加统一补句或泛化段落。每节写完后检查：删掉这段是否影响学习？是否重复前文？是否只是为了凑字？",
            "- 可以少量使用 `**加粗**` 标出关键名词、核心概念、关键参数；用 `<u>下划线</u>` 标出判断标准、操作红线或最容易混淆的关键句。每段通常 1-3 处，不要把整段都标成重点。",
            "",
            "## 课程类型判断",
            "",
            "- 每节 lesson 先标注 `teacher_ready_content.lesson_profile`：concept、operation、tool_config、exam、case_analysis、strategy 或 mixed。",
            "- concept：重概念、因果关系、例子、误解澄清、迁移应用。",
            "- operation：重标准步骤、关键动作、完成标准、漏步风险；缺少画面时用文字补足可观察细节。",
            "- tool_config：重前置条件、配置步骤、命令/路径/参数、验证、排错和恢复。",
            "- exam：重评分点、扣分点、答题表达、易混题型。",
            "- case_analysis：重线索识别、判断路径、分支条件和处理方案。",
            "",
            "## 禁止出现在学生端",
            "",
            "- 视频给出的范围",
            "- 字幕证据",
            "- 原材料",
            "- 材料中",
            "- source / evidence / block / debug",
            "- 我会把它补成一节课",
            "- 这一关信息量偏高",
            "- 证据链",
        ],
        "07_draft_templates.md": [
            "# 任务 7：草稿模板",
            "",
            "## outline.draft.json",
            "",
            "```json",
            "{",
            "  \"course\": {",
            "    \"title\": \"课程名\",",
            "    \"subtitle\": \"可选副标题\",",
            "    \"overall_goal\": \"学完后能解决什么问题\",",
            "    \"target_audience\": \"适合谁\",",
            "    \"prerequisites\": [],",
            "    \"learning_outcomes\": [\"学习结果 1\", \"学习结果 2\"],",
            "    \"completion_definition\": \"完成整门课的标准\"",
            "  },",
            "  \"chapters\": [",
            "    {",
            "      \"id\": \"chapter_01\",",
            "      \"title\": \"第一章标题\",",
            "      \"summary\": \"这一章解决什么问题\",",
            "      \"lesson_ids\": [\"lesson_001\"],",
            "      \"lessons\": [",
            "        {",
            "          \"id\": \"lesson_001\",",
            "          \"title\": \"第一节标题\",",
            "          \"purpose\": \"这一节让学生真正学会什么\",",
            "          \"source_block_ids\": [\"block_001\"],",
            "          \"estimated_minutes\": 6",
            "        }",
            "      ]",
            "    }",
            "  ]",
            "}",
            "```",
            "",
            "## lesson_XXX.json 必要字段",
            "",
            "- `id`",
            "- `chapter_id`",
            "- `title`",
            "- `summary`",
            "- `learning_objectives`",
            "- `teacher_ready_content.teaching_markdown`",
            "- `teacher_ready_content.quiz_question`",
            "- `teacher_ready_content.standard_answer`",
            "- `teacher_ready_content.key_points`",
            "- `teacher_ready_content.common_mistakes`",
            "- `source_refs`",
            "",
            "## 通识课标题建议",
            "",
            "- `## 这一关要学会什么`",
            "- `## 核心概念`",
            "- `## 关键关系`",
            "- `## 应用场景`",
            "- `## 常见误区`",
            "- `## 一句话记忆`",
            "",
            "## 技能/工具/考试课标题建议",
            "",
            "- `## 这一关要学会什么`",
            "- `## 标准操作步骤` 或 `## 操作或使用流程`",
            "- 操作课用 `## 关键细节` / `## 检查清单`，工具配置课用 `## 前置条件` / `## 配置步骤` / `## 验证与排错`",
            "- 考试课才用 `## 考试/实操评分点`",
            "- `## 常见错误`",
            "- `## 一句话记忆`",
        ],
        "08_final_delivery_checklist.md": [
            "# 任务 8：最终交付检查",
            "",
            "## 制作前",
            "",
            "- 只处理一个 `*.course_material` 目录。",
            "- 先判断课程类型，并给每节 lesson 标注 `lesson_profile`：concept、operation、tool_config、exam、case_analysis、strategy 或 mixed。",
            "- 大纲阶段只做课程结构，不写完整课文。",
            "",
            "## Lesson 检查",
            "",
            "- `teacher_ready_content.teaching_markdown` 是直接教学，不是材料说明。",
            "- `teaching_markdown` 按课型自然长短；入口/总论/边界课可以短而准，操作/病例/空间结构/综合课必须展开。",
            "- 有主动回忆题 `quiz_question`。",
            "- 有可对照的 `standard_answer`，按课型分点写，不用统一补句凑长。",
            "- `key_points` 至少 4 条，能帮助学生快速发现漏点。",
            "- `common_mistakes` 至少 3 条，是具体错误，不是泛泛提醒。",
            "- 按 lesson_profile 补强内容：概念课重例子和迁移，操作课重步骤和细节，工具配置课重验证和排错，考试课重评分点。",
            "- 所有口诀、缩写、顺口溜和编号法都已逐项展开。",
            "- 150 字以上的解释段已拆成项目符号或短段，不让学生在学习台里读整块长文。",
            "- `source_refs` 有 block 来源，但学生端正文不暴露来源证据。",
            "- 没有为了过旧 1100 字线而添加的复盘套话、答题自检套话或重复小节。",
            "",
            "## 打包检查",
            "",
            "```powershell",
            f"Set-Location \"{config.PROJECT_ROOT}\"",
            f"python src\\codex_course_packager.py \"{material_dir}\" --strict",
            "```",
            "",
            "- 质量报告没有 error。",
            "- 命令输出里有 `publishedCoursePath`，说明最终课包已同步到 `output/courses/`。",
            "- 学习台导入后首屏直接显示教学正文。",
            "- 提交回答后只展示标准答案、关键点和常见误区。",
            "",
            "## 最终回复要求",
            "",
            "- 用中文简洁汇报。",
            "- 不要输出英文内部备注、思考草稿、Markdown 链接格式自检或路径格式自我提醒。",
            "- 只列出最终课包路径、质量分数、lesson 数和剩余风险。",
        ],
        "09_quality_upgrade_prompt.md": [
            "# 任务 9：课包质量升级提示词",
            "",
            "当课包已经能导入学习台，但质量报告出现大量 `info` 时，用这一任务做二次升级，不要推翻现有章节结构。",
            "",
            "```text",
            "请对这份已经生成的“视界专注”课程包做质量升级，不要推翻现有章节结构：",
            "",
            f"{material_dir}",
            "",
            "请先读：",
            "1. course_draft/final.course-package.json",
            "2. course_draft/final.course-package.quality-report.json",
            "3. codex_tasks/06_authoring_handbook.md",
            "4. codex_tasks/08_final_delivery_checklist.md",
            "",
            "目标：",
            "- 保持原来的章节数、lesson_ids 和 source_refs。",
            "- 逐节扩写 teacher_ready_content，不重写素材整理层。",
            "- 不按统一字数扩写。先判断 lesson_profile 和蓝图设计：短课短而准，重点课高密度展开。",
            "- standard_answer 按课型改成自然分点答案，禁止为了长度追加“得分时还要写明……并主动排除……”这类统一补句。",
            "- key_points 至少 4 条。",
            "- common_mistakes 至少 3 条。",
            "- 先补/校准 teacher_ready_content.lesson_profile，再按课型扩写，不要所有 lesson 套同一种模板。",
            "- concept 补核心概念、因果关系、例子和误区；operation 补标准步骤、关键动作、完成标准和漏步风险。",
            "- tool_config 补前置条件、配置步骤、命令/路径/参数、验证、排错和恢复；exam 补评分点、扣分点和答题表达。",
            "- 遇到口诀、缩写、顺口溜或编号法，必须逐项展开。比如“内、外、夹、弓、大、立、腕”要展开为掌心、手背、指缝、指背、拇指、指尖和腕部，并说明容易漏哪一步。",
            "- 把 150 字以上的大段解释拆成项目符号或短段。标准答案也尽量一句一行，便于学生对照记忆。",
            "- 给 `teaching_markdown` 增加少量视觉重点：核心名词、关键概念、关键参数用 `**加粗**`；判断标准、操作红线、易混淆关键句用 `<u>下划线</u>`。每段通常 1-3 处，禁止整段加粗或满屏下划线。",
            "- 学生端正文仍然不能出现“视频范围、字幕证据、原材料、材料中、source、block、debug”等词。",
            "",
            "工作方式：",
            "1. 先读取质量报告，列出需要升级的 lesson。",
            "2. 每次只处理 1-3 个 lesson。",
            "3. 必要时回读对应 source_refs 指向的 blocks。",
            "4. 直接修改 course_draft/lessons/lesson_XXX.json。",
            f"5. 最后运行：Set-Location \"{config.PROJECT_ROOT}\"；python src\\codex_course_packager.py \"{material_dir}\" --strict",
            "```",
        ],
    }
    for filename, lines in task_files.items():
        with open(os.path.join(tasks_dir, filename), "w", encoding="utf-8") as file:
            file.write("\n".join(lines).strip() + "\n")

    start_here_lines = [
        "# START HERE",
        "",
        "主流程已经迁移到 GPT 课程总设计师 + Codex Skill 蓝图执行。",
        "",
        "请先读同目录的 `HANDOFF.md`。它会告诉你当前材料包到了哪一步、GPT 上传包在哪里、蓝图保存到哪里、Codex 提示从哪里复制。",
        "",
        "如果你看到 `codex_tasks/`，请把它当作旧流程兼容文件，不要作为当前主入口。",
    ]
    with open(os.path.join(material_dir, "START_HERE.md"), "w", encoding="utf-8") as file:
        file.write("\n".join(start_here_lines).strip() + "\n")

    _write_gpt_designer_workspace(
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
        "version": "final-course-package.v4",
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


def _looks_like_oral_practice_course(video_info: dict[str, Any], subtitles: list[dict[str, Any]]) -> bool:
    haystack_parts = [
        str(video_info.get("title") or ""),
        str(video_info.get("bvid") or ""),
    ]
    for subtitle in subtitles[:2]:
        for segment in subtitle.get("page_segments") or []:
            haystack_parts.append(str(segment.get("label") or ""))
    haystack = "\n".join(haystack_parts)
    required = ("口腔" in haystack or "牙" in haystack) and ("实践技能" in haystack or "三站" in haystack or "技能操作" in haystack)
    return required


def _looks_like_oral_exam_review_course(video_info: dict[str, Any], subtitles: list[dict[str, Any]]) -> bool:
    haystack_parts = [
        str(video_info.get("title") or ""),
        str(video_info.get("bvid") or ""),
    ]
    for subtitle in subtitles[:2]:
        for segment in subtitle.get("page_segments") or []:
            haystack_parts.append(str(segment.get("label") or ""))
    haystack = "\n".join(haystack_parts)
    is_oral_exam = ("口腔" in haystack or "牙" in haystack) and ("执业医师" in haystack or "助理医师" in haystack or "资格考试" in haystack)
    is_review = any(keyword in haystack for keyword in ["高频考点", "带背", "磨耳朵", "医学综合", "基础医学", "临床医学", "口腔医学综合"])
    is_practice = any(keyword in haystack for keyword in ["实践技能", "三站", "技能操作"])
    return is_oral_exam and is_review and not is_practice


def _try_build_oral_exam_blueprint_course(
    *,
    video_info: dict[str, Any],
    subtitles: list[dict[str, Any]],
    output_dir: str,
    output_path: str,
    source: SourceDescriptor,
    codex_material_path: str,
) -> dict[str, Any] | None:
    if not _looks_like_oral_exam_review_course(video_info, subtitles):
        return None
    try:
        from oral_exam_blueprint import build_blueprint_course_from_bundle

        return build_blueprint_course_from_bundle(
            {"subtitles": subtitles, "source_type": source.source_type, "note": source.notes},
            output_dir=output_dir,
            source_id=str(video_info.get("bvid") or source.source_id or "unknown"),
            source_title=str(video_info.get("title") or source.title or "口腔执业医师综合课程"),
            material_path=codex_material_path,
            output_path=output_path,
        )
    except Exception as exc:
        _emit_progress(f"综合考试蓝图生成失败，回退通用课程生成：{exc}", 58, stage="blueprint", cacheHint="blueprint_fallback")
        return None


def _try_build_oral_practice_blueprint_course(
    *,
    video_info: dict[str, Any],
    subtitles: list[dict[str, Any]],
    output_dir: str,
    output_path: str,
    source: SourceDescriptor,
    codex_material_path: str,
) -> dict[str, Any] | None:
    if not _looks_like_oral_practice_course(video_info, subtitles):
        return None
    try:
        from oral_practice_blueprint import build_blueprint_course_from_bundle

        return build_blueprint_course_from_bundle(
            {"subtitles": subtitles, "source_type": source.source_type, "note": source.notes},
            output_dir=output_dir,
            source_id=str(video_info.get("bvid") or source.source_id or "unknown"),
            source_title=str(video_info.get("title") or source.title or "口腔实践技能课程"),
            material_path=codex_material_path,
            output_path=output_path,
        )
    except Exception as exc:
        _emit_progress(f"蓝图课程生成失败，回退通用课程生成：{exc}", 58, stage="blueprint", cacheHint="blueprint_fallback")
        return None


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
    bypass_cached_package = _looks_like_oral_exam_review_course(video_info, []) or _looks_like_oral_practice_course(video_info, [])
    if cached_package and not bypass_cached_package and not material_only:
        cached_package = _compact_course_package_structure(cached_package)
        save_course_package(cached_package, output_path)
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
    if cached_package and bypass_cached_package:
        _emit_progress("检测到课程蓝图已更新，跳过旧课程包缓存并复用底层字幕/转写缓存重建课程…", 24, stage="cache", cacheHint="stale_course_package")

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
    full_plan = prepare_chunk_plan(
        subtitles,
        package_id=package_id,
        pipeline_config=pipeline_config,
    )
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

    if material_only:
        overall_seconds = perf_counter() - overall_started_at
        stage_timings = {
            "metadata_seconds": _round_seconds(metadata_seconds),
            "subtitle_fetch_seconds": _round_seconds(subtitle_fetch_seconds),
            "audio_backfill_seconds": _round_seconds(audio_backfill_seconds),
            "total_seconds": _round_seconds(overall_seconds),
            "pipeline": {
                "material_only": True,
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
                "batch_total": 0,
                "batch_completed": 0,
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

    blueprint_kind = ""
    blueprint_message = ""
    blueprint_result = _try_build_oral_exam_blueprint_course(
        video_info=video_info,
        subtitles=subtitles,
        output_dir=output_dir,
        output_path=output_path,
        source=source,
        codex_material_path=codex_material_path,
    )
    if blueprint_result:
        blueprint_kind = "oral_exam_blueprint"
        blueprint_message = "口腔执业医师综合考试蓝图"
    if not blueprint_result:
        blueprint_result = _try_build_oral_practice_blueprint_course(
            video_info=video_info,
            subtitles=subtitles,
            output_dir=output_dir,
            output_path=output_path,
            source=source,
            codex_material_path=codex_material_path,
        )
        if blueprint_result:
            blueprint_kind = "oral_practice_blueprint"
            blueprint_message = "口腔实践技能蓝图"
    if blueprint_result:
        overall_seconds = perf_counter() - overall_started_at
        stage_timings = {
            "metadata_seconds": _round_seconds(metadata_seconds),
            "subtitle_fetch_seconds": _round_seconds(subtitle_fetch_seconds),
            "audio_backfill_seconds": _round_seconds(audio_backfill_seconds),
            "distill_seconds": 0.0,
            "total_seconds": _round_seconds(overall_seconds),
            "pipeline": {
                "blueprint_course": True,
                "blueprint_kind": blueprint_kind,
                "node_count": blueprint_result.get("nodeCount"),
                "covered_count": blueprint_result.get("coveredCount"),
                "inferred_count": blueprint_result.get("inferredCount"),
            },
        }
        _save_json_file(
            os.path.join(cache_dir, f"{package_id}.{subtitles_hash}.meta.json"),
            {
                "packagePath": output_path,
                "packageId": str(blueprint_result.get("packageId") or package_id),
                "bvid": str(video_info.get("bvid") or bvid),
                "chunkCount": len(full_plan.chunks),
                "warningCount": 1,
                "sourceType": text_source_type,
                "sourceNote": text_source_note,
                "materialPath": codex_material_path,
                "coveragePath": blueprint_result.get("coveragePath"),
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
                "chunk_total": len(full_plan.chunks),
                "chunk_completed": len(full_plan.chunks),
                "batch_total": 0,
                "batch_completed": 0,
                "stage_timings": stage_timings,
            },
        )
        _emit_progress(f"已按{blueprint_message}生成教学优先课程。", 100, stage="complete", cacheHint="blueprint_course")
        return {
            "packagePath": output_path,
            "packageId": str(blueprint_result.get("packageId") or package_id),
            "title": str(video_info.get("title") or bvid),
            "bvid": str(video_info.get("bvid") or bvid),
            "textSourceType": text_source_type,
            "textSourceNote": text_source_note,
            "materialPath": codex_material_path,
            "coveragePath": blueprint_result.get("coveragePath"),
            "chunkCount": len(full_plan.chunks),
            "warningCount": 1,
            "warnings": [
                f"命中{blueprint_message}：已生成 {blueprint_result.get('nodeCount')} 个课程节点。",
                _format_timing_brief(stage_timings),
            ],
            "stageTimings": stage_timings,
        }

    cached_final_package = _load_cached_final_package(final_cache_path, str(video_info.get("bvid") or bvid))
    if cached_final_package:
        cached_final_package = _compact_course_package_structure(cached_final_package)
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
            "materialPath": codex_material_path,
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
            "materialPath": codex_material_path,
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
        "materialPath": codex_material_path,
        "chunkCount": len(run.chunks),
        "warningCount": len(run.warnings),
        "warnings": [*run.warnings, _format_timing_brief(stage_timings)],
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
    overall_seconds = perf_counter() - overall_started_at
    stage_timings = {
        "audio_backfill_seconds": _round_seconds(overall_seconds),
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
        _emit_progress("课程蒸馏完成，正在回传桌面端…", 100, stage="complete")
        if args.result_json:
            print("__ONBOARD_DISTILL_RESULT__=" + json.dumps(result, ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:
        print(f"蒸馏失败：{exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

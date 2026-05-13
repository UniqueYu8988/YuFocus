# -*- coding: utf-8 -*-
"""Assemble Codex-authored lesson drafts into an importable course package.

Codex should do course design in a separate conversation and write files under:

course_material/
  manifest.json
  course_draft/
    outline.draft.json
    lessons/
      lesson_001.json
      lesson_002.json

This script turns those draft files into the Course Package JSON consumed by the
Electron learning desk. It intentionally does not call a remote model.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
from typing import Any

from course_quality_audit import audit_course_package


SCHEMA_VERSION = "onboard.course-package.v0.1"
PACKAGE_ID_LIMIT = 64
NODE_ID_LIMIT = 64
LESSON_PROFILES = {"concept", "operation", "tool_config", "exam", "case_analysis", "strategy", "mixed"}
LESSON_TYPE_TAG_TO_PROFILE = {
    "tool_config": "tool_config",
    "operation": "operation",
    "operation_steps": "operation",
    "workflow": "operation",
    "exam": "exam",
    "case_analysis": "case_analysis",
    "strategy": "strategy",
    "practice_drill": "strategy",
    "concept": "concept",
    "concept_explain": "concept",
    "system_map": "concept",
    "troubleshooting": "tool_config",
}

PROFILE_KEYWORDS = {
    "tool_config": ("安装", "配置", "环境", "命令", "终端", "端口", "网络", "代理", "路径", "运行", "报错", "openclaw", "npm", "python", "api"),
    "operation": ("操作", "步骤", "流程", "洗手", "消毒", "戴手套", "缝合", "拔除", "引流", "检查", "记录", "测量", "演示"),
    "exam": ("考试", "评分", "得分", "扣分", "考官", "答题", "考点", "执业医师", "助理医师", "三站"),
    "case_analysis": ("病例", "诊断", "鉴别", "主诉", "病史", "临床思路", "治疗方案"),
    "strategy": ("复习", "规划", "方法", "策略", "记忆", "效率", "计划"),
    "concept": ("概念", "定义", "原理", "机制", "本质", "模型", "框架", "关系"),
}
TOOL_TECH_TERMS = ("openclaw", "openclash", "clash", "npm", "node", "python", "api", "git", "github", "端口", "网络", "代理", "命令", "终端", "路径", "环境变量")
TOOL_SETUP_TERMS = ("安装", "配置", "环境", "初始化", "运行", "启动", "报错", "setup", "install", "run")
ROADMAP_TYPES = {
    "workflow",
    "concept_map",
    "decision_tree",
    "operation_flow",
    "exam_strategy",
    "architecture_map",
    "case_reasoning",
    "argument_map",
    "viewpoint_map",
}
ROADMAP_ROLES = {"foundation", "concept", "practice", "risk", "decision", "review", "integration"}
ROADMAP_TONES = {"green", "blue", "purple", "amber", "rose", "neutral"}
ROADMAP_EDGE_KINDS = {
    "next",
    "depends_on",
    "contrast",
    "risk",
    "feedback",
    "supports",
    "tension",
    "counterpoint",
    "tradeoff",
    "open_question",
}
ROADMAP_VISUAL_ASSET_STATUSES = {"planned", "attached", "missing"}


class PackageError(RuntimeError):
    pass


def _load_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except FileNotFoundError as exc:
        raise PackageError(f"缺少文件：{path}") from exc
    except json.JSONDecodeError as exc:
        raise PackageError(f"JSON 格式错误：{path}：{exc}") from exc
    if not isinstance(payload, dict):
        raise PackageError(f"JSON 根节点必须是对象：{path}")
    return payload


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def _safe_filename_stem(value: Any, fallback: str = "course") -> str:
    stem = re.sub(r'[\\/:*?"<>|]+', "_", str(value or "").strip())
    stem = re.sub(r"\s+", " ", stem).strip(" .")
    if not stem:
        stem = fallback
    return stem[:90].rstrip(" .") or fallback


def _clean_text(value: Any, fallback: str = "") -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text or fallback


def _clean_markdown(value: Any, fallback: str = "") -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+$", "", line) for line in text.split("\n")]
    text = "\n".join(lines).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text or fallback


def _slug(value: Any, fallback: str, limit: int = NODE_ID_LIMIT) -> str:
    raw = str(value or "").strip().lower()
    raw = re.sub(r"[^a-z0-9._-]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("._-")
    if not raw or not re.match(r"^[a-z]", raw):
        raw = fallback
    return raw[:limit].rstrip("._-") or fallback


def _stable_package_id(material: dict[str, Any], outline: dict[str, Any], lessons: list[dict[str, Any]]) -> str:
    source = material.get("source") if isinstance(material.get("source"), dict) else {}
    basis = json.dumps(
        {
            "material_id": material.get("material_id"),
            "source_id": source.get("source_id"),
            "course_title": (outline.get("course") or {}).get("title"),
            "lesson_ids": [lesson.get("id") for lesson in lessons],
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    digest = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:10]
    base = _slug(source.get("source_id") or material.get("material_id") or "codex_course", "codex_course", 44)
    return _slug(f"{base}_{digest}", "codex_course", PACKAGE_ID_LIMIT)


def _source_type(value: Any) -> str:
    normalized = _clean_text(value, "manual_text").lower()
    if normalized == "groq_transcript":
        return "audio_transcript"
    if normalized in {"bilibili_subtitle", "local_transcript", "audio_transcript", "merged_text", "manual_text"}:
        return normalized
    if "subtitle" in normalized or "字幕" in normalized:
        return "bilibili_subtitle"
    if "audio" in normalized or "transcript" in normalized or "转写" in normalized:
        return "audio_transcript"
    return "manual_text"


def _as_list(value: Any, limit: int | None = None) -> list[str]:
    if isinstance(value, list):
        items = [_clean_text(item) for item in value]
    elif value:
        items = [_clean_text(value)]
    else:
        items = []
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
        if limit and len(result) >= limit:
            break
    return result


def _infer_lesson_profile(raw: dict[str, Any], title: str, teaching: str) -> str:
    teacher = raw.get("teacher_ready_content") if isinstance(raw.get("teacher_ready_content"), dict) else {}
    lesson_type_tags = _as_list(teacher.get("lesson_type_tags") or raw.get("lesson_type_tags"), 12)
    tag_profile = next(
        (
            LESSON_TYPE_TAG_TO_PROFILE[tag.casefold()]
            for tag in lesson_type_tags
            if tag.casefold() in LESSON_TYPE_TAG_TO_PROFILE
        ),
        "",
    )
    explicit = _clean_text(teacher.get("lesson_profile") or raw.get("lesson_profile")).lower()
    if explicit == "mixed" and tag_profile:
        return tag_profile
    if explicit in LESSON_PROFILES:
        return explicit
    if tag_profile:
        return tag_profile

    haystack = f"{title} {raw.get('summary') or ''} {teaching}".casefold()
    if (
        any(term.casefold() in haystack for term in TOOL_TECH_TERMS)
        and any(term.casefold() in haystack for term in TOOL_SETUP_TERMS)
    ):
        return "tool_config"
    for profile in ("operation", "exam", "case_analysis", "strategy", "concept"):
        if any(keyword.casefold() in haystack for keyword in PROFILE_KEYWORDS[profile]):
            return profile
    return "mixed"


def _normalize_teacher_ready(raw: dict[str, Any], title: str) -> dict[str, Any]:
    teacher = raw.get("teacher_ready_content") if isinstance(raw.get("teacher_ready_content"), dict) else {}
    teaching = _clean_markdown(teacher.get("teaching_markdown"))
    question = _clean_text(teacher.get("quiz_question"))
    answer = _clean_markdown(teacher.get("standard_answer"))
    key_points = _as_list(teacher.get("key_points"), 10)
    mistakes = _as_list(teacher.get("common_mistakes"), 8)
    memory_hook = _clean_text(teacher.get("memory_hook"))
    lesson_profile = _infer_lesson_profile(raw, title, teaching)
    lesson_type_tags = _as_list(teacher.get("lesson_type_tags") or raw.get("lesson_type_tags"), 12)
    display_hints = _as_list(teacher.get("display_hints") or raw.get("display_hints"), 6)
    primary_training_action = _clean_text(
        teacher.get("primary_training_action") or raw.get("primary_training_action")
    )
    training_focus = _as_list(teacher.get("training_focus") or raw.get("training_focus"), 12)

    if not teaching:
        raise PackageError(f"课程节点「{title}」缺少 teacher_ready_content.teaching_markdown")
    if not question:
        raise PackageError(f"课程节点「{title}」缺少 teacher_ready_content.quiz_question")
    if not answer:
        raise PackageError(f"课程节点「{title}」缺少 teacher_ready_content.standard_answer")

    result: dict[str, Any] = {
        "lesson_profile": lesson_profile,
        "teaching_markdown": teaching,
        "quiz_question": question,
        "standard_answer": answer,
        "key_points": key_points,
        "common_mistakes": mistakes,
    }
    if display_hints:
        result["display_hints"] = display_hints
    if lesson_type_tags:
        result["lesson_type_tags"] = lesson_type_tags
    if primary_training_action:
        result["primary_training_action"] = primary_training_action
    if training_focus:
        result["training_focus"] = training_focus
    if memory_hook:
        result["memory_hook"] = memory_hook
    return result


def _normalize_knowledge(raw: dict[str, Any]) -> dict[str, Any]:
    knowledge = raw.get("knowledge") if isinstance(raw.get("knowledge"), dict) else {}

    concepts: list[dict[str, Any]] = []
    for index, item in enumerate(knowledge.get("concepts") or [], start=1):
        if not isinstance(item, dict):
            continue
        name = _clean_text(item.get("name"))
        explanation = _clean_text(item.get("explanation"))
        if not name or not explanation:
            continue
        concepts.append(
            {
                "id": _slug(item.get("id") or f"concept_{index:02d}", f"concept_{index:02d}"),
                "name": name,
                "explanation": explanation,
                "evidence": _as_list(item.get("evidence")),
            }
        )

    examples: list[dict[str, Any]] = []
    for index, item in enumerate(knowledge.get("examples") or [], start=1):
        if not isinstance(item, dict):
            continue
        title = _clean_text(item.get("title"))
        scenario = _clean_text(item.get("scenario"))
        takeaway = _clean_text(item.get("takeaway"))
        if not title or not scenario or not takeaway:
            continue
        examples.append(
            {
                "id": _slug(item.get("id") or f"example_{index:02d}", f"example_{index:02d}"),
                "title": title,
                "scenario": scenario,
                "takeaway": takeaway,
            }
        )

    return {
        "concepts": concepts,
        "examples": examples,
        "checkpoints": _as_list(knowledge.get("checkpoints")),
        "common_mistakes": _as_list(knowledge.get("common_mistakes")),
        "source_scope": _as_list(knowledge.get("source_scope")),
        "teaching_expansion": _as_list(knowledge.get("teaching_expansion")),
        "practical_steps": _as_list(knowledge.get("practical_steps")),
        "practice_tasks": _as_list(knowledge.get("practice_tasks")),
        "transfer_prompts": _as_list(knowledge.get("transfer_prompts")),
        "enrichment_notes": _as_list(knowledge.get("enrichment_notes")),
    }


def _normalize_source_refs(raw: dict[str, Any]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for item in raw.get("source_refs") or []:
        if not isinstance(item, dict):
            continue
        label = _clean_text(item.get("label"))
        if not label:
            continue
        ref: dict[str, Any] = {
            "kind": item.get("kind") if item.get("kind") in {
                "material_block",
                "subtitle_segment",
                "transcript_excerpt",
                "material_package",
                "note",
                "other",
            } else "material_block",
            "label": label,
        }
        for key in ("block_id", "excerpt", "uri"):
            value = _clean_text(item.get(key))
            if value:
                ref[key] = value
        if isinstance(item.get("time_range"), dict):
            ref["time_range"] = {
                "from": item["time_range"].get("from"),
                "to": item["time_range"].get("to"),
            }
        refs.append(ref)
    return refs


def _roadmap_id(value: Any, fallback_index: int) -> str:
    raw = _slug(value, f"rm_{fallback_index:03d}", 52)
    if raw.startswith("rm_"):
        return raw
    return _slug(f"rm_{raw}", f"rm_{fallback_index:03d}", 52)


def _clamp_unit(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, number))


def _normalize_chapter_roadmap_visual_asset(
    value: Any,
    lesson_ids: set[str],
) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    alt = _clean_text(value.get("alt"))
    prompt = _clean_text(value.get("prompt"))
    if not alt or not prompt:
        return None

    status = _clean_text(value.get("status"), "planned").lower()
    if status not in ROADMAP_VISUAL_ASSET_STATUSES:
        status = "planned"

    uri = _clean_text(value.get("uri"))
    if status == "attached" and not uri:
        status = "planned"

    result: dict[str, Any] = {
        "kind": "image",
        "alt": alt[:300],
        "prompt": prompt[:2000],
        "status": status,
    }

    asset_id = _slug(value.get("asset_id"), "", 86)
    if asset_id:
        if not asset_id.startswith("asset_"):
            asset_id = _slug(f"asset_{asset_id}", "asset_roadmap", 86)
        result["asset_id"] = asset_id
    if uri:
        result["uri"] = uri

    hotspots: list[dict[str, Any]] = []
    for index, item in enumerate(value.get("hotspots") or [], start=1):
        if not isinstance(item, dict):
            continue
        label = _clean_text(item.get("label"))
        x = _clamp_unit(item.get("x"))
        y = _clamp_unit(item.get("y"))
        width = _clamp_unit(item.get("width"))
        height = _clamp_unit(item.get("height"))
        if not label or x is None or y is None or not width or not height:
            continue
        hotspot_id = _slug(item.get("id"), f"hotspot_{index:03d}", 88)
        if not hotspot_id.startswith("hotspot_"):
            hotspot_id = _slug(f"hotspot_{hotspot_id}", f"hotspot_{index:03d}", 88)
        hotspot: dict[str, Any] = {
            "id": hotspot_id,
            "label": label[:40],
            "x": x,
            "y": y,
            "width": width,
            "height": height,
        }
        lesson_id = _slug(item.get("lesson_id"), "")
        if lesson_id and lesson_id in lesson_ids:
            hotspot["lesson_id"] = lesson_id
        hotspots.append(hotspot)
    if hotspots:
        result["hotspots"] = hotspots

    return result


def _normalize_course_visual_map(
    value: Any,
    *,
    chapter_ids: set[str],
    lesson_ids: set[str],
) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    alt = _clean_text(value.get("alt"))
    prompt = _clean_text(value.get("prompt"))
    if not alt or not prompt:
        return None

    status = _clean_text(value.get("status"), "planned").lower()
    if status not in ROADMAP_VISUAL_ASSET_STATUSES:
        status = "planned"

    uri = _clean_text(value.get("uri"))
    if status == "attached" and not uri:
        status = "planned"

    result: dict[str, Any] = {
        "kind": "image",
        "alt": alt[:300],
        "prompt": prompt[:2400],
        "status": status,
    }

    asset_id = _slug(value.get("asset_id"), "", 86)
    if asset_id:
        if not asset_id.startswith("asset_"):
            asset_id = _slug(f"asset_{asset_id}", "asset_course_visual_map", 86)
        result["asset_id"] = asset_id
    if uri:
        result["uri"] = uri

    hotspots: list[dict[str, Any]] = []
    for index, item in enumerate(value.get("hotspots") or [], start=1):
        if not isinstance(item, dict):
            continue
        label = _clean_text(item.get("label"))
        x = _clamp_unit(item.get("x"))
        y = _clamp_unit(item.get("y"))
        width = _clamp_unit(item.get("width"))
        height = _clamp_unit(item.get("height"))
        if not label or x is None or y is None or not width or not height:
            continue
        hotspot_id = _slug(item.get("id"), f"hotspot_{index:03d}", 88)
        if not hotspot_id.startswith("hotspot_"):
            hotspot_id = _slug(f"hotspot_{hotspot_id}", f"hotspot_{index:03d}", 88)
        hotspot: dict[str, Any] = {
            "id": hotspot_id,
            "label": label[:60],
            "x": x,
            "y": y,
            "width": width,
            "height": height,
        }
        chapter_id = _slug(item.get("chapter_id"), "")
        if chapter_id and chapter_id in chapter_ids:
            hotspot["chapter_id"] = chapter_id
        lesson_id = _slug(item.get("lesson_id"), "")
        if lesson_id and lesson_id in lesson_ids:
            hotspot["lesson_id"] = lesson_id
        hotspots.append(hotspot)
    if hotspots:
        result["hotspots"] = hotspots

    return result


def _normalize_chapter_roadmap(
    raw_chapter: dict[str, Any],
    title: str,
    summary: str,
    chapter_lessons: list[dict[str, Any]],
) -> dict[str, Any] | None:
    raw = raw_chapter.get("chapter_roadmap")
    if not isinstance(raw, dict):
        raw = raw_chapter.get("roadmap")
    if not isinstance(raw, dict):
        return None

    lesson_ids = {lesson["id"] for lesson in chapter_lessons}
    raw_nodes = raw.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        return None

    nodes: list[dict[str, Any]] = []
    node_ids: set[str] = set()
    for index, item in enumerate(raw_nodes, start=1):
        if not isinstance(item, dict):
            continue
        node_title = _clean_text(item.get("title"))
        if not node_title:
            continue
        node_id = _roadmap_id(item.get("id"), index)
        if node_id in node_ids:
            node_id = _roadmap_id(f"{node_id}_{index}", index)
        node_ids.add(node_id)
        node: dict[str, Any] = {
            "id": node_id,
            "title": node_title,
        }
        lesson_id = _slug(item.get("lesson_id"), "")
        if lesson_id and lesson_id in lesson_ids:
            node["lesson_id"] = lesson_id
        summary_text = _clean_text(item.get("summary"))
        if summary_text:
            node["summary"] = summary_text
        for key in (
            "map_label",
            "micro_question",
            "action_tag",
            "risk_tag",
            "output_tag",
            "core_question",
            "key_claim",
            "counterpoint",
            "completion_signal",
        ):
            value = _clean_text(item.get(key))
            if value:
                node[key] = value
        role = _clean_text(item.get("role")).lower()
        if role in ROADMAP_ROLES:
            node["role"] = role
        tone = _clean_text(item.get("tone")).lower()
        if tone in ROADMAP_TONES:
            node["tone"] = tone
        nodes.append(node)

    if not nodes:
        return None

    edges: list[dict[str, Any]] = []
    for item in raw.get("edges") or []:
        if not isinstance(item, dict):
            continue
        from_id = _roadmap_id(item.get("from"), 0)
        to_id = _roadmap_id(item.get("to"), 0)
        if from_id not in node_ids or to_id not in node_ids:
            continue
        edge: dict[str, Any] = {"from": from_id, "to": to_id}
        kind = _clean_text(item.get("kind")).lower()
        if kind in ROADMAP_EDGE_KINDS:
            edge["kind"] = kind
        label = _clean_text(item.get("label"))
        if label:
            edge["label"] = label
        edges.append(edge)

    focus_cards: list[dict[str, Any]] = []
    for item in raw.get("focus_cards") or []:
        if not isinstance(item, dict):
            continue
        card_title = _clean_text(item.get("title"))
        bullets = _as_list(item.get("bullets"), 6)
        if card_title and bullets:
            focus_cards.append({"title": card_title, "bullets": bullets})

    def _roadmap_ref(value: Any) -> str:
        text = _clean_text(value)
        if not text:
            return ""
        normalized = _roadmap_id(text, 0)
        return normalized if normalized in node_ids else text

    def _lesson_ids(value: Any, limit: int = 8) -> list[str]:
        ids: list[str] = []
        for item in _as_list(value, limit):
            lesson_id = _slug(item, "")
            if lesson_id and lesson_id in lesson_ids:
                ids.append(lesson_id)
        return ids

    turning_points: list[dict[str, Any]] = []
    for item in raw.get("turning_points") or []:
        if not isinstance(item, dict):
            continue
        point_title = _clean_text(item.get("title"))
        reason = _clean_text(item.get("reason"))
        if not point_title or not reason:
            continue
        point: dict[str, Any] = {"title": point_title, "reason": reason}
        from_ref = _roadmap_ref(item.get("from"))
        to_ref = _roadmap_ref(item.get("to"))
        if from_ref:
            point["from"] = from_ref
        if to_ref:
            point["to"] = to_ref
        ids = _lesson_ids(item.get("lesson_ids"))
        if ids:
            point["lesson_ids"] = ids
        turning_points.append(point)

    tension_edges: list[dict[str, Any]] = []
    for item in raw.get("tension_edges") or []:
        if not isinstance(item, dict):
            continue
        from_ref = _roadmap_ref(item.get("from"))
        to_ref = _roadmap_ref(item.get("to"))
        tension = _clean_text(item.get("tension"))
        if not from_ref or not to_ref or not tension:
            continue
        edge: dict[str, Any] = {"from": from_ref, "to": to_ref, "tension": tension}
        label = _clean_text(item.get("label"))
        if label:
            edge["label"] = label
        resolution_hint = _clean_text(item.get("resolution_hint"))
        if resolution_hint:
            edge["resolution_hint"] = resolution_hint
        tension_edges.append(edge)

    conflict_nodes: list[dict[str, Any]] = []
    for item in raw.get("conflict_nodes") or []:
        if not isinstance(item, dict):
            continue
        conflict_title = _clean_text(item.get("title"))
        claim = _clean_text(item.get("claim"))
        counterpoint = _clean_text(item.get("counterpoint"))
        why_it_matters = _clean_text(item.get("why_it_matters"))
        if not conflict_title or not claim or not counterpoint or not why_it_matters:
            continue
        conflict: dict[str, Any] = {
            "title": conflict_title,
            "claim": claim,
            "counterpoint": counterpoint,
            "why_it_matters": why_it_matters,
        }
        ids = _lesson_ids(item.get("lesson_ids"))
        if ids:
            conflict["lesson_ids"] = ids
        conflict_nodes.append(conflict)

    open_questions: list[dict[str, Any]] = []
    for item in raw.get("open_questions") or []:
        if not isinstance(item, dict):
            continue
        question = _clean_text(item.get("question"))
        why_it_matters = _clean_text(item.get("why_it_matters"))
        if not question or not why_it_matters:
            continue
        open_question: dict[str, Any] = {"question": question, "why_it_matters": why_it_matters}
        ids = _lesson_ids(item.get("related_lesson_ids"))
        if ids:
            open_question["related_lesson_ids"] = ids
        open_questions.append(open_question)

    roadmap_type = _clean_text(raw.get("roadmap_type"), "workflow")
    if roadmap_type not in ROADMAP_TYPES:
        roadmap_type = "workflow"

    result: dict[str, Any] = {
        "roadmap_type": roadmap_type,
        "title": _clean_text(raw.get("title"), f"{title}：章节地图"),
        "nodes": nodes,
    }
    subtitle = _clean_text(raw.get("subtitle"), summary)
    if subtitle:
        result["subtitle"] = subtitle
    visual_asset = _normalize_chapter_roadmap_visual_asset(raw.get("visual_asset"), lesson_ids)
    if visual_asset:
        result["visual_asset"] = visual_asset
    if edges:
        result["edges"] = edges
    if focus_cards:
        result["focus_cards"] = focus_cards
    completion_signals = _as_list(raw.get("completion_signals"), 6)
    if completion_signals:
        result["completion_signals"] = completion_signals
    if turning_points:
        result["turning_points"] = turning_points
    if tension_edges:
        result["tension_edges"] = tension_edges
    if conflict_nodes:
        result["conflict_nodes"] = conflict_nodes
    if open_questions:
        result["open_questions"] = open_questions
    return result


def _empty_assets() -> list[dict[str, Any]]:
    return []


def _empty_gaps() -> list[dict[str, Any]]:
    return []


def _normalize_lesson(raw: dict[str, Any], order: int) -> dict[str, Any]:
    title = _clean_text(raw.get("title"), f"未命名课程节点 {order}")
    node_id = _slug(raw.get("id") or f"lesson_{order:03d}", f"lesson_{order:03d}")
    summary = _clean_text(raw.get("summary"), title)
    return {
        "id": node_id,
        "node_type": "lesson",
        "title": title,
        "summary": summary,
        "order": int(raw.get("order") or order),
        "learning_objectives": _as_list(raw.get("learning_objectives")) or [summary],
        "teacher_ready_content": _normalize_teacher_ready(raw, title),
        "source_refs": _normalize_source_refs(raw),
        "dependencies": [_slug(item, "lesson") for item in _as_list(raw.get("dependencies"))],
        "knowledge": _normalize_knowledge(raw),
        "children": [],
        "assets": _empty_assets(),
        "gaps": _empty_gaps(),
    }


def _load_lessons(lessons_dir: Path) -> list[dict[str, Any]]:
    if not lessons_dir.exists():
        raise PackageError(f"缺少 lesson 草稿目录：{lessons_dir}")

    lessons: list[dict[str, Any]] = []
    for path in sorted(lessons_dir.glob("*.json")):
        raw = _load_json(path)
        if isinstance(raw.get("lessons"), list):
            for item in raw["lessons"]:
                if isinstance(item, dict):
                    item = dict(item)
                    item.setdefault("_draft_path", str(path))
                    lessons.append(item)
        else:
            raw.setdefault("_draft_path", str(path))
            lessons.append(raw)
    if not lessons:
        raise PackageError(f"没有找到 lesson 草稿：{lessons_dir}")
    return lessons


def _outline_chapters(outline: dict[str, Any], lessons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    raw_chapters = outline.get("chapters")
    if not isinstance(raw_chapters, list) or not raw_chapters:
        return [
            {
                "id": "chapter_01",
                "title": "主线课程",
                "summary": "由 Codex 根据原材料包生成的学习主线。",
                "order": 1,
                "lesson_ids": [lesson.get("id") for lesson in lessons],
            }
        ]
    return [chapter for chapter in raw_chapters if isinstance(chapter, dict)]


def _build_chapters(outline: dict[str, Any], normalized_lessons: list[dict[str, Any]], raw_lessons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    raw_by_id = {
        _slug(raw.get("id") or f"lesson_{index:03d}", f"lesson_{index:03d}"): raw
        for index, raw in enumerate(raw_lessons, start=1)
    }
    lessons_by_id = {lesson["id"]: lesson for lesson in normalized_lessons}
    assigned: set[str] = set()
    chapters: list[dict[str, Any]] = []

    for chapter_index, raw_chapter in enumerate(_outline_chapters(outline, raw_lessons), start=1):
        chapter_id = _slug(raw_chapter.get("id") or f"chapter_{chapter_index:02d}", f"chapter_{chapter_index:02d}")
        lesson_ids = _as_list(raw_chapter.get("lesson_ids"))
        if not lesson_ids and isinstance(raw_chapter.get("lessons"), list):
            lesson_ids = [
                _clean_text(item.get("id") if isinstance(item, dict) else item)
                for item in raw_chapter["lessons"]
            ]

        chapter_lessons: list[dict[str, Any]] = []
        if lesson_ids:
            for lesson_id in lesson_ids:
                normalized_id = _slug(lesson_id, "lesson")
                lesson = lessons_by_id.get(normalized_id)
                if lesson:
                    chapter_lessons.append(lesson)
                    assigned.add(normalized_id)
        else:
            for lesson in normalized_lessons:
                raw = raw_by_id.get(lesson["id"], {})
                raw_chapter_id = _slug(raw.get("chapter_id"), "")
                if raw_chapter_id and raw_chapter_id == chapter_id:
                    chapter_lessons.append(lesson)
                    assigned.add(lesson["id"])

        title = _clean_text(raw_chapter.get("title"), f"第 {chapter_index} 章")
        summary = _clean_text(raw_chapter.get("summary"), title)
        sorted_chapter_lessons = sorted(chapter_lessons, key=lambda item: int(item.get("order") or 0))
        chapter: dict[str, Any] = {
            "id": chapter_id,
            "node_type": "chapter",
            "title": title,
            "summary": summary,
            "order": int(raw_chapter.get("order") or chapter_index),
            "learning_objectives": _as_list(raw_chapter.get("learning_objectives")) or [summary],
            "teacher_ready_content": {
                "teaching_markdown": _clean_text(raw_chapter.get("teaching_markdown"), f"## 这一章要学会什么\n\n{summary}"),
                "quiz_question": _clean_text(raw_chapter.get("quiz_question"), f"用自己的话说说「{title}」这一章的主线。"),
                "standard_answer": _clean_text(raw_chapter.get("standard_answer"), summary),
                "key_points": _as_list(raw_chapter.get("key_points")) or [summary],
                "common_mistakes": _as_list(raw_chapter.get("common_mistakes")),
            },
            "source_refs": _normalize_source_refs(raw_chapter),
            "dependencies": [_slug(item, "chapter") for item in _as_list(raw_chapter.get("dependencies"))],
            "knowledge": _normalize_knowledge(raw_chapter),
            "children": sorted_chapter_lessons,
            "assets": _empty_assets(),
            "gaps": _empty_gaps(),
        }
        chapter_roadmap = _normalize_chapter_roadmap(raw_chapter, title, summary, sorted_chapter_lessons)
        if chapter_roadmap:
            chapter["chapter_roadmap"] = chapter_roadmap
        chapters.append(chapter)

    unassigned = [lesson for lesson in normalized_lessons if lesson["id"] not in assigned]
    if unassigned:
        chapters.append(
            {
                "id": "chapter_unsorted",
                "node_type": "chapter",
                "title": "未分组课程节点",
                "summary": "这些课程节点未在 outline.draft.json 中分配章节。",
                "order": len(chapters) + 1,
                "learning_objectives": ["补齐未分组课程节点的章节归属。"],
                "teacher_ready_content": {
                    "teaching_markdown": "## 这一章要学会什么\n\n这些课程节点已经生成，但还没有被分配到正式章节。",
                    "quiz_question": "这些未分组节点分别应该归入哪条学习主线？",
                    "standard_answer": "把未分组节点移入合适章节，或在 outline.draft.json 中新增章节。",
                    "key_points": ["未分组节点可以导入学习，但建议在正式使用前整理章节结构。"],
                    "common_mistakes": ["把所有未分组节点长期留在一个临时章节里。"],
                },
                "source_refs": [],
                "dependencies": [],
                "knowledge": _normalize_knowledge({}),
                "children": sorted(unassigned, key=lambda item: int(item.get("order") or 0)),
                "assets": [],
                "gaps": [],
            }
        )

    return chapters


def assemble_course_package(material_dir: Path) -> dict[str, Any]:
    manifest = _load_json(material_dir / "manifest.json")
    outline = _load_json(material_dir / "course_draft" / "outline.draft.json")
    raw_lessons = _load_lessons(material_dir / "course_draft" / "lessons")
    normalized_lessons = [
        _normalize_lesson(raw, index)
        for index, raw in enumerate(raw_lessons, start=1)
    ]

    source = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
    outline_course = outline.get("course") if isinstance(outline.get("course"), dict) else {}
    package_id = _stable_package_id(manifest, outline, normalized_lessons)
    title = _clean_text(outline_course.get("title") or source.get("title"), "Codex 课程包")
    overall_goal = _clean_text(outline_course.get("overall_goal"), f"掌握「{title}」的核心知识、应用方式和常见误区。")
    learning_outcomes = _as_list(outline_course.get("learning_outcomes")) or [
        "能用自己的话讲清课程主线。",
        "能完成每节主动回忆并对照标准答案修正。",
    ]
    chapters = _build_chapters(outline, normalized_lessons, raw_lessons)
    visual_maps = outline.get("visual_maps") if isinstance(outline.get("visual_maps"), dict) else {}
    course_visual_map_raw = (
        outline.get("course_visual_map")
        or outline_course.get("course_visual_map")
        or visual_maps.get("global_course_map")
        or visual_maps.get("course_visual_map")
    )
    course_visual_map = _normalize_course_visual_map(
        course_visual_map_raw,
        chapter_ids={chapter["id"] for chapter in chapters},
        lesson_ids={lesson["id"] for lesson in normalized_lessons},
    )

    package = {
        "schema_version": SCHEMA_VERSION,
        "package_id": package_id,
        "source": {
            "source_type": _source_type(source.get("source_type")),
            "source_id": _clean_text(source.get("source_id") or manifest.get("material_id"), package_id),
            "title": _clean_text(source.get("title"), title),
            "creator": _clean_text(source.get("creator")),
            "url": _clean_text(source.get("url")),
            "language": _clean_text(source.get("language"), "zh"),
            "ingested_at": _clean_text(source.get("ingested_at"), datetime.now(timezone.utc).isoformat()),
            "text_length": int(manifest.get("text_length") or 0),
            "notes": _clean_text(outline_course.get("source_notes") or source.get("notes")),
        },
        "course": {
            "title": title,
            "subtitle": _clean_text(outline_course.get("subtitle")),
            "overall_goal": overall_goal,
            "target_audience": _clean_text(outline_course.get("target_audience"), "希望高效学习该主题的用户"),
            "prerequisites": _as_list(outline_course.get("prerequisites")),
            "learning_outcomes": learning_outcomes,
            "completion_definition": _clean_text(
                outline_course.get("completion_definition"),
                "完成全部课程节点，并完成每节主动回忆与标准答案对照。",
            ),
            "estimated_total_minutes": int(outline_course.get("estimated_total_minutes") or max(15, len(normalized_lessons) * 8)),
        },
        "chapters": chapters,
        "dependency_graph": [],
        "assets": [],
        "gaps": [],
    }
    if course_visual_map:
        package["course_visual_map"] = course_visual_map
    return package


def _audit_or_raise(package: dict[str, Any], strict: bool, report_path: Path | None = None) -> dict[str, Any]:
    report = audit_course_package(package)
    if report_path is not None:
        _save_json(report_path, report)
    counts = report.get("severity_counts") or {}
    errors = int(counts.get("error") or 0)
    warnings = int(counts.get("warning") or 0)
    if strict and (errors or warnings):
        raise PackageError(f"课程包质量审计发现 {errors} 个 error、{warnings} 个 warning，请先修正 course_draft 后再打包。")
    return report


def _resolve_publish_dir(material_dir: Path) -> Path:
    # Canonical layout:
    # output/
    #   materials/<name>.course_material/
    #   courses/<title>.course-package.json
    if material_dir.parent.name == "materials":
        return material_dir.parent.parent / "courses"
    return material_dir.parent / "courses"


def publish_course_package(
    material_dir: Path,
    output_path: Path,
    report_path: Path,
    package: dict[str, Any],
) -> dict[str, str]:
    publish_dir = _resolve_publish_dir(material_dir)
    publish_dir.mkdir(parents=True, exist_ok=True)
    title = ((package.get("course") or {}).get("title") or package.get("package_id") or material_dir.name)
    stem = _safe_filename_stem(title, "course")
    published_course_path = publish_dir / f"{stem}.course-package.json"
    published_report_path = publish_dir / f"{stem}.course-package.quality-report.json"
    shutil.copy2(output_path, published_course_path)
    shutil.copy2(report_path, published_report_path)
    return {
        "publishedCoursePath": str(published_course_path),
        "publishedReportPath": str(published_report_path),
    }


def update_handoff_status(
    material_dir: Path,
    *,
    package_path: Path,
    report_path: Path,
    publish_result: dict[str, str],
    package: dict[str, Any],
) -> None:
    status_path = material_dir / "handoff_status.json"
    if not status_path.exists():
        return
    try:
        status = json.loads(status_path.read_text(encoding="utf-8"))
    except Exception:
        return

    status["stage"] = "course_ready"
    status["stage_label"] = "课包可导入"
    status["next_action"] = "回到视界专注工作台，点击这条制作记录的导入按钮。"
    paths = status.setdefault("paths", {})
    paths["final_course"] = str(package_path)
    paths["quality_report"] = str(report_path)
    if publish_result.get("publishedCoursePath"):
        paths["published_course"] = publish_result["publishedCoursePath"]
    if publish_result.get("publishedReportPath"):
        paths["published_report"] = publish_result["publishedReportPath"]

    steps = status.get("steps")
    if isinstance(steps, list):
        for step in steps:
            if not isinstance(step, dict):
                continue
            if step.get("id") in {"gpt_blueprint", "codex_course"}:
                step["status"] = "done"
            if step.get("id") == "import_course":
                step["status"] = "next"

    status["course"] = {
        "package_id": package.get("package_id"),
        "title": (package.get("course") or {}).get("title"),
        "lesson_count": sum(1 for chapter in package.get("chapters", []) for node in chapter.get("children", []) if isinstance(node, dict)),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_json(status_path, status)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Assemble Codex lesson drafts into a Course Package JSON.")
    parser.add_argument("material_dir", help="Path to course_material directory containing manifest.json and course_draft/.")
    parser.add_argument("--output", help="Output .course-package.json path. Defaults to course_draft/final.course-package.json.")
    parser.add_argument("--report", help="Optional quality audit report path.")
    parser.add_argument("--strict", action="store_true", help="Fail when course quality audit reports student-facing errors or warnings.")
    parser.add_argument("--no-publish", action="store_true", help="Only write course_draft/final.course-package.json; do not copy into output/courses.")
    args = parser.parse_args(argv)

    material_dir = Path(args.material_dir).resolve()
    output_path = Path(args.output).resolve() if args.output else material_dir / "course_draft" / "final.course-package.json"
    report_path = Path(args.report).resolve() if args.report else output_path.with_suffix(".quality-report.json")

    try:
        package = assemble_course_package(material_dir)
        report = _audit_or_raise(package, args.strict, report_path)
        _save_json(output_path, package)
        _save_json(report_path, report)
        publish_result = (
            {}
            if args.no_publish
            else publish_course_package(material_dir, output_path, report_path, package)
        )
        update_handoff_status(
            material_dir,
            package_path=output_path,
            report_path=report_path,
            publish_result=publish_result,
            package=package,
        )
    except PackageError as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return 1

    print(json.dumps({
        "packagePath": str(output_path),
        "reportPath": str(report_path),
        **publish_result,
        "packageId": package["package_id"],
        "courseTitle": package["course"]["title"],
        "auditScore": report.get("score"),
        "premiumScore": report.get("premium_score"),
        "auditErrors": (report.get("severity_counts") or {}).get("error", 0),
        "auditWarnings": (report.get("severity_counts") or {}).get("warning", 0),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

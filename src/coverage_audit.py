# -*- coding: utf-8 -*-
"""Audit a 视界专注 course blueprint/package for source coverage risks.

This script is intentionally conservative: it does not grade lesson prose. It
checks whether a long material pack has been compressed too aggressively, whether
high-value topics were silently dropped, and whether chapter roadmaps contain
useful cognitive structure beyond a plain lesson order.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def _load_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except FileNotFoundError:
        return {}
    if isinstance(payload, dict):
        return payload
    return {}


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _text(value: Any) -> str:
    return str(value or "").strip()


def _normalized_text(value: Any) -> str:
    text = _text(value).lower()
    return re.sub(r"[\s`~!@#$%^&*()_\-+=\[\]{}|\\:;\"'<>,.?/，。！？、；：“”‘’（）【】《》]+", "", text)


def _material_scale(manifest: dict[str, Any]) -> tuple[int, int, int]:
    text_length = int(manifest.get("text_length") or 0)
    raw_length = int(manifest.get("raw_transcript_length") or 0)
    block_count = int(manifest.get("block_count") or 0)
    return text_length, raw_length, block_count


def _collect_blueprint_lessons(blueprint: dict[str, Any]) -> list[dict[str, Any]]:
    lessons: list[dict[str, Any]] = []
    for chapter in _as_list(blueprint.get("chapters")):
        if isinstance(chapter, dict):
            lessons.extend(item for item in _as_list(chapter.get("lessons")) if isinstance(item, dict))
    return lessons


def _collect_package_lessons(node: dict[str, Any]) -> list[dict[str, Any]]:
    if node.get("node_type") == "lesson":
        return [node]
    lessons: list[dict[str, Any]] = []
    for child in _as_list(node.get("children")):
        if isinstance(child, dict):
            lessons.extend(_collect_package_lessons(child))
    return lessons


def _package_lesson_count(package: dict[str, Any]) -> int:
    lessons: list[dict[str, Any]] = []
    for chapter in _as_list(package.get("chapters")):
        if isinstance(chapter, dict):
            lessons.extend(_collect_package_lessons(chapter))
    return len(lessons)


def _roadmap_stats(blueprint: dict[str, Any]) -> dict[str, int]:
    stats = {
        "chapters": 0,
        "roadmaps": 0,
        "visual_assets": 0,
        "visual_asset_prompts": 0,
        "attached_visual_assets": 0,
        "visual_asset_hotspots": 0,
        "course_visual_maps": 0,
        "course_visual_map_prompts": 0,
        "attached_course_visual_maps": 0,
        "course_visual_map_hotspots": 0,
        "plain_linear_roadmaps": 0,
        "nodes": 0,
        "edges": 0,
        "tension_edges": 0,
        "conflict_nodes": 0,
        "turning_points": 0,
        "open_questions": 0,
    }
    course_visual_map = blueprint.get("course_visual_map")
    if not isinstance(course_visual_map, dict):
        visual_maps = blueprint.get("visual_maps") if isinstance(blueprint.get("visual_maps"), dict) else {}
        course_visual_map = visual_maps.get("global_course_map")
    if isinstance(course_visual_map, dict):
        stats["course_visual_maps"] = 1
        if _text(course_visual_map.get("prompt")):
            stats["course_visual_map_prompts"] = 1
        if _text(course_visual_map.get("status")) == "attached":
            stats["attached_course_visual_maps"] = 1
        stats["course_visual_map_hotspots"] = len(_as_list(course_visual_map.get("hotspots")))
    for chapter in _as_list(blueprint.get("chapters")):
        if not isinstance(chapter, dict):
            continue
        stats["chapters"] += 1
        roadmap = chapter.get("chapter_roadmap")
        if not isinstance(roadmap, dict):
            continue
        stats["roadmaps"] += 1
        visual_asset = roadmap.get("visual_asset")
        if isinstance(visual_asset, dict):
            stats["visual_assets"] += 1
            if _text(visual_asset.get("prompt")):
                stats["visual_asset_prompts"] += 1
            if _text(visual_asset.get("status")) == "attached":
                stats["attached_visual_assets"] += 1
            stats["visual_asset_hotspots"] += len(_as_list(visual_asset.get("hotspots")))
        nodes = _as_list(roadmap.get("nodes"))
        edges = _as_list(roadmap.get("edges"))
        tension_edges = _as_list(roadmap.get("tension_edges"))
        conflict_nodes = _as_list(roadmap.get("conflict_nodes"))
        turning_points = _as_list(roadmap.get("turning_points"))
        open_questions = _as_list(roadmap.get("open_questions"))
        stats["nodes"] += len(nodes)
        stats["edges"] += len(edges)
        stats["tension_edges"] += len(tension_edges)
        stats["conflict_nodes"] += len(conflict_nodes)
        stats["turning_points"] += len(turning_points)
        stats["open_questions"] += len(open_questions)
        has_cognitive_layer = any((tension_edges, conflict_nodes, turning_points, open_questions))
        edge_kinds = {
            _text(edge.get("kind"))
            for edge in edges
            if isinstance(edge, dict) and _text(edge.get("kind"))
        }
        if nodes and not has_cognitive_layer and (not edge_kinds or edge_kinds <= {"next", "depends_on"}):
            stats["plain_linear_roadmaps"] += 1
    return stats


def _visual_asset_issues(blueprint: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    course_visual_map = blueprint.get("course_visual_map")
    if not isinstance(course_visual_map, dict):
        visual_maps = blueprint.get("visual_maps") if isinstance(blueprint.get("visual_maps"), dict) else {}
        course_visual_map = visual_maps.get("global_course_map")
    if isinstance(course_visual_map, dict):
        status = _text(course_visual_map.get("status"))
        prompt = _text(course_visual_map.get("prompt"))
        alt = _text(course_visual_map.get("alt"))
        uri = _text(course_visual_map.get("uri"))
        if not alt or not prompt:
            issues.append({"chapter": "全局课程地图", "code": "course_visual_map_missing_alt_or_prompt"})
        elif len(prompt) < 80:
            issues.append({"chapter": "全局课程地图", "code": "course_visual_map_prompt_too_short"})
        if status == "attached" and not uri:
            issues.append({"chapter": "全局课程地图", "code": "course_visual_map_attached_without_uri"})
        for hotspot in _as_list(course_visual_map.get("hotspots")):
            if not isinstance(hotspot, dict):
                continue
            for key in ("x", "y", "width", "height"):
                value = hotspot.get(key)
                if not isinstance(value, (int, float)) or value < 0 or value > 1:
                    issues.append({"chapter": "全局课程地图", "code": "course_visual_map_hotspot_out_of_range"})
                    break
    for chapter in _as_list(blueprint.get("chapters")):
        if not isinstance(chapter, dict):
            continue
        chapter_title = _text(chapter.get("title")) or _text(chapter.get("chapter_id")) or "未命名章节"
        roadmap = chapter.get("chapter_roadmap")
        if not isinstance(roadmap, dict):
            continue
        visual_asset = roadmap.get("visual_asset")
        if not isinstance(visual_asset, dict):
            continue
        status = _text(visual_asset.get("status"))
        prompt = _text(visual_asset.get("prompt"))
        alt = _text(visual_asset.get("alt"))
        uri = _text(visual_asset.get("uri"))
        if not alt or not prompt:
            issues.append({"chapter": chapter_title, "code": "visual_asset_missing_alt_or_prompt"})
            continue
        if len(prompt) < 30 or re.fullmatch(r"生成一张.{0,12}(思维导图|路线图|流程图).{0,12}", prompt):
            issues.append({"chapter": chapter_title, "code": "visual_asset_prompt_too_generic"})
        if status == "attached" and not uri:
            issues.append({"chapter": chapter_title, "code": "visual_asset_attached_without_uri"})
        for hotspot in _as_list(visual_asset.get("hotspots")):
            if not isinstance(hotspot, dict):
                continue
            for key in ("x", "y", "width", "height"):
                value = hotspot.get(key)
                if not isinstance(value, (int, float)) or value < 0 or value > 1:
                    issues.append({"chapter": chapter_title, "code": "visual_asset_hotspot_out_of_range"})
                    break
    return issues


def _collect_roadmap_strings(roadmap: dict[str, Any]) -> list[str]:
    strings: list[str] = []
    fields_by_collection = {
        "nodes": [
            "title",
            "map_label",
            "summary",
            "micro_question",
            "action_tag",
            "risk_tag",
            "output_tag",
            "core_question",
            "key_claim",
            "counterpoint",
            "completion_signal",
        ],
        "focus_cards": ["title"],
        "turning_points": ["title", "from", "to", "reason"],
        "tension_edges": ["label", "tension", "resolution_hint"],
        "conflict_nodes": ["title", "claim", "counterpoint", "why_it_matters"],
        "open_questions": ["question", "why_it_matters"],
    }
    for collection, fields in fields_by_collection.items():
        for item in _as_list(roadmap.get(collection)):
            if not isinstance(item, dict):
                continue
            for field in fields:
                value = _text(item.get(field))
                if value:
                    strings.append(value)
            if collection == "focus_cards":
                strings.extend(_text(bullet) for bullet in _as_list(item.get("bullets")) if _text(bullet))
    strings.extend(_text(signal) for signal in _as_list(roadmap.get("completion_signals")) if _text(signal))
    return strings


def _roadmap_text_stats(blueprint: dict[str, Any]) -> dict[str, Any]:
    node_count = 0
    text_heavy_nodes = 0
    long_titles = 0
    long_summaries = 0
    long_core_questions = 0
    long_edge_labels = 0
    visible_chars = 0
    max_node_chars = 0
    for chapter in _as_list(blueprint.get("chapters")):
        if not isinstance(chapter, dict):
            continue
        roadmap = chapter.get("chapter_roadmap")
        if not isinstance(roadmap, dict):
            continue
        for node in _as_list(roadmap.get("nodes")):
            if not isinstance(node, dict):
                continue
            node_count += 1
            title = _text(node.get("map_label") or node.get("title"))
            summary = _text(node.get("summary"))
            core_question = _text(node.get("micro_question") or node.get("core_question"))
            chips = [
                _text(node.get("action_tag")),
                _text(node.get("risk_tag")),
                _text(node.get("output_tag")),
            ]
            node_chars = len(title) + len(summary) + len(core_question) + sum(len(item) for item in chips)
            visible_chars += node_chars
            max_node_chars = max(max_node_chars, node_chars)
            if len(title) > 12:
                long_titles += 1
            if len(summary) > 36:
                long_summaries += 1
            if len(core_question) > 18:
                long_core_questions += 1
            if node_chars > 70:
                text_heavy_nodes += 1
        for edge in _as_list(roadmap.get("edges")):
            if isinstance(edge, dict) and len(_text(edge.get("label"))) > 8:
                long_edge_labels += 1
    avg_node_chars = round(visible_chars / node_count, 1) if node_count else 0
    return {
        "node_count": node_count,
        "avg_node_visible_chars": avg_node_chars,
        "max_node_visible_chars": max_node_chars,
        "text_heavy_nodes": text_heavy_nodes,
        "long_titles": long_titles,
        "long_summaries": long_summaries,
        "long_core_questions": long_core_questions,
        "long_edge_labels": long_edge_labels,
    }


def _roadmap_duplication_stats(blueprint: dict[str, Any]) -> dict[str, Any]:
    chapter_signatures: list[dict[str, str]] = []
    phrase_hits: dict[str, list[str]] = {}
    for chapter in _as_list(blueprint.get("chapters")):
        if not isinstance(chapter, dict):
            continue
        roadmap = chapter.get("chapter_roadmap")
        if not isinstance(roadmap, dict):
            continue
        chapter_title = _text(chapter.get("title")) or _text(chapter.get("chapter_id"))
        strings = _collect_roadmap_strings(roadmap)
        normalized_parts = []
        for value in strings:
            normalized = _normalized_text(value)
            if len(normalized) < 8:
                continue
            phrase_hits.setdefault(normalized, []).append(chapter_title)
            normalized_parts.append(normalized)
        chapter_signatures.append(
            {
                "chapter": chapter_title,
                "signature": "|".join(normalized_parts[:16]),
            }
        )

    repeated_phrases = [
        {"phrase": phrase, "chapters": sorted(set(chapters))}
        for phrase, chapters in phrase_hits.items()
        if len(set(chapters)) >= 2
    ][:12]

    similar_pairs: list[dict[str, Any]] = []
    for index, left in enumerate(chapter_signatures):
        for right in chapter_signatures[index + 1 :]:
            if not left["signature"] or not right["signature"]:
                continue
            ratio = SequenceMatcher(None, left["signature"], right["signature"]).ratio()
            if ratio >= 0.82:
                similar_pairs.append(
                    {
                        "chapters": [left["chapter"], right["chapter"]],
                        "similarity": round(ratio, 3),
                    }
                )

    return {
        "repeated_phrase_count": len(repeated_phrases),
        "repeated_phrases": repeated_phrases,
        "similar_signature_pairs": similar_pairs[:8],
    }


def _topic_stats(blueprint: dict[str, Any]) -> dict[str, Any]:
    topics = [item for item in _as_list(blueprint.get("topic_inventory")) if isinstance(item, dict)]
    high_topics = [item for item in topics if _text(item.get("importance")) == "high"]
    risky_high = [
        item
        for item in high_topics
        if _text(item.get("coverage_status")) in {"partial", "merged", "skipped"}
        or (item.get("should_be_lesson") is True and not _as_list(item.get("used_by_lessons")))
    ]
    return {
        "topic_count": len(topics),
        "high_topic_count": len(high_topics),
        "risky_high_topics": [
            {
                "topic": _text(item.get("topic")),
                "coverage_status": _text(item.get("coverage_status")),
                "handling_reason": _text(item.get("handling_reason")),
                "compression_learning_cost": _text(item.get("compression_learning_cost")),
                "compression_mitigation": _text(item.get("compression_mitigation")),
            }
            for item in risky_high
            if _text(item.get("topic"))
        ],
    }


def _blueprint_training_stats(blueprint: dict[str, Any]) -> dict[str, Any]:
    lessons = _collect_blueprint_lessons(blueprint)
    display_type_counts: dict[str, int] = {}
    required_display_type_counts: dict[str, int] = {}
    action_counts: dict[str, int] = {}
    training_slot_counts: dict[str, int] = {}
    training_combo_counts: dict[str, int] = {}
    lessons_with_training_policy = 0
    overloaded_required_slot_lessons = 0
    for lesson in lessons:
        action = _text(lesson.get("primary_training_action"))
        if action:
            action_counts[action] = action_counts.get(action, 0) + 1
        policy = lesson.get("training_policy")
        if isinstance(policy, dict):
            lessons_with_training_policy += 1
            slots = sorted(
                {
                    _text(slot)
                    for slot in _as_list(policy.get("must_include"))
                    if _text(slot)
                }
            )
            if len(slots) > 3:
                overloaded_required_slot_lessons += 1
            for slot in slots:
                training_slot_counts[slot] = training_slot_counts.get(slot, 0) + 1
            combo_key = "|".join(slots)
            if combo_key:
                training_combo_counts[combo_key] = training_combo_counts.get(combo_key, 0) + 1
        for block in _as_list(lesson.get("display_plan")):
            if not isinstance(block, dict):
                continue
            block_type = _text(block.get("type"))
            if not block_type:
                continue
            display_type_counts[block_type] = display_type_counts.get(block_type, 0) + 1
            if _text(block.get("priority")) == "required":
                required_display_type_counts[block_type] = required_display_type_counts.get(block_type, 0) + 1
    dominant_combo_key = ""
    dominant_combo_count = 0
    if training_combo_counts:
        dominant_combo_key, dominant_combo_count = max(training_combo_counts.items(), key=lambda item: item[1])
    dominant_combo_slots = dominant_combo_key.split("|") if dominant_combo_key else []
    dominant_combo_ratio = round(dominant_combo_count / len(lessons), 3) if lessons else 0
    return {
        "course_design_mode": _text(blueprint.get("course_design_mode")),
        "lesson_count": len(lessons),
        "lessons_with_primary_training_action": sum(action_counts.values()),
        "lessons_with_training_policy": lessons_with_training_policy,
        "primary_training_action_counts": action_counts,
        "training_slot_counts": training_slot_counts,
        "overloaded_required_slot_lessons": overloaded_required_slot_lessons,
        "dominant_training_policy_combo": {
            "slots": dominant_combo_slots,
            "count": dominant_combo_count,
            "ratio": dominant_combo_ratio,
        },
        "display_type_counts": display_type_counts,
        "required_display_type_counts": required_display_type_counts,
    }


def _count_markdown_tables(markdown: str) -> int:
    lines = markdown.splitlines()
    tables = 0
    for index in range(len(lines) - 1):
        line = lines[index].strip()
        next_line = lines[index + 1].strip()
        if line.startswith("|") and line.count("|") >= 2 and next_line.startswith("|") and re.search(r"\|[\s:-]+\|", next_line):
            tables += 1
    return tables


def _package_training_stats(package: dict[str, Any]) -> dict[str, Any]:
    lessons: list[dict[str, Any]] = []
    for chapter in _as_list(package.get("chapters")):
        if isinstance(chapter, dict):
            lessons.extend(_collect_package_lessons(chapter))

    example_pattern = re.compile(r"(例如|例句|例子|正例|反例|错句|改正|修正|对比|相近|易混|案例|场景)")
    correction_pattern = re.compile(r"(改错|错句|错误表现|修正|纠正|反例|易错)")
    transfer_pattern = re.compile(r"(迁移|变式|造句|应用到|换一个|自己判断|试着|练习)")
    stats = {
        "lesson_count": len(lessons),
        "table_lesson_count": 0,
        "table_count": 0,
        "lessons_with_example_signal": 0,
        "lessons_with_correction_signal": 0,
        "lessons_with_transfer_signal": 0,
        "lessons_with_training_signal": 0,
    }
    for lesson in lessons:
        ready = lesson.get("teacher_ready_content") if isinstance(lesson.get("teacher_ready_content"), dict) else {}
        content = "\n".join(
            [
                _text(ready.get("teaching_markdown")),
                _text(ready.get("quiz_question")),
                _text(ready.get("standard_answer")),
                "\n".join(_text(item) for item in _as_list(ready.get("key_points"))),
                "\n".join(_text(item) for item in _as_list(ready.get("common_mistakes"))),
            ]
        )
        table_count = _count_markdown_tables(content)
        if table_count:
            stats["table_lesson_count"] += 1
            stats["table_count"] += table_count
        has_example = bool(example_pattern.search(content))
        has_correction = bool(correction_pattern.search(content))
        has_transfer = bool(transfer_pattern.search(content))
        if has_example:
            stats["lessons_with_example_signal"] += 1
        if has_correction:
            stats["lessons_with_correction_signal"] += 1
        if has_transfer:
            stats["lessons_with_transfer_signal"] += 1
        if has_example or has_correction or has_transfer:
            stats["lessons_with_training_signal"] += 1
    return stats


def audit_material(material_dir: Path, *, package_path: Path | None = None) -> dict[str, Any]:
    manifest = _load_json(material_dir / "manifest.json")
    blueprint = _load_json(material_dir / "course_blueprint.json")
    package = _load_json(package_path) if package_path else _load_json(material_dir / "course_draft" / "final.course-package.json")
    text_length, raw_length, block_count = _material_scale(manifest)
    source_genre = _text(blueprint.get("source_genre"))
    learning_intent = _text(blueprint.get("learning_intent"))
    blueprint_lessons = _collect_blueprint_lessons(blueprint)
    package_lesson_count = _package_lesson_count(package) if package else 0
    lesson_count = package_lesson_count or len(blueprint_lessons)
    topic_stats = _topic_stats(blueprint)
    roadmap_stats = _roadmap_stats(blueprint)
    roadmap_text_stats = _roadmap_text_stats(blueprint) if blueprint else {}
    roadmap_duplication_stats = _roadmap_duplication_stats(blueprint) if blueprint else {}
    visual_asset_issues = _visual_asset_issues(blueprint) if blueprint else []
    blueprint_training_stats = _blueprint_training_stats(blueprint) if blueprint else {}
    package_training_stats = _package_training_stats(package) if package else {}

    warnings: list[dict[str, str]] = []
    infos: list[dict[str, str]] = []

    if not blueprint:
        warnings.append({"code": "missing_blueprint", "message": "未找到 course_blueprint.json，无法做蓝图覆盖审查。"})
    if text_length >= 30000 and lesson_count and lesson_count < 8:
        warnings.append(
            {
                "code": "long_material_short_course",
                "message": f"材料约 {text_length} 字，但课程只有 {lesson_count} 节；除非定位为快速导读，否则可能过度压缩。",
            }
        )
    if text_length >= 100000 and lesson_count and lesson_count < 16:
        warnings.append(
            {
                "code": "large_material_low_lesson_count",
                "message": f"材料超过 10 万字，当前 {lesson_count} 节偏紧；需要确认是否牺牲了中间推理层。",
            }
        )
    if source_genre in {"interview", "podcast", "panel", "documentary"} and learning_intent not in {"general_learning", "viewpoint_understanding", "industry_observation", "biography_study", "decision_reference"}:
        infos.append(
            {
                "code": "genre_intent_mismatch_check",
                "message": f"素材类型为 {source_genre}，学习目标为 {learning_intent}；请确认没有把访谈材料硬改成教程或考试课。",
            }
        )
    if source_genre in {"interview", "podcast", "panel", "documentary"} and roadmap_stats["roadmaps"] and roadmap_stats["plain_linear_roadmaps"] >= max(1, roadmap_stats["roadmaps"] // 2):
        warnings.append(
            {
                "code": "linear_roadmap_for_viewpoint_material",
                "message": "多数章节地图仍是线性顺序，访谈/观点材料建议补充观点张力、转折点或开放问题。",
            }
        )
    if roadmap_stats["chapters"] and roadmap_stats["roadmaps"] < roadmap_stats["chapters"]:
        warnings.append(
            {
                "code": "missing_chapter_roadmap",
                "message": f"{roadmap_stats['chapters']} 章中只有 {roadmap_stats['roadmaps']} 章提供 chapter_roadmap。",
            }
        )
    if roadmap_stats["roadmaps"] and roadmap_stats["visual_assets"] < roadmap_stats["roadmaps"]:
        infos.append(
            {
                "code": "missing_chapter_visual_asset",
                "message": f"{roadmap_stats['roadmaps']} 张章节地图中有 {roadmap_stats['visual_assets']} 张提供 visual_asset；旧课包可兼容，但新课包建议提供图片提示词。",
            }
        )
    if roadmap_stats["course_visual_maps"] < 1:
        infos.append(
            {
                "code": "missing_course_visual_map",
                "message": "当前蓝图未提供顶层 course_visual_map；课程可以正常学习，但不利于后续生成整门课的全局学习地图。",
            }
        )
    if visual_asset_issues:
        infos.append(
            {
                "code": "chapter_visual_asset_quality_check",
                "message": f"{len(visual_asset_issues)} 个 visual_asset 存在提示词过泛、缺字段或热点坐标问题；不阻塞打包，但会影响后续 AI 图片地图质量。",
            }
        )
    if topic_stats["high_topic_count"] == 0 and text_length >= 30000:
        warnings.append(
            {
                "code": "missing_high_value_topic_pool",
                "message": "长材料没有明显的 high topic candidate pool；GPT 可能只列了结果而没有先盘点主题。",
            }
        )
    if topic_stats["risky_high_topics"]:
        warnings.append(
            {
                "code": "risky_high_value_topics",
                "message": f"{len(topic_stats['risky_high_topics'])} 个高价值主题被合并、弱化、跳过或没有 lesson 承接。",
            }
        )
    if blueprint and not _text(blueprint.get("course_design_mode")):
        infos.append(
            {
                "code": "missing_course_design_mode",
                "message": "蓝图未声明 course_design_mode；Codex 可能无法判断本课应偏知识地图、操作训练、语法训练还是观点理解。",
            }
        )
    if roadmap_duplication_stats.get("repeated_phrase_count") or roadmap_duplication_stats.get("similar_signature_pairs"):
        warnings.append(
            {
                "code": "roadmap_semantic_duplication",
                "message": "多个章节地图存在重复表达或高度相似结构；需要确认是否把同一套认知转折复制到了不同章节。",
            }
        )
    if roadmap_text_stats:
        roadmap_node_count = int(roadmap_text_stats.get("node_count") or 0)
        if roadmap_node_count and (
            int(roadmap_text_stats.get("text_heavy_nodes") or 0) >= max(2, int(roadmap_node_count * 0.35))
            or float(roadmap_text_stats.get("avg_node_visible_chars") or 0) > 54
        ):
            warnings.append(
                {
                    "code": "roadmap_text_heavy",
                    "message": "章节地图节点文本偏重；建议提供 map_label/action_tag/risk_tag/output_tag 等短标签，把长说明放入隐藏设计字段。",
                }
            )
    lesson_total = int(blueprint_training_stats.get("lesson_count") or 0)
    required_tables = int(blueprint_training_stats.get("required_display_type_counts", {}).get("comparison_table", 0)) if blueprint_training_stats else 0
    required_practice = sum(
        int(blueprint_training_stats.get("required_display_type_counts", {}).get(key, 0))
        for key in ("practice_task", "case_example", "step_list", "troubleshooting_tree", "decision_tree")
    ) if blueprint_training_stats else 0
    if lesson_total and required_tables >= max(4, int(lesson_total * 0.55)) and required_practice < max(2, int(lesson_total * 0.25)):
        warnings.append(
            {
                "code": "table_heavy_blueprint",
                "message": "蓝图 required 表格占比偏高，且练习/步骤/案例/排错块不足；请确认表格没有替代训练过程。",
            }
        )
    course_design_mode = _text(blueprint.get("course_design_mode"))
    if course_design_mode in {"language_training", "grammar_training"} and lesson_total:
        actions = int(blueprint_training_stats.get("lessons_with_primary_training_action") or 0)
        policies = int(blueprint_training_stats.get("lessons_with_training_policy") or 0)
        if actions < int(lesson_total * 0.8) or policies < int(lesson_total * 0.6):
            warnings.append(
                {
                    "code": "language_training_policy_missing",
                    "message": "语言/语法训练课缺少足够的 primary_training_action 或 training_policy；容易退化成语法知识参考书。",
                }
            )
        dominant_combo = blueprint_training_stats.get("dominant_training_policy_combo", {})
        dominant_ratio = float(dominant_combo.get("ratio") or 0) if isinstance(dominant_combo, dict) else 0
        dominant_slots = dominant_combo.get("slots") if isinstance(dominant_combo, dict) else []
        if lesson_total >= 6 and dominant_ratio >= 0.65 and len(dominant_slots or []) >= 3:
            warnings.append(
                {
                    "code": "training_policy_over_uniform",
                    "message": "多数语法/语言 lesson 使用同一套 required 训练槽位；建议按 identify/correct/transform/produce 等动作只保留 2-3 个核心槽位。",
                }
            )
        overloaded_lessons = int(blueprint_training_stats.get("overloaded_required_slot_lessons") or 0)
        if overloaded_lessons >= max(3, int(lesson_total * 0.35)):
            warnings.append(
                {
                    "code": "training_policy_overloaded",
                    "message": f"{overloaded_lessons} 节课 required 训练槽位超过 3 个；容易让 Codex 机械塞满结构而不是按本节任务设计训练。",
                }
            )
    package_lesson_total = int(package_training_stats.get("lesson_count") or 0)
    if package_lesson_total:
        table_ratio = package_training_stats.get("table_lesson_count", 0) / package_lesson_total
        training_ratio = package_training_stats.get("lessons_with_training_signal", 0) / package_lesson_total
        if table_ratio >= 0.65 and training_ratio < 0.75:
            warnings.append(
                {
                    "code": "table_heavy_low_training_density",
                    "message": "最终课包表格小节占比偏高，但例子/改错/迁移训练信号不足；可能更像参考资料而不是训练课程。",
                }
            )
        if course_design_mode in {"language_training", "grammar_training"}:
            example_ratio = package_training_stats.get("lessons_with_example_signal", 0) / package_lesson_total
            correction_ratio = package_training_stats.get("lessons_with_correction_signal", 0) / package_lesson_total
            if example_ratio < 0.8 or correction_ratio < 0.35:
                warnings.append(
                    {
                        "code": "grammar_course_low_example_or_correction_density",
                        "message": "语法/语言课例句或改错密度偏低；建议补正例、反例、近似误差和改错训练。",
                    }
                )

    return {
        "schema_version": "shijie.coverage-audit.v0.1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "material_dir": str(material_dir),
        "text_length": text_length,
        "raw_transcript_length": raw_length,
        "block_count": block_count,
        "source_genre": source_genre,
        "learning_intent": learning_intent,
        "blueprint_lesson_count": len(blueprint_lessons),
        "package_lesson_count": package_lesson_count,
        "effective_lesson_count": lesson_count,
        "topic_stats": topic_stats,
        "roadmap_stats": roadmap_stats,
        "roadmap_text_stats": roadmap_text_stats,
        "roadmap_duplication_stats": roadmap_duplication_stats,
        "visual_asset_issues": visual_asset_issues,
        "blueprint_training_stats": blueprint_training_stats,
        "package_training_stats": package_training_stats,
        "warnings": warnings,
        "infos": infos,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit 视界专注 material/course coverage risks.")
    parser.add_argument("material_dir", help="Path to *.course_material directory")
    parser.add_argument("--package", dest="package_path", help="Optional final.course-package.json path")
    parser.add_argument("--output", help="Optional report path; defaults to course_draft/coverage-audit.json")
    args = parser.parse_args()

    material_dir = Path(args.material_dir).resolve()
    package_path = Path(args.package_path).resolve() if args.package_path else None
    report = audit_material(material_dir, package_path=package_path)
    output_path = Path(args.output).resolve() if args.output else material_dir / "course_draft" / "coverage-audit.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(report, file, ensure_ascii=False, indent=2)
        file.write("\n")

    print(f"coverage audit: warnings={len(report['warnings'])}, infos={len(report['infos'])}")
    print(f"report: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

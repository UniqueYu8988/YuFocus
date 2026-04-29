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
    explicit = _clean_text(
        (raw.get("teacher_ready_content") or {}).get("lesson_profile")
        if isinstance(raw.get("teacher_ready_content"), dict)
        else raw.get("lesson_profile")
    ).lower()
    if explicit in LESSON_PROFILES:
        return explicit

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
    answer = _clean_text(teacher.get("standard_answer"))
    key_points = _as_list(teacher.get("key_points"), 10)
    mistakes = _as_list(teacher.get("common_mistakes"), 8)
    memory_hook = _clean_text(teacher.get("memory_hook"))
    lesson_profile = _infer_lesson_profile(raw, title, teaching)
    display_hints = _as_list(teacher.get("display_hints") or raw.get("display_hints"), 6)

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
        chapters.append(
            {
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
                "children": sorted(chapter_lessons, key=lambda item: int(item.get("order") or 0)),
                "assets": _empty_assets(),
                "gaps": _empty_gaps(),
            }
        )

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

    return {
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
        "chapters": _build_chapters(outline, normalized_lessons, raw_lessons),
        "dependency_graph": [],
        "assets": [],
        "gaps": [],
    }


def _audit_or_raise(package: dict[str, Any], strict: bool) -> dict[str, Any]:
    report = audit_course_package(package)
    errors = int((report.get("severity_counts") or {}).get("error") or 0)
    if strict and errors:
        raise PackageError(f"课程包质量审计发现 {errors} 个 error，请先修正 course_draft 后再打包。")
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Assemble Codex lesson drafts into a Course Package JSON.")
    parser.add_argument("material_dir", help="Path to course_material directory containing manifest.json and course_draft/.")
    parser.add_argument("--output", help="Output .course-package.json path. Defaults to course_draft/final.course-package.json.")
    parser.add_argument("--report", help="Optional quality audit report path.")
    parser.add_argument("--strict", action="store_true", help="Fail when course quality audit reports student-facing errors.")
    parser.add_argument("--no-publish", action="store_true", help="Only write course_draft/final.course-package.json; do not copy into output/courses.")
    args = parser.parse_args(argv)

    material_dir = Path(args.material_dir).resolve()
    output_path = Path(args.output).resolve() if args.output else material_dir / "course_draft" / "final.course-package.json"
    report_path = Path(args.report).resolve() if args.report else output_path.with_suffix(".quality-report.json")

    try:
        package = assemble_course_package(material_dir)
        report = _audit_or_raise(package, args.strict)
        _save_json(output_path, package)
        _save_json(report_path, report)
        publish_result = (
            {}
            if args.no_publish
            else publish_course_package(material_dir, output_path, report_path, package)
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
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

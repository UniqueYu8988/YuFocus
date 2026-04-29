# -*- coding: utf-8 -*-
"""Build a dense teaching-first oral practice course from subtitle material.

This is the MVP bridge between local material preparation and the future Codex
course-design layer. It deliberately uses a curriculum blueprint, not the
number of video pages, to decide course density.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import re
from typing import Any

import config
from course_package_upgrade import upgrade_course_package_payload
import distiller


BLUEPRINT: list[tuple[str, list[str]]] = [
    ("诊疗规范与基本操作", ["洗手", "戴手套", "考试框架", "分值分布", "考试地点差异", "备考建议"]),
    (
        "第一站：口腔检查（37分）",
        [
            "器材准备",
            "人文关怀（8分）",
            "探诊",
            "扪诊",
            "叩诊",
            "松动度检查",
            "牙髓活力测试",
            "牙周探诊",
            "咬合关系检查",
            "颞下颌关节检查",
            "下颌下腺检查",
            "改良社区牙周指数（改良CPI）检查",
            "口腔检查表填写",
        ],
    ),
    (
        "第二站：口腔操作（43分）",
        [
            "牙体牙髓操作",
            "橡皮障隔离术",
            "窝沟封闭术",
            "磨牙𬌗面洞预备",
            "龈上洁治术",
            "牙拔除术",
            "口内缝合术",
            "牙槽脓肿切开引流术",
            "口腔局部麻醉术",
            "绷带包扎技术",
            "嵌体牙体预备",
        ],
    ),
    (
        "第三站：临床思辨能力（40分）",
        [
            "病例分析总框架",
            "考试形式",
            "病史采集",
            "病史采集七要素",
            "病史采集评分标准",
            "常见疾病线索",
            "病例分析四问结构",
            "吸氧术",
            "心肺复苏",
            "血压测量",
        ],
    ),
    ("牙体牙髓与牙周联合思路", ["开髓操作练习要点", "逆行性牙髓炎", "逆行性牙周炎", "牙髓牙周联合病变"]),
    ("复发性口腔溃疡", ["轻型溃疡", "病因", "典型表现", "疱疹样溃疡", "重型溃疡"]),
    ("口腔黏膜病鉴别", ["白塞病鉴别", "口腔念珠菌病", "口腔白色病损", "白斑鉴别诊断", "白斑治疗原则", "白斑恶变风险"]),
    ("口腔扁平苔藓", ["病因病理", "临床分型", "全身表现", "鉴别诊断", "治疗原则"]),
    ("牙外伤", ["牙脱位分类", "嵌入性脱位治疗原则", "部分脱位治疗", "软组织伤鉴别"]),
    ("诊疗规范与基本操作进阶", ["口腔黏膜消毒", "改良Bass刷牙法", "牙线使用方法", "刷牙宣教", "牙线宣教"]),
    ("牙拔除术", ["模型与可拔牙位", "拔牙器械", "麻醉方法口述", "拔牙标准程序"]),
    ("口内缝合术", ["缝合模型与工具", "体位与操作", "缝合三针分布", "剪线规范", "评判要点"]),
    ("无菌操作专项", ["椅位灯光调整", "七步洗手法", "戴手套与铺巾", "粘膜消毒"]),
    ("牙髓活力测试-温度测试", ["物品准备", "操作流程", "结果判读"]),
    (
        "口腔颌面部囊性病变",
        ["粘液腺囊肿", "舌下腺囊肿", "皮样囊肿鉴别", "皮脂腺囊肿", "表皮样囊肿", "甲状舌管囊肿", "腮裂囊肿", "血管瘤与脉管畸形"],
    ),
    ("颌骨囊肿", ["根尖囊肿", "含牙囊肿", "角化囊肿", "造釉细胞瘤", "鉴别要点"]),
    ("口腔癌", ["好发人群与部位", "临床表现", "确诊与鉴别"]),
    ("三叉神经痛", ["临床表现", "鉴别要点", "治疗原则"]),
    ("修复体并发症", ["牙体缺损修复后问题", "食物嵌塞", "牙龈炎", "牙列缺损修复问题", "全口义齿问题", "咀嚼无力病例分析"]),
]


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _slug(value: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9._-]+", "_", value.lower()).strip("._-")
    if not slug or not re.match(r"^[a-z0-9]", slug):
        slug = fallback
    return slug[:64]


def _bundle_segments(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for subtitle in bundle.get("subtitles") or []:
        for segment in subtitle.get("page_segments") or []:
            entries = [entry for entry in segment.get("entries") or [] if _clean(entry.get("content"))]
            if entries:
                text = "\n".join(_clean(entry.get("content")) for entry in entries)
                segments.append({"label": _clean(segment.get("label")), "text": text})
    return segments


def _coverage_for(title: str, segments: list[dict[str, Any]]) -> tuple[str, list[str]]:
    title_key = re.sub(r"[（）()0-9.、：:·\s]", "", title)
    matched = []
    for segment in segments:
        label = _clean(segment.get("label"))
        text = _clean(segment.get("text"))
        haystack = re.sub(r"[（）()0-9.、：:·\s]", "", f"{label} {text[:1200]}")
        if title_key and (title_key in haystack or haystack in title_key):
            matched.append(label)
            continue
        if any(keyword in haystack for keyword in re.split(r"[与和、/（）()]", title_key) if len(keyword) >= 2):
            matched.append(label)
    if matched:
        return "covered", matched[:3]
    return "inferred", []


def _node(node_id: str, node_type: str, title: str, order: int, children: list[dict[str, Any]], coverage: str, labels: list[str]) -> dict[str, Any]:
    scope = f"材料覆盖：{'、'.join(labels)}" if labels else "材料未直接覆盖：按实践技能考试课程蓝图补足。"
    return {
        "id": node_id,
        "node_type": node_type,
        "title": title,
        "summary": f"围绕{title}建立考试可用的学习单元，重点掌握目的、流程、判断标准和易错点。",
        "order": order,
        "learning_objectives": [f"理解{title}的目的", f"掌握{title}的考试表达", f"识别{title}的常见失分点"],
        "dependencies": [],
        "knowledge": {
            "concepts": [{"id": f"concept_{node_id}_01", "name": title, "explanation": f"{title} 是本课程蓝图中的关键学习点。", "evidence": []}],
            "examples": [],
            "checkpoints": [f"能用自己的话说出{title}的目的、步骤和易错点。"],
            "common_mistakes": [f"只背{title}名称，不会转成考试作答。"],
            "source_scope": [scope, f"coverage:{coverage}"],
            "teaching_expansion": [],
            "practical_steps": [],
            "practice_tasks": [f"用 60 秒口述{title}。"],
            "transfer_prompts": [f"如果题目换一种问法，如何判断它仍然在考{title}？"],
            "enrichment_notes": [],
        },
        "children": children,
        "assets": [],
        "gaps": [],
    }


def _base_package(bundle: dict[str, Any], *, source_id: str, source_title: str, material_path: str) -> tuple[dict[str, Any], dict[str, Any]]:
    segments = _bundle_segments(bundle)
    chapters = []
    leaf_count = 0
    coverage_items: list[dict[str, Any]] = []
    for chapter_index, (chapter_title, lesson_titles) in enumerate(BLUEPRINT, start=1):
        children = []
        previous_id = ""
        for lesson_index, lesson_title in enumerate(lesson_titles, start=1):
            leaf_count += 1
            coverage, labels = _coverage_for(lesson_title, segments)
            lesson_id = f"lesson_{leaf_count:04d}"
            coverage_items.append({"node_id": lesson_id, "title": lesson_title, "chapter": chapter_title, "coverage": coverage, "matched_segments": labels})
            lesson = _node(lesson_id, "lesson", lesson_title, lesson_index, [], coverage, labels)
            if previous_id:
                lesson["dependencies"] = [previous_id]
            children.append(lesson)
            previous_id = lesson_id
        chapter_id = f"chapter_{chapter_index:04d}"
        chapter_coverage = "covered" if any("coverage:covered" in item for child in children for item in child["knowledge"]["source_scope"]) else "inferred"
        chapter = _node(chapter_id, "chapter", chapter_title, chapter_index, children, chapter_coverage, [])
        chapters.append(chapter)

    text_length = sum(len(entry.get("content") or "") for subtitle in bundle.get("subtitles") or [] for entry in subtitle.get("entries") or [])
    package = {
        "schema_version": "onboard.course-package.v0.1",
        "package_id": _slug(f"{source_id.lower()}_blueprint", "oral_practice_blueprint"),
        "source": {
            "source_type": "bilibili_subtitle",
            "source_id": source_id,
            "title": source_title,
            "creator": "",
            "url": "",
            "language": "zh-CN",
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            "text_length": text_length,
            "notes": f"由字幕原材料和口腔实践技能课程蓝图生成；Codex 原材料包：{material_path}",
        },
        "course": {
            "title": "口腔实践技能操作与病例分析教学课程",
            "subtitle": "蓝图驱动教学优先版",
            "overall_goal": "把口腔实践技能视频材料升级为可直接学习、主动回忆、对照标准答案推进的考试课程。",
            "target_audience": "准备口腔执业医师或助理医师实践技能考试的学习者",
            "prerequisites": ["具备基础口腔医学名词和常见临床操作安全意识"],
            "learning_outcomes": ["建立三站考试框架", "掌握高频操作流程", "形成病例分析作答结构", "能识别常见扣分点"],
            "completion_definition": "完成全部关卡，并能口述每个节点的目的、步骤、判断标准和易错点。",
            "estimated_total_minutes": max(240, leaf_count * 8),
        },
        "chapters": chapters,
        "dependency_graph": [],
        "assets": [],
        "gaps": [],
    }
    coverage_report = {
        "schema_version": "onboard.course-coverage.v0.1",
        "source_id": source_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "material_segment_count": len(segments),
        "blueprint_lesson_count": leaf_count,
        "covered_count": sum(1 for item in coverage_items if item["coverage"] == "covered"),
        "inferred_count": sum(1 for item in coverage_items if item["coverage"] == "inferred"),
        "items": coverage_items,
    }
    return package, coverage_report


def build_blueprint_course_from_bundle(
    bundle: dict[str, Any],
    *,
    output_dir: str,
    source_id: str,
    source_title: str,
    material_path: str,
    output_path: str | None = None,
) -> dict[str, Any]:
    base_package, coverage_report = _base_package(bundle, source_id=source_id, source_title=source_title, material_path=material_path)
    package = upgrade_course_package_payload(base_package)
    output_path = output_path or os.path.join(output_dir, f"{package['package_id']}.course-package.json")
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(package, file, ensure_ascii=False, indent=2)
    coverage_path = os.path.join(output_dir, f"{package['package_id']}.coverage-report.json")
    with open(coverage_path, "w", encoding="utf-8") as file:
        json.dump(coverage_report, file, ensure_ascii=False, indent=2)
    return {
        "materialPath": material_path,
        "coursePath": output_path,
        "coveragePath": coverage_path,
        "packageId": package.get("package_id"),
        "chapterCount": len(package.get("chapters") or []),
        "nodeCount": sum(1 for _ in _walk(package.get("chapters") or [])),
        "textLength": package["source"]["text_length"],
        "coveredCount": coverage_report["covered_count"],
        "inferredCount": coverage_report["inferred_count"],
    }


def build_blueprint_course(input_path: str, output_dir: str) -> dict[str, Any]:
    with open(input_path, "r", encoding="utf-8") as file:
        bundle = json.load(file)
    source_id = os.path.basename(input_path).split(".")[0].upper()
    source_title = "口腔实践技能字幕材料"
    source = distiller.SourceDescriptor(
        source_type="bilibili_subtitle",
        source_id=source_id,
        title=source_title,
        language="zh-CN",
        notes=str(bundle.get("note") or ""),
    )
    package_id = _slug(f"{source_id.lower()}_blueprint", "oral_practice_blueprint")
    plan = distiller.prepare_chunk_plan(bundle.get("subtitles") or [], package_id=package_id, pipeline_config=distiller.PipelineConfig())
    material_path = distiller.save_codex_material_package(
        video_info={"bvid": source_id, "title": source_title},
        subtitles=bundle.get("subtitles") or [],
        plan=plan,
        source=source,
        output_dir=output_dir,
        text_source_type=str(bundle.get("source_type") or "bilibili_subtitle"),
        text_source_note=str(bundle.get("note") or ""),
        ingested_at=datetime.now(timezone.utc).isoformat(),
    )
    return build_blueprint_course_from_bundle(
        bundle,
        output_dir=output_dir,
        source_id=source_id,
        source_title=source_title,
        material_path=material_path,
    )


def _walk(nodes: list[dict[str, Any]]):
    for node in nodes:
        yield node
        yield from _walk(node.get("children") or [])


def main() -> int:
    parser = argparse.ArgumentParser(description="Build dense oral practice course from subtitle-bundle JSON.")
    parser.add_argument("input", help="Path to *.subtitle-bundle.json")
    parser.add_argument("--output-dir", default=config.ensure_output_dir(), help="Output directory")
    parser.add_argument("--result-json", action="store_true")
    args = parser.parse_args()
    result = build_blueprint_course(os.path.abspath(args.input), os.path.abspath(args.output_dir))
    if args.result_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result["coursePath"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

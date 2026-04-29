# -*- coding: utf-8 -*-
"""Audit generated course packages for student-facing teaching quality."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import difflib
import json
from pathlib import Path
import re
import sys
from typing import Any


BANNED_STUDENT_TERMS = [
    "视频给出的范围",
    "视频范围",
    "字幕证据",
    "字幕原文",
    "证据链",
    "素材证据",
    "原材料",
    "材料中",
    "材料覆盖",
    "核心材料提示",
    "字幕中的",
    "知识边界",
    "理由链",
    "coverage:",
    "source",
    "block",
    "debug",
    "我会把",
    "补成一节课",
    "这一关信息量偏高",
    "这关材料比较薄",
]

REQUIRED_HEADING_GROUPS = [
    ["## 这一关要学会什么"],
    ["## 标准操作步骤", "## 标准学习步骤", "## 操作或使用流程", "## 核心概念", "## 问题框架"],
    ["## 每一步为什么重要", "## 为什么这样学", "## 关键原理", "## 为什么重要", "## 关键关系"],
    ["## 考试/实操评分点", "## 考试要点", "## 检查清单", "## 怎么理解", "## 应用场景"],
    ["## 常见错误", "## 常见误区"],
    ["## 一句话记忆"],
]

LESSON_PROFILES = {"concept", "operation", "tool_config", "exam", "case_analysis", "strategy", "mixed"}

PROFILE_HEADING_GROUPS = {
    "operation": [
        ["## 这一关要学会什么"],
        ["## 标准操作步骤", "## 操作或使用流程", "## 标准学习步骤"],
        ["## 关键细节", "## 检查清单", "## 完成标准", "## 每一步为什么重要"],
        ["## 常见错误", "## 常见误区"],
        ["## 一句话记忆"],
    ],
    "tool_config": [
        ["## 这一关要学会什么"],
        ["## 前置条件", "## 环境准备", "## 准备工作"],
        ["## 配置步骤", "## 操作或使用流程", "## 标准学习步骤"],
        ["## 验证与排错", "## 检查清单", "## 完成标准"],
        ["## 常见错误", "## 常见误区"],
        ["## 一句话记忆"],
    ],
    "concept": [
        ["## 这一关要学会什么"],
        ["## 核心概念", "## 问题框架"],
        ["## 关键关系", "## 关键原理", "## 为什么重要"],
        ["## 应用场景", "## 怎么理解"],
        ["## 常见误区", "## 常见错误"],
        ["## 一句话记忆"],
    ],
    "exam": REQUIRED_HEADING_GROUPS,
    "case_analysis": [
        ["## 这一关要学会什么"],
        ["## 问题框架", "## 核心概念"],
        ["## 判断步骤", "## 标准学习步骤", "## 操作或使用流程"],
        ["## 关键关系", "## 怎么理解", "## 为什么重要"],
        ["## 常见误区", "## 常见错误"],
        ["## 一句话记忆"],
    ],
    "strategy": [
        ["## 这一关要学会什么"],
        ["## 问题框架", "## 核心概念"],
        ["## 标准学习步骤", "## 操作或使用流程"],
        ["## 检查清单", "## 应用场景", "## 怎么理解"],
        ["## 常见误区", "## 常见错误"],
        ["## 一句话记忆"],
    ],
    "mixed": REQUIRED_HEADING_GROUPS,
}

GENERIC_TEMPLATE_LINES = [
    "第一步决定你能不能先判断题目到底在考哪一类问题。",
    "第二步决定你能不能把答案写成有顺序、有依据的得分表达。",
    "第三步决定你能不能避开干扰项和临床操作中的低级失分。",
]

TEACHING_DENSITY_TARGET = 700
STANDARD_ANSWER_TARGET = 140
KEY_POINTS_TARGET = 4
COMMON_MISTAKES_TARGET = 3

EXAMPLE_TERMS = [
    "例如",
    "比如",
    "场景",
    "举例",
    "案例",
    "临床",
    "实际",
    "应用",
]

REASONING_TERMS = [
    "因为",
    "所以",
    "为了",
    "原因",
    "逻辑",
    "机制",
    "关键在于",
]

ACTION_TERMS = [
    "检查",
    "排错",
    "判断",
    "区分",
    "对比",
    "步骤",
    "流程",
    "操作",
]

STEP_DETAIL_TERMS = [
    "先",
    "再",
    "最后",
    "顺序",
    "覆盖",
    "部位",
    "点击",
    "输入",
    "选择",
    "执行",
    "保存",
]

VERIFY_TERMS = [
    "验证",
    "检查",
    "确认",
    "完成",
    "排错",
    "报错",
    "失败",
    "如果",
    "重新",
]

TOOL_TERMS = [
    "安装",
    "配置",
    "命令",
    "终端",
    "路径",
    "端口",
    "网络",
    "运行",
    "文件",
    "环境",
]

EXAM_TERMS = [
    "评分",
    "扣分",
    "得分",
    "标准",
    "考官",
    "答题",
    "考点",
]

PROFILE_KEYWORDS = {
    "tool_config": TOOL_TERMS + ["openclaw", "npm", "python", "api", "setup", "install"],
    "operation": ["操作", "步骤", "流程", "洗手", "消毒", "戴手套", "缝合", "拔除", "引流", "检查", "记录", "测量", "演示"],
    "exam": EXAM_TERMS + ["考试", "执业医师", "助理医师", "三站"],
    "case_analysis": ["病例", "诊断", "鉴别", "主诉", "病史", "临床思路", "治疗方案"],
    "strategy": ["复习", "规划", "方法", "策略", "记忆", "效率", "计划"],
    "concept": ["概念", "定义", "原理", "机制", "本质", "模型", "框架", "关系"],
}
TOOL_TECH_TERMS = ["openclaw", "openclash", "clash", "npm", "node", "python", "api", "git", "github", "端口", "网络", "代理", "命令", "终端", "路径", "环境变量"]
TOOL_SETUP_TERMS = ["安装", "配置", "环境", "初始化", "运行", "启动", "报错", "setup", "install", "run"]

MNEMONIC_EXPANSIONS = [
    {
        "name": "七步洗手法",
        "patterns": ["内外夹弓大立腕", "内、外、夹、弓、大、立、腕"],
        "required_terms": ["掌心", "手背", "指缝", "指背", "拇指", "指尖", "腕"],
    }
]

TITLE_STOPWORDS = {
    "医学",
    "口腔",
    "综合",
    "学",
    "考试",
    "高频",
    "考点",
    "原则",
    "基础",
    "管理",
    "常见",
    "训练",
}


@dataclass
class Issue:
    severity: str
    code: str
    node_id: str
    title: str
    message: str


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _node_children(node: dict[str, Any]) -> list[dict[str, Any]]:
    children = node.get("children")
    return children if isinstance(children, list) else []


def _walk_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    for node in nodes:
        flat.append(node)
        flat.extend(_walk_nodes(_node_children(node)))
    return flat


def _leaf_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [node for node in _walk_nodes(nodes) if not _node_children(node)]


def _teacher_text(node: dict[str, Any]) -> str:
    teacher = node.get("teacher_ready_content") or {}
    parts = [
        teacher.get("teaching_markdown") or "",
        teacher.get("quiz_question") or "",
        teacher.get("standard_answer") or "",
        teacher.get("memory_hook") or "",
        "\n".join(teacher.get("key_points") or []),
        "\n".join(teacher.get("common_mistakes") or []),
    ]
    return "\n".join(str(part) for part in parts if part)


def _contains_any(text: str, terms: list[str]) -> bool:
    return any(term in text for term in terms)


def _infer_lesson_profile(node: dict[str, Any], teacher: dict[str, Any], text: str) -> str:
    explicit = str(teacher.get("lesson_profile") or "").strip().lower()
    if explicit in LESSON_PROFILES:
        return explicit

    title = str(node.get("title") or "")
    haystack = f"{title} {node.get('summary') or ''} {text}".casefold()
    if (
        any(keyword.casefold() in haystack for keyword in TOOL_TECH_TERMS)
        and any(keyword.casefold() in haystack for keyword in TOOL_SETUP_TERMS)
    ):
        return "tool_config"
    for profile in ("operation", "exam", "case_analysis", "strategy", "concept"):
        if any(keyword.casefold() in haystack for keyword in PROFILE_KEYWORDS[profile]):
            return profile
    return "mixed"


def _heading_groups_for_profile(profile: str) -> list[list[str]]:
    return PROFILE_HEADING_GROUPS.get(profile, REQUIRED_HEADING_GROUPS)


def _check_profile_specific_quality(issues: list[Issue], node: dict[str, Any], profile: str, teaching: str) -> None:
    if profile in {"operation", "tool_config"}:
        if not _contains_any(teaching, ACTION_TERMS):
            _add_issue(issues, "info", "missing_action_check", node, "操作/工具课缺少可执行动作、步骤或流程。")
        if not _contains_any(teaching, STEP_DETAIL_TERMS):
            _add_issue(issues, "info", "missing_step_detail", node, "操作/工具课的步骤细节偏薄，建议补顺序、点击/输入/执行动作、覆盖部位或完成标准。")
        if not _contains_any(teaching, VERIFY_TERMS):
            _add_issue(issues, "info", "missing_verification_or_troubleshooting", node, "操作/工具课缺少验证、检查或排错提示。")
        if profile == "tool_config" and not _contains_any(teaching, TOOL_TERMS):
            _add_issue(issues, "info", "missing_tool_configuration_detail", node, "工具配置课缺少环境、路径、命令、端口、文件或运行验证等具体信息。")
        return

    if profile == "exam" and not _contains_any(teaching, EXAM_TERMS):
        _add_issue(issues, "info", "missing_exam_scoring", node, "考试课缺少评分、扣分、答题标准或考官视角。")
    if profile in {"concept", "exam", "case_analysis", "strategy", "mixed"} and not _contains_any(teaching, REASONING_TERMS):
        _add_issue(issues, "info", "missing_reasoning_chain", node, "教学正文缺少明确的因果、机制或理由链。")
    if profile in {"concept", "case_analysis", "strategy", "mixed"} and not _contains_any(teaching, EXAMPLE_TERMS):
        _add_issue(issues, "info", "missing_example_or_application", node, "教学正文缺少例子、场景、应用说明或反例。")
    if profile == "case_analysis" and not _contains_any(teaching, ["病例", "诊断", "鉴别", "判断", "线索", "处理"]):
        _add_issue(issues, "info", "missing_case_reasoning", node, "病例分析课缺少线索判断、诊断鉴别或处理路径。")


def _check_mnemonic_expansion(issues: list[Issue], node: dict[str, Any], teaching: str) -> None:
    normalized = re.sub(r"\s+", "", teaching)
    for mnemonic in MNEMONIC_EXPANSIONS:
        if not any(pattern in normalized for pattern in mnemonic["patterns"]):
            continue
        missing_terms = [term for term in mnemonic["required_terms"] if term not in teaching]
        if missing_terms:
            _add_issue(
                issues,
                "info",
                "mnemonic_not_expanded",
                node,
                f"{mnemonic['name']}口诀出现但未逐项展开：缺少 {'、'.join(missing_terms)}。",
            )


def _topic_terms(title: str) -> list[str]:
    topic = re.split(r"[：:]", title, maxsplit=1)[-1]
    raw_terms = re.split(r"[、，,；;和与/（）()：:\s]+", topic)
    terms: list[str] = []
    for term in raw_terms:
        term = re.sub(r"(病学|科学|学|法|原则|管理|诊断|治疗|机制)$", "", term.strip())
        if len(term) >= 2 and term not in TITLE_STOPWORDS:
            terms.append(term)
    return list(dict.fromkeys(terms))


def _without_title(text: str, title: str) -> str:
    return text.replace(title, "", 1)


def _node_fingerprint(node: dict[str, Any]) -> str:
    text = _without_title(_teacher_text(node), str(node.get("title") or ""))
    text = re.sub(r"[*#\-\d.、：:，,；;\s]+", "", text)
    return text[:1800]


def _add_issue(issues: list[Issue], severity: str, code: str, node: dict[str, Any], message: str) -> None:
    issues.append(
        Issue(
            severity=severity,
            code=code,
            node_id=str(node.get("id") or ""),
            title=str(node.get("title") or ""),
            message=message,
        )
    )


def audit_course_package(package: dict[str, Any]) -> dict[str, Any]:
    nodes = _walk_nodes(package.get("chapters") or [])
    leaves = _leaf_nodes(package.get("chapters") or [])
    issues: list[Issue] = []
    heading_counter: Counter[str] = Counter()
    line_counter: Counter[str] = Counter()

    for node in nodes:
        title = str(node.get("title") or "")
        node_type = str(node.get("node_type") or "")
        teacher = node.get("teacher_ready_content")
        if not isinstance(teacher, dict):
            _add_issue(issues, "error", "missing_teacher_ready_content", node, "缺少 teacher_ready_content，学生端会回退到旧字段。")
            continue

        teaching = str(teacher.get("teaching_markdown") or "")
        text = _teacher_text(node)
        if not text.strip():
            _add_issue(issues, "error", "empty_teacher_ready_content", node, "teacher_ready_content 为空。")
            continue

        for term in BANNED_STUDENT_TERMS:
            if term.lower() in text.lower():
                _add_issue(issues, "error", "student_meta_leak", node, f"学生端内容含有过程/证据字段：{term}")

        if node_type != "chapter":
            lesson_profile = _infer_lesson_profile(node, teacher, text)
            for heading_group in _heading_groups_for_profile(lesson_profile):
                matched_heading = next((heading for heading in heading_group if heading in teaching), "")
                if not matched_heading:
                    _add_issue(issues, "error", "missing_required_heading", node, f"缺少教学段落之一：{' / '.join(heading_group)}")
                else:
                    heading_counter[matched_heading] += 1

            if len(teaching) < 260:
                _add_issue(issues, "warning", "teaching_too_short", node, "教学正文过短，可能只是摘要而不是课程。")
            elif len(teaching) < TEACHING_DENSITY_TARGET:
                _add_issue(
                    issues,
                    "info",
                    "teaching_below_density_target",
                    node,
                    f"教学正文 {len(teaching)} 字，低于精品课建议 {TEACHING_DENSITY_TARGET} 字；可补例子、对比、排错和迁移练习。",
                )
            if len(str(teacher.get("standard_answer") or "")) < 80:
                _add_issue(issues, "warning", "answer_too_short", node, "标准答案过短，主动回忆后对照价值不足。")
            elif len(str(teacher.get("standard_answer") or "")) < STANDARD_ANSWER_TARGET:
                _add_issue(
                    issues,
                    "info",
                    "answer_below_density_target",
                    node,
                    f"标准答案低于 {STANDARD_ANSWER_TARGET} 字，建议写成可对照的完整答案，而不是一句结论。",
                )
            if len(teacher.get("key_points") or []) < KEY_POINTS_TARGET:
                _add_issue(
                    issues,
                    "info",
                    "key_points_below_target",
                    node,
                    f"关键点少于 {KEY_POINTS_TARGET} 条，学生对照时可能不够清晰。",
                )
            if len(teacher.get("common_mistakes") or []) < COMMON_MISTAKES_TARGET:
                _add_issue(
                    issues,
                    "info",
                    "common_mistakes_below_target",
                    node,
                    f"常见误区少于 {COMMON_MISTAKES_TARGET} 条，建议补具体丢分点、误解点或操作失误。",
                )
            if not str(teacher.get("quiz_question") or "").strip():
                _add_issue(issues, "error", "missing_recall_question", node, "缺少主动回忆问题。")
            _check_profile_specific_quality(issues, node, lesson_profile, teaching)
            _check_mnemonic_expansion(issues, node, teaching)

            relevance_text = _without_title(text, title)
            terms = _topic_terms(title)
            if terms:
                matched_terms = [term for term in terms if term in relevance_text]
                required = max(1, min(len(terms), (len(terms) + 1) // 2))
                if len(matched_terms) < required:
                    _add_issue(
                        issues,
                        "warning",
                        "weak_title_relevance",
                        node,
                        f"正文对标题关键词覆盖偏弱，命中 {matched_terms or '无'}，期望覆盖 {terms}。",
                    )

        for raw_line in text.splitlines():
            line = _clean(raw_line).strip("-0123456789.、 ")
            if len(line) >= 14:
                line_counter[line] += 1

    fingerprints = [(node, _node_fingerprint(node)) for node in leaves]
    for index, (left_node, left_text) in enumerate(fingerprints):
        if len(left_text) < 180:
            continue
        for right_node, right_text in fingerprints[index + 1 :]:
            if left_node.get("title") == right_node.get("title") or len(right_text) < 180:
                continue
            ratio = difflib.SequenceMatcher(None, left_text, right_text).ratio()
            if ratio >= 0.9:
                _add_issue(
                    issues,
                    "warning",
                    "near_duplicate_lesson",
                    left_node,
                    f"与「{right_node.get('title')}」学生正文相似度 {ratio:.2f}，可能是同一模板重复套用。",
                )
                break

    for line, count in line_counter.items():
        if count >= max(8, len(leaves) // 4) and (line in GENERIC_TEMPLATE_LINES or "决定你能不能" in line):
            issues.append(
                Issue(
                    severity="info",
                    code="template_line_overused",
                    node_id="",
                    title="",
                    message=f"模板句重复 {count} 次：{line}",
                )
            )

    severity_counts = Counter(issue.severity for issue in issues)
    score = 100
    score -= severity_counts["error"] * 8
    score -= severity_counts["warning"] * 3
    score = max(0, score)
    premium_score = max(0, score - severity_counts["info"] * 1)

    return {
        "audited_at": datetime.now(timezone.utc).isoformat(),
        "package_id": package.get("package_id"),
        "course_title": (package.get("course") or {}).get("title"),
        "node_count": len(nodes),
        "lesson_count": len(leaves),
        "quality_targets": {
            "teaching_density_target": TEACHING_DENSITY_TARGET,
            "standard_answer_target": STANDARD_ANSWER_TARGET,
            "key_points_target": KEY_POINTS_TARGET,
            "common_mistakes_target": COMMON_MISTAKES_TARGET,
        },
        "readiness": {
            "mvp_ready": severity_counts["error"] == 0,
            "premium_ready": severity_counts["error"] == 0 and severity_counts["warning"] == 0 and severity_counts["info"] == 0,
            "improvement_count": severity_counts["warning"] + severity_counts["info"],
        },
        "score": score,
        "premium_score": premium_score,
        "severity_counts": dict(severity_counts),
        "issues": [asdict(issue) for issue in issues],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit an Onboard course package for teaching quality.")
    parser.add_argument("package_path", help="Path to a .course-package.json file.")
    parser.add_argument("--report", help="Optional output path for the audit JSON report.")
    parser.add_argument("--json", action="store_true", help="Print full JSON report to stdout.")
    parser.add_argument("--fail-on", choices=["error", "warning", "none"], default="error")
    args = parser.parse_args(argv)

    package_path = Path(args.package_path)
    package = json.loads(package_path.read_text(encoding="utf-8"))
    report = audit_course_package(package)

    report_path = Path(args.report) if args.report else package_path.with_suffix(".quality-report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        counts = report["severity_counts"]
        print(
            f"Course quality audit: score={report['score']} "
            f"premium_score={report['premium_score']} "
            f"errors={counts.get('error', 0)} warnings={counts.get('warning', 0)} infos={counts.get('info', 0)}"
        )
        print(f"Report: {report_path}")
        for issue in report["issues"][:20]:
            location = f"{issue['node_id']} {issue['title']}".strip() or "global"
            print(f"[{issue['severity']}] {issue['code']} {location}: {issue['message']}")
        if len(report["issues"]) > 20:
            print(f"... {len(report['issues']) - 20} more issues")

    counts = report["severity_counts"]
    if args.fail_on == "error" and counts.get("error", 0) > 0:
        return 1
    if args.fail_on == "warning" and (counts.get("error", 0) > 0 or counts.get("warning", 0) > 0):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

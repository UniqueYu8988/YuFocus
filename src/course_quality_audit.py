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

LESSON_PROFILES = {"concept", "operation", "tool_config", "exam", "case_analysis", "strategy", "mixed"}

GENERIC_TEMPLATE_LINES = [
    "第一步决定你能不能先判断题目到底在考哪一类问题。",
    "第二步决定你能不能把答案写成有顺序、有依据的得分表达。",
    "第三步决定你能不能避开干扰项和临床操作中的低级失分。",
]

GENERIC_BLUEPRINT_EXECUTOR_PHRASES = [
    "每完成一步，都要问自己三个问题",
    "这门课不是训练你记按钮",
    "先定边界、再给任务、过程可引导、结果要验收",
    "宠物洗护网页",
    "项目文件夹给它工作边界",
    "对话和计划给它任务方向",
    "权限和工具决定它能不能真的执行",
]

KEY_POINTS_TARGET = 4
COMMON_MISTAKES_TARGET = 3

PROFILE_DENSITY_POLICY = {
    "concept": {"min": 650, "ideal_low": 750, "ideal_high": 1300},
    "operation": {"min": 900, "ideal_low": 1100, "ideal_high": 1900},
    "tool_config": {"min": 900, "ideal_low": 1100, "ideal_high": 1900},
    "exam": {"min": 750, "ideal_low": 900, "ideal_high": 1700},
    "case_analysis": {"min": 900, "ideal_low": 1100, "ideal_high": 2100},
    "strategy": {"min": 650, "ideal_low": 800, "ideal_high": 1600},
    "mixed": {"min": 750, "ideal_low": 900, "ideal_high": 1700},
}

SHORT_LESSON_TERMS = [
    "全局",
    "总论",
    "入口",
    "边界",
    "定义",
    "概念",
    "分类",
    "地图",
    "导览",
]

HIGH_DENSITY_HINTS = {
    "operation_script_table",
    "troubleshooting",
    "case_answer_template",
    "spatial_schematic",
    "mermaid_diagram",
}

MECHANICAL_ANSWER_PHRASES = [
    "得分时还要写明",
    "并主动排除",
    "这类误区",
    "标准回答应包括",
]

GENERIC_RECALL_PATTERNS = [
    re.compile(r"请围绕[“\"].{0,90}[”\"].{0,12}写出本节的(?:判断步骤|核心判断链|判断步骤、依据和常见误区)"),
    re.compile(r"写出本节的(?:判断步骤|核心判断链|判断步骤、依据和常见误区)"),
]

GENERIC_ANSWER_FRAME_PHRASES = [
    "先写题干或操作中的关键线索",
    "再按本节流程或分类标准进行判断",
    "然后说明为什么选择该处理或答案",
    "接着写出至少一个排除项",
    "最后补充完成检查点或病例处理原则",
]

FILLER_SECTION_TITLES = [
    "## 复盘加固",
    "## 答题自检",
    "## 临床/考题小场景",
]

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


def _display_hints(teacher: dict[str, Any]) -> list[str]:
    return [str(hint) for hint in teacher.get("display_hints") or []]


def _density_policy_for_lesson(node: dict[str, Any], profile: str, teacher: dict[str, Any]) -> dict[str, int]:
    policy = dict(PROFILE_DENSITY_POLICY.get(profile, PROFILE_DENSITY_POLICY["mixed"]))
    title = str(node.get("title") or "")
    hints = set(_display_hints(teacher))
    if any(term in title for term in SHORT_LESSON_TERMS) and not (hints & HIGH_DENSITY_HINTS):
        policy["min"] = min(policy["min"], 500)
        policy["ideal_low"] = min(policy["ideal_low"], 650)
        policy["ideal_high"] = min(policy["ideal_high"], 1100)
    if hints & HIGH_DENSITY_HINTS:
        policy["min"] = max(policy["min"], 850)
        policy["ideal_low"] = max(policy["ideal_low"], 1000)
    return policy


def _answer_minimum_for_profile(profile: str) -> int:
    if profile in {"operation", "tool_config", "case_analysis", "exam"}:
        return 100
    return 70


def _count_markdown_tables(teaching: str) -> int:
    return len(re.findall(r"(?m)^\s*\|[^\n]+\|\s*$", teaching))


def _looks_like_density_padding(teaching: str, profile: str) -> bool:
    filler_count = sum(1 for title in FILLER_SECTION_TITLES if title in teaching)
    if filler_count >= 2:
        return True
    if profile in {"concept", "strategy"} and filler_count >= 1 and len(teaching) >= 1050:
        return True
    return False


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


def _check_functional_slots(
    issues: list[Issue],
    node: dict[str, Any],
    profile: str,
    teaching: str,
    teacher: dict[str, Any],
) -> None:
    headings = re.findall(r"(?m)^#{2,4}\s+(.+?)\s*$", teaching)
    heading_text = " ".join(headings)
    key_points = teacher.get("key_points") if isinstance(teacher.get("key_points"), list) else []
    common_mistakes = teacher.get("common_mistakes") if isinstance(teacher.get("common_mistakes"), list) else []

    if len(headings) < 3:
        _add_issue(
            issues,
            "info",
            "few_functional_sections",
            node,
            "正文分块较少；如果内容已经自然完整可以保留，但请确认不是一整段讲解。",
        )

    if not re.search(r"(学会|目标|掌握|解决|这一关|本节|问题)", teaching[:360]):
        _add_issue(issues, "info", "missing_goal_slot", node, "开头缺少明确学习目标或本节要解决的问题。")

    if profile in {"operation", "tool_config"}:
        if not (re.search(r"(?m)^\s*\d+[.、]\s+\S+", teaching) or re.search(r"(步骤|流程|操作|配置)", heading_text)):
            _add_issue(issues, "warning", "missing_action_sequence_slot", node, "操作/配置课缺少可跟随的步骤或流程。")
        if not re.search(r"(验证|检查|完成标准|排错|失败|报错|确认)", teaching):
            _add_issue(issues, "warning", "missing_verification_slot", node, "操作/配置课缺少验证、完成标准或排错功能位。")
    elif profile == "case_analysis":
        if not re.search(r"(线索|依据|鉴别|判断|处理|结论)", teaching):
            _add_issue(issues, "warning", "missing_case_reasoning_slot", node, "病例/案例课缺少线索、依据、鉴别、处理或结论功能位。")
    elif profile == "exam":
        if not re.search(r"(评分|扣分|得分|标准|考点|答题)", teaching):
            _add_issue(issues, "warning", "missing_exam_scoring_slot", node, "考试课缺少评分、扣分、考点或标准表述功能位。")
    else:
        if not re.search(r"(因为|所以|关键|区别|边界|场景|例如|反例|应用)", teaching):
            _add_issue(issues, "info", "missing_concept_reasoning_slot", node, "概念/策略课缺少边界、因果、例子或应用功能位。")

    if len(common_mistakes) < 2 and not re.search(r"(常见误区|常见错误|容易错|不要|误以为)", teaching):
        _add_issue(issues, "info", "missing_mistake_slot", node, "缺少常见误区或错误表现，答后对照可能不够锋利。")
    if len(key_points) < 2 and not re.search(r"(关键点|检查清单|要点|记住)", teaching):
        _add_issue(issues, "info", "missing_keypoint_slot", node, "缺少关键点或检查清单，学生复盘抓手偏少。")


def _check_markdown_structure(issues: list[Issue], node: dict[str, Any], teaching: str, teacher: dict[str, Any]) -> None:
    for raw_line in teaching.splitlines():
        line = raw_line.strip()
        if re.match(r"^#{2,4}\s+\S.{0,28}\s+(本关|先|如果|把|用于|核心|学完|配置|操作|标准|可以)", line):
            _add_issue(
                issues,
                "warning",
                "compressed_heading_line",
                node,
                "Markdown 标题和正文挤在同一行，导入后会像大段说明而不是分块课程。",
            )
            break

    hints = [str(hint) for hint in teacher.get("display_hints") or []]
    if "comparison_table" in hints and not re.search(r"\n\|[^\n]+\|\n\|[\s:-]+\|", teaching):
        _add_issue(issues, "warning", "display_hint_not_realized", node, "蓝图要求 comparison_table，但正文里没有可渲染的 Markdown 表格。")
    if "mermaid_diagram" in hints and "```mermaid" not in teaching:
        _add_issue(issues, "warning", "display_hint_not_realized", node, "蓝图要求 mermaid_diagram，但正文里没有 Mermaid 图。")
    if any(hint in hints for hint in ("step_list", "flow_steps")) and not re.search(r"(?m)^\s*\d+[.、]\s+\S+", teaching):
        _add_issue(issues, "warning", "display_hint_not_realized", node, "蓝图要求 step_list/flow_steps，但正文里没有清晰编号步骤。")
    if "checklist" in hints and not re.search(r"(?m)^\s*[-*]\s+\S+", teaching):
        _add_issue(issues, "info", "display_hint_not_realized", node, "蓝图要求 checklist，但正文里缺少清单式核对项。")


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
    line_counter: Counter[str] = Counter()
    phrase_counter: Counter[str] = Counter()
    mermaid_counter: Counter[str] = Counter()
    answer_phrase_counter: Counter[str] = Counter()
    lesson_length_buckets: list[int] = []
    table_lesson_count = 0

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
            lesson_length_buckets.append(len(teaching))
            _check_functional_slots(issues, node, lesson_profile, teaching, teacher)

            density_policy = _density_policy_for_lesson(node, lesson_profile, teacher)
            if len(teaching) < 260:
                _add_issue(issues, "warning", "teaching_too_short", node, "教学正文过短，可能只是摘要而不是课程。")
            elif len(teaching) < density_policy["min"]:
                _add_issue(
                    issues,
                    "warning",
                    "teaching_below_profile_minimum",
                    node,
                    f"{lesson_profile} 课正文明显偏短；请只补足必要判断、步骤、例子或边界，不要为了过线凑字。",
                )
            elif len(teaching) < density_policy["ideal_low"]:
                _add_issue(
                    issues,
                    "info",
                    "teaching_below_profile_ideal",
                    node,
                    f"{lesson_profile} 课正文略低于建议完整度；如果已经短而准，可以保留，不要为了清除 info 扩写。",
                )
            if _looks_like_density_padding(teaching, lesson_profile):
                _add_issue(
                    issues,
                    "info",
                    "possible_density_padding",
                    node,
                    "正文含多个补强型小节，且篇幅接近旧密度线；请确认这些内容不是为了过字数而追加。",
                )

            answer = str(teacher.get("standard_answer") or "")
            answer_minimum = _answer_minimum_for_profile(lesson_profile)
            if len(answer) < answer_minimum:
                _add_issue(issues, "warning", "answer_too_short", node, "标准答案过短，主动回忆后对照价值不足。")
            elif len(answer) < answer_minimum + 35:
                _add_issue(
                    issues,
                    "info",
                    "answer_below_profile_ideal",
                    node,
                    f"标准答案低于本课型建议长度；若已做到分点、步骤或判断链，可以保留，不要为了凑字追加套话。",
                )
            node_answer_phrases: list[str] = []
            for phrase in MECHANICAL_ANSWER_PHRASES:
                if phrase in answer:
                    answer_phrase_counter[phrase] += 1
                    node_answer_phrases.append(phrase)
            if node_answer_phrases:
                _add_issue(
                    issues,
                    "info",
                    "mechanical_standard_answer_phrase",
                    node,
                    f"标准答案含机械补句：{'、'.join(node_answer_phrases)}。建议改成学生可背诵的分点答案。",
                )
            generic_answer_phrases = [phrase for phrase in GENERIC_ANSWER_FRAME_PHRASES if phrase in answer]
            if len(generic_answer_phrases) >= 2:
                _add_issue(
                    issues,
                    "warning",
                    "generic_standard_answer_template",
                    node,
                    "标准答案包含跨课程通用答题骨架，应改成直接回答本节主动回忆题的具体答案。",
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
            else:
                quiz_question = str(teacher.get("quiz_question") or "")
                if any(pattern.search(quiz_question) for pattern in GENERIC_RECALL_PATTERNS):
                    _add_issue(
                        issues,
                        "warning",
                        "generic_recall_question",
                        node,
                        "主动回忆题像通用占位题，应改成考察本节具体动作、判断、参数、病例线索或排错任务。",
                    )
            _check_markdown_structure(issues, node, teaching, teacher)
            _check_profile_specific_quality(issues, node, lesson_profile, teaching)
            _check_mnemonic_expansion(issues, node, teaching)
            table_count = _count_markdown_tables(teaching)
            if table_count > 0:
                table_lesson_count += 1
            hints = set(_display_hints(teacher))
            if table_count > 0 and "comparison_table" not in hints and lesson_profile in {"operation", "case_analysis", "strategy"}:
                _add_issue(
                    issues,
                    "info",
                    "possibly_unnecessary_table",
                    node,
                    "本节不是比较型展示，但正文包含表格；请确认是否应改成步骤、判断链或清单。",
                )
            for phrase in GENERIC_BLUEPRINT_EXECUTOR_PHRASES:
                if phrase in teaching:
                    phrase_counter[phrase] += 1
            for match in re.finditer(r"```mermaid\s*(.*?)```", teaching, flags=re.DOTALL | re.IGNORECASE):
                diagram = re.sub(r"\s+", " ", match.group(1)).strip()
                if diagram:
                    mermaid_counter[diagram] += 1

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

    for phrase, count in phrase_counter.items():
        if len(leaves) > 0 and count >= max(4, len(leaves) // 3):
            issues.append(
                Issue(
                    severity="warning",
                    code="blueprint_executor_template_overused",
                    node_id="",
                    title="",
                    message=f"疑似通用生成模板短语重复 {count} 次：{phrase}",
                )
            )

    for diagram, count in mermaid_counter.items():
        if len(leaves) > 0 and count >= max(3, len(leaves) // 4):
            issues.append(
                Issue(
                    severity="warning",
                    code="reused_generic_diagram",
                    node_id="",
                    title="",
                    message=f"同一 Mermaid 图重复 {count} 次，可能没有按每节课定制展示形式。",
                )
            )

    if leaves and lesson_length_buckets:
        near_legacy_density = sum(1 for length in lesson_length_buckets if 1050 <= length <= 1250)
        if near_legacy_density >= max(5, int(len(leaves) * 0.65)):
            issues.append(
                Issue(
                    severity="warning",
                    code="uniform_legacy_density_pattern",
                    node_id="",
                    title="",
                    message=f"{near_legacy_density}/{len(leaves)} 节课集中在 1050-1250 字，疑似被旧 1100 字线牵引；请改成按课型自然长短。",
                )
            )

        if table_lesson_count >= max(6, int(len(leaves) * 0.75)):
            issues.append(
                Issue(
                    severity="info",
                    code="table_overuse_pattern",
                    node_id="",
                    title="",
                    message=f"{table_lesson_count}/{len(leaves)} 节课含 Markdown 表格。医学、考试和工具选型课可以高频使用表格，但请抽查操作、病例、排错、配置和架构课是否用步骤、判断链、排错树或图示补足了表格之外的使用方法。",
                )
            )

    for phrase, count in answer_phrase_counter.items():
        if count >= max(4, len(leaves) // 4):
            issues.append(
                Issue(
                    severity="warning",
                    code="mechanical_answer_template_overused",
                    node_id="",
                    title="",
                    message=f"标准答案机械短语「{phrase}」重复 {count} 次，说明答案可能由统一补句生成。",
                )
            )

    severity_counts = Counter(issue.severity for issue in issues)
    score = 100
    score -= severity_counts["error"] * 8
    score -= severity_counts["warning"] * 3
    score = max(0, score)
    premium_score = score

    return {
        "audited_at": datetime.now(timezone.utc).isoformat(),
        "package_id": package.get("package_id"),
        "course_title": (package.get("course") or {}).get("title"),
        "node_count": len(nodes),
        "lesson_count": len(leaves),
        "quality_targets": {
            "density_note": "字数只用于发现明显过短或疑似灌水；真正标准是功能位完整、内容可学、格式适配。",
            "key_points_target": KEY_POINTS_TARGET,
            "common_mistakes_target": COMMON_MISTAKES_TARGET,
        },
        "readiness": {
            "mvp_ready": severity_counts["error"] == 0,
            "premium_ready": severity_counts["error"] == 0 and severity_counts["warning"] == 0,
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

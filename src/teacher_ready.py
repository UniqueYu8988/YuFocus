# -*- coding: utf-8 -*-
"""Build student-facing lesson content for different learning intents."""

from __future__ import annotations

import re
from typing import Any


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _take_unique(values: list[str], limit: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = _clean(value)
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
        if len(result) >= limit:
            break
    return result


def infer_learning_intent(title: str, summary: str = "", course_title: str = "") -> str:
    text = f"{course_title} {title} {summary}"
    if re.search(r"考试|考研|高考|公考|资格|执业|题干|刷题|备考|分值|评分|应试|真题|选择题", text):
        return "exam"
    if re.search(r"操作|实操|流程|步骤|安装|配置|使用|上手|部署|调试|剪辑|建模|绘制|摄影|拍摄|曝光|构图|修图|写作练习|练习方法", text):
        return "skill"
    if re.search(r"工具|软件|命令|界面|插件|工作流|自动化|代码|编程|Python|JavaScript|React|Obsidian", text, re.I):
        return "tool"
    if re.search(r"框架|方法论|策略|决策|分析|商业|运营|管理|产品|研究|写作|表达", text):
        return "framework"
    return "concept"


def _concept_names(node: dict[str, Any]) -> list[str]:
    knowledge = node.get("knowledge") if isinstance(node.get("knowledge"), dict) else {}
    concepts = knowledge.get("concepts") if isinstance(knowledge.get("concepts"), list) else []
    return _take_unique([_clean(item.get("name")) for item in concepts if isinstance(item, dict)], 5)


def _knowledge_list(node: dict[str, Any], key: str, limit: int) -> list[str]:
    knowledge = node.get("knowledge") if isinstance(node.get("knowledge"), dict) else {}
    values = knowledge.get(key) if isinstance(knowledge.get(key), list) else []
    return _take_unique([_clean(item) for item in values], limit)


def _title_terms(title: str) -> list[str]:
    topic = title.split("：", 1)[-1]
    return _take_unique(
        [
            re.sub(r"(理论|方法|原则|基础|入门|概述)$", "", item.strip())
            for item in re.split(r"[、，,；;和与/（）()：:\s]+", topic)
            if len(item.strip()) >= 2
        ],
        5,
    )


def _topic_label(title: str) -> str:
    value = _clean(title)
    if not value:
        return "这一关"
    for separator in ("：", ":", "-", "｜", "|"):
        if separator in value:
            parts = [_clean(part) for part in value.split(separator) if _clean(part)]
            if parts:
                value = parts[-1]
                break
    return value[:40]


def _default_mistakes(intent: str, title: str) -> list[str]:
    topic = _topic_label(title)
    if intent == "exam":
        return [f"只记住“{topic}”的结论，不会说明判断依据。", "把相邻概念混在一起，缺少排除理由。"]
    if intent in {"skill", "tool"}:
        return [f"只看懂“{topic}”，没有亲手复现流程。", "跳过前置条件和检查步骤，导致后面排错困难。"]
    if intent == "framework":
        return [f"把“{topic}”当成口号背诵，没有用它分析真实问题。", "只记框架名称，不会说明适用边界。"]
    return [f"只背“{topic}”的名词，不会解释它解决什么问题。", "只记零散细节，没有连成因果关系。"]


def _has_practical_steps(node: dict[str, Any]) -> bool:
    knowledge = node.get("knowledge") if isinstance(node.get("knowledge"), dict) else {}
    steps = knowledge.get("practical_steps")
    return isinstance(steps, list) and any(_clean(item) for item in steps)


def _operation_override(topic: str) -> dict[str, Any] | None:
    if topic == "洗手":
        key_points = [
            "洗手的目标是降低手部污染，给后续戴手套和口腔操作建立无菌前提。",
            "开始前取下戒指、手表等饰物，暴露到腕部，检查指甲和手部皮肤。",
            "七步洗手法必须覆盖掌心、手背、指缝、指背、拇指、指尖和腕部。",
            "洗完后手不能再碰污染物，否则前面的清洁步骤失效。",
            "考试表达要同时说出顺序、覆盖范围和无菌意识。",
        ]
        mistakes = ["漏洗拇指、指尖或腕部。", "洗完手后触碰衣物、台面、门把手等污染物。", "只背七步名称，不说明为什么要覆盖这些部位。"]
        return {
            "teaching_markdown": "\n".join(
                [
                    "## 洗手",
                    "",
                    "洗手这一关要掌握的是：进入无菌操作前，怎样把手部污染降下来，并且不把污染带进后面的戴手套和口腔操作。",
                    "",
                    "## 标准操作步骤",
                    "",
                    "1. 先取下戒指、手表等饰物，暴露手腕，检查指甲是否过长、手部皮肤是否有明显破损。",
                    "2. 按七步洗手法清洗：掌心、手背、指缝、指背、拇指、指尖，最后带到腕部。",
                    "3. 冲洗时让水流把泡沫和污染物带走，不要让手再接触水池边缘、衣物或其他污染物。",
                    "4. 洗完后保持手部清洁，直接进入后续无菌准备或戴手套流程。",
                    "",
                    "## 为什么这样做",
                    "",
                    "- 饰物和长指甲容易藏污纳垢，考试里不先处理，后面动作再规范也会被认为无菌意识不足。",
                    "- 拇指、指尖、指缝和腕部最容易漏洗，所以七步洗手法的重点不是背口诀，而是确保每个高污染区域都被覆盖。",
                    "- 洗完又碰污染物，相当于重新污染，后续戴手套就失去意义。",
                    "",
                    "## 考试/实操评分点",
                    "",
                    "- 有无先处理饰物、指甲和手部皮肤。",
                    "- 七步洗手覆盖是否完整，尤其是拇指、指尖、指缝和腕部。",
                    "- 洗完后是否保持手部清洁，没有重新接触污染物。",
                    "- 口述时能把洗手和后续无菌操作联系起来。",
                    "",
                    "## 常见错误",
                    "",
                    *[f"- {item}" for item in mistakes],
                    "",
                    "## 一句话记忆",
                    "",
                    "洗手不是背七步，是在戴手套前把污染挡在无菌操作外。",
                ]
            ),
            "quiz_question": "不用看资料，写出洗手前要先检查什么、七步洗手最容易漏哪几个部位、洗完后为什么不能再碰污染物。",
            "standard_answer": "标准回答应包括：先取下饰物并检查指甲、手部皮肤；按七步洗手法覆盖掌心、手背、指缝、指背、拇指、指尖和腕部；洗完后保持手部清洁，避免再次接触污染物，因为这会破坏后续戴手套和无菌操作的前提。",
            "key_points": key_points,
            "common_mistakes": mistakes,
            "memory_hook": "洗手不是背七步，是在戴手套前把污染挡在无菌操作外。",
        }

    if topic == "戴手套":
        key_points = [
            "戴手套的核心是保护手套外表面这个无菌接触面。",
            "第一只手套只能用裸手接触内面，不能碰外面。",
            "第二只手套要用已戴手套的手伸入反折边，只接触外面的无菌区域。",
            "戴好后双手保持在胸前或无菌区域内，不能触碰非无菌物品。",
        ]
        mistakes = ["裸手碰到手套外面。", "戴好手套后触碰衣服、台面或其他非无菌区域。", "只顾戴上手套，没有说明内面和外面的接触边界。"]
        return {
            "teaching_markdown": "\n".join(
                [
                    "## 戴手套",
                    "",
                    "戴无菌手套这一关的重点不是“把手套套上”，而是从头到尾保护手套外表面不被污染。考试看的是无菌观念：哪只手能碰哪里，哪一面不能碰。",
                    "",
                    "## 标准操作步骤",
                    "",
                    "1. 检查手套包装是否完整、型号是否合适，在无菌区域内打开包装。",
                    "2. 戴第一只手套时，裸手只接触手套内面，不能碰到手套外表面。",
                    "3. 戴第二只手套时，用已戴手套的手伸入另一只手套的反折边，只接触外面的无菌面。",
                    "4. 戴好后双手保持在胸前或无菌区域内，不触碰衣物、桌面、椅背等非无菌物品。",
                    "",
                    "## 为什么这样做",
                    "",
                    "- 手套外面之后会接触器械、模型或患者口腔，一旦被裸手碰到，就不再是无菌面。",
                    "- 第一只手套最容易错，因为裸手还没有无菌保护，所以只能碰内面。",
                    "- 第二只手套要靠反折边完成，是为了让已戴手套的手只碰外面的无菌区域。",
                    "",
                    "## 考试/实操评分点",
                    "",
                    "- 包装完整、打开方式和手套型号是否正确。",
                    "- 裸手是否碰到手套外表面。",
                    "- 已戴手套的手是否只接触无菌面。",
                    "- 戴好后双手是否保持在无菌区域，没有再次污染。",
                    "",
                    "## 常见错误",
                    "",
                    *[f"- {item}" for item in mistakes],
                    "",
                    "## 一句话记忆",
                    "",
                    "戴手套的本质是守住外表面：裸手碰内面，戴好后只碰无菌面。",
                ]
            ),
            "quiz_question": "不用看资料，写出戴第一只手套和第二只手套时分别能接触哪一面，以及戴好后最不能做什么。",
            "standard_answer": "标准回答应包括：戴第一只手套时裸手只能接触手套内面；戴第二只手套时，已戴手套的手伸入反折边，只接触外面的无菌面；戴好后双手应保持在胸前或无菌区域内，不能触碰衣物、台面等非无菌物品。",
            "key_points": key_points,
            "common_mistakes": mistakes,
            "memory_hook": "戴手套的本质是守住外表面：裸手碰内面，戴好后只碰无菌面。",
        }

    return None


def build_teacher_ready_content(
    node: dict[str, Any],
    *,
    course_title: str = "",
    intent: str | None = None,
) -> dict[str, Any]:
    title = _clean(node.get("title")) or "这一关"
    topic = _topic_label(title)
    summary = _clean(node.get("summary")) or f"围绕{title}建立可理解、可复述、可迁移的知识单元。"
    has_explicit_intent = intent is not None
    lesson_intent = intent or infer_learning_intent(title, summary, course_title)
    if not has_explicit_intent and lesson_intent == "concept" and _has_practical_steps(node):
        lesson_intent = "skill"
    override = _operation_override(topic)
    if override:
        return override
    concepts = _concept_names(node)
    terms = _title_terms(title) or concepts[:3] or [topic]
    term_text = "、".join(terms)
    objectives = _take_unique([_clean(item) for item in node.get("learning_objectives") or []], 4)
    checkpoints = _knowledge_list(node, "checkpoints", 4)
    practical_steps = _knowledge_list(node, "practical_steps", 4)
    expansions = _knowledge_list(node, "teaching_expansion", 3)
    mistakes = _knowledge_list(node, "common_mistakes", 4) or _default_mistakes(lesson_intent, title)

    if lesson_intent == "exam":
        headings = ("标准学习步骤", "为什么这样学", "考试要点")
        steps = practical_steps or [
            f"先说清{term_text}分别指向什么考点。",
            f"再把“{topic}”放回题目或场景，找出判断依据。",
            "最后补上易混点和常见错误。",
        ]
        key_points = _take_unique([*checkpoints, *objectives, *concepts], 6)
        middle_points = expansions[:3] or [
            "先把答案组织成可得分的顺序，而不是只背零散词。",
            "每个结论后面都要能补一句判断依据。",
            "最后用易错点检查自己是否真的掌握。",
        ]
        quiz = f"不用看资料，写出“{topic}”的核心判断、两个关键点和一个常见错误。"
        standard = f"“{topic}”的标准回答要能说明：{summary} 关键点包括：{'；'.join(key_points[:3])}。"
    elif lesson_intent in {"skill", "tool"}:
        exam_context = bool(re.search(r"考试|执业|助理|实践技能|评分|考官", f"{course_title} {summary} {title}"))
        headings = ("标准操作步骤", "为什么这样做", "考试/实操评分点" if exam_context else "检查清单")
        steps = practical_steps or [
            f"先确认“{topic}”要解决的任务和前置条件。",
            "再按输入、动作、输出的顺序复现一遍。",
            "最后检查结果是否符合预期，并记录容易出错的位置。",
        ]
        key_points = _take_unique([*steps, *checkpoints, *objectives], 6)
        middle_points = [
            "第一步先处理前置条件，避免后面的动作建立在错误状态上。",
            "中间步骤按固定顺序完成，是为了减少遗漏和污染、误判或返工。",
            "最后必须检查结果，因为真正得分的是“完成且有效”，不是机械做完动作。",
        ]
        quiz = f"不用看资料，写出“{topic}”的目标、关键步骤和最容易出错的位置。"
        standard = f"“{topic}”的标准回答要能说清目标、按顺序复述关键步骤，并指出最容易出错或需要检查的地方。"
    elif lesson_intent == "framework":
        headings = ("问题框架", "关键关系", "应用场景")
        steps = practical_steps or [
            f"先说清“{topic}”试图解决哪类问题。",
            "再拆出框架中的关键变量和它们之间的关系。",
            "最后用一个真实场景测试它是否能指导判断。",
        ]
        key_points = _take_unique([*expansions, *checkpoints, *objectives], 6)
        middle_points = expansions[:3] or key_points[:3]
        quiz = f"不用看资料，用“{topic}”分析一个你熟悉的真实场景。"
        standard = f"“{topic}”的标准回答要能说明：它适合解决什么问题、包含哪些关键关系、什么时候不适用。"
    else:
        headings = ("核心概念", "为什么重要", "怎么理解")
        steps = practical_steps or [
            f"先用自己的话解释{term_text}。",
            f"再说明“{topic}”为什么重要，它改变了你对什么问题的理解。",
            "最后举一个例子，把抽象概念落到具体场景里。",
        ]
        key_points = _take_unique([*concepts, *checkpoints, *objectives], 6)
        middle_points = expansions[:3] or key_points[:3]
        quiz = f"不用看资料，用自己的话解释“{topic}”，并举一个例子。"
        standard = f"“{topic}”的标准回答要能说明：{summary} 还要能给出例子，并说清它和相邻概念的区别。"

    key_points = key_points or [f"能说清“{topic}”的核心含义。", f"能把“{topic}”用于一个具体场景。"]
    if lesson_intent in {"skill", "tool"}:
        memory = f"{topic}：先做对顺序，再说清理由，最后检查易错点。"
    elif lesson_intent == "exam":
        memory = f"{topic}：先给结论，再补依据，最后防混淆。"
    elif lesson_intent == "framework":
        memory = f"{topic}：先定问题，再看变量，最后落到行动。"
    else:
        memory = f"{topic}：先说含义，再讲原因，最后举例。"

    teaching_markdown = "\n".join(
        [
            "## 这一关要学会什么",
            "",
            f"这一关学 **{topic}**。{summary}",
            "",
            f"## {headings[0]}",
            "",
            *[f"{index}. {step}" for index, step in enumerate(steps, start=1)],
            "",
            f"## {headings[1]}",
            "",
            *[f"- {item}" for item in middle_points],
            "",
            f"## {headings[2]}",
            "",
            *[f"- {item}" for item in key_points[:5]],
            "",
            "## 常见误区",
            "",
            *[f"- {item}" for item in mistakes[:4]],
            "",
            "## 一句话记忆",
            "",
            memory,
        ]
    )

    return {
        "teaching_markdown": teaching_markdown,
        "quiz_question": quiz,
        "standard_answer": standard,
        "key_points": key_points[:6],
        "common_mistakes": mistakes[:4],
        "memory_hook": memory,
    }

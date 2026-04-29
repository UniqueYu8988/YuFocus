# -*- coding: utf-8 -*-
"""Upgrade an existing Course Package into a teaching-first MVP package.

This script is intentionally local and deterministic. It does not claim to be
the final Codex course-design layer; it gives the desktop learning runtime a
dense, non-video-centric package to validate the MVP flow.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import re
from typing import Any

import distiller
from teacher_ready import build_teacher_ready_content, infer_learning_intent


DOMAIN_HINTS: list[tuple[str, dict[str, list[str]]]] = [
    (
        "考试框架|分值|考试地点|备考",
        {
            "concepts": ["三站考试", "分值结构", "抽题范围", "操作评分", "备考节奏"],
            "steps": ["先分清第一站、第二站、第三站分别考什么。", "再把每站分值和高频失分点对应起来。", "最后按抽题概率和操作难度安排练习顺序。"],
            "mistakes": ["只背单个项目，不知道它属于哪一站。", "忽略分值权重，把低频内容放在过高优先级。"],
        },
    ),
    (
        "器材|人文关怀",
        {
            "concepts": ["器械准备", "患者沟通", "核对身份", "告知操作", "保护隐私"],
            "steps": ["先核对题目和患者信息。", "再准备器械、调节体位并说明操作目的。", "操作结束后交代注意事项并整理器械。"],
            "mistakes": ["会做操作但漏掉问候、核对和告知。", "器械准备不完整导致流程中断。"],
        },
    ),
    (
        "探诊|扪诊|叩诊|松动度|咬合|颞下颌|下颌下腺",
        {
            "concepts": ["检查顺序", "检查手法", "阳性体征", "疼痛反应", "记录规范"],
            "steps": ["先说明检查目的并取得配合。", "再按指定牙位或区域完成检查。", "最后描述阳性/阴性发现并规范记录。"],
            "mistakes": ["检查顺序混乱。", "只做动作，不说检查目的和结果判断。"],
        },
    ),
    (
        "洗手",
        {
            "concepts": ["手卫生", "七步洗手法", "洗手时机", "无菌原则", "污染边界"],
            "steps": ["取下饰物并暴露腕部。", "按掌心、手背、指缝、指背、拇指、指尖、腕部顺序揉搓。", "冲洗后保持手部朝上，避免再次污染。"],
            "mistakes": ["只记口诀，不知道每一步覆盖的解剖位置。", "洗完手后接触非无菌物品，破坏后续戴手套的前提。"],
        },
    ),
    (
        "戴手套",
        {
            "concepts": ["外科手套", "无菌接触面", "手套内外面", "穿戴顺序", "污染风险"],
            "steps": ["先确认手套型号和包装完整。", "第一只手只接触手套内面。", "第二只手用已戴手套的手指伸入反折边，只接触外面。"],
            "mistakes": ["裸手碰到手套外面。", "戴好手套后又触碰非无菌区域。"],
        },
    ),
    (
        "牙髓活力",
        {
            "concepts": ["冷诊", "热诊", "电活力测试", "正常对照牙", "假阳性与假阴性"],
            "steps": ["先向患者解释刺激可能带来的感觉。", "选择正常对照牙，再测患牙。", "记录反应强弱、持续时间和是否迟缓。"],
            "mistakes": ["只看有没有反应，不比较对照牙。", "把金属修复体传导造成的反应直接当成牙髓活力。"],
        },
    ),
    (
        "改良CPI|社区牙周指数|牙周",
        {
            "concepts": ["CPI探针", "牙周袋", "探诊出血", "牙石", "指数牙"],
            "steps": ["按规定牙位和顺序探诊。", "轻柔贴合牙面进入龈沟，避免人为出血。", "按最重发现记录分值。"],
            "mistakes": ["探诊用力过大导致假性出血。", "记录时混淆牙石、出血和牙周袋深度。"],
        },
    ),
    (
        "窝沟封闭",
        {
            "concepts": ["适应证", "清洁牙面", "酸蚀", "隔湿", "封闭剂光固化"],
            "steps": ["评估适应证并清洁牙面。", "隔湿后酸蚀，冲洗并彻底干燥。", "涂布封闭剂、光固化，最后检查咬合和遗漏。"],
            "mistakes": ["隔湿失败导致封闭剂脱落。", "酸蚀后未保持干燥，影响粘接效果。"],
        },
    ),
    (
        "脓肿|切开引流",
        {
            "concepts": ["切开指征", "波动感", "脓腔最低位", "引流条", "术后换药"],
            "steps": ["判断是否形成脓肿并具备切开指征。", "选择有利于引流且避开重要结构的切口。", "切开、分离、冲洗、放置引流并交代复诊。"],
            "mistakes": ["未判断波动感就贸然切开。", "切口位置不利于引流或损伤重要结构。"],
        },
    ),
    (
        "血压",
        {
            "concepts": ["袖带位置", "肱动脉", "收缩压", "舒张压", "Korotkoff音"],
            "steps": ["让患者安静休息，暴露上臂并选择合适袖带。", "袖带下缘位于肘窝上方，听诊器置于肱动脉。", "缓慢放气，记录第一声和声音消失时读数。"],
            "mistakes": ["袖带过松、位置过低或放气过快。", "只报数值，不说明单位和左右臂/体位条件。"],
        },
    ),
    (
        "吸氧",
        {
            "concepts": ["缺氧纠正", "鼻导管", "氧流量", "湿化瓶", "用氧安全"],
            "steps": ["核对患者并评估鼻腔通畅。", "连接湿化装置并调节氧流量。", "固定鼻导管，观察呼吸、紫绀和舒适度。"],
            "mistakes": ["未先检查鼻腔和装置通畅。", "忽略用氧安全和流量记录。"],
        },
    ),
    (
        "病例|诊断|鉴别|主诉|现病史",
        {
            "concepts": ["主诉", "现病史", "诊断依据", "鉴别诊断", "治疗原则"],
            "steps": ["先抓主诉和时间线。", "把症状、体征、检查结果对应到诊断依据。", "列出最需要排除的相似疾病，再给出治疗原则。"],
            "mistakes": ["直接报诊断，不给依据。", "只背疾病名，不会解释为什么排除其他诊断。"],
        },
    ),
    (
        "橡皮障|隔离",
        {
            "concepts": ["隔湿", "夹持", "打孔", "橡皮障夹", "术野暴露"],
            "steps": ["先选择合适橡皮障夹和打孔位置。", "再固定橡皮障并确认术野暴露。", "最后检查边缘密合和患者舒适度。"],
            "mistakes": ["只追求装上橡皮障，忽略隔湿和术野暴露效果。", "夹持不稳导致操作中脱落。"],
        },
    ),
    (
        "开髓|牙体牙髓|洞预备|嵌体",
        {
            "concepts": ["入路设计", "髓腔形态", "去腐与保髓", "抗力形", "固位形"],
            "steps": ["先判断牙位、龋坏范围和操作目的。", "再确定入路或洞型设计。", "最后检查形态、深度、边缘和保护牙髓。"],
            "mistakes": ["只背洞型名称，不会解释为什么这样预备。", "忽略牙髓保护和剩余牙体组织强度。"],
        },
    ),
    (
        "洁治|刷牙|牙线|Bass|宣教",
        {
            "concepts": ["菌斑控制", "龈上洁治", "改良Bass", "邻面清洁", "健康宣教"],
            "steps": ["先说明清洁目标和适用人群。", "再演示器械/牙刷/牙线的位置和动作。", "最后让患者复述或回示关键动作。"],
            "mistakes": ["只讲动作，不检查患者是否能复现。", "忽略邻面和龈缘这些高风险区域。"],
        },
    ),
    (
        "拔牙|麻醉",
        {
            "concepts": ["适应证", "禁忌证", "挺松", "脱位", "拔牙创处理"],
            "steps": ["先评估适应证、禁忌证和影像信息。", "再完成麻醉、分离牙龈、挺松和拔除。", "最后检查牙根完整性、处理拔牙窝并交代术后注意事项。"],
            "mistakes": ["没有评估禁忌证就进入操作。", "拔除后不检查牙根和拔牙窝。"],
        },
    ),
    (
        "缝合|剪线",
        {
            "concepts": ["进针点", "出针点", "组织对位", "打结", "剪线长度"],
            "steps": ["先判断创缘和缝合目的。", "再按进针、出针、打结顺序完成缝合。", "最后检查组织对位和线结位置。"],
            "mistakes": ["针距边距不均。", "只完成打结，不检查创缘是否真正对合。"],
        },
    ),
    (
        "心肺复苏|CPR",
        {
            "concepts": ["意识判断", "呼救", "胸外按压", "开放气道", "人工呼吸"],
            "steps": ["先判断环境安全、意识和呼吸。", "立即呼救并启动急救流程。", "按规范频率和深度进行胸外按压，按流程配合通气。"],
            "mistakes": ["判断和呼救不清。", "按压位置、频率或深度不规范。"],
        },
    ),
    (
        "溃疡|白塞|念珠菌|白斑|扁平苔藓",
        {
            "concepts": ["病损形态", "复发特点", "疼痛程度", "癌变风险", "鉴别诊断"],
            "steps": ["先描述病损颜色、形态、部位和持续时间。", "再结合复发史、全身表现和诱因判断方向。", "最后给出鉴别诊断和处理原则。"],
            "mistakes": ["只根据颜色下诊断。", "忽略病程、复发和全身表现。"],
        },
    ),
    (
        "囊肿|造釉|口腔癌|三叉神经痛|修复体|义齿|食物嵌塞|咀嚼无力",
        {
            "concepts": ["临床表现", "影像/检查线索", "鉴别诊断", "处理原则", "复诊随访"],
            "steps": ["先抓主诉、部位和病程。", "再提取最能区分疾病的体征或检查线索。", "最后给出诊断倾向、鉴别对象和处理原则。"],
            "mistakes": ["把相似疾病混在一起。", "只报诊断，不说明支持和排除理由。"],
        },
    ),
]


def _clean(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


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


def _slug(value: str, fallback: str) -> str:
    raw = re.sub(r"[^a-z0-9._-]+", "_", value.lower()).strip("._-")
    if not raw or not re.match(r"^[a-z]", raw):
        raw = fallback
    return raw[:64]


def _node_id(kind: str, counter: int) -> str:
    return _slug(f"{kind}_{counter:04d}", f"{kind}_{counter:04d}")


def _hint_for(title: str, summary: str) -> dict[str, list[str]]:
    haystack = f"{title} {summary}"
    merged = {"concepts": [], "steps": [], "mistakes": []}
    for pattern, hints in DOMAIN_HINTS:
        if re.search(pattern, haystack, re.I):
            for key in merged:
                merged[key].extend(hints.get(key, []))
    return {key: _take_unique(values, 8) for key, values in merged.items()}


def _concept_items(node_id: str, title: str, existing: list[dict[str, Any]], hints: dict[str, list[str]]) -> list[dict[str, Any]]:
    names = [title]
    names.extend(hints.get("concepts") or [])
    names.extend(_clean(item.get("name")) for item in existing if isinstance(item, dict))
    items = []
    for index, name in enumerate(_take_unique(names, 6), start=1):
        items.append(
            {
                "id": f"concept_{node_id[:20]}_{index:02d}",
                "name": name[:64],
                "explanation": (
                    f"{title}的核心是把目的、结构和使用边界说清楚。"
                    if name == title
                    else f"{name} 是掌握“{title}”时必须会用的判断点：要知道它何时出现、解决什么问题、和其他概念有什么区别。"
                ),
                "evidence": [],
            }
        )
    return items


def _examples(node_id: str, title: str, existing: list[dict[str, Any]], intent: str) -> list[dict[str, str]]:
    if intent == "exam":
        scenario = f"复习时，你需要不看提示说出“{title}”的核心判断、关键依据和易混点。"
    elif intent in {"skill", "tool"}:
        scenario = f"实际使用时，你需要独立完成“{title}”，并能判断结果是否符合预期。"
    elif intent == "framework":
        scenario = f"遇到一个真实问题时，你尝试用“{title}”拆出关键变量、关系和下一步行动。"
    else:
        scenario = f"学习一个新领域时，你需要用自己的话解释“{title}”，并能举出一个真实例子。"
    return [
        {
            "id": f"example_{node_id[:24]}",
            "title": f"{title}应用场景",
            "scenario": scenario[:220],
            "takeaway": f"不要把“{title}”当成孤立名词，要能把它转成自己的解释和可迁移的用法。",
        }
    ]


def _upgrade_node(
    node: dict[str, Any],
    parent_titles: list[str],
    *,
    id_map: dict[str, str],
    counter: dict[str, int],
) -> dict[str, Any]:
    title = _clean(node.get("title")) or "未命名节点"
    old_id = _clean(node.get("id"))
    counter["value"] += 1
    node_id = _node_id("chapter" if parent_titles == [] else "lesson", counter["value"])
    if old_id:
        id_map[old_id] = node_id
    summary = _clean(node.get("summary"))
    hints = _hint_for(title, summary)
    knowledge = node.get("knowledge") if isinstance(node.get("knowledge"), dict) else {}
    existing_concepts = knowledge.get("concepts") if isinstance(knowledge.get("concepts"), list) else []
    existing_examples = knowledge.get("examples") if isinstance(knowledge.get("examples"), list) else []
    concepts = _concept_items(node_id, title, existing_concepts, hints)
    concept_names = [item["name"] for item in concepts]
    parent_context = " -> ".join(parent_titles[-2:])
    course_title = parent_titles[0] if parent_titles else _clean(title)
    intent = infer_learning_intent(title, summary, course_title)
    summary = summary if summary and summary != title else f"围绕{title}建立可理解、可复述、可迁移的学习框架。"
    objective_seed = {
        "exam": [f"理解{title}的考查重点和判断依据", f"区分{title}的常见易混点", f"能组织成清楚的答题表达"],
        "skill": [f"理解{title}的目标和适用场景", f"能按顺序完成{title}的关键流程", f"能检查结果并避开常见错误"],
        "tool": [f"理解{title}解决什么任务", f"能独立复现{title}的最小流程", f"能定位常见配置或使用问题"],
        "framework": [f"理解{title}适合分析哪类问题", f"能拆出{title}里的关键变量", f"能把{title}用于真实场景"],
        "concept": [f"理解{title}的核心含义", f"能解释{title}为什么重要", f"能举例说明{title}如何使用"],
    }.get(intent, [])
    checkpoints = _take_unique(
        [
            f"能用自己的话说明{title}解决什么问题。",
            f"能说出{title}的关键结构、流程或判断链。",
            f"能指出{title}最容易误解或用错的地方。",
            *(_clean(item) for item in knowledge.get("checkpoints", []) if isinstance(knowledge.get("checkpoints"), list)),
        ],
        5,
    )
    upgraded = {
        **node,
        "id": node_id,
        "title": title,
        "summary": summary[:240],
        "learning_objectives": _take_unique(objective_seed, 4),
        "knowledge": {
            "concepts": concepts,
            "examples": _examples(node_id, title, existing_examples, intent),
            "checkpoints": checkpoints,
            "common_mistakes": _take_unique(
                [
                    *(hints.get("mistakes") or []),
                    *(_clean(item) for item in knowledge.get("common_mistakes", []) if isinstance(knowledge.get("common_mistakes"), list)),
                    f"只背{title}这个词，不会说出它解决什么问题、如何使用以及边界在哪里。",
                ],
                5,
            ),
            "source_scope": _take_unique([f"知识边界：{parent_context} / {title}" if parent_context else f"知识边界：{title}"], 2),
            "teaching_expansion": _take_unique(
                [
                    f"学习{title}时，先问三个问题：它解决什么问题、内部结构是什么、能迁移到哪里。",
                    f"把{title}和真实场景连接起来：先解释目的，再说明用法，最后指出边界。",
                    f"核心概念包括：{'、'.join(concept_names[:5])}。",
                ],
                4,
            ),
            "practical_steps": _take_unique(hints.get("steps") or [f"先说明{title}的目的。", f"再说出{title}的关键结构或使用流程。", "最后补充适用边界和常见错误。"], 5),
            "practice_tasks": _take_unique(
                [
                    f"用 60 秒口述{title}：必须包含目的、结构、用法和一个容易误解的点。",
                    f"给{title}补一个自己的真实例子。",
                ],
                3,
            ),
            "transfer_prompts": _take_unique(
                [
                    f"如果换一个场景，你会怎样判断它仍然适合用{title}？",
                    f"{title}和相邻知识点的区别是什么？",
                ],
                3,
            ),
            "enrichment_notes": [],
        },
    }
    if not isinstance(upgraded.get("teacher_ready_content"), dict):
        upgraded["teacher_ready_content"] = build_teacher_ready_content(upgraded, course_title=course_title, intent=intent)
    upgraded["dependencies"] = []
    upgraded["children"] = [
        _upgrade_node(child, [*parent_titles, title], id_map=id_map, counter=counter) for child in node.get("children") or []
    ]
    return upgraded


def _remap_dependencies(nodes: list[dict[str, Any]], id_map: dict[str, str]) -> None:
    previous_sibling = ""
    for node in nodes:
        old_deps = node.get("dependencies") if isinstance(node.get("dependencies"), list) else []
        remapped = [id_map.get(str(item), str(item)) for item in old_deps]
        if previous_sibling and node.get("node_type") != "chapter":
            remapped.append(previous_sibling)
        node["dependencies"] = _take_unique([item for item in remapped if re.match(r"^[a-z][a-z0-9._-]{1,63}$", item)], 8)
        children = node.get("children") if isinstance(node.get("children"), list) else []
        _remap_dependencies(children, id_map)
        previous_sibling = str(node.get("id") or "")


def upgrade_course_package_payload(package: dict[str, Any]) -> dict[str, Any]:
    package = json.loads(json.dumps(package, ensure_ascii=False))
    package["package_id"] = f"{_clean(package.get('package_id')) or 'course'}_teaching_first"
    package.setdefault("source", {})["notes"] = "由既有课程包本地升级为教学优先 MVP；视频材料只限定范围，不作为前台复述内容。"
    package.setdefault("course", {})["subtitle"] = "教学优先升级版"
    package["course"]["overall_goal"] = package["course"].get("overall_goal") or "把视频材料转化为可直接学习、主动回忆、对照标准答案推进的本地课程。"
    package["course"]["completion_definition"] = "完成每个节点的讲解学习和主动回忆，并能说出核心概念、使用方式、适用边界和常见误区。"
    id_map: dict[str, str] = {}
    counter = {"value": 0}
    package["chapters"] = [_upgrade_node(chapter, [], id_map=id_map, counter=counter) for chapter in package.get("chapters") or []]
    _remap_dependencies(package["chapters"], id_map)
    package["dependency_graph"] = [
        {
            "from": id_map.get(str(edge.get("from")), str(edge.get("from"))),
            "to": id_map.get(str(edge.get("to")), str(edge.get("to"))),
            "kind": str(edge.get("kind") or "recommended"),
            "reason": str(edge.get("reason") or "建议按课程顺序推进。"),
        }
        for edge in package.get("dependency_graph") or []
        if isinstance(edge, dict)
        and id_map.get(str(edge.get("from")))
        and id_map.get(str(edge.get("to")))
    ]
    package.pop("metadata", None)
    package["source"]["ingested_at"] = datetime.now(timezone.utc).isoformat()

    errors = distiller.MinimalSchemaValidator(distiller.load_course_schema()).validate(package)
    if errors:
        raise RuntimeError("升级后的 Course Package 未通过 schema 校验：\n" + "\n".join(errors[:20]))
    return package


def upgrade_course_package(input_path: str, output_path: str) -> dict[str, Any]:
    with open(input_path, "r", encoding="utf-8") as file:
        package = json.load(file)
    package = upgrade_course_package_payload(package)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(package, file, ensure_ascii=False, indent=2)
    return package


def _walk(nodes: list[dict[str, Any]]):
    for node in nodes:
        yield node
        yield from _walk(node.get("children") or [])


def main() -> int:
    parser = argparse.ArgumentParser(description="Upgrade a Course Package into teaching-first form.")
    parser.add_argument("input", help="Input course-package JSON")
    parser.add_argument("--output", required=True, help="Output course-package JSON")
    parser.add_argument("--result-json", action="store_true")
    args = parser.parse_args()
    package = upgrade_course_package(os.path.abspath(args.input), os.path.abspath(args.output))
    result = {
        "outputPath": os.path.abspath(args.output),
        "packageId": package.get("package_id"),
        "chapterCount": len(package.get("chapters") or []),
        "nodeCount": sum(1 for _ in _walk(package.get("chapters") or [])),
    }
    if args.result_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(result["outputPath"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

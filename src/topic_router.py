# -*- coding: utf-8 -*-
"""Lightweight topic routing for MVP course generation.

This module is deterministic on purpose. It is not the final Codex course
designer; it only gives the local MVP enough domain awareness to avoid forcing
all materials into the oral-medicine/exam template.
"""

from __future__ import annotations

import re
from typing import Any


TopicProfile = dict[str, Any]


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _score(pattern: str, text: str) -> int:
    return len(re.findall(pattern, text, re.I))


TOPIC_RULES: list[TopicProfile] = [
    {
        "pattern": r"React|Hooks?|useState|useEffect|组件|状态|副作用",
        "topic": "React 状态与副作用",
        "stage": "编程与工具实操",
        "intent": "tool",
        "concepts": ["组件状态", "副作用", "渲染流程", "依赖数组"],
        "steps": ["先分清状态变化和副作用分别解决什么问题。", "再用一个最小组件复现状态更新和 effect 执行。", "最后检查依赖数组、重复渲染和清理函数。"],
        "mistakes": ["把 useEffect 当成普通初始化函数。", "依赖数组漏写变量，导致闭包或重复执行问题。"],
    },
    {
        "pattern": r"Python|pandas|DataFrame|数据清洗|CSV|表格|爬虫|脚本",
        "topic": "Python 数据处理",
        "stage": "编程与工具实操",
        "intent": "tool",
        "concepts": ["数据结构", "清洗流程", "输入输出", "异常处理"],
        "steps": ["先确认输入数据格式和目标输出。", "再按读取、清洗、转换、保存的顺序处理。", "最后用小样本校验结果是否正确。"],
        "mistakes": ["一上来处理全量数据，没先看样本。", "只看代码能跑，不检查输出是否符合业务含义。"],
    },
    {
        "pattern": r"Git|提交|分支|merge|rebase|commit|仓库|版本控制",
        "topic": "Git 版本控制",
        "stage": "编程与工具实操",
        "intent": "tool",
        "concepts": ["提交", "分支", "合并", "工作区"],
        "steps": ["先确认工作区有哪些改动。", "再把相关改动组织成清楚的提交。", "最后用分支和合并保持历史可追踪。"],
        "mistakes": ["把无关改动混进同一个提交。", "遇到冲突只想着覆盖，没有先理解两边改了什么。"],
    },
    {
        "pattern": r"Docker|容器|镜像|部署|端口|环境变量|服务器|命令行|CLI|安装|配置",
        "topic": "环境配置与部署",
        "stage": "编程与工具实操",
        "intent": "tool",
        "concepts": ["运行环境", "配置项", "端口映射", "部署验证"],
        "steps": ["先确认运行环境、版本和依赖。", "再按配置、启动、验证的顺序走最小流程。", "最后记录失败日志和排查路径。"],
        "mistakes": ["只照抄命令，不知道每个配置项控制什么。", "启动成功后不做功能验证。"],
    },
    {
        "pattern": r"摄影|拍摄|曝光|光圈|快门|ISO|构图|景深|白平衡|焦距",
        "topic": "摄影曝光与构图",
        "stage": "创作与实践技能",
        "intent": "skill",
        "concepts": ["曝光三要素", "画面意图", "景深", "运动凝固"],
        "steps": ["先确定画面想突出什么。", "再用光圈、快门和 ISO 配合控制曝光效果。", "最后回看照片，判断亮度、噪点和运动表现是否符合意图。"],
        "mistakes": ["只追求曝光正确，忽略画面意图。", "把 ISO 当成无成本补光，导致噪点过高。"],
    },
    {
        "pattern": r"剪辑|视频剪辑|镜头|节奏|转场|调色|音频|字幕",
        "topic": "视频剪辑流程",
        "stage": "创作与实践技能",
        "intent": "skill",
        "concepts": ["叙事节奏", "素材筛选", "转场", "声音层次"],
        "steps": ["先确定视频要表达的主线。", "再按粗剪、精剪、声音、字幕和调色推进。", "最后用完整观看检查节奏和信息密度。"],
        "mistakes": ["先堆特效，不先整理叙事主线。", "画面能看但声音和字幕拖慢理解。"],
    },
    {
        "pattern": r"工业革命|世界史|历史|英国|制度|市场|殖民|资本|社会结构|启蒙",
        "topic": "历史因果解释",
        "stage": "历史与社会理解",
        "intent": "concept",
        "concepts": ["多因素因果", "制度条件", "市场需求", "技术积累"],
        "steps": ["先列出事件发生的核心问题。", "再从制度、经济、技术和社会条件拆因果链。", "最后比较其他地区为什么没有同时发生。"],
        "mistakes": ["把复杂历史归因成单一原因。", "只背结论，不说明因素之间如何相互作用。"],
    },
    {
        "pattern": r"经济学|通货膨胀|供给|需求|价格|市场|货币|利率|商业模式",
        "topic": "经济与商业机制",
        "stage": "经济与商业理解",
        "intent": "framework",
        "concepts": ["供需关系", "激励结构", "约束条件", "反馈机制"],
        "steps": ["先确认问题里的关键变量。", "再判断变量之间如何互相影响。", "最后用一个现实案例验证解释是否成立。"],
        "mistakes": ["只记概念定义，不会用变量关系解释现象。", "忽略时间滞后和外部约束。"],
    },
    {
        "pattern": r"产品|运营|增长|用户|留存|转化|策略|商业|管理|决策|方法论",
        "topic": "产品与运营框架",
        "stage": "方法框架与决策",
        "intent": "framework",
        "concepts": ["用户问题", "价值路径", "指标", "反馈闭环"],
        "steps": ["先明确目标用户和真实问题。", "再拆出价值路径、关键指标和约束。", "最后用反馈数据修正方案。"],
        "mistakes": ["只套框架名，不回到具体用户问题。", "只看单一指标，忽略长期价值和副作用。"],
    },
    {
        "pattern": r"写作|表达|演讲|文案|叙事|结构|论证|沟通",
        "topic": "写作与表达结构",
        "stage": "写作表达",
        "intent": "framework",
        "concepts": ["受众", "观点", "结构", "证据"],
        "steps": ["先确认这段表达要影响谁。", "再搭出观点、理由、例子和行动的结构。", "最后删掉不服务主线的句子。"],
        "mistakes": ["堆信息但没有清楚观点。", "只追求辞藻，不检查读者是否能跟上。"],
    },
    {
        "pattern": r"心理|认知|学习方法|记忆|注意力|情绪|行为|习惯",
        "topic": "心理与学习机制",
        "stage": "概念理解",
        "intent": "concept",
        "concepts": ["认知负荷", "反馈", "动机", "行为模式"],
        "steps": ["先用自己的话解释核心机制。", "再说明它影响什么行为或体验。", "最后举一个自己生活中的例子。"],
        "mistakes": ["把心理概念当标签贴人。", "只背名词，不解释机制和边界。"],
    },
]


def match_topic(title: str, text: str = "") -> TopicProfile | None:
    haystack = f"{title}\n{text}"
    scored: list[tuple[int, int, TopicProfile]] = []
    for index, profile in enumerate(TOPIC_RULES):
        score = _score(str(profile["pattern"]), haystack)
        if score:
            scored.append((score, -index, profile))
    if not scored:
        return None
    scored.sort(reverse=True, key=lambda item: (item[0], item[1]))
    return dict(scored[0][2])


def infer_stage(title: str, text: str = "") -> str:
    profile = match_topic(title, text)
    return _clean(profile.get("stage")) if profile else ""


def infer_topic(title: str, text: str = "") -> str:
    profile = match_topic(title, text)
    return _clean(profile.get("topic")) if profile else ""


def concepts_for(title: str, text: str = "") -> list[str]:
    profile = match_topic(title, text)
    return list(profile.get("concepts") or []) if profile else []


def steps_for(title: str, text: str = "") -> list[str]:
    profile = match_topic(title, text)
    return list(profile.get("steps") or []) if profile else []


def mistakes_for(title: str, text: str = "") -> list[str]:
    profile = match_topic(title, text)
    return list(profile.get("mistakes") or []) if profile else []


def intent_for(title: str, text: str = "") -> str:
    profile = match_topic(title, text)
    return _clean(profile.get("intent")) if profile else ""

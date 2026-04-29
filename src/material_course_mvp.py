# -*- coding: utf-8 -*-
"""Build a usable MVP course package from an existing subtitle bundle.

This is intentionally local and deterministic. It turns cached subtitles into:
1. A Codex-friendly material package.
2. A lightweight Course Package JSON that the Electron learning desk can import.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from typing import Any

import config
import distiller
import topic_router
from teacher_ready import build_teacher_ready_content, infer_learning_intent


COURSE_PACKAGE_BUILD_VERSION = "teacher-ready-mvp-2026-04-27-v5"


STOPWORDS = {
    "这个",
    "那个",
    "就是",
    "然后",
    "所以",
    "因为",
    "如果",
    "我们",
    "咱们",
    "可以",
    "进行",
    "一个",
    "这种",
    "时候",
    "里面",
    "下面",
    "注意",
    "对吧",
    "对不对",
    "是不是",
    "考官好",
    "的话",
    "以及",
    "比较",
    "可能",
    "一般",
    "还是",
    "还是说",
    "一类",
    "一下",
    "这样",
    "那么",
    "但是",
}

FILLER_PATTERN = re.compile(
    r"(啊|呢|呃|嗯|哎|唉|对吧|对不对|是不是|就是说|咱们|我们|这个|那个|考官好)"
)
LEADING_FILLER_PATTERN = re.compile(r"^(然后|首先|接下来|那么|所以|就是|这个|那个|的话)[，,、\s]*")
BAD_TOKEN_PATTERN = re.compile(r"(对不对|考官|然后|这个|那个|是不是|就是说|唉|哎|呃|嗯)")
DOMAIN_CONCEPT_PATTERN = re.compile(
    r"(无菌原则|七步洗手法|外科手套|污染区|清洁区|牙髓活力|冷诊|热诊|电活力|牙周探诊|"
    r"改良CPI|社区牙周指数|窝沟封闭|酸蚀|冲洗干燥|光固化|脓肿切开|切开引流|口述麻醉|"
    r"收缩压|舒张压|毫米汞柱|鼻导管|吸氧|病例分析|主诉|现病史|鉴别诊断|治疗原则|"
    r"根尖周|牙外伤|牙髓治疗|继发感染|针刺反应)"
)
TITLE_HINTS = {
    "洗手": ["手卫生", "七步洗手法", "无菌原则", "污染边界"],
    "戴手套": ["外科手套", "无菌接触面", "污染区", "手套穿戴顺序"],
    "填写检查表": ["牙位记录", "检查表填写", "左右侧标记", "结果核对"],
    "牙髓活力检查": ["冷诊", "热诊", "电活力测试", "正常对照牙"],
    "下颌下腺检查": ["双手触诊", "导管口观察", "红肿溢脓", "腺体压痛"],
    "改良社区牙周指数": ["改良CPI", "牙周探诊", "牙周袋", "出血和牙石记录"],
    "窝沟封闭术": ["清洁牙面", "酸蚀", "冲洗干燥", "封闭剂光固化"],
    "牙槽脓肿切开引流术": ["切开指征", "口述麻醉", "脓肿波动感", "引流和换药"],
    "血压测量": ["袖带位置", "收缩压", "舒张压", "毫米汞柱"],
    "吸氧术": ["鼻腔检查", "鼻导管", "氧流量", "缺氧纠正"],
    "实践技能概述": ["考试流程", "站点任务", "评分边界", "操作准备"],
    "病例分析": ["主诉", "诊断依据", "鉴别诊断", "治疗原则"],
    "考试结构": ["站点任务", "考试时间", "分值结构", "抽题规则"],
    "考前准备": ["器械准备", "模型准备", "材料准备", "考场核对"],
    "第一站": ["口腔检查", "互相检查", "检查表", "人文沟通"],
    "第二站": ["无菌操作", "口腔操作", "治疗技术", "操作评分"],
    "特殊检查": ["牙髓活力", "牙周探诊", "下颌下腺", "检查结果"],
    "治疗操作": ["窝沟封闭", "切开引流", "拔牙", "牙体预备"],
    "全身基础操作": ["血压测量", "吸氧", "急救流程", "安全核对"],
    "病史采集": ["主诉", "现病史", "既往史", "问诊顺序"],
    "病例分析作答": ["诊断依据", "鉴别诊断", "治疗原则", "非主诉疾病"],
    "牙周与牙髓病变": ["牙周脓肿", "逆行性牙髓炎", "牙髓活力", "牙周袋"],
    "复发性口腔溃疡": ["轻型溃疡", "重型溃疡", "疱疹样溃疡", "白塞病"],
    "口腔念珠菌病": ["菌丝孢子", "白色念珠菌", "抗真菌治疗", "分型诊断"],
    "口腔白斑与扁平苔藓": ["白色斑纹", "癌变风险", "卫生宣教", "定期随访"],
    "牙外伤": ["牙震荡", "牙脱位", "牙折", "牙髓活力复查"],
    "根尖周病": ["根尖周炎", "瘘管", "牙髓治疗", "根管治疗"],
    "牙髓活力测试": ["正常对照牙", "刺激反应", "持续时间", "迟缓反应"],
    "CPI记录指标": ["探诊出血", "牙石", "牙周袋深度", "最重发现"],
    "探诊顺序和手法": ["CPI探针", "轻柔探诊", "提插式", "全口顺序"],
    "基础器械清单": ["手套", "检查器械", "无菌用品", "材料核对"],
    "模型和离体牙准备": ["模型牙位", "离体牙", "树脂牙", "操作项目"],
    "主诉追问": ["时间线", "诱因", "伴随症状", "治疗经过"],
    "轻型阿弗他溃疡": ["小溃疡", "复发特点", "自限性", "局部治疗"],
    "急性假膜型": ["白色假膜", "可擦除", "菌丝孢子", "抗真菌治疗"],
}
TITLE_STEPS = {
    "洗手": ["取下饰物，暴露手腕，先确认手部皮肤和指甲状态。", "按七步洗手法覆盖掌心、手背、指缝、指背、拇指、指尖和腕部。", "冲洗后保持手部清洁，避免再接触污染物。"],
    "戴手套": ["确认手套包装完整、型号合适，并在无菌区域内打开。", "第一只手只接触手套内面，避免裸手碰到外面。", "第二只手用已戴手套的手伸入反折边，只接触无菌外面。"],
    "填写检查表": ["先确认牙位、左右侧和检查项目。", "再把检查结果按表格规则写到对应位置。", "最后复核牙位、符号和异常结果是否一致。"],
    "牙髓活力检查": ["先说明检查目的，并选择正常对照牙。", "再按冷诊、热诊或电活力测试记录患牙反应。", "最后比较反应强弱、持续时间和迟缓情况。"],
    "下颌下腺检查": ["先观察导管口和局部红肿情况。", "再用双手触诊腺体大小、质地和压痛。", "最后记录是否有分泌物、疼痛或异常肿大。"],
    "改良社区牙周指数": ["按规定牙位顺序探诊。", "贴合牙面轻柔进入龈沟，避免人为出血。", "按最重发现记录牙石、出血或牙周袋情况。"],
    "窝沟封闭术": ["先评估适应证并清洁牙面。", "隔湿后酸蚀、冲洗并彻底干燥。", "涂布封闭剂并光固化，最后检查遗漏和咬合。"],
    "牙槽脓肿切开引流术": ["先判断是否形成脓肿及切开指征。", "选择利于引流且避开重要结构的切口。", "切开、分离、冲洗、放置引流并交代复诊。"],
    "血压测量": ["让患者安静休息，暴露上臂并选择合适袖带。", "袖带位置对准肱动脉，听诊器放在正确部位。", "缓慢放气，记录收缩压、舒张压和测量条件。"],
    "吸氧术": ["先核对患者并评估鼻腔通畅。", "连接湿化装置并调节合适氧流量。", "固定鼻导管，观察呼吸、紫绀和舒适度。"],
    "病例分析": ["先抓主诉、时间线和核心症状。", "再把体征、检查和病史转成诊断依据。", "最后列出鉴别诊断和处理原则。"],
    "考试结构": ["先分清每一站考什么、给多少时间。", "再把各站任务对应到准备物品和练习方式。", "最后按分值和失误风险安排复习优先级。"],
    "考前准备": ["先列出必须自备和考场提供的器械材料。", "再按操作项目检查模型、离体牙、器械和耗材。", "最后用清单确认没有遗漏影响考试流程的物品。"],
    "第一站": ["先完成核对、告知和互查配合。", "再按一般检查、特殊检查和检查表顺序推进。", "最后把检查结果规范表达并记录。"],
    "第二站": ["先完成无菌准备和器械确认。", "再按抽到的口腔操作项目完成关键动作。", "最后检查结果、交代注意事项并收尾。"],
    "特殊检查": ["先说明检查目的和患者配合要求。", "再按项目要求完成测试或探查。", "最后说出结果、判断意义和记录方式。"],
    "治疗操作": ["先判断适应证、禁忌证和操作目标。", "再按准备、实施、检查的顺序完成关键步骤。", "最后说明术后注意事项和常见风险。"],
    "全身基础操作": ["先核对患者并评估安全条件。", "再按标准流程完成测量、给氧或急救动作。", "最后记录结果并观察患者反应。"],
    "病史采集": ["先围绕主诉追问时间线。", "再补充伴随症状、诱因、治疗经过和既往史。", "最后把信息整理成能支持诊断的病史链。"],
    "病例分析作答": ["先给出主诉疾病和非主诉疾病诊断。", "再列出诊断依据和鉴别诊断依据。", "最后给出治疗原则和进一步检查。"],
    "牙周与牙髓病变": ["先判断病变来源更偏牙周还是牙髓。", "再用牙周袋、牙髓活力和影像表现组织依据。", "最后说明治疗顺序和预后风险。"],
    "复发性口腔溃疡": ["先按大小、数量、持续时间和复发特点分型。", "再区分普通复发性溃疡、白塞病和深大溃疡。", "最后给出局部治疗、全身治疗和随访原则。"],
    "口腔念珠菌病": ["先看白膜、红斑、口角炎或增殖型表现。", "再用菌丝孢子等检查支持诊断。", "最后说明局部和全身抗真菌治疗。"],
    "口腔白斑与扁平苔藓": ["先观察白色斑纹、糜烂和部位分布。", "再判断癌变风险和需要排除的相似病变。", "最后说明卫生宣教、随访和必要处理。"],
    "牙外伤": ["先判断外伤类型和牙齿位置变化。", "再评估松动、根折、牙髓活力和影像表现。", "最后决定复位固定、观察或牙髓治疗时机。"],
    "根尖周病": ["先抓疼痛、肿胀、瘘管和叩痛。", "再结合影像和牙髓活力判断根尖周来源。", "最后说明根管治疗、引流或随访计划。"],
    "牙髓活力测试": ["先说明检查目的，并选择正常对照牙。", "再记录患牙对冷、热或电刺激的反应。", "最后比较反应强弱、持续时间和是否迟缓。"],
    "CPI记录指标": ["先用 CPI 探针轻柔进入龈沟。", "再依次观察出血、牙石和牙周袋深度。", "最后按最重发现记录结果。"],
    "探诊顺序和手法": ["先让探针与牙长轴方向一致。", "再用轻柔提插式动作检查唇面和舌面。", "最后按全口顺序由后向前记录。"],
    "基础器械清单": ["先确认无菌用品和个人防护。", "再检查口腔检查器械、治疗器械和耗材。", "最后按考试项目把物品分组放置。"],
    "模型和离体牙准备": ["先确认考试项目对应的牙位。", "再准备模型、离体牙或树脂牙。", "最后用真实操作流程检查材料是否够用。"],
    "主诉追问": ["先问清主诉发生的时间和主要不适。", "再追问诱因、加重缓解因素和伴随症状。", "最后补充治疗经过、既往史和风险信息。"],
    "轻型阿弗他溃疡": ["先确认溃疡大小、数量和复发特点。", "再判断是否符合轻型阿弗他溃疡。", "最后说明局部止痛、促进愈合和减少诱因。"],
    "急性假膜型": ["先观察白色假膜的位置和范围。", "再判断白膜是否可擦除，并寻找红色糜烂面。", "最后用菌丝孢子检查和抗真菌治疗支持诊断。"],
}
TITLE_MISTAKES = {
    "洗手": ["漏洗拇指、指尖或腕部。", "洗完手后又接触污染物，破坏后续无菌操作前提。"],
    "戴手套": ["裸手碰到手套外面。", "戴好手套后又触碰非无菌区域。"],
    "填写检查表": ["牙位、左右侧或符号写错。", "只看单项结果，没有最后复核整张表的一致性。"],
    "牙髓活力检查": ["只看患牙有没有反应，不设置正常对照牙。", "没有记录反应强弱、持续时间和迟缓情况。"],
    "下颌下腺检查": ["只摸腺体，不观察导管口和分泌物。", "没有说明阳性发现代表什么风险。"],
    "改良社区牙周指数": ["探诊用力过大导致假性出血。", "记录时混淆牙石、出血和牙周袋深度。"],
    "窝沟封闭术": ["隔湿失败导致封闭剂脱落。", "酸蚀后没有保持牙面干燥。"],
    "牙槽脓肿切开引流术": ["未判断波动感和切开指征就贸然切开。", "切口位置不利于引流或损伤重要结构。"],
    "血压测量": ["袖带位置、松紧或放气速度不规范。", "只报数值，不说明单位和测量条件。"],
    "吸氧术": ["未先检查鼻腔和装置通畅。", "忽略流量记录和用氧安全。"],
    "病例分析": ["直接报诊断，不给诊断依据。", "只列疾病名，不说明鉴别诊断的排除理由。"],
    "考试结构": ["只背项目名称，不知道每站的时间、任务和分值边界。", "把所有内容平均复习，忽略高风险高频项目。"],
    "考前准备": ["以为考场一定提供全部器械材料。", "练习时没有按真实考试物品和流程复现。"],
    "第一站": ["只做检查动作，漏掉核对、告知和人文沟通。", "检查完不会把结果规范写入检查表。"],
    "第二站": ["无菌准备和正式操作混在一起。", "只记步骤，不知道每步的评分边界和风险。"],
    "特殊检查": ["做了检查但不说结果意义。", "没有设置对照或没有记录关键反应。"],
    "治疗操作": ["只追求做完动作，不判断适应证和风险。", "操作后不检查效果，也不交代注意事项。"],
    "全身基础操作": ["只背流程，不先核对患者和安全条件。", "完成动作后不记录结果或观察反应。"],
    "病史采集": ["问题散乱，不能围绕主诉追问时间线。", "收集了信息但没有转化为诊断依据。"],
    "病例分析作答": ["诊断、依据、鉴别和治疗原则混在一起说。", "只说主诉疾病，漏掉非主诉疾病。"],
    "牙周与牙髓病变": ["把牙周脓肿和根尖周脓肿混淆。", "忽略牙髓活力和牙周袋这两个关键区分点。"],
    "复发性口腔溃疡": ["只写口腔溃疡，不进一步分型。", "把白塞病、结核性溃疡和癌性溃疡混在一起。"],
    "口腔念珠菌病": ["只看白色病损，不做分型和检查支持。", "治疗只写抗真菌，漏掉诱因控制和复查。"],
    "口腔白斑与扁平苔藓": ["把所有白色病损都当成同一种病。", "忽略癌变风险和长期随访。"],
    "牙外伤": ["笼统诊断牙外伤，不写具体类型。", "不复查牙髓活力，漏掉后续牙髓治疗时机。"],
    "根尖周病": ["只处理症状，不追溯牙髓来源。", "漏掉影像、瘘管和叩痛等诊断依据。"],
    "牙髓活力测试": ["只测患牙，不测正常对照牙。", "只写有无反应，不记录反应持续时间。"],
    "CPI记录指标": ["只记录一个现象，漏掉出血、牙石和牙周袋的对应关系。", "没有按最重发现记录。"],
    "探诊顺序和手法": ["探诊用力过大导致假性出血。", "顺序混乱，漏查唇面、舌面或远中区域。"],
    "基础器械清单": ["只背项目，不知道每项需要哪些器械。", "没有区分自备物品和考场提供物品。"],
    "模型和离体牙准备": ["不知道操作项目对应哪颗牙。", "练习材料和真实考试材料不一致。"],
    "主诉追问": ["只问哪里疼，不追问时间线。", "漏掉诱因、伴随症状和治疗经过。"],
    "轻型阿弗他溃疡": ["只写口腔溃疡，不说明轻型依据。", "漏掉与重型、疱疹样和白塞病的区别。"],
    "急性假膜型": ["只看见白色病损就下诊断。", "漏掉可擦除、菌丝孢子和诱因控制。"],
}
CHUNK_FOCUS_RULES: list[tuple[str, str]] = [
    ("牙周脓肿|逆行性牙髓炎|慢性牙周炎|根分叉|深达根尖区", "牙周与牙髓病变"),
    ("阿弗他|口腔溃疡|白塞|针刺反应|疱疹样|重型溃疡|轻型", "复发性口腔溃疡"),
    ("念珠菌|菌丝|孢子|口角炎|抗真菌|白膜", "口腔念珠菌病"),
    ("白斑|扁平苔藓|白色斑纹|癌变|卫生宣教|定期随访", "口腔白斑与扁平苔藓"),
    ("牙外伤|脱位|嵌入|根折|牙震荡|牙髓活力测试", "牙外伤"),
    ("根尖周|瘘管|根管|牙龈红肿|叩痛|牙髓治疗", "根尖周病"),
    ("病史采集|主诉|现病史|既往史|伴随症状|治疗经过", "病史采集"),
    ("病例分析|鉴别诊断|诊断依据|治疗原则|非主诉", "病例分析作答"),
    ("血压|吸氧|鼻导管|CPR|心肺复苏|急救", "全身基础操作"),
    ("拔牙|麻醉|洁治|缝合|牙体预备|全冠|印模|模型|治疗椅", "治疗操作"),
    ("窝沟封闭|脓肿切开|切开引流|拔牙钳|橡皮障", "治疗操作"),
    ("牙髓活力|牙周探诊|下颌下腺|颞下颌|特殊检查|CPI", "特殊检查"),
    ("第一站|互相检查|一般检查|口腔检查|检查表", "第一站"),
    ("第二站|无菌操作|口腔操作|洗手|戴手套", "第二站"),
    ("器械|材料|模型|离体牙|考试基地|准备", "考前准备"),
    ("分值|时间|站点|抽题|流程|考试", "考试结构"),
]
FOCUS_DETAIL_RULES: dict[str, list[tuple[str, str]]] = {
    "考前准备": [
        ("手套|口罩|帽子|无菌|器械", "基础器械清单"),
        ("模型|离体牙|树脂牙|牙位|三六|四六", "模型和离体牙准备"),
        ("考试基地|自备|准备什么|材料", "考场材料核对"),
    ],
    "考试结构": [
        ("第一站|第二站|第三站|第四站|站点", "站点任务总览"),
        ("分值|时间|分钟", "时间和分值安排"),
        ("抽题|考题|考试纸", "抽题和题目形式"),
    ],
    "特殊检查": [
        ("CPI|牙龈出血|牙周带深度|牙石", "CPI记录指标"),
        ("提插式|全口|由后向前|唇面|舌面|平行", "探诊顺序和手法"),
        ("牙髓活力|冷诊|热诊|电活力", "牙髓活力测试"),
        ("牙周|探诊|牙周袋", "牙周探诊记录"),
        ("下颌下腺|导管|淋巴结", "腺体和导管检查"),
        ("颞下颌|肌肉|关节", "颞下颌关节检查"),
    ],
    "治疗操作": [
        ("窝沟封闭|酸蚀|光固化", "窝沟封闭"),
        ("脓肿|切开|引流", "脓肿切开引流"),
        ("拔牙|牙钳|挺松", "拔牙操作"),
        ("麻醉|注射", "口腔麻醉"),
        ("牙体预备|全冠|嵌体", "牙体预备"),
        ("洁治|牙结石|刮治", "洁治操作"),
        ("缝合|剪线", "缝合和剪线"),
    ],
    "全身基础操作": [
        ("血压|袖带|收缩压|舒张压", "血压测量"),
        ("吸氧|鼻导管|氧流量", "吸氧操作"),
        ("CPR|心肺复苏|按压", "心肺复苏"),
    ],
    "病史采集": [
        ("主诉|疼痛|肿胀", "主诉追问"),
        ("现病史|多久|诱因|治疗经过", "现病史时间线"),
        ("既往史|用药|过敏|全身", "既往史和风险信息"),
    ],
    "病例分析作答": [
        ("主诉疾病|非主诉", "主诉与非主诉诊断"),
        ("诊断依据|检查|病史", "诊断依据组织"),
        ("鉴别诊断|鉴别", "鉴别诊断依据"),
        ("治疗原则|处理|治疗", "治疗原则表达"),
    ],
    "牙周与牙髓病变": [
        ("牙周脓肿|慢性牙周炎|牙周袋", "牙周脓肿判断"),
        ("逆行性牙髓炎|牙髓治疗|根尖区", "逆行性牙髓炎"),
        ("根分叉|牙周炎", "根分叉病变"),
    ],
    "复发性口腔溃疡": [
        ("轻型|小溃疡|10mm", "轻型阿弗他溃疡"),
        ("重型|大溃疡|深大", "重型阿弗他溃疡"),
        ("疱疹样", "疱疹样阿弗他溃疡"),
        ("白塞|针刺反应", "白塞病鉴别"),
        ("结核性|癌性", "深大溃疡鉴别"),
    ],
    "口腔念珠菌病": [
        ("白膜|假膜", "急性假膜型"),
        ("红斑|红色", "急性红斑型"),
        ("口角炎", "念珠菌口角炎"),
        ("慢性增殖|肥厚", "慢性增殖型"),
        ("菌丝|孢子|抗真菌", "检查和抗真菌治疗"),
    ],
    "口腔白斑与扁平苔藓": [
        ("扁平苔藓|白色斑纹", "扁平苔藓识别"),
        ("白斑|癌变", "口腔白斑风险"),
        ("卫生宣教|定期随访", "随访和宣教"),
    ],
    "牙外伤": [
        ("牙震荡", "牙震荡"),
        ("嵌入", "嵌入性脱位"),
        ("脱位", "牙脱位"),
        ("根折|冠折", "牙折判断"),
        ("牙髓治疗|观察", "后续牙髓处理"),
        ("正畸牵引", "牵引和复位"),
    ],
    "根尖周病": [
        ("瘘管|牙龈红肿", "瘘管和肿胀"),
        ("根管|牙髓治疗", "根管治疗计划"),
        ("观察|随访", "观察和随访"),
    ],
}
LESSON_TARGET_CHARS = 1500
LESSON_MAX_CHARS = 2200
LESSON_MIN_CHARS = 600


def _clean_text(value: str) -> str:
    value = FILLER_PATTERN.sub("", value or "")
    value = LEADING_FILLER_PATTERN.sub("", value)
    value = re.sub(r"(.)\1{3,}", r"\1\1", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _slug(value: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    if not slug:
        chinese = re.sub(r"\s+", "_", value.strip())
        slug = re.sub(r"[^\w\u4e00-\u9fff]+", "_", chinese).strip("_")
    return (slug or fallback)[:48]


def _node_id(kind: str, index: int, title: str, parent_id: str = "") -> str:
    seed = f"{parent_id}_{kind}_{index}_{title}" if parent_id else f"{kind}_{index}_{title}"
    return _slug(seed, f"{kind}_{index}")


def _course_content_revision(bundle: dict[str, Any]) -> str:
    digest = hashlib.sha1()
    digest.update(COURSE_PACKAGE_BUILD_VERSION.encode("utf-8"))
    for subtitle in bundle.get("subtitles") or []:
        if not isinstance(subtitle, dict):
            continue
        for entry in subtitle.get("entries") or []:
            digest.update(str(entry.get("content") or "").encode("utf-8", errors="ignore"))
            digest.update(str(entry.get("from") or "").encode("utf-8", errors="ignore"))
            digest.update(str(entry.get("to") or "").encode("utf-8", errors="ignore"))
    return digest.hexdigest()[:10]


def _split_tokens(text: str) -> list[str]:
    tokens: list[str] = []
    for token in re.split(r"[，。、“”‘’：；（）()\[\]【】、《》\s/]+", text):
        token = token.strip()
        if _is_bad_concept(token):
            continue
        tokens.append(token)
    return tokens


def _is_bad_concept(token: str) -> bool:
    token = _clean_text(token)
    if len(token) < 2 or len(token) > 16:
        return True
    if token in STOPWORDS or BAD_TOKEN_PATTERN.search(token):
        return True
    if re.fullmatch(r"[\d.、（）()]+", token):
        return True
    if re.search(r"(开心|真的|已经|行了|出来|过去|回去|没有没有|哈哈)", token):
        return True
    return False


def _take_unique(items: list[str], limit: int) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        normalized = _clean_text(str(item))
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
        if len(result) >= limit:
            break
    return result


def _entries_char_count(entries: list[dict[str, Any]]) -> int:
    return sum(len(_clean_text(str(entry.get("content") or ""))) for entry in entries)


def _best_matching_key(mapping: dict[str, Any], title: str) -> str:
    matches = [key for key in mapping if key in title]
    if not matches:
        return ""
    matches.sort(key=lambda key: (title.rfind(key), len(key)), reverse=True)
    return matches[0]


def _display_topic(title: str) -> str:
    value = _clean_text(title)
    if "：" in value:
        value = value.split("：")[-1]
    return value or title


def _extract_key_sentences(entries: list[dict[str, Any]], limit: int = 8) -> list[str]:
    scored: list[tuple[int, int, str]] = []
    priority_pattern = re.compile(r"(第一|第二|第三|首先|然后|最后|注意|不能|不要|必须|需要|原则|步骤|检查|操作|诊断|治疗|鉴别|评分|考试)")
    for index, entry in enumerate(entries):
        text = _clean_text(str(entry.get("content") or ""))
        if len(text) < 4:
            continue
        score = len(text)
        if priority_pattern.search(text):
            score += 18
        if re.search(r"(无菌|消毒|洗手|手套|检查|牙髓|牙周|脓肿|血压|吸氧|病例|诊断)", text):
            score += 12
        if re.search(r"(考官|对不对|是不是|开心|哈哈)", text):
            score -= 25
        scored.append((score, index, text))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return _take_unique([item[2] for item in scored], limit)


def _extract_concepts(title: str, entries: list[dict[str, Any]], limit: int = 5) -> list[dict[str, str]]:
    text = "\n".join(_clean_text(str(entry.get("content") or "")) for entry in entries)
    counter = Counter(_split_tokens(text))
    title_tokens = _split_tokens(title)
    title_hints: list[str] = []
    focus_title = _infer_chunk_focus(_normalize_label(title, title), entries)
    if focus_title and focus_title in TITLE_HINTS:
        title_hints.extend(TITLE_HINTS[focus_title])
    for key, values in TITLE_HINTS.items():
        if key != focus_title and key in title:
            title_hints.extend(values)
    if focus_title and focus_title not in title:
        title_tokens.extend(_split_tokens(focus_title))
    title_hints.extend(topic_router.concepts_for(title, text))
    domain_matches = DOMAIN_CONCEPT_PATTERN.findall(text)
    candidates = title_tokens + title_hints + domain_matches + [token for token, _count in counter.most_common(36)]
    concepts = []
    clean_candidates = [token for token in candidates if not _is_bad_concept(token)]
    for index, token in enumerate(_take_unique(clean_candidates, limit), start=1):
        concepts.append(
            {
                "id": f"concept_{index:02d}",
                "name": token[:40],
                "explanation": f"围绕“{title}”学习时，需要能解释“{token}”在核心概念、实际流程、判断标准或应用场景中的作用。",
                "evidence": [],
            }
        )
    return concepts


def _infer_chunk_focus(base_title: str, entries: list[dict[str, Any]]) -> str:
    text = "\n".join(_clean_text(str(entry.get("content") or "")) for entry in entries)
    haystack = f"{base_title}\n{text}"
    scored: list[tuple[int, int, str]] = []
    for index, (pattern, focus) in enumerate(CHUNK_FOCUS_RULES):
        matches = re.findall(pattern, haystack)
        if not matches:
            continue
        score = len(matches) * 4
        if focus in base_title:
            score += 2
        if focus in {"病史采集", "病例分析作答", "牙周与牙髓病变", "复发性口腔溃疡", "口腔念珠菌病", "口腔白斑与扁平苔藓", "牙外伤", "根尖周病"} and "病例" in base_title:
            score += 6
        if focus in {"第一站", "第二站", "特殊检查", "治疗操作", "全身基础操作", "考前准备", "考试结构"} and "概述" in base_title:
            score += 6
        scored.append((score, -index, focus))
    if not scored:
        return topic_router.infer_topic(base_title, text) or base_title
    scored.sort(reverse=True)
    return scored[0][2]


def _infer_detail_label(focus: str, entries: list[dict[str, Any]], part_index: int) -> str:
    text = "\n".join(_clean_text(str(entry.get("content") or "")) for entry in entries)
    rules = FOCUS_DETAIL_RULES.get(focus) or []
    scored: list[tuple[int, int, str]] = []
    for index, (pattern, detail) in enumerate(rules):
        matches = re.findall(pattern, text)
        if matches:
            scored.append((len(matches), -index, detail))
    if scored:
        scored.sort(reverse=True)
        return scored[0][2]
    concepts = [
        token
        for token in _split_tokens(text)
        if token not in STOPWORDS
        and token not in focus
        and not re.search(r"^(考试|检查|治疗|操作|需要|可以|肯定|第一个|第二个|最后|发现|结果|进行|这种|那么|注意)$", token)
        and not re.search(r"(比方说|对照牙|没事|行了|你看|就是)", token)
    ]
    return concepts[0][:12] if concepts else f"重点 {part_index}"


def _derive_lesson_title(base_title: str, entries: list[dict[str, Any]], part_index: int, part_count: int) -> str:
    if part_count <= 1:
        return base_title
    focus = _infer_chunk_focus(base_title, entries)
    if focus and focus != base_title:
        detail = _infer_detail_label(focus, entries, part_index)
        return f"{base_title}：{focus}：{detail}"
    concepts = [item["name"] for item in _extract_concepts(base_title, entries, limit=3)]
    base_tokens = set(_split_tokens(base_title))
    for concept in concepts:
        if concept not in base_tokens and concept not in base_title:
            return f"{base_title}：{concept}（{part_index}）"
    return f"{base_title}：重点（{part_index}）"


def _split_entries_for_lessons(label: str, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total_chars = _entries_char_count(entries)
    if total_chars <= LESSON_MAX_CHARS:
        return [{"label": label, "title": _normalize_label(label, label), "entries": entries}]

    chunks: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_chars = 0
    for entry in entries:
        text = _clean_text(str(entry.get("content") or ""))
        if not text:
            continue
        current.append(entry)
        current_chars += len(text)
        is_natural_break = bool(re.search(r"(最后|接下来|下面|第二|第三|总结|注意|那么)", text))
        should_cut = current_chars >= LESSON_TARGET_CHARS and (is_natural_break or current_chars >= LESSON_MAX_CHARS)
        if should_cut:
            chunks.append(current)
            current = []
            current_chars = 0
    if current:
        if chunks and current_chars < LESSON_MIN_CHARS:
            chunks[-1].extend(current)
        else:
            chunks.append(current)

    base_title = _normalize_label(label, label)
    result: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks, start=1):
        title = _derive_lesson_title(base_title, chunk, index, len(chunks))
        result.append(
            {
                "label": f"{label} · {index}/{len(chunks)}",
                "title": title,
                "entries": chunk,
            }
        )
    return result


def _lesson_summary(title: str, key_sentences: list[str]) -> str:
    matched_key = _best_matching_key(TITLE_HINTS, title)
    if matched_key:
        values = TITLE_HINTS[matched_key]
        return f"本节学习“{title}”的标准做法、关键理由和易错点，重点掌握{'、'.join(values[:3])}。"
    generic_concepts = topic_router.concepts_for(title, "\n".join(key_sentences))
    if generic_concepts:
        return f"本节围绕“{title}”建立可理解、可复述、可使用的知识，重点抓住{'、'.join(generic_concepts[:3])}。"
    positive_candidates = [
        sentence
        for sentence in key_sentences
        if not re.search(r"(不能|不要|错误|注意|不符合|禁忌)", sentence)
    ]
    if positive_candidates:
        return f"围绕流程、目的和判断标准学习，先抓住这一句主线：{positive_candidates[0][:80]}。"
    if key_sentences:
        return f"先建立规范流程，再用风险提示修正细节：{key_sentences[0][:80]}。"
    return "本节学习操作流程、关键判断和常见失误。"


def _practical_steps(title: str, key_sentences: list[str]) -> list[str]:
    matched_key = _best_matching_key(TITLE_STEPS, title)
    if matched_key:
        return TITLE_STEPS[matched_key]
    generic_steps = topic_router.steps_for(title, "\n".join(key_sentences))
    if generic_steps:
        return generic_steps
    informative = [
        sentence
        for sentence in key_sentences
        if 10 <= len(sentence) <= 80
        and not re.search(r"(比方说|对不对|是不是|考官|开心|俩人|这个这种|那个)", sentence)
    ]
    return _take_unique(
        [
            f"先说清“{title}”解决什么问题，避免只记名词。",
            f"再说出“{title}”的关键步骤、判断条件或使用方法。",
            f"最后用一个具体场景检查自己是否真的会用“{title}”。",
            *informative[:2],
        ],
        5,
    )


def _example_scenario(title: str, intent: str) -> str:
    if intent == "exam":
        return f"复习到“{title}”时，你需要不看提示说出核心判断、关键依据和一个常见误区。"
    if intent in {"skill", "tool"}:
        return f"实际使用或演示“{title}”时，你需要按顺序完成关键步骤，并能检查结果是否正确。"
    if intent == "framework":
        return f"遇到一个真实问题时，你可以用“{title}”拆出变量、关系和下一步行动。"
    return f"学习新领域时，你需要用自己的话解释“{title}”，再举出一个真实例子。"


def _best_evidence_sentence(key_sentences: list[str], fallback: str) -> str:
    for sentence in key_sentences:
        if re.search(r"(考官|对不对|是不是|开心|哈哈)", sentence):
            continue
        if not re.search(r"(不能|不要|错误|不符合)", sentence):
            return sentence
    return key_sentences[0] if key_sentences else fallback


def _source_scope(title: str, concepts: list[dict[str, str]]) -> list[str]:
    concept_names = [item["name"] for item in concepts[:4]]
    scope = []
    if concept_names:
        scope.append(f"本节覆盖：{'、'.join(concept_names)}。")
    return _take_unique(scope, 5)


def _source_refs(label: str, entries: list[dict[str, Any]], key_sentences: list[str]) -> list[dict[str, Any]]:
    start_values = [entry.get("from") for entry in entries if isinstance(entry.get("from"), (int, float))]
    end_values = [entry.get("to") for entry in entries if isinstance(entry.get("to"), (int, float))]
    excerpt = _best_evidence_sentence(key_sentences, "")
    ref: dict[str, Any] = {
        "kind": "subtitle_segment",
        "label": label,
    }
    if start_values or end_values:
        ref["time_range"] = {
            "from": min(start_values) if start_values else None,
            "to": max(end_values) if end_values else None,
        }
    if excerpt:
        ref["excerpt"] = excerpt[:300]
    return [ref]


def _common_mistakes(title: str, key_sentences: list[str]) -> list[str]:
    matched_key = _best_matching_key(TITLE_MISTAKES, title)
    if matched_key:
        return TITLE_MISTAKES[matched_key]
    generic_mistakes = topic_router.mistakes_for(title, "\n".join(key_sentences))
    if generic_mistakes:
        return generic_mistakes
    mistakes = [
        item
        for item in key_sentences
        if 10 <= len(item) <= 90
        and re.search(r"(不能|不要|错误|污染|漏|混淆|不符合|禁忌|失败|疼痛|损伤|风险)", item)
        and not re.search(r"(这种|那个|这个|就行|对不对|是不是|考官|开心|俩人)", item)
    ]
    fallback = [
        f"只背“{title}”名词，不会说出它解决什么问题、如何使用。",
        "只记零散细节，没有说清顺序、理由和容易出错的位置。",
        "回答时缺少关键理由，只说做法不说明为什么。",
    ]
    return _take_unique(mistakes + fallback, 4)


def _practice_tasks(title: str, key_sentences: list[str]) -> list[str]:
    first = _best_evidence_sentence(key_sentences, title)
    return [
        f"用 60 秒口述“{title}”的主线，要求至少说出目的、关键步骤和一个容易误解的点。",
        f"把“{first[:60]}”改写成一条自己能记住的学习要点。",
    ]


def _transfer_prompts(title: str, concepts: list[dict[str, str]]) -> list[str]:
    concept_names = [item["name"] for item in concepts if not _is_bad_concept(item["name"])][:2]
    if len(concept_names) >= 2:
        return [f"用自己的话说出“{title}”中“{concept_names[0]}”和“{concept_names[1]}”分别解决什么问题。"]
    return [f"请用自己的话说出“{title}”的目的、关键步骤和易错点。"]


def _build_lesson(
    *,
    parent_id: str,
    order: int,
    title: str,
    source_label: str,
    course_title: str,
    entries: list[dict[str, Any]],
    previous_lesson_id: str,
) -> dict[str, Any]:
    key_sentences = _extract_key_sentences(entries)
    concepts = _extract_concepts(title, entries)
    lesson_id = _node_id("lesson", order, title, parent_id)
    summary = _lesson_summary(title, key_sentences)
    intent = topic_router.intent_for(title, "\n".join(key_sentences)) or infer_learning_intent(title, summary, course_title)
    topic = _display_topic(title)
    concept_names = [item["name"] for item in concepts if item["name"] not in title][:3]
    checkpoints = _take_unique(
        [
            f"能说出“{topic}”解决什么问题。",
            f"能说出“{topic}”的关键步骤、判断条件或使用方法。",
            *[f"能说明“{name}”和“{topic}”之间的关系。" for name in concept_names],
        ],
        6,
    )
    lesson = {
        "id": lesson_id,
        "node_type": "lesson",
        "title": title[:120],
        "summary": summary[:240],
        "order": order,
        "learning_objectives": _take_unique([f"理解{topic}的目标", f"能说出{topic}的关键结构或流程", *checkpoints[:1]], 3),
        "source_refs": _source_refs(source_label, entries, key_sentences),
        "dependencies": [previous_lesson_id] if previous_lesson_id else [],
        "knowledge": {
            "concepts": concepts,
            "examples": [
                {
                    "id": f"example_{lesson_id[:24]}",
                    "title": f"{topic}应用场景",
                    "scenario": _example_scenario(topic, intent),
                    "takeaway": f"学习“{topic}”时，要把它整理成有目的、有结构、能迁移的知识。",
                }
            ],
            "checkpoints": checkpoints,
            "common_mistakes": _common_mistakes(title, key_sentences),
            "source_scope": _source_scope(title, concepts),
            "teaching_expansion": [
                f"先把“{topic}”学成一句清楚的话：它用来做什么，按什么顺序做，哪里最容易错。",
                "学习时优先抓住标准做法和检查点，再补充细节。",
            ],
            "practical_steps": _practical_steps(title, key_sentences),
            "practice_tasks": _practice_tasks(topic, key_sentences),
            "transfer_prompts": _transfer_prompts(topic, concepts),
            "enrichment_notes": [
                "后续可以继续补充更贴近学习目标的例子、练习和解释。",
            ],
        },
        "children": [],
        "assets": [],
        "gaps": [],
    }
    lesson["teacher_ready_content"] = build_teacher_ready_content(lesson, course_title=course_title, intent=intent)
    return lesson


def _stage_title(label: str, entries: list[dict[str, Any]] | None = None) -> str:
    if re.search(r"(病例|病例分析|临床思路)", label):
        return "病例分析与临床思路"
    if re.search(r"(洗手|戴手套|无菌)", label):
        return "无菌基础与操作准备"
    if re.search(r"(检查表|牙髓|下颌下腺|CPI|牙周)", label):
        return "口腔检查与记录"
    if re.search(r"(窝沟|脓肿|引流)", label):
        return "口腔治疗操作"
    if re.search(r"(血压|吸氧)", label):
        return "全身基础操作"
    if re.search(r"(概述|实践技能)", label):
        return "实践技能考试总论"
    generic_stage = topic_router.infer_stage(
        label,
        "\n".join(_clean_text(str(entry.get("content") or "")) for entry in (entries or [])[:80]),
    )
    if generic_stage:
        return generic_stage
    return "综合实践技能"


def _infer_course_title(page_segments: list[dict[str, Any]], source_title: str) -> str:
    labels = " ".join(str(segment.get("label") or "") for segment in page_segments)
    if re.search(r"(口腔|执业医师|助理医师|实践技能|牙髓|牙周|窝沟|拔牙|洗手|戴手套)", labels):
        return "口腔实践技能操作与病例分析"
    if source_title and source_title != "字幕材料":
        return source_title
    return "本地素材学习课程"


def _target_audience_for(course_title: str) -> str:
    intent = infer_learning_intent(course_title, course_title)
    if intent == "exam":
        return "需要围绕考试或测评快速建立知识主线、判断依据和主动回忆能力的学习者"
    if intent in {"skill", "tool"}:
        return "需要通过视频材料掌握流程、方法、工具或实操能力的学习者"
    if intent == "framework":
        return "需要把视频中的方法论转化为可应用框架的学习者"
    return "希望借助视频材料快速进入新领域、建立概念框架和主动回忆能力的学习者"


def _normalize_label(label: str, fallback: str) -> str:
    label = re.sub(r"^P\d+[:：]\s*", "", label or "").strip()
    label = re.sub(r"^\d+[.、]\s*", "", label)
    return label or fallback


def _iter_page_segments(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for subtitle in bundle.get("subtitles") or []:
        for segment in subtitle.get("page_segments") or []:
            entries = [entry for entry in (segment.get("entries") or []) if str(entry.get("content") or "").strip()]
            if entries:
                segments.append(
                    {
                        "label": str(segment.get("label") or f"P{len(segments) + 1}"),
                        "entries": entries,
                    }
                )
    if segments:
        return segments

    for subtitle in bundle.get("subtitles") or []:
        entries = [entry for entry in (subtitle.get("entries") or []) if str(entry.get("content") or "").strip()]
        if entries:
            return [{"label": str(subtitle.get("lang") or "字幕材料"), "entries": entries}]
    return []


def build_course_package(
    bundle: dict[str, Any],
    *,
    package_id: str,
    source_id: str,
    source_title: str,
    material_path: str,
    output_path: str,
) -> dict[str, Any]:
    page_segments = _iter_page_segments(bundle)
    if not page_segments:
        raise RuntimeError("字幕包中没有可用 entries。")

    course_title = _infer_course_title(page_segments, source_title)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for segment in page_segments:
        grouped.setdefault(_stage_title(segment["label"], segment["entries"]), []).append(segment)

    chapters: list[dict[str, Any]] = []
    dependency_graph: list[dict[str, Any]] = []
    previous_chapter_id = ""
    lesson_order_global = 0

    for chapter_index, (stage_title, segments) in enumerate(grouped.items(), start=1):
        chapter_id = _node_id("chapter", chapter_index, stage_title)
        children = []
        previous_lesson_id = ""
        local_lesson_order = 0
        seen_lesson_titles: Counter[str] = Counter()
        for segment in segments:
            for lesson_part in _split_entries_for_lessons(segment["label"], segment["entries"]):
                local_lesson_order += 1
                lesson_order_global += 1
                base_lesson_title = lesson_part["title"]
                seen_lesson_titles[base_lesson_title] += 1
                lesson_title = (
                    f"{base_lesson_title}（第{seen_lesson_titles[base_lesson_title]}部分）"
                    if seen_lesson_titles[base_lesson_title] > 1
                    else base_lesson_title
                )
                lesson = _build_lesson(
                    parent_id=chapter_id,
                    order=local_lesson_order,
                    title=lesson_title,
                    source_label=lesson_part["label"],
                    course_title=course_title,
                    entries=lesson_part["entries"],
                    previous_lesson_id=previous_lesson_id,
                )
                children.append(lesson)
                if previous_lesson_id:
                    dependency_graph.append(
                        {
                            "from": previous_lesson_id,
                            "to": lesson["id"],
                            "kind": "recommended",
                            "reason": "同一阶段内按素材原始顺序推进。",
                        }
                    )
                previous_lesson_id = lesson["id"]

        chapter_summary = f"{stage_title}阶段覆盖{len(children)}个操作或知识单元，重点建立流程、判断和避错意识。"
        chapter = {
            "id": chapter_id,
            "node_type": "chapter",
            "title": stage_title,
            "summary": chapter_summary,
            "order": chapter_index,
            "learning_objectives": _take_unique([f"掌握{stage_title}的主线", *[child["title"] for child in children[:2]]], 4),
            "dependencies": [previous_chapter_id] if previous_chapter_id else [],
            "source_refs": [
                {
                    "kind": "material_package",
                    "label": f"{stage_title}原材料包",
                    "uri": material_path,
                }
            ],
            "knowledge": {
                "concepts": [
                    {
                        "id": f"concept_{chapter_id[:24]}",
                        "name": stage_title,
                        "explanation": chapter_summary,
                        "evidence": [],
                    }
                ],
                "examples": [],
                "checkpoints": [f"能说出{stage_title}下各单元的学习顺序。"],
                "common_mistakes": ["只记单个操作，不能把阶段主线串起来。"],
                "source_scope": [child["title"] for child in children],
                "teaching_expansion": ["本阶段按主题主线组织，后续可由 Codex 继续补充更密集的案例、解释和练习。"],
                "practical_steps": [],
                "practice_tasks": [f"画一张{stage_title}流程图，并标出最容易误解或最需要检查的位置。"],
                "transfer_prompts": [f"如果换一个真实场景使用{stage_title}，你会先确认哪三件事？"],
                "enrichment_notes": [],
            },
            "children": children,
            "assets": [],
            "gaps": [],
        }
        chapters.append(chapter)
        if previous_chapter_id:
            dependency_graph.append(
                {
                    "from": previous_chapter_id,
                    "to": chapter_id,
                    "kind": "recommended",
                    "reason": "按从基础操作到检查、治疗、总论与病例分析的学习顺序推进。",
                }
            )
        previous_chapter_id = chapter_id

    text_length = sum(len(entry.get("content") or "") for segment in page_segments for entry in segment["entries"])
    package = {
        "schema_version": "onboard.course-package.v0.1",
        "package_id": package_id,
        "source": {
            "source_type": "bilibili_subtitle",
            "source_id": source_id,
            "title": source_title,
            "creator": "",
            "url": "",
            "language": "zh-CN",
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            "text_length": text_length,
            "notes": f"由 subtitle-bundle 离线生成；Codex 原材料包：{material_path}",
        },
        "course": {
            "title": f"{course_title} MVP 课程",
            "subtitle": "由既有字幕原材料本地整理生成",
            "overall_goal": "把视频或字幕材料整理成可分关学习、可主动回忆、可对照标准解释的轻量课程。",
            "target_audience": _target_audience_for(course_title),
            "prerequisites": [],
            "learning_outcomes": [
                "能按阶段说出课程的知识主线。",
                "能针对每个操作节点进行主动回忆，并对照关键点修正答案。",
                "能识别常见误区、使用边界和迁移场景。",
            ],
            "completion_definition": "完成全部关卡学习，并能用自己的话回答每关主动回忆题。",
            "estimated_total_minutes": max(30, lesson_order_global * 8),
        },
        "chapters": chapters,
        "dependency_graph": dependency_graph,
        "assets": [],
        "gaps": [
            {
                "id": "gap_visual_demonstration",
                "gap_type": "visual_context",
                "severity": "medium",
                "description": "该 MVP 只读取字幕文本，没有读取视频画面；涉及手法、器械位置和演示动作的部分需要后续人工或 Codex 结合原视频补充。",
                "affected_node_ids": [],
            }
        ],
    }

    errors = distiller.MinimalSchemaValidator(distiller.load_course_schema()).validate(package)
    if errors:
        raise RuntimeError("生成的 Course Package 未通过 schema 校验：\n" + "\n".join(errors[:20]))

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(package, file, ensure_ascii=False, indent=2)
    return package


def build_from_subtitle_bundle(input_path: str, output_dir: str) -> dict[str, Any]:
    with open(input_path, "r", encoding="utf-8") as file:
        bundle = json.load(file)

    source_id = os.path.basename(input_path).split(".")[0].upper()
    source_title = "字幕材料"
    source = distiller.SourceDescriptor(
        source_type="bilibili_subtitle",
        source_id=source_id,
        title=source_title,
        language="zh-CN",
        notes=str(bundle.get("note") or ""),
    )
    revision = _course_content_revision(bundle)
    package_id = _slug(f"mvp_{source_id.lower()}_{revision}", "mvp_course")
    pipeline_config = distiller.PipelineConfig()
    plan = distiller.prepare_chunk_plan(bundle.get("subtitles") or [], package_id=package_id, pipeline_config=pipeline_config)
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
    course_path = os.path.join(output_dir, f"{package_id}.course-package.mvp.json")
    course = build_course_package(
        bundle,
        package_id=package_id,
        source_id=source_id,
        source_title=source_title,
        material_path=material_path,
        output_path=course_path,
    )
    return {
        "materialPath": material_path,
        "coursePath": course_path,
        "chapterCount": len(course["chapters"]),
        "lessonCount": sum(len(chapter.get("children") or []) for chapter in course["chapters"]),
        "textLength": course["source"]["text_length"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build MVP course package from subtitle-bundle JSON.")
    parser.add_argument("input", help="Path to *.subtitle-bundle.json")
    parser.add_argument("--output-dir", default=config.ensure_output_dir(), help="Output directory")
    parser.add_argument("--result-json", action="store_true")
    args = parser.parse_args()

    result = build_from_subtitle_bundle(os.path.abspath(args.input), os.path.abspath(args.output_dir))
    if args.result_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Codex material: {result['materialPath']}")
        print(f"Course package: {result['coursePath']}")
        print(f"Chapters: {result['chapterCount']} Lessons: {result['lessonCount']} Text: {result['textLength']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

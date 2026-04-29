# -*- coding: utf-8 -*-
"""Build a teaching-first oral physician exam course from broad review material."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import re
from typing import Any

from course_package_upgrade import upgrade_course_package_payload


BLUEPRINT: list[tuple[str, list[str]]] = [
    ("医学人文综合", ["医学心理学：心理过程与医患沟通", "医学心理学：应激、心身疾病与心理干预", "医学伦理学：基本原则与知情同意", "医学伦理学：临床伦理冲突", "卫生法规：执业医师与医疗机构", "卫生法规：传染病、医疗事故与处方管理", "医学人文素养：职业精神与沟通表达"]),
    ("基础医学综合", ["生物化学：蛋白质、酶与能量代谢", "生物化学：遗传信息传递与代谢调控", "医学微生物学：细菌、病毒与感染机制", "医学微生物学：消毒灭菌与常见病原体", "医学免疫学：抗原抗体与免疫应答", "医学免疫学：超敏反应与免疫相关疾病", "药理学：药效学、药动学与不良反应", "药理学：抗感染、心血管与麻醉镇痛药"]),
    ("临床医学综合", ["诊断学：症状、体征与问诊框架", "诊断学：实验室检查与影像判断", "内科学：循环、呼吸与消化系统高频点", "内科学：内分泌、泌尿与血液系统高频点", "外科学：无菌、创伤、休克与围手术期", "外科学：感染、肿瘤与常见外科问题", "妇产科学：妊娠、分娩与妇科炎症", "儿科学：生长发育、营养与常见儿科病", "预防医学：流行病学、统计与公共卫生"]),
    ("口腔基础医学", ["口腔组织病理学：牙体组织与牙周组织", "口腔组织病理学：口腔黏膜与颌骨病变", "口腔解剖生理学：牙体形态与牙列咬合", "口腔解剖生理学：颌面部解剖与口颌功能"]),
    ("牙体牙髓与牙周", ["牙体牙髓病学：龋病诊断与治疗原则", "牙体牙髓病学：牙髓病与根尖周病", "牙体牙髓病学：修复性治疗与并发症", "牙周病学：牙龈炎、牙周炎与检查指标", "牙周病学：基础治疗、维护与危险因素"]),
    ("儿童口腔与黏膜病", ["儿童口腔医学：乳牙、年轻恒牙与龋病管理", "儿童口腔医学：牙外伤、间隙管理与行为管理", "口腔黏膜病学：溃疡、感染与白色病损", "口腔黏膜病学：扁平苔藓、白斑与癌前病变"]),
    ("口腔颌面外科", ["口腔颌面外科学：拔牙、感染与局部麻醉", "口腔颌面外科学：损伤、囊肿与肿瘤", "口腔颌面外科学：涎腺、神经疾患与关节病"]),
    ("口腔修复、影像与预防", ["口腔修复学：牙体缺损与固定义齿", "口腔修复学：活动义齿与全口义齿", "口腔影像诊断学：根尖片、曲面体层与常见影像", "口腔预防医学：龋病、牙周病预防与社区口腔保健"]),
    ("综合应试训练", ["高频考点主动回忆法", "相似概念鉴别表", "题干关键词定位", "错因归纳与临考复盘"]),
]


TEACHING_RULES: list[dict[str, Any]] = [
    {
        "pattern": "心理过程|医患沟通",
        "core": "医学心理学考的是“人怎么感知、理解、反应，以及医生如何把信息说到患者能接受”。医患沟通题通常不考漂亮话，而考尊重、倾听、解释、共情和共同决策。",
        "steps": ["先判断题干是在问认知、情绪、意志，还是医患沟通行为。", "沟通题先做倾听和共情，再解释病情和方案，最后确认患者理解并取得配合。", "遇到冲突时优先保护患者知情权和自主权，同时保持医学专业边界。"],
        "key_points": ["心理过程包括认知、情绪情感和意志行为。", "医患沟通先倾听共情，再解释告知，不要直接命令患者。", "考试喜欢用“患者焦虑、拒绝、不理解”来考沟通顺序。"],
        "mistakes": ["一上来就批评患者或直接下命令。", "只讲医学结论，不确认患者是否理解。", "把安慰当成唯一沟通，漏掉知情告知和共同决策。"],
        "memory": "先听懂人，再说明病。",
    },
    {
        "pattern": "应激|心身疾病|心理干预",
        "core": "应激是机体面对压力源后的心理和生理反应；心身疾病强调心理因素会影响躯体疾病发生发展；心理干预的重点是评估压力、调整认知、改善应对方式。",
        "steps": ["先找压力源和个体反应：焦虑、睡眠、躯体化或行为改变。", "再判断是否存在心身相互影响，而不是把症状简单归为“想太多”。", "干预时先支持和解释，再做认知调整、放松训练或转介。"],
        "key_points": ["应激不等于疾病，长期或强烈应激才容易造成适应不良。", "心身疾病不是装病，而是心理因素参与了躯体病程。", "心理干预要尊重患者体验，不能否定症状。"],
        "mistakes": ["把心身疾病说成“没有病”。", "只给安慰，不评估压力源和应对方式。", "忽略严重焦虑、抑郁或自伤风险需要转介。"],
        "memory": "压力源、反应、应对，三步看应激。",
    },
    {
        "pattern": "伦理|知情同意|伦理冲突",
        "core": "医学伦理题的底层顺序是尊重患者、保护生命健康、公平分配资源，并避免伤害。知情同意不是签字本身，而是充分告知后的自主选择。",
        "steps": ["先判断涉及哪条伦理原则：尊重、有利、不伤害、公正。", "涉及治疗选择时，先告知病情、方案、风险、替代方案和后果。", "患者有决定能力时尊重本人意愿；无能力时再考虑法定代理和最佳利益。"],
        "key_points": ["知情同意包含告知、理解、自愿和同意。", "保密原则有例外：法定报告、公共安全和明显伤害风险。", "伦理冲突题要说明取舍理由，不能只背原则名。"],
        "mistakes": ["把家属意见直接放在患者本人意愿前面。", "只让患者签字，没有完成风险和替代方案告知。", "遇到冲突只说“听医生的”，漏掉患者自主。"],
        "memory": "先尊重，再有利；要同意，先告知。",
    },
    {
        "pattern": "卫生法规|执业医师|医疗机构|传染病|医疗事故|处方",
        "core": "卫生法规考的是医疗行为是否合法合规：谁有资格做、在哪做、怎么记录、何时报告、出了问题如何处理。",
        "steps": ["先定位法律主体：医师、医疗机构、患者还是公共卫生部门。", "再判断行为类型：执业注册、处方管理、传染病报告、医疗事故处理。", "最后看关键词：及时报告、规范记录、告知说明、依法承担责任。"],
        "key_points": ["执业医师必须在注册地点、类别和范围内执业。", "传染病和突发公共卫生事件强调及时报告。", "处方和病历都要求真实、规范、可追溯。"],
        "mistakes": ["忽略执业范围和注册地点。", "把医疗纠纷、医疗事故和一般差错混为一谈。", "传染病题漏掉法定报告时限和责任主体。"],
        "memory": "主体、行为、责任，三步做法规题。",
    },
    {
        "pattern": "蛋白质|酶|能量代谢|遗传信息|代谢调控",
        "core": "生物化学不要死背名词，要抓“结构决定功能、酶调节反应、代谢提供能量、遗传信息指导蛋白合成”这条主线。",
        "steps": ["先判断题目属于结构、酶、代谢还是遗传信息。", "代谢题抓底物、关键酶、产物和能量变化。", "遗传信息题按复制、转录、翻译和调控顺序排。"],
        "key_points": ["酶的核心是催化效率、专一性和调节。", "糖、脂、蛋白代谢最终常汇入能量代谢。", "遗传信息传递错误可导致蛋白异常和疾病。"],
        "mistakes": ["只背通路名，不知道限速酶和产物。", "混淆复制、转录和翻译。", "看到能量题不区分有氧和无氧条件。"],
        "memory": "结构定功能，酶控速度，代谢供能。",
    },
    {
        "pattern": "微生物|细菌|病毒|感染|消毒灭菌|病原体",
        "core": "微生物题先分清病原类型，再看致病机制、传播途径、诊断依据和控制方法。细菌重结构和毒力，病毒重复制和宿主细胞。",
        "steps": ["先判断病原体是细菌、病毒、真菌还是其他微生物。", "再抓传播途径、侵袭部位、毒力或免疫逃逸方式。", "最后联系消毒灭菌、抗感染药物和预防措施。"],
        "key_points": ["消毒是杀灭病原微生物，灭菌要求杀灭全部微生物包括芽胞。", "细菌感染常联系毒素、荚膜、侵袭酶和耐药。", "病毒感染常联系细胞内复制和免疫损伤。"],
        "mistakes": ["把消毒和灭菌当同义词。", "只背病原体名称，不会对应传播途径。", "忽略芽胞、耐药和院感控制。"],
        "memory": "先分病原，再看传播，最后定控制。",
    },
    {
        "pattern": "免疫|抗原|抗体|免疫应答|超敏反应",
        "core": "免疫学的主线是识别自己和非己，然后启动先天免疫、适应性免疫和免疫记忆。超敏反应题要先判类型，再联系机制和临床表现。",
        "steps": ["先判断题目问抗原抗体、细胞免疫、体液免疫还是超敏反应。", "免疫应答按识别、活化、效应和记忆来理解。", "超敏反应按 I、II、III、IV 型对应 IgE、细胞毒、免疫复合物和迟发型。"],
        "key_points": ["抗体主要由 B 细胞分化的浆细胞产生。", "T 细胞偏细胞免疫，B 细胞偏体液免疫。", "超敏反应题关键是类型和机制对应。"],
        "mistakes": ["混淆体液免疫和细胞免疫。", "只背超敏反应编号，不会对应疾病例子。", "忽略免疫过强和免疫不足都能致病。"],
        "memory": "识别、活化、效应、记忆。",
    },
    {
        "pattern": "药理|药效学|药动学|不良反应|抗感染|心血管|麻醉镇痛药",
        "core": "药理学先问药物作用于哪里，再问身体如何处理药物。药效学看作用和机制，药动学看吸收、分布、代谢、排泄。",
        "steps": ["先判断题目问药效学还是药动学。", "药物选择题抓适应证、禁忌证、不良反应和相互作用。", "抗感染药题要联系病原体、作用靶点和耐药风险。"],
        "key_points": ["药效学回答“药对身体做什么”。", "药动学回答“身体对药做什么”。", "不良反应、禁忌证和特殊人群是高频考点。"],
        "mistakes": ["只背药名，不知道作用机制。", "忽略肝肾功能、妊娠儿童等特殊人群。", "抗菌药题不看病原体和耐药。"],
        "memory": "效学看作用，动学看去向。",
    },
    {
        "pattern": "诊断学|症状|体征|问诊|实验室|影像判断",
        "core": "诊断学不是罗列检查，而是把主诉、现病史、体征和辅助检查连成诊断依据。",
        "steps": ["先抓主诉和时间线：何时开始、如何变化、伴随什么。", "再把阳性体征和阴性体征分开记录。", "最后选择能验证假设的实验室或影像检查。"],
        "key_points": ["问诊要围绕主诉展开，不能散问。", "体征要能支持或排除诊断。", "辅助检查服务于诊断假设，不是越多越好。"],
        "mistakes": ["只报检查项目，不说明为什么查。", "漏掉阴性症状导致鉴别诊断不完整。", "主诉、病史和诊断依据断裂。"],
        "memory": "主诉起头，体征支撑，检查验证。",
    },
    {
        "pattern": "内科学|循环|呼吸|消化|内分泌|泌尿|血液",
        "core": "内科学题要按系统定位，再按病因、病理生理、临床表现、检查和治疗原则展开。",
        "steps": ["先看题干症状定位到循环、呼吸、消化、内分泌、泌尿或血液系统。", "再抓关键危险信号，如胸痛、呼吸困难、出血、少尿、意识改变。", "最后用检查结果确认诊断并选择治疗原则。"],
        "key_points": ["系统定位比背病名更重要。", "急危重症先处理生命危险。", "治疗原则要和病因、严重程度对应。"],
        "mistakes": ["看到单个症状就直接下诊断。", "忽略生命体征和危险分层。", "只背治疗药名，不看禁忌和病情程度。"],
        "memory": "先定位系统，再分轻重，最后定处理。",
    },
    {
        "pattern": "外科学|无菌|创伤|休克|围手术期|感染|肿瘤",
        "core": "外科学重在处理顺序：先保命，再控感染和出血，最后修复功能。无菌和围手术期管理是贯穿所有操作的底线。",
        "steps": ["先评估生命体征、出血、感染和休克风险。", "再按无菌原则完成准备、操作和污染隔离。", "最后交代术后观察、并发症预防和复诊。"],
        "key_points": ["休克处理先恢复循环灌注。", "无菌操作的核心是区分清洁区、污染区和无菌区。", "肿瘤题要关注良恶性判断、分期和治疗原则。"],
        "mistakes": ["操作前不评估全身情况。", "无菌区被污染后继续操作。", "只处理局部，忽略休克、感染扩散等全身风险。"],
        "memory": "先保命，再控污，后修复。",
    },
    {
        "pattern": "妇产|妊娠|分娩|妇科炎症|儿科|生长发育|营养|儿科病",
        "core": "妇儿题强调年龄、孕周和发育阶段。妇产看孕周和母胎安全，儿科看年龄特点、生长发育和用药剂量。",
        "steps": ["先确认对象：孕妇、产妇、新生儿、婴幼儿还是儿童。", "再抓孕周、年龄、症状和危险信号。", "最后选择兼顾安全性和阶段特点的处理。"],
        "key_points": ["妇产题不能忽略母体和胎儿两方面。", "儿科题要用年龄解释表现和处理差异。", "营养、生长发育和感染是高频入口。"],
        "mistakes": ["不看孕周或年龄直接套成人标准。", "忽略胎儿安全或儿童剂量。", "把儿童常见病表现和成人表现混同。"],
        "memory": "妇产看孕周，儿科看年龄。",
    },
    {
        "pattern": "预防医学|流行病学|统计|公共卫生",
        "core": "预防医学题考人群思维：不是只看一个病人，而是看病因、暴露、风险、筛查和干预效果。",
        "steps": ["先判断题目是描述疾病分布、分析危险因素还是评价干预效果。", "再选择合适指标，如发病率、患病率、相对危险度、灵敏度、特异度。", "最后把结论转成公共卫生措施。"],
        "key_points": ["发病率看新发，患病率看现患。", "筛查题常考灵敏度、特异度和预测值。", "公共卫生干预要看人群收益和成本。"],
        "mistakes": ["混淆发病率和患病率。", "看到相关就当因果。", "只算指标，不解释公共卫生意义。"],
        "memory": "先看人群，再算风险，最后做干预。",
    },
    {
        "pattern": "牙体组织|牙周组织|口腔黏膜|颌骨病变|牙体形态|牙列咬合|颌面部解剖|口颌功能",
        "core": "口腔基础题要把结构和功能连起来：牙体、牙周、黏膜、颌骨和咬合关系共同决定疾病表现和治疗边界。",
        "steps": ["先定位结构：牙体、牙髓、牙周、黏膜、颌骨或颌面部。", "再说清正常结构和功能。", "最后把结构异常对应到症状、影像或治疗风险。"],
        "key_points": ["牙体硬组织、牙髓和牙周支持组织要分清。", "咬合关系影响修复、正畸和颞下颌关节问题。", "颌面解剖决定麻醉、拔牙和感染扩散风险。"],
        "mistakes": ["只背结构名，不会联系功能。", "混淆牙周、牙髓和根尖周来源。", "忽略解剖毗邻导致操作风险判断错误。"],
        "memory": "结构决定表现，毗邻决定风险。",
    },
    {
        "pattern": "龋病|牙髓病|根尖周病|修复性治疗|牙周病|牙龈炎|牙周炎",
        "core": "牙体牙髓牙周题最重要的是病变来源和范围。龋病从硬组织破坏开始，牙髓根尖周看感染深度，牙周病看支持组织破坏。",
        "steps": ["先判断疼痛、龋损、牙髓反应、牙周袋和影像表现。", "再区分龋病、牙髓病、根尖周病和牙周病。", "最后选择去腐充填、根管治疗、牙周基础治疗或维护。"],
        "key_points": ["龋病重在病损深度和修复原则。", "牙髓病看冷热刺激、持续痛和夜间痛。", "牙周炎看附着丧失、牙周袋和牙槽骨吸收。"],
        "mistakes": ["把牙髓痛和牙周痛混为一谈。", "只看龋洞，不做牙髓活力和牙周检查。", "治疗选择不对应病变深度。"],
        "memory": "龋看洞，髓看痛，周看袋和骨。",
    },
    {
        "pattern": "儿童口腔|乳牙|年轻恒牙|牙外伤|间隙管理|行为管理",
        "core": "儿童口腔题要按牙龄和配合度来处理。乳牙、年轻恒牙和恒牙治疗目标不同，行为管理决定操作能否完成。",
        "steps": ["先判断年龄、牙列阶段和患牙类型。", "再看病变或外伤是否影响恒牙胚和颌骨发育。", "最后选择保护牙髓、保存间隙、控制龋病和行为引导。"],
        "key_points": ["乳牙治疗要考虑继承恒牙。", "年轻恒牙重视牙髓活力和根尖发育。", "儿童行为管理是治疗计划的一部分。"],
        "mistakes": ["把乳牙当成普通恒牙处理。", "忽略间隙保持和恒牙萌出。", "只考虑技术，不处理儿童恐惧和配合问题。"],
        "memory": "先看牙龄，再护发育。",
    },
    {
        "pattern": "口腔黏膜|溃疡|感染|白色病损|扁平苔藓|白斑|癌前",
        "core": "黏膜病题先看病损形态、部位、疼痛和病程，再判断感染、免疫、创伤还是癌前病变。",
        "steps": ["先描述病损：颜色、形态、边界、能否擦去、是否疼痛。", "再结合病程和诱因做鉴别。", "最后判断是否需要去除刺激、抗感染、免疫调节或活检。"],
        "key_points": ["白色病损要区分能否擦去。", "复发性溃疡重在反复、疼痛和自限。", "白斑属于癌前病变风险管理重点。"],
        "mistakes": ["看到白色病损就直接诊断白斑。", "忽略长期不愈和硬结提示恶变风险。", "不问诱因和复发史。"],
        "memory": "形态、能否擦、病程，是黏膜三问。",
    },
    {
        "pattern": "拔牙|感染|局部麻醉|损伤|囊肿|肿瘤|涎腺|神经疾患|关节病",
        "core": "颌面外科题重在风险评估和处理顺序。拔牙看适应证禁忌证，感染看间隙和扩散，麻醉看神经走行和并发症。",
        "steps": ["先评估全身情况、局部感染、影像和操作风险。", "再选择麻醉、切口、拔除或引流等处理。", "最后交代并发症预防、术后观察和复诊。"],
        "key_points": ["急性感染期、全身疾病和抗凝用药会影响操作。", "颌面间隙感染要警惕扩散和气道风险。", "囊肿肿瘤题要关注影像、病理和边界。"],
        "mistakes": ["不看全身禁忌就安排拔牙。", "感染题只开药，不判断是否需要切开引流。", "忽略下牙槽神经、上颌窦等解剖风险。"],
        "memory": "外科先评估，再操作，后防并发症。",
    },
    {
        "pattern": "修复|牙体缺损|固定义齿|活动义齿|全口义齿|影像|根尖片|曲面体层|口腔预防|社区口腔",
        "core": "修复影像预防题要抓目标：恢复形态功能、看清病变边界、降低人群风险。修复重适应证和设计，影像重表现和定位，预防重危险因素控制。",
        "steps": ["先判断属于修复设计、影像诊断还是预防策略。", "修复题看剩余牙体、牙周条件、咬合和美观需求。", "影像题看密度、边界、位置；预防题看危险因素、氟化物和菌斑控制。"],
        "key_points": ["固定义齿依赖基牙条件和共同就位道。", "活动义齿要考虑支持、固位和稳定。", "口腔预防核心是菌斑控制、氟化物和人群管理。"],
        "mistakes": ["只选修复体类型，不评估基牙和牙周。", "影像只看黑白影，不描述边界和位置。", "预防题只说刷牙，漏掉氟、饮食和定期检查。"],
        "memory": "修复看条件，影像看边界，预防控风险。",
    },
    {
        "pattern": "主动回忆|鉴别表|题干关键词|错因归纳|临考复盘",
        "core": "综合应试训练不是多刷几题，而是把知识变成可提取、可区分、可复盘的答题系统。",
        "steps": ["先用主动回忆写出知识主干，不马上看答案。", "再做相似概念对照，记录区别点和题干信号。", "最后把错题归因到知识缺口、审题错误或记忆混淆。"],
        "key_points": ["主动回忆比反复看材料更能暴露缺口。", "鉴别表要写区别，不要只列相同点。", "错因复盘要能改变下一次答题行为。"],
        "mistakes": ["把复习等同于重看视频。", "错题只抄答案，不分析为什么错。", "临考前继续铺新内容，忽略高频混淆点。"],
        "memory": "先回忆，再鉴别，最后复盘。",
    },
]


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _slug(value: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9._-]+", "_", value.lower()).strip("._-")
    return (slug or fallback)[:64]


def _bundle_segments(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for subtitle in bundle.get("subtitles") or []:
        for segment in subtitle.get("page_segments") or []:
            entries = [entry for entry in segment.get("entries") or [] if _clean(entry.get("content"))]
            if entries:
                segments.append(
                    {
                        "label": _clean(segment.get("label")),
                        "text": "\n".join(_clean(entry.get("content")) for entry in entries),
                    }
                )
    return segments


def _coverage_for(title: str, segments: list[dict[str, Any]]) -> tuple[str, list[str]]:
    title_key = re.sub(r"[：:（）()0-9.、\s]", "", title)
    parts = [part for part in re.split(r"[与和、/：:]", title_key) if len(part) >= 2]
    matched: list[str] = []
    for segment in segments:
        label = _clean(segment.get("label"))
        haystack = re.sub(r"[：:（）()0-9.、\s]", "", f"{label} {segment.get('text', '')[:1800]}")
        if title_key in haystack or any(part in haystack for part in parts):
            matched.append(label)
    return ("covered", matched[:3]) if matched else ("inferred", [])


def _topic_terms(title: str) -> list[str]:
    topic = title.split("：", 1)[-1]
    raw_terms = re.split(r"[、，,；;和与/（）()：:\s]+", topic)
    stopwords = {"医学", "口腔", "综合", "考试", "高频", "考点", "原则", "基础", "管理", "常见", "训练"}
    terms: list[str] = []
    for term in raw_terms:
        term = re.sub(r"(病学|科学|学|法|原则|管理|诊断|治疗|机制)$", "", term.strip())
        if len(term) >= 2 and term not in stopwords:
            terms.append(term)
    return list(dict.fromkeys(terms))


def _teaching_rule_for(title: str, chapter: str) -> dict[str, Any]:
    haystack = f"{chapter} {title}"
    best_rule: dict[str, Any] | None = None
    best_score = -1
    for rule in TEACHING_RULES:
        pattern = str(rule.get("pattern") or "")
        tokens = [part.strip() for part in pattern.split("|") if part.strip()]
        hits = [token for token in tokens if re.search(token, haystack)]
        if hits:
            score = len(hits) * 100 + sum(len(token) for token in hits)
            if score > best_score:
                best_rule = rule
                best_score = score
    if best_rule:
        return best_rule
    topic = title.split("：", 1)[-1]
    return {
        "core": f"{topic} 是这一关要拿下的核心考点。学习时先把定义、适用场景、判断依据和易混边界连起来，而不是只记一个名词。",
        "steps": [
            f"先说清{topic}解决什么问题，适用于什么题干或临床场景。",
            f"再列出{topic}的关键判断点、流程点或答题点。",
            f"最后把{topic}和相近概念做区分，补一个最容易丢分的错误。",
        ],
        "key_points": [
            f"能解释{topic}的核心含义。",
            f"能识别{topic}在题干中的信号。",
            f"能说出{topic}的常见混淆点和排除依据。",
        ],
        "mistakes": [
            "只背词面，不会根据题干判断考点。",
            "把相近概念混成一类，答题缺少排除理由。",
            "只写结论，不写依据和边界。",
        ],
        "memory": f"{topic}：先定场景，再抓依据，最后排混淆。",
    }


def _teacher_ready_content(title: str, chapter: str) -> dict[str, Any]:
    topic = title.split("：", 1)[-1]
    terms = _topic_terms(title)
    term_text = "、".join(terms) if terms else topic
    rule = _teaching_rule_for(title, chapter)
    core = str(rule.get("core") or "").strip()
    core = f"{core} 本关具体要把 **{term_text}** 拆开掌握：先知道各自指向什么，再知道它们在题干或操作里怎么拿分。"
    steps = [str(item).strip() for item in rule.get("steps") or [] if str(item).strip()]
    if terms:
        steps = [
            f"先把本关关键词分清：{term_text}，逐个说出它们对应的场景和判断入口。",
            *steps,
        ]
    key_points = [str(item).strip() for item in rule.get("key_points") or [] if str(item).strip()]
    if terms:
        key_points = [
            f"能分别解释 {term_text} 的含义和答题位置。",
            f"能把 {term_text} 放回病例、操作或选择题题干中定位。",
            *key_points,
        ]
    mistakes = [str(item).strip() for item in rule.get("mistakes") or [] if str(item).strip()]
    if terms:
        mistakes = [
            f"只记住“{term_text}”这些词，没有说出它们各自的判断边界。",
            *mistakes,
        ]
    memory = str(rule.get("memory") or f"{topic}：先定场景，再抓依据，最后排混淆。").strip()
    why_lines = [
        f"先拆关键词，是为了避免把 **{term_text}** 和同章相邻考点混在一起。",
        f"按流程学习，是为了把 **{topic}** 写成有顺序、有依据的得分答案。",
        f"最后查易错点，是为了补上 **{topic}** 的禁忌、边界、鉴别或操作风险。",
    ][: max(1, len(steps))]
    teaching_markdown = "\n".join(
        [
            "## 这一关要学会什么",
            "",
            f"这一关学 **{title}**。{core}",
            "",
            "## 标准操作步骤",
            "",
            *[f"{index}. {step}" for index, step in enumerate(steps, start=1)],
            "",
            "## 每一步为什么重要",
            "",
            *[f"- {line}" for line in why_lines],
            "",
            "## 考试/实操评分点",
            "",
            *[f"- {item}" for item in key_points],
            "",
            "## 常见错误",
            "",
            *[f"- {item}" for item in mistakes],
            "",
            "## 一句话记忆",
            "",
            memory,
        ]
    )
    return {
        "teaching_markdown": teaching_markdown,
        "quiz_question": f"不用看资料，写出{title}的核心判断、两个评分点和一个常见错误。",
        "standard_answer": f"{title}的标准答案要包含：{core} 关键点包括：{'；'.join(item.rstrip('。；; ') for item in key_points[:3])}。常见错误包括：{'；'.join(item.rstrip('。；; ') for item in mistakes[:2])}。",
        "key_points": key_points,
        "common_mistakes": mistakes,
        "memory_hook": memory,
    }


def _node(node_id: str, node_type: str, title: str, order: int, children: list[dict[str, Any]], coverage: str, labels: list[str], chapter: str = "") -> dict[str, Any]:
    scope = f"材料覆盖：{'、'.join(labels)}" if labels else "材料未直接命中：按口腔执业医师考试大纲补足。"
    return {
        "id": node_id,
        "node_type": node_type,
        "title": title,
        "summary": f"围绕{title}建立可考试、可回忆、可迁移的知识单元。",
        "order": order,
        "learning_objectives": [f"说清{title}的核心概念", f"识别{title}的题干信号", f"区分{title}的常见易混点"],
        "teacher_ready_content": _teacher_ready_content(title, chapter or title),
        "dependencies": [],
        "knowledge": {
            "concepts": [{"id": f"concept_{node_id}_01", "name": title, "explanation": f"{title} 是口腔执业医师综合复习中的关键考点。", "evidence": []}],
            "examples": [],
            "checkpoints": [f"能不用原文提示复述{title}的主干。"],
            "common_mistakes": [f"只记住{title}的词面，不会在题干里定位考点。"],
            "source_scope": [scope, f"coverage:{coverage}"],
            "teaching_expansion": [],
            "practical_steps": [],
            "practice_tasks": [f"用 90 秒列出{title}的核心框架和一个易混点。"],
            "transfer_prompts": [f"如果题干换成病例或法规表述，如何判断它在考{title}？"],
            "enrichment_notes": [],
        },
        "children": children,
        "assets": [],
        "gaps": [],
    }


def build_blueprint_course_from_bundle(
    bundle: dict[str, Any],
    *,
    output_dir: str,
    source_id: str,
    source_title: str,
    material_path: str,
    output_path: str | None = None,
) -> dict[str, Any]:
    segments = _bundle_segments(bundle)
    chapters: list[dict[str, Any]] = []
    coverage_items: list[dict[str, Any]] = []
    leaf_count = 0
    for chapter_index, (chapter_title, lesson_titles) in enumerate(BLUEPRINT, start=1):
        children: list[dict[str, Any]] = []
        previous_id = ""
        for lesson_index, lesson_title in enumerate(lesson_titles, start=1):
            leaf_count += 1
            coverage, labels = _coverage_for(lesson_title, segments)
            lesson_id = f"lesson_{leaf_count:04d}"
            lesson = _node(lesson_id, "lesson", lesson_title, lesson_index, [], coverage, labels, chapter_title)
            if previous_id:
                lesson["dependencies"] = [previous_id]
            children.append(lesson)
            previous_id = lesson_id
            coverage_items.append({"node_id": lesson_id, "title": lesson_title, "chapter": chapter_title, "coverage": coverage, "matched_segments": labels})
        chapter = _node(f"chapter_{chapter_index:04d}", "chapter", chapter_title, chapter_index, children, "covered", [], chapter_title)
        chapters.append(chapter)

    text_length = sum(len(entry.get("content") or "") for subtitle in bundle.get("subtitles") or [] for entry in subtitle.get("entries") or [])
    package = {
        "schema_version": "onboard.course-package.v0.1",
        "package_id": _slug(f"{source_id.lower()}_oral_exam_blueprint", "oral_exam_blueprint"),
        "source": {
            "source_type": "audio_transcript",
            "source_id": source_id,
            "title": source_title,
            "creator": "",
            "url": "",
            "language": "zh-CN",
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            "text_length": text_length,
            "notes": f"由音频/字幕原材料和口腔执业医师综合考试蓝图生成；Codex 原材料包：{material_path}",
        },
        "course": {
            "title": "口腔执业医师综合高频考点课程",
            "subtitle": source_title,
            "overall_goal": "把长视频带背材料升级为可主动回忆、可对照解释、可按模块推进的综合考试课程。",
            "target_audience": "准备口腔执业医师或助理医师资格考试的学习者",
            "prerequisites": ["具备基础医学和口腔医学入门概念"],
            "learning_outcomes": ["建立综合考试模块地图", "掌握高频考点和易混点", "能从题干定位知识点", "形成临考复盘清单"],
            "completion_definition": "完成全部关卡，并能按模块复述主干、易混点和题干信号。",
            "estimated_total_minutes": max(240, leaf_count * 8),
        },
        "chapters": chapters,
        "dependency_graph": [],
        "assets": [],
        "gaps": [],
    }
    upgraded = upgrade_course_package_payload(package)
    os.makedirs(output_dir, exist_ok=True)
    final_output_path = output_path or os.path.join(output_dir, f"{source_title}.course-package.json")
    with open(final_output_path, "w", encoding="utf-8") as file:
        json.dump(upgraded, file, ensure_ascii=False, indent=2)

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
    coverage_path = os.path.join(output_dir, f"{upgraded.get('package_id')}.coverage-report.json")
    with open(coverage_path, "w", encoding="utf-8") as file:
        json.dump(coverage_report, file, ensure_ascii=False, indent=2)

    try:
        from course_quality_audit import audit_course_package

        quality_report = audit_course_package(upgraded)
        quality_report_path = os.path.splitext(final_output_path)[0] + ".quality-report.json"
        with open(quality_report_path, "w", encoding="utf-8") as file:
            json.dump(quality_report, file, ensure_ascii=False, indent=2)
    except Exception:
        pass

    return {
        "packagePath": final_output_path,
        "packageId": upgraded.get("package_id"),
        "coveragePath": coverage_path,
        "nodeCount": len(chapters) + leaf_count,
        "coveredCount": coverage_report["covered_count"],
        "inferredCount": coverage_report["inferred_count"],
    }

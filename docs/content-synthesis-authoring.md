# 视界专注学习笔记作者手册

## 定位

视界专注的新主线是理解整篇视频字幕，把信息重新编排、补足和可视化，制作成结构化、章节化、适合学习台逐节阅读的学习笔记，并同步产出章节思维导图。

视频决定内容边界、重点和解读方向；Codex 负责去噪、归纳、重组、适度补全和结构化呈现。目标不是把字幕改写成长文或压缩成总结，而是把视频中的知识组织成用户可以逐节学习、回看和复述的知识树。

## 默认产物

Codex 默认写入：

- `content_draft/synthesis_plan.json`
- `content_draft/work/knowledge_tree.json`
- `content_draft/work/tree_outline.md`
- `content_draft/work/structure_review.md`
- `content_draft/work/source_map.json`
- `content_draft/work/evidence_ledger.jsonl`
- `content_draft/work/editorial_contract.md`
- `content_draft/work/section_dossiers/*.md`
- `content_draft/learning_notes.md`
- `content_draft/work/editorial_review.md`
- `content_draft/work/specificity_review.md`
- `content_draft/work/concept_graph.json`
- `content_draft/chapter_mindmap.md`
- `content_draft/review_exports/quality_audit_report.md`（只读质量审计窗口可选；`latest-readonly-audit.md` 仅作旧兼容）

## 学习笔记交付

软件会直接阅读 `content_draft/learning_notes.md`，并按 Markdown 层级导入学习台。导入器只把适合打开阅读的层级变成学习节点：短材料可以用 `##` 直接作为学习小节；中长材料可以用 `##` 作为大章节、`###` 作为完整小节。用户确认可用后，可以在工作台点击“开始学习”。

入库会生成透明文件：

- `output/knowledge/<标题>.knowledge.md`
- `output/knowledge/knowledge_library.json`

`learning_notes.md` 仍保留在材料包内，后续如需长期收藏，可以再导出为知识库副本。但学习体验以学习台章节为主。

## 章节思维导图交付

`chapter_mindmap.md` 是这次学习笔记的第二个关键产物。它不是另一篇文字版总结，而是一张思维导图或知识树，帮助用户迅速看懂：

- 全文主线从哪里开始。
- 每个章节各自解决什么问题。
- 哪些节点适合回看、复读或继续补充。
- 哪些分支是背景、案例、步骤或边界说明。
- 哪些概念互相依赖、容易混淆或形成判断路径。

章节思维导图优先使用 Mermaid mindmap 或清晰树状大纲，清楚、层级分明、可快速扫读。不要把它写成另一篇正文。

## 写作原则

1. 以视频内容为主体，不把视频当成一个关键词后另写百科文章。
2. 不按字幕逐句压缩；按问题、概念、案例、步骤、误区和结论重组。
3. 可以补充必要背景、定义、步骤和上下文，但补充必须服务于理解视频内容。
4. 正文要适合学习台阅读：层级清楚、块状明确、重点可扫读。
5. 对版本敏感、医学、法律、金融、安全等高风险内容，用轻提示提醒验证。
6. 章节思维导图要服务理解和回看，不要为了消耗算力另写文字地图。

## 推荐结构

一份学习笔记通常包含：

- 标题与一句话总览
- 视频核心问题
- 若材料短或主题集中，直接写少量 `##` 学习小节即可
- 若材料足够长，使用多个 `##` 大章节，每章下安排少量完整 `###` 小节
- 每节的问题、核心解释、具体情境、判断链路和回看抓手
- 必要的对照表、机制卡、案例卡、步骤、误区和边界
- 一张章节思维导图
- 可选：行动清单、延伸问题

结构可以按材料调整，不需要机械模板化。软件不适合很多层级；更细的知识点应留在同一小节内部，用加粗短标题、列表、表格、机制卡、案例卡、步骤或误区边界组织。不能退化成总结文章，也不能因为“总结”丢掉高价值信息。

## 质量线

好的学习笔记应该让用户感觉：

- 没有丢掉视频真正有价值的内容。
- 比直接看字幕更清楚。
- 比普通摘要更有结构和判断。
- 每一节都知道自己在学什么。
- 关键问题被讲完整：不止有观点，还能看见原因、机制、例子、边界和迁移用法。
- 关键概念可以通过表格、卡片、步骤或例子快速回看。
- 章节思维导图和正文彼此能对上。
- 适度补全让内容更可学，但没有喧宾夺主。

## v8 流水线

新主线优先使用 `authoring/codex-goal-content-synthesis-v8.md`。它不是一条更长的提示词，而是一条可恢复的生产状态机：用户复制一次 Goal 入口后，Goal 应自动多轮推进。长材料第一轮先建立知识树、树状大纲、结构复查和 synthesis plan，进入 `knowledge_tree_ready`；第二轮把 topic 挂到知识树节点，建立原文地图、block digest、topic inventory、证据账本和 coverage matrix，进入 `coverage_ready`；第三轮必须按知识树分支回读 blocks，写 `block_reread_ledger.jsonl` 和 `section_dossiers/*.md`，进入 `dossier_ready`；后续轮次每次只深写 1-2 个知识树分支，直到 `learning_notes_ready`。阶段完成不是 Goal 完成；`learning_notes_ready` 的新语义是 `semantic_status=learning_notes_written`，最终是否可导入由软件 validator 按 `validation_contract.json` 写入的 `pipeline_ready` 决定。

v8 只吸收必要的工程层，不把软件变成复杂的多系统工具。用户仍然只需要复制同一个 Goal 入口；复杂阶段由 Codex 在材料包内维护。

核心经验：

- `knowledge_tree.json` 先定义主干、分支、子节点和横向关系，避免正文变成几篇长文章。
- `tree_outline.md` 面向人读，说明每个分支在整棵树中的位置和相邻关系。
- `structure_review.md` 检查上层是否过粗、下层是否过碎、导图是否只是提纲。
- `block_digest/*.md` 再把每个材料块的考点、例子、术语、边界、噪声和处理建议摊开。
- `topic_inventory.json` 负责把全部 block digest 合成可处理的 topic pool，并挂到知识树节点。
- `source_cards/*.jsonl` 和 `evidence_ledger.jsonl` 保留原文细节、例子、边界和表达重心。
- `validation_contract.json` 是每个材料包的机器可读验证合同。新包使用项目 profile 的 resolved snapshot；旧包缺失时由 validator 自动补 legacy contract。v8.2 新包默认 strict：正文厚度、H3 长度、trace、干净正文、ready 分层、`learning_page_plans`、candidate/required `source_cards` 和 `published_claims` 都会进入 deterministic gate。
- `coverage_matrix.json` 负责说明每个高价值 topic 的处理状态，避免无声丢失。
- `block_reread_ledger.jsonl` 证明 Codex 第二阶段真的按章节回读了 blocks，而不是只根据 coverage 摘要写正文。
- `theme_model.json` 负责局部结构，`evidence_ledger.jsonl` 负责血肉，`section_dossiers/*.md` 负责把二者绑定到每个知识树分支。
- `thinness_review.md` 是生产侧自检；真正的工程闸门是 CLI/Electron validator 写出的 `content_draft/review_exports/validation_report.json`。
- 章节数和章节边界不要由 coverage 反向决定；先让 `knowledge_tree.json` 定主干，再让 topic 映射和 `section_dossiers` 反馈哪些地方要拆、要合、要加厚。
- 固定为每个章节生成大量文件容易冗余；材料短时可以合并阶段，但长材料要先保留 block digest、topic inventory、证据层和 coverage matrix，再进入正文写作。
- 学习笔记偏薄时，不要补丁式追加零散段落；应回到 `thinness_review.md` 指向的阶段：coverage、dossier 或对应章节 draft。
- 完整性判断要按题材自适应，而不是硬塞固定案例数或固定字数。工程 sanity check 会从 `validation_contract.json` 读取 profile 阈值，例如医学考试材料会按正文总厚度、H3 中位长度、短 H3 比例和 required topic 数组合判断是否过薄。
- 超过 8 blocks 或 100000 字，或属于考试、医学、教程、操作训练、法规、密集攻略时，第一轮正常停在 `knowledge_tree_ready`，第二轮正常停在 `coverage_ready`，第三轮正常停在 `dossier_ready`，第四轮及之后每次只深写 1-2 个知识树分支。
- 30 万字量级材料不要在同一轮回复里“从当前状态直接跑完整包”。正确做法是同一个 Goal 自动多轮推进，但每轮只过一个阶段闸门；下一轮根据真实文件继续。若某轮 20 分钟内把 coverage、dossier、draft、导图全部标成完成，通常应视为假完成并回退。
- Goal 入口要短，详细流程放在 `codex-goal-content-synthesis-v8.md` 内，避免 `/goal` 前有大段说明导致设置失败。

对中长材料，学习笔记不应只停在框架总论。每个高价值学习小节都应该让读者看到：这个问题为什么重要、视频里对应的具体情境是什么、判断链路如何成立、和相邻概念有什么区别、有哪些误区或边界、以后为什么要回看。小节标题应代表一段完整阅读内容，不要把单个 topic 单独拆成一页。

这些是充分性原则，不是固定模板。Codex 可以根据内容自由选择块形态，但二次编辑时必须确认：高价值小节没有“说一半就停”，正文没有变成单调长段落，也没有出现“完成方式、验收方式、能复述才算完成”这类进度提示。

不要把固定字数当模板。材料越长、主题越密、视频细节越多，`learning_notes.md` 自然应该越厚；材料稀薄时可以更短，但要在 `editorial_review.md` 说明取舍。validator 的长度阈值只是防止假 ready 的 sanity check，不替代质量判断。

章节思维导图也不应只是目录。v8 会先写 `knowledge_tree.json`，最终再演进为 `concept_graph.json`，把概念依赖、易混关系、错误修复路径和回看入口整理进 `chapter_mindmap.md`。

`chapter_mindmap.md` 会在学习台里作为一整条对话消息展示，并由 Markdown/Mermaid 渲染成图，而不是弹出独立窗口。推荐结构是：一张可扫读的全局总图，加上必要的分区或分章图；如果内容很密，可以拆成多张图，但每张图都要在对话流里独立可读，并且保留全局关系。

## v8 质量门槛

不要用“每节至少几个例子、多少字、几个表格”作为质量门槛。v8 使用质性返工理由：

- Groundedness：读者能否看出这一章来自当前材料，而不是通用文章？
- Explanatory depth：是否解释了为什么，而不只是说是什么？
- Learning utility：读者学完能否做判断、操作、复述或迁移？
- Boundary handling：是否保留适用条件、失败情况、版本敏感或争议？
- Coverage integrity：高价值 topic 是否有去向，是否存在无解释缺口？
- Structure fit：内容块是否服务理解，而不是为了满足格式？
- Tree integrity：正文是否保留知识树的父子关系、兄弟关系和跨章连接？
- Voice fidelity：是否保留材料的表达重心和判断强度？

返工时要说清原因，例如“这一章判断正确但缺少原材料情境”“表格只是分类，没有解释因果”“把不确定判断写成确定结论”“操作内容缺少失败处理和验证方式”“coverage matrix 还有高价值 topic 未进入正文”。

## 长文本底座升级

30 万字量级测试后的长期工程路线记录在 `docs/material-package-hardening-roadmap.md`。核心结论：

- `.course_material` 是唯一材料包协议，不迁移到新的 `input/data/src` 目录。
- Codex Goal 是材料包状态机执行代理，不是无限上下文的内容吞吐器。
- 学习台最终只读取干净的 `content_draft/learning_notes.md` 和 `content_draft/chapter_mindmap.md`。
- `source_ref`、`block_id`、raw offset 等追溯信息只进入旁路文件，如 `indexes/source_index.jsonl`、`indexes/node_contexts/`、`indexes/learning_notes_trace.json` 和 `indexes/chapter_mindmap_trace.json`。其中 `source_index.jsonl` 由软件生成，trace map 由 Codex 在最终收口时填写。
- ready 长期拆分为 `pipeline_ready`、`audit_ready`、`release_ready`：validator 只负责防止结构性假完成，只读审计负责发现内容质量风险，最终发布仍需产品或人工确认。

底座升级顺序是：先做 `validation_contract + CLI validator + ready 分层骨架`，再做 `source_index + trace map`、`read-only quality audit`、`golden eval + 300k synthetic test`，然后把 `learning_page_plans`、`candidate/required source_cards` 和 `published_claims` 升为 strict gate。当前测试如果再次出现假 ready，不再优先调提示词，应优先补强底座证据链。

当前 strict 证据链规则：

- `learning_page_plans/`：最终每个可打开学习单位都要有旁路计划，说明目标标题、覆盖节点、使用的 required source cards 和内容槽位。
- `source_cards/candidates/`：coverage 阶段沉淀候选原文素材，至少有 `card_id`、来源引用和候选理由。
- `source_cards/required/`：dossier 阶段冻结最终证据卡，至少有 `card_id`、来源引用、`excerpt` 或 `lock_snapshot_hash`。
- `published_claims/`：正文深写阶段记录已发布判断，至少有 `claim_id`、`target_heading`、`claim/statement` 和 `required_source_card_ids`。
- 学生正文继续保持干净；这些文件只服务于 validator、返工和后续抽检。

CLI validator 可直接运行：

```powershell
cd desktop
npm run validate:material -- "C:\path\to\xxx.course_material"
```

该命令会写入 `content_draft/review_exports/validation_report.json`，并同步 `semantic_status`、`repair_intent`、`blocking_reason_codes` 和 `pipeline_ready` 到根目录 `run_state.json`。

协议底座冒烟可以运行：

```powershell
python src\eval_material_pipeline.py --target-chars 300000
```

该脚本只验证材料包协议和 ready gate，不代表真实视频学习包质量通过。

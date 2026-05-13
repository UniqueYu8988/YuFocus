# ChatGPT 课程总设计师工作流 v1

## 定位

视界专注不是视频摘要工具，也不是运行时 AI 教练。它的核心链路是：

```text
视频 / 字幕 / 音频
-> 软件生成完整原材料包
-> ChatGPT 完整阅读材料并担任课程总设计师
-> Codex 按蓝图和本地材料生成最终课包
-> 软件作为课程展示器和学习台
```

这条链路的重点不是把视频压缩成摘要，而是把视频完整转成可被模型理解的知识空间，再由模型重建更适合学习的课程。

## 角色分工

### 软件

- 抓取 B 站字幕，或调用本地模型转写音视频。
- 生成完整 `*.course_material` 原材料包。
- 导出 ChatGPT 全资源课程工作包。
- 接收 ChatGPT 产出的 `course_blueprint.json`。
- 生成给 Codex 的执行提示词。
- 导入最终 Course Package。
- 展示课程、记录进度、TTS、Obsidian 存档。

### ChatGPT

ChatGPT 是课程总设计师，不是字幕摘要器。

它负责：

- 完整阅读视频材料。
- 判断课程类型和学习对象。
- 设计课程结构、章节顺序和学习路径。
- 识别视频中隐含但必须补足的前置知识。
- 根据内容类型决定每节课的表达形式。
- 规划图表、流程图、对比表、步骤清单、案例、练习。
- 输出 `course_blueprint.json`，作为 Codex 的课程制作蓝图。
- 在同一对话中保留这门课的问答、拓展、重构空间。

### Codex

Codex 是课程工程师和课包制作人。

它负责：

- 读取本地完整原材料包。
- 读取 ChatGPT 产出的蓝图。
- 按每节课的设计规格生成 lessons。
- 将图表、表格、步骤、案例等表达形式写入软件可展示的内容结构。
- 运行 strict 打包器。
- 修复 schema、质量、格式和导入问题。

## 为什么不压缩原材料

本项目当前只处理字幕、转写文本和结构化 block。即使是长视频，文本体积通常仍然在 ChatGPT 可以处理的范围内。提前压缩会带来更大的问题：

- 会把视频材料中用于判断课程结构的细节删掉。
- 容易让课程退化成另一种字幕摘要。
- 会削弱后续在 ChatGPT 对话中追问、拓展和复盘的能力。
- 信息筛选本身需要很强的判断力，早期不应把它做成默认步骤。

因此 v1 策略是：

```text
不筛选内容，只整理结构。
不压缩材料，只约束任务和输出。
```

## ChatGPT 的核心产物

ChatGPT 不直接生成最终课包。它生成 Course Blueprint：

```text
course_blueprint.json
codex_execution_guide.md
optional_notes.md
```

其中 `course_blueprint.json` 是最重要的机器可读契约，包含：

- 课程总体定位。
- `source_genre` 和 `learning_intent`：先判断素材是教程、讲座、访谈、播客、圆桌、纪录片、演示还是混合型，再判断学习目标是技能掌握、概念入门、观点理解、决策参考、人物研究、行业观察、考试备考还是通用学习。
- `course_design_mode`：判断整门课是知识地图、概念训练、语言/语法训练、操作训练、工具工作流、案例推理、考试训练、观点理解还是混合课。
- 学习者假设。
- 课程类型组合。
- 教学策略。
- 章节与小节结构。
- 每章的 `chapter_roadmap`：用于软件顶部“章节地图”按钮的章节级认知地图，不只记录顺序，也记录观点张力、判断转折、常见误解和开放问题。
- 每节课的教学目标、表达形式和 Codex 执行说明。
- 每节课的 `primary_training_action` 和 `training_policy`：明确本节训练理解、识别、分类、解析、改错、产出、操作、配置、排错、诊断、选择、论证还是反思，以及需要哪些正例、反例、近似易混对、改错、迁移、检查点或失败模式。
- 图表与可视化规划。
- 主动回忆与标准答案策略。
- 质量检查标准。
- `topic_inventory`：材料候选主题池和处理结果，标明 full / partial / merged / skipped / noise，防止主题被无声吞掉。长材料要先盘点 20-40 个候选高价值主题，再压缩成课程结构。
- `compression_review`：压缩审查，说明当前 lesson 数是否足够、哪些主题有被过度合并的风险、深度版应如何扩展。
- `design_review`：蓝图自审，包括强项、风险、高密度小节、被否定的备选结构、待核验事实和软件展示需求。

## 课程类型不是模板，而是组合

每节课可以组合多个教学形态：

- `concept_explain`：概念解释。
- `system_map`：体系框架。
- `operation_steps`：操作步骤。
- `tool_config`：工具配置。
- `workflow`：流程理解。
- `troubleshooting`：排错。
- `comparison`：对比辨析。
- `case_analysis`：案例分析。
- `exam_training`：考试训练。
- `strategy`：策略方法。
- `practice_drill`：练习训练。
- `review_synthesis`：复盘整合。

示例：

```text
无菌操作：operation_steps + exam_training + common_mistakes
OpenClaw 配置：tool_config + troubleshooting + workflow
Transformer 入门：concept_explain + system_map + comparison + visual_diagram
```

ChatGPT 的价值在于判断每节课应该使用哪种组合，而不是把所有课塞进同一个固定模板。

还要判断课程是“理解型”还是“训练型”。英语语法课不能只做规则参考表，应明确哪些小节训练识别结构、哪些训练改错、哪些训练句型转换和产出。医学操作课应明确动作顺序、检查点和错误形态。工具/编程课应明确配置、验证和排错。

## 学习机制原则

这些原则要约束 ChatGPT 和 Codex，但不要把课程写成教育学论文。

1. 先建框架，再填细节。
2. 每节课只解决一个主要学习任务。
3. 对操作、配置、流程类内容，步骤优先。
4. 对概念、理论类内容，边界、反例、类比和迁移优先。
5. 对考试、技能考核类内容，评分点、失分点、标准表述优先。
6. 对复杂关系，必须使用表格、流程图、层级图或检查清单降低理解负担。
7. 每节保留主动回忆。
8. 用户回答后展示标准答案、关键点和常见误区，不做运行时智能判分。
9. 字幕只提供知识范围和证据，不应暴露为学生端正文。
10. 课程要像老师讲课，而不是解释制课过程。
11. 蓝图必须自己暴露风险：哪些小节不能写薄、哪些事实需要核验、哪些展示形式当前软件还不够，需要 Markdown 退化方案。
12. 展示形式按学习任务选择，不按领域套模板。医学/考试课可以高频使用表格，但操作仍要步骤；计算机/工具课可以使用代码和架构图，但排错仍要症状、原因、处理。
13. 每节课应有 `format_policy` 和 `teaching_voice`：前者约束展示块选择，后者约束讲课节奏。表格、图示、代码和清单都服务老师讲解，而不是替代讲解。
14. 每章应有 `chapter_roadmap`：它负责把多个小节串成一张 Mermaid 流程图，帮助学生理解顺序、依赖、风险、对比或完成信号；它不是正文，也不是装饰图。优先提供 `map_label/action_tag/risk_tag/output_tag` 等短标签和 `edges` 关系，长解释留给隐藏设计字段或 lesson 正文。对访谈、观点、医学鉴别、工程取舍、排错和案例推理，应尽量加入 `turning_points`、`tension_edges`、`conflict_nodes` 或 `open_questions`，让地图像认知结构，而不只是小节目录。
15. 访谈、播客、圆桌和纪录片不要强行教学化；优先做观点地图、论证链、关键案例、分歧争议、背景语境、迁移启发和反思题。
16. 长材料必须先做主题盘点再切课。60 分钟以上或 3 万字以上材料如果少于 8 节，需要给出强理由；3 小时以上访谈若定位为深度学习，通常应优先考虑 12-24 节，而不是压成导读。
17. 不要为了保持“漂亮主线”牺牲中间推理层。技术机制、组织观察、产品/商业案例、社会观点和个人成长路径如果都是高价值内容，应该拆开承载。
18. 语言/语法、操作、工具、病例和观点课程要有不同训练动作。`primary_training_action` 与 `training_policy` 是防止内容退化成“讲解 + 表格 + 小测”的护栏，不是固定模板。每节 `must_include` 只放 2-3 个核心槽位，避免所有 lesson 复用同一套训练结构。
19. 章节地图必须有章节专属性。不要把同一个全局口号复制到每章；每章要写自己的矛盾、转折、误解或完成信号。

## 展示器优先，而非预制模板优先

未来软件应支持块式课程展示，而不是要求课程都长成同一段 Markdown。

候选展示块：

- `narrative`：正文讲解。
- `key_concept`：关键概念。
- `step_list`：步骤列表。
- `flow_steps`：短标签流程。
- `checklist`：检查清单。
- `comparison_table`：对比表。
- `workflow_map`：工作流/系统流向。
- `decision_tree`：判断树。
- `architecture_diagram`：架构图。
- `mermaid_diagram`：Mermaid 图。
- `code_block`：代码块。
- `code_or_config_walkthrough`：代码或配置走读。
- `formula`：公式。
- `warning`：注意事项。
- `common_mistakes`：常见错误。
- `troubleshooting`：问题、原因、修复。
- `operation_script_table`：动作、口述、检查点三列表。
- `case_answer_template`：诊断、依据、鉴别、处理原则。
- `oral_practice_prompt`：口述、问诊、访谈或排障训练。
- `flashcard`：考官追问或术语卡片。
- `spatial_schematic`：缺少画面时的空间、形态或界面示意。
- `case_example`：案例。
- `practice_task`：练习。
- `active_recall`：主动回忆问题。
- `standard_answer`：标准答案。
- `memory_hook`：一句话记忆。
- `extension`：拓展学习。

ChatGPT 在蓝图里规划这些块。Codex 将它们落实为当前可导入课包，或未来新 Course Package blocks。

## v1 工作流

1. 软件生成完整原材料包。
2. 软件导出 GPT 全资源课程工作包。
3. 用户上传工作包到一个新的 ChatGPT 对话。
4. 用户粘贴 `chatgpt-course-designer-v1.md`。
5. ChatGPT 完整阅读材料，输出 `course_blueprint.json`。
6. ChatGPT 在蓝图中写入 `topic_inventory` 和 `compression_review`：先列候选主题池，再说明哪些主题完整使用、合并、弱化、跳过，明确这是导读版还是深度版。
7. ChatGPT 在蓝图中写入 `course_design_mode`、每节 `primary_training_action` 和必要的 `training_policy`，让 Codex 知道每节到底训练什么。
8. 用户将蓝图保存回材料包。
9. 软件或用户复制 `codex-blueprint-executor-v1.md` 给 Codex。
10. Codex 先做蓝图覆盖审查，并可运行 `python src\coverage_audit.py "<course_material_dir>"`；如果长材料短蓝图有明显风险，先提醒扩展，不要默认执行。
11. Codex 读取蓝图和本地完整材料包，生成最终课包。
12. 软件导入并展示。

## 成功标准

一份合格的 Course Blueprint 应该让 Codex 明确知道：

- 这门课到底教什么。
- 学生为什么需要学。
- 学生会在哪里卡住。
- 每节课该采用什么表达形式。
- 哪些内容要补知识，哪些内容要忠于视频范围。
- 哪些地方需要图表、流程、表格或步骤。
- 每节课如何设计主动回忆和标准答案。
- 如何让最终内容适配视界专注学习台。

它不是课纲摘要，而是 Codex 的课程制作总导演说明书。

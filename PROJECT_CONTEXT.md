# 视界专注项目长期上下文

更新时间：2026-05-24

本文档用于在长会话、上下文压缩、换窗口或阶段性重构后，帮助 Codex 和维护者快速恢复项目方向。后续每次发生产品方向、主流程、核心文件、状态机或兼容策略变化时，都应同步更新本文件。

## 工作根目录

项目根目录固定为：

```text
C:\Users\Yu\AI\视界专注
```

这个项目已经从旧工作区迁出。旧工作区 `C:\Users\Yu\AI\Onboard` 存在路径污染风险；后续工作只以本项目根目录为准，不读取、不引用、不迁移、不依赖旧 Onboard 内容。

开始任何实质工作前，优先确认：

```powershell
Get-Location
git status --short
```

## 当前产品判断

视界专注已经从传统制课路线转向学习笔记路线。

当前产品不是“课程制作工具”，也不是 quiz/standard answer 驱动的教学系统。它更像一个本地优先的学习资料整理工作台：把视频、字幕、本地音频转写得到的材料，经过 Codex Goal 分阶段理解、重组、补足和可视化，形成结构化、章节化、适合逐节阅读和回看的学习笔记。

核心价值来自：

```text
视频 / 字幕 / 本地音频转写
  -> 软件生成 .course_material 学习材料包
  -> Codex Goal 建立知识树和覆盖层
  -> Codex Goal 分阶段深写 learning_notes.md
  -> Codex Goal 生成 chapter_mindmap.md
  -> 只读审计
  -> 用户确认后进入 Electron 学习台
  -> 逐节阅读、回看、复习
```

视频决定知识范围、重点、判断方向和表达重心。Codex 负责去噪、归纳、重组、适度补全和结构化呈现。目标不是压缩字幕，也不是普通总结文章，而是把视频中的知识组织成用户可以逐节学习、回看和复述的知识树。

## 主流程状态机

当前主线提示词是：

```text
docs/prompts/codex-goal-content-synthesis-v8.md
```

v8 的状态语义：

```text
material_ready
  -> knowledge_tree_ready
  -> coverage_ready
  -> dossier_ready
  -> partial_learning_notes
  -> learning_notes_ready
```

阶段含义：

- `material_ready`：软件已生成原材料包，等待 Codex。
- `knowledge_tree_ready`：先建立知识树，明确主干、分支、子节点和跨章关系。
- `coverage_ready`：把 topic 挂到知识树节点，证明材料覆盖和证据去向。
- `dossier_ready`：按知识树分支回读 blocks，写分支材料包。
- `partial_learning_notes`：每轮只深写 1-2 个知识树分支，逐步合并到学习笔记。
- `learning_notes_ready`：生产侧最终学习笔记、章节思维导图、概念图和复查文件齐备。是否可导入学习台要继续看软件 validator 写入的 `pipeline_ready`。
- `learning_notes_ready` 保留为兼容状态名，但新语义应按 `semantic_status = learning_notes_written` 理解：正文和导图已写出，尚未证明可导入。validator 失败时会写 `repair_intent`、`blocking_reason_codes`、`needs_deepening` 等摘要；完整原因在 `content_draft/review_exports/validation_report.json`。

长材料要阶段化推进。不要在一次 Goal 里吞完整 `raw_transcript.txt` 后草草写完。尤其是超过 8 blocks、超过 100000 字，或属于考试、医学、教程、操作训练、法规、密集攻略等密集材料时，应按 v8 分阶段停靠。

30 万字量级材料的当前策略是“单次复制入口，同一 Goal 自动多轮，阶段闸门逐步推进”。生产 Goal 每一轮只推进当前 stage：知识树、coverage、dossier、分支深写、最终收口分别留下可审计文件；阶段完成不是 Goal 完成。若某次运行在很短时间内同时标记 coverage、dossier、draft、导图和 `learning_notes_ready`，应优先视为假完成：检查 `learning_notes.md` 体量、dossier 是否只是清单、`coverage_matrix.json` 是否提前全量 `published`、`self_check.md` 是否只是存在性清单，并回退到 `partial_learning_notes`、`dossier_ready` 或 `needs_deepening`。

2026-05-24 与外部 GPT 讨论后形成的长期底座共识已保存到 `docs/material-package-hardening-roadmap.md`。定稿方向：`.course_material` 是唯一材料包协议；Codex Goal 只是状态机执行代理；最终学生正文保持干净；source refs、trace map、validator、quality audit 全部旁路化；学习台最终只读取 `content_draft/learning_notes.md` 和 `content_draft/chapter_mindmap.md`。下一轮大更新优先顺序是：validator + ready 分层骨架、source index + trace map、read-only quality audit、golden eval + 300k synthetic test，最后才回到内容提示词优化。

ready 需要长期拆分为内部三层：`pipeline_ready` 表示 deterministic validator 通过，只证明工程上不是假完成；`audit_ready` 表示只读质量审计或人工确认没有高风险；`release_ready` 表示产品层允许正式进入学习台。`learning_notes_ready` 以后不应单独等于“可以放心导入”，至少应配合 `pipeline_ready = true`。

2026-05-25 第五阶段底座开始将规则合同化：新材料包生成 `validation_contract.json`，由项目 profile resolved snapshot 派生；旧包在刷新/验证时自动补 `legacy_compatible` contract。桌面端新增可命令行运行的 validator：`cd desktop && npm run validate:material -- "<材料包路径>"`。validator 按 contract 写 `validation_report.json`，并把 `semantic_status`、`repair_intent`、`blocking_reason_codes` 和 `pipeline_ready` 摘要同步回根目录 `run_state.json`。第二步已把新材料包 profile 升为 `v8.2 strict`：`learning_page_plans`、candidate/required `source_cards`、`published_claims` 都是最终导入门禁；旧包不会被静默升级，只用于 legacy 诊断。

2026-05-25 第五阶段第四步把 profile 升为 `v8.3 content-specific strict`：validator 不再只看正文总字数和旁路证据是否齐备，还会扣除通用学习话术、重复复盘模板和跨学习单位高相似句群，计算 `effective_medical_chars`。如果一个段落换到别的 H3 也基本成立，就不能用来补足长材料厚度；真实修复应回到 dossier/source cards/blocks 增加本节专属医学内容。对应失败应进入 `needs_content_rewrite` 或 `needs_deepening`，而不是把 `learning_notes_ready` 当完成。

2026-05-25 第五阶段第三步开始增强 strict 交叉审计：validator 不只检查证据文件存在，还会把 `learning_page_plans` 和 `published_claims` 的 `target_heading` 与最终 `learning_notes.md` 真实学习单位标题对齐；每个最终学习单位都应有 page plan 和 published claim，claim 使用的 required source card 应出现在同一学习单位的 page plan 中。这是为了防止旁路证据对应旧标题、旧草稿或另一套结构。

2026-05-24 第二阶段底座开始加入旁路追溯：软件在材料包生成时写 `indexes/source_index.jsonl`，Codex 在最终收口时写 `indexes/learning_notes_trace.json` 和 `indexes/chapter_mindmap_trace.json`。学生正文仍保持干净，不暴露 block/source/debug；validator 用 trace map 判断长材料是否具备可审计来源链。

2026-05-24 第三阶段底座把只读审计标准产物固定为 `content_draft/review_exports/quality_audit_report.md`，报告开头用 `audit_result: pass | needs_fix | blocked`。软件只在 `pipeline_ready=true` 且审计结果为 `pass` 时视为 `audit_ready=true`；只读审计不修改正文、trace map 或 `release_ready`。

2026-05-24 第四阶段加入 `src/eval_material_pipeline.py`。它生成 30 万字 synthetic `.course_material`，并制造 `valid_ready`、正文过薄、trace 为空、trace 指向未知 block、审计 needs_fix 等 golden cases。该脚本不替代真实视频测试，只用于确认协议底座能挡住假 ready。运行入口：`python src\eval_material_pipeline.py --target-chars 300000`，报告在 `output/evals/synthetic_300k/synthetic_300k_report.json`。

## 核心产物

`.course_material` 内的关键产物：

```text
content_draft/synthesis_plan.json
content_draft/learning_notes.md
content_draft/chapter_mindmap.md
content_draft/work/knowledge_tree.json
content_draft/work/tree_outline.md
content_draft/work/structure_review.md
content_draft/work/source_map.json
content_draft/work/block_digest/
content_draft/work/topic_inventory.json
content_draft/work/source_cards/
content_draft/work/source_cards/candidates/
content_draft/work/source_cards/required/
content_draft/work/learning_page_plans/
content_draft/work/published_claims/
content_draft/work/evidence_ledger.jsonl
content_draft/work/coverage_matrix.json
content_draft/work/block_reread_ledger.jsonl
content_draft/work/section_dossiers/
content_draft/work/drafts/
content_draft/work/thinness_review.md
content_draft/work/editorial_review.md
content_draft/work/specificity_review.md
content_draft/work/concept_graph.json
content_draft/work/self_check.md
content_draft/review_exports/quality_audit_report.md
```

长期底座升级后，还应逐步补充：

```text
blocks/block_manifest.jsonl
indexes/source_index.jsonl
indexes/node_contexts/
indexes/learning_notes_trace.json
indexes/chapter_mindmap_trace.json
content_draft/review_exports/validation_report.json
content_draft/review_exports/latest-readonly-audit.md  # 旧兼容审计文件
```

`learning_notes.md` 是学习台导入的正文。结构合同：

- 一个顶层 `#` 标题。
- 软件只适合少量可打开层级，不适合把知识树的每个 topic 都变成页面。
- 短材料或主题集中材料使用 `compact_notes`：`#` 标题 + 少量 `##` 完整学习小节，不强行分大章。
- 中长材料使用 `chaptered_notes`：`##` 作为大章节，`###` 作为完整学习小节。
- 单个 topic、案例、机制、误区和边界优先放在同一小节内部，用加粗短标题、列表、表格、机制卡或案例卡组织。
- 可打开小节必须是一段完整可读内容，避免“一个 topic 一页”或每次打开只有一小段。
- 导入学习台时不得把 `content_draft/learning_notes.md` 当成可写 JSON 学习包路径；原始 Markdown 必须留在材料包内。
- `source_ref`、`block_id`、raw offset、`debug`、`字幕证据` 等后台追溯信息不得污染学生正文。追溯信息放入 `indexes/source_index.jsonl`、`indexes/node_contexts/` 和 trace map。

`chapter_mindmap.md` 是章节思维导图。它应呈现全局主干、分支、关键子节点、跨章连接、易混节点和回看路径。它未来更适合作为学习台对话流中的一整条图文消息，而不是弹窗里挤成一张乱图。

## 当前主线文件

Python / schema：

```text
src/distiller.py
src/bilibili_api.py
src/audio_fallback.py
src/local_audio_client.py
src/validate_content_synthesis_plan.py
src/schemas/codex_material_package.schema.json
src/schemas/content_synthesis_plan.schema.json
```

文档 / 提示词：

```text
docs/content-synthesis-authoring.md
docs/prompts/codex-goal-content-synthesis-v8.md
docs/prompts/readonly-synthesis-audit.md
PROJECT_CONTEXT.md
README.md
```

Electron / React：

```text
desktop/electron/main.ts
desktop/electron/preload.ts
desktop/src/components/WorkspacePane.tsx
desktop/src/components/CoachPane.tsx
desktop/src/components/CoachChatTimeline.tsx
desktop/src/components/MarkdownRenderer.tsx
desktop/src/lib/knowledgeBriefCourse.ts
desktop/src/types/course.ts
desktop/src/store.ts
```

## 已淘汰的路线

以下路线属于旧方向，不作为新主流程恢复：

```text
course_blueprint
codex_course_plan
course_draft
GPT designer
codex_tasks
START_HERE
after_blueprint
codex-goal-content-synthesis-v7
knowledge_brief.md
chapter_map.md
course-package 打包主线
quiz / standard_answer 驱动的验收主线
lesson 作为产品语言
```

如果代码中仍出现 `CoursePackage`、`lesson`、`quiz_question`、`standard_answer`、`quizzing` 或 `.course-package.json`，应先判断它是不是 Electron 学习台内部兼容层。兼容层可以保留；产品语言、作者流程和新生成链路应使用“学习笔记 / 学习材料包 / 学习包 / 学习档案 / 主动回忆 / 参考回看”。

## 提示词和写作原则

用户特别在意：

- 用引导式流程让 AI 发挥，不把提示词写成大量限制清单。
- 不用固定模板强制填空。
- 不因为“总结”丢掉高价值信息。
- 长材料先知识树、再覆盖、再回读、再分支深写。
- Goal 模式必须阶段化推进。
- 学习内容应结构化、可读，有大章节、小节、小标题、表格、机制卡、案例、误区、边界等自然排版。
- 表格、卡片、步骤和图只在帮助理解时使用，不为装饰而使用。
- 学生正文不暴露后台词，例如 `source`、`block_id`、`debug`、`字幕证据`、`制作过程`。

质量判断看：

- 是否保留当前材料的表达重心和具体例子。
- 是否解释为什么，而不只是说是什么。
- 是否保留边界、例外、误区和使用场景。
- 是否能看出来自当前视频材料，而不是泛泛百科文章。
- 是否让读者能按章节回看、复述、判断或迁移。

## UI 和产品语言

UI 要简单，核心动作是：

```text
生成材料包
复制 Codex Goal
查看学习笔记 / 章节思维导图 / 审计
开始学习
```

用户偏好：

- 平铺、简洁、集中在视野中央。
- 不要太多按钮。
- 不要解释文字过多。
- 工作台围绕材料整理和进入学习台，不围绕复杂制课管理。

当前 UI 语言应优先使用：

```text
学习材料包
整理记录
学习笔记
章节思维导图
学习包
学习档案
当前学习
主动回忆
参考回看
```

旧 JSON 学习包只是学习台内部适配格式。`desktop/src/types/course.ts` 已标注为学习台兼容层；不要把内部字段重新包装成旧产品方向。

## 清理和兼容策略

当前仍处在测试期，失败样例和失败产物可以直接清理，不需要复杂兼容管理。删除或移动前必须确认目标路径位于：

```text
C:\Users\Yu\AI\视界专注
```

不要恢复旧制课文档、旧打包脚本、旧 course blueprint schema、GPT designer 工作区或 v7 prompt。

保留兼容层的原则：

- 能支撑学习台现有状态机即可。
- 不让兼容字段影响产品语言。
- 不让兼容字段重新成为作者流程、提示词流程或生成链路。

## 2026-05-24 第一次学习包测试后的判断

- 首次 v8 测试证明正文内容方向可行，但 `6 个 ## + 26 个 ###` 对学习台来说过碎。
- 结构标准调整为：短材料允许 `compact_notes`，直接用少量 `##` 学习小节；中长材料才使用 `chaptered_notes`，即 `##` 大章节 + `###` 完整小节。
- 生成侧要避免把 coverage/topic 机械升级成 Markdown 可点击层级；topic 可以进入同一小节内部。
- 软件侧必须保护 `content_draft/learning_notes.md`，进入学习台时只能在内存或学习档案中生成 study-package 兼容 JSON，不得覆盖原始 Markdown。
- 本地 Codex skill `shijie-course-builder` 已同步为这一规则；虽然名称仍有历史残留，但当前职责是 v8 学习笔记生产、修复和审计。
- 文件生命周期分工：学习档案删除用于移除学习记录、进度、对话缓存和关联学习包；工作台整理记录的垃圾桶是两段式：已制作时清理 `content_draft` 学习产物并退回 `material_ready`，保留字幕、转写、blocks、indexes、authoring 和 schema；已经是 `material_ready` 且没有学习产物时，再点垃圾桶才真正删除整个 `.course_material` 材料包。
- “当前学习”只表示当前会话真实载入的学习包；本地库里残留或未打开的记录应显示在“其他学习”，不能自动冒充当前学习。

## 验证命令

阶段性完成后运行：

```powershell
python -m py_compile src\bilibili_api.py src\audio_fallback.py src\local_audio_client.py src\distiller.py src\validate_content_synthesis_plan.py
```

```powershell
cd desktop
npx tsc --noEmit
```

常用旧主线扫描：

```powershell
rg -n "course_blueprint|codex_course_plan|course_draft|gpt_designer|codex_tasks|START_HERE|after_blueprint|codex-goal-content-synthesis-v7|knowledge_brief\.md|chapter_map\.md"
```

## 如何更新本文档

当以下内容变化时，更新 `PROJECT_CONTEXT.md`：

- 产品定位或主流程发生变化。
- v8 状态机、产物路径、导入规则发生变化。
- 新增或废弃核心文件。
- UI 产品语言发生系统性调整。
- 旧兼容层被删除、替换或改名。
- 验证命令发生变化。
- 发现容易让后续窗口偏离方向的新风险。

更新时保持本文档短而有判断力：记录长期有效的信息，避免塞入一次性调试细节、临时日志、某个失败样例的大段内容或过时实现猜测。

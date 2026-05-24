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
- `learning_notes_ready`：全部高价值分支通过结构复查、薄度复查和具体性复查，可导入学习台。

长材料要阶段化推进。不要在一次 Goal 里吞完整 `raw_transcript.txt` 后草草写完。尤其是超过 8 blocks、超过 100000 字，或属于考试、医学、教程、操作训练、法规、密集攻略等密集材料时，应按 v8 分阶段停靠。

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
content_draft/review_exports/latest-readonly-audit.md
```

`learning_notes.md` 是学习台导入的正文。结构合同：

- 一个顶层 `#` 标题。
- `##` 作为主章节。
- `###` 作为学习小节。
- 主章节下应有有意义的子节点，避免退化成“每章只有一节”的长文。

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

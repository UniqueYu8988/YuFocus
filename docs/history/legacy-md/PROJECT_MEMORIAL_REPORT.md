# 视界专注软件纪念报告

更新时间：2026-05-25

本文是“视界专注”从本地学习软件、制课实验、v8 学习笔记流水线，到 v9 学习页对象模型探索，再到决定重新审视 NotebookLM 前置工具定位之前的一份纪念文档。

它不是新的开发计划，也不是验收清单。它记录这段软件制作过程里真正发生过的判断、挣扎、清理、试验和转向。后续如果项目继续前进，它可以作为一份旧路线的收束报告；如果项目换成新的形态，它也能说明我们为什么走到了这里。

## 一句话结论

视界专注曾经试图成为一个从视频字幕自动生成高质量学习包的软件。我们把它从旧“制课”体系中救出来，重建成学习笔记流水线，又继续向“学习页知识工程”推进。但在真实测试中，我们逐渐意识到：如果目标是像 NotebookLM 那样完成深度理解、多形态展示、对话学习和导图生成，本地软件正面复制这条路线会受到算力、模型能力、上下文稳定性和产品复杂度的共同限制。

这不是简单失败，而是一次边界被看清的实验。

软件最有价值的部分，可能不再是“替代 NotebookLM 生成最终学习内容”，而是成为它之前的资料工程台：提取视频、转写音频、清理字幕、保留时间戳、整理章节、导出干净而高质量的 NotebookLM-ready source package。

## 项目最初的混乱

项目从旧工作区迁出后，第一件重要的事不是写新功能，而是确认根目录。

项目根目录被固定为：

```text
C:\Users\Yu\AI\视界专注
```

旧工作区存在路径污染风险。我们反复确认不能再读取、引用、迁移或依赖旧工作区。这个动作看起来朴素，但它代表了后来整个项目的一种气质：先把边界理清，再谈智能。

当时项目里仍残留大量旧制课语言和历史文件：

```text
course_blueprint
codex_course_plan
course_draft
GPT designer
codex_tasks
START_HERE
v7 prompt
course-package
quiz
standard_answer
lesson
```

这些词并不只是文件名问题。它们代表另一套产品想象：做课程、做题、验收标准答案、打包课件。用户已经明确不想继续这条路，因为传统制课涉及教学设计、题目设计、验收机制和知识正确性，它们都太重、太不稳定，也太容易把 AI 限制成机械填表。

于是项目第一次真正的方向清理发生了：从“制课工具”转向“学习笔记工作台”。

## 第一次重建：v8 学习笔记流水线

v8 的核心判断是：

```text
视频 / 字幕 / 本地音频转写
  -> 软件生成 .course_material 原材料包
  -> Codex Goal 分阶段理解和重组
  -> 生成 learning_notes.md
  -> 生成 chapter_mindmap.md
  -> Electron 学习台逐节阅读
```

这个阶段最重要的变化，是我们不再让 AI 一口气吞完整字幕，然后吐出一篇总结文章。我们逐渐形成了一套阶段化状态机：

```text
material_ready
  -> knowledge_tree_ready
  -> coverage_ready
  -> dossier_ready
  -> partial_learning_notes
  -> learning_notes_ready
```

它背后的产品判断很清楚：

- 长材料不能一次性处理。
- 先搭知识树，再谈覆盖。
- 先证明 topic 有去向，再写正文。
- 深写必须回读 blocks。
- 阶段完成不是 Goal 完成。
- `learning_notes_ready` 也不等于可以放心导入。

这是项目第一次从“提示词魔法”走向“材料包协议”。`.course_material` 变成了项目的核心边界。

## 清理基线

项目在 2026-05-25 建立了一次重要基线提交：

```text
2bcbb36 cleanup: establish v8 learning-notes pipeline baseline
```

这次基线的意义不在于某个单点功能，而在于把项目从旧 course-package 方向中彻底切出来。它确认了当前主线文件：

```text
src/distiller.py
src/bilibili_api.py
src/audio_fallback.py
src/local_audio_client.py
src/validate_content_synthesis_plan.py
docs/content-synthesis-authoring.md
docs/prompts/codex-goal-content-synthesis-v8.md
docs/prompts/readonly-synthesis-audit.md
desktop/electron/main.ts
desktop/src/components/WorkspacePane.tsx
desktop/src/lib/knowledgeBriefCourse.ts
```

从那一刻起，项目不再试图恢复旧制课文档，不再恢复 GPT designer，不再恢复 quiz 和 standard_answer 作为主流程。

这是一次软件层面的断舍离。

## 学习台的现实问题

第一批测试证明，AI 能生成看起来像学习资料的内容，但学习台不是普通 Markdown 阅读器。

最早的学习包出现过一个问题：结构被拆得太碎。章节名、小节名都过细，每次打开只看到一小段。用户希望的是：

```text
打开一个章节
  -> 看到一组连贯的小标题
  -> 每个小节像一段完整学习内容
```

于是我们形成了一个重要 UI 约束：

- 软件不适合很多层级。
- 只保留大章节和小节就够了。
- 材料短时甚至不需要大章节。
- topic 不应机械升级成可点击页面。

这条约束后来一直影响 `learning_notes.md` 的结构合同。

## 文件生命周期的修复

项目一度出现学习档案、工作台、侧边栏状态不同步的问题。删除学习档案后，侧边栏仍然残留课程；工作台清理后，旧学习包还能被恢复。

这暴露出一个很重要的本地软件问题：内容生成不是唯一难点，文件生命周期同样是产品体验的一部分。

后来我们明确了两种删除语义：

- 在学习档案里删除：移除学习记录、进度、对话缓存和关联学习包。
- 在工作台里删除：如果已制作学习包，清理 `content_draft` 并退回待制作状态，保留字幕、转写、blocks、indexes 和 authoring。
- 如果已经是待制作状态，再删除才真正删除整个 `.course_material` 材料包。

这个规则很符合用户的洁癖：失败产物可以清理，但原材料不要轻易丢。

## 大文本测试与假完成

项目真正进入深水区，是 27 万字、30 万字量级材料测试。

测试结果非常刺眼：有些 Goal 看起来完成了，状态也写到了 `learning_notes_ready`，甚至生成了正文、导图、concept graph，但内容实际上非常薄。20 分钟跑完几十万字材料这种现象，让我们意识到一个事实：

```text
AI 声称完成，不等于材料真的被处理完。
```

于是项目开始补强底座，而不是继续只调提示词。

这一阶段陆续加入了：

```text
validation_contract.json
pipeline_ready / audit_ready / release_ready
source_index.jsonl
learning_notes_trace.json
chapter_mindmap_trace.json
quality_audit_report.md
eval_material_pipeline.py
strict evidence gates
published_claims
required source cards
learning_page_plans
anti-boilerplate gate
effective_medical_chars
```

关键提交包括：

```text
fe01e93 refactor: add learning-notes validation gates
79bc98c refactor: add material source trace scaffolding
a3e1f22 refactor: standardize readonly quality audit gate
33236ac test: add synthetic material pipeline eval
a2ca818 refactor: add validation contract gate
92020a9 refactor: enforce strict evidence gates
6151e2a refactor: cross-check strict evidence targets
ce3aeb6 refactor: add content-specific anti-boilerplate gate
```

这些提交的共同目标，是挡住“假 ready”。

项目从这里变得更像一个协议系统：AI 可以写内容，但软件必须有能力判断它是不是在糊弄。

## 内容质量的天花板

随着 validator 越来越强，坏结果被挡住了，但另一个问题变得更清楚：即使工程上通过，内容也常常只是“更易读的字幕重排”。

它比原始字幕连贯，也比普通摘要保留更多信息，但仍不够像理想学习材料。

用户指出过一个非常关键的问题：

```text
内容确实比原来长了，也更通顺，
但像是把字幕变成流水线文章，
不是深度思考后的知识材料。
```

这个判断让项目进入第二次产品想象转变。

如果 v8 解决的是“不要假完成”，那么下一步要解决的是：

```text
不要只是把字幕写顺。
```

## v9 的诞生：学习页对象模型

v9 的核心句子是：

```text
围绕字幕建立可学习的知识工程。
```

它试图把生产链路改成：

```text
字幕范围
  -> 知识树
  -> 高颗粒度知识节点
  -> 学习页计划
  -> 组件化学习页
  -> 章节导图和复习入口
```

v9 不再把 `learning_notes.md` 当作连续文章集合，而是把它看成一组学习页。每一页都应该围绕学习任务展开：

- 视频核心
- 知识骨架
- 机制卡
- 判断卡
- 易错边界
- 对比表
- 题干演练
- 主动回忆
- 外部补强票据

我们还提出过一个很重要的“AI 指导 AI”方案。生产窗口不再只是作者，而像一个小型编辑部：

- 总编负责章节结构和页面形态。
- 采编负责提取细颗粒知识节点。
- 研究员负责提出外部补强问题。
- 作者负责按页面计划写学习页。
- 审稿人负责检查是否只是字幕改写。

这一阶段落地了：

```text
docs/learning-page-object-model-v9.md
docs/samples/v9-learning-page-sample-abscess-drainage.md
docs/prompts/codex-goal-learning-page-v9-preview.md
src/schemas/knowledge_nodes.schema.json
src/schemas/learning_page_plan.schema.json
```

它是项目最接近“理想学习体验”的一次设计。

## v9 的真实测试

v9 preview 的第一次小视频测试选择了一个较短材料：

```text
【睡前消息1057】CNN创始人特纳去世 直播产业的祖师走了
```

结果很有代表性。

工程上，它通过了：

```text
stage = learning_notes_ready
pipeline_ready = true
importable = true
validator = passed
errors = 0
warnings = 0
```

但按 v9 要求，它没有通过：

```text
pipeline_variant 为空
knowledge_nodes.json 缺失
page_dossiers/ 缺失
page_drafts/ 缺失
learning_page_plans 不含 primary_nodes
learning_page_plans 不含 learner_goal
正文仍是 5 个 ## 章节的连贯长文
```

它说明一件事：我们已经有能力生成合格 v8 学习笔记，但还没有真正让“AI 指导 AI”的 v9 链路稳定发生。

这是一个很诚实的测试结果。

## NotebookLM 带来的转向

在讨论理想软件形态时，NotebookLM 进入视野。

它与用户想象高度重合：

- 能接收资料。
- 能围绕资料对话。
- 能生成学习辅助内容。
- 能生成导图、报告、音频概览等多形态结果。
- 背后有强大的模型和算力。

这迫使项目面对一个新判断：

```text
如果最终目标是做一个类似 NotebookLM 的深度学习工作台，
视界专注即使做得很努力，也可能很难正面达到同等上限。
```

这不是否定前面的工作。恰恰是前面的工作让我们看清了什么难、为什么难、难在哪里。

难点不只是 UI，也不只是提示词，而是：

- 长上下文理解。
- 多轮稳定接力。
- 深度知识组织。
- 多形态展示。
- 对话式学习。
- 证据追溯。
- 大模型算力。
- 产品闭环。

当这些都合在一起时，本地软件不适合正面复制 NotebookLM。

## 新的可能定位

项目新的可能定位是：

```text
视界专注 = NotebookLM 前置资料工程台
```

它不再承担最终学习内容生成的全部责任，而是负责把混乱视频材料整理成高质量输入：

```text
视频 / 本地音频 / B 站 BV
  -> 字幕提取
  -> 本地转写
  -> 去噪
  -> 分段
  -> 保留时间戳
  -> 章节化
  -> 导出 NotebookLM 友好的资料包
```

这条路线保留了项目已经积累的真实价值：

- B 站 BV 输入。
- 本地音频转写。
- 字幕清洗。
- blocks 和 source index。
- 时间戳和来源追踪。
- 资料包生命周期管理。
- 用户对干净输入的洁癖。

它也避开了最吃力的部分：本地软件不再试图用 Codex Goal 与 NotebookLM 的后端能力正面竞争。

这可能是一条更轻、更稳、更有长期价值的路线。

## 这一路真正留下的东西

即使旧路线停止，它也留下了许多值得保留的判断。

第一，材料边界很重要。  
AI 不能凭空写学习材料，必须知道资料从哪里来、覆盖到哪里、哪些是原文、哪些是补充。

第二，阶段化很重要。  
长材料不能靠一次 prompt 解决。知识树、覆盖、证据、写作和审计应分开。

第三，文件生命周期很重要。  
失败产物要能清理，原材料要能保留，学习记录和工作台状态不能互相污染。

第四，用户体验不等于功能堆叠。  
用户喜欢平铺、简洁、集中、少按钮、少解释。一个软件真正舒服，不是因为功能多，而是因为它让人知道下一步该做什么。

第五，AI 需要被管理，而不是被祈祷。  
提示词能引导 AI，但软件必须有旁路证据、状态机和验证器，来约束它不要假装完成。

第六，承认边界也是产品能力。  
当 NotebookLM 已经更适合承担最终学习工作台角色时，视界专注不应该为了自尊去复制它，而应该找到自己更锋利的位置。

## 给旧路线的留影

曾经的视界专注想做一件很难的事：

```text
把一个视频变成一份真正适合学习的材料。
```

它不是简单下载字幕，也不是普通总结。它试图理解视频的知识范围、老师的解读方向、例子、边界、误区和关系，再把这些整理成结构化学习包。

在这个过程中，我们清理了旧制课路线，拆掉了 quiz 和 standard_answer 的框架，建立了 `.course_material` 协议，写了 v8 prompt，跑过 30 万字测试，设计过 validator，做过只读审计，和外部 GPT 反复讨论文件架构，也手工写过 v9 学习页样张。

它有过很多笨重的时刻：状态不干净、按钮不对、旧学习包复活、复制失败、Goal 草草结束、validator 不够强、正文太薄、内容像流水线文章。

但这些问题不是白走的弯路。每一个问题都把软件从幻想里往现实里拉了一点。

最后，我们看见了一件事：

```text
也许视界专注不该成为最终的学习大脑。
它更适合成为干净、可靠、克制的资料前处理器。
```

这个判断并不寒酸。很多好软件不是最大的软件，而是在一条工作流里把一个前置环节做到极稳、极干净、极省心。

## 如果未来继续

如果未来继续开发，旧路线可以作为“学习包生成实验”保留，但不应再作为唯一主线。新的主线可以从更小、更确定的价值开始：

```text
输入 BV 或本地音频
  -> 得到干净字幕
  -> 得到章节化 Markdown
  -> 得到 NotebookLM source brief
  -> 得到带时间戳的来源索引
  -> 得到可导入外部学习工具的资料包
```

旧 v8/v9 的思想仍然有用，但它们应服务导出质量，而不是强行承担最终学习体验。

可以保留的精神是：

- 对文件边界的洁癖。
- 对旧路线污染的警觉。
- 对 AI 假完成的不信任。
- 对学习材料结构的审美。
- 对用户工作流简单性的坚持。

## 结束语

视界专注这段路线没有真正走通，但它走得很认真。

它不是从一开始就知道自己要成为什么。它是在一次次清理、测试、失败、修正和讨论里，慢慢把自己的边界摸出来。

如果说这份软件有什么值得纪念，不是因为它已经做出了完美学习台，而是因为它诚实地经历了一次现代 AI 软件很典型的旅程：

```text
先相信 AI 能完成一切，
再发现 AI 需要流程，
再发现流程需要验证，
再发现验证挡不住体验天花板，
最后承认最好的产品位置可能不是替代巨头，
而是成为巨头之前那个干净、可靠、让人省心的入口。
```

这份报告写到这里，旧路线可以安静地收束。

如果未来有新版本，它不必背负“我要成为 NotebookLM”的重量。它只需要回答一个更具体的问题：

```text
怎样把一个混乱的视频，变成最适合进入下一台学习机器的干净资料？
```

这也许才是视界专注真正适合发光的地方。

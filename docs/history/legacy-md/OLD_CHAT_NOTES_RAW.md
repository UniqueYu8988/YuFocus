已按你的要求只做只读检查，没有修改代码。当前目录确认是：

```
C:\Users\Yu\AI\视界专注
```

`git status --short` 为空，工作区干净。

**一、由当前仓库文件 / 代码证实的信息**

1. 项目当前定位
   代码和文档显示，项目已经从旧“课程 / 学习包 / Codex Goal 深写”转向：

   - 长视频 / 本地视频：字幕提取、音频转写、字幕清洗、导出 NotebookLM 可导入资料。
   - 短视频：字幕清洗后调用 MiMo API 自动生成视频精读稿，并进入专注、档案、灵犀、邮件链路。

2. 当前已经实现的功能
   当前仓库中能看到这些模块：

   - B 站视频来源、关注源、最近视频读取：`desktop/electron/bilibiliSourceApi.ts`
   - 收藏来源管理：`desktop/electron/pinnedSourcesStore.ts`
   - 24 小时新视频发现：`desktop/electron/sourceDiscovery.ts`
   - 任务队列：`desktop/electron/workbenchQueue.ts`
   - 固定并发队列执行：`desktop/electron/queueExecutor.ts`
   - 后台自动化控制：`desktop/electron/automationController.ts`
   - 系统托盘 / 关闭隐藏：`desktop/electron/windowController.ts`
   - 字幕清洗与短视频编稿核心：`src/distiller.py`
   - MiMo 文稿模型配置：`desktop/electron/settings.ts`
   - SMTP 邮件发送：`desktop/electron/smtpEmail.ts`
   - 精读稿邮件推送：`desktop/electron/emailPush.ts`
   - 档案记录：`desktop/electron/learningLibraryStore.ts`
   - 灵犀资料索引：`desktop/electron/knowledgeLibrary.ts`
   - NotebookLM 导出资料：`src/distiller.py`、`README.md`
   - 流程透明页：`desktop/src/components/WorkflowPane.tsx`

3. 当前数据保存位置
   代码显示：

   - 默认输出根目录：`C:\Users\Yu\AI\视界专注\output`

   - 材料目录：`output\materials\*.course_material`

   - 设置文件：Electron `userData` 下的 `.shijie-focus.local.json`

   - 窗口状态：Electron `userData` 下的 `.shijie-focus.window.json`

   - 运行日志：Electron `userData` 下的 `.shijie-focus-runtime.log`

   - ```
     .course_material
     ```

      内部核心文件包括：

     - `raw_transcript.txt`
     - `content.md`
     - `exports/notebooklm.md`
     - `indexes/source_index.jsonl`
     - `summary/article.md`
     - `summary/article.html`
     - `summary/cards.json`
     - `summary/review.json`
     - `summary/summary_status.json`
     - `metrics.json`

4. 第三方服务与敏感信息
   当前项目涉及：

   - B 站 `SESSDATA`
   - MiMo API key
   - MiMo 文稿模型，默认 `mimo-v2.5-pro`
   - MiMo / MiniMax TTS 配置
   - QQ / SMTP 邮箱授权码
   - 本地 SenseVoice 转写路径
   - Obsidian vault 路径

   当前没有看到传统数据库。主要是本地文件、Electron Store、JSON、Markdown、HTML。

5. 已经放弃的旧方案
   当前文档明确写明已退出默认链路：

   - Codex Goal 长视频深写
   - v8 / v9 学习页实验
   - content_draft / coverage / dossier / validator 工作区
   - course-package 打包
   - quiz / standard_answer 验收
   - 课程制作 / 制课产品语言
   - Mermaid / KaTeX / Cytoscape 默认渲染链路

6. 重要技术选择及原因
   仓库文件能证实这些选择：

   - 保留 `.course_material`，但语义改成轻量资料目录，而不是 Codex Goal 工作区。
   - 手动 BV 默认偏向字幕清洗和 NotebookLM 导入。
   - 收藏来源 / 关注源视频默认进入短视频编稿流水线。
   - 队列并发由代码固定配置接管，不再让用户自由调。
   - 同一 BV 在队列中去重。
   - 关闭窗口后可后台运行，前端不应成为任务执行的必要条件。
   - HTML 作为邮件和阅读展示格式，Markdown 作为源稿和兜底格式。

7. 当前危险或混乱区域
   从文件结构和文档看，风险区域主要是：

   - `src/distiller.py`：字幕清洗、MiMo 调用、编稿、HTML、metrics 都集中在这里，职责仍然偏重。
   - `desktop/src/components/WorkspacePane.tsx`：虽然已拆分很多子组件，但仍是主要状态容器。
   - `desktop/electron/main.ts`：已大量拆分，但仍是模块装配中心，改动要谨慎。
   - 兼容层：`desktop/src/types/course.ts`、`desktop/src/lib/learningNotesStudyPackage.ts` 等仍有旧 course / lesson 结构，容易误导新对话。
   - 文档层：`PROJECT_CONTEXT.md` 目前承担太多职责，容易和未来的新工作流文档重复。

**二、仅来自对话记忆、仍需新对话验证的信息**

1. 项目最初为什么创建
   记忆中，项目最初是为了把视频、字幕、本地音频转换成结构化学习资料。后来尝试过课程制作、学习笔记、知识树、学习页，最终转向“视频资料清洗 + NotebookLM 前置 + 短视频摘要自动化”。

2. 已知无法正常工作的功能
   当前没有做运行时复测，所以不能断言现在仍坏。历史上出现过：

   - 删除档案后侧边栏仍残留旧内容。
   - 工作台状态与本地文件不同步。
   - 学习包被清理后仍能被恢复。
   - 精读稿阅读弹窗曾出现 “high risk” 报错。
   - 复制路径 / 复制内容曾因 Electron clipboard 调用失败。
   - 队列曾经重启后重复加入大量任务。
   - 并发曾经超过预期。
   - 长视频 Goal 产物曾经显示 ready，但内容质量很差。

   这些有些后来修过，但新对话不能假设已经全部正常。

3. 曾经尝试但失败或放弃的方案
   历史对话中尝试过：

   - 旧课程制作路线。
   - v8 Codex Goal 学习笔记流水线。
   - v9 学习页对象模型。
   - 大文本 20 万到 30 万字完整深写。
   - 严格 validator / trace / evidence gate。
   - 用本地软件正面复制 NotebookLM 式学习系统。

   放弃原因主要是：成本太高、Goal 接力不稳定、内容容易变成字幕重排、长文本质量不可控、NotebookLM 已经更适合承担深度学习工作台角色。

4. 你明确提出过的重要需求
   这些来自历史对话，需要新对话继续尊重：

   - 不碰 `C:\Users\Yu\AI\Onboard`。
   - 不恢复旧制课路线。
   - 不让旧 course / lesson / quiz 语言污染新产品。
   - 软件要简洁、集中、少按钮、少解释文字。
   - 长视频主要做清洗和 NotebookLM 导入。
   - 短视频摘要要轻量、清楚、可读，不要为了精品感写得过长。
   - 自动跟踪收藏 UP，定时或手动检查 24 小时内新视频。
   - 同一视频不能重复制作。
   - 队列最多 3 个完整任务并行。
   - 邮件推送要像日报一样易读。
   - 希望建立长期规范化工作流，方便多个项目都能被 AI 稳定维护。

5. 仍未完成的事项
   从对话和当前文档看，下一批未完成重点是：

   - 把 `PROJECT_CONTEXT.md` 等旧约定性 MD 系统迁移到新的工作流文档体系。
   - 新建或整理 `AGENTS.md`、`PROJECT_BRIEF.md`、`PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md`、`ROADMAP.md`、`DECISIONS.md`、`HANDOFF.md` 等。
   - 系统验证当前短视频摘要链路是否真的稳定。
   - 验证字幕清洗稿导入 NotebookLM 的实际质量。
   - 降低短视频摘要篇幅和 token 消耗。
   - 继续拆分 `src/distiller.py`。
   - 明确 `.course_material` 是否长期保留，还是未来改成更中性的目录后缀。
   - 建立更清晰的任务验收清单和回退方式。

6. 只是讨论过、未确认真正实现的内容
   这些不能当成已完成：

   - 多项目统一工作流模板完全落地。
   - 本地小模型分担简单任务。
   - 多视频日报合刊。
   - 邮件定时批量日报，而不是单篇推送。
   - NotebookLM 专属导出通道的最终形态。
   - 轻量摘要的新提示词体系是否已经达到理想效果。
   - 效率观测 UI 是否完整展示 token / 时间 / 产出比。
   - 所有旧 v8/v9 兼容残留是否彻底清完。

7. 新对话最容易误解的地方
   最危险的误解有这些：

   - 看到 `.course_material` 就以为还要恢复 Codex Goal 学习包。不要。
   - 看到 `CoursePackage`、`lesson`、`standard_answer` 就以为产品仍是课程系统。不是，它们只是兼容层。
   - 看到 `PROJECT_MEMORIAL_REPORT.md` 就把旧路线当当前计划。它只是纪念文档。
   - 看到 `PROJECT_CONTEXT.md` 很长，就认为所有内容都与当前代码完全一致。不能这样假设。
   - 认为短视频精读稿应该越详细越好。现在方向是更轻、更快、更适合了解新视频内容。
   - 认为长视频也要总结。当前更合理的是长视频清洗后交给 NotebookLM。
   - 认为后台自动化完全生产级稳定。需要真实测试验证。
   - 认为历史讨论等于代码事实。新对话必须先读代码和现有文档再行动。

**给新项目改造对话的第一步建议**

先不要写功能代码。第一步应该是“文档工作流迁移”：

1. 读取 `PROJECT_CONTEXT.md`、`README.md`、`docs/cleanup-baseline.md`、`docs/system-optimization-audit.md`。
2. 只做 Markdown 重组。
3. 建立新的长期工作流入口。
4. 明确哪些文档是当前执行依据，哪些只是历史记录。
5. 再进入代码清理或功能调整。
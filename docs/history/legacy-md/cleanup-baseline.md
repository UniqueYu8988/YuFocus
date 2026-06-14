# 清理基线

更新时间：2026-06-12

本文是当前系统优化工程的 Phase 1 基线。它记录哪些文件属于当前主线，哪些是兼容层，哪些已经退出默认生产，避免后续重构时把旧路线误恢复。

## 当前主线

后端主线：

```text
src/distiller.py
src/bilibili_api.py
src/audio_fallback.py
src/local_audio_client.py
src/config.py
src/check_editorial_email_contract.py
```

桌面端主线：

```text
desktop/electron/main.ts
desktop/electron/preload.ts
desktop/electron/appLifecycle.ts
desktop/electron/automationController.ts
desktop/electron/automationRuntime.ts
desktop/electron/backendRuntime.ts
desktop/electron/dialogHandlers.ts
desktop/electron/bilibiliSourceApi.ts
desktop/electron/emailPush.ts
desktop/electron/knowledgeIpcHandlers.ts
desktop/electron/knowledgeLibrary.ts
desktop/electron/learningArchive.ts
desktop/electron/learningLibraryIpcHandlers.ts
desktop/electron/learningLibraryRuntime.ts
desktop/electron/learningLibraryStore.ts
desktop/electron/materialDeletion.ts
desktop/electron/materialIpcHandlers.ts
desktop/electron/materialStats.ts
desktop/electron/materialInventory.ts
desktop/electron/materialRecordBridge.ts
desktop/electron/obsidianIpcHandlers.ts
desktop/electron/obsidianCli.ts
desktop/electron/obsidianExport.ts
desktop/electron/pathSafety.ts
desktop/electron/pinnedSourcesStore.ts
desktop/electron/queueExecutor.ts
desktop/electron/runtimeLogger.ts
desktop/electron/runtimePaths.ts
desktop/electron/runtimeStores.ts
desktop/electron/settings.ts
desktop/electron/settingsAutomationIpcHandlers.ts
desktop/electron/settingsRuntime.ts
desktop/electron/sourceIpcHandlers.ts
desktop/electron/sourceDiscovery.ts
desktop/electron/sourceDiscoveryRuntime.ts
desktop/electron/smtpEmail.ts
desktop/electron/systemIpcHandlers.ts
desktop/electron/studyPackageCompat.ts
desktop/electron/ttsIpcHandlers.ts
desktop/electron/ttsService.ts
desktop/electron/windowController.ts
desktop/electron/windowIpcHandlers.ts
desktop/electron/windowStateStore.ts
desktop/electron/workbenchQueue.ts
desktop/electron/workbenchQueueIpcHandlers.ts
desktop/electron/workbenchQueueStore.ts
desktop/electron/workflowDocuments.ts
desktop/src/components/WorkspacePane.tsx
desktop/src/components/workspace/WorkspacePaneUtils.ts
desktop/src/components/workspace/ArchivePaneParts.tsx
desktop/src/components/workspace/KnowledgePaneParts.tsx
desktop/src/components/workspace/WorkbenchSourceParts.tsx
desktop/src/components/workspace/WorkbenchQueueParts.tsx
desktop/src/components/workspace/WorkbenchShared.tsx
desktop/src/components/workspace/SettingsPaneParts.tsx
desktop/src/components/workspace/SettingsBlocks.tsx
desktop/src/components/workspace/SettingsShared.tsx
desktop/src/components/workspace/WorkspaceDialogs.tsx
desktop/src/components/workspace/WorkbenchPaneParts.tsx
desktop/src/components/workspace/WorkspaceShell.tsx
desktop/src/components/SourceSidebarPane.tsx
desktop/src/components/WorkflowPane.tsx
desktop/src/components/ArticleHtmlRenderer.tsx
desktop/src/lib/learningNotesStudyPackage.ts
desktop/src/lib/studyTree.ts
desktop/src/types/course.ts
```

文档主线：

```text
README.md
PROJECT_CONTEXT.md
docs/video-editorial-pipeline.md
docs/system-optimization-audit.md
docs/cleanup-baseline.md
```

## 兼容层

以下内容允许暂时保留，但只服务专注页内部兼容，不代表当前产品方向：

- `CoursePackage`
- `lesson`
- `quiz_question`
- `standard_answer`
- `quizzing`
- `desktop/src/types/course.ts`
- `desktop/src/lib/learningNotesStudyPackage.ts`
- `desktop/src/lib/learningTurn.ts`
- `desktop/src/lib/learningState.ts`
- `desktop/src/lib/learningProgression.ts`

这些字段不能出现在新的产品语言、制作流程、材料目录命名或用户提示中。

## 已退出默认生产

以下路线已经退出默认生产，不应恢复：

- Codex Goal 长视频深写。
- v8 / v9 学习页实验。
- content_draft、coverage、dossier、trace、validator 工作区。
- course_blueprint、course_draft、codex_course_plan。
- course-package 打包生产。
- quiz / standard_answer 驱动的验收流程。
- synthetic 300k eval。

当前 Git 状态里已经删除的旧文件，例如 `docs/prompts/codex-goal-content-synthesis-v8.md`、`desktop/electron/materialValidation.ts`、`src/schemas/*`、`src/eval_material_pipeline.py`，应保持删除，不要为了兼容重新引入。

## 当前材料目录策略

`.course_material` 暂时保留为内部目录后缀，但语义已经变成轻量资料目录。

当前应优先保留：

```text
manifest.json
run_state.json
raw_transcript.txt
content.md
content.meta.json
metrics.json
exports/notebooklm.md
indexes/source_index.jsonl
summary/article.md
summary/article.html
summary/cards.json
summary/review.json
summary/summary_status.json
summary/meta.json
work/cleaning/
```

不再默认生成：

```text
authoring/
content_draft/
schemas/
validation_contract.json
content_draft/work/
content_draft/review_exports/
```

## Phase 2 拆分目标

`desktop/electron/main.ts` 仍然是最大维护压力来源。后续拆分顺序：

1. `materialStats.ts`：文件大小、文本长度、metrics 读取。已完成第一版。
2. `workflowDocuments.ts`：流程页白名单文档读取。已完成第一版。
3. `pathSafety.ts`：安全路径比较、根目录校验和受限删除。已完成第一版。
4. `materialInventory.ts`：材料扫描和档案记录构造。已完成第一版；删除联动仍留在 `main.ts`。
5. `workbenchQueue.ts`：任务队列类型、规范化、去重、claim/update/recover。已完成第一版；执行器已拆入 `queueExecutor.ts`。
6. `queueExecutor.ts`：固定并发、任务 claim 后执行、复用资料、清洗、生成短视频文稿、归档和失败回写。已完成第一版；具体文件系统/档案 helper 仍由 `main.ts` 注入。
7. `learningArchive.ts`：把视频精读稿包装成当前档案系统可读的内部兼容记录。已完成第一版；学习档案 Store 写入仍留在 `main.ts`。
8. `smtpEmail.ts`：SMTP 测试邮件发送。已完成第一版；真实文章推送仍待继续拆分。
9. `bilibiliSourceApi.ts`：B 站登录状态、关注源、最近视频、单视频信息和 WBI 签名。已完成第一版。
10. `sourceDiscovery.ts`：收藏源规范化、24 小时发现、已知 BV 去重、自动入队候选生成。已完成第一版。
11. `settings.ts`：运行时设置类型、默认值、QQ SMTP 默认补全、API/路径/模型字段清洗。已完成第一版。
12. `knowledgeLibrary.ts`：旧知识资料索引文件的读写、预览、去重和资料包关联查找。已完成第一版；删除联动仍由 `main.ts` 统筹。
13. `windowStateStore.ts`：窗口位置和尺寸的持久化读取/保存。已完成第一版。
14. `studyPackageCompat.ts`：旧学习包树压缩、阶段标题修复和 `.json` 兼容写回。已完成第一版；明确作为历史兼容层，不进入新制作主线。
15. `ttsService.ts`：TTS 缓存、MiMo/MiniMax 调用、用量统计和失败提示。已完成第一版；主进程只保留 IPC 接线。
16. `learningLibraryStore.ts`：档案记录 Store、归档、刷新、删除、打开和摘要统计。已完成第一版；主进程只注入 `electron-store` 读写接口。
17. `obsidianExport.ts`：旧 Obsidian 导出、打开、Wiki 链接和 CSS snippet 配套。已完成第一版；作为历史配套能力隔离，不进入新视频精读生产主线。
18. `backendRuntime.ts`：Python 后端定位、打包资源同步、运行环境变量、distiller 子进程和视频精读稿子进程执行。已完成第一版；主进程只保留上下文注入和薄封装。
19. `automationController.ts`：后台自动检查、手动检查、暂停、定时器、队列调度和运行状态广播。已完成第一版；B 站发现、队列执行和归档仍由主进程注入。
20. `emailPush.ts`：真实视频精读稿邮件推送，读取 `summary/article.md` / `summary/article.html`，成功后写回 `summary/summary_status.json` 的 `email_pushed_at`。已完成第一版；SMTP 底层仍由 `smtpEmail.ts` 复用。
21. `materialDeletion.ts`：资料包删除、灵犀/档案联动清理、队列清空时归档已完成文稿并删除资料目录。已完成第一版；主进程只保留 IPC 调用和 Store 注入。
22. `desktop/src/components/workspace/WorkbenchPaneParts.tsx`：制作页整体展示编排。已完成第二版；视频来源区已经拆入 `WorkbenchSourceParts.tsx`，任务队列继续由 `WorkbenchQueueParts.tsx` 承接。
23. `desktop/src/components/workspace/ArchivePaneParts.tsx`：档案页统计、分类筛选、资料行、路径复制/定位/删除按钮展示层。已完成第一版；筛选数据、刷新、打开和删除逻辑仍由 `WorkspacePane.tsx` 注入。
24. `desktop/src/components/workspace/KnowledgePaneParts.tsx`：灵犀页统计、搜索、来源筛选提示、视频资料卡和入档资料卡展示层。已完成第一版；数据筛选、刷新、打开阅读和文件定位逻辑仍由 `WorkspacePane.tsx` 注入。
25. `desktop/src/components/workspace/SettingsPaneParts.tsx`：设置页组合入口。已完成第二版；具体表单块已拆入 `SettingsBlocks.tsx`，共享类型和基础壳已拆入 `SettingsShared.tsx`。
26. `desktop/src/components/workspace/WorkspaceShell.tsx`：工作区通用页面外壳，统一标题区、操作区、滚动内容区和最大宽度约束。已完成第一版；各业务页继续由 `WorkspacePane.tsx` 选择渲染。
27. `desktop/src/components/workspace/WorkbenchQueueParts.tsx`：任务队列卡片、状态灯操作区、清空/打开目录/刷新按钮和队列分页展示层。已完成第一版；队列状态、并发调度和删除逻辑仍由父级注入。
28. `desktop/src/components/workspace/WorkbenchShared.tsx`：制作页共享类型、分页控件和红黄绿状态灯。已完成第一版；后续来源列表和队列继续复用这里的基础控件。
29. `desktop/src/components/workspace/WorkspaceDialogs.tsx`：通用 Markdown 阅读弹窗配置，集中处理精读稿、清洗稿、原始字幕和结构图的标题、目录、搜索占位和 heading id。已完成第一版；复制和文件定位动作仍由父级注入。
30. `desktop/electron/dialogHandlers.ts`：目录选择、本地媒体选择、历史 JSON study package 导入/读取。已完成第一版；主进程只保留 IPC 接线。
31. `desktop/electron/windowController.ts`：窗口创建、托盘菜单、关闭隐藏、协议注册、深链解析和窗口控制 IPC。已完成第一版；主进程只保留应用生命周期接线。
32. `desktop/electron/systemIpcHandlers.ts`：文件读取、复制文本、流程文档读取、打开路径、定位文件和打开外部链接。已完成第一版；主进程只注册这一组通用系统 IPC。
33. `desktop/scripts/clean-build-output.ps1`：构建前清理 `dist` 和 `dist-electron`。已完成第一版；用于避免旧 Mermaid/KaTeX/Cytoscape chunk 或测试截图残留进 release。
34. `desktop/electron/settingsAutomationIpcHandlers.ts`：设置读取/保存、B 站凭据状态、后台检查状态、立即检查、暂停恢复和 SMTP 测试邮件。已完成第一版；主进程只注入设置和自动化控制器函数。
35. `desktop/electron/workbenchQueueIpcHandlers.ts`：任务队列读取、保存和清空 IPC。已完成第一版；队列规范化、删除联动和实际执行仍由已有队列/删除/自动化模块负责。
36. `desktop/electron/sourceIpcHandlers.ts`：收藏来源读取保存、B 站关注列表、来源视频列表和单视频信息 IPC。已完成第一版；B 站签名、请求和来源发现逻辑继续分别留在 `bilibiliSourceApi.ts` 与 `sourceDiscovery.ts`。
37. `desktop/electron/ttsIpcHandlers.ts`：TTS 合成和缓存状态 IPC。已完成第一版；缓存、MiMo/MiniMax 请求和用量统计继续留在 `ttsService.ts`。
38. `desktop/electron/obsidianIpcHandlers.ts`：Obsidian 导出和打开 IPC。已完成第一版；启动参数触发的历史 CLI 导出兼容逻辑仍留在 `main.ts`。
39. `desktop/electron/learningLibraryIpcHandlers.ts`：档案记录加载、打开、刷新、保存和删除 IPC。已完成第一版；记录规范化和 Store 读写继续留在 `learningLibraryStore.ts`。
40. `desktop/electron/materialIpcHandlers.ts`：材料清洗、材料列表、材料删除和短视频精读稿生成 IPC。已完成第一版；Python 执行、材料扫描、删除联动和归档逻辑继续由已有模块承接。
41. `desktop/electron/knowledgeIpcHandlers.ts`：灵犀列表 IPC。已完成第一版；知识资料索引读取继续留在 `knowledgeLibrary.ts`。
42. `desktop/electron/dialogHandlers.ts`：在原有文件选择/读取实现基础上，接管目录选择、本地媒体选择、图片选择和历史 JSON study package 导入/读取 IPC。已完成第二版；主进程只注册模块。
43. `desktop/electron/windowIpcHandlers.ts`：窗口最小化、关闭和最大化切换 IPC。已完成第一版；真实窗口状态操作继续由 `windowController.ts` 负责。
44. `desktop/electron/runtimePaths.ts`：开发项目根、打包数据根、userData、设置文件、窗口状态、日志、图标、默认导入路径和本地转写根探测。已完成第一版；主进程只接收解析结果。
45. `desktop/electron/appLifecycle.ts`：单实例锁、二次启动 deep link、macOS open-url、whenReady 建窗建托盘、启动恢复队列和应用退出事件。已完成第一版；窗口行为继续由 `windowController.ts` 执行。
46. `desktop/electron/obsidianCli.ts`：历史 Obsidian CLI 导出入口和导出目录清理。已完成第一版；保留兼容但不进入新视频精读主线。
47. `desktop/electron/runtimeStores.ts`：Electron Store 创建和历史 store 键迁移。已完成第一版；只处理 Electron Store 名称，不读取旧工作区路径。
48. `desktop/electron/runtimeLogger.ts`：运行日志写入。已完成第一版；主进程只注入 `appendRuntimeLog`。
49. `desktop/electron/workbenchQueueStore.ts`：任务队列 load/save/recover/append/update/claim 的 Store 胶水。已完成第一版；保持保存后触发队列调度的原行为。
50. `desktop/electron/pinnedSourcesStore.ts`：收藏视频来源读取、规范化和保存。已完成第一版；B 站请求仍留在来源 API 模块。
51. `desktop/electron/materialRecordBridge.ts`：按 BV/路径查找材料、判断精读稿状态、从 distiller 结果取资料路径、归档到档案。已完成第一版；用于自动化队列、材料总结和删除联动共享同一套判断。
52. `desktop/electron/learningLibraryRuntime.ts`：档案 Store 装配和方法命名。已完成第一版；主进程只注入 Electron Store 读写。
53. `desktop/electron/settingsRuntime.ts`：设置读取、规范化、保存和保存后的调度副作用。已完成第一版；设置字段规则仍留在 `settings.ts`。
54. `desktop/electron/sourceDiscoveryRuntime.ts`：关注源新视频发现前的已知 BV 收集、材料扫描兜底和 24 小时窗口调用。已完成第一版。
55. `desktop/src/components/workspace/WorkspacePaneUtils.ts`：工作区纯计算、格式化、档案筛选、灵犀筛选、关注源过滤、来源视频展开和任务队列资料合并规则。已完成第一版；避免把产品规则散落在主容器中。
56. `desktop/src/components/workspace/WorkbenchSourceParts.tsx`：制作页视频来源工具栏、手动 BV/本地输入、左侧来源列表和右侧来源视频列表。已完成第一版；`WorkbenchPaneParts.tsx` 只保留布局拼装。
57. `desktop/src/components/workspace/SettingsBlocks.tsx`：当前配置、后台邮件、MiMo 文稿、TTS、Obsidian、转写和 B 站凭据表单块。已完成第一版；后续可继续按“后台邮件 / 模型与语音 / 外部集成”拆小。
58. `desktop/src/components/workspace/SettingsShared.tsx`：设置页共享类型、草稿更新函数类型、字段壳和区块壳。已完成第一版。
59. `desktop/electron/automationRuntime.ts`：后台自动化 controller、固定 3 并发队列执行、短视频精读稿生成、归档和邮件推送装配。已完成第一版；具体队列执行逻辑仍留在 `queueExecutor.ts`。

下一批优先级：

- 继续评估 `main.ts` 中剩余的后端运行时、材料删除、窗口装配和 IPC 注册是否还能继续收束；只有在能保持行为不变并降低维护压力时再做。
- Mermaid、KaTeX、Cytoscape 和旧章节路线图弹窗不在当前依赖/默认链路中；Markdown 中的 mermaid 代码块按普通代码显示。

每次拆分都应保持 IPC 行为不变，并通过 `npx tsc --noEmit` 与 `npm run build:web` 验证。

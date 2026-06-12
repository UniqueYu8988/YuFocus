# 视界专注项目上下文

本文档用于在长会话、上下文压缩、换窗口或阶段性重构后，帮助 Codex 和维护者快速恢复项目方向。每次产品方向、主流程、目录结构、状态机或兼容策略发生变化，都应同步更新。

## 项目根目录

固定项目根目录：

```text
C:\Users\Yu\AI\视界专注
```

不要读取、引用、迁移或依赖旧 `C:\Users\Yu\AI\Onboard` 工作区。

## 当前定位

视界专注已经从“课程制作 / 长视频深写学习包”转型为本地视频资料处理与阅读工具。

当前只保留两个核心功能：

1. 长视频 / 本地视频：提取字幕或本地转写，清洗为可读资料，并导出 NotebookLM 可导入文件。
2. 短视频：清洗字幕后调用 MiMo API 自动生成视频精读稿，进入专注、档案与灵犀阅读归档。

长视频不再追求替代 NotebookLM 做完整学习分析。软件负责把资料提取、清洗、索引和导出做好。

短视频是新的自动化生产重点。典型来源是 B 站关注源中的 20 分钟以内视频，内容长度通常不超过一万字，适合自动排队、自动清洗、自动编稿和归档。

## 当前生产链路

### 视频来源

制作页读取 B 站关注源和最近视频。用户可以收藏常用 UP，批量选择视频加入任务队列。

非收藏 UP 生成的精读稿归入“拾遗”；收藏 UP 只有在真实制作过条目后，才在灵犀中生成对应来源分组。

### 任务队列

任务队列由 Electron 主进程自动处理，固定同时处理 3 个任务，不再暴露用户自定义并行数。
并发语义是“完整任务级别”的滚动窗口：同一时间最多 3 个 `processing` 任务；只有某个完整任务完成或失败后，才补入下一个 queued 任务。应用重启时，上一轮遗留的 `processing` 视为中断状态，会先恢复为 `queued`，再重新按 3 个槽位调度，避免旧处理中状态和新任务叠加。

1. 获取视频信息。
2. 获取字幕；无字幕时进入本地音频转写。
3. 清洗字幕。
4. 写出 `.course_material`。
5. 短视频继续调用 MiMo API 生成精读稿。

手动输入 BV 默认只清洗字幕，主要服务 NotebookLM 导入；关注源加入的任务默认继续生成精读稿。

状态灯语义：

- 红灯：处理中。
- 黄灯：字幕清洗完成，待生成精读稿。
- 绿灯：精读稿已完成。

清空任务队列的语义：

- 绿灯资料先写入档案，再清理中间 `.course_material`。
- 黄灯、待处理、失败任务视为临时资料，清空时删除对应源文件。
- 正在处理的任务不强杀，当前轮结束后再由队列状态接管。

### 后台自动化

桌面端正在转向可长期驻留的自动化制作工具。

第一阶段后台能力：

- Electron 主进程创建系统托盘。
- 关闭窗口默认隐藏到托盘，只有明确退出才结束应用。
- 后台调度器在主进程维护每 6 小时一次的定时检查、暂停恢复、立即检查和状态广播。
- 无任务时只保留轻量定时器与必要状态，不依赖前端渲染常驻。

第二阶段后台能力：

- 后台检查分为两种入口：定时自动查询、手动立即查询。
- 两种入口共用同一套发现机制：读取已收藏的视频来源，只检查最近 24 小时内发布的新视频。
- 发现未入库、未入队的新视频后写入同一条任务队列。
- 同一 BV 是全局去重单位；已经在队列或已生成资料目录的视频，不应重复入队或重复制作。
- 任务队列由 Electron 主进程顺序处理：字幕清洗完成后继续调用 MiMo 生成短视频精读稿。
- 处理时按阶段复用已有产物：已有精读稿则直接完成；已有清洗资料则跳过字幕清洗，只补精读稿。
- 前端只负责展示、添加和删除任务；窗口关闭后队列仍可继续运行。

后续成熟链路：

1. 定时检查收藏的视频来源。
2. 新视频自动加入任务队列。
3. 短视频自动完成字幕清洗和精读稿生成。
4. 按日或按批次把精读稿推送到邮箱。
5. 长视频仍只产出清洗稿和 NotebookLM 导入资料。

邮件推送已经跑通 QQ SMTP 真实发送。邮件正文优先使用 `summary/article.html`，并保留纯文本兜底。HTML 默认采用浅色邮件样式，关键颜色和排版需要写入内联样式，避免手机邮箱客户端裁剪 `<style>` 或强制改写深色模式后出现黑字黑底。

短视频精读稿当前的内容优化原则：

- 删减低收益、高 token 消耗的读者正文板块，尤其是“关键原话”“事实”“事实、判断与边界”。
- 这些信息可以作为内部材料、背景支撑或回查索引存在，但不再作为最终邮件正文的固定栏目。
- 二级标题保持少而稳：`核心判断` 不加 emoji，`🧭 核心线索` 和 `🔎 问题拆解` 使用固定前缀。
- 开篇一句话总结和核心判断不加粗，避免首屏文字过密。
- HTML 标题颜色应比正文淡一层，让读者能快速扫出结构。

下一阶段研究方向是让 token 消耗更有回报：建立明确的中间工件层，把字幕深读、信息抽取、主线编辑、主编写稿和格式检查分开。昂贵 API 主要负责“理解主线”和“写成好文章”；本地规则或本地小模型优先承担切段、去重、标签、格式检查、重复检测、HTML 邮件兼容检查等简单任务。

当前已经开始建立制作链路计量。新生成或重跑的资料目录会写入 `metrics.json`，记录字幕清洗和短视频编稿的阶段耗时、输入输出规模、API token 汇总和主要产物大小。档案列表会读取这些指标，用于后续判断 token 投入产出比、耗时瓶颈和重复制作浪费。

### 专注与档案

主导航命名已经收敛为：`专注 / 制作 / 档案 / 流程 / 设置`。

专注用于打开当前资料，是视频精读稿、清洗稿和兼容阅读包的主阅读入口。

制作是视频来源、字幕清洗、任务队列和短视频精读稿生成入口。

档案是内容资产管理中心，不再以旧学习进度为主体。它按来源、类型、推送和异常状态管理本地资料，展示文稿数量、字幕数量、总字数、占用空间、今日/本周新增、推送状态和文件完整性。

灵犀是按来源组织的资料索引层。左侧主线结构可以继续像文件夹一样显示来源名称，二级结构按时间显示文章。

### 流程透明页

左侧侧边栏在“设置”上方新增 `流程` 页面。它只负责解释和审计透明度，不参与制作、不入队、不改变任务队列。

流程页面展示：

- 长视频路线：视频来源 -> 字幕获取/本地转写 -> 字幕清洗 -> NotebookLM 导入稿。
- 短视频路线：视频来源 -> 字幕获取/本地转写 -> 字幕清洗 -> 信息抽取 -> 主编成稿 -> 邮件/档案/灵犀。
- 当前自动化原则，包括 3 个完整任务并行、手动 BV 默认只清洗字幕、收藏来源默认生成精读稿、浅色 HTML 邮件和纯文本兜底。

页面中的文件查看按钮通过 Electron 白名单 IPC 读取真实项目文件。前端只能传 key，不能传任意路径。当前白名单：

```text
project_context      -> PROJECT_CONTEXT.md
editorial_pipeline   -> docs/video-editorial-pipeline.md
email_contract       -> src/check_editorial_email_contract.py
distiller_core       -> src/distiller.py
system_optimization_audit -> docs/system-optimization-audit.md
cleanup_baseline -> docs/cleanup-baseline.md
```

该入口用于杜绝黑箱操作：用户可以在软件内直接查看核心流程文档、合同检查和后端编稿逻辑。

## `.course_material` 轻量结构

软件仍使用 `.course_material` 作为本地资料目录，但它不再是给 Codex Goal 的复杂工作区。

当前核心文件：

```text
manifest.json
run_state.json
HANDOFF.md
raw_transcript.txt
content.md
content_meta.json
exports/notebooklm.md
indexes/source_index.jsonl
blocks/*.md
metrics.json
summary/article.md
summary/article.html
summary/cards.json
summary/review.json
summary/summary_status.json
cleaning/
```

不再默认生成：

```text
authoring/
content_draft/
schemas/
validation_contract.json
content_draft/review_exports/
content_draft/work/
```

## MiMo API

用户有充足 MiMo token，不需要为了省 token 牺牲理想流程。

设置中保留：

- `mimo_api_key`
- `mimo_text_endpoint`
- `mimo_text_model`
- TTS 相关 MiMo / MiniMax 配置

文稿默认模型：

```text
mimo-v2.5-pro
```

短视频精读稿由软件调用 API 生成，不再复制提示词到 Codex。

## 产品语言

默认产品语言：

- 专注
- 制作
- 档案
- 流程
- 视频来源
- 任务队列
- 灵犀
- 清洗稿
- 精读稿
- NotebookLM 导入资料

避免重新使用以下词作为主流程语言：

- 课程制作
- 制课
- 学习包
- 答题验收
- course-package
- Goal 制作
- 知识树深写

## 兼容层边界

Electron 专注页内部仍有历史 JSON study package 结构。`CoursePackage`、`lesson`、`quiz_question`、`standard_answer`、`quizzing` 等字段只允许作为内部兼容层存在。

不要让这些字段影响：

- 制作文案
- 材料包目录结构
- 用户操作流程
- README 和产品说明
- 新生成资料的对外命名

## 已退出默认链路

以下内容已经退出默认生产，不应恢复为主流程：

- Codex Goal 长视频深写。
- 复杂知识树、coverage、dossier、trace、validator 工作流。
- v8 / v9 学习页实验路线。
- CLI material validator。
- synthetic 300k eval。
- course-package 打包与旧导入目录。
- quiz / standard_answer 驱动的验收产品形态。

历史纪念材料可以保留，例如 `PROJECT_MEMORIAL_REPORT.md`，但不能作为当前执行说明。

## 当前核心文件

后端：

```text
src/distiller.py
src/bilibili_api.py
src/audio_fallback.py
src/local_audio_client.py
src/validate_content_synthesis_plan.py  # 旧计划 JSON 兼容检查，只保留语法层
```

桌面端：

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
desktop/electron/materialInventory.ts
desktop/electron/materialRecordBridge.ts
desktop/electron/materialStats.ts
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

当前说明：

```text
README.md
PROJECT_CONTEXT.md
docs/video-editorial-pipeline.md
docs/system-optimization-audit.md
docs/cleanup-baseline.md
```

前端维护边界：`desktop/src/components/WorkspacePane.tsx` 仍是专注、制作、档案、设置的主容器；制作页整体编排已经拆入 `desktop/src/components/workspace/WorkbenchPaneParts.tsx`；视频来源工具栏、手动输入、来源列表和来源视频列表已经拆入 `desktop/src/components/workspace/WorkbenchSourceParts.tsx`；任务队列展示层已经拆入 `desktop/src/components/workspace/WorkbenchQueueParts.tsx`；制作页共享类型、分页控件和状态灯已经拆入 `desktop/src/components/workspace/WorkbenchShared.tsx`；档案页统计、筛选和资料行展示已经拆入 `desktop/src/components/workspace/ArchivePaneParts.tsx`；灵犀页统计、搜索、来源筛选和资料卡片已经拆入 `desktop/src/components/workspace/KnowledgePaneParts.tsx`；设置页组合入口已经拆入 `desktop/src/components/workspace/SettingsPaneParts.tsx`，具体设置表单块已经拆入 `desktop/src/components/workspace/SettingsBlocks.tsx`，设置页共享类型和基础区块壳已经拆入 `desktop/src/components/workspace/SettingsShared.tsx`；通用阅读弹窗配置已经拆入 `desktop/src/components/workspace/WorkspaceDialogs.tsx`；通用工作区页面外壳已经拆入 `desktop/src/components/workspace/WorkspaceShell.tsx`；工作区纯计算、筛选、队列合并和格式化规则已经拆入 `desktop/src/components/workspace/WorkspacePaneUtils.ts`。继续拆分时优先保持父组件负责状态和 IPC，子组件负责展示与用户操作回调。

主进程维护边界：`desktop/electron/main.ts` 应尽量只负责依赖装配和模块注册。所有常规 IPC 应由分组模块注册。文件选择、媒体选择和历史 JSON study package 兼容读取已经拆入 `desktop/electron/dialogHandlers.ts`；窗口控制 IPC 已经拆入 `desktop/electron/windowIpcHandlers.ts`，窗口创建、托盘菜单、协议注册和深链解析继续由 `desktop/electron/windowController.ts` 负责；文件读取、复制、流程文档读取、系统打开和外部链接打开已经拆入 `desktop/electron/systemIpcHandlers.ts`；设置、后台自动化和邮件测试 IPC 已经拆入 `desktop/electron/settingsAutomationIpcHandlers.ts`；B 站视频来源 IPC 已经拆入 `desktop/electron/sourceIpcHandlers.ts`；任务队列读取、保存和清空 IPC 已经拆入 `desktop/electron/workbenchQueueIpcHandlers.ts`；材料清洗、扫描、删除和短视频精读稿生成 IPC 已经拆入 `desktop/electron/materialIpcHandlers.ts`；灵犀列表 IPC 已经拆入 `desktop/electron/knowledgeIpcHandlers.ts`；TTS IPC 已经拆入 `desktop/electron/ttsIpcHandlers.ts`；Obsidian UI IPC 已经拆入 `desktop/electron/obsidianIpcHandlers.ts`；档案记录 IPC 已经拆入 `desktop/electron/learningLibraryIpcHandlers.ts`。应用生命周期已拆入 `desktop/electron/appLifecycle.ts`；历史 Obsidian CLI 入口已拆入 `desktop/electron/obsidianCli.ts`；项目根、数据根、图标路径、设置路径和默认导入路径解析已拆入 `desktop/electron/runtimePaths.ts`；Electron Store 创建和历史键迁移已拆入 `desktop/electron/runtimeStores.ts`；运行日志写入已拆入 `desktop/electron/runtimeLogger.ts`。设置读写运行时已拆入 `desktop/electron/settingsRuntime.ts`；档案 Store 装配已拆入 `desktop/electron/learningLibraryRuntime.ts`；任务队列 Store 已拆入 `desktop/electron/workbenchQueueStore.ts`；收藏视频来源 Store 已拆入 `desktop/electron/pinnedSourcesStore.ts`；关注源 24 小时发现运行时已拆入 `desktop/electron/sourceDiscoveryRuntime.ts`；材料查找、复用和归档桥接已拆入 `desktop/electron/materialRecordBridge.ts`；后台自动化与队列执行装配已拆入 `desktop/electron/automationRuntime.ts`。

旧依赖状态：Mermaid、KaTeX 和 Cytoscape 已退出桌面依赖与默认渲染链路。Markdown 中的 mermaid 代码块按普通代码显示，不再引入图表运行时。旧 `ChapterRoadmapDialog.tsx` 已无引用并删除。

构建洁净度：`desktop/package.json` 的 `build:web` 会先运行 `desktop/scripts/clean-build-output.ps1`，清理 `desktop/dist` 与 `desktop/dist-electron` 后再构建，避免旧 chunk、测试截图或已删除依赖残片混入 release。

## 验证命令

阶段性改动后运行：

```powershell
python -m py_compile src\bilibili_api.py src\audio_fallback.py src\local_audio_client.py src\distiller.py src\validate_content_synthesis_plan.py
python src\check_editorial_email_contract.py
cd desktop
npx tsc --noEmit
npm run build:web
```

前端改动后需要实际打开界面测试，至少确认：

- 制作页能显示。
- 视频来源能显示。
- 任务队列不会出现旧 Goal / 实验整理入口。
- 设置中能保存 MiMo API key、文稿 endpoint 和文稿模型。
- 专注页能打开精读稿或清洗稿。

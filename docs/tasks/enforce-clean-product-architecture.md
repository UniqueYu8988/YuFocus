# 任务：建立字幕处理引擎的清晰分层目录

创建日期：2026-06-15
状态：已完成

## 1. 目标

在不改变产品行为、不改字幕处理逻辑、不新增功能的前提下，把桌面端代码整理为长期可维护的产品骨架：

```text
desktop/src/ui
desktop/src/domain
desktop/src/services
desktop/src/state
desktop/electron/ipc
desktop/electron/runtime
desktop/electron/queue
desktop/electron/providers
desktop/electron/services
```

当前唯一主线仍是：

```text
UP 主 → 视频列表 → 字幕获取 / 转写兜底 → 字幕清洗 → NotebookLM 输出
```

## 2. 明确不做

- 不改 `src/distiller.py` 行为。
- 不改字幕获取、转写兜底、清洗、NotebookLM 输出逻辑。
- 不改 `subtitle_only` 队列执行规则。
- 不新增产品功能。
- 不优化性能。
- 不处理 Git。
- 不删除或移动 `output`、Electron Store 或真实用户数据。

## 3. 分类规则

| 分类 | 目标位置 | 说明 |
|---|---|---|
| UI ONLY | `desktop/src/ui` | React 页面、面板、基础组件，只负责展示和派发动作 |
| DOMAIN LOGIC | `desktop/src/domain` | 来源、队列、输出、pipeline 的纯前端业务规则 |
| SERVICES | `desktop/src/services` | 浏览器侧外部集成、desktop API fallback、文件/系统服务适配 |
| STATE | `desktop/src/state` | Zustand store 等状态容器 |
| ELECTRON IPC | `desktop/electron/ipc` | `register*IpcHandlers` |
| ELECTRON RUNTIME | `desktop/electron/runtime` | 设置、路径、日志、生命周期、窗口运行时 |
| ELECTRON QUEUE | `desktop/electron/queue` | 工作台队列模型、存储、执行器 |
| ELECTRON PROVIDERS | `desktop/electron/providers` | B 站来源发现等外部来源 |
| ELECTRON SERVICES | `desktop/electron/services` | 文件、材料、知识库、删除、安全路径等服务 |
| LEGACY | `desktop/src/legacy` 或 `desktop/electron/legacy` | 已隔离但仍需兼容的数据读取或旧学习库 |

## 4. 验证

- `cd desktop && npx tsc --noEmit`
- `node desktop/scripts/check-product-refactor-surface.mjs`
- `node desktop/scripts/check-subtitle-only-queue-mode.mjs`
- 静态搜索确认 subtitle-only 主线入口仍存在。

## 5. 回退

如果迁移导致类型检查或静态保护脚本失败，优先回退本任务移动的文件和 import 路径，不回退此前已完成的剪枝和 subtitle-only 保护。

## 6. 实际迁移结果

### UI ONLY

移动到 `desktop/src/ui`：

- `ui/App.tsx`
- `ui/components/*`
- `ui/components/base/*`
- `ui/pages/WorkflowPane.tsx`
- `ui/pages/WorkspacePane.tsx`
- `ui/pages/WorkspacePaneUtils.ts`
- `ui/panels/SourceSidebarPane.tsx`
- `ui/panels/workspace/*`

说明：`WorkspacePaneUtils.ts` 最终归入 UI 页面辅助层，因为它仍包含页面筛选、状态标签和 UI 类型依赖，不应放在 domain。

### DOMAIN LOGIC

移动到 `desktop/src/domain/pipeline`：

- `coachPreferences.ts`
- `distillProgress.ts`

说明：当前前端可安全抽出的纯 pipeline 逻辑较少；没有强行拆 `WorkspacePane.tsx` 或 queue 逻辑。

### SERVICES

移动到 `desktop/src/services/filesystem`：

- `clipboard.ts`
- `desktopApiFallback.ts`

### STATE

移动到 `desktop/src/state`：

- `store.ts`

### FRONTEND LEGACY

移动到 `desktop/src/legacy`：

- `legacy/learning/*`
- `legacy/types/course.ts`

### ELECTRON IPC

移动到 `desktop/electron/ipc`：

- `dialogHandlers.ts`
- `knowledgeIpcHandlers.ts`
- `learningLibraryIpcHandlers.ts`
- `materialIpcHandlers.ts`
- `settingsAutomationIpcHandlers.ts`
- `sourceIpcHandlers.ts`
- `systemIpcHandlers.ts`
- `windowIpcHandlers.ts`
- `workbenchQueueIpcHandlers.ts`

### ELECTRON RUNTIME

移动到 `desktop/electron/runtime`：

- `appLifecycle.ts`
- `automationController.ts`
- `automationRuntime.ts`
- `backendRuntime.ts`
- `runtimeLogger.ts`
- `runtimePaths.ts`
- `runtimeStores.ts`
- `settings.ts`
- `settingsRuntime.ts`
- `windowController.ts`
- `windowStateStore.ts`

### ELECTRON QUEUE

移动到 `desktop/electron/queue`：

- `queueExecutor.ts`
- `workbenchQueue.ts`
- `workbenchQueueStore.ts`

### ELECTRON PROVIDERS

移动到 `desktop/electron/providers`：

- `bilibiliSourceApi.ts`
- `sourceDiscovery.ts`
- `sourceDiscoveryRuntime.ts`

### ELECTRON SERVICES

移动到 `desktop/electron/services`：

- `knowledgeLibrary.ts`
- `materialDeletion.ts`
- `materialInventory.ts`
- `materialRecordBridge.ts`
- `materialStats.ts`
- `pathSafety.ts`
- `pinnedSourcesStore.ts`
- `workflowDocuments.ts`

### ELECTRON LEGACY

移动到 `desktop/electron/legacy`：

- `learningArchive.ts`
- `learningLibraryRuntime.ts`
- `learningLibraryStore.ts`
- `studyPackageCompat.ts`

## 7. 依赖边界检查

- `desktop/src/domain`、`desktop/src/services`、`desktop/src/state`、`desktop/src/legacy` 没有引用 `@/ui`。
- `desktop/src/ui` 可以引用 `state`、`services` 和 `domain`。
- `desktop/electron/main.ts` 和 `desktop/electron/preload.ts` 保留在根目录，作为 Electron 入口壳。
- 未发现 import 图循环依赖。

## 8. 验证结果

已通过：

- `cd desktop && npx tsc --noEmit`
- `node desktop/scripts/check-product-refactor-surface.mjs`
- `node desktop/scripts/check-subtitle-only-queue-mode.mjs`
- `node desktop/scripts/check-distill-progress.mjs`
- 简单 import 图循环检测：`cycleCount = 0`
- 静态搜索：旧 `@/components`、`@/lib`、`@/store`、`@/types` 引用已清空。

未执行：

- 未启动真实软件。
- 未跑真实队列、B 站、Python、MiMo 或 SenseVoice。

原因：本任务只移动文件和修 import 路径；真实流程上一阶段已经通过，本轮优先避免写入 AppData、日志和 output。

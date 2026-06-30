# 任务：睡前体验收束、发布与开发版快捷方式

创建日期：2026-07-01
状态：待发布

## 1. 目标

完成今天最后一轮使用体验优化：让 Markdown 成品直接用系统外部应用打开；优化档案、队列和最近页图标与状态表达；重新生成便携版；把当前代码作为 GitHub 存档点并发布 release；最后把桌面快捷方式切换为开发版入口并启动自动同步。

## 2. 背景

当前功能已经进入高频体验微调阶段。每次小改后完整打包会消耗较多时间，因此后续日常使用更适合通过桌面开发版快捷方式启动当前源码版本；便携版只在阶段存档或分享时重新生成。

## 3. 本次范围

- 档案页搜索栏右侧两个文件夹图标改成可区分的清洗稿 / email 目录入口。
- 档案和队列列表中的 Markdown 按钮直接调用系统外部应用打开文件，不再进入软件内部查看器。
- 删除或隔离旧版内部 Markdown 查看器入口。
- 最近页删除“仅元数据”标签，把右侧操作图标移到最近视频列表区域。
- 最近页和队列页状态统一为少量清晰状态，并用更明显的颜色区分。
- 重新构建便携版和分享包。
- 提交、推送 GitHub，并创建本次 release。
- 桌面快捷方式切换为开发版入口并启动应用。

## 4. 明确不做

- 不删除真实 `data/materials` 或 `data/library` 内容。
- 不读取、输出或提交 B 站 Cookie、MiMo Key、SMTP 授权码等秘密值。
- 不重跑已有视频。
- 不恢复旧精读稿、TTS 或旧课程路线。
- 不做大文件拆分。

## 5. 验收标准

- [x] 档案和队列点击清洗稿 / email 图标会用系统外部应用打开 Markdown。
- [x] 最近页不再显示“仅元数据”标签。
- [x] 最近页和队列页状态命名更简洁，并保持颜色区分。
- [x] 便携版 exe 和 share zip 重新生成。
- [x] 自动检查和类型检查通过。
- [ ] 代码提交并推送到 GitHub。
- [ ] GitHub release 创建完成。
- [ ] 桌面快捷方式指向开发版入口，开发版应用已启动。

## 6. 相关文件和数据

- `desktop/src/ui/pages/HomePane.tsx`
- `desktop/src/ui/pages/WorkspacePane.tsx`
- `desktop/src/ui/pages/WorkspacePaneUtils.ts`
- `desktop/src/ui/panels/workspace/ArchivePaneParts.tsx`
- `desktop/src/ui/panels/workspace/WorkbenchQueueParts.tsx`
- `desktop/src/ui/components/KnowledgeBriefDialog.tsx`
- `desktop/src/ui/components/MarkdownRenderer.tsx`
- `desktop/scripts/*`
- 桌面快捷方式：`%USERPROFILE%\Desktop\视界专注.lnk`

## 7. 风险

- 当前工作区包含多个已完成但未提交的阶段改动，本次提交会作为一个综合存档点。
- 删除旧内部查看器入口需要避免影响仍在使用的旧学习库兼容视图。
- 开发版启动会写入运行日志，并可能在自动同步开启时继续处理队列。

## 8. 验证方式

- 自动测试：相关 UI 静态检查脚本。
- 构建或类型检查：`npx tsc --noEmit`、`npm run build:portable`。
- 人工验收：便携版 smoke test；桌面快捷方式启动开发版。

## 9. 完成记录

- 档案搜索栏右侧入口已改成清洗稿图标和 email 图标，避免两个相同文件夹图标。
- 档案、队列和灵犀中的 Markdown 打开行为已改为 `openPath`，交给系统默认外部应用；旧内部 Markdown 查看器 `WorkspaceDialogs`、`KnowledgeBriefDialog` 和 `MarkdownRenderer` 已删除。
- 最近页刷新 / 暂停图标已从页面顶部操作区移动到视频列表标题行右侧，并删除“仅元数据”标签。
- 最近页和队列状态收敛为 `未入队 / 排队中 / 制作中 / 已完成 / 已跳过 / 失败 / 需检查` 等简洁名称，并补充颜色区分。
- 新增 `desktop/scripts/start-dev-desktop.ps1`，用于桌面开发版快捷方式启动当前源码版本。
- 已通过 `check-product-refactor-surface`、`check-home-dashboard-safety`、`check-queue-record-feed`、`check-archive-up-grouping`、`check-efficiency-observability`、`npx tsc --noEmit`、`npm run build:portable` 和 `check-packaged-portable-smoke`。

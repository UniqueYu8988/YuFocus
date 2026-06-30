# 任务：折叠失败队列项，避免影响正常历史补全视线

创建日期：2026-07-01
状态：已完成

## 1. 目标

付费、权限受限、HTTP 412、无音频轨等失败视频默认折叠在一起，不继续占用队列主列表，也不在后台状态里显示为“需要重试”。

## 2. 背景

历史补全会持续寻找可处理视频，但部分 B 站视频因为付费或权限限制无法获取。这类视频不是当前可操作任务，应保留记录但弱化呈现。

## 3. 本次范围

- 队列页把失败 / 跳过且没有资料产物的记录折叠到单独区域。
- 队列主列表优先显示处理中、等待中和已完成资料，不被失败项顶住。
- 后台自动化结果文案不再把失败项称为“需要重试”。
- 增加最小检查脚本覆盖该行为。

## 4. 明确不做

- 不删除失败队列记录。
- 不自动重试付费或权限失败视频。
- 不修改字幕清洗、模型调用、邮件发送和真实资料文件。

## 5. 验收标准

- [ ] 失败 / 跳过队列项默认折叠。
- [ ] 正常队列记录仍能滚动加载。
- [ ] 后台状态不再显示“失败项需要重试”。
- [ ] 相关检查和类型检查通过。

## 6. 相关文件和数据

- `desktop/src/ui/pages/WorkspacePane.tsx`
- `desktop/src/ui/pages/WorkspacePaneUtils.ts`
- `desktop/src/ui/panels/workspace/WorkbenchQueueParts.tsx`
- `desktop/electron/runtime/automationController.ts`
- `desktop/scripts/`

## 7. 风险

- 如果折叠规则过宽，可能隐藏仍需人工重试的失败项。本次只折叠“没有资料产物的 failed / skipped 队列记录”，保留展开查看。

## 8. 验证方式

- 自动测试：新增队列失败项折叠检查。
- 构建或类型检查：`npx tsc --noEmit`。

## 9. 完成记录

2026-07-01 完成。

- 新增 `isFoldedWorkbenchQueueIssueItem`，统一识别没有资料产物的 `failed / skipped` 队列记录。
- 队列页主列表只展示正常流程记录；失败 / 跳过视频默认折叠到“无法获取的视频”区域，展开后可查看原因。
- 折叠区域不再提供默认重试入口，避免付费、权限受限、HTTP 412、无音频轨等视频干扰正常队列。
- 后台自动化状态从“失败项需要重试”调整为“问题项已折叠”。
- 已重新生成便携版 `desktop/release/视界专注_v0.1.0_x64.exe` 和分享包。

验证：

- `node scripts/check-folded-queue-issues.mjs`
- `node scripts/check-queue-record-feed.mjs`
- `node desktop/scripts/check-up-sync-scheduler.mjs`
- `npx tsc --noEmit`
- `npm run build:portable`
- `node desktop/scripts/check-packaged-portable-smoke.mjs`

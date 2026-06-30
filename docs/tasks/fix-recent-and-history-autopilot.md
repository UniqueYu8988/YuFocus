# 任务：修复最近视频和历史补全自动入队

创建日期：2026-07-01
状态：已完成

## 1. 目标

让“最近”页展示的最近视频自动进入 `fresh` 路径，完成字幕清洗、本地总结、质量门控和邮件转发；同时恢复历史补全持续向队列补旧视频的能力。

## 2. 背景

当前用户观察到最近页有 9 条视频没有自动开始；同时开启自动同步后，历史视频也没有持续进入清洗队列。

## 3. 本次范围

- 检查 fresh 最近视频发现逻辑是否被 24 小时时间窗、启动时机、队列去重或历史补足逻辑限制。
- 检查历史补全是否被失败 / 跳过项、重复候选、队列容量或启动调度挡住。
- 调整自动发现策略，使最近列表视频走 `queueSource: 'fresh'`，历史补全走 `queueSource: 'history'`。
- 补充自动检查，验证最近视频和历史补全都会生成可领取队列项。

## 4. 明确不做

- 不读取或输出 Cookie、API Key、SMTP 授权码等秘密值。
- 不删除、迁移或改写 `data/materials` 真实资料。
- 不修改字幕清洗、MiMo、本地 Ollama、邮件发送正文和模型调用实现。
- 不把历史视频改成邮件发送；邮件转发仍只走 `fresh`。

## 5. 验收标准

- [x] 最近列表候选视频不再因为 24 小时时间窗被跳过。
- [x] 最近列表候选视频以 `fresh` 入队。
- [x] 历史补全在队列空闲时能继续补 `history` 视频。
- [x] 启动或恢复自动同步后不必等整点才开始检查。
- [x] 相关检查和类型检查通过。

## 6. 相关文件和数据

- `desktop/electron/main.ts`
- `desktop/electron/runtime/automationController.ts`
- `desktop/electron/providers/sourceDiscovery.ts`
- `desktop/electron/providers/sourceDiscoveryRuntime.ts`
- `desktop/electron/queue/workbenchQueue.ts`
- `desktop/scripts/`

## 7. 风险

- 最近视频自动入队会增加真实清洗和模型调用数量；本次只调整调度规则，不直接运行真实队列。
- 如果 fresh 范围过宽，可能发送过多邮件；本次以最近页列表为边界，而不是全量历史。

## 8. 验证方式

- 自动测试：新增或更新自动同步检查脚本。
- 类型检查：`npx tsc --noEmit`。
- 打包验证：如代码修改完成，重新生成便携版并运行 smoke test。

## 9. 完成记录

完成时间：2026-07-01

- 根因 1：fresh 自动发现使用 24 小时时间窗，导致“最近”列表中较早但仍可见的视频不会进入清洗队列。
- 根因 2：应用启动和自动同步从暂停恢复时只刷新下次定时器，没有立即触发一次检查。
- 根因 3：当前队列已达到 200 条上限，且全部为 `done / failed` 终态记录；历史补全发现的新 `history` 任务追加在末尾后会被上限裁掉。
- 处理：fresh 发现改为从各 UP 最近页汇总候选，按发布时间排序，最多取 9 条未知视频入 `fresh` 队列；首页最近列表同步显示 9 条。
- 处理：应用启动后立即执行 `startup` 检查；自动同步恢复后约 300ms 触发下一次检查。
- 处理：追加队列项时优先保留 `queued / processing` 和本次新增项，再保留已完成 / 已失败等终态记录，避免满队列挡住历史补全。
- 验证：`node desktop/scripts/check-recent-and-history-autopilot.mjs`、`node desktop/scripts/check-up-sync-scheduler.mjs`、`node desktop/scripts/check-auto-sync-idle-backfill-loop.mjs`、`node desktop/scripts/check-fresh-email-delivery.mjs`、`node desktop/scripts/check-subtitle-only-queue-mode.mjs`、`npx tsc --noEmit`、`npm run build:portable`、`node desktop/scripts/check-packaged-portable-smoke.mjs` 均通过；`git diff --check` 仅有 Windows 换行提示。

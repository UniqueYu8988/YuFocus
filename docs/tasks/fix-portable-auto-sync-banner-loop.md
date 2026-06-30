# 任务：修复便携版最近页自动同步条幅循环闪烁

创建日期：2026-07-01
状态：已完成

## 1. 目标

修复便携版启动后，“最近”页顶部自动同步状态条幅持续闪烁、自动同步看起来无法稳定开启的问题。

## 2. 背景

运行日志显示便携版在短时间内连续触发 `idle-backfill` 空闲补足。该状态会让最近页顶部条幅反复进入“正在同步”状态。

## 3. 本次范围

- 限制重复历史视频被发现时触发队列处理。
- 保持真正有可领取队列项时仍会自动处理。
- 增加最小检查脚本，防止空闲补足循环回归。

## 4. 明确不做

- 不修改字幕清洗、模型调用、邮件发送逻辑。
- 不删除、迁移或改写 `data/materials` 真实资料。
- 不读取或输出 Cookie、API Key、SMTP 授权码等秘密值。

## 5. 验收标准

- [ ] 重复视频不会触发队列处理循环。
- [ ] 发现真正新视频后仍能安排队列处理。
- [ ] 最近页状态条幅不会因空闲补足反复闪烁。
- [ ] 相关 TypeScript 检查通过。

## 6. 相关文件和数据

- `desktop/electron/queue/workbenchQueueStore.ts`
- `desktop/electron/runtime/automationController.ts`
- `desktop/scripts/`
- `desktop/release/data/logs/runtime.log` 仅作为只读诊断线索。

## 7. 风险

- 如果调度收得过紧，历史补足可能不再连续处理；本次只避免重复项触发循环，保留有可领取任务时的自动处理。

## 8. 验证方式

- 自动测试：新增空闲补足防循环检查。
- 人工验收：观察便携版顶部状态条幅不再持续闪烁。
- 构建或类型检查：`npx tsc --noEmit`。

## 9. 完成记录

2026-07-01 完成。

- `workbenchQueueStore.appendQueueItems` 增加“追加前后队列未变化”判断，重复历史视频不会触发保存、广播和队列处理。
- `automationController.runCheck` 在发现结果非空后，会根据追加后的队列确认是否存在可领取任务；只有真正可处理时才安排队列处理。
- 新增 `desktop/scripts/check-auto-sync-idle-backfill-loop.mjs`，覆盖重复历史项不启动队列、真正新项仍启动队列。
- 已重新生成便携版 `desktop/release/视界专注_v0.1.0_x64.exe` 和分享包。

验证：

- `node desktop/scripts/check-auto-sync-idle-backfill-loop.mjs`
- `node desktop/scripts/check-up-sync-scheduler.mjs`
- `node desktop/scripts/check-home-dashboard-safety.mjs`
- `npx tsc --noEmit`
- `npm run build:portable`
- `node desktop/scripts/check-packaged-portable-smoke.mjs`

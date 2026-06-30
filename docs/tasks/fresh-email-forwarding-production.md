# 最近更新邮件转发生产化任务

创建日期：2026-06-30

## 背景

近期实验结论已经明确：

1. `exports/notebooklm.md` 资料层应继续由 MiMo 做高保真清洗，目标是完整、逐字、可追溯，不追求 UP 定制压缩。
2. 本地模型不适合直接替代 MiMo 做资料层清洗，但适合读取 MiMo 清洗稿后生成 `brief.local.md`。
3. 本地总结需要更大的输入 / 输出预算，并配合事实锚点和质量门控。
4. 邮件推送适合作为“最近更新提醒”，不适合作为历史补全的全部视频轰炸邮箱。

因此下一阶段目标是把这条路线落到生产软件中：

```text
fresh 新视频
→ 转写 / 字幕获取
→ MiMo 高保真逐字清洗 notebooklm.md
→ 本地模型生成 brief.local.md
→ 质量门控
→ 通过后发送邮件

history 历史补全
→ 转写 / 字幕获取
→ MiMo 高保真逐字清洗 notebooklm.md
→ 本地模型生成 brief.local.md
→ 不发送邮件
```

## 目标

- 取消“单个 UP 定制 MiMo 清洗提示词”进入生产清洗路线的方向，回归通用高保真逐字清洗。
- 保留 MiMo UP 定制实验资料作为历史参考，但不允许正式队列使用 UP 定制清洗 prompt。
- 升级本地总结提示词和参数，使其更接近本轮实验中的“事实门控版”。
- 恢复邮件转发能力，但只针对最近更新视频，即队列来源 `fresh`。
- 历史补全 `history`、手动 `manual`、重试 `retry`、关注来源普通补入 `follow_source` 默认不自动发送邮件。
- 邮件正文读取本地总结产物，不重新调用旧 Summary Pipeline。

## 明确不做

- 不恢复旧精读稿 Summary Pipeline。
- 不恢复 TTS。
- 不把历史补全视频批量发送到邮箱。
- 不把邮件发送失败视为资料生成失败。
- 不把 SMTP 密码、授权码、Cookie、MiMo Key 写进日志、报告或产物。
- 不删除已有 `data/materials` 资料。
- 不批量重跑已有历史材料。

## 主要风险

| 风险 | 处理 |
|---|---|
| 误发历史补全邮件 | 发送前必须检查队列来源，只允许 `fresh` |
| 邮件重复发送 | 写入 `delivery/email_status.json`，同一资料已发送则跳过 |
| 邮件正文事实漂移 | 本地总结使用事实锚点、禁止项和质量门控，不通过则不发送 |
| SMTP 密码泄露 | 不打印配置值；日志只写状态和错误类型 |
| 邮件发送失败阻塞队列 | 邮件失败只记录状态，不影响资料包完成 |
| UP 定制清洗路线误入生产 | 移除或显式禁用正式清洗 profile 注入点，并增加静态检查 |

## 验收标准

### 清洗路线

- 正式 MiMo 清洗 prompt 不再包含 UP 专属清洗策略。
- 生产材料包中的清洗 metadata 不再出现正式 `cleaning_profile`。
- MiMo prompt lab 只能作为历史实验脚本存在，不能被队列调用。

### 本地总结

- `exports/brief.local.md` 使用更高的上下文和输出预算。
- brief 提示词包含事实严谨要求、禁止模型自我分析、禁止编造精确日期/数字。
- 质量门控能识别过短、截断、自我分析、秘密泄露和明显风险。

### 邮件发送

- 只有 `queueSource === 'fresh'` 的队列项，才会在资料和本地总结完成后尝试发邮件。
- `history` 队列项生成资料和 brief，但不会发送邮件。
- 发送前必须满足：
  - `email_push_enabled === true`
  - SMTP 配置完整；
  - 收件人有效；
  - `delivery/email.md` 或 `exports/brief.local.md` 存在；
  - `delivery/decision.json` 和质量结果未明确拒绝；
  - `delivery/email_status.json` 未显示已发送同一版本。
- 邮件发送成功 / 跳过 / 失败均写入 `delivery/email_status.json`。
- 邮件失败不把队列项改成 failed。

### 验证

- 静态检查覆盖：fresh-only 发送、history 禁止发送、SMTP 秘密不进日志、重复发送保护。
- TypeScript 类型检查通过。
- 至少一个受控假 SMTP 或 dry-run 验证通过。
- 如进行真实邮箱测试，只允许 1 条 fresh 小样本，并在发送前明确记录使用 dry-run 或真实发送。

## 相关文件候选

- `src/distiller.py`
- `desktop/src/domain/localConsumption.ts`
- `desktop/electron/services/localConsumptionRunner.ts`
- `desktop/electron/services/localOllamaAdapter.ts`
- `desktop/electron/queue/queueExecutor.ts`
- `desktop/electron/runtime/automationRuntime.ts`
- `desktop/electron/runtime/settings.ts`
- `desktop/electron/main.ts`
- `desktop/src/ui/pages/WorkspacePaneUtils.ts`
- 新增邮件服务文件候选：`desktop/electron/services/emailDeliveryService.ts`
- 新增检查脚本候选：`desktop/scripts/check-fresh-email-delivery.mjs`

## 当前状态

已完成生产化改造和收束验证，详细计划见：

`docs/plans/fresh-email-forwarding-production-plan.md`

完成内容：

- `src/distiller.py`：正式无 profile 清洗 prompt 已明确为“通用高保真逐字清洗”，UP profile 仅保留为实验性策略。
- `desktop/src/domain/localConsumption.ts`：brief / email prompt 已升级到事实门控版，默认本地模型超时提高，并明确 email 是 brief 的轻包装，不重新发明事实。
- `desktop/electron/services/localOllamaAdapter.ts`、`desktop/electron/services/localConsumptionRunner.ts`：本地 Markdown 生成预算已提高，brief 优先使用更长上下文和输出预算。
- `desktop/electron/services/emailDeliveryService.ts`：新增 fresh-only 邮件发送服务，支持 dry-run、重复发送保护、质量门控、敏感词检查、SMTP 发送和敏感错误脱敏；邮件正文不附带本机材料路径。
- `desktop/electron/queue/queueExecutor.ts`、`desktop/electron/runtime/automationRuntime.ts`、`desktop/electron/main.ts`：邮件服务已接入队列完成后路径，只有 `fresh` 队列项且本地总结成功时才尝试邮件推送；历史补全、手动、重试和普通来源补入不发送。
- `desktop/src/ui/panels/workspace/SettingsBlocks.tsx`、`desktop/src/ui/panels/workspace/SettingsPaneParts.tsx`：设置页恢复最近更新邮件推送的最小 SMTP 配置入口，文案说明历史补全不发送。
- `desktop/package.json`、`desktop/package-lock.json`：新增 `nodemailer` 和类型依赖，原因是 SMTP 客户端不适合自写维护。
- `desktop/scripts/check-mimo-cleaning-production-mode.mjs`、`desktop/scripts/check-fresh-email-delivery.mjs`：新增生产清洗模式和 fresh-only 邮件检查脚本。

已验证：

- `python -m py_compile src/distiller.py`
- `node desktop/scripts/check-mimo-cleaning-production-mode.mjs`
- `node desktop/scripts/check-fresh-email-delivery.mjs`
- `node desktop/scripts/check-local-consumption-layer.mjs`
- `node desktop/scripts/check-local-ollama-adapter.mjs`
- `node desktop/scripts/check-subtitle-only-queue-mode.mjs`
- `node desktop/scripts/check-product-refactor-surface.mjs`
- `node desktop/scripts/check-home-dashboard-safety.mjs`
- `node desktop/scripts/check-up-sync-scheduler.mjs`
- `node desktop/scripts/check-queue-record-feed.mjs`
- `node desktop/scripts/check-efficiency-observability.mjs`
- `npx tsc --noEmit`
- `git diff --check`（仅 Windows 换行提示，退出码 0）

待后续人工小样本：

- 如用户决定开启真实 SMTP，先只用 1 条 `fresh` 最近更新视频做真实发送验收；本任务已用 dry-run 覆盖发送链路，不主动真实发信。

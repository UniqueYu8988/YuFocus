# 任务：档案页按 MiMo Credits 展示消耗

创建日期：2026-07-01
状态：已完成

## 1. 目标

把档案和队列中面向用户展示的 token 消耗，从原始模型 token 改为按 MiMo Token Plan 倍率估算的 Credits，使界面数值更接近 MiMo 控制台的真实扣费口径。

## 2. 背景

当前 `metrics.json` 保存输入 token、输出 token 和总 token。界面展示的是原始 `total_tokens`，没有按 MiMo Token Plan 的输入 / 输出倍率折算，因此和 MiMo 控制台 Credits 差距明显。

## 3. 本次范围

- 在材料计量读取层增加 MiMo Credits 估算字段。
- 前端类型补充对应字段。
- 档案总览和档案单条记录显示 MiMo Credits。
- 队列中已完成记录的消耗提示同步使用 MiMo Credits。
- 更新现有效率观测检查脚本。

## 4. 明确不做

- 不调用 MiMo、不读取或输出 API Key。
- 不重跑已有视频。
- 不修改已有 `metrics.json` 文件。
- 不改变真实队列、清洗、邮件和删除逻辑。

## 5. 验收标准

- [x] 原始 token 字段仍保留在内部数据中。
- [x] 用户界面展示 MiMo Credits 而不是 raw total token。
- [x] TypeScript 类型检查通过。
- [x] 相关静态检查通过。

## 6. 相关文件和数据

- `desktop/electron/services/materialStats.ts`
- `desktop/electron/services/materialInventory.ts`
- `desktop/src/vite-env.d.ts`
- `desktop/src/ui/pages/WorkspacePaneUtils.ts`
- `desktop/src/ui/panels/workspace/ArchivePaneParts.tsx`
- `desktop/scripts/check-efficiency-observability.mjs`

## 7. 风险

- 旧材料的 `metrics.json` 不一定记录具体 MiMo 模型和缓存命中情况，本次只能用当前 MiMo Token Plan 的标准倍率做估算。
- 如果 MiMo 后续调整倍率，需要更新代码中的倍率常量。

## 8. 验证方式

- 自动测试：`node desktop/scripts/check-efficiency-observability.mjs`
- 构建或类型检查：`npx tsc --noEmit`

## 9. 完成记录

- 新增 `metricsMimoCredits` 字段，读取材料清单时按 `input_tokens * 100 + output_tokens * 200` 估算 MiMo Token Plan Credits。
- 如果旧记录只有 `total_tokens`、没有输入 / 输出拆分，则用 `total_tokens * 100` 作为保守兜底。
- 档案顶部统计、档案单条记录和队列已完成记录的展示改为 MiMo Credits；原始 `metricsInputTokens`、`metricsOutputTokens`、`metricsTotalTokens` 仍保留。
- 已运行 `node desktop/scripts/check-efficiency-observability.mjs`、`node desktop/scripts/check-archive-up-grouping.mjs` 和 `npx tsc --noEmit`，结果通过。
- 已重新生成 `desktop/release/视界专注_v0.1.0_x64.exe`，并补齐 `desktop/release/视界专注_v0.1.0_share.zip`；`node desktop/scripts/check-packaged-portable-smoke.mjs` 通过。

# 计划：自动抓取 / 转录 → MiMo 清洗 → 本地总结闭环补丁

## 原则

这次不是新增另一个实验脚本，而是把已验证的能力接入正式链路，同时删除不该自动触发的旧 MiMo 精读稿成本。

## 阶段 1：关闭旧 MiMo 精读稿误触发

### 现状

`src/distiller.py` 的材料包生成函数在写完 `content.md` / `exports/notebooklm.md` 后，仍直接调用：

```text
build_editorial_summary_content(...)
```

因此即使桌面端传入 `--material-only`，短视频仍可能生成旧 `summary/`。

### 改法

- 让材料包生成函数接收 `material_only` 或等价参数。
- `material_only=True` 时：
  - 不调用 `build_editorial_summary_content()`；
  - `manifest.editorial_summary.status` 写为 `skipped`；
  - `reason` 写明 `subtitle_only_material_package`；
  - 不生成新的 `summary/` 旧精读稿。
- `--summarize-material` 兼容入口保留，作为人工旧兼容能力。

## 阶段 2：抽出本地总结正式服务

### 现状

`desktop/scripts/generate-local-ollama-samples.mjs` 已经能生成 brief/email/decision/quality，但只写：

```text
data/temp/local-ollama-samples/
```

### 改法

新增主进程服务，例如：

```text
desktop/electron/services/localConsumptionRunner.ts
```

职责：

- 读取材料包 `exports/notebooklm.md`、`raw_transcript.txt`、`manifest.json`；
- 复用 `desktop/src/domain/localConsumption.ts` 的 profile、prompt 和缓存 key；
- 复用 `desktop/electron/services/localOllamaAdapter.ts`；
- 写入正式材料包；
- 输出结构化结果给队列执行器。

## 阶段 3：正式产物路径

写入：

```text
exports/brief.local.md
delivery/email.md
delivery/decision.json
delivery/email_status.json
work/brief/local_brief.meta.json
work/quality/local_check.json
work/quality/local_check.meta.json
work/local_consumption/run_meta.json
```

说明：

- `delivery/email.md` 只是邮件草稿，不发送。
- `decision.json` 只用于判断是否值得后续推送或复核。
- `quality_check` 是门控结果，不删除主资料。

## 阶段 4：接入队列

在 `desktop/electron/queue/queueExecutor.ts` 中：

- subtitle-only 材料生成或复用完成后，调用 `runLocalConsumption(materialPath)`；
- 本地总结成功：队列仍 `done`；
- 本地总结 quality 高风险：队列仍 `done`，但 `lastError` 或新增元信息显示“本地总结需复核”；
- 本地总结失败：默认不让字幕材料失败，可记录为 `local_consumption_failed`，除非是配置类硬失败。

## 阶段 5：状态与指标

更新正式材料包：

- `manifest.files` 加入本地总结文件路径；
- `manifest.local_consumption` 写状态、profile、artifact 路径、质量结果；
- `metrics.stages.local_consumption` 写耗时、artifact 耗时和质量风险；
- `run_state` 写本地总结状态和下一步建议。

## 阶段 6：检查与回归

新增检查脚本：

```text
desktop/scripts/check-local-consumption-closure.mjs
```

覆盖：

- `--material-only` 不应触发旧 summary；
- 队列 subtitle-only 后置调用本地总结；
- 本地总结正式写入材料包而不是 `data/temp`；
- 本地总结失败/高风险不破坏 NotebookLM 主资料；
- 不包含邮件发送、TTS、Obsidian、密钥输出。

必跑：

```text
node --experimental-strip-types --no-warnings scripts/check-local-consumption-closure.mjs
node --experimental-strip-types --no-warnings scripts/check-local-ollama-adapter.mjs
node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs
node --experimental-strip-types --no-warnings scripts/check-product-refactor-surface.mjs
npx tsc --noEmit
python -m py_compile src/distiller.py
```

真实回归：

- 选择约 10 分钟、未处理或可安全重跑的视频；
- 完整跑：

```text
视频 → 字幕/转写 → MiMo 清洗 → 本地总结正式产物
```

- 记录各阶段耗时。

## 风险

| 风险 | 处理 |
|---|---|
| 本地 Ollama 未启动 | 本地总结记为 failed，不破坏 NotebookLM 主资料 |
| quality 高风险 | 标记需复核，不阻塞队列完成 |
| 旧 summary 仍被触发 | 静态检查 + 真实回归检查 `summary/` 更新时间 |
| 写错材料目录 | 路径必须限制在当前 materialPath 内 |
| 泄露密钥 | 不读取/写出 Electron Store 秘密字段，只使用 Ollama 本地 endpoint |

## 执行记录

2026-06-30 已执行完成。

### 阶段结果

1. 关闭旧 MiMo 精读稿误触发：完成。`save_material_package(..., skip_editorial_summary=True)` 在 material-only 下写入 skipped 状态，不再调用旧 summary 生成。
2. 抽出正式本地总结服务：完成。新增 `desktop/electron/services/localConsumptionRunner.ts`，正式写入材料包，不写 `data/temp`。
3. 正式产物路径：完成。已写入 `exports/brief.local.md`、`delivery/email.md`、`delivery/decision.json`、`delivery/email_status.json`、`work/brief/local_brief.meta.json`、`work/quality/local_check.json`、`work/quality/local_check.meta.json`、`work/local_consumption/run_meta.json`。
4. 接入队列：完成。subtitle-only 材料完成后自动调用本地消费层；本地消费层复核/失败不破坏 NotebookLM 主资料。
5. 状态与指标：完成。`manifest.local_consumption`、`metrics.stages.local_consumption`、`run_state.local_consumption_status` 已可读。
6. 检查与回归：完成。新增 `check-local-consumption-closure.mjs`，并通过类型检查、Python 语法检查、队列/自动同步/效率观测回归。

### 真实回归摘要

`BV1MBjx6cEHw` 完整链路：

```text
B 站元数据 0.63s
→ 字幕抓取 0.05s，未获取到字幕
→ SenseVoice 音频补全 33.20s
→ MiMo 清洗 / 材料写入约 22.00s
→ 本地 Ollama brief/email/decision/quality 18.476s
→ 正式材料包状态 local_consumption_ready
```

旧 summary 回归：

```text
summary/article.md        不存在
summary/meta.json         不存在
summary/summary_status.json 不存在
manifest.editorial_summary.status = skipped
manifest.editorial_summary.reason = subtitle_only_material_package
```

### 发现并修正

- 初版 quality_check 会把“可用但不完美”的产物误判为 high risk，并自行脑补英文缺失术语。已升级规则为 `shijie.local-quality-rule.v0.4`，限制缺失术语只能来自候选原词。
- 初版 `run_state` 把 `needs_review` 映射成 `local_consumption_failed`。已改为 `local_consumption_needs_review`，并让缓存命中时也刷新 `manifest`、`metrics`、`run_state`。
- `check-efficiency-observability.mjs` 对档案统计栏写法检查过于死板，已更新为识别当前对象数组实现。

# 任务：自动抓取 / 转录 → MiMo 清洗 → 本地总结闭环补丁

## 背景

2026-06-30 使用约 10 分钟真实视频 `BV1toJ36aE9o` 做压测，手动串联了：

```text
B 站视频 → SenseVoice 转写 → MiMo 字幕清洗 → 本地 Ollama brief/email/decision/quality
```

结果证明各段能力都可用，但暴露出三个必须修的问题：

1. `--material-only` 仍会触发旧 MiMo 精读稿 `summary/`，额外消耗约 79.55 秒和约 22722 tokens。
2. 本地 Ollama 总结只存在于临时样本脚本，未接入正式队列完成链路。
3. 本地 quality_check 能发现高风险，但结果未写入正式材料包，也不会在队列/档案中形成稳定状态。

## 目标

让后台自动运行真正形成目标闭环：

```text
自动发现/手动入队
→ 字幕获取或 SenseVoice 转写
→ MiMo 忠实清洗
→ NotebookLM 主资料
→ 本地 Ollama 生成 brief/email/decision/quality
→ 写入正式材料包
→ 记录耗时、质量状态和复核提示
```

## 范围

- 修改 `src/distiller.py`，确保 `--material-only` / subtitle-only 不再自动生成旧 MiMo 精读稿。
- 把本地 Ollama 消费层从临时样本脚本抽成正式主进程服务。
- 队列中 subtitle-only 视频完成 `content_ready` 后，自动调用本地总结服务。
- 本地总结产物写入正式材料包：

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

- 更新 `manifest.json`、`metrics.json`、`run_state.json` 或等价状态文件，让 UI 和后续检查可读。
- 增加静态/脚本检查，防止旧 summary 回流、防止本地总结写到 `data/temp` 后被误认为正式产物。
- 使用一个约 10 分钟真实视频做最终回归，记录各环节耗时。

## 不做

- 不恢复邮件发送。
- 不恢复 TTS。
- 不删除、移动或重命名已有 `data/materials`。
- 不把本地总结失败当成字幕资料失败；字幕清洗完成仍应保留。
- 不在报告、日志或产物中写入 API Key、Cookie、SMTP 授权码或本机敏感配置。
- 不拆分整个 `src/distiller.py` 或 `WorkspacePane.tsx`。

## 验收标准

1. 新 subtitle-only 队列项完成后，正式材料包内出现本地总结产物。
2. `--material-only` 不再生成或更新旧 `summary/article.md`、`summary/meta.json` 等旧 MiMo 精读稿。
3. `metrics.json` 能读到：
   - content cleaning 耗时和 token；
   - local consumption 总耗时；
   - brief/email/decision/quality 各自耗时；
   - quality 风险等级。
4. `run_state.json` 能表达本地总结状态：
   - `local_consumption_ready`；
   - 或 `local_consumption_needs_review`；
   - 或 `local_consumption_failed`。
5. 队列失败重试仍只针对真正失败的字幕/材料生成；本地总结高风险不让材料任务失败。
6. 静态检查和类型检查通过。
7. 真实约 10 分钟视频回归完成，并记录各环节耗时。

## 完成记录

2026-06-30 已完成补丁式修复。

### 已完成

- `--material-only` / subtitle-only 材料生成不再自动触发旧 MiMo 精读稿；新样本 `BV1MBjx6cEHw` 未生成 `summary/article.md`、`summary/meta.json`、`summary/summary_status.json`。
- 新增正式本地消费层服务，读取正式材料包 `exports/notebooklm.md` 和 `raw_transcript.txt`，调用本地 Ollama `shijie-qwen3-8b-q4-chat`，并写回正式材料包。
- 队列 subtitle-only 材料完成后会自动尝试本地 brief / email 草稿 / decision / quality_check；本地消费层失败或需复核不会让 NotebookLM 主资料失败。
- `manifest.json`、`metrics.json`、`run_state.json` 已记录本地消费层状态、模型名、各产物耗时和质量门控结果。
- quality_check 规则升级到 `shijie.local-quality-rule.v0.4`，限制 `missingCriticalTerms` 只能来自关键术语候选，避免模型脑补英文术语导致误判。

### 真实回归

新样本：`BV1MBjx6cEHw`，标题《全球椅子大排名，谁最舒适？》，约 10 分钟。

| 环节 | 耗时 |
|---|---:|
| 材料生成总耗时 | 57.207 秒 |
| 元数据 | 0.63 秒 |
| 字幕抓取 | 0.05 秒 |
| SenseVoice 音频补全 | 33.20 秒 |
| MiMo 清洗 / 材料写入 | 21.961 / 22.00 秒 |
| 本地 Ollama 消费层总耗时 | 18.476 秒 |
| brief | 7.375 秒 |
| email 草稿 | 6.611 秒 |
| decision | 1.880 秒 |
| quality_check | 2.585 秒 |

结果：`local_consumption.status=ok`，`quality.riskLevel=low`，旧 summary 未生成，`metrics.totals.total_tokens=3263`。

补充样本：`BV1toJ36aE9o` 重新使用新 quality 规则验证，本地消费层 `status=ok`，`riskLevel=low`。

### 验证

- `npx tsc --noEmit`
- `python -m py_compile src\distiller.py`
- `node --experimental-strip-types --no-warnings scripts\check-local-consumption-closure.mjs`
- `node --experimental-strip-types --no-warnings scripts\check-local-ollama-adapter.mjs`
- `node --experimental-strip-types --no-warnings scripts\check-subtitle-only-queue-mode.mjs`
- `node --experimental-strip-types --no-warnings scripts\check-product-refactor-surface.mjs`
- `node --experimental-strip-types --no-warnings scripts\check-up-sync-scheduler.mjs`
- `node --experimental-strip-types --no-warnings scripts\check-efficiency-observability.mjs`

`git diff --check` 通过，仅保留 Windows 换行转换提示。

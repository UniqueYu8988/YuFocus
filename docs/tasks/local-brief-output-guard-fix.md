# 任务：本地 brief / email 输出门控补丁

## 背景

2026-06-30 验证中文样本 `BV1i5jy6bECe` 时，NotebookLM 清理稿质量正常，但本地 `exports/brief.local.md` 和 `delivery/email.md` 出现两个问题：

1. 输出了“我现在需要处理用户提供的资料……”这类模型自我分析过程，而不是最终简报。
2. 输出明显过短且在半句话处截断，不能作为可读总结稿。

这说明当前本地消费层只验证 JSON 类产物，对 Markdown 类产物缺少成稿质量门控。

## 目标

修复本地 brief / email 生成层，让中文正常场景能够得到完整、可读、无自言自语的正式总结稿。

## 范围

- 调整本地模型 brief / email 的生成预算，避免 256 token 导致短文截断。
- 为 brief / email 增加输出质量检查：
  - 检测“我现在需要”“首先我会”“用户希望”等过程性文字；
  - 检测明显截断；
  - 检测输出过短；
  - 检测缺少基本 Markdown 结构。
- 当 brief / email 不合格时，自动使用更严格提示词重试一次。
- 更新检查脚本，防止该问题回流。
- 用中文样本 `BV1i5jy6bECe` 重跑本地总结层，核验返回质量。

## 不做

- 不修改 MiMo 清洗主线。
- 不重跑或覆盖 `exports/notebooklm.md`。
- 不恢复邮件发送。
- 不处理 TED / 英文视频 ASR 问题。
- 不引入新依赖或更换本地模型。

## 验收标准

1. `brief.local.md` 不再以自我分析过程开头。
2. `brief.local.md` 是完整 Markdown 简报，不在半句处截断。
3. `delivery/email.md` 同样不输出过程性文字。
4. 中文样本本地消费层状态为 `ok`。
5. 相关类型检查和本地消费层检查脚本通过。

## 完成记录

2026-06-30 已完成。

### 已修复

- 本地 Ollama Markdown 默认输出预算从 `256` 提高到 `1024`，避免 brief / email 在半句话处被截断。
- brief / email prompt 版本升级到：
  - `shijie.local-brief-prompt.v0.2`
  - `shijie.local-email-prompt.v0.2`
- 新增 Markdown 成稿门控：
  - 检测“我现在需要 / 首先我会 / 用户希望 / 接下来我”等过程性文字；
  - 检测输出过短；
  - 检测缺少 Markdown 标题；
  - 检测半句截断。
- 当 brief / email 未通过门控时，会用更严格的“只输出最终成稿”提示词自动重试一次，重试输出预算为 `1536`。
- 更新 `check-local-consumption-closure.mjs` 和 `check-local-ollama-adapter.mjs`，防止默认预算和成稿门控回退。

### 中文样本复测

样本：`BV1i5jy6bECe`《一个视频讲清楚，API 和 SDK，到底什么区别》，UP 主 `杨彧鑫AI`。

复测只重跑本地消费层，不覆盖 MiMo 清洗稿。

| 产物 | 结果 |
|---|---|
| `exports/brief.local.md` | 1100 字，含 Markdown 标题和完整结构，无过程性文字 |
| `delivery/email.md` | 558 字，含 Markdown 标题和完整结构，无过程性文字 |
| `delivery/decision.json` | `worthEmail=true`，`importance=5` |
| `work/quality/local_check.json` | `ok=true`，`riskLevel=low` |
| 本地消费层耗时 | 约 55.1 秒 |

### 验证

- `npx tsc --noEmit`
- `python -m py_compile src\distiller.py`
- `node --experimental-strip-types --no-warnings scripts\check-local-consumption-closure.mjs`
- `node --experimental-strip-types --no-warnings scripts\check-local-ollama-adapter.mjs`
- `node --experimental-strip-types --no-warnings scripts\check-subtitle-only-queue-mode.mjs`
- `node --experimental-strip-types --no-warnings scripts\check-product-refactor-surface.mjs`
- `git diff --check` 通过，仅有 Windows 换行转换提示。

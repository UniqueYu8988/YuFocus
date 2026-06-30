# 任务：本地消费层第一阶段

## 背景

当前主线已经收束为 UP 主驱动的字幕清洗和 NotebookLM 导出。用户确认：MiMo 仍应作为高质量主资料处理的主力，本地模型不应极端替代 MiMo；更合理的方式是让本地模型先负责消费层和门控，避免把昂贵 API 浪费在简单任务上。

## 目标

建立第一阶段的最小可验证地基：

1. 不破坏 `exports/notebooklm.md` 主资料流程。
2. 定义本地 brief、email、decision、quality check 的标准产物位置。
3. 定义本地消费层缓存 key 需要包含的边界：NotebookLM hash、UP profile hash、本地模型名、提示词版本、brief hash。
4. 定义首批 UP 内容 profile：新闻资讯、技术教程、观点知识、演讲和通用。
5. 定义本地模型请求计划：未来可接 Ollama、LM Studio 或 OpenAI-compatible 本地服务，但当前只生成请求结构，不真实调用。
6. 增加静态检查，防止本地消费层误接旧 summary/email 主流程或在 domain 层直接发起网络调用。

## 不做

- 不恢复旧邮件发送。
- 不调用本地模型、MiMo、B 站或外部 API。
- 不写入、删除或改写真实 `data/materials` 资料包。
- 不改变队列、自动同步和 NotebookLM 主资料生成。
- 不读取或输出任何 API Key、Cookie、SMTP 授权码。

## 第一阶段产物约定

```text
exports/brief.local.md
work/brief/local_brief.meta.json
delivery/email.md
delivery/email_status.json
delivery/decision.json
work/quality/local_check.json
```

## 缓存边界

- `brief.local.md`：依赖 `notebooklm.md` hash、UP profile hash、本地模型名、brief prompt 版本。
- `email.md`：依赖 `brief.local.md` hash、UP profile hash、本地模型名、email prompt 版本。
- `decision.json`：依赖 `notebooklm.md` hash、UP profile hash、本地模型名、decision prompt 版本。
- `local_check.json`：依赖 `raw_transcript.txt` hash、`notebooklm.md` hash、质量检查规则版本。

## 完成记录

- 新增 `desktop/src/domain/localConsumption.ts`，用纯内存类型和函数固化本地消费层产物、UP profile、缓存 key 和质量门槛。
- 在同一 domain 文件中新增本地模型请求计划合约：只描述 provider、endpoint、model、prompt、response format 和 timeout，不在 domain 层调用 `fetch`、HTTP 客户端或子进程。
- 新增 `desktop/scripts/check-local-consumption-layer.mjs`，验证产物路径、UP profile 推断、缓存失效边界和基础 decision 草案。
- 新增 `desktop/scripts/generate-local-consumption-samples.mjs`，只读取已有 NotebookLM 材料，把演示版 brief / email / decision / quality 写入 `data/temp/local-consumption-samples/`；不写回真实材料包，不发送邮件。
- 本地模型提示词边界已收敛：
  - `brief` 只读取 NotebookLM 主资料；
  - `email` 只读取本地 brief；
  - `decision` 只读取 NotebookLM 摘录和 UP profile；
  - `quality_check` 只读取原始字幕摘录、NotebookLM 摘录和关键术语候选。

## 验证

- `cd desktop && node --experimental-strip-types --no-warnings scripts/check-local-consumption-layer.mjs`
- `cd desktop && node --experimental-strip-types --no-warnings scripts/generate-local-consumption-samples.mjs`

## 本轮验证结果

- `node --experimental-strip-types --no-warnings scripts/check-local-consumption-layer.mjs`：通过，覆盖本地模型请求计划、provider 规范化、提示词输入边界和 domain 层无外部调用。
- `node --experimental-strip-types --no-warnings scripts/generate-local-consumption-samples.mjs`：通过，生成 4 个临时样本目录：
  - `data/temp/local-consumption-samples/bv11fga6ke9y`
  - `data/temp/local-consumption-samples/bv1kk9kbaejv`
  - `data/temp/local-consumption-samples/bv1yslc6qecb`
  - `data/temp/local-consumption-samples/bv1tevn6aev8`
- `npx tsc --noEmit`：通过。
- `node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs`：通过。
- `node --experimental-strip-types --no-warnings scripts/check-product-refactor-surface.mjs`：通过。
- `git diff --check -- desktop/src/domain/localConsumption.ts desktop/scripts/check-local-consumption-layer.mjs desktop/scripts/generate-local-consumption-samples.mjs docs/tasks/local-consumption-layer-phase1.md docs/plans/local-model-consumption-layer-plan.md CURRENT_STATE.md PRODUCT.md ARCHITECTURE.md`：通过，仅有 Windows 换行提示。

## 数据安全说明

本轮只读取已有材料包的 `exports/notebooklm.md`、`raw_transcript.txt` 和 `manifest.json`，只写入 `data/temp/local-consumption-samples/` 临时样本目录；没有改写、删除、移动真实 `data/materials` 材料包，也没有发送邮件或调用任何模型。

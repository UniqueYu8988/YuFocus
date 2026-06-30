# 计划：本地 Ollama adapter 试接

## 一句话原则

先把本地模型当作“可失败的外部服务”接入临时样本链路，而不是当作主流程的一部分。只要它不稳定、不忠实或不可解析，就不进入真实材料包和后台队列。

## 当前已具备

- 本地消费层 domain 合约：
  - `LocalModelRequestPlan`
  - brief / email / decision / quality_check 四类请求边界
  - 本地消费层缓存 key
  - UP profile
- 本机 Ollama 服务：
  - 推荐模型：`shijie-qwen3-8b-q4-chat`
  - endpoint：`http://127.0.0.1:11434/api/chat`
  - 建议参数：`num_ctx=4096`、`num_predict=256`、`temperature=0.1`
- 模型目录：
  - 原始 GGUF：`C:\Users\Yu\AI\Cuda\models\Qwen3-8B-GGUF\Qwen3-8B-Q4_K_M.gguf`
  - Ollama 仓库：`C:\Users\Yu\AI\Cuda\ollama-models`

## 阶段 2.1：adapter 纯执行层

### 目标

新增一个只负责“执行请求计划”的 Ollama adapter。

### 设计

adapter 输入：

```text
LocalModelRequestPlan
```

adapter 输出：

```text
{
  ok: boolean,
  artifact: "brief" | "email" | "decision" | "quality_check",
  model: string,
  elapsedMs: number,
  content?: string,
  json?: unknown,
  error?: {
    code: string,
    message: string
  }
}
```

### 要求

- 不直接读取真实材料包。
- 不决定生成什么内容，只执行 domain 层已经生成的 request plan。
- 默认使用 `shijie-qwen3-8b-q4-chat`。
- 默认 `num_ctx=4096`。
- 对 brief / email 使用 `num_predict=256`。
- 对 decision / quality_check 使用 `num_predict=256`；实际验证中 160 容易截断 JSON。
- 统一过滤 `<think>...</think>`。
- JSON 输出必须解析，解析失败要返回结构化错误。

### 验收

- Ollama 未启动时返回可读错误。
- Ollama 启动时能返回 Markdown 或 JSON。
- 不写入 `data/materials`。
- 不调用 MiMo、B 站、SMTP 或 TTS。

## 阶段 2.2：临时样本生成脚本

### 目标

从现有材料包读取 NotebookLM 主资料，调用 adapter 生成真实本地模型样本，但只写入临时目录。

### 输入

只读：

```text
data/materials/{up_id}/{video_id}/exports/notebooklm.md
data/materials/{up_id}/{video_id}/raw_transcript.txt
data/materials/{up_id}/{video_id}/manifest.json
```

### 输出

只写：

```text
data/temp/local-ollama-samples/{video_id}/exports/brief.local.md
data/temp/local-ollama-samples/{video_id}/delivery/email.md
data/temp/local-ollama-samples/{video_id}/delivery/decision.json
data/temp/local-ollama-samples/{video_id}/work/quality/local_check.json
data/temp/local-ollama-samples/{video_id}/work/run_meta.json
```

### 样本选择

优先使用已有 4 类内容：

- 新闻资讯：橘鸦Juya；
- 技术教程：技术爬爬虾；
- 观点知识：罗胖罗振宇；
- 演讲：TED。

### 验收

- 至少生成 4 个样本目录。
- 每个样本都记录模型名、耗时、参数和缓存 key。
- 失败项写入错误元数据，不中断整个批次。

## 阶段 2.3：质量护栏检查

### 目标

建立“不胡编、不泄露、不破坏主流程”的自动检查。

### 检查项

- 输出中不包含 `<think>` 标签。
- brief 不包含输入中不存在的危险补充信息：
  - 新日期；
  - 新地点；
  - 新版本号；
  - 新显存占用；
  - 新速度。
- email 不引入 brief 之外的新事实。
- decision JSON 可解析，字段完整。
- quality_check JSON 可解析，且只标记风险，不覆盖主资料。
- 输出中不包含本机秘密路径、Cookie、API Key、SMTP 授权码。

### 验收

- 新增检查脚本通过。
- 本地消费层旧检查继续通过。
- subtitle-only 队列保护检查继续通过。

## 阶段 2.4：缓存和失败策略

### 目标

让本地模型试接具备后台化所需的基本稳定性。

### 缓存边界

缓存 key 至少包含：

- artifact；
- NotebookLM hash；
- raw transcript hash；
- brief hash；
- profile hash；
- model name；
- prompt version；
- adapter version；
- generation params。

### 失败策略

- Ollama offline：不重试风暴，直接记录 `ollama_offline`。
- timeout：记录 `timeout`，下次手动或脚本重跑可继续。
- JSON parse error：记录 `invalid_json`，保留原始输出到临时 meta。
- quality guard failed：记录 `quality_guard_failed`，不写入最终样本文件，只写入诊断。

### 验收

- 相同输入重复运行时可命中缓存或跳过已完成样本。
- 修改 prompt version 后会重新生成。
- 失败样本不影响其他样本。

## 阶段 2.5：人工评审点

### 目标

在进入真实材料包前，先让项目负责人看见真实输出质量。

### 评审材料

每个样本提供：

- 原 NotebookLM 摘录；
- 本地 brief；
- 本地 email；
- decision JSON；
- quality check；
- 耗时和模型参数。

### 进入下一阶段条件

只有同时满足以下条件，才进入“手动写入真实材料包”阶段：

- brief 信息密度可接受；
- email 可读但不胡编；
- decision JSON 稳定可解析；
- 失败能被记录和跳过；
- 不影响现有队列和 NotebookLM 主资料。

## 明确不做

- 不接入队列自动运行。
- 不在档案页加按钮。
- 不写入 `data/materials`。
- 不发送邮件。
- 不升级 Ollama。
- 不删除 `C:\Users\Yu\.ollama\models` 默认副本。

## 推荐执行顺序

1. 新增 adapter 纯执行层。
2. 新增 adapter 静态检查和 offline 检查。
3. 新增临时样本生成脚本。
4. 生成 4 类真实小样本。
5. 增加质量护栏检查。
6. 汇总输出质量和性能。
7. 决定是否进入真实材料包手动写入阶段。

## 回退方式

- 删除或停用 adapter 脚本即可。
- 临时样本位于 `data/temp/local-ollama-samples/`，不影响真实资料。
- 不需要回滚 `exports/notebooklm.md`，因为本阶段不会修改它。

## 执行结果

完成时间：2026-06-30

实际实现：

- `desktop/electron/services/localOllamaAdapter.ts`：Ollama adapter 纯执行层，支持超时、offline、HTTP error、invalid response、invalid JSON、`<think>` 清理和基础输出护栏。
- `desktop/scripts/check-local-ollama-adapter.mjs`：离线 / 假响应 / 静态红线检查，不依赖真实 Ollama 服务。
- `desktop/scripts/generate-local-ollama-samples.mjs`：真实小样本生成，只写入 `data/temp/local-ollama-samples/`。
- `desktop/src/domain/localConsumption.ts`：decision / quality_check JSON 提示词升级到 v0.3，缩短输入摘录并在末尾重复 schema。

真实样本：

- `data/temp/local-ollama-samples/bv11fga6ke9y`
- `data/temp/local-ollama-samples/bv1kk9kbaejv`
- `data/temp/local-ollama-samples/bv1yslc6qecb`
- `data/temp/local-ollama-samples/bv1tevn6aev8`

结论：

- brief / email 的本地生成稳定性初步可用。
- decision / quality_check 需要更硬的 JSON schema 提示；v0.3 后 4 个真实样本全部通过。
- 该阶段仍只适合作为临时样本链路，不应直接接入后台队列或真实材料包。

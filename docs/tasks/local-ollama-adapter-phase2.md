# 任务：本地 Ollama adapter 试接

## 背景

本地消费层第一阶段已经完成纯 domain 合约：产物路径、UP profile、缓存 key、本地模型请求计划和基础质量门槛已经存在。

本机 Ollama + Qwen3-8B Q4_K_M 已完成环境落地，当前推荐模型为：

```text
shijie-qwen3-8b-q4-chat
```

下一阶段需要把“请求计划”真正交给本地 Ollama 执行，但仍然不进入主流程、不写真实材料包、不发送邮件。

## 目标

建立一个最小可验证的 Ollama adapter：

1. 读取 `desktop/src/domain/localConsumption.ts` 生成的 `LocalModelRequestPlan`。
2. 调用 `http://127.0.0.1:11434/api/chat`。
3. 支持超时、输出长度限制、错误归一化和 `<think>...</think>` 清理。
4. 支持 Markdown 输出和 JSON 输出两类结果。
5. 先把真实模型输出写入 `data/temp/local-ollama-samples/`。
6. 只做离线样本验证，不接入队列、档案按钮或后台自动化。

## 不做

- 不改写 `data/materials` 下的真实材料包。
- 不覆盖 `exports/notebooklm.md`。
- 不恢复邮件发送。
- 不让本地模型接管 MiMo 字幕清洗。
- 不把 adapter 接入后台自动同步或队列执行器。
- 不删除默认 Ollama 仓库 `C:\Users\Yu\.ollama\models`。
- 不升级 Ollama；升级另开任务评估。

## 主要风险

| 风险 | 处理 |
|---|---|
| 模型离线或 Ollama 未启动 | adapter 返回结构化错误，不影响主流程 |
| Qwen3 输出 `<think>` 标签 | adapter 统一过滤 `<think>...</think>` |
| 模型补充原文没有的信息 | 增加“忠实性样本检查”：输入中没有的日期、地点、版本号不得出现在输出 |
| JSON 输出不可解析 | adapter 对 JSON 结果做解析校验，失败写入错误元数据 |
| 8GB 显存接近上限 | 默认 `num_ctx=4096`，`num_predict=160-256`，不做并发 |
| 本地模型长时间卡住 | 请求级 timeout，失败写入状态，不重试风暴 |

## 验收

### 离线保护

- Ollama 未启动时，检查脚本能得到可读错误。
- 不写入 `data/materials`。
- 不触发旧 Summary Pipeline、邮件发送或 TTS。

### 在线生成

- 使用 `shijie-qwen3-8b-q4-chat` 生成 4 类样本：
  - brief；
  - email；
  - decision；
  - quality_check。
- 样本只写入：

```text
data/temp/local-ollama-samples/
```

### 质量底线

- brief 不包含输入中没有的日期、地点、版本号、显存占用或速度。
- email 不补充 brief 之外的新事实。
- decision JSON 可被解析，字段至少包含：
  - `worthEmail`
  - `importance`
  - `reason`
  - `tags`
- 输出中不保留 `<think>` 标签。

## 预期产物

可能新增或修改：

- `desktop/electron/services/localOllamaAdapter.ts`
- `desktop/scripts/check-local-ollama-adapter.mjs`
- `desktop/scripts/generate-local-ollama-samples.mjs`
- `docs/plans/local-ollama-adapter-phase2-plan.md`
- `CURRENT_STATE.md`

实际文件以执行时的小步实现为准。

## 暂停条件

遇到以下情况应暂停并报告，不继续扩大范围：

- 模型连续输出明显胡编，无法通过提示词和输出限制约束。
- Ollama 服务不稳定或频繁卡死。
- 需要删除、迁移或覆盖真实资料包。
- 需要读取或展示 Cookie、API Key、SMTP 授权码等秘密值。
- 需要升级 Ollama 或更换模型才能继续。

## 完成记录

完成时间：2026-06-30

已完成：

- 新增 `desktop/electron/services/localOllamaAdapter.ts`，只负责执行 `LocalModelRequestPlan`，不读取材料包、不写文件、不接入队列。
- 新增 `desktop/scripts/check-local-ollama-adapter.mjs`，覆盖 Markdown / JSON、offline、timeout、HTTP error、invalid JSON、`<think>` 清理和静态红线。
- 新增 `desktop/scripts/generate-local-ollama-samples.mjs`，只读已有材料包，把真实本地模型样本写入 `data/temp/local-ollama-samples/`。
- 将 decision / quality_check 的 JSON 提示词升级到 v0.3：缩短输入摘录，并强制输出最小固定 schema，避免本地模型把 JSON 任务写成长篇回答。
- 将 JSON 类本地输出预算设为 `num_predict=256`；brief / email 保持 `num_predict=256`，`num_ctx=4096`。

验证结果：

- 4 个真实样本目录全部生成成功，brief / email / decision / quality_check 均为 `ok`。
- 重复运行样本脚本时 4 个目录全部跳过，不重复调用模型。
- 样本输出未发现 `<think>`、本机路径、API Key、Cookie、SMTP 字样。
- 本阶段仍未接入队列、档案按钮、后台自动化或邮件发送。

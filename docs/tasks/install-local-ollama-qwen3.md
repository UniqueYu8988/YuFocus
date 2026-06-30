# 任务：本地 Ollama + Qwen3-8B 模型落地

## 背景

本项目已经完成“MiMo 主资料 + 本地模型消费层 / 门控”的第一阶段合约。下一步需要在本机落地一个稳定、可后台调用的本地模型接口，用于后续 brief、邮件草稿、价值判断和质量检查。

本机环境：

- GPU：NVIDIA GeForce RTX 4060 Laptop，8GB 显存。
- 目标目录：`C:\Users\Yu\AI\Cuda`。
- 已安装 Ollama，当前无模型。

## 目标

1. 选择 Ollama 作为第一版本地模型接口。
2. 在 `C:\Users\Yu\AI\Cuda` 下建立清晰目录：
   - `models`：保存下载的原始 GGUF 模型文件；
   - `ollama-models`：保存 Ollama 运行时模型数据；
   - `tools`：保存临时下载工具或独立 Python 环境。
3. 优先通过国内更友好的 ModelScope 下载 Qwen3-8B Q4_K_M GGUF。
4. 导入 Ollama，命名为 `shijie-qwen3-8b-q4`。
5. 运行 3 个冒烟测试：
   - 中文资料 brief；
   - 邮件草稿；
   - JSON 价值判断。

## 不做

- 不接入视界专注主流程。
- 不改写 `data/materials` 下的真实资料包。
- 不恢复或发送邮件。
- 不读取或输出 Cookie、API Key、SMTP 授权码等秘密值。
- 不让本地模型替代 MiMo 生成 NotebookLM 主资料。

## 风险和处理

| 风险 | 处理 |
|---|---|
| 8GB 显存不足以稳定跑大模型 | 第一版只选 8B Q4_K_M，冒烟测试先用 8K 上下文 |
| 国内下载不稳定 | 优先 ModelScope；失败后再考虑 Ollama 官方拉取 |
| Ollama 默认模型目录不在 `Cuda` | 设置 `OLLAMA_MODELS=C:\Users\Yu\AI\Cuda\ollama-models`，并在当前命令中显式传入 |
| 真实软件误调用本地模型 | 本轮只做安装和 CLI 冒烟测试，不改主流程接入 |

## 验收

- `ollama list` 能看到 `shijie-qwen3-8b-q4`。
- `ollama run shijie-qwen3-8b-q4` 能完成中文 brief 测试。
- Ollama API 能返回邮件草稿。
- Ollama API 能返回可解析 JSON。
- 记录模型路径、大小、验证结果和遗留问题。

## 完成记录

- 已在 `C:\Users\Yu\AI\Cuda` 下建立目录：
  - `models`
  - `ollama-models`
  - `tools`
- 已设置用户环境变量：`OLLAMA_MODELS=C:\Users\Yu\AI\Cuda\ollama-models`。
- 已用 Python 3.11 独立 venv 安装 ModelScope 下载工具：
  - `C:\Users\Yu\AI\Cuda\tools\modelscope-venv`
- 已通过 ModelScope 下载单个 GGUF 文件：
  - `C:\Users\Yu\AI\Cuda\models\Qwen3-8B-GGUF\Qwen3-8B-Q4_K_M.gguf`
  - 文件大小：`5027783488` bytes。
- 已创建 Modelfile：
  - `C:\Users\Yu\AI\Cuda\models\Qwen3-8B-GGUF\Modelfile`
- 已导入 Ollama 模型：
  - `shijie-qwen3-8b-q4`
  - `shijie-qwen3-8b-q4-chat`

## 重要发现

Ollama 当前版本为 `0.17.7`，Windows 下本地 GGUF `create` 行为有两个注意点：

1. 首次创建时模型进入了默认仓库 `C:\Users\Yu\.ollama\models`，没有直接写入 `OLLAMA_MODELS` 指向的目录。
2. 通过手动同步默认仓库到 `C:\Users\Yu\AI\Cuda\ollama-models` 后，已确认 Cuda 目录可被 Ollama 服务识别和加载。

因此当前推荐模型名是：

```text
shijie-qwen3-8b-q4-chat
```

旧的 `shijie-qwen3-8b-q4` 能运行，但缺少正确聊天模板，不建议接入软件。

## 冒烟测试结果

### brief

- 接口：`POST http://127.0.0.1:11434/api/chat`
- 模型：`shijie-qwen3-8b-q4-chat`
- 结果：通过。
- 耗时：约 `7.95s`。
- 观察：输出没有再编造额外日期、地点、版本号、显存或速度；仍带空 `<think>` 标签，后续 adapter 需要过滤。

### 邮件草稿

- 接口：`POST http://127.0.0.1:11434/api/chat`
- 模型：`shijie-qwen3-8b-q4-chat`
- 结果：基本通过。
- 耗时：约 `3.8s`。
- 观察：可生成简短邮件稿；出现一次轻微时态漂移，把“发布”写成“将发布”，后续提示词和质量检查需要约束。

### JSON 判断

- 接口：`POST http://127.0.0.1:11434/api/chat`
- 模型：`shijie-qwen3-8b-q4-chat`
- 结果：通过。
- 耗时：约 `2.63s`。
- 观察：返回 JSON 可被 `ConvertFrom-Json` 解析，字段包含 `worthEmail`、`importance`、`reason`、`tags`。

## 当前推荐配置

```text
provider: ollama
endpoint: http://127.0.0.1:11434/api/chat
model: shijie-qwen3-8b-q4-chat
num_ctx: 4096
num_predict: 160-256
temperature: 0.1
top_p: 0.8
```

## 遗留问题

- `C:\Users\Yu\.ollama\models` 中仍保留一份默认仓库副本。本轮不删除，避免误删可回退模型；如确认 Cuda 运行长期稳定，可另开清理任务。
- Ollama `0.17.7` 较旧，后续建议评估升级到新版，再确认是否能直接使用 `OLLAMA_MODELS` 和官方 Qwen3 模板。
- Qwen3 输出可能带空 `<think>` 标签，adapter 层需要过滤 `<think>...</think>`。
- 8GB 显存下 Qwen3-8B Q4_K_M 可用，但显存占用接近上限；上下文先保持 `4096`，不要直接拉到 `8192`。

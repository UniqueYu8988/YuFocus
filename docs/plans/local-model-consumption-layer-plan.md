# 计划：MiMo 主资料 + 本地模型消费层 / 门控

## 一句话原则

MiMo 继续负责高质量 NotebookLM 主资料；本地模型先负责 brief、邮件稿、价值判断和质量检查；规则处理负责确定性去噪。第一阶段不让本地模型接管核心字幕清洗。

## 阶段 1：本地消费层合约

- 固化 brief、email、decision、quality check 的文件位置。
- 固化缓存 key 的组成。
- 固化 UP profile 类型。
- 固化本地模型请求计划，先支持 Ollama、LM Studio、OpenAI-compatible 和 sample generator 的 provider 规范化。
- 固化提示词输入边界：brief 读 NotebookLM，email 读 brief，decision 读 NotebookLM 摘录，quality 读原始字幕摘录和 NotebookLM 摘录。
- 只做纯内存检查，不调用模型，不写真实资料。

验收：

- 本地消费层检查通过。
- TypeScript 类型检查通过。
- NotebookLM 主资料和 subtitle-only 队列保护检查继续通过。
- domain 层不直接调用网络、HTTP 客户端或子进程；真正模型调用留给后续 adapter 层。

## 阶段 2：本地模型 adapter 试接

- 只选择一个本地运行入口先试接，优先 Ollama 或 LM Studio，不同时维护多个真实 adapter。
- adapter 只接收阶段 1 的请求计划，负责执行、超时、错误记录和缓存命中判断。
- 真实模型输出先写入 `data/temp/local-consumption-samples/`，继续不写回材料包。
- 本机已确定第一版入口为 Ollama，推荐模型名为 `shijie-qwen3-8b-q4-chat`；详细执行计划见 `docs/plans/local-ollama-adapter-phase2-plan.md`，任务边界见 `docs/tasks/local-ollama-adapter-phase2.md`。

验收：

- 本地模型未启动时，任务能明确失败并保留可读错误，不影响队列主线。
- 本地模型启动时，能生成 brief / email 样本。
- 缓存命中时不重复消耗本地算力。

## 阶段 3：离线 brief / email 样本

- 从已有材料包读取 `exports/notebooklm.md`。
- 使用本地模型生成 `brief.local.md` 和 `email.md` 到受控样本目录，先不写回真实材料包。
- 每类 UP 至少抽 1 条：
  - 橘鸦Juya：新闻资讯；
  - 技术爬爬虾：技术教程；
  - 罗胖罗振宇：观点知识；
  - TED：演讲。

验收：

- brief 可读，不破坏 NotebookLM 主资料。
- email 稿不胡编，不泄露内部路径和秘密。
- 生成过程可缓存。

## 阶段 4：价值判断和质量检查

- 本地模型读取 NotebookLM 稿和 UP profile，生成 `decision.json` 草案。
- 本地规则提取数字、日期、专名、步骤标记，生成 `local_check.json`。
- 质量检查只标记风险，不自动覆盖主稿。

验收：

- 能识别“值得邮件推送 / 不值得推送”。
- 能发现明显过短、漏数字、漏步骤等风险。
- 不触发旧 summary/email 发送。

## 阶段 5：接入真实材料包但保持手动

- 在档案页或队列记录中增加“生成本地简报”入口。
- 只对用户手动选择的视频写入 `exports/brief.local.md` 和 `delivery/email.md`。
- 暂不自动发送邮件。

验收：

- 不改写 `exports/notebooklm.md`。
- 缓存命中时不重复生成。
- 可以打开/复制 brief 和 email 文件路径。

## 阶段 6：恢复邮件推送

- 邮件只读取 `delivery/email.md`。
- 发送状态写入 `delivery/email_status.json`。
- 自动发送由 `decision.json` 和用户设置共同控制。

验收：

- 不重复发送。
- 失败可重试。
- 可按 UP 主关闭。

## 暂不推进

- 不让本地模型全量接管字幕清洗。
- 不恢复旧 Summary Pipeline 为主线。
- 不把邮件稿替代 NotebookLM 主资料。
- 不引入多个本地模型适配器；第一版只选择一个本地模型运行入口。

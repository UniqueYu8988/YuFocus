# 任务：本地消费层夜间自动闭环升级

## 背景

本地消费层已经完成两步：

1. 第一阶段：建立纯 domain 合约，定义 brief、email、decision、quality_check 的产物路径、UP profile、缓存 key 和请求计划。
2. 第二阶段：接入 Ollama adapter 试接，只把真实模型输出写入 `data/temp/local-ollama-samples/`，不改写正式资料包。

项目负责人希望夜间执行一个长任务，优先完成“不需要人工审核也能推进”的工程工作：完善整条本地消费层链路、为已关注 UP 定制提示词和机制、自动验证输出效果、攻克已有问题。

## 目标

把当前“能跑 4 个临时样本”的试接，升级为“覆盖已关注 UP 的自动验证闭环”：

1. 为当前已关注 / 已有材料的 UP 主建立定制 profile：
   - 橘鸦Juya；
   - 技术爬爬虾；
   - 罗胖罗振宇；
   - 马督工；
   - 小黛晨读；
   - 杨彧鑫AI；
   - TED官方精选；
   - 其他已注册但暂未产出材料的 UP 先落到稳定通用 profile。
2. 让本地模型链路可自动跑完：
   - brief；
   - email；
   - decision；
   - quality_check；
   - 汇总报告。
3. 增加失败重试机制，尤其是 JSON 结构错误时自动用更硬的修复提示重试一次。
4. 增加自动验收报告，让早上验收时不用逐个打开临时文件。
5. 验证不会破坏现有 subtitle-only 主线。

## 明确不做

- 不把本地模型输出写入 `data/materials`。
- 不覆盖 `exports/notebooklm.md`。
- 不发送邮件。
- 不接入后台自动队列。
- 不迁移、删除、重命名真实材料包。
- 不读取或展示 Cookie、API Key、SMTP 授权码。
- 不升级 Ollama，不更换模型。

## 输入

只读：

```text
data/materials/{up_id}/{video_id}/exports/notebooklm.md
data/materials/{up_id}/{video_id}/raw_transcript.txt
data/materials/{up_id}/{video_id}/manifest.json
data/registry/{up_id}.json
```

## 输出

只写：

```text
data/temp/local-ollama-samples/
```

新增或更新：

```text
data/temp/local-ollama-samples/{video_id}/exports/brief.local.md
data/temp/local-ollama-samples/{video_id}/delivery/email.md
data/temp/local-ollama-samples/{video_id}/delivery/decision.json
data/temp/local-ollama-samples/{video_id}/work/quality/local_check.json
data/temp/local-ollama-samples/{video_id}/work/run_meta.json
data/temp/local-ollama-samples/_reports/nightly-autopilot-report.md
data/temp/local-ollama-samples/_reports/nightly-autopilot-report.json
```

## 验收

- 至少覆盖 7 个已有材料的 UP 主。
- 每个样本都能自动生成 brief / email / decision / quality_check。
- JSON 失败时能自动重试一次，并在 meta 中记录 retry。
- 汇总报告列出：
  - UP 主；
  - 视频标题；
  - 4 类产物状态；
  - 耗时；
  - 输出字数；
  - decision 结果；
  - quality_check 风险；
  - 是否命中安全护栏。
- 样本和报告不含 `<think>`、本机路径、API Key、Cookie、SMTP 字样。
- 重复运行时能跳过已完成样本。
- `npx tsc --noEmit`、本地消费层检查、Ollama adapter 检查、subtitle-only 主线检查继续通过。

## 风险与处理

| 风险 | 处理 |
|---|---|
| 本地模型 JSON 偶发跑偏 | 增加一次 schema 修复重试，仍失败则记录失败，不污染正式资料 |
| UP 定制 profile 过拟合 | 先只改变提示词和临时样本，不写正式材料 |
| 输出看似成功但含危险信息 | 报告和检查脚本扫描 `<think>`、本机路径、密钥字样 |
| 真实材料被误写 | 所有写文件函数必须检查目标路径在 `data/temp/local-ollama-samples` 内 |
| 夜间长跑耗时 | 保持单请求串行，不并发压显存；重复运行跳过已完成 |

## 完成记录

完成时间：2026-06-30

已完成：

- 建立 8 个 UP 主定制 profile 预设：
  - 橘鸦Juya；
  - 技术爬爬虾；
  - 罗胖罗振宇；
  - 马督工；
  - 小黛晨读；
  - 杨彧鑫AI；
  - TED官方精选；
  - 张小强商业访谈录。
- `generate-local-ollama-samples.mjs` 从固定 4 个样本升级为自动扫描 `data/materials`，默认每个已有材料 UP 选 1 个代表样本。
- 为 decision / quality_check 增加 JSON 修复重试机制：首次 JSON 不可解析或 schema 不完整时，用失败输出预览和目标 schema 自动修复一次。
- 新增夜间报告：

```text
data/temp/local-ollama-samples/_reports/nightly-autopilot-report.md
data/temp/local-ollama-samples/_reports/nightly-autopilot-report.json
```

- 新增 `desktop/scripts/check-local-ollama-samples.mjs`，检查 7 个已有材料 UP 是否都成功生成、报告是否完整、是否仍只写临时目录。

真实运行结果：

- 覆盖 7 个已有材料 UP。
- brief / email / decision / quality_check 全部为 `ok`。
- 失败数：0。
- 安全扫描命中：0。
- 第二次运行全部跳过，不重复调用模型。

仍然不做：

- 未写入 `data/materials`。
- 未覆盖 `exports/notebooklm.md`。
- 未发送邮件。
- 未接入后台队列或自动同步。

# 任务：MiMo UP 定制字幕清洗提示词与质量循环测试

## 背景

此前误把“UP 定制提示词”做到了本地 Ollama 后处理消费层。项目负责人实际要处理的是更靠前的字幕清洗层：

```text
原始字幕 / 转写
→ MiMo 字幕清洗提示词
→ cleaned_transcript.txt / content.md / exports/notebooklm.md
```

这次任务只围绕 MiMo 清洗提示词，不做本地 Ollama brief/email，不接入邮件，不接后台队列。

## 目标

建立 MiMo 清洗层的 UP 定制提示词和循环质量测试机制：

1. 梳理现有 MiMo 清洗 prompt 和质量护栏。
2. 为重点 UP 主设计 MiMo 清洗 profile。
3. 用真实 `raw_transcript.txt` 样本在临时目录测试：
   - 旧 prompt；
   - UP 定制 prompt；
   - 如质量未达标，进行一次 prompt 修订再测。
4. 对比旧清洗稿与新清洗稿质量。
5. 输出可验收报告，供决定是否接入正式主线。

## 不做

- 不覆盖 `data/materials`。
- 不改写 `cleaned_transcript.txt`、`content.md` 或 `exports/notebooklm.md`。
- 不接入队列。
- 不发送邮件。
- 不做 Ollama 后处理。
- 不读取或展示 API Key、Cookie、SMTP 授权码。
- 不升级 MiMo 模型，不切回 Pro。

## 样本范围

优先使用已有真实材料：

- 橘鸦Juya；
- 技术爬爬虾；
- 罗胖罗振宇；
- 马督工；
- 小黛晨读；
- 杨彧鑫AI；
- TED官方精选。

如某个 UP 暂无材料，只建立 profile，不做真实调用。

## 输出位置

只写：

```text
data/temp/mimo-cleaning-prompt-lab/
```

预期输出：

```text
data/temp/mimo-cleaning-prompt-lab/{up_id}/{video_id}/baseline.cleaned.md
data/temp/mimo-cleaning-prompt-lab/{up_id}/{video_id}/profiled.cleaned.md
data/temp/mimo-cleaning-prompt-lab/{up_id}/{video_id}/iteration-2.cleaned.md
data/temp/mimo-cleaning-prompt-lab/{up_id}/{video_id}/quality.json
data/temp/mimo-cleaning-prompt-lab/_reports/mimo-cleaning-quality-report.md
data/temp/mimo-cleaning-prompt-lab/_reports/mimo-cleaning-quality-report.json
```

## 循环质量测试标准

每个样本至少检查：

| 维度 | 说明 |
|---|---|
| 忠实性 | 不新增原文没有的事实、年份、数字、机构名 |
| 信息保留 | 保留关键数字、日期、术语、人名、机构、步骤、观点链 |
| 不误删 | 输出长度不能明显低于合理阈值；长文本不能被总结化 |
| 不扩写 | 输出长度不能异常膨胀；不能写成总结、评论或教程再创作 |
| 时间戳 | 原始片段有时间戳时必须保留 |
| UP 风格适配 | 新闻分条、教程步骤、观点论证、演讲故事线等按 UP 类型处理 |
| NotebookLM 适配 | 输出应适合直接进入 NotebookLM：清晰、少噪声、结构不过度复杂 |

## 自动迭代规则

1. 第 1 轮：使用当前通用 prompt，得到 baseline。
2. 第 2 轮：使用 UP 定制 prompt，得到 profiled。
3. 如果第 2 轮存在明显问题：
   - 缺关键数字/时间戳；
   - 输出过短；
   - 输出明显扩写；
   - 出现总结化；
   - 不符合 UP 类型；
   则自动构造 repair notes，进入第 3 轮。
4. 第 3 轮仍失败时不继续重试，记录问题，不扩大消耗。

## 验收

- 新增任务与计划文档。
- 新增 MiMo 清洗 profile 机制。
- 新增临时样本测试脚本。
- 新增质量检查脚本。
- 至少能在临时目录生成对比报告。
- 如果本机当前没有可用 MiMo Key，脚本应清楚报告 `missing_mimo_api_key`，但静态检查和 dry-run prompt 检查仍应通过。

## 完成记录

2026-06-30 已完成。

- 在 `src/distiller.py` 中新增 MiMo 清洗层 UP profile 机制，覆盖橘鸦Juya、技术爬爬虾、罗胖罗振宇、马督工、小黛晨读、杨彧鑫AI、TED官方精选。
- 新增 `desktop/scripts/generate_mimo_cleaning_prompt_lab.py`，只写 `data/temp/mimo-cleaning-prompt-lab/`，支持 baseline、profiled、iteration-2 循环测试。
- 新增 `desktop/scripts/check-mimo-cleaning-prompt-lab.mjs`，检查脚本不写正式材料、不接队列、不发邮件、不使用 Ollama、不泄露密钥字样。
- 使用桌面端已保存 MiMo 设置完成 7 个真实 UP 小样本测试；第二轮真实调用后 6/7 通过，随后校准英文原文 → 中文清稿的评分规则，并用 `--reevaluate-existing` 不消耗 token 重评为 7/7 通过。
- 最终报告位于 `data/temp/mimo-cleaning-prompt-lab/_reports/mimo-cleaning-quality-report.md` 和 `.json`。

本任务只证明 UP 定制清洗提示词在临时实验层可用；尚未把 profile 自动接入正式 `data/materials` 生成链路。

# 计划：MiMo UP 定制字幕清洗提示词与质量循环测试

## 一句话原则

只优化“字幕清洗提示词”，并用临时样本循环测试质量；在报告确认前，不把新 prompt 接入正式材料生成。

## 阶段 1：理解现有 MiMo 清洗链路

当前代码位置：

- `_build_cleaning_prompt()`：构造 MiMo 清洗 prompt；
- `_request_mimo_cleaning()`：调用 MiMo；
- `_clean_one_chunk_with_checkpoint()`：执行清洗、检查缺数字/时间戳、必要时 repair、失败时回退规则清洗；
- `build_clean_material_content()`：把分块清洗结果写入正式材料包。

当前已有护栏：

- 不总结、不扩写、不改变观点；
- 保留数字、年份、日期、金额、比例、人名、机构名和术语；
- 原文没有完整年份时不得补成完整年份；
- 保留时间戳；
- 缺关键数字或时间戳会二次 repair；
- 输出明显过短会回退规则清洗。

## 阶段 2：设计 UP 级 MiMo 清洗 profile

### 目标

在 MiMo 清洗层增加 UP 类型差异，但不改变“忠实清稿”的主原则。

### 定制方向

| UP 主 | 清洗重点 | 禁止倾向 |
|---|---|---|
| 橘鸦Juya | 多条 AI 新闻分条、模型名、公司名、版本、价格、额度、链接线索 | 不合并新闻；不凭常识补全模型名 |
| 技术爬爬虾 | 教程步骤、命令、路径、按钮、配置项、坑点 | 不压缩成概念总结；不删除操作细节 |
| 罗胖罗振宇 | 观点链、历史人物、类比、转折、限定条件 | 不压成一句结论；不删除反例 |
| 马督工 | 公共议题、政策、数据、地区、利益主体、因果链 | 不把复杂因果链简化成立场 |
| 小黛晨读 | 社会资讯分条、主体、争议点、政策/监管、影响人群 | 不混淆不同新闻 |
| 杨彧鑫AI | AI 商业判断、Agent 方法、案例、行动建议、风险提示 | 不把观点包装成事实 |
| TED官方精选 | 演讲故事线、实验/案例、核心观点、比喻、可引用表达 | 不把故事线完全抽象化 |

### 实现方式

在 `src/distiller.py` 中新增纯函数：

```text
_resolve_cleaning_profile(title, creator?)
_cleaning_profile_prompt(profile)
```

先让测试脚本使用该 profile；正式 `build_clean_material_content()` 暂不启用 creator 参数接入，避免改变主线行为。

## 阶段 3：临时测试脚本

新增：

```text
desktop/scripts/generate_mimo_cleaning_prompt_lab.py
```

职责：

1. 扫描 `data/materials`。
2. 每个 UP 选 1 个真实材料。
3. 读取：
   - `raw_transcript.txt`
   - `cleaned_transcript.txt`
   - `manifest.json`
4. 构造一段可控测试 chunk。
5. 调用 Python 临时入口或内联脚本，分别生成：
   - baseline 通用 prompt 清洗；
   - profiled UP 定制 prompt 清洗；
   - 必要时 iteration-2 修订清洗。
6. 只写 `data/temp/mimo-cleaning-prompt-lab/`。

### Key 处理

- 不打印 MiMo Key。
- 优先使用当前进程环境变量。
- 如果没有 Key，脚本生成 dry-run prompt 和 `missing_mimo_api_key` 报告。
- 如需读取桌面端设置中的 Key，必须只在内存中使用，不能输出或写入报告。

实际实现补充：脚本支持 `--reevaluate-existing`，可在不再次调用 MiMo 的情况下，用已有临时输出重新计算质量并刷新报告，用于降低循环调试 token 消耗。

## 阶段 4：循环质量测试

新增质量评分逻辑：

| 指标 | 规则 |
|---|---|
| missingCriticalTerms | 原始字幕中的关键数字/日期/术语是否丢失 |
| unsupportedFullYears | 是否新增原文不支持的完整年份 |
| missingTimeMarkers | 时间戳是否丢失 |
| compressionRatio | 输出长度 / 输入长度，过短判定总结化 |
| expansionRatio | 输出长度 / 输入长度，过长判定扩写 |
| structuralFit | 是否符合 UP 类型：新闻分条、教程步骤、观点链等 |

迭代规则：

```text
baseline
→ profiled
→ 如果 profiled 不达标，带 repair notes 再跑 iteration-2
→ 最多 3 轮
→ 写 report
```

## 阶段 5：检查脚本

新增：

```text
desktop/scripts/check-mimo-cleaning-prompt-lab.mjs
```

检查：

- 脚本只写 `data/temp/mimo-cleaning-prompt-lab`；
- 不写 `data/materials`；
- 不接入队列；
- 不发送邮件；
- 不使用 Ollama；
- profile 覆盖重点 UP；
- 报告存在且结构完整；
- 如真实调用成功，样本质量状态可读；
- 如没有 Key，报告必须明确 `missing_mimo_api_key`。

## 阶段 6：验证

必跑：

```text
node --experimental-strip-types --no-warnings scripts/check-mimo-cleaning-prompt-lab.mjs
node --experimental-strip-types --no-warnings scripts/check-mimo-non-pro-default.mjs
node --experimental-strip-types --no-warnings scripts/check-subtitle-language-selection.mjs
node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs
node --experimental-strip-types --no-warnings scripts/check-product-refactor-surface.mjs
npx tsc --noEmit
python -m py_compile src/distiller.py
git diff --check
```

如果 MiMo Key 可用，再跑：

```text
python desktop/scripts/generate_mimo_cleaning_prompt_lab.py --force --samples-per-up 1 --raw-limit 3000
python desktop/scripts/generate_mimo_cleaning_prompt_lab.py --reevaluate-existing --samples-per-up 1 --raw-limit 3000
```

## 阶段 7：收尾

更新：

- `CURRENT_STATE.md`
- `ARCHITECTURE.md`（如新增 profile 机制）
- 当前任务/计划完成记录

## 回退方式

- 停用或删除临时测试脚本；
- 移除新增 profile 纯函数；
- 删除 `data/temp/mimo-cleaning-prompt-lab/` 临时结果即可；
- 因不写正式材料包，不需要回滚 `data/materials`。

## 执行结果

2026-06-30 已完成。

- UP profile 机制已落地，但正式主线默认不传 profile，避免未验收前改变生产输出。
- 真实 MiMo 样本循环覆盖 7 个已有材料 UP，最终报告为 `sampleCount=7`、`okCount=7`、`needsReviewCount=0`、`failedCount=0`。
- 循环中发现两类问题并修正：新闻类提示词需要“多条新闻必须分条”；英文字幕清成中文时不能用普通字符压缩比误判为总结化。
- 结果仅写入 `data/temp/mimo-cleaning-prompt-lab/`，未覆盖 `data/materials`，未接入队列，未发送邮件，未使用 Ollama。

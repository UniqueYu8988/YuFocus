# 计划：本地消费层夜间自动闭环升级

## 一句话原则

把“本地模型能生成临时样本”推进到“本地模型能自动跑完、自动检查、自动出报告”，但仍不把结果写进正式材料包，也不恢复邮件发送。

## 当前事实

- Ollama 推荐模型：`shijie-qwen3-8b-q4-chat`。
- endpoint：`http://127.0.0.1:11434/api/chat`。
- 临时输出根：`data/temp/local-ollama-samples/`。
- 已有真实材料覆盖 7 个 UP：
  - 小黛晨读；
  - TED官方精选；
  - 橘鸦Juya；
  - 技术爬爬虾；
  - 马督工；
  - 罗胖罗振宇；
  - 杨彧鑫AI。
- 当前不能做：
  - 写 `data/materials`；
  - 发邮件；
  - 接入队列；
  - 删除真实数据。

## 阶段 1：建立 UP 定制 profile

### 目标

让本地消费层不再只靠 `news_digest` / `technical_tutorial` / `knowledge_talk` / `speech` 这几个粗分类，而是对常用 UP 有更具体的取舍策略。

### 设计

在 `desktop/src/domain/localConsumption.ts` 中建立可维护的 UP profile preset：

```text
upId / name alias
→ kind
→ briefStyle
→ emailStyle
→ keep
→ remove
→ cautions
→ profileHash
```

定制方向：

| UP 主 | brief 重点 | email 重点 | 主要过滤 |
|---|---|---|---|
| 橘鸦Juya | 分新闻条目、模型名、公司名、版本、价格、影响 | 日报式高密度 3-5 条 | 片头、重复播报、广告口播 |
| 技术爬爬虾 | 工具名、安装步骤、命令、配置、坑点 | 适合谁看、解决什么问题、是否值得回看 | 重复演示、过长铺垫 |
| 罗胖罗振宇 | 核心判断、例子、历史线索、类比、限定条件 | 观点简报和可迁移启发 | 口头禅、过度铺垫 |
| 马督工 | 公共议题、因果链、数据、政策、利益关系 | 问题-证据-结论结构 | 情绪化转场、重复设问 |
| 小黛晨读 | 多条社会资讯、主体、争议点、可能影响 | 参考信息速读 | 新闻间误合并、寒暄 |
| 杨彧鑫AI | AI 商业/Agent 观点、方法框架、案例、行动建议 | 商业判断和可执行启发 | 标题党、泛泛鸡汤 |
| TED官方精选 | 故事线、实验/案例、核心观点、可引用表达 | 演讲主题、启发和回看价值 | 掌声、舞台提示 |

### 验收

- 每个定制 UP 的 profileHash 不同。
- `renderLocalModelSystemPrompt` 中能体现定制要求。
- 旧 fallback profile 仍存在。

## 阶段 2：扩展样本选择

### 目标

从“固定 4 个样本”扩展为“每个已有材料 UP 至少 1 个样本”。

### 设计

样本脚本先扫描：

```text
data/materials/{up_id}/{video_id}/manifest.json
```

按 UP 分组后选择每个 UP 的代表材料：

- 优先已有 `exports/notebooklm.md`；
- 优先最近或标题更典型的材料；
- 每个 UP 默认 1 个样本；
- 支持环境变量或参数扩大样本数。

### 验收

- 当前至少生成 7 个样本。
- 报告说明每个样本来自哪个材料包。

## 阶段 3：JSON 修复重试

### 目标

模型输出 JSON 偶发跑偏时，不立刻失败，而是自动用原始输出做一次结构修复。

### 设计

仅对 `decision` / `quality_check` 生效：

1. 首次调用按正常 prompt。
2. 如果失败原因是 `invalid_json` 或 schema 不完整：
   - 追加一次更硬的修复请求；
   - 输入包含目标 schema 和原始输出预览；
   - 不重新喂完整长文，避免再次跑偏。
3. meta 中记录：
   - `attempts`；
   - `retryReason`；
   - 每次耗时；
   - 最终状态。

### 验收

- 检查脚本用假响应模拟首次失败、二次成功。
- 真实样本 meta 能记录 attempts。

## 阶段 4：自动验收报告

### 目标

早上验收时不需要逐个打开 7 组目录。

### 输出

```text
data/temp/local-ollama-samples/_reports/nightly-autopilot-report.md
data/temp/local-ollama-samples/_reports/nightly-autopilot-report.json
```

报告包含：

- 总览：样本数、成功数、失败数、总耗时。
- 每个 UP：
  - UP 主；
  - 标题；
  - BV；
  - brief 字数；
  - email 字数；
  - decision 结果；
  - quality_check 风险；
  - 耗时；
  - 文件路径。
- 风险区：
  - JSON 重试次数；
  - 失败项；
  - 安全扫描结果。

## 阶段 5：验证和收尾

### 必跑验证

```text
node --experimental-strip-types --no-warnings scripts/check-local-consumption-layer.mjs
node --experimental-strip-types --no-warnings scripts/check-local-ollama-adapter.mjs
node --experimental-strip-types --no-warnings scripts/generate-local-ollama-samples.mjs --force
node --experimental-strip-types --no-warnings scripts/generate-local-ollama-samples.mjs
node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs
node --experimental-strip-types --no-warnings scripts/check-product-refactor-surface.mjs
npx tsc --noEmit
git diff --check
```

### 数据安全检查

- 扫描 `data/temp/local-ollama-samples/`，确认不含 `<think>`、本机路径、API Key、Cookie、SMTP 字样。
- 确认本轮没有写入 `data/materials`。

## 回退方式

- 停用或删除本轮新增脚本逻辑即可。
- 临时样本和报告位于 `data/temp/local-ollama-samples/`，不影响正式资料。
- 本轮不修改队列、不修改正式材料包、不发送邮件，因此不需要回滚生产数据。

## 执行结果

完成时间：2026-06-30

实际完成：

- `desktop/src/domain/localConsumption.ts`
  - 新增 `LOCAL_UP_PROFILE_VERSION`。
  - 新增 `LOCAL_UP_PROFILE_PRESETS`。
  - `createDefaultLocalConsumptionProfile` 改为优先按 UP ID / 名称命中定制 profile，再退回通用分类。
- `desktop/scripts/generate-local-ollama-samples.mjs`
  - 自动扫描 `data/materials`，按 UP 分组选样本。
  - 默认每个已有材料 UP 选 1 个样本，可通过 `LOCAL_OLLAMA_SAMPLES_PER_UP` 扩大。
  - 增加 JSON 修复重试。
  - 写出 Markdown / JSON 汇总报告。
- `desktop/scripts/check-local-consumption-layer.mjs`
  - 增加 8 个 UP profile 的稳定检查。
- `desktop/scripts/check-local-ollama-samples.mjs`
  - 新增夜间闭环报告和样本产物检查。

真实样本结果：

| 指标 | 结果 |
|---|---:|
| 覆盖 UP 数 | 7 |
| 样本数 | 7 |
| 成功数 | 7 |
| 失败数 | 0 |
| 重复运行跳过数 | 7 |
| 安全扫描命中 | 0 |

报告位置：

```text
data/temp/local-ollama-samples/_reports/nightly-autopilot-report.md
data/temp/local-ollama-samples/_reports/nightly-autopilot-report.json
```

观察：

- brief / email 在 7 类内容上都能稳定生成。
- decision / quality_check 在 v0.3 JSON prompt 下本轮没有触发修复重试；但修复机制已经存在，后续遇到跑偏会自动尝试一次。
- quality_check 对部分内容给出 medium / high 风险，这不是脚本失败，而是本地模型认为主资料信息密度或关键术语覆盖不足，适合作为后续优化 MiMo 清洗和长文本切分的线索。

下一阶段建议：

1. 先阅读 `nightly-autopilot-report.md`，确认 brief / email 的阅读体验是否符合预期。
2. 如果接受，再进入“受控写入真实材料包”阶段：仍先手动触发、小批量写入，不直接接后台自动队列。
3. 后续如果恢复邮件，应从 `delivery/email.md` 读取本地消费层产物，不要重新接回旧 Summary Pipeline。

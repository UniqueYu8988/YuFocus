# 最近更新邮件转发生产化计划

创建日期：2026-06-30

对应任务：`docs/tasks/fresh-email-forwarding-production.md`

## 总体原则

这次升级只做一个方向：让软件在后台自动处理“最近更新视频”后，把本地总结稿发送到邮箱。

其中资料层和消费层要明确分开：

```text
资料层：MiMo 高保真逐字清洗 → notebooklm.md
消费层：本地模型总结 → brief.local.md / email.md
通知层：只对 fresh 新视频发送邮件
```

历史补全的价值是沉淀资料，不是制造邮件噪音。因此 `history` 队列项永远不自动发邮件。

## 阶段 0：安全边界确认

### 目标

确认当前代码中哪些地方已经有邮件字段、哪些地方已经有队列来源、哪些地方已经有本地消费层。

### 当前观察

- `RuntimeSettings` 中已有 SMTP / 邮件字段：
  - `email_push_enabled`
  - `email_smtp_host`
  - `email_smtp_port`
  - `email_smtp_secure`
  - `email_smtp_user`
  - `email_smtp_password`
  - `email_from`
  - `email_to`
- `queueExecutor.ts` 已预留 `pushMaterialEmail` 钩子，但当前未在 `automationRuntime.ts` 注入。
- `WorkbenchQueueItem.queueSource` 已区分：
  - `fresh`
  - `history`
  - `manual`
  - `follow_source`
  - `retry`
- 本地消费层已写：
  - `exports/brief.local.md`
  - `delivery/email.md`
  - `delivery/decision.json`
  - `work/quality/local_check.json`
  - `work/local_consumption/run_meta.json`

### 输出

- 不改代码，只形成任务和计划文档。

## 阶段 1：取消 UP 定制 MiMo 清洗生产路线

### 目标

让正式生产清洗永远使用通用高保真清洗 prompt，不使用 UP 专属清洗策略。

### 实施

1. 在 `src/distiller.py` 中保留通用清洗规则。
2. 移除或隔离 `CleaningProfile` / `MIMO_CLEANING_PROFILES` 对正式清洗的影响。
3. 保留 `desktop/scripts/generate_mimo_cleaning_prompt_lab.py` 作为历史实验脚本时，要确保它只写 `data/temp`，且不被正式队列调用。
4. 新增静态检查，确认正式生产路径 `_request_mimo_cleaning(...)` 不传入 `cleaning_profile`。

### 验证

- `python -m py_compile src/distiller.py`
- 新增或更新 `check-mimo-cleaning-production-mode.mjs`
- 现有 `check-mimo-cleaning-prompt-lab.mjs` 如仍保留，应只证明实验层隔离，不代表生产接入。

### 回退

恢复原 `CleaningProfile` 定义和实验脚本即可。由于生产路径当前本就没有正式传 profile，此阶段应尽量小改。

## 阶段 2：升级本地 brief 生成策略

### 目标

把本轮实验中验证更好的“事实门控版高密度总结”合入 `brief.local.md` 的正式提示词。

### 实施

1. 修改 `desktop/src/domain/localConsumption.ts`：
   - `LOCAL_BRIEF_PROMPT_VERSION` 升级；
   - brief prompt 从泛化简报改为“高信息密度 + 事实锚点 + 禁止项”；
   - 明确：不是 NotebookLM 主资料，不需要逐字保留；但不能编造数字、日期、人物结论。
2. 提升本地 Ollama markdown 输出参数：
   - `num_ctx` 从当前较保守值提升到至少 `8192`；
   - 对 brief 优先使用 `12288`；
   - `num_predict` 对 brief 提升到 `4096` 或按资料长度动态设置；
   - email 可复用 brief，不重复读超长主资料。
3. 将质量门控增加几类检查：
   - 自我分析文字；
   - 截断；
   - 过短；
   - 秘密泄露；
   - 明显禁止词；
   - 关键事实缺失或风险提示。

### 验证

- `node desktop/scripts/check-local-consumption-layer.mjs`
- `node desktop/scripts/check-local-ollama-adapter.mjs`
- 选 1 条已有材料，只重跑本地消费层到 `data/temp` 或受控材料包，确认：
  - brief 不截断；
  - 不出现 `<think>`；
  - 不出现“我将/用户希望”；
  - 字数和结构接近本轮实验。

### 回退

回退 prompt version 和参数；旧 brief 生成仍可使用。

## 阶段 3：定义邮件正文来源

### 目标

明确邮件发送内容从哪里来，避免恢复旧 Summary Pipeline。

### 决策

邮件正文优先使用：

1. `delivery/email.md`，如果存在且质量通过；
2. 否则使用 `exports/brief.local.md`；
3. 不重新调用 MiMo；
4. 不读取旧 `summary/`。

### 实施

1. 如果 `email.md` 继续保留：
   - 让它成为 brief 的轻包装版本；
   - 不再单独发明事实；
   - 可简化为“标题 + brief 正文 + NotebookLM 路径提示”。
2. 或者把 `email.md` 降级为发送时生成的 envelope，主体直接用 `brief.local.md`。
3. `delivery/decision.json` 的 `worthEmail` 可作为发送门控之一，但 fresh 新视频默认更倾向发送；如果 `importance` 很低或质量高风险则跳过。

### 验证

- 生成的邮件正文不含本地路径以外的秘密；
- 不含 API Key、Cookie、SMTP、Authorization 等敏感词；
- 不含 `<think>`。

## 阶段 4：新增邮件发送服务

### 目标

建立独立邮件发送服务，只负责发送已生成的本地总结，不负责生成内容。

### 文件候选

`desktop/electron/services/emailDeliveryService.ts`

### 设计

输入：

```ts
{
  materialPath: string
  queueSource: WorkbenchQueueItem['queueSource']
  settings: RuntimeSettings
  dryRun?: boolean
}
```

输出：

```ts
{
  status: 'sent' | 'skipped' | 'failed'
  reason?: string
  statusPath: string
}
```

发送前检查：

1. `queueSource === 'fresh'`；
2. `settings.email_push_enabled === true`；
3. SMTP 主机、端口、用户、密码、发件人、收件人完整；
4. 材料包路径安全；
5. `delivery/email_status.json` 没有记录同一内容已发送；
6. 本地质量结果不是 high risk；
7. 邮件正文存在且通过敏感词检查。

发送后写：

`delivery/email_status.json`

建议字段：

```json
{
  "schemaVersion": "shijie.email-delivery.v0.1",
  "status": "sent",
  "queueSource": "fresh",
  "sentAt": "ISO 时间",
  "subject": "...",
  "contentSha1": "...",
  "provider": "smtp",
  "messageId": "...",
  "error": ""
}
```

### 依赖策略

当前 `desktop/package.json` 没有 `nodemailer`。

优先方案有两个：

1. **少依赖方案**：用 Node.js 内置 `net` / `tls` 实现最小 SMTP 客户端。优点是不加依赖；缺点是维护成本略高。
2. **稳定依赖方案**：明确新增 `nodemailer`。优点是成熟稳定；缺点是新增依赖，需要记录原因。

建议优先评估 `nodemailer`。这是邮件发送的事实标准库，比自己实现 SMTP 更稳。若新增依赖，应同步更新 `package.json` / lockfile，并在完成报告说明。

### 验证

- dry-run 不连接外网，只写 `email_status.json`。
- fake transport / 测试服务验证邮件构造。
- 真实 SMTP 只在最终阶段用 1 条 fresh 小样本测试。

## 阶段 5：把邮件服务接入队列执行器

### 目标

只在 fresh 视频完成资料和本地总结后尝试发送邮件。

### 实施

1. 修改 `queueExecutor.ts`：
   - `tryPushMaterialEmail` 增加 `target.queueSource` 参数，或在调用点判断；
   - subtitle-only 完成后也允许 fresh 走邮件发送；
   - history / manual / retry / follow_source 一律跳过。
2. 修改 `automationRuntime.ts`：
   - 向 `runWorkbenchQueueExecutor` 注入 `pushMaterialEmail`。
3. 修改 `main.ts`：
   - 装配 `pushMaterialEmail` 为邮件服务；
   - 日志只写 status / reason，不写 SMTP 密码。

### 关键规则

```text
if queueSource !== 'fresh':
  skip email

if local consumption failed or needs_review:
  skip email

if email sending failed:
  queue remains done
  write delivery/email_status.json failed
```

### 验证

- 构造 fresh 队列项：会进入邮件 dry-run。
- 构造 history 队列项：不会进入邮件服务。
- 构造 manual 队列项：不会进入邮件服务。
- 重复执行同一 fresh：不会重复发送。

## 阶段 6：设置页最小恢复

### 目标

让用户能够开启 / 关闭邮件转发，并配置 SMTP，但不恢复旧复杂邮件 UI。

### 实施

1. 设置页只显示必要项：
   - 启用最近更新邮件推送；
   - SMTP 主机；
   - 端口；
   - SSL；
   - 发件邮箱；
   - SMTP 用户；
   - SMTP 授权码；
   - 收件邮箱；
   - 本轮不做测试发送按钮，避免 UI 误触发真实邮件；受控验证使用 `SHIJIE_EMAIL_DRY_RUN` 和检查脚本完成。
2. 文案明确：
   - 只发送最近更新视频；
   - 历史补全不发送；
   - 邮件正文来自本地总结；
   - 发送失败不会影响资料生成。

### 验证

- 设置保存后不展示密码明文；
- 未启用时绝不发送；
- dry-run 检查只写状态文件，不触发真实 SMTP 发送。

## 阶段 7：端到端回归

### 最小验证矩阵

| 场景 | 预期 |
|---|---|
| fresh + 邮件关闭 | 生成资料和 brief，不发送 |
| fresh + 邮件开启 + dry-run | 写 sent/dry-run 状态，不真实发送 |
| fresh + 邮件开启 + 真实 SMTP | 发送 1 封邮件，队列 done |
| history + 邮件开启 | 不发送，状态写 skipped 或不写发送记录 |
| manual + 邮件开启 | 不发送 |
| local brief failed | 不发送，队列仍 done |
| 邮件失败 | 队列仍 done，email_status failed |
| 重复执行同一 fresh | 不重复发送 |

### 自动检查

建议新增：

- `desktop/scripts/check-fresh-email-delivery.mjs`
- `desktop/scripts/check-mimo-cleaning-production-mode.mjs`

并继续运行：

- `node desktop/scripts/check-subtitle-only-queue-mode.mjs`
- `node desktop/scripts/check-local-consumption-layer.mjs`
- `node desktop/scripts/check-local-ollama-adapter.mjs`
- `node desktop/scripts/check-product-refactor-surface.mjs`
- `npx tsc --noEmit`
- `python -m py_compile src/distiller.py`
- `git diff --check`

## 阶段 8：文档收束

按事实更新：

- `PRODUCT.md`：说明最近更新邮件推送能力和历史补全不发送邮件。
- `ARCHITECTURE.md`：增加通知层 / 邮件服务数据流。
- `CURRENT_STATE.md`：记录完成情况、验证结果和遗留风险。
- 本任务文件：写完成记录。

## 最终完成效果

软件后台运行时：

1. 准点发现已追踪 UP 的新视频；
2. 新视频以 `fresh` 加入队列；
3. 队列一次只处理 1 条；
4. 完成转写、MiMo 高保真清洗和 NotebookLM 主资料；
5. 本地模型生成高信息密度 brief；
6. 如果质量通过且邮件已启用，自动发送一封最近更新邮件；
7. 历史补全继续静默沉淀资料，不发送邮件。

## 执行结果记录

完成日期：2026-06-30

### 已完成

1. 生产 MiMo 清洗路线已回到通用高保真逐字清洗。UP 定制 profile 只保留在实验层，正式 `_clean_one_chunk_with_checkpoint` 不传入 `cleaning_profile`。
2. 本地 brief / email 生成策略已升级为事实门控版，并提高 Ollama markdown 上下文和输出预算。
3. 新增 `desktop/electron/services/emailDeliveryService.ts`，只负责发送已经生成的本地总结产物，不调用 MiMo、不读取旧 `summary/`。
4. 邮件通知已接入队列执行器和后台运行时，仅 `queueSource === 'fresh'` 会尝试发送；`history`、`manual`、`retry`、`follow_source` 均不会发送。
5. 邮件发送前检查启用状态、SMTP 配置、邮箱格式、decision、quality、敏感词和重复发送状态；结果写入 `delivery/email_status.json`。
6. 邮件正文不附带本机材料路径；SMTP 报错写入状态或日志前会遮蔽 SMTP 用户和授权码。
7. 设置页恢复了“最近更新邮件推送”的最小 SMTP 配置入口，并用文案说明历史补全不发送。
8. 新增 `nodemailer` / `@types/nodemailer` 作为稳定 SMTP 依赖，避免维护自写 SMTP 客户端。

### 本轮没有做

- 没有真实发送邮件；只完成 dry-run 和静态 / 类型检查。
- 没有恢复旧精读稿 Summary Pipeline、旧邮件模板或 TTS。
- 没有批量重跑已有 `data/materials`。
- 没有把 UP 定制清洗 prompt 接入生产链路。

### 验证命令

- `python -m py_compile src/distiller.py`
- `node desktop/scripts/check-mimo-cleaning-production-mode.mjs`
- `node desktop/scripts/check-fresh-email-delivery.mjs`
- `node desktop/scripts/check-local-consumption-layer.mjs`
- `node desktop/scripts/check-local-ollama-adapter.mjs`
- `node desktop/scripts/check-subtitle-only-queue-mode.mjs`
- `node desktop/scripts/check-product-refactor-surface.mjs`
- `node desktop/scripts/check-home-dashboard-safety.mjs`
- `node desktop/scripts/check-up-sync-scheduler.mjs`
- `node desktop/scripts/check-queue-record-feed.mjs`
- `node desktop/scripts/check-efficiency-observability.mjs`
- `npx tsc --noEmit`
- `git diff --check`（仅 Windows 换行提示，退出码 0）

### 后续真实验收建议

如果要开启真实邮箱发送，建议先使用 1 条 `fresh` 最近更新小样本验证真实 SMTP；历史补全继续保持静默沉淀资料，不进入邮箱。

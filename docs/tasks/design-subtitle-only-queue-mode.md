# 任务：设计字幕清洗-only队列模式

创建日期：2026-06-15
状态：已完成

## 1. 目标

确认当前工作台队列中“字幕清洗”和“精读稿 / 总结生成”如何绑定，并设计一个最小风险的“字幕清洗-only”队列模式。

本任务只做代码阅读、方案设计和 Markdown 记录，不实现代码。

## 2. 本次范围

已静态阅读：

- `AGENTS.md`
- `PRODUCT.md`
- `ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `docs/plans/STABILIZATION_PLAN.md`
- `docs/tasks/define-channel-subtitle-mainline.md`
- `desktop/src/components/WorkspacePane.tsx`
- `desktop/src/components/workspace/WorkbenchSourceParts.tsx`
- `desktop/src/components/workspace/WorkspacePaneUtils.ts`
- `desktop/electron/workbenchQueue.ts`
- `desktop/electron/workbenchQueueStore.ts`
- `desktop/electron/queueExecutor.ts`
- `desktop/electron/backendRuntime.ts`
- `desktop/src/store.ts`
- `src/distiller.py` 中与 `editorial`、`material-only` 和精读稿生成相关的入口

## 3. 明确不做

- 不修改生产代码。
- 不改 UI。
- 不改首页。
- 不改输出目录。
- 不做 UP 主批量入队。
- 不拆 Summary Pipeline。
- 不重构 `src/distiller.py`。
- 不修改真实队列。
- 不启动软件。
- 不运行队列。
- 不调用 B 站、MiMo、邮件、TTS 或本地转写。
- 不处理 Git。

## 4. 当前绑定关系

### 4.1 `WorkbenchQueueItem` 当前控制处理阶段的字段

`desktop/electron/workbenchQueue.ts` 中的 `WorkbenchQueueItem` 主要字段：

| 字段 | 当前作用 |
|---|---|
| `queueId` | 队列项唯一标识。 |
| `queueSource` | 来源类型，目前是 `manual` 或 `follow_source`。 |
| `editorialMode` | 控制是否进入精读稿 / 总结生成相关流程。 |
| `status` | 队列状态：`queued`、`processing`、`done`、`failed`。 |
| `materialPath` | 队列处理成功后记录资料包目录。 |
| `lastError` | 失败原因。 |
| `queuedAt` / `updatedAt` | 队列时间。 |

实际控制阶段的关键字段是 `editorialMode` 和 `status`。当前没有独立的 `pipelineMode` 字段来表达“只清洗字幕”或“完整精读流程”。

### 4.2 `editorialMode` 当前取值

`desktop/electron/workbenchQueue.ts` 中定义：

```ts
type EditorialSummaryMode = 'auto' | 'force' | 'off'
```

含义按当前代码实际表现理解：

| 值 | 当前表现 |
|---|---|
| `auto` | 交给 Python 的 eligibility 规则决定是否生成精读稿。 |
| `force` | 强制进入精读稿 / 总结生成路径。 |
| `off` | 禁止精读稿 / 总结生成，保留字幕清洗资料。 |

`sanitizeEditorialSummaryMode()` 只接受 `force` 和 `off`，其他值都会回到 `auto`。

### 4.3 UP 主批量入队为什么会使用 `editorialMode: 'force'`

有两处来源：

1. `desktop/src/components/WorkspacePane.tsx` 的 `handleAddSelectedVideosToQueue()`：

```ts
createWorkbenchQueueItem(video, 'queued', { queueSource: 'follow_source', editorialMode: 'force' })
```

2. `desktop/electron/sourceDiscovery.ts` 的 `createBackgroundQueueItem()`：

```ts
queueSource: 'follow_source',
editorialMode: 'force',
```

另外，`desktop/src/components/workspace/WorkspacePaneUtils.ts` 的 `createWorkbenchQueueItem()` 默认规则也是：

```ts
queueSource === 'follow_source' ? 'force' : 'off'
```

所以当前设计含义是：手动 B 站输入默认只整理资料，UP 主 / 来源视频默认走强制编稿。

### 4.4 `queueExecutor.ts` 何时触发精读稿 / 总结生成

`desktop/electron/queueExecutor.ts` 的关键逻辑：

1. 先找已有材料：

```ts
existingRecord = findMaterialRecordByBvid(...)
```

2. 如果已有 summary ready：

```ts
isMaterialRecordSummaryReady(existingRecord)
```

则直接归档、可能推邮件，并把队列设为 `done`。

3. 如果还没有清洗材料：

```ts
if (!isMaterialRecordCleaned(existingRecord)) {
  runDistiller({ video, sourceKind: 'bilibili', editorialMode })
}
```

4. 然后只要：

```ts
editorialMode !== 'off'
```

就继续调用：

```ts
runMaterialSummary({ materialPath, editorialMode })
```

结论：队列层真正触发精读稿 / 总结的条件是 `editorialMode !== 'off'`，不是 `--material-only`。

### 4.5 `backendRuntime.ts` 调用 Python 时传了哪些参数

`runPythonDistiller()` 调用资料整理：

```text
python src/distiller.py <inputValue> --result-json --material-only
```

如果是本地媒体，会额外加：

```text
--local-media
```

同时通过环境变量传入：

```text
SHIJIE_EDITORIAL_SUMMARY_MODE=<sanitizeEditorialSummaryMode(payload.editorialMode)>
SHIJIE_FOCUS_OUTPUT_DIR=<materialOutputDir>
BILIBILI_SESSDATA=<settings.sessdata>
SHIJIE_MIMO_API_KEY=<settings.mimo_api_key>
SHIJIE_CONTENT_CLEANING_MODE=auto 或 rule
```

`runPythonMaterialSummary()` 调用总结 / 精读稿：

```text
python src/distiller.py --summarize-material <materialPath> --result-json
```

并默认传：

```text
SHIJIE_EDITORIAL_SUMMARY_MODE=force
```

### 4.6 `distiller.py --material-only` 是否仍会生成精读稿

结论要分两层看：

- `run_distillation_from_bilibili(video_input, material_only=False)` 接收了 `material_only` 参数，但当前函数体没有用它来跳过 `save_material_package()` 内部的 editorial 调用。
- `save_material_package()` 会调用 `build_editorial_summary_content()`，该函数会根据 `SHIJIE_EDITORIAL_SUMMARY_MODE` 判断是否 eligible。

关键逻辑：

```py
if mode in {"off", "none", "skip"}:
    eligible = False
```

所以：

| 情况 | 结果 |
|---|---|
| `--material-only` + `SHIJIE_EDITORIAL_SUMMARY_MODE=off` | 不生成精读稿，只会写 `summary_status.json` 的 skipped 状态。 |
| `--material-only` + `SHIJIE_EDITORIAL_SUMMARY_MODE=force` | 仍可能生成精读稿。 |
| `--material-only` + `auto` | 可能按时长、正文长度、Key 是否存在等规则决定是否生成。 |

因此，`--material-only` 本身不是可靠的“字幕清洗-only”开关。可靠开关目前是 `SHIJIE_EDITORIAL_SUMMARY_MODE=off`，但队列执行器后续还会根据 `editorialMode !== 'off'` 单独调用 `--summarize-material`。

### 4.7 `run_state.json` 中 `content_ready` 和队列状态的关系

`src/distiller.py` 的 `_build_run_state()` 会写：

```json
{
  "stage": "content_ready",
  "stage_label": "字幕清洗完成",
  "completed_stages": ["raw_transcript", "content_cleaning", "notebooklm_export"],
  "summary_ready": false
}
```

队列状态 `done` 不直接读取 `run_state.json`。当前 `queueExecutor.ts` 的完成条件是：

- `runDistiller()` 返回了存在的 `materialPath`；
- 如果 `editorialMode !== 'off'`，`runMaterialSummary()` 没有返回错误；
- 然后把队列项更新为 `status: 'done'`。

材料列表的 `workflowStage` 也不是直接从 `run_state.json` 判断，而是在 `desktop/electron/materialInventory.ts` 中按文件存在情况推断：

- 有 `summary/article.md` 且状态可用 → `summary_ready`
- 有 `exports/notebooklm.md` → `content_ready`
- 有 `raw_transcript.txt` → `transcript_ready`

所以目前 `content_ready` 是材料阶段，`done` 是队列阶段。二者相关，但不是同一个字段，也没有强绑定。

### 4.8 黄色状态灯目前由哪个字段或状态决定

`desktop/src/components/workspace/WorkspacePaneUtils.ts` 的 `getWorkbenchSourceStatus()` 决定状态灯：

```ts
if (record?.notebooklmExists || record?.rawTranscriptExists || item.queue?.status === 'done') {
  return { label: '字幕清理完成', tone: 'yellow', active: false }
}
```

绿色灯来自：

- `record.editorialSummaryExists`
- 或 `canOpenMaterialBrief(record)`，其中 `canOpenMaterialBrief()` 当前等价于精读稿存在或 `workflowStage === 'summary_ready'`

因此字幕清洗-only 完成后，合理状态是黄色：`notebooklmExists` 或 `rawTranscriptExists` 为真，或队列项 `done`。

## 5. 推荐的最小改造方案

### 5.1 不推荐新增 `editorialMode: 'skip'`

原因：

- 当前 `editorialMode` 已经有 `off`，语义接近“不要编稿”。
- `sanitizeEditorialSummaryMode()` 当前只认识 `force` 和 `off`，新增 `skip` 会被降级成 `auto`，如果遗漏某处类型或 sanitizer，反而可能误触发总结。
- Python 侧 `_editorial_summary_eligibility()` 已接受 `skip`，但 TypeScript 侧不接受。跨层不一致会增加风险。
- `editorialMode` 本质是在描述 Summary Pipeline 的模式，不适合作为整个队列 Pipeline 的唯一控制字段。

### 5.2 推荐新增更明确的字段：`pipelineMode`

推荐字段：

```ts
pipelineMode?: 'subtitle_only' | 'full_editorial'
```

含义：

| 值 | 意义 |
|---|---|
| `subtitle_only` | 队列只负责字幕获取、字幕清洗和 NotebookLM 可导入资料。完成后不调用 `runMaterialSummary()`，不推邮件。 |
| `full_editorial` | 队列完成字幕清洗后，继续走 Summary Pipeline。当前旧行为可映射到此模式。 |

### 5.3 为什么 `pipelineMode` 风险更低

- 语义清楚：它描述整条队列 Pipeline，而不是只描述精读稿生成策略。
- 兼容旧数据：旧队列没有 `pipelineMode` 时，可以按现有 `editorialMode` 和 `queueSource` 推导，不需要迁移真实队列。
- 回退简单：如果只在规范化和执行器中读取可选字段，旧字段仍可保留。
- 可测试：可以用纯内存队列项覆盖 `subtitle_only`、`full_editorial`、旧 `follow_source`、旧 `manual` 的行为。
- 能逐步隔离 Summary Pipeline：先不拆 `distiller.py`，只让队列执行器不再为 subtitle-only 调用 `runMaterialSummary()`。

## 6. 建议字段规则

建议在 `WorkbenchQueueItem` 中新增：

```ts
pipelineMode?: 'subtitle_only' | 'full_editorial'
```

建议规范化规则：

| 输入 | 规范化结果 |
|---|---|
| 明确传入 `pipelineMode: 'subtitle_only'` | 保留 `subtitle_only`，并把 `editorialMode` 规范为 `off`。 |
| 明确传入 `pipelineMode: 'full_editorial'` | 保留 `full_editorial`，`editorialMode` 可为 `force` 或 `auto`。 |
| 旧队列项没有 `pipelineMode` 且 `editorialMode === 'off'` | 推导为 `subtitle_only`。 |
| 旧队列项没有 `pipelineMode` 且 `editorialMode !== 'off'` | 推导为 `full_editorial`，保持旧行为。 |
| 新 UP 主批量入队 | 应传 `pipelineMode: 'subtitle_only'` 和 `editorialMode: 'off'`。 |

注意：为了降低风险，下一步实现时不要删除 `editorialMode`。先让 `pipelineMode` 控制是否进入 Summary Pipeline，`editorialMode` 继续传给 Python / Summary 相关代码。

## 7. 字幕清洗-only 的队列完成条件

推荐完成条件从强到弱：

1. `runDistiller()` 成功返回 `materialPath`，且路径存在。
2. 资料包内存在 `content.md`。
3. 资料包内存在 `exports/notebooklm.md`。
4. `raw_transcript.txt` 存在。
5. 如能读取静态样例，可验证 `run_state.json.stage === 'content_ready'` 或 `current_stage === 'content_ready'`。

最小实现时，队列执行器已经检查了 `materialPath` 存在。为了更稳，后续可以增加一个纯函数，例如：

```ts
isSubtitleOnlyMaterialReady(recordOrFiles)
```

推荐初版判断：

```text
notebooklmExists || rawTranscriptExists
```

更严格的静态样例检查可以覆盖：

```text
content.md exists
exports/notebooklm.md exists
raw_transcript.txt exists
run_state.json stage/content_ready
```

## 8. 需要修改的文件

下一步实现时预计涉及：

| 文件 | 修改目的 |
|---|---|
| `desktop/electron/workbenchQueue.ts` | 增加 `PipelineMode` 类型、`pipelineMode` 字段、规范化和旧数据兼容推导。 |
| `desktop/src/vite-env.d.ts` | 更新 `WorkbenchQueueItem` / API 暴露类型中的队列字段。 |
| `desktop/src/components/workspace/WorkspacePaneUtils.ts` | `createWorkbenchQueueItem()` 支持 `pipelineMode`；UP 主新队列默认 subtitle-only。 |
| `desktop/src/components/WorkspacePane.tsx` | UP 主批量入队传 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`。 |
| `desktop/electron/sourceDiscovery.ts` | 后台发现生成队列项时使用 subtitle-only，避免自动编稿。 |
| `desktop/electron/queueExecutor.ts` | 用 `pipelineMode` 判断是否调用 `runMaterialSummary()`；subtitle-only 完成后直接 `done`。 |

可能需要但不一定第一步修改：

| 文件 | 说明 |
|---|---|
| `desktop/electron/backendRuntime.ts` | 如果类型引用 `EditorialSummaryMode` 以外不变，未必需要改；保持 `editorialMode: 'off'` 传给 Python 即可。 |
| `desktop/src/components/workspace/WorkbenchQueueParts.tsx` | 如果需要显示“只清洗字幕”标签再改；本阶段不改 UI。 |
| `desktop/src/store.ts` | 手动 / 本地直接 distill 已可传 `editorialMode`，本阶段未必需要改。 |

## 9. 本阶段绝对不要动的文件或区域

- 不重构 `src/distiller.py`。
- 不修改 `output/` 下真实资料。
- 不读取或写入真实 Electron Store。
- 不改 `desktop/electron/materialDeletion.ts`。
- 不改邮件、TTS、Obsidian 导出模块。
- 不改首页或专注页。
- 不改输出目录契约。
- 不启动 Electron。
- 不运行队列。
- 不调用 B 站、MiMo、邮件、TTS 或本地转写。

## 10. 验证方法

### 10.1 纯内存验证

建议新增或扩展一个只跑纯函数的检查脚本，不读取真实队列。

覆盖样例：

1. 旧 `follow_source` + `editorialMode: 'force'` + 无 `pipelineMode`：
   - 规范化后应保持 `full_editorial`，保证旧数据兼容。
2. 新 UP 主队列项：
   - `pipelineMode === 'subtitle_only'`
   - `editorialMode === 'off'`
3. 手动队列项：
   - 默认应保持 `subtitle_only` 或等价的 `editorialMode: 'off'` 行为。
4. `subtitle_only` 执行器样例：
   - 会调用 `runDistiller()`。
   - 不调用 `runMaterialSummary()`。
   - 成功后队列项变 `done`，带 `materialPath`。
5. `full_editorial` 执行器样例：
   - 清洗完成后仍调用 `runMaterialSummary()`，保持旧完整流程可用。
6. 已有清洗资料但无 summary 的 `subtitle_only` 样例：
   - 不重复调用 distiller。
   - 不调用 summary。
   - 队列完成。

### 10.2 静态样例验证

可构造临时目录样例，不使用真实 `output/materials`：

```text
tmp/sample.course_material/
├── manifest.json
├── raw_transcript.txt
├── content.md
├── exports/notebooklm.md
└── run_state.json
```

验证目标：

- 能识别为字幕清洗完成。
- `run_state.json.stage` 或 `current_stage` 为 `content_ready` 时符合 subtitle-only 完成语义。
- 不要求 `summary/article.md` 存在。

### 10.3 禁止的验证

- 不启动桌面端。
- 不运行真实队列。
- 不读取真实 AppData 队列。
- 不调用 B 站。
- 不调用 MiMo。
- 不发送邮件。
- 不生成 TTS。
- 不写真实 `output/materials`。

## 11. 回退方法

实现阶段如果出问题，回退应只涉及本次新增字段和队列判断：

1. 回退 `pipelineMode` 类型和规范化逻辑。
2. 回退 UP 主入队时传入的 `pipelineMode: 'subtitle_only'`。
3. 回退 `queueExecutor.ts` 中基于 `pipelineMode` 跳过 summary 的判断。
4. 保留旧 `editorialMode` 语义不变，因此旧队列仍可按原逻辑运行。

不需要迁移、清理或修改真实队列数据。

## 12. 下一步可执行的小任务

建议下一步只做一个小型代码任务：

为 `desktop/electron/workbenchQueue.ts` 和 `desktop/electron/queueExecutor.ts` 增加纯内存 subtitle-only 保护检查。

任务边界：

- 新增 `pipelineMode?: 'subtitle_only' | 'full_editorial'`。
- 只改队列纯逻辑和执行器分支。
- 不改 UI。
- 不启动软件。
- 不运行真实队列。
- 不读取 AppData。
- 不调用外部服务。

最小成功标准：

- 新 subtitle-only 队列项不会调用 `runMaterialSummary()`。
- 旧 full-editorial 队列项仍会调用 `runMaterialSummary()`。
- `editorialMode: 'off'` 仍能阻止精读稿生成。
- 旧队列项没有 `pipelineMode` 时行为可预测且兼容。

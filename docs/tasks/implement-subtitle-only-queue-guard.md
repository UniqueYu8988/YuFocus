# 任务：实现 subtitle-only 队列保护

创建日期：2026-06-15
状态：已完成

## 1. 目标

让工作台队列支持明确字段：

```ts
pipelineMode?: 'subtitle_only' | 'full_editorial'
```

当 `pipelineMode === 'subtitle_only'` 时，队列只执行字幕获取、字幕清洗和 material package 生成，不触发 `runMaterialSummary()`，不进入总结、邮件或 TTS 等后续消费层。

## 2. 本轮范围

- 只做最小队列层代码改动。
- 新增纯内存检查脚本。
- 不改 UI。
- 不改首页。
- 不做 UP 主批量入队。
- 不改输出目录。
- 不重构 `src/distiller.py`。
- 不启动软件。
- 不运行真实队列。
- 不处理 Git。

## 3. 设计依据

已完成设计任务：`docs/tasks/design-subtitle-only-queue-mode.md`。

当前绑定关系：

- 旧队列通过 `editorialMode` 控制是否进入 Summary Pipeline。
- `queueExecutor.ts` 之前在 `editorialMode !== 'off'` 时调用 `runMaterialSummary()`。
- `--material-only` 不是可靠的字幕-only 开关；队列层必须明确阻断 Summary Pipeline。

## 4. 实施计划

1. 在 `desktop/electron/workbenchQueue.ts` 增加 `PipelineMode` 类型、字段和 sanitizer。
2. 旧队列项没有 `pipelineMode` 时，从 `editorialMode` 推导：
   - `editorialMode === 'off'` → `subtitle_only`
   - 其他情况 → `full_editorial`
3. 显式 `subtitle_only` 时把 `editorialMode` 固定为 `off`，避免 Python 侧误进 editorial。
4. 在 `queueExecutor.ts` 里用 `pipelineMode` 明确跳过 Summary Pipeline：
   - 不调用 `runMaterialSummary()`
   - 不调用 `archiveMaterialRecord()`
   - 不调用邮件推送
5. 更新前端共享类型，避免 TypeScript 丢字段。
6. 新增 `desktop/scripts/check-subtitle-only-queue-mode.mjs`，只用内存 mock 验证。

## 5. 验证方法

- 运行纯内存脚本：

```powershell
cd desktop
node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs
```

- 运行 TypeScript 类型检查：

```powershell
cd desktop
npx tsc --noEmit
```

验证脚本不得读取真实 AppData、不得调用 B 站、Python、MiMo、邮件、TTS，不写真实 output。

## 6. 回退方法

回退本任务修改的文件即可：

- `desktop/electron/workbenchQueue.ts`
- `desktop/electron/queueExecutor.ts`
- `desktop/src/vite-env.d.ts`
- `desktop/scripts/check-subtitle-only-queue-mode.mjs`
- 本任务文件和 `CURRENT_STATE.md` 的状态记录

不需要迁移或清理真实队列数据。

## 7. 完成结果

已完成：

- `WorkbenchQueueItem` 增加 `pipelineMode?: 'subtitle_only' | 'full_editorial'`。
- `sanitizePipelineMode()` 已识别合法字段，非法值会按 `editorialMode` 安全回落。
- 旧队列项没有 `pipelineMode` 时保持兼容：
  - `editorialMode === 'off'` 推导为 `subtitle_only`。
  - 其他情况推导为 `full_editorial`。
- 显式 `subtitle_only` 会把 `editorialMode` 固定为 `off`。
- `queueExecutor.ts` 在 `subtitle_only` 时跳过 Summary Pipeline：
  - 不调用 `runMaterialSummary()`。
  - 不调用 `archiveMaterialRecord()`。
  - 不调用邮件推送。
- 执行器额外兜底：即使收到未规范化的 `pipelineMode: 'subtitle_only'` + `editorialMode: 'force'`，传给整理链路的有效 `editorialMode` 仍为 `off`。
- 前端共享类型和 `createWorkbenchQueueItem()` 已支持 `pipelineMode` 字段，但本轮未改变 UI 入队行为。

## 8. 验证结果

已通过：

```powershell
cd desktop
node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs
npx tsc --noEmit
```

纯内存检查覆盖：

- `subtitle_only` 不调用 `runMaterialSummary()`。
- `subtitle_only` 不调用邮件推送。
- 未规范化的 `subtitle_only` 也会强制 `editorialMode: 'off'`。
- 旧 `manual + editorialMode: off` 推导为 `subtitle_only`。
- 旧 `follow_source + editorialMode: force` 推导为 `full_editorial`，保持旧行为。
- 非法 `pipelineMode` 安全回落。
- 不读取真实 AppData。
- 不调用 B 站、Python、MiMo、邮件或 TTS。
- 不写真实 output。

## 9. 下一步

下一步可以做一个独立小任务：把 UP 主批量加入队列和后台发现生成的队列项显式改为：

```ts
pipelineMode: 'subtitle_only',
editorialMode: 'off',
```

该下一步才会改变新入队行为；本任务只建立队列层保护。

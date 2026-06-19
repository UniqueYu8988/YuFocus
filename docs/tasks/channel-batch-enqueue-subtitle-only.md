# 任务：UP 主批量加入队列默认使用 subtitle-only

创建日期：2026-06-15
状态：已完成

## 1. 目标

把 UP 主 / 来源视频列表中的批量加入队列行为改为显式创建：

```ts
pipelineMode: 'subtitle_only'
editorialMode: 'off'
```

目标是确保 UP 主批量字幕清洗不会触发精读稿、总结、邮件或 TTS。

## 2. 范围

允许修改：

- `desktop/src/components/WorkspacePane.tsx`
- `desktop/electron/sourceDiscovery.ts`
- `desktop/scripts/check-subtitle-only-queue-mode.mjs`
- 本任务文件
- 必要时更新 `CURRENT_STATE.md`

明确不做：

- 不改首页。
- 不改“专注”页面。
- 不改总结、邮件、TTS。
- 不改 NotebookLM 输出目录。
- 不迁移旧数据。
- 不删除旧功能。
- 不重构 `src/distiller.py`。
- 不启动软件。
- 不运行真实队列。
- 不处理 Git。

## 3. 入口确认

真实前端入口：

```text
WorkbenchSourceParts.tsx
→ WorkbenchToolbar 的“加入队列”按钮
→ props.onAddSelectedVideos
→ WorkspacePane.tsx 的 handleAddSelectedVideosToQueue()
→ createWorkbenchQueueItem(video, 'queued', options)
```

后台来源发现入口：

```text
sourceDiscovery.ts
→ discoverPinnedSourceVideos()
→ createBackgroundQueueItem()
```

单视频手动入口：

```text
WorkspacePane.tsx
→ handleQueueManualBilibiliVideo()
→ createWorkbenchQueueItem(video)
```

本轮保持单视频手动入口不变。

## 4. 验证方法

运行：

```powershell
cd desktop
node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs
npx tsc --noEmit
```

验证不读取真实 AppData、不调用 B 站、不调用 Python、不调用 MiMo / 邮件 / TTS、不写真实 output。

## 5. 完成结果

已完成：

- `WorkbenchToolbar` 的“加入队列”按钮仍通过 `onAddSelectedVideos` 进入 `WorkspacePane.tsx`。
- `WorkspacePane.tsx` 的 `handleAddSelectedVideosToQueue()` 现在批量创建队列项时显式传入：

```ts
queueSource: 'follow_source'
editorialMode: 'off'
pipelineMode: 'subtitle_only'
```

- 单视频手动入口 `handleQueueManualBilibiliVideo()` 保持原样，仍调用 `createWorkbenchQueueItem(video)`。
- 后台来源发现入口 `createBackgroundQueueItem()` 已一并改为：

```ts
editorialMode: 'off'
pipelineMode: 'subtitle_only'
```

- 未修改 `queueExecutor.ts`，因为任务 3 的执行器保护仍有效。
- 未修改 `distiller.py`、首页、专注页、输出目录、总结、邮件或 TTS。

## 6. 验证结果

已通过：

```powershell
cd desktop
node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs
npx tsc --noEmit
```

覆盖内容：

- UP 主批量入队样例项包含 `pipelineMode: 'subtitle_only'` 和 `editorialMode: 'off'`。
- 这些 item 经过 sanitizer 后仍保留 subtitle-only。
- queue executor 对这些 item 不调用 `runMaterialSummary()`。
- 不触发归档邮件分支。
- 后台来源发现创建项使用 subtitle-only。
- 单视频手动入口保持 `createWorkbenchQueueItem(video)`，本轮未改。
- 不读真实 AppData。
- 不调用 B 站、Python、MiMo、邮件或 TTS。
- 不写真实 output。

## 7. 下一步

下一步可以做“真实小样本 UP 主字幕清洗试运行”的受控任务。

建议范围：

- 只选 1 条短视频。
- 先确认后台自动化状态和队列安全。
- 明确允许读取 B 站和写入一个真实 material package。
- 验证队列完成后只有字幕清洗 / NotebookLM 导入稿，不生成新的精读稿、邮件或 TTS。

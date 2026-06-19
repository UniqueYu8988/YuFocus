# 任务：安全剪枝字幕清洗引擎之外的遗留代码

创建日期：2026-06-15
状态：已完成

## 1. 目标

在不改变当前主线的前提下，减少代码体积和入口复杂度。

当前唯一主动系统：

```text
UP 主 → 视频列表 → 字幕获取 / 转写兜底 → 字幕清洗 → NotebookLM 输出
```

## 2. 禁止修改

- 不改 `subtitle_only` 队列主逻辑。
- 不改 UP 主来源、视频列表、批量入队。
- 不改 B 站字幕获取。
- 不改 SenseVoice 转写兜底。
- 不改 NotebookLM 输出生成。
- 不重构 `distiller.py`。
- 不执行 Git 写操作。

## 3. 剪枝原则

先判断引用和可达性，再处理：

| 分类 | 含义 | 处理 |
|---|---|---|
| MUST KEEP | 字幕主线直接需要 | 不动 |
| SAFE TO ISOLATE | 已不在主 UI，但仍有 IPC、设置、兼容数据或间接引用 | 从入口断开或标记遗留，不直接删 |
| SAFE TO DELETE | 无 import、无 IPC、无脚本入口、无主线依赖 | 删除 |

## 4. 初步候选系统

- Summary / editorial。
- Email。
- TTS。
- Reading / Focus / Learning。
- Obsidian 和旧 course package 兼容。

## 5. 验证

- 静态 import 图检查。
- `desktop/scripts/check-product-refactor-surface.mjs`。
- `desktop/scripts/check-subtitle-only-queue-mode.mjs`。
- `cd desktop && npx tsc --noEmit`。
- 本轮如未启动真实软件，需说明原因。

## 6. 引用追踪结果

已追踪关键词：

- summary / editorial / runMaterialSummary。
- email / SMTP / push。
- tts / speech / audio。
- reading / focus / learning / course。
- Obsidian。

结论：

| 分类 | 结果 | 处理 |
|---|---|---|
| MUST KEEP | UP 主来源、B 站视频列表、字幕获取、SenseVoice 兜底、material package、NotebookLM 输出、`subtitle_only` 队列保护 | 不改 |
| SAFE TO ISOLATE | Summary / editorial 生成分支、旧学习库兼容、历史 summary metadata、旧设置字段 | 保留兼容，继续由 `pipelineMode: 'subtitle_only'` 阻断主流程 |
| SAFE TO DELETE | 阅读 / 专注 UI 静态链、TTS IPC 和服务、邮件发送服务、Obsidian CLI / IPC / 导出服务、未引用 UI 基础组件和语音预览资产 | 已删除或断开入口后删除 |

静态 import 图结果：

- `desktop/src/main.tsx`、`desktop/electron/main.ts`、`desktop/electron/preload.ts` 作为入口时，唯一未从 import 图到达的 TS 文件是 `desktop/src/vite-env.d.ts`。
- `vite-env.d.ts` 是 Vite / TypeScript 全局类型声明文件，属于 MUST KEEP，不删除。

## 7. 本轮删除 / 断开的内容

删除文件：

- 阅读 / 专注 UI：`ArticleHtmlRenderer.tsx`、`CoachChatTimeline.tsx`、`CoachComposer.tsx`、`CoachPane.tsx`、`OutlineNodeItem.tsx`。
- 旧学习包兼容：`learningNotesStudyPackage.ts`。
- TTS：`ttsIpcHandlers.ts`、`ttsService.ts`、`desktop/src/lib/tts.ts`、4 个 `mimo-voice-previews/*.wav` 预览音频。
- 邮件：`emailPush.ts`、`smtpEmail.ts`。
- Obsidian：`obsidianCli.ts`、`obsidianExport.ts`、`obsidianIpcHandlers.ts`。
- 未引用 UI 基础组件：`separator.tsx`、`textarea.tsx`。

断开的入口：

- `main.ts` 不再注册 TTS、邮件测试和 Obsidian IPC。
- `preload.ts` 不再暴露 TTS、邮件测试和 Obsidian API。
- 设置页不再包含邮件、TTS、Obsidian 设置块。
- 输出页不再显示邮件推送统计、筛选和状态列。
- 流程页只展示字幕清洗到 NotebookLM 输出主线。
- `appLifecycle.ts` 不再保留 Obsidian 专用 CLI 启动分支。

## 8. 保留但标记为隔离的遗留链

- `queueExecutor.ts` 中 full editorial 兼容分支仍保留，但 `subtitle_only` 明确不会进入。
- `backendRuntime.ts` 中 `runPythonMaterialSummary` 仍保留，用于旧队列 / 旧 full editorial 兼容，不作为主流程入口。
- `settings.ts` 和浏览器 fallback 中仍保留部分 TTS / Email 字段默认值，用于读取旧配置文件时不丢字段；没有 IPC 或 UI 执行入口。
- `materialInventory.ts` 仍读取历史 `summary_status.json` 和 `emailPushedAt` 元数据，用于旧材料包兼容展示，不触发生成或发送。
- 旧学习库 IPC / store 仍在兼容层，未继续扩大本轮范围。

## 9. 验证结果

已通过：

- `cd desktop && npx tsc --noEmit`
- `node desktop/scripts/check-product-refactor-surface.mjs`
- `node desktop/scripts/check-subtitle-only-queue-mode.mjs`
- `node desktop/scripts/check-distill-progress.mjs`
- 删除后关键词检查：TTS IPC、邮件测试 IPC、Obsidian IPC / CLI、已删组件和已删音频没有剩余引用。

未执行：

- 未启动真实软件、未跑真实 B 站视频、未运行真实队列。原因：本轮剪枝没有改字幕获取、SenseVoice、NotebookLM 输出或队列主线；真实小样本已在上一阶段通过。本轮优先避免新增 AppData、日志和 output 写入噪音。
- 未执行完整 `npm run build` / 打包。原因：会生成或覆盖构建产物，与本轮代码剪枝目标无关；当前已用 TypeScript 和静态检查覆盖 broken import 风险。

## 10. 结果

- subtitle_only 主线保持完整。
- UP 主批量入队规则保持 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`。
- 纯内存检查确认 subtitle_only 不会调用 `runMaterialSummary`，也不会触发邮件或 TTS。
- 按 Git diff 统计，本轮及前置产品收束改动合计减少约 5,300 行文本代码，并删除约 650 KB 未引用语音预览资产；其中本轮新增剪枝主要来自 TTS、邮件、Obsidian 和旧阅读 UI。

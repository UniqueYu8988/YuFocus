# 任务：定义 UP 主驱动的字幕清洗主线

创建日期：2026-06-15
状态：已完成

## 1. 目标

正式记录下一阶段主线为“UP 主驱动的字幕清洗”，把产品和工程边界从短视频精读、邮件推送、TTS 等后续消费能力中分离出来。

下一阶段主线：

```text
UP 主 / 来源视频列表
→ 批量选择
→ 字幕获取
→ 字幕清洗
→ NotebookLM 可导入资料
```

## 2. 背景

刚完成的字幕链路只读分析确认：

- 手动 B 站输入会通过 `WorkspacePane.tsx`、`store.ts`、`distill:run`、`backendRuntime.ts` 调用 `src/distiller.py`。
- UP 主来源视频会先进入工作台队列，再由 `queueExecutor.ts` 调用同一条 Python 字幕获取和清洗链路。
- Python 侧会优先抓取 B 站字幕，失败或缺分 P 时再使用音频转写缓存或本地转写兜底。
- 最终当前代码会写入 `.course_material` 内部资料目录，包括 `raw_transcript.txt`、`raw_tracks.json`、`content.md`、`exports/notebooklm.md`、`manifest.json` 和索引文件。
- 当前 UP 主批量入队路径使用 `editorialMode: 'force'`，字幕清洗完成后仍会继续尝试生成精读稿。

## 3. 本次范围

- 更新 `PRODUCT.md`，明确字幕系统是当前核心数据层。
- 更新 `CURRENT_STATE.md`，明确下一步只做“字幕清洗-only”队列模式确认和设计。
- 更新 `docs/plans/STABILIZATION_PLAN.md`，调整下一阶段稳定化方向。
- 必要时更新 `ARCHITECTURE.md`，把 Summary Pipeline 与字幕 Pipeline 分层。

## 4. 明确不做

- 不修改生产代码。
- 不启动软件。
- 不运行队列。
- 不调用 B 站、MiMo、邮件、TTS 或本地转写。
- 不处理 Git。
- 不迁移旧档案、旧灵犀、旧 course / lesson / 学习包体系。
- 不直接重构 `src/distiller.py`。
- 不继续设计总结内容格式、邮件形态或 TTS 体验。

## 5. 新主线边界

### 当前核心数据层

字幕系统是当前核心数据层。它负责从 UP 主 / 来源视频列表或单个视频输入中获取字幕或转写文本，清洗为可阅读资料，并产出 NotebookLM 可导入材料。

### 后续独立消费层

总结、精读稿、邮件和 TTS 暂停作为主线推进。它们以后应作为独立的 Summary Pipeline 或阅读消费模块，读取字幕清洗产物，而不是继续绑在字幕清洗主流程中。

### 当前关键风险

批量加入大量 UP 主视频之前，必须先处理 `editorialMode: 'force'`。否则当前队列执行路径会在字幕清洗后继续尝试生成精读稿，带来额外 API 消耗、处理时长、失败面和邮件/总结链路耦合风险。

## 6. 下一步

下一步不是批量入队，也不是优化总结质量，而是先确认并设计“字幕清洗-only”队列模式。

建议范围：

- 只读核对当前 `WorkbenchQueueItem.editorialMode`、`queueSource` 和 `queueExecutor.ts` 的分支。
- 明确 UP 主批量队列项应如何表达“只获取和清洗字幕，不生成精读稿”。
- 在实现前先建立小任务边界和最小验证方式。

## 7. 验证

本任务只修改 Markdown。

已完成的检查：

- 确认未修改生产代码。
- 确认未启动软件、未运行队列、未调用外部服务。
- 通过文本搜索核对正式文档中“主线”和“下一步”描述已收敛到字幕清洗-only 队列模式。

## 8. 回退方式

如需回退，只回退本任务涉及的 Markdown 文件即可；不涉及生产代码、真实队列、AppData、材料目录或外部服务状态。

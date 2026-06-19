# 计划：字幕处理引擎分层目录迁移

创建日期：2026-06-15
状态：已完成

## 1. 迁移顺序

1. 扫描现有 `desktop/src` 和 `desktop/electron` 模块，建立分类表。
2. 先移动前端 UI、domain、services、state，不改逻辑。
3. 再移动 Electron IPC、runtime、queue、providers、services，不改逻辑。
4. 修复 import 路径。
5. 运行 TypeScript 和现有纯内存保护脚本。
6. 更新架构和当前状态文档。

## 2. 保护边界

必须保持：

- UP 主来源列表和视频列表。
- 批量入队 `pipelineMode: 'subtitle_only'`。
- 队列执行器对 `subtitle_only` 的保护。
- B 站字幕获取和视频信息读取。
- SenseVoice 转写兜底配置。
- `.course_material/exports/notebooklm.md` 输出。
- 真实数据位置和 Electron Store 位置。

## 3. 不在本计划中做

- 不拆 `WorkspacePane.tsx` 的业务状态。
- 不拆 `distiller.py`。
- 不删除旧数据。
- 不恢复 Summary / Email / TTS。
- 不引入新依赖。

## 4. 验收

本计划完成时，应能确认：

- 新目录骨架存在。
- 文件按当前职责移动。
- 没有 broken import。
- `npx tsc --noEmit` 通过。
- `check-product-refactor-surface.mjs` 和 `check-subtitle-only-queue-mode.mjs` 通过。

## 5. 完成记录

- 前端目录已收束为 `ui`、`domain`、`services`、`state`、`legacy`。
- Electron 目录已收束为 `ipc`、`runtime`、`queue`、`providers`、`services`、`legacy`。
- `main.tsx`、`electron/main.ts`、`electron/preload.ts` 保留为入口文件，不作为业务目录。
- 本轮未拆函数、未改 pipeline 行为、未改 Python。
- 验证通过，未发现循环依赖。

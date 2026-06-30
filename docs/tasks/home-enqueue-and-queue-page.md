# 首页加入队列与任务队列页收束

状态：已完成

## 目标

把视频选择和加入队列入口放到首页“视频来源”功能区；原“字幕流水线”页面更名为“任务队列”，并只负责展示和管理队列任务信息。

## 范围

- 首页视频来源列表支持选择视频，并通过按钮加入任务队列。
- 加入队列只保存队列记录，不直接调用下载、转写或制作入口。
- 加入队列的新项必须继续使用 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`。
- 侧边栏和页面标题从“字幕流水线”改为“任务队列”。
- 任务队列页移除视频来源板块，只保留队列任务信息。

## 不做

- 不删除真实材料包。
- 不自动启动下载、转写或清洗。
- 不拆 `WorkspacePane.tsx` 大文件。
- 不删除旧来源组件文件，只从任务队列页移除入口。

## 风险

- 首页保存队列会写入 Electron Store 的队列记录；这是用户明确要求的加入队列行为。
- 队列中已有或已有材料的视频必须避免重复加入。
- 旧静态检查里对“首页不能保存队列”的规则需要调整成“首页只能保存队列，不能直接制作”。

## 验收

- [x] 首页视频来源区可勾选视频并加入任务队列。
- [x] 重复视频或已有资料不会重复入队。
- [x] 任务队列页不再显示视频来源选择板块。
- [x] 导航和页面标题显示“任务队列”。
- [x] 首页仍不调用下载、转写、制作、自动化检查或清空队列。
- [x] TypeScript 和相关静态检查通过。

## 完成记录

- 首页视频来源区新增选择按钮和“加入队列”按钮。
- 加入队列会过滤已有队列项和已有资料，保存的新项显式为 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`。
- 原“字幕流水线”导航和页面标题改为“任务队列”。
- 任务队列页已移除视频来源选择板块，只渲染队列任务信息。
- 验证通过：
  - `cd desktop && npx tsc --noEmit`
  - `cd desktop && node --experimental-strip-types --no-warnings scripts/check-home-dashboard-safety.mjs`
  - `cd desktop && node --experimental-strip-types --no-warnings scripts/check-product-refactor-surface.mjs`
  - `cd desktop && node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs`
  - 浏览器预览：首页显示“加入队列”和“任务队列”；任务队列页不显示视频来源管理入口。

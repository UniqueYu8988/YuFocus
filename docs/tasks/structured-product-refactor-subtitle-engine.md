# 任务：结构化产品收束为 UP 主字幕清洗引擎

创建日期：2026-06-15
状态：阶段 1 已完成

## 1. 目标

把当前过长、过宽的桌面应用收束为单一主线：

```text
UP 主 → 视频列表 → 字幕获取 / 必要时转写兜底 → 字幕清洗 → NotebookLM 可导入输出
```

本任务不增加新产品能力，不优化总结、邮件、TTS、旧课程、旧学习包或阅读消费系统。

## 2. 第一性原则

- 只保留直接服务字幕处理的主流程。
- 不直接删除旧模块，先从主入口隔离，再标记为遗留。
- `pipelineMode: 'subtitle_only'` 是主流程唯一有效队列模式。
- Summary / editorial / email / TTS 不得在 subtitle-only 队列中执行。
- UI 要优先呈现来源、视频、队列、NotebookLM 输出，而不是内容消费。

## 3. 当前事实

- 队列层已经支持 `pipelineMode?: 'subtitle_only' | 'full_editorial'`。
- UP 主批量入队和后台来源发现已显式创建 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`。
- 真实小样本已验证：`BV17pJ56pE3d` 可完成 material builder、转写兜底、字幕清洗、`exports/notebooklm.md`，没有触发 summary / email / TTS。
- UI 仍保留旧产品心智：默认进入“专注”，侧边栏主入口包含“专注/档案/灵犀”，队列行仍暴露“制作文稿”按钮。

## 4. 本轮允许改动

- 建立大型任务文件和计划文件。
- 调整主入口为工作台 / 字幕流水线。
- 从主导航移除或降级“专注、档案、灵犀”等旧消费入口。
- 隐藏队列里的手动“制作文稿”入口。
- 保留设置中字幕所需的 B 站、输出目录、转写配置；Summary / 邮件 / TTS 设置本轮只从主心智隔离，不重构实现。
- 更新 `PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md` 中明显过期描述。
- 增加或更新纯静态检查脚本，验证 UI 不再把旧系统作为主入口，队列仍强制 subtitle-only。

## 5. 本轮不做

- 不删除真实数据。
- 不迁移 `output/materials`。
- 不恢复旧材料包。
- 不重构 `distiller.py`。
- 不优化 Summary Pipeline、邮件、TTS。
- 不做大规模 UI 重写。
- 不执行 Git 写操作。

## 6. 风险

- `WorkspacePane.tsx`、`SourceSidebarPane.tsx` 仍承载大量旧状态，直接删除容易破坏启动。
- 清空队列按钮会删除资料包源文件，后续应单独加保护。
- 设置页仍包含大量旧服务配置，彻底拆分需要下一阶段。

## 7. 验证

- `desktop/scripts/check-subtitle-only-queue-mode.mjs`
- 新增或更新的静态 UI 收束检查脚本。
- `cd desktop && npx tsc --noEmit`
- 不在本轮重复真实视频试跑，除非项目负责人明确确认当前数据状态可继续。

## 8. 本轮完成标准

- [x] 默认入口是字幕流水线工作台。
- [x] 侧边栏主入口不再把“专注/档案/灵犀”作为主要产品入口。
- [x] 队列 UI 不再暴露“制作文稿”按钮。
- [x] 设置页不再渲染邮件、TTS 和 Obsidian 旧配置块。
- [x] `subtitle_only` 队列仍不会触发 summary / email / TTS。
- [x] 文档明确 Summary / email / TTS / reading / course 为遗留或暂停，不是主线。

## 9. 本轮改动记录

- 默认启动视图从 `learn` 改为 `workbench`。
- 侧边栏主导航收束为：字幕流水线、输出、流程、设置。
- 侧边栏旧灵犀资料树从主界面移除，改为核心流程提示。
- 工作台标题改为“字幕流水线”。
- 档案页主标题改为“NotebookLM 输出”。
- 队列行移除手动制作精读稿按钮和 `onBuildSummary` 回调。
- 设置页只渲染当前主线需要的配置块：当前配置、MiMo 清洗模型、本地转写、B 站凭据。
- 新增 `desktop/scripts/check-product-refactor-surface.mjs`。

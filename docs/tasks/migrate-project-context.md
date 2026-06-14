# 任务：迁移 PROJECT_CONTEXT.md 内容

创建日期：2026-06-12
状态：已完成

## 1. 目标

提取 `PROJECT_CONTEXT.md` 中仍然有效、且已被当前代码或现有审计确认的内容，迁入当前正式工作流，减少同一事实在多个文件中重复维护。

## 2. 背景

`PROJECT_CONTEXT.md` 曾承担长期上下文、产品方向、架构边界、模块清单、验证命令和历史路线收束等多种职责。当前项目已经建立 `AGENTS.md`、`PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md`、`docs/VERIFICATION_BACKLOG.md` 和稳定化计划，需要把仍然有效的内容迁入对应正式文档。

## 3. 本次范围

- 逐段分类 `PROJECT_CONTEXT.md`。
- 迁移已确认有效且正式文档缺失的内容。
- 记录未迁移内容及原因。
- 检查当前代码或界面是否引用 `PROJECT_CONTEXT.md`。
- 不移动、删除或重写 `PROJECT_CONTEXT.md`。

## 4. 明确不做

- 不修改生产代码。
- 不移动、删除或重写 `PROJECT_CONTEXT.md`。
- 不处理其他旧 Markdown 的正式迁移。
- 不继续设计产品细节。
- 不把旧文档内容自动当作事实。

## 5. 验收标准

- [x] 已确认 `PROJECT_CONTEXT.md` 的运行时引用情况。
- [x] 已把必要内容迁入正式文档。
- [x] 已记录没有迁移的内容及原因。
- [x] 已检查 Markdown 差异，没有无关修改。

## 6. 相关文件和数据

- `docs/history/legacy-md/PROJECT_CONTEXT.md`
- `AGENTS.md`
- `PRODUCT.md`
- `ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `docs/VERIFICATION_BACKLOG.md`
- `docs/plans/STABILIZATION_PLAN.md`
- `desktop/electron/workflowDocuments.ts`
- `desktop/src/components/WorkflowPane.tsx`

## 7. 风险

- 迁移时曾确认 `PROJECT_CONTEXT.md` 被流程页白名单引用；后续任务已解除该运行时依赖。
- 旧文档包含未验证产品细节和历史路线，不能整段复制进正式文档。
- 正式文档已经包含大量重叠内容，迁移时应避免重复维护。

## 8. 验证方式

- 自动测试：本轮不修改生产代码，不运行代码测试。
- 人工验收：检查迁移内容是否落入正确正式文档。
- 构建或类型检查：不执行构建；本轮只修改 Markdown。

## 9. 完成记录

### 迁移了什么

- 将“流程透明页”作为已存在入口补入 `PRODUCT.md`，但标明其文档内容仍需后续验收。
- 将旧课程兼容字段不得回到产品语言的规则补入 `PRODUCT.md`。
- 将流程页白名单文件机制补入 `ARCHITECTURE.md`。
- 将 `PROJECT_CONTEXT.md` 被 `desktop/electron/workflowDocuments.ts` 作为 `project_context` 读取的事实补入 `ARCHITECTURE.md` 和 `CURRENT_STATE.md`。
- 将 `PROJECT_CONTEXT.md` 被 `desktop/electron/runtimePaths.ts` 用于开发项目根探测的事实补入 `ARCHITECTURE.md` 和 `CURRENT_STATE.md`。
- 将旧文档中仍有价值但未确认的队列、路由、清空语义和流程页白名单问题补入 `docs/VERIFICATION_BACKLOG.md`。

### 迁到哪里

- 产品事实和产品语言边界：`PRODUCT.md`。
- 技术结构、白名单文件和运行时引用：`ARCHITECTURE.md`。
- 当前风险和下一步注意事项：`CURRENT_STATE.md`。
- 尚未验证的问题：`docs/VERIFICATION_BACKLOG.md`。

### 没有迁移的内容及原因

- 旧产品细节，例如短视频稿件栏目、邮件日报形态、TTS、NotebookLM 导读等：当前阶段暂停产品细节设计。
- 大量核心文件清单和拆分进度：过长且会快速过期，正式文档只保留模块级结构。
- v8/v9、Codex Goal、学习页对象模型等历史路线：已退出当前主线，只作历史背景。
- “后续成熟链路”“下一阶段研究方向”等计划性内容：未通过当前任务确认，不迁入正式状态。
- 与 `PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md` 已重复的项目定位、数据位置、敏感配置和旧路线退出说明：避免重复维护。

### 运行时引用

迁移时曾存在运行时引用，因此当时不能直接归档原文件：

- `desktop/electron/workflowDocuments.ts` 中 `project_context` 指向 `PROJECT_CONTEXT.md`。
- `desktop/src/components/WorkflowPane.tsx` 暴露“查看项目语境”按钮，读取 `project_context`。
- `desktop/electron/runtimePaths.ts` 在开发模式下用 `PROJECT_CONTEXT.md` 和 `src/distiller.py` 一起探测项目根目录。

后续任务 `docs/tasks/replace-project-context-runtime-reference.md` 已解除以上运行时依赖。

### 归档结果

已完成归档。

- 内容迁移：已完成。
- 运行时依赖解除：已完成。
- 原文件归档路径：`docs/history/legacy-md/PROJECT_CONTEXT.md`。

归档时未修改 `PROJECT_CONTEXT.md` 正文。

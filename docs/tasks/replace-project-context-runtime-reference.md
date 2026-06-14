# 任务：解除 PROJECT_CONTEXT.md 运行时依赖

创建日期：2026-06-12
状态：已完成

## 1. 目标

让当前正式工作流文档取代 `PROJECT_CONTEXT.md` 的运行时入口，使旧文件以后可以进入归档准备阶段。

## 2. 背景

上一任务确认 `PROJECT_CONTEXT.md` 仍被流程页白名单和开发项目根探测引用。只迁移内容还不足以安全归档原文件，必须先解除生产代码对它的必要运行时依赖。

## 3. 本次范围

- 重新核对 `PROJECT_CONTEXT.md` 的生产代码引用。
- 将流程页文档入口替换为当前正式工作流文档。
- 将开发项目根探测从 `PROJECT_CONTEXT.md` 改为稳定项目标志组合。
- 更新与实际变化相关的 Markdown。

## 4. 明确不做

- 不删除、移动或修改 `PROJECT_CONTEXT.md` 内容。
- 不修改队列、材料、AppData 或真实数据。
- 不更新依赖。
- 不进行无关重构。
- 不新增长期 Markdown。
- 不恢复旧产品路线。

## 5. 验收标准

- [x] 流程页不再展示 `PROJECT_CONTEXT.md` 作为项目语境入口。
- [x] `runtimePaths.ts` 不再依赖 `PROJECT_CONTEXT.md` 探测项目根目录。
- [x] 生产代码中不存在对 `PROJECT_CONTEXT.md` 的必要运行时依赖。
- [x] TypeScript 类型检查通过。
- [x] 能确认流程页可读取当前正式文档。
- [x] 已检查文件差异，没有无关修改。

## 6. 相关文件和数据

- `desktop/electron/workflowDocuments.ts`
- `desktop/src/components/WorkflowPane.tsx`
- `desktop/src/vite-env.d.ts`
- `desktop/electron/runtimePaths.ts`
- `ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `docs/VERIFICATION_BACKLOG.md`

## 7. 风险

- 白名单 key 与前端类型不一致会导致流程页读取失败。
- 项目根探测规则过窄会影响从不同工作目录启动开发模式。
- `PROJECT_CONTEXT.md` 仍可能在历史文档中被引用，但历史引用不等于运行时依赖。

## 8. 验证方式

- 自动测试：TypeScript 类型检查。
- 人工验收：搜索生产代码引用，检查白名单正式文档路径。
- 构建或类型检查：尽量执行不会写真实数据的构建检查。

## 9. 完成记录

### 代码修改

- `desktop/electron/workflowDocuments.ts`：移除旧文档白名单，改为读取 `AGENTS.md`、`PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md`、`docs/BASELINE_ACCEPTANCE.md`、`docs/plans/STABILIZATION_PLAN.md`。
- `desktop/src/components/WorkflowPane.tsx`：流程页按钮改为当前正式文档入口。
- `desktop/src/vite-env.d.ts`：同步 `WorkflowDocumentKey` 类型。
- `desktop/electron/runtimePaths.ts`：项目根探测改为使用 `AGENTS.md`、`PRODUCT.md`、`ARCHITECTURE.md`、`src/distiller.py`、`desktop/package.json` 的组合标志。

### 三处依赖处理

- `workflowDocuments.ts`：不再存在 `project_context -> PROJECT_CONTEXT.md`。
- `WorkflowPane.tsx`：不再显示“查看项目语境”，改为展示正式工作流文档。
- `runtimePaths.ts`：不再使用 `PROJECT_CONTEXT.md` 辅助探测项目根目录。

### 验证结果

- `npx tsc --noEmit`：通过。
- `npm run build:web`：通过；只重写构建产物，未触碰真实数据。
- 生产代码搜索：`desktop/electron`、`desktop/src`、`src` 中未发现 `PROJECT_CONTEXT.md`、`project_context` 或旧白名单 key。
- 项目根探测模拟：从项目根、`desktop`、`desktop/electron`、`desktop/src/components` 向上查找，均解析到 `C:\Users\Yu\AI\视界专注`。
- 正式文档存在性检查：6 个流程页目标文件均存在。

### 剩余事项

生产运行时依赖已解除。后续归档任务已将原文件移动到 `docs/history/legacy-md/PROJECT_CONTEXT.md`；历史文档中仍有文本引用，但不再是运行时依赖。

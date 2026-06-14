# 任务：收束 cleanup-baseline.md

创建日期：2026-06-12
状态：已完成

## 1. 目标

把 `docs/cleanup-baseline.md` 中仍然有效的内容迁入当前正式工作流，并在确认没有运行时依赖后，将原文件归档到 `docs/history/legacy-md/cleanup-baseline.md`。

## 2. 背景

`docs/cleanup-baseline.md` 记录了旧系统优化 Phase 1 的主线文件、兼容层、退出路线、材料目录策略和大量拆分进度。当前正式工作流已经由 `PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md` 和任务文件承担，不应继续让旧清理基线作为日常入口。

## 3. 本次范围

- 检查代码、配置或流程页是否依赖 `docs/cleanup-baseline.md`。
- 迁移或确认仍有效的模块、兼容层、退出路线、风险和待验证问题。
- 不迁移历史拆分进度为长期任务清单。
- 归档原文件，保留原文。

## 4. 明确不做

- 不修改生产代码。
- 不处理其他旧 Markdown。
- 不新增长期文档。
- 不继续产品设计。
- 不修改真实数据。
- 不更新依赖。

## 5. 验收标准

- [x] 确认没有生产代码、配置或当前工作流依赖 `docs/cleanup-baseline.md`。
- [x] 有效内容已有唯一归属。
- [x] 已确认不把历史拆分清单迁成长期任务清单。
- [x] 原路径不存在。
- [x] 归档路径文件存在且内容完整。
- [x] 没有无关修改。

## 6. 相关文件和数据

- `docs/cleanup-baseline.md`
- `ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `docs/VERIFICATION_BACKLOG.md`
- `docs/history/legacy-md/`

## 7. 风险

- 旧清理基线中的拆分进度可能过期，不能直接作为当前代码事实。
- 旧清理基线曾把 `PROJECT_CONTEXT.md` 和 `README.md` 当作主线文档，已与当前工作流冲突。
- 直接归档前必须确认流程页和生产代码不再引用原路径。

## 8. 验证方式

- 自动测试：本轮不修改生产代码，不运行代码测试。
- 人工验收：搜索引用、核对归档文件哈希、检查 Markdown 差异。
- 构建或类型检查：不需要；未修改生产代码。

## 9. 完成记录

### 迁移了什么

- 将旧学习包兼容层事实补入 `ARCHITECTURE.md`：旧 `CoursePackage` / `lesson` 等结构只作为兼容层存在。
- 将运行时路径相关模块风险补入 `ARCHITECTURE.md`：`runtimePaths.ts`、`runtimeStores.ts`、`runtimeLogger.ts` 影响项目根、数据根、设置、窗口状态和日志路径。
- 将仍需确认的旧兼容库、旧 schema 目录、已删除旧文件状态补入 `docs/VERIFICATION_BACKLOG.md`。
- 修正 `PRODUCT.md` 中流程透明页描述：当前流程页展示正式工作流文档，不再展示旧清理基线。
- 在 `CURRENT_STATE.md` 记录 `docs/cleanup-baseline.md` 已归档。

### 已重复所以没有迁移

- 旧产品路线退出：已由 `PRODUCT.md` 维护。
- `.course_material` 作为内部工作目录：已由 `PRODUCT.md` 和 `ARCHITECTURE.md` 维护。
- `main.ts`、`distiller.py`、`WorkspacePane.tsx` 等风险区域：已由 `ARCHITECTURE.md` 和 `CURRENT_STATE.md` 维护。
- 流程页白名单变更：已由 `ARCHITECTURE.md` 维护。

### 判定为历史的内容

- Phase 2 的 59 条拆分进度，不迁成新的长期任务清单。
- “文档主线”中把 `README.md`、`PROJECT_CONTEXT.md`、`docs/cleanup-baseline.md` 作为当前主线的旧描述。
- 已完成的旧拆分记录和旧阶段记录。

### 文件依赖

- 生产代码搜索未发现 `docs/cleanup-baseline.md`、`cleanup-baseline` 或 `cleanup_baseline` 的运行时依赖。
- 当前流程页已展示正式工作流文档，不再引用旧清理基线。

### 归档结果

- 原路径：`docs/cleanup-baseline.md`
- 归档路径：`docs/history/legacy-md/cleanup-baseline.md`
- 归档前后 SHA256：`90B37958D3312A8B7DB8FE4527B81C70E3DCDBCE25069ABACE29153A0B3C5113`
- 归档时未修改原文。

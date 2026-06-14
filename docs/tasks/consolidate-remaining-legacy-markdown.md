# 任务：旧 Markdown 最终收口

创建日期：2026-06-12
状态：已完成

## 1. 目标

一次性处理剩余旧 Markdown，把仍有效且缺失的内容迁入当前正式工作流，并将旧文档原样归档到 `docs/history/legacy-md/`。

## 2. 背景

`PROJECT_CONTEXT.md`、`README.md`、`docs/cleanup-baseline.md` 已完成收束。当前仍留在根目录或 `docs/` 日常区域的旧路线文档包括纪念报告、系统优化审计、视频编稿流程和旧聊天记录。完成本任务后停止继续整理历史文档，进入代码层稳定化阶段。

## 3. 本次范围

- `PROJECT_MEMORIAL_REPORT.md`
- `docs/system-optimization-audit.md`
- `docs/video-editorial-pipeline.md`
- `docs/OLD_CHAT_NOTES_CLEAN.md`
- `docs/history/OLD_CHAT_NOTES_RAW.md`

## 4. 明确不做

- 不修改生产代码。
- 不更新依赖。
- 不启动软件。
- 不修改队列、AppData、材料或真实数据。
- 不继续设计新版产品细节。
- 不创建新的万能上下文文件。
- 不把旧任务和旧计划重新变成当前待办。
- 不处理正式任务记录和模板。

## 5. 验收标准

- [x] 生产代码、配置和流程页不依赖待归档旧文档。
- [x] 有效内容已有唯一正式归属。
- [x] 尚未验证的问题已进入 `docs/VERIFICATION_BACKLOG.md`。
- [x] 旧文档原路径已清理。
- [x] 归档文件存在且内容完整。
- [x] 根目录和 `docs/` 日常区域只剩当前工作流需要的 Markdown。
- [x] 没有无关修改。

## 6. 相关文件和数据

- `PRODUCT.md`
- `ARCHITECTURE.md`
- `CURRENT_STATE.md`
- `docs/VERIFICATION_BACKLOG.md`
- `docs/history/legacy-md/`

## 7. 风险

- 旧文档包含大量历史路线和产品细节，不能重新塞回正式文档。
- 旧审计和旧流程文档可能包含仍有价值的检查项，应进入 backlog，而不是当前任务。
- 归档前必须确认没有运行依赖。

## 8. 验证方式

- 搜索生产代码和配置引用。
- 检查归档前后文件哈希。
- 检查日常 Markdown 清单。
- 检查 Git diff / status，确认没有无关修改。

## 9. 完成记录

本任务已完成旧 Markdown 最终收口。

### 迁移或确认归属

- `docs/video-editorial-pipeline.md` 中仍与当前代码一致的编稿路由环境变量，已补充到 `ARCHITECTURE.md`：
  - `SHIJIE_EDITORIAL_SUMMARY_MODE`
  - `SHIJIE_EDITORIAL_SUMMARY_MAX_DURATION_SECONDS`
  - `SHIJIE_EDITORIAL_SUMMARY_MAX_CONTENT_CHARS`
- 旧视频编稿流程中的 HTML 邮件样式、标题规则、删除小节规则等仍可能有参考价值，但未确认为当前产品事实，已进入 `docs/VERIFICATION_BACKLOG.md`。
- `docs/system-optimization-audit.md` 中关于效率观察、质量评分等可能仍有参考价值的候选项，已进入 `docs/VERIFICATION_BACKLOG.md`。
- 旧 Markdown 治理完成、历史文档退出日常入口，已记录到 `CURRENT_STATE.md` 和 `docs/plans/STABILIZATION_PLAN.md`。
- `AGENTS.md` 已把历史资料入口统一为 `docs/history/legacy-md/`，并明确历史归档不是日常工作入口。

### 未迁移内容

- 旧产品路线、旧阶段计划、旧视频编稿产品细节、纪念性内容和原始聊天记录不迁入正式文档。
- `.course_material`、旧模块职责、旧兼容层等已在 `ARCHITECTURE.md`、`CURRENT_STATE.md` 或既有归档任务中覆盖，未重复复制。
- `PROJECT_MEMORIAL_REPORT.md` 判定为纪念性历史资料，不作为当前执行说明。

### 归档结果

以下文件已原样移动到 `docs/history/legacy-md/`：

- `PROJECT_MEMORIAL_REPORT.md` -> `docs/history/legacy-md/PROJECT_MEMORIAL_REPORT.md`
- `docs/system-optimization-audit.md` -> `docs/history/legacy-md/system-optimization-audit.md`
- `docs/video-editorial-pipeline.md` -> `docs/history/legacy-md/video-editorial-pipeline.md`
- `docs/OLD_CHAT_NOTES_CLEAN.md` -> `docs/history/legacy-md/OLD_CHAT_NOTES_CLEAN.md`
- `docs/history/OLD_CHAT_NOTES_RAW.md` -> `docs/history/legacy-md/OLD_CHAT_NOTES_RAW.md`

归档后逐项校验 SHA256，均与移动前一致。

### 依赖检查

生产代码、配置和流程文档白名单中未发现对上述旧文件原路径的运行时依赖。

日常 Markdown 区域保留：

- 根目录：`AGENTS.md`、`README.md`、`PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md`
- `docs/`：`BASELINE_ACCEPTANCE.md`、`VERIFICATION_BACKLOG.md`
- `docs/plans/`：`STABILIZATION_PLAN.md`、`PLAN_TEMPLATE.md`
- `docs/tasks/`：当前任务记录、既有任务记录和 `TASK_TEMPLATE.md`

### 后续

集中式文档治理阶段到此结束。下一阶段只应按稳定化计划进入代码层稳定化，不再继续扩大历史 Markdown 整理范围。

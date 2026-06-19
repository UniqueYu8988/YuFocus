# 任务：v1.0 冻结前最终遗留与冗余清理

创建日期：2026-06-16
状态：已完成

## 目标

在不改变 active pipeline、队列执行、UI 结构和 `data/materials` 数据系统的前提下，清理确认无用的遗留内容。

当前唯一生产主线：

```text
UP 主 → Video → Subtitle → Cleaning → NotebookLM Output
```

## 明确不做

- 不修改 subtitle-only pipeline 逻辑。
- 不修改队列系统。
- 不修改 UI 结构。
- 不修改 `data/materials` 输出结构。
- 不删除真实 `data/materials` 材料、Electron Store、密钥或备份。
- 不启动软件、不运行真实队列、不调用外部服务。
- 不执行 Git 写操作。

## 分析规则

| 分类 | 处理 |
|---|---|
| SAFE TO DELETE | 无引用、非生产主线、非真实数据，直接删除。 |
| SAFE TO ISOLATE | 有历史价值或不确定是否仍被读取，只隔离或标记遗留。 |
| MUST KEEP | subtitle-only 主线、UP 主来源、队列、B 站字幕、本地转写、NotebookLM 输出、数据安全相关。 |

## 待追踪关键词

- summary
- email
- tts
- legacy
- course

## 验证计划

- `cd desktop && npx tsc --noEmit`
- `cd desktop && node scripts/check-subtitle-only-queue-mode.mjs`
- `cd desktop && node scripts/check-data-layer-normalization.mjs`
- `cd desktop && node scripts/check-product-refactor-surface.mjs`
- Python 语法检查（仅被触碰文件）

## 引用追踪结论

| 目标 | 结论 | 处理 |
|---|---|---|
| `summary` / `editorial` | 队列仍保留 `full_editorial` 兼容字段；`subtitle_only` 有检查脚本保护不会触发 summary。 | MUST KEEP，不动执行逻辑。 |
| `email` / `smtp` | 邮件发送服务已剪枝；剩余字段主要是 settings 兼容字段和旧状态读取。 | SAFE TO ISOLATE，保留配置兼容，不恢复入口。 |
| `tts` | TTS 服务和 UI 入口已剪枝；剩余字段主要是 settings 兼容字段。 | SAFE TO ISOLATE，保留设置兼容，不恢复入口。 |
| `legacy` / `course` | 前端 store、旧知识库和材料删除保护仍有引用。 | MUST KEEP，作为旧数据兼容层。 |
| TypeScript / TSX 未引用模块 | 修正后的 import 图只剩 `desktop/src/vite-env.d.ts` 未被 import，这是 Vite 类型声明。 | MUST KEEP。 |
| 旧学习 / 设置 / 侧栏 SVG 资产 | 源码无引用。 | SAFE TO DELETE。 |
| `src/check_editorial_email_contract.py` | 只服务旧精读 / 邮件契约验证，不属于 v1.0 subtitle-only 验证集，生产代码无调用。 | SAFE TO DELETE，并更新正式验证描述。 |
| `src/validate_content_synthesis_plan.py` | 文件自述为 retired deep-synthesis helper，生产代码无调用。 | SAFE TO DELETE，并从 README 语法检查命令移除。 |
| `output/playwright` | 旧验收截图和脚本，无当前引用。 | SAFE TO DELETE。 |
| `output/notebooklm_exports` | 仅旧 sample Markdown，无当前引用。 | SAFE TO DELETE。 |
| `output/evals` | 旧 synthetic eval 输出，不是用户生产材料。 | SAFE TO DELETE。 |
| `output/courses` | 当前为空目录。 | SAFE TO DELETE。 |
| `output/materials` | 项目负责人确认属于此前测试生成材料，当前新工作流测试不再需要。 | SAFE TO DELETE。 |
| `output/knowledge` | 项目负责人确认属于此前测试生成材料，当前新工作流测试不再需要。 | SAFE TO DELETE。 |

## 已删除

### 代码 / 脚本

- `src/check_editorial_email_contract.py`
- `src/validate_content_synthesis_plan.py`

### 未引用资产

- `desktop/src/assets/learn-chapter-map.svg`
- `desktop/src/assets/learn-open-note.svg`
- `desktop/src/assets/learn-read-section.svg`
- `desktop/src/assets/settings-obsidian.svg`
- `desktop/src/assets/settings-tts.svg`
- `desktop/src/assets/settings-video-summary.svg`
- `desktop/src/assets/sidebar-archive.svg`
- `desktop/src/assets/sidebar-learn.svg`
- `desktop/src/assets/student-avatar.svg`
- `desktop/src/assets/study-package-icon.svg`
- `desktop/src/assets/teacher-avatar.svg`
- `desktop/src/assets/warm-stage.svg`

### 旧输出

- `output/playwright/`
- `output/notebooklm_exports/`
- `output/evals/`
- `output/courses/`
- `output/materials/`
- `output/knowledge/`
- `output/`

### 兼容代码收敛

- `desktop/electron/runtime/runtimePaths.ts`：移除旧 `output` 默认导入路径和 legacy output roots。
- `desktop/electron/services/materialInventory.ts`：材料扫描收敛为 `data/materials/{up_id}/{video_id}`，不再扫描旧 `.course_material` 目录。
- `desktop/scripts/check-data-layer-normalization.mjs`：检查旧 `output` 兼容根和 `.course_material` 扫描不会回流。

## 未删除

- `desktop/electron/legacy/*`：仍被旧数据兼容和删除保护引用。
- `desktop/src/legacy/*`：仍被前端状态读取引用。
- `src/distiller.py` 中的 editorial 函数：仍被 `--summarize-material` 兼容入口和旧状态字段引用；本轮不改 pipeline 逻辑。
- `desktop/electron/runtime/backendRuntime.ts` 中的 material summary 调用：仍是兼容分支；subtitle-only 队列保护脚本覆盖不会触发。

## 验证结果

- `cd desktop && node scripts/check-subtitle-only-queue-mode.mjs`：通过。
- `cd desktop && node scripts/check-data-layer-normalization.mjs`：通过。
- `cd desktop && node scripts/check-product-refactor-surface.mjs`：通过。
- `cd desktop && node --experimental-strip-types --no-warnings scripts/check-distill-progress.mjs`：通过。
- `python -m py_compile src\bilibili_api.py src\audio_fallback.py src\local_audio_client.py src\distiller.py src\config.py src\wbi.py`：通过。
- `cd desktop && npx tsc --noEmit`：通过。
- 本轮未启动软件、未运行真实队列、未调用 B 站、未调用 MiMo、未调用 SenseVoice。

## 剩余兼容代码

- `pipelineMode: 'full_editorial'`、`editorialMode`、`runPythonMaterialSummary`：仍作为旧队列 / 手动兼容分支存在；subtitle-only 检查已确认当前主线不会触发。
- `desktop/electron/legacy/*`、`desktop/src/legacy/*`：仍有旧知识库和旧状态读取引用，不删除。
- `materialInventory` 中的 `summary/*` 字段：仍用于识别旧状态，不删除。
- Settings 中的 email / TTS 字段：仍用于读取旧 Store，不恢复 UI，不删除。
- 旧任务记录中仍会提到已删除的过渡期检查脚本，这是历史任务记录；正式入口文档和当前验证集已不再依赖它们。
- 剩余 `desktop/src/assets` 文件均有当前源码引用，不再删除。

## 估算删减

- 源码 / 脚本删除：约 183 行 Python。
- 静态资产删除：12 个旧 SVG。
- 旧输出删除：整个 `output/` 测试输出目录。
- 代码层删减比例很小，约低于 1%。本轮重点是删除确认无用的遗留边角，不触碰主线。

## 回退

回退本任务删除的文件或文档记录即可。不得通过删除真实数据来回退。

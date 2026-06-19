# CURRENT_STATE.md

本文件只记录项目“现在”的状态，不保存完整历史。

最后更新：2026-06-20

## 当前阶段

项目底层工作流改造已完成，后续进入常规小步稳定化开发。  
下一阶段主线已调整为“UP 主驱动的字幕清洗”：UP 主 / 来源视频列表 → 批量选择 → 字幕获取 → 字幕清洗 → NotebookLM 可导入资料。
字幕系统是当前核心数据层；总结、精读稿、邮件和 TTS 不再作为主线推进。
旧档案、旧灵犀和旧学习包兼容链路暂时降级为旧版遗留，后续只做必要兼容，不作为当前稳定化最高优先级。

## 当前可正常使用

- 代码层面已确认存在桌面端、Python 后端、材料包扫描、设置、队列、后台自动化和字幕清洗主线；TTS、邮件测试和 Obsidian IPC / CLI 入口已在安全剪枝中移除。
- 桌面端可以启动并显示首页。
- 设置页可以打开；本轮未复制或输出 Cookie、API Key、SMTP 授权码等秘密值。
- 左侧栏保留字幕流水线、输出、流程、设置入口；旧灵犀 / 学习入口不再作为主导航。
- 安全检查通过：`npx tsc --noEmit`、Python 语法检查、`desktop/scripts/check-distill-progress.mjs`、`desktop/scripts/check-subtitle-only-queue-mode.mjs`、`desktop/scripts/check-data-layer-normalization.mjs`。
- 已安装的本机基础环境：Node.js `v24.13.0`、npm `11.6.2`、Python `3.12.10`。
- Python 依赖探测显示 `requests`、`jsonschema`、`PySide6`、`imageio_ffmpeg` 已安装。

## 当前正在处理

- 旧 Markdown 集中收束已完成；旧项目语境、旧清理基线、纪念报告、旧系统审计、旧视频编稿流程和旧聊天记录均已归档到 `docs/history/legacy-md/`。
- 项目底层工作流改造已完成；独立新对话已经成功完成接管评估，不依赖此前聊天记录也能确认项目事实、风险、验证能力和下一步。
- 后续代码任务全部按照 `AGENTS.md` 的新工作流执行：先读入口文档，按任务规模定界，小步实施，运行相关最小验证，结束时更新必要状态。
- 已正式记录下一阶段主线为 UP 主驱动的字幕清洗，见 `docs/tasks/define-channel-subtitle-mainline.md`。
- 本阶段不继续做总结内容格式、邮件形态、TTS 或 NotebookLM 导读等产品细节决策。
- 代码结构与风险地图已建立，见 `docs/tasks/code-risk-audit.md`。
- 第一个低风险代码稳定化任务已完成：旧精读稿 Markdown / HTML 纯格式契约检查曾用于保护过渡期输出；v1.0 冻结前已退出 subtitle-only 验证集。
- 第二个低风险代码稳定化任务已完成：`desktop/src/domain/pipeline/distillProgress.ts` 已建立纯内存检查脚本，并补强异常进度输入兜底。
- 第三个低风险代码稳定化任务已完成：工作台队列已支持 `pipelineMode: 'subtitle_only' | 'full_editorial'`，并在 `subtitle_only` 时阻止队列层调用精读稿 / 总结、邮件等后续消费分支。
- 第四个低风险代码稳定化任务已完成：UP 主 / 来源视频列表批量加入队列和后台来源发现新建队列项已显式使用 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`。
- 第五个受控试运行已完成并通过：1 条真实 UP 主短视频以 `subtitle_only` 入队后只触发 material builder，没有触发总结、邮件或 TTS；SenseVoice 路径已从旧目录修正为实际目录，转写兜底、字幕清洗、material package 和 NotebookLM 导出已跑通。
- 第六个结构化产品收束任务阶段 1 已完成：默认入口改为字幕流水线，主导航收束为字幕流水线 / 输出 / 流程 / 设置，队列 UI 隐藏手动制作文稿入口，设置页隐藏邮件、TTS 和 Obsidian 旧配置块。
- 第七个安全剪枝任务已完成：删除旧阅读 UI 静态链、TTS IPC / 服务、邮件发送服务、Obsidian CLI / IPC / 导出服务和未引用语音预览资产；保留 subtitle-only 主线和旧数据兼容读取。
- 第八个清晰产品架构任务已完成：桌面端源码迁移为 `desktop/src/ui`、`domain`、`services`、`state`、`legacy` 和 `desktop/electron/ipc`、`runtime`、`queue`、`providers`、`services`、`legacy` 分层；未修改 Python 和 subtitle-only 主线逻辑。
- 第九个数据层标准化任务已完成：新的生产输出根已收敛为 `data/materials/{up_id}/{video_id}`，缓存、临时文件、日志和遗留知识库分别进入 `data/cache`、`data/temp`、`data/logs`、`data/legacy`。
- 第十个 v1.0 冻结前最终遗留清理已完成：删除未引用旧 SVG、旧精读 / 邮件过渡期检查脚本、旧合成计划检查脚本，以及按项目负责人确认删除旧 `output/` 测试生成内容；旧 `output` 不再作为兼容输出根或生产数据来源。
- 第十一个数据稳定性任务已完成：新增 `data/registry/{up_id}.json` 视频注册表层，UP 主视频刷新改为 API 结果合并入本地 registry 后再返回列表，避免 API 临时缺失导致视频消失；后台来源发现也走同一稳定列表。
- 第十二个稳定性任务已完成：修正运行时注册表路径，4 个旧注册表无损迁移到 `data/registry` 并保留独立备份；连续真实刷新保持每表 30 条、0 重复。
- 本机旧 `output_dir` 已在备份 Store 后通过应用自身设置 API 持久化为项目 `data` 根。
- “清空任务队列”已改为只清理队列记录，不再扫描、归档或删除材料包；纯内存检查和真实 IPC 回归均通过。
- 真实桌面端小样本 `BV131jF68E5n` 已在 `data/materials/256724889/bv131jf68e5n` 完成 subtitle-only 流程。
- 本轮已把代码、文档和目录迁移收敛为一个 Git 稳定存档点；`data/` 真实运行数据由 `.gitignore` 排除。

## 已知问题

| 问题 | 影响 | 优先级 | 临时处理 |
|---|---|---|---|
| 后续任务绕过新工作流 | 如果不按入口和任务规模执行，仍可能跳过定界、验证或收尾记录 | 中 | 普通任务从 `AGENTS.md` 和本文件开始；中型任务先建 `docs/tasks/` 任务文件 |
| 旧入口文档可能误导新对话 | `README.md`、历史报告和已归档的旧上下文仍含旧产品叙事 | 中 | 日常入口以 `AGENTS.md`、`CURRENT_STATE.md` 和基线文档为准 |
| 核心验收仍偏旧项目基线 | 后续改造可能混入旧档案/旧灵犀细节 | 中 | 只保留核心验证，把旧细节留在 backlog |
| 旧上下文归档后的历史引用仍存在 | 历史文档和旧任务记录仍会提到 `PROJECT_CONTEXT.md` | 低 | 这些只作为历史文字，不作为日常入口 |
| 旧清理基线已归档 | 历史文档仍会提到 `docs/cleanup-baseline.md` | 低 | 这些只作为历史文字，不作为日常入口 |
| 旧 Markdown 治理阶段已结束 | 继续整理历史文档会拖延代码层稳定化 | 中 | 停止集中整理历史文档，进入代码层稳定化 |
| 档案主页面待核对现象 | 受控验收时主区域显示为空，与旧计数和材料包数量不一致 | 低 | 旧版遗留候选问题，暂不修复 |
| 独立灵犀页入口待核对 | 受控验收时未找到明确入口 | 低 | 旧版遗留候选问题，暂不修复 |
| 现有 51 个材料包未检测到 `metrics.json` | 旧测试数据计量不完整 | 低 | 旧版遗留，暂不回填 |
| `src/distiller.py` 职责很重 | 字幕、清洗、编稿、缓存、文件写出混在一个大文件，修改风险高 | 中 | 稳定化前不拆分，只加验收保护 |
| `desktop/src/ui/pages/WorkspacePane.tsx` 承担大量状态和业务逻辑 | UI 行为改动容易互相影响 | 中 | 本轮只搬目录，不拆逻辑；后续如整理必须另开小任务 |
| 旧学习库 / 精读稿兼容代码仍存在 | 已从主导航和主执行流隔离，但部分旧元数据和 full editorial 兼容分支仍需读取 | 中 | 用 `desktop/scripts/check-product-refactor-surface.mjs` 和 `desktop/scripts/check-subtitle-only-queue-mode.mjs` 防止主入口和队列回退 |

## 当前风险

- `data/materials` 中的资料包可能包含真实资料；清空队列已与材料删除解耦，但单条“删除资料包”仍会删除真实文件，必须谨慎确认。
- `data/registry` 中保存 UP 主视频列表历史，删除会让历史视频列表丢失，刷新稳定性下降。
- Electron Store 文件可能包含 B 站 Cookie、MiMo Key、MiniMax Key、SMTP 授权码等秘密值，不能展示内容或提交。
- 启动 Electron 会写运行日志；前端初次加载队列后可能写回 Electron Store；打开灵犀可能写回 `knowledge_library.json`。
- 打开设置页存在 B 站状态检测入口；本轮只刷新了指定 TED 来源，没有公开秘密值。
- 旧版遗留数据仍在项目中，不能删除真实资料；遗留代码只允许在确认无入口、无引用、无数据风险后小步剪枝。
- 字幕清洗产物是后续唯一主线数据基础；总结、邮件、TTS 不应继续绑在字幕清洗主流程里。
- `data/materials/{up_id}/{video_id}/exports/notebooklm.md` 是当前 NotebookLM 主输出；不能写入秘密值、调试日志、内部状态或复杂中间结果。
- `docs/VERIFICATION_BACKLOG.md` 只是不确定问题清单，不能当作当前 Bug 直接修。
- `docs/history/legacy-md/`、`README.md` 和历史文档里有旧路线内容，使用前必须与当前基线文档核对。
- `docs/history/legacy-md/cleanup-baseline.md` 是旧系统优化清理记录，已退出日常工作流。
- `PROJECT_CONTEXT.md` 已不再位于项目根目录，也不再被流程页白名单或开发项目根探测依赖。
- 构建命令会清理并重写 `desktop/dist`、`desktop/dist-electron`，本轮未执行。

## 下一步只做什么

1. 普通后续任务可以继续按 `AGENTS.md` 新工作流小步推进。
2. 后续真实运行继续小批量进行，先核对队列和 `data/materials`，再加入新视频。
3. 如果继续剪枝，下一步应优先审计旧学习库 / 精读稿兼容链是否仍有真实数据读取价值；不删除旧数据，不碰 subtitle-only 主线。
4. 如果继续架构收敛，下一步只能做“小步抽离 UI 页面中的纯 action / selector”，不要直接拆 `WorkspacePane.tsx` 或改 pipeline 行为。

## 暂时不做

- 不改生产主流程代码。
- 不批量加入大量 UP 主视频队列；真实试运行前只允许 1 条短视频小样本。
- 不推进总结质量、邮件形态、TTS 或 Obsidian。
- 不更新依赖。
- 不无备份地直接修改数据库或 Electron Store。
- 不删除、移动或重命名 `data/materials` 下的任何资料，除非任务明确要求且已完成备份或确认。
- 不拆分 `distiller.py` 或 `WorkspacePane.tsx`。
- 不恢复旧课程制作路线。
- 不继续修旧档案计数、旧材料映射、旧灵犀入口或旧学习包兼容链路。
- 不恢复旧 `output/` 作为输出根，不把旧材料格式重新接入主流程。
- 不继续决定总结内容格式、短视频稿件长度、邮件形态、TTS 或 NotebookLM 导读等产品细节。
- 不制定大文件拆分或代码重构方案。
- 不恢复 `PROJECT_CONTEXT.md` 的日常入口地位；旧内容只从归档路径按需查阅。
- 不继续集中整理旧 Markdown；后续只在具体任务需要时查阅历史归档。

## 工作流审计结论

### 已经具备

- `AGENTS.md` 已能作为 AI 第一工作入口，包含事实来源、任务规模、修改原则、验证规则和安全红线。
- `PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md` 已基本分工：产品边界、技术结构、当前状态。
- `docs/BASELINE_ACCEPTANCE.md` 已收敛为核心启动、队列、材料、安全写入和少量核心流程基线。
- `docs/VERIFICATION_BACKLOG.md` 已声明自己不是当前 Bug 清单。
- 旧 Markdown 已统一归档到 `docs/history/legacy-md/`，不再作为日常入口。
- `docs/tasks/TASK_TEMPLATE.md` 和 `docs/plans/PLAN_TEMPLATE.md` 已存在，中型和大型任务有入口。
- 独立新对话接管测试已完成，证明当前文档可以支撑不依赖历史聊天的接管。

### 仍然缺失或冲突

- 未发现阻碍工作流结项的明显冲突。
- `README.md` 仍是项目入口说明，但不是最高事实来源；遇到差异时以 `PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md` 和代码为准。
- `docs/VERIFICATION_BACKLOG.md` 中仍有候选问题，后续只能按任务验证，不能直接当作当前 Bug。

### 最小调整方案

1. 以 `AGENTS.md` 作为唯一第一入口。
2. 新任务先读 `CURRENT_STATE.md`，再按需要读产品、架构、验收或任务文件。
3. 旧聊天、backlog、`docs/history/legacy-md/`、`README.md` 和历史报告只作为参考线索。
4. 中型任务进入 `docs/tasks/`；大型任务再进入 `docs/plans/`。
5. 暂时不新增大量文档，不继续产品细节设计，不制定代码重构方案。

## 当前验证状态

- 项目能否启动：2026-06-12 受控短时间启动成功，验收后无残留 Electron 进程。
- 核心人工验收：首页通过；设置页可打开；左侧灵犀来源区可读取；档案主页面和独立灵犀页仍属待核对现象。
- 自动测试：未发现完整测试套件；执行了 `desktop/scripts/check-distill-progress.mjs`、`desktop/scripts/check-subtitle-only-queue-mode.mjs`、`desktop/scripts/check-data-layer-normalization.mjs` 和产品表面检查，结果通过；脚本已覆盖 UP 主批量入队、后台来源发现、subtitle-only 创建规则和数据层路径规则。
- 产品收束静态检查：新增 `desktop/scripts/check-product-refactor-surface.mjs`，覆盖默认入口、主导航、队列文稿按钮隐藏、设置页邮件/TTS/Obsidian 隔离和 subtitle-only 执行器守卫。
- 数据层标准化检查：新增 `desktop/scripts/check-data-layer-normalization.mjs`，覆盖 `data` 默认根、`data/materials`、`data/registry`、`data/cache`、`data/temp`、`data/logs`、`data/legacy`、Python 子进程环境变量和标准材料扫描，并防止旧 `output` 兼容根回流。
- 视频注册表检查：新增 `desktop/scripts/check-video-registry-layer.mjs`，使用临时目录验证 registry 合并不删除历史视频、不重复、保留本地状态、API 失败可读旧列表，并静态确认 UI IPC 和后台发现接入 registry。
- 清队列保护检查：`desktop/scripts/check-queue-clear-safety.mjs` 证明清空队列不读取材料设置、不扫描材料包、不归档材料，也不返回删除路径。
- 受控合成数据层验证：使用本地假字幕直接写出并检查 `data/materials/codex_validation_up/bv_codexdatalayervalidation`，核心文件齐全；随后删除测试视频目录和空 UP 目录，未调用外部服务。
- v1.0 最终遗留清理验证：`check-subtitle-only-queue-mode`、`check-data-layer-normalization`、`check-product-refactor-surface`、`check-distill-progress`、核心 Python `py_compile` 和 `npx tsc --noEmit` 均通过；未启动软件、未运行真实队列、未调用外部服务。
- 真实小样本：`TED官方精选` 的 `BV131jF68E5n` 已以 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'` 在新 `data` 根完成；生成原始转写、清洗稿、NotebookLM 稿、manifest 和 run_state，`run_state` 为 `content_ready`，summary 为 `skipped`，日志中 summary / 邮件 / TTS 调用均为 0。
- 真实清队列保护：清理 2 条已完成队列记录后，材料清单前后保持同一路径，返回 `deletedMaterialCount: 0` 和空删除路径；随后原队列记录已恢复。
- 类型检查：`desktop` 下 `npx tsc --noEmit` 通过。
- 清晰架构迁移验证：`desktop/scripts/check-product-refactor-surface.mjs`、`desktop/scripts/check-subtitle-only-queue-mode.mjs`、`desktop/scripts/check-distill-progress.mjs` 均已在新目录下通过；简单 import 图循环检测结果为 0。
- Python 语法检查：`py_compile` 通过。
- 构建：未执行，因为会写入构建产物。
- 产品边界：下一阶段主线已调整为 UP 主驱动的字幕清洗；Summary Pipeline 暂停作为主线推进。
- 队列状态：启动前后均为 53 项，全部 `done`，没有新增任务，没有自动执行任务。
- 旧材料状态：此前测试生成的旧 `output/` 内容已按项目负责人确认删除，不再作为当前验收对象。
- 写入差异：运行日志增加；窗口状态更新；`shijie-focus-secure.json` 修改时间更新但大小和 SHA1 不变；`knowledge_library.json` 未变化。
- 启动前风险审计：后台自动化启用且未暂停，启动只设置定时器；本轮短时间关闭，未到后台定时检查时间点。
- 最近一次验证日期：2026-06-12。
- 最近一次独立接管评估：2026-06-12，通过。

## 新对话需要知道

- 项目根目录是 `C:\Users\Yu\AI\视界专注`。
- 项目底层工作流改造已完成；后续进入常规小步稳定化开发，但仍需按任务范围推进。
- 受控启动、来源刷新、真实 subtitle-only 小样本和清队列保护均已执行并关闭；后续真实运行继续保持小批量。
- 当前 subtitle-only 小样本已跑通，主界面阶段 1 已收束为字幕流水线，生产数据根和注册表路径已统一到 `data`。
- 旧 Markdown 集中治理已完成；不要继续扩展历史整理任务。
- 代码风险审计结果在 `docs/tasks/code-risk-audit.md`；精读稿格式契约检查和进度解析纯函数检查都已完成，不要重复做。
- 旧精读 / 邮件契约检查已退出 v1.0 subtitle-only 验证集；不要恢复为主线任务。
- `desktop/src/domain/pipeline/distillProgress.ts` 已通过纯内存检查和 TypeScript 类型检查；不要重复做同一任务。
- 当前 Git 工作区不是干净状态，存在大量未提交修改；除非用户明确要求，否则不要做 Git 写操作。
- 当前事实以代码、只读检查和项目负责人确认为准。
- 待验证问题集中放在 `docs/VERIFICATION_BACKLOG.md`。

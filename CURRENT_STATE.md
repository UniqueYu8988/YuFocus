# CURRENT_STATE.md

本文件只记录项目“现在”的状态，不保存完整历史。

最后更新：2026-06-12

## 当前阶段

项目底层工作流改造已完成，后续进入常规小步稳定化开发。  
方案 A 只作为当前产品边界的粗略假设保留，不继续细化短视频稿件长度、邮件形态、TTS 或 NotebookLM 导读等产品细节。  
旧材料、旧档案、旧灵犀和旧学习包兼容链路暂时降级为旧版遗留，不再作为当前稳定化最高优先级。

## 当前可正常使用

- 代码层面已确认存在桌面端、Python 后端、材料包扫描、设置、队列、后台自动化、精读稿、TTS、Obsidian 和邮件测试入口。
- 桌面端可以启动并显示首页。
- 设置页可以打开；本轮未复制或输出 Cookie、API Key、SMTP 授权码等秘密值。
- 左侧灵犀来源区可以读取已有来源和精读稿条目。
- 安全检查通过：`npx tsc --noEmit`、Python 语法检查、`src/check_editorial_email_contract.py`、`desktop/scripts/check-distill-progress.mjs`。
- 已安装的本机基础环境：Node.js `v24.13.0`、npm `11.6.2`、Python `3.12.10`。
- Python 依赖探测显示 `requests`、`jsonschema`、`PySide6`、`imageio_ffmpeg` 已安装。

## 当前正在处理

- 旧 Markdown 集中收束已完成；旧项目语境、旧清理基线、纪念报告、旧系统审计、旧视频编稿流程和旧聊天记录均已归档到 `docs/history/legacy-md/`。
- 项目底层工作流改造已完成；独立新对话已经成功完成接管评估，不依赖此前聊天记录也能确认项目事实、风险、验证能力和下一步。
- 后续代码任务全部按照 `AGENTS.md` 的新工作流执行：先读入口文档，按任务规模定界，小步实施，运行相关最小验证，结束时更新必要状态。
- 保留方案 A 作为粗略产品边界，但本阶段不继续做产品细节决策。
- 代码结构与风险地图已建立，见 `docs/tasks/code-risk-audit.md`。
- 第一个低风险代码稳定化任务已完成：`src/check_editorial_email_contract.py` 已补强精读稿 Markdown / HTML 纯格式契约检查。
- 第二个低风险代码稳定化任务已完成：`desktop/src/lib/distillProgress.ts` 已建立纯内存检查脚本，并补强异常进度输入兜底。
- 当前 Git 工作区存在大量未提交修改和未跟踪文件，包括正式文档、任务记录、历史归档和少量已完成代码保护改动；本轮只记录现状，不处理 Git。

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
| `desktop/src/components/WorkspacePane.tsx` 承担大量状态和业务逻辑 | UI 行为改动容易互相影响 | 中 | 先建立页面级验收，再小步整理 |

## 当前风险

- `output/materials` 中已有真实资料包，删除、清空队列、归档清理都可能造成数据损失。
- Electron Store 文件可能包含 B 站 Cookie、MiMo Key、MiniMax Key、SMTP 授权码等秘密值，不能展示内容或提交。
- 启动 Electron 会写运行日志；前端初次加载队列后可能写回 Electron Store；打开灵犀可能写回 `knowledge_library.json`。
- 打开设置页存在外部状态检测入口，本轮未点击刷新账号状态、邮件测试、TTS 或来源刷新。
- 旧版遗留代码和数据仍在项目中，不能删除；但也不要继续围绕旧档案/旧灵犀/旧学习包做修复。
- `output/notebooklm/` 将成为用户最终资料库；未来实现时不能写入秘密值、调试日志、内部状态或复杂中间结果。
- `docs/VERIFICATION_BACKLOG.md` 只是不确定问题清单，不能当作当前 Bug 直接修。
- `docs/history/legacy-md/`、`README.md` 和历史文档里有旧路线内容，使用前必须与当前基线文档核对。
- `docs/history/legacy-md/cleanup-baseline.md` 是旧系统优化清理记录，已退出日常工作流。
- `PROJECT_CONTEXT.md` 已不再位于项目根目录，也不再被流程页白名单或开发项目根探测依赖。
- 构建命令会清理并重写 `desktop/dist`、`desktop/dist-electron`，本轮未执行。

## 下一步只做什么

1. 只选择下一个低风险、纯函数或纯检查类代码稳定化任务；当前推荐为 `desktop/electron/workbenchQueue.ts` 队列去重、恢复、并发领取和重复 BV 处理的纯内存保护检查。不要碰真实队列、AppData、材料目录或外部服务。

## 暂时不做

- 不改生产主流程代码。
- 不更新依赖。
- 不修改数据库或 Electron Store。
- 不删除、移动或重命名 `output` 下的任何资料。
- 不拆分 `distiller.py` 或 `WorkspacePane.tsx`。
- 不恢复旧课程制作路线。
- 不继续修旧档案计数、旧材料映射、旧灵犀入口或旧学习包兼容链路。
- 不创建 `output/notebooklm/` 目录、不移动旧文件、不把旧材料批量迁移到新目录。
- 不继续决定短视频稿件长度、邮件形态、TTS 或 NotebookLM 导读等产品细节。
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
- 自动测试：未发现完整测试套件；执行了现有 `src/check_editorial_email_contract.py` 和 `desktop/scripts/check-distill-progress.mjs`，结果通过。
- 类型检查：`desktop` 下 `npx tsc --noEmit` 通过。
- Python 语法检查：`py_compile` 通过。
- 构建：未执行，因为会写入构建产物。
- 产品边界：方案 A 仅作为粗略边界保留；本轮不继续细化产品内容格式。
- 队列状态：启动前后均为 53 项，全部 `done`，没有新增任务，没有自动执行任务。
- 材料状态：启动前后均为 51 个 `.course_material` 材料包，最新材料包未变化，未发现新材料。
- 写入差异：运行日志增加；窗口状态更新；`shijie-focus-secure.json` 修改时间更新但大小和 SHA1 不变；`knowledge_library.json` 未变化。
- 启动前风险审计：后台自动化启用且未暂停，启动只设置定时器；本轮短时间关闭，未到后台定时检查时间点。
- 最近一次验证日期：2026-06-12。
- 最近一次独立接管评估：2026-06-12，通过。

## 新对话需要知道

- 项目根目录是 `C:\Users\Yu\AI\视界专注`。
- 项目底层工作流改造已完成；后续进入常规小步稳定化开发，但仍需按任务范围推进。
- 受控启动已执行并关闭；不要继续做制作、删除、来源刷新、邮件、TTS 或代码修复。
- 当前最值得先做的是队列纯内存保护任务，不是继续设计产品细节，也不是旧档案/旧灵犀数据问题。
- 旧 Markdown 集中治理已完成；不要继续扩展历史整理任务。
- 代码风险审计结果在 `docs/tasks/code-risk-audit.md`；精读稿格式契约检查和进度解析纯函数检查都已完成，不要重复做。
- `src/check_editorial_email_contract.py` 已补强并通过验证；不要重复做同一任务。
- `desktop/src/lib/distillProgress.ts` 已通过纯内存检查和 TypeScript 类型检查；不要重复做同一任务。
- 当前 Git 工作区不是干净状态，存在大量未提交修改；除非用户明确要求，否则不要做 Git 写操作。
- 当前事实以代码、只读检查和项目负责人确认为准。
- 待验证问题集中放在 `docs/VERIFICATION_BACKLOG.md`。

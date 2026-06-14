# 任务：代码结构与风险地图

创建日期：2026-06-12
状态：已完成

## 1. 目标

进入代码层稳定化前，先建立主要模块、真实数据读写、外部服务、现有验证能力和高风险区域地图，并选择第一个低风险、可验证的小任务。

## 2. 背景

旧 Markdown 集中治理已经结束。当前阶段不立即重构，而是先确认代码风险边界，避免第一步就碰 `src/distiller.py`、`WorkspacePane.tsx`、`main.ts` 这类大文件核心逻辑。

## 3. 本次范围

- 只读审计 `src/distiller.py`。
- 只读审计 `desktop/src/components/WorkspacePane.tsx`。
- 只读审计 `desktop/electron/main.ts` 和 `desktop/electron` 服务模块。
- 只读审计 `desktop/src` 页面、组件、Hook 和工具函数。
- 只读审计旧 course / lesson 兼容层。
- 只读审计 tests、检查脚本和现有验证能力。

## 4. 明确不做

- 不修改生产代码。
- 不启动软件。
- 不修改依赖。
- 不修改队列、AppData、材料或真实数据。
- 不继续整理历史 Markdown。
- 不开始大文件拆分。
- 不继续设计产品功能。

## 5. 主要代码模块及职责

| 区域 | 主要文件 | 职责 |
|---|---|---|
| Python 整理链路 | `src/distiller.py` | B 站/本地媒体输入、字幕规范化、分块、清洗、MiMo 精读稿、材料包写出、已有材料再清洗/再总结、命令行入口。 |
| Python 外部输入 | `src/bilibili_api.py`、`src/audio_fallback.py`、`src/local_audio_client.py`、`src/wbi.py` | B 站接口、本地音频下载/切片/转写、WBI 签名、外部资源获取。 |
| 桌面装配中心 | `desktop/electron/main.ts` | 创建运行时依赖、注册 IPC、连接设置、材料、队列、后台、TTS、Obsidian、窗口等模块。 |
| Electron 服务模块 | `desktop/electron/*.ts` | 文件读写、AppData Store、材料扫描/删除、队列执行、后台发现、外部 API、邮件、TTS、窗口和流程文档读取。 |
| 前端主界面 | `desktop/src/App.tsx`、`desktop/src/components/WorkspacePane.tsx` | 组织主要页面入口、读取 store、处理制作台/档案/灵犀/流程/设置的状态和事件。 |
| 前端拆分组件 | `desktop/src/components/workspace/*.tsx` | 设置、队列、来源、档案、灵犀等页面片段。 |
| 前端工具和兼容层 | `desktop/src/lib/*.ts`、`desktop/electron/studyPackageCompat.ts` | 旧学习包兼容、阅读状态、TTS 文本处理、进度格式化、桌面 API 浏览器兜底。 |
| 类型和契约 | `desktop/src/vite-env.d.ts`、`desktop/src/types/course.ts` | `window.desktopAPI`、课程/材料/队列等跨层数据结构。 |
| 检查脚本 | `src/check_editorial_email_contract.py`、`src/validate_content_synthesis_plan.py` | 当前少量可运行的脚本级验证。 |

## 6. 最大或职责最混乱的文件

| 文件 | 行数 | 风险判断 |
|---|---:|---|
| `src/distiller.py` | 约 3972 行 | 最高风险。字幕、清洗、MiMo、文件写出、缓存、已有材料处理和 CLI 混在一起。 |
| `desktop/src/components/WorkspacePane.tsx` | 约 1278 行 | 高风险。页面状态、设置保存、队列动作、删除确认、邮件测试入口集中。 |
| `desktop/src/components/MarkdownRenderer.tsx` | 约 830 行 | 中高风险。渲染规则复杂，容易影响阅读显示。 |
| `desktop/src/store.ts` | 约 779 行 | 高风险。学习状态、材料载入、前端业务动作集中。 |
| `desktop/electron/obsidianExport.ts` | 约 697 行 | 中高风险。大量文件写出和旧学习包导出逻辑。 |
| `desktop/electron/backendRuntime.ts` | 约 607 行 | 高风险。启动 Python 子进程、注入环境变量、解析输出。 |
| `desktop/electron/learningLibraryStore.ts` | 约 542 行 | 中高风险。读写旧学习库状态。 |
| `desktop/electron/studyPackageCompat.ts` | 约 525 行 | 中风险。旧 course / lesson 兼容层，不应成为新主线。 |
| `desktop/electron/ttsService.ts` | 约 523 行 | 高风险。外部 TTS API、缓存读写、音频文件生成。 |
| `desktop/electron/bilibiliSourceApi.ts` | 约 453 行 | 高风险。调用 B 站接口并依赖 Cookie。 |
| `desktop/electron/main.ts` | 约 363 行 | 中高风险。当前更像装配中心，但连接所有关键能力，改动影响面大。 |

## 7. 高风险区域

| 区域 | 为什么危险 |
|---|---|
| `src/distiller.py` | 会写 `.course_material`，会调用 MiMo，可能下载音频或转写；改错会影响资料生成、已有材料复用和输出契约。 |
| `desktop/electron/backendRuntime.ts` | 负责调用 Python、传递密钥环境变量、解析进度；错误会导致制作失败或秘密值进入日志。 |
| `desktop/electron/automationController.ts`、`queueExecutor.ts`、`workbenchQueueStore.ts` | 控制后台发现和队列执行；错误可能自动新增任务、重复制作或错误恢复 `processing` 任务。 |
| `desktop/electron/materialDeletion.ts`、`pathSafety.ts` | 涉及删除材料、灵犀记录和阅读记录；必须先有测试和人工验收。 |
| `desktop/electron/runtimeStores.ts`、`settings.ts`、`settingsRuntime.ts` | 读写 Electron Store，可能含 Cookie、API Key、SMTP 授权码。 |
| `desktop/electron/knowledgeLibrary.ts`、`learningLibraryStore.ts` | 读写灵犀索引和旧学习库；打开页面也可能触发规范化写回。 |
| `desktop/electron/bilibiliSourceApi.ts`、`sourceDiscovery*.ts` | 调用 B 站接口，依赖账号状态，可能产生来源发现结果。 |
| `desktop/electron/ttsService.ts`、`smtpEmail.ts`、`emailPush.ts` | 会调用外部服务，可能产生费用、发送邮件或写缓存/状态。 |
| `desktop/src/components/WorkspacePane.tsx` | 用户可见行为集中，包含设置、队列、删除、邮件测试等入口；局部改动容易造成跨页面回归。 |
| 旧 course / lesson 兼容层 | 与新产品方向不同，但仍被专注阅读和旧资料读取使用；不能贸然删除。 |

## 8. 纯函数、工具、格式转换或常量

这些区域相对适合先加测试或做小范围保护：

| 文件 | 可保护内容 |
|---|---|
| `desktop/electron/workbenchQueue.ts` | 队列项规范化、去重、恢复 interrupted、领取 queued 项、并发计数。 |
| `desktop/electron/settings.ts` | 设置默认值、秘密值清洗、路径规范化、邮箱默认值。 |
| `desktop/electron/pathSafety.ts` | 路径是否在允许根目录内的判断；注意其中删除函数本身不能先碰。 |
| `desktop/electron/smtpEmail.ts` | 邮箱收件人解析、配置完整性判断；发送函数不能在测试中调用。 |
| `desktop/src/lib/distillProgress.ts` | 制作进度阶段和耗时文案格式化。 |
| `desktop/src/lib/tts.ts` | TTS 文本长度和段落处理。 |
| `desktop/src/lib/learningTurn.ts` | 旧专注阅读兜底对话逻辑。 |
| `desktop/src/components/workspace/WorkspacePaneUtils.ts` | 数字/时间格式、材料筛选、队列和材料合并视图；有少量 `Date.now()` 和 `Math.random()`，测试时要避开或隔离。 |
| `src/check_editorial_email_contract.py` | 已有纯格式契约检查，不读写真实数据，不调用外部服务。 |
| `src/distiller.py` 中的格式函数 | 如 `_normalize_editorial_article_markdown`、`_render_simple_email_html` 等可由脚本级检查保护，但不应先改主流程。 |

## 9. 读写真实数据的模块

| 模块 | 读写位置 |
|---|---|
| `src/distiller.py` | 写 `output/materials/*.course_material`、缓存、`summary/*`、`exports/notebooklm.md`、运行状态。 |
| `desktop/electron/materialInventory.ts` | 扫描读取 `output/materials`。 |
| `desktop/electron/materialDeletion.ts` | 删除材料包、相关记录和可能的关联文件。 |
| `desktop/electron/knowledgeLibrary.ts` | 读写 `output/knowledge/knowledge_library.json`。 |
| `desktop/electron/runtimeStores.ts`、`settingsRuntime.ts`、`workbenchQueueStore.ts` | 读写 Electron Store，含设置、队列、来源、旧学习库。 |
| `desktop/electron/windowStateStore.ts`、`runtimeLogger.ts` | 写窗口状态和运行日志。 |
| `desktop/electron/obsidianExport.ts` | 写 Obsidian vault 文件。 |
| `desktop/electron/ttsService.ts` | 写 TTS 缓存和使用记录。 |
| `desktop/electron/backendRuntime.ts` | 创建材料输出目录，调用 Python 写材料包。 |

## 10. 调用外部服务的模块

| 模块 | 外部服务 |
|---|---|
| `src/bilibili_api.py`、`src/wbi.py`、`desktop/electron/bilibiliSourceApi.ts` | B 站接口。 |
| `src/audio_fallback.py`、`src/local_audio_client.py` | 视频/音频下载、本地 SenseVoice 转写。 |
| `src/distiller.py` | MiMo 文本清洗和精读稿生成。 |
| `desktop/electron/ttsService.ts` | MiMo / MiniMax TTS。 |
| `desktop/electron/smtpEmail.ts`、`emailPush.ts` | SMTP 邮件发送。 |
| `desktop/electron/sourceDiscovery.ts`、`sourceDiscoveryRuntime.ts` | 来源发现，间接调用 B 站接口。 |
| `desktop/electron/obsidianCli.ts` | 调用系统或外部 Obsidian 打开路径。 |

## 11. 当前测试保护

| 验证 | 覆盖范围 | 本轮结果 |
|---|---|---|
| `desktop` 下 `npx tsc --noEmit` | TypeScript 类型检查；不验证运行行为 | 通过。 |
| Python `ast.parse` 只读语法解析 | `src/*.py` 语法；不导入、不写 `__pycache__`、不调用服务 | 通过；需用 `utf-8-sig` 读取含 BOM 的 `bilibili_api.py`。 |
| `src/check_editorial_email_contract.py` | 精读稿 Markdown/HTML 输出契约的一小部分 | 已知可运行，本轮未重新执行，避免把本次审计变成输出行为改造。 |
| 受控启动人工验收 | 首页、设置、队列静止、材料数量 | 已在基线中记录；本轮未启动软件。 |

## 12. 没有可靠验证的模块

- 队列恢复、队列去重、后台定时、来源发现。
- 删除材料、清空队列、删除阅读记录。
- `src/distiller.py` 完整制作链路和已有材料复用。
- 本地音视频转写。
- B 站字幕和来源读取。
- MiMo、MiniMax、SMTP 等外部服务。
- 档案主页面、独立灵犀页、旧学习包兼容行为。
- Obsidian 导出。
- Markdown 渲染复杂规则。

## 13. 候选任务评分

| 候选任务 | 风险 | 是否接触真实数据 | 是否容易测试 | 回退难度 | 收益 |
|---|---|---|---|---|---|
| 扩充 `src/check_editorial_email_contract.py`，保护精读稿 Markdown/HTML 纯格式契约 | 低 | 否 | 是，直接运行脚本 | 低 | 中。先保护已有短视频精读输出边界，不碰主流程。 |
| 为 `desktop/electron/workbenchQueue.ts` 增加纯函数测试或检查脚本 | 低到中 | 否 | 中。当前没有测试框架，需要设计最小 TS/JS 检查方式 | 低 | 高。保护队列去重和恢复，但需要先处理 TS 测试运行方式。 |
| 为 `desktop/electron/settings.ts` 增加纯函数测试 | 中 | 否，但涉及秘密值清洗规则 | 中。需要构造测试，不读取真实 Store | 低 | 中。能保护设置规范化和秘密值清洗。 |
| 为 `desktop/src/lib/distillProgress.ts` 增加纯函数测试 | 低 | 否 | 中。需要前端 TS 检查方式 | 低 | 低到中。收益较小，但很安全。 |
| 只读梳理并标注 `WorkspacePane.tsx` 内事件处理职责 | 中 | 否 | 低。主要是文档，不保护行为 | 低 | 低。不能算真正代码稳定化。 |
| 给 `pathSafety.ts` 增加路径判断测试 | 中 | 否 | 中。Windows 路径边界要小心 | 低 | 高。未来删除保护很关键，但不适合作为第一步直接碰删除相关区域。 |
| 拆分 `src/distiller.py` 的纯函数 | 高 | 可能间接影响输出 | 否 | 中到高 | 高，但不满足第一任务条件。 |
| 拆分 `WorkspacePane.tsx` | 高 | 否 | 否 | 中到高 | 高，但不满足第一任务条件。 |

## 14. 推荐的第一个代码改造任务

推荐：扩充 `src/check_editorial_email_contract.py`，把现有短视频精读稿 Markdown/HTML 输出契约检查补强。

原因：

- 不接触真实用户数据。
- 不改变用户可观察行为。
- 不涉及数据库、队列、外部 API、AppData 或材料目录。
- 不拆分 `distiller.py`，只通过已有检查脚本调用其中少量纯格式函数。
- 已有脚本路径和运行方式明确，回退容易。
- 能先保护短视频精读输出边界，为后续改动 `distiller.py` 前补一层安全网。

建议修改文件：

- `src/check_editorial_email_contract.py`

可选只读参考文件：

- `src/distiller.py`

建议验证：

- `python src/check_editorial_email_contract.py`
- Python `ast.parse` 只读语法解析。
- 如涉及 TypeScript 无需运行前端检查；若没有改 TS，可不跑 `npx tsc --noEmit`。

回退方式：

- 只回退 `src/check_editorial_email_contract.py` 的本次改动即可。

## 15. 本轮验证

- `desktop` 下执行 `npx tsc --noEmit`：通过。
- 使用 Python `ast.parse` 只读解析 `src/*.py`：通过。第一次用 `utf-8` 读取时发现 `src/bilibili_api.py` 文件开头有 BOM；改用 `utf-8-sig` 后通过。这不是本轮新增问题，也未修改文件。
- 未启动软件。
- 未运行会写真实数据的制作、队列、来源刷新、邮件、TTS 或删除行为。

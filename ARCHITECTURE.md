# ARCHITECTURE.md

本文件帮助非技术用户理解软件现在怎样运行。

## 1. 项目概览

- 软件类型：本地优先的 Electron 桌面应用，配套 Python 后端脚本。
- 主要技术：React、TypeScript、Vite、Electron、Tailwind CSS、Python、B 站接口、本地 SenseVoice 转写、MiMo / MiniMax / SMTP 等外部服务。
- 启动方式：开发模式通常进入 `desktop` 后执行 `npm run dev`。本轮未启动主进程，避免写入真实用户数据或触发后台队列。
- 项目入口：前端入口 `desktop/src/main.tsx`、桌面主进程入口 `desktop/electron/main.ts`、预加载入口 `desktop/electron/preload.ts`、Python 整理入口 `src/distiller.py`。
- 数据存储位置：默认输出根目录 `C:\Users\Yu\AI\视界专注\output`；Electron 用户数据目录 `C:\Users\Yu\AppData\Roaming\视界专注`。
- 部署或运行环境：Windows 本机桌面端；打包配置位于 `desktop/package.json` 的 `build` 字段。

## 2. 目录地图

只记录重要目录和文件，不逐项罗列全部内容。

| 路径 | 负责什么 | 什么时候会修改 |
|---|---|---|
| `desktop/src` | React 前端界面、状态和组件 | 修改页面、交互和专注阅读体验时 |
| `desktop/electron` | Electron 主进程、IPC、设置、队列、后台、文件读写 | 修改桌面能力、数据读写、后台任务时 |
| `src` | Python 后端：配置、B 站读取、音频转写兜底、字幕清洗、精读稿生成 | 修改资料生成链路时 |
| `assets` | 应用图标等静态资源 | 修改品牌图标或打包资源时 |
| `output/materials` | 真实材料包数据 | 用户制作或清理资料时，不能随意删除 |
| `output/notebooklm` | 面向用户的 NotebookLM 清洗稿最终出口 | 未来生成长视频或本地媒体清洗稿时；本轮只定义契约，不创建目录 |
| `output/knowledge` | 灵犀归档索引 | 归档、刷新、删除记录时 |
| `docs` | 审计、计划、流程和历史文档 | 事实或计划变化时 |
| `desktop/dist`、`desktop/dist-electron` | 构建产物 | 运行构建命令时自动重写 |
| `desktop/node_modules` | npm 依赖 | 安装或更新依赖时 |

## 3. 主要模块

| 模块 | 主要职责 | 输入 | 输出 | 依赖 |
|---|---|---|---|---|
| 前端应用 | 展示制作、来源、队列、专注、档案、灵犀、设置 | 用户点击、输入、IPC 返回 | 页面状态、IPC 请求 | React、Zustand、Electron preload |
| Electron 主进程 | 装配窗口、设置、队列、后台、IPC 和文件操作 | 前端 IPC、系统事件、定时器 | 文件读写、子进程、状态广播 | Electron、electron-store、Node.js fs/path |
| Python 整理链路 | 获取字幕或转写音频，清洗正文，生成内部材料包、短视频精读稿和 NotebookLM 清洗稿 | B 站链接/BV、本地音视频、环境变量配置 | `.course_material` 内部目录；未来 `output/notebooklm/**/*.md` | requests、yt-dlp、SenseVoice、MiMo |
| 材料清单 | 扫描 `output/materials`，判断资料阶段 | `.course_material` 文件结构 | 档案/制作台列表数据 | Node.js fs |
| 后台自动化 | 按来源发现最近视频，加入队列并处理 | 收藏/关注来源、队列、已有材料包 | 队列项目、材料包 | B 站接口、Python 后端 |
| 设置与密钥 | 保存运行配置和秘密值 | 设置页面输入 | Electron Store 记录、环境变量注入 | electron-store |
| TTS 朗读 | 生成或读取朗读音频缓存 | 文本、TTS 设置 | 音频缓存和播放数据 | MiMo / MiniMax |
| 灵犀/档案 | 保存阅读记录和知识索引 | 材料包、精读稿、用户操作 | `knowledge_library.json` 和 Electron Store 记录 | Node.js fs、electron-store |
| 流程透明页 | 通过白名单读取当前正式工作流文档，供用户查看 | 前端传入固定 key | 文档内容、更新时间和路径 | `workflowDocuments.ts`、Node.js fs |
| 旧学习包兼容层 | 读取和展示历史学习包结构 | 旧 `CoursePackage` / `lesson` 数据 | 专注页兼容显示 | `studyPackageCompat.ts`、`learningNotesStudyPackage.ts`、旧学习状态库 |

## 4. 核心数据流

### 流程 1：短视频精读主流程

```text
用户输入短视频 BV/链接
→ 前端调用 preload 暴露的 desktopAPI
→ Electron 主进程调用 `src/distiller.py`
→ Python 获取字幕，必要时走转写兜底
→ 清洗字幕
→ 调用 MiMo
→ 生成轻量、清晰、适合快速阅读的精读稿
```

### 流程 2：长视频和本地媒体辅助流程

目标流程：

```text
用户输入长视频 BV/链接，或选择本地视频/音频
→ 获取字幕或本地转写
→ 清洗正文
→ 写入用户可直接使用的 Markdown 清洗稿
→ 输出到 `output/notebooklm/long-video/` 或 `output/notebooklm/local-media/`
→ 更新 `output/notebooklm/index.md`
```

说明：当前代码已能在 `.course_material` 内生成 NotebookLM 相关文件；`output/notebooklm/` 是本轮确认的新产品出口，本轮不创建目录、不移动旧文件、不改生产代码。

### 流程 3：后台来源和队列

```text
用户保存关注来源
→ Electron Store 保存来源
→ 后台定时或手动检查最近 24 小时视频
→ 与已有队列和材料包按 BV 去重
→ 加入工作台队列
→ 队列按配置并发处理
```

## 5. 数据与文件

| 数据或文件 | 位置 | 谁会读写 | 备份要求 |
|---|---|---|---|
| 内部材料包 | `output/materials/*.course_material` | Python 写入，Electron 扫描/删除，前端读取 | 重要，删除前必须独立备份 |
| NotebookLM 清洗稿资料库 | `output/notebooklm/` | 未来由整理链路写入，用户直接读取和导入 NotebookLM | 重要，是用户最终出口；本轮只定义契约 |
| NotebookLM 清洗稿索引 | `output/notebooklm/index.md` | 未来由整理链路追加或更新，用户可直接查看 | 重要，记录标题、来源、日期、文件路径和基本状态 |
| 灵犀索引 | `output/knowledge/knowledge_library.json` | Electron 读写 | 重要，删除前必须备份 |
| Electron Store | `C:\Users\Yu\AppData\Roaming\视界专注\shijie-focus-secure.json` | Electron Store 读写 | 非常重要，含设置和可能的秘密值 |
| Electron Store 备份 | 同目录 `shijie-focus-secure*.bak*` | 人工或历史脚本生成 | 保留，除非确认有新备份 |
| 窗口状态 | `C:\Users\Yu\AppData\Roaming\视界专注\.shijie-focus.window.json` | Electron 读写 | 可恢复，但不在本轮删除 |
| 运行日志 | `C:\Users\Yu\AppData\Roaming\视界专注\.shijie-focus-runtime.log` | Electron 写入 | 排错用，清理前需确认 |
| TTS 缓存 | 默认在数据根目录 `.shijie-tts-cache` | TTS 模块读写 | 可再生，但可能含用户文本生成音频 |
| 音频/字幕缓存 | `output/materials/cache` 等 | Python 后端读写 | 可再生，但不在本轮删除 |
| 构建产物 | `desktop/dist`、`desktop/dist-electron` | 构建命令生成 | 可再生，不属于源码 |

### 流程页白名单文件

当前代码中 `desktop/electron/workflowDocuments.ts` 通过固定 key 读取白名单文件，前端不能传任意路径。当前白名单只指向正式工作流文档：

| key | 当前路径 | 说明 |
|---|---|---|
| `agents` | `AGENTS.md` | AI 工作入口、任务流程、文档职责和安全红线。 |
| `product` | `PRODUCT.md` | 产品边界、当前用途和不可破坏行为。 |
| `architecture` | `ARCHITECTURE.md` | 模块、数据流、外部服务和风险区域。 |
| `current_state` | `CURRENT_STATE.md` | 当前阶段、风险、下一步和暂停事项。 |
| `baseline_acceptance` | `docs/BASELINE_ACCEPTANCE.md` | 启动、队列、材料和数据安全基线。 |
| `stabilization_plan` | `docs/plans/STABILIZATION_PLAN.md` | 工作流闭环、验收收敛和阶段安排。 |

## 6. 外部服务和配置

| 服务或配置 | 用途 | 配置位置 | 失败时影响 |
|---|---|---|---|
| B 站 SESSDATA | 读取账号相关来源、字幕和视频信息 | Electron Store，经环境变量 `BILIBILI_SESSDATA` 注入 Python | 无法读取需要登录的来源或字幕 |
| MiMo API Key | 字幕清洗增强、短视频精读、TTS | Electron Store，经 `SHIJIE_MIMO_API_KEY` 等环境变量注入 | 精读稿、API 清洗或 MiMo 朗读失败；无 Key 时部分清洗走规则模式 |
| 短视频精读路由 | 控制是否自动进入编稿、最大时长和最大正文长度 | `SHIJIE_EDITORIAL_SUMMARY_MODE`、`SHIJIE_EDITORIAL_SUMMARY_MAX_DURATION_SECONDS`、`SHIJIE_EDITORIAL_SUMMARY_MAX_CONTENT_CHARS` | 路由不符合预期时，可能跳过或强制进入精读稿生成 |
| MiniMax TTS | 备用朗读 | Electron Store | MiniMax 朗读失败 |
| 本地 SenseVoice | 无字幕视频或本地音视频转写 | 设置中的本地转写根目录、Python 路径、模型和设备 | 无字幕材料无法转写 |
| SMTP 邮件 | 推送精读稿或测试邮件 | Electron Store | 邮件推送失败 |
| Obsidian 路径 | 导出到 Obsidian vault | Electron Store | Obsidian 同步/打开失败 |

不要在本文档写入真实密码或密钥值。

## 7. 风险区域

- `src/distiller.py`：大文件，承担字幕、音频、清洗、精读、缓存和写文件，修改前必须先加验收。
- `desktop/src/components/WorkspacePane.tsx`：页面状态和业务行为集中，容易牵一发动全身。
- `desktop/electron/main.ts`：装配中心，虽然已拆出模块，但连接了所有关键能力。
- `desktop/electron/materialDeletion.ts`：会删除材料包、灵犀记录和阅读记录，必须重点保护。
- `desktop/electron/automationRuntime.ts`、`queueExecutor.ts`：可能影响后台自动制作和队列恢复。
- `desktop/electron/runtimePaths.ts`、`runtimeStores.ts`、`runtimeLogger.ts`：负责项目根、数据根、设置文件、窗口状态和运行日志路径，修改会影响启动和数据位置。
- `output/materials` 和 Electron Store：真实数据，不能用测试命令随意操作。
- `output/notebooklm`：未来用户最终资料库，不能混入秘密值、调试日志、内部状态或复杂中间结果。

## 8. 架构边界

- 前端通过 `window.desktopAPI` 请求本地能力，不直接访问 Node.js 文件系统。
- 主进程负责真实文件读写、设置、队列、后台和子进程调用。
- Python 侧通过环境变量接收敏感配置，不从项目内 JSON 文件直接读取密钥。
- `output`、`desktop/dist`、`desktop/dist-electron` 是运行或构建产物，不作为核心源码维护。
- 删除真实材料包前必须通过路径安全检查，并在人工验收中覆盖。
- `.course_material` 是内部工作目录，`output/notebooklm/` 是用户最终出口；两者用途不同，不应把内部状态暴露到最终清洗稿。
- 开发模式下，`desktop/electron/runtimePaths.ts` 通过多个稳定标志探测项目根目录：`AGENTS.md`、`PRODUCT.md`、`ARCHITECTURE.md`、`src/distiller.py`、`desktop/package.json`。不再依赖 `PROJECT_CONTEXT.md`。
- `CoursePackage`、`lesson`、`quiz_question`、`standard_answer`、`quizzing` 等旧字段只允许作为兼容层存在，不应影响新的产品语言、制作流程或对外文件命名。

## 9. NotebookLM 清洗稿文件契约

第一版目标目录：

```text
output/notebooklm/
├── long-video/
├── local-media/
└── index.md
```

第一版文件命名：

```text
YYYY-MM-DD_标题_来源ID.md
```

第一版 Markdown 至少包含：

| 字段 | 说明 |
|---|---|
| 标题 | 用户能看懂的材料标题。 |
| 来源或原文件 | B 站、其他在线视频来源，或本地文件名。 |
| 作者或来源方 | UP 主、发布者或本地资料来源方；拿不到时可为空或写未获取。 |
| 发布时间 | 能获取到时记录。 |
| 视频地址或原文件路径 | 在线视频地址，或本地原文件路径。 |
| 处理日期 | 软件生成清洗稿的日期。 |
| 时长 | 能获取到时记录。 |
| 清洗正文 | 经过清洗的完整正文，适合直接导入 NotebookLM。 |

第一版清洗稿不写入 API Key、Cookie、邮箱授权码、调试日志、内部状态、复杂中间结果。

## 10. 当前技术债务

- 缺少完整自动测试套件，只有少量脚本级检查。
- 真实桌面端启动和核心流程尚未记录成稳定人工验收。
- 旧历史文档仍包含已退出路线，容易误导后续改造。
- 旧材料包没有检测到 `metrics.json`，计量数据不完整。
- `.course_material` 名称仍带旧语义，但当前仍有代码依赖，不应急着迁移。
- `output/notebooklm/` 是已确认产品契约，但当前尚未接入生产代码。
- `PROJECT_CONTEXT.md` 不再是流程页白名单或开发项目根探测依赖；原文件已归档到 `docs/history/legacy-md/PROJECT_CONTEXT.md`。
- 旧系统优化审计、旧视频编稿流程和旧聊天记录已归档到 `docs/history/legacy-md/`；日常技术事实以本文档和当前代码为准。

## 11. 最近核对

- 日期：2026-06-12
- 与当前代码是否一致：当前代码事实和本轮产品契约已分开记录；`output/notebooklm/` 是目标出口，本轮未创建目录、未移动文件、未修改生产代码。

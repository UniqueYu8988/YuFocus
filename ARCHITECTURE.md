# ARCHITECTURE.md

本文件帮助非技术用户理解软件现在怎样运行。

## 1. 项目概览

- 软件类型：本地优先的 Electron 桌面应用，配套 Python 后端脚本。
- 主要技术：React、TypeScript、Vite、Electron、Tailwind CSS、Python、B 站接口、本地 SenseVoice 转写、MiMo 字幕清洗、本地 Ollama 总结和 SMTP 邮件通知。
- 启动方式：开发模式通常进入 `desktop` 后执行 `npm run dev`。本轮未启动主进程，避免写入真实用户数据或触发后台队列。
- 项目入口：前端入口 `desktop/src/main.tsx`、桌面主进程入口 `desktop/electron/main.ts`、预加载入口 `desktop/electron/preload.ts`、Python 整理入口 `src/distiller.py`。
- 数据存储位置：默认数据根目录 `C:\Users\Yu\AI\视界专注\data`；Electron 用户数据目录 `C:\Users\Yu\AppData\Roaming\视界专注` 保存设置和敏感配置。
- 部署或运行环境：Windows 本机桌面端；打包配置位于 `desktop/package.json` 的 `build` 字段。

## 2. 目录地图

只记录重要目录和文件，不逐项罗列全部内容。

| 路径 | 负责什么 | 什么时候会修改 |
|---|---|---|
| `desktop/src/ui` | React 前端界面：页面、面板和基础组件 | 修改展示、布局和用户操作入口时 |
| `desktop/src/domain` | 前端可复用的产品规则和 pipeline 纯逻辑 | 修改字幕流水线的前端规则时 |
| `desktop/src/services` | 前端服务适配，例如剪贴板和浏览器预览 fallback | 修改浏览器侧外部适配时 |
| `desktop/src/state` | 前端状态容器 | 修改 Zustand store 或状态读写时 |
| `desktop/src/legacy` | 旧学习库和旧 course 类型兼容 | 只在兼容旧数据时修改 |
| `desktop/electron/ipc` | Electron IPC 注册层 | 增删前后端通信入口时 |
| `desktop/electron/runtime` | 主进程运行时装配：设置、路径、日志、窗口、后台、Python 调用 | 修改桌面运行环境或后台编排时 |
| `desktop/electron/queue` | 工作台队列模型、存储和执行器 | 修改队列状态或 subtitle-only 保护时 |
| `desktop/electron/providers` | 外部来源提供者，例如 B 站来源和视频发现 | 修改外部来源读取时 |
| `desktop/electron/services` | 主进程文件和数据服务：材料、知识库、删除、路径安全 | 修改本地文件读写或材料扫描时 |
| `desktop/electron/legacy` | 旧学习库 / 旧学习包兼容服务 | 只在兼容旧数据时修改 |
| `src` | Python 后端：配置、B 站读取、音频转写兜底、字幕清洗、精读稿生成 | 修改资料生成链路时 |
| `assets` | 应用图标等静态资源 | 修改品牌图标或打包资源时 |
| `data/materials` | 当前生产工作区，结构为 `{up_id}/{video_id}`；完成后只保留轻量记录和成品引用 | 用户制作或清理资料时，不能随意删除 |
| `data/library` | 长期成品库，按 UP 主分组保存 NotebookLM 清洗稿、邮件稿和索引 | 队列完成材料后同步写入；不能随意删除 |
| `data/registry` | UP 主视频注册表，结构为 `{up_id}.json` | 刷新来源视频时合并写入；不能随意删除 |
| `data/temp` | 音频、下载、切片等临时中间文件 | 字幕转写兜底运行时；完成后可丢弃 |
| `data/cache` | B 站字幕、转写、断点等缓存 | 加速重复处理；删除后不应影响正确性 |
| `data/logs` | 运行日志 | 排错时写入 |
| `data/legacy` | 旧知识库、旧消费层数据隔离区 | 兼容旧数据时写入 |
| `docs` | 审计、计划、流程和历史文档 | 事实或计划变化时 |
| `desktop/dist`、`desktop/dist-electron` | 构建产物 | 运行构建命令时自动重写 |
| `desktop/node_modules` | npm 依赖 | 安装或更新依赖时 |

## 3. 主要模块

| 模块 | 主要职责 | 输入 | 输出 | 依赖 |
|---|---|---|---|---|
| 前端 UI 层 | 展示字幕流水线、UP 主来源、视频列表、队列、NotebookLM 输出和设置 | 用户点击、输入、IPC 返回 | 页面状态、IPC 请求 | `desktop/src/ui` |
| 前端 domain 层 | 保存可复用的 pipeline 规则和进度解析 | IPC 返回、进度事件 | 纯计算结果 | `desktop/src/domain` |
| 前端 services 层 | 浏览器侧剪贴板、desktop API fallback 等适配 | UI 请求 | 系统适配结果 | `desktop/src/services` |
| 前端 state 层 | 保存前端状态和旧兼容状态 | UI action、IPC 返回 | React 可订阅状态 | `desktop/src/state` |
| Electron 主进程 | 装配窗口、设置、队列、后台、IPC 和文件操作 | 前端 IPC、系统事件、定时器 | 文件读写、子进程、状态广播 | `desktop/electron/*` |
| Python 字幕整理链路 | 获取字幕或转写音频，清洗正文，生成内部材料包和 NotebookLM 导入稿 | B 站链接/BV、本地音视频、环境变量配置 | `data/materials/{up_id}/{video_id}` | requests、yt-dlp、SenseVoice、MiMo |
| MiMo 清洗提示词实验层 | 为重点 UP 主生成清洗 profile，并用真实字幕小样本循环比较通用 prompt、UP prompt 和修订轮次 | `data/materials` 中已有 `raw_transcript.txt`、旧清洗稿、MiMo 设置 | `data/temp/mimo-cleaning-prompt-lab/` 临时报告 | `src/distiller.py` 的 profile 纯函数、`desktop/scripts/generate_mimo_cleaning_prompt_lab.py`；当前不写正式材料包，也不进入生产队列 |
| Summary Pipeline | 遗留消费层，后续如恢复也只能独立读取字幕清洗产物 | 已完成的字幕清洗资料 | `summary/*`、邮件或音频等消费产物 | MiMo、SMTP、TTS 服务；当前已从主流程和主 UI 隔离 |
| 本地消费层 | 读取 NotebookLM 主资料，生成本地 brief、邮件草稿、价值判断和质量检查；作为 subtitle-only 材料完成后的正式后置步骤 | `exports/notebooklm.md`、`raw_transcript.txt`、本地模型配置 | `exports/brief.local.md`、`delivery/email.md`、`delivery/decision.json`、`work/quality/local_check.json`、`work/local_consumption/run_meta.json` | `desktop/src/domain/localConsumption.ts` 生成请求计划；`desktop/electron/services/localOllamaAdapter.ts` 执行 Ollama；`desktop/electron/services/localConsumptionRunner.ts` 限制写入当前材料包并更新 manifest/metrics/run_state |
| 通知层 / 最近更新邮件 | 只把 fresh 最近更新视频的本地总结发送到邮箱，不生成内容、不参与清洗 | 队列来源、本地 brief/email、decision、quality、SMTP 设置 | `delivery/email_status.json`、SMTP 邮件 | `desktop/electron/services/emailDeliveryService.ts`、`desktop/electron/queue/queueExecutor.ts`、`nodemailer` |
| 材料清单 | 扫描 `data/materials` 轻记录，并读取 `data/library/index.json` 解析成品路径 | `{up_id}/{video_id}` 材料目录、长期成品索引 | 输出页列表数据 | Node.js fs、`materialInventory.ts` |
| 长期成品库同步 | 把单视频材料包中的 NotebookLM 清洗稿和邮件稿同步到按 UP 主分组的长期目录，并更新 BV 索引 | `exports/notebooklm.md`、`delivery/email.md`、`manifest.json`、队列视频元数据 | `data/library/notebooklm/*`、`data/library/email/*`、`data/library/index.json`、`library_refs.json` | `desktop/electron/services/libraryExportService.ts` |
| 视频注册表 | 合并 UP 主视频元数据，稳定刷新行为 | B 站 API 返回、已有 registry | `data/registry/{up_id}.json` 和稳定视频列表 | Node.js fs |
| 后台自动化 | 按来源发现最近视频，加入队列并处理 | 收藏/关注来源、队列、已有材料包 | 队列项目、材料包 | B 站接口、Python 后端 |
| 设置与密钥 | 保存运行配置和秘密值 | 设置页面输入 | Electron Store 记录、环境变量注入 | electron-store |
| TTS 朗读 | 遗留能力，已从当前 UI / IPC 主入口移除 | 旧配置 | 无当前主线输出 | 遗留配置兼容 |
| 灵犀/档案 | 遗留兼容层，保存阅读记录和知识索引 | 材料包、旧精读稿、用户操作 | `knowledge_library.json` 和 Electron Store 记录 | `desktop/electron/legacy`、`desktop/src/legacy` |
| 流程透明页 | 通过白名单读取当前正式工作流文档，供用户查看 | 前端传入固定 key | 文档内容、更新时间和路径 | `workflowDocuments.ts`、Node.js fs |
| 旧学习包兼容层 | 读取历史学习包结构 | 旧 `CoursePackage` / `lesson` 数据 | 旧兼容状态 | `desktop/electron/legacy`、`desktop/src/legacy` |

## 4. 核心数据流

### 流程 0：简洁首页数据更新

```text
打开桌面端
→ 只读固定来源、本地 `data/registry`、队列和材料清单
→ 展示最近视频、独立视频来源区和处理状态

用户点击“更新数据”
→ 请求固定来源的视频元数据
→ 合并写入 `data/registry/{up_id}.json`
→ 重新展示数据

用户点击“管理固定 UP”
→ 读取 B 站关注来源
→ 选择固定或取消固定 UP
→ 保存固定来源并重新读取本地注册表快照

用户在视频来源区选择视频并点击“加入队列”
→ 保存任务队列记录，模式为 subtitle-only
→ 不直接启动下载、转写或材料制作入口
```

首页不挂载原字幕流水线工作区，也不调用自动化检查、下载、转写或材料制作入口。主进程通过 `sources:bilibili:registered-videos` 提供只读本地注册表快照；现有来源刷新 IPC 只在用户点击“更新数据”后调用。固定 UP 弹窗只保存来源订阅，不创建处理任务；“加入队列”按钮只保存队列记录。

### 流程 1：UP 主驱动的字幕清洗主流程

```text
用户从 UP 主 / 来源视频列表批量选择视频
→ Electron 主进程读取 `data/registry/{up_id}.json`
→ 前端调用 preload 暴露的 desktopAPI
→ 工作台队列记录视频
→ Electron 主进程调用 `src/distiller.py`
→ Python 获取字幕，同一分 P 只选择一条首选语言轨；必要时走转写兜底
→ 清洗字幕
→ 生成 NotebookLM 可导入资料
```

当前行为：刷新 UP 主视频时先调用 B 站 API，再合并进 `data/registry/{up_id}.json`，界面显示 registry 中的稳定列表。UP 主批量入队路径和后台来源发现都会创建 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'` 的队列项。队列执行到字幕清洗和 NotebookLM 导入稿完成后，会尝试运行本地消费层；只有 `fresh` 最近更新视频在质量门控通过且邮件设置启用时才进入通知层。旧精读稿、旧邮件模板和 TTS 不会被 subtitle-only 主线触发。

运行时明确区分项目根和标准数据根：开发环境的标准数据根是项目下的 `data`，视频注册表由主进程解析为 `data/registry` 后统一传给前台刷新和后台发现。旧设置中的项目 `output` 根只用于单向规范化到 `data`，不再作为材料扫描或生产写入位置。

“清空任务队列”只清理非处理中的队列记录，保留正在处理的任务；该操作不扫描、不归档、不删除材料包。资料包删除仍是独立操作，必须经过路径安全检查和单条确认。

### 流程 1.1：MiMo UP 定制清洗提示词实验层

```text
只读已有 `data/materials/{up_id}/{video_id}`
→ 截取真实 `raw_transcript.txt` 小样本
→ MiMo 通用 prompt 清洗 baseline
→ MiMo UP profile prompt 清洗 profiled
→ 如评分未达标，带 repair notes 跑 iteration-2
→ 写入 `data/temp/mimo-cleaning-prompt-lab/` 对比报告
```

说明：该实验层用于保存 UP 定制清洗提示词的历史实验结论。当前生产路线已经回到通用高保真逐字清洗；实验层只读正式材料，只写临时目录，不覆盖 `cleaned_transcript.txt`、`content.md` 或 `exports/notebooklm.md`，也不接入队列、邮件或本地 Ollama。

### 流程 2：单个视频和本地媒体辅助输入

目标流程：

```text
用户输入长视频 BV/链接，或选择本地视频/音频
→ 获取字幕或本地转写
→ 清洗正文
→ 写入用户可直接使用的 Markdown 清洗稿
→ 输出临时 NotebookLM 稿到材料包
→ 同步最终清洗稿到 `data/library/notebooklm/{UP 主}/{视频标题}.md`
```

说明：当前代码在材料包内生成 NotebookLM 相关文件；新生产材料包统一位于 `data/materials/{up_id}/{video_id}`，不再依赖旧 `output/` 目录。

### 流程 3：后续 Summary Pipeline

```text
已完成的字幕清洗资料
→ 后续独立 Summary Pipeline
→ 生成精读稿、邮件或 TTS 等消费产物
```

说明：旧 Summary Pipeline 和 TTS 当前暂停作为主线推进。最近更新邮件已经恢复为独立通知层，但它只消费本地 brief，不参与字幕清洗，也不恢复旧精读稿链路。

### 流程 3.1：本地消费层正式后置步骤

```text
已完成的 NotebookLM 主资料
→ 本地 brief / email / decision / quality 请求计划
→ Ollama adapter 执行
→ 写入同一 `data/materials/{up_id}/{video_id}` 材料包
→ 更新 manifest / metrics / run_state
```

说明：`desktop/src/domain/localConsumption.ts` 只负责纯计算和请求计划，不直接调用网络、HTTP 客户端或子进程。`desktop/electron/services/localOllamaAdapter.ts` 只负责调用 Ollama 并归一化结果，不读取材料包、不写文件。`desktop/electron/services/localConsumptionRunner.ts` 负责读取材料包、执行本地消费层、把产物写回当前材料包，并更新 `manifest.json`、`metrics.json`、`run_state.json`。

当前行为：subtitle-only 队列项生成 NotebookLM 主资料后，会自动尝试生成 `exports/brief.local.md`、`delivery/email.md`、`delivery/decision.json` 和 `work/quality/local_check.json`。本地消费层失败或需复核不会让 NotebookLM 主资料失败；通知层如果要发邮件，只读取 `delivery/email.md` 或 `exports/brief.local.md`，不能重新绑回旧 Summary Pipeline。

本地消费层和通知层之后，会同步长期成品库。同步会复制成品 Markdown、更新轻量索引，并在成品存在后把 `data/materials` 工作区瘦身为 manifest、metrics、run_state、library_refs 和必要状态文件。

临时验收脚本 `desktop/scripts/generate-local-ollama-samples.mjs` 仍可用于离线抽样比较，但不再代表正式写入路径。

### 流程 3.2：fresh-only 最近更新邮件通知

```text
subtitle-only 材料包完成
→ 本地消费层生成 brief / email / decision / quality
→ 队列来源是 fresh
→ 邮件推送已启用且 SMTP 配置完整
→ 质量门控通过且同一内容未发送过
→ 发送邮件并写入 delivery/email_status.json
```

说明：`history`、`manual`、`retry`、`follow_source` 队列项不会自动发送邮件。邮件发送失败只写入 `delivery/email_status.json` 和运行日志，不把队列项改成失败。邮件正文不附带本机材料目录，只提示资料已保存在本机档案。

### 流程 4：后台来源和队列

```text
用户保存关注来源
→ Electron Store 保存来源
→ 后台定时或手动检查最近视频
→ API 结果合并进 `data/registry/{up_id}.json`
→ 与已有队列和材料包按 BV 去重
→ 加入工作台队列
→ 队列按配置并发处理
```

## 5. 数据与文件

| 数据或文件 | 位置 | 谁会读写 | 备份要求 |
|---|---|---|---|
| 生产工作区轻记录 | `data/materials/{up_id}/{video_id}` | Python 写入，Electron 扫描/删除和瘦身，前端读取 | 重要，删除前确认对应成品库文件 |
| NotebookLM 清洗稿成品 | `data/library/notebooklm/{up_name}/{title}.md` | Electron 同步写入，用户直接读取和导入 NotebookLM | 重要，是用户最终出口 |
| 长期 NotebookLM 成品库 | `data/library/notebooklm/{up_name}` | Electron 队列完成后同步写入 | 重要，可由材料包再生成，但删除前需确认 |
| 长期邮件稿成品库 | `data/library/email/{up_name}` | Electron 队列完成后同步写入 | 重要，可由材料包再生成，但删除前需确认 |
| 长期成品索引 | `data/library/index.json` | Electron 队列完成后更新 | 重要，用于 BV 去重和长期追踪 |
| UP 主视频注册表 | `data/registry/{up_id}.json` | Electron 合并 API 结果并读取给前端/后台 | 重要，删除后视频列表历史会丢失 |
| 灵犀索引 | `data/legacy/knowledge/knowledge_library.json` | Electron 遗留兼容读写 | 重要，删除前必须备份 |
| Electron Store | `C:\Users\Yu\AppData\Roaming\视界专注\shijie-focus-secure.json` | Electron Store 读写 | 非常重要，含设置和可能的秘密值 |
| Electron Store 备份 | 同目录 `shijie-focus-secure*.bak*` | 人工或历史脚本生成 | 保留，除非确认有新备份 |
| 窗口状态 | `C:\Users\Yu\AppData\Roaming\视界专注\.shijie-focus.window.json` | Electron 读写 | 可恢复，但不在本轮删除 |
| 运行日志 | `data/logs/runtime.log` | Electron 写入 | 排错用，清理前需确认 |
| TTS 缓存 | 默认在数据根目录 `.shijie-tts-cache` | TTS 模块读写 | 可再生，但可能含用户文本生成音频 |
| 音频/字幕缓存 | `data/cache` | Python 后端读写 | 可再生，但不随意删除 |
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
| MiMo API Key | 字幕清洗增强；后续 Summary Pipeline、TTS | Electron Store，经 `SHIJIE_MIMO_API_KEY` 等环境变量注入 | API 清洗、后续总结或 MiMo 朗读失败；无 Key 时部分清洗走规则模式 |
| Summary Pipeline 路由 | 遗留兼容路径，控制非主线编稿参数 | `SHIJIE_EDITORIAL_SUMMARY_MODE`、`SHIJIE_EDITORIAL_SUMMARY_MAX_DURATION_SECONDS`、`SHIJIE_EDITORIAL_SUMMARY_MAX_CONTENT_CHARS` | 当前 `subtitle_only` 队列不会进入该路径 |
| MiniMax TTS | 旧配置兼容字段，当前没有主线 IPC / UI 入口 | Electron Store | 不影响字幕清洗主线 |
| 本地 SenseVoice | 无字幕视频或本地音视频转写 | 设置中的本地转写根目录、Python 路径、模型和设备 | 无字幕材料无法转写 |
| SMTP 邮件 | 最近更新邮件通知；只发送 fresh 队列项的本地总结产物 | Electron Store；发送服务只读取必要 SMTP 字段，不写出授权码 | 未配置或发送失败不会影响字幕清洗和材料生成 |
| Obsidian 路径 | 旧配置兼容字段，当前 Obsidian IPC / CLI 已剪枝 | Electron Store | 不影响 NotebookLM 输出 |

不要在本文档写入真实密码或密钥值。

## 7. 风险区域

- `src/distiller.py`：大文件，承担字幕、音频、清洗、精读、缓存和写文件，修改前必须先加验收。
- `desktop/src/ui/pages/WorkspacePane.tsx`：页面状态和业务行为仍较集中，容易牵一发动全身。
- `desktop/electron/main.ts`：入口装配壳，连接所有关键能力。
- `desktop/electron/services/materialDeletion.ts`：会删除材料包、灵犀记录和阅读记录，必须重点保护。
- `desktop/electron/runtime/automationRuntime.ts`、`desktop/electron/queue/queueExecutor.ts`：可能影响后台自动制作和队列恢复。
- UP 主批量入队：当前已显式使用 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`；风险转为防止旧 UI 或旧兼容入口重新暴露 summary / email / TTS。
- `desktop/electron/runtime/runtimePaths.ts`、`runtimeStores.ts`、`runtimeLogger.ts`：负责项目根、数据根、设置文件、窗口状态和运行日志路径，修改会影响启动和数据位置。
- `data/materials`、`data/registry` 和 Electron Store：真实数据，不能用测试命令随意操作。
- `data/library/notebooklm/*/*.md`：当前用户最终资料，不能混入秘密值、调试日志、内部状态或复杂中间结果。

## 8. 架构边界

- 前端通过 `window.desktopAPI` 请求本地能力，不直接访问 Node.js 文件系统。
- 主进程负责真实文件读写、设置、队列、后台和子进程调用。
- Python 侧通过环境变量接收敏感配置，不从项目内 JSON 文件直接读取密钥。
- `data` 是当前运行数据根；`desktop/dist`、`desktop/dist-electron` 是构建产物，不作为核心源码维护。
- 删除真实材料包前必须通过路径安全检查，并在人工验收中覆盖。
- `data/materials/{up_id}/{video_id}` 是当前内部工作目录；完成后可以只保留轻量记录和成品引用。
- `data/library` 是长期成品库；它保存 NotebookLM 清洗稿和邮件稿最终 Markdown，并承担自动发现去重和档案打开路径。
- 字幕 Pipeline 是当前核心数据层；旧 Summary Pipeline 和 TTS 仍是暂停状态；最近更新邮件是独立通知层，只允许消费本地总结产物。
- 邮件通知层只能读取本地消费层产物，不能直接调用 MiMo、不能读取旧 `summary/`，也不能对历史补全自动群发。
- 开发模式下，`desktop/electron/runtimePaths.ts` 通过多个稳定标志探测项目根目录：`AGENTS.md`、`PRODUCT.md`、`ARCHITECTURE.md`、`src/distiller.py`、`desktop/package.json`。不再依赖 `PROJECT_CONTEXT.md`。
- `CoursePackage`、`lesson`、`quiz_question`、`standard_answer`、`quizzing` 等旧字段只允许作为兼容层存在，不应影响新的产品语言、制作流程或对外文件命名。
- 前端分层规则：`desktop/src/domain`、`desktop/src/services`、`desktop/src/state`、`desktop/src/legacy` 不应引用 `desktop/src/ui`。
- Electron 分层规则：`ipc` 只注册通信入口；`queue` 只处理队列；`providers` 只处理外部来源；`services` 只处理本地数据服务；`runtime` 只负责装配和运行时编排。

## 9. NotebookLM 清洗稿文件契约

第一版目标目录：

```text
data/library/notebooklm/{UP 主}/{视频标题}.md
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
- 已完成一次 `data` 根下的真实桌面端 subtitle-only 小样本；后续仍需持续积累不同来源和失败场景验收。
- 旧历史文档仍包含已退出路线，容易误导后续改造。
- 旧 `output/` 测试生成内容已删除；新生产格式已改为 `data/materials/{up_id}/{video_id}`。
- 当前主界面默认进入简洁首页；任务队列和 NotebookLM 输出保留为明确入口。旧专注、灵犀、档案消费代码已进入 `legacy` 兼容层，不再是主导航入口。
- `PROJECT_CONTEXT.md` 不再是流程页白名单或开发项目根探测依赖；原文件已归档到 `docs/history/legacy-md/PROJECT_CONTEXT.md`。
- 旧系统优化审计、旧视频编稿流程和旧聊天记录已归档到 `docs/history/legacy-md/`；日常技术事实以本文档和当前代码为准。

## 11. 最近核对

- 日期：2026-06-30
- 与当前代码是否一致：桌面端源码已迁移到清晰分层目录；生产输出统一到 `data/materials/{up_id}/{video_id}`，视频注册表统一到 `data/registry`，清空队列不再删除材料包；本地消费层已接在 subtitle-only 后置步骤，最近更新邮件通知只允许 `fresh` 队列项触发。

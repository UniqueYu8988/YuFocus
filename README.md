# 视界专注

**视界专注** 是一个本地优先的桌面学习工作台。它的核心不是聊天、判分或复刻视频，而是把视频和字幕整理成结构化学习笔记，再由 Codex Goal 离线生成可逐节阅读、可复查、可继续整理的知识树和章节思维导图。

当前项目路线已经从旧版 Groq / MiniMax 运行时教练，重构为：

```text
视频 / 字幕 / 本地音频转写
  -> 软件生成 .course_material 学习材料包
  -> Codex Goal 建立 synthesis_plan
  -> Codex Goal 生成 learning_notes.md + chapter_mindmap.md
  -> 只读审计
  -> 用户确认后进入学习台
  -> Electron 逐节阅读、回看和复习
```

运行时软件不依赖远程 AI 判卷，也不把用户卡在某一关。学习价值来自“材料整理 -> 知识树规划 -> 逐节学习笔记 -> 思维导图 -> 复习回看”。

## 当前能力

### 工作台

- 输入 B 站链接 / BV 号生成学习材料包。
- 支持本地音视频文件作为输入来源。
- 优先读取中文字幕；无字幕时调用本地音频转写。
- 生成结构化 `*.course_material`，包含 `authoring/` 学习笔记入口、schema 和只读审计工具。
- 整理记录按时间展示，可打开材料包、复制 Codex Goal 提示、查看章节思维导图和只读审计提示，并进入学习台。

### Codex 学习笔记链路

- Codex Goal 是主生产者：先建立知识树和覆盖层，再生成 `content_draft/learning_notes.md` 和 `content_draft/chapter_mindmap.md`。
- 章节思维导图是主产物之一，不是附属装饰。
- 只读审计窗口只检查学习笔记和思维导图，不重写内容。
- 新主线默认不再依赖 ChatGPT。
- Codex 窗口最多两个：一个主生产 Goal，一个只读审计 Goal；不要让多个窗口同时写同一组材料文件。

### 学习台

- 深色极简界面，保留类 Codex 的问答式学习体验。
- 左侧学习树展示章节与小节进度。
- 已解锁小节可主动回忆；未解锁小节仍可回看已整理的上下文。
- 每个小节展示学习笔记正文、主动回忆输入框、参考回看、关键点和常见误区。
- 不做实时 AI 判分，不阻塞继续学习。
- 支持 TTS 朗读、预热本节、预热本章。
- 支持打开 Obsidian 笔记和同步学习笔记。

### 章节思维导图

现在的地图不是旧式大图，而是学习笔记的章节思维导图：

- Codex 会同时生成 `learning_notes.md` 和 `chapter_mindmap.md`。
- 章节思维导图可以是分层标题、Mermaid mindmap 或清晰的结构图。
- 软件会把它当成可直接发送到学习台对话流的图文消息，而不是额外负担。

### TTS

- 支持 MiniMax Speech 2.8。
- 支持 Xiaomi MiMo TTS。
- MiMo 方向已作为主要实验通道，支持预置音色试听与选择。
- 本节音频已缓存时，学习提交后可播放参考回看内容。

### Obsidian

Obsidian 同步作为独立导出/存档能力保留：

- 不进入主学习流。
- 支持学习笔记导出。
- 提供 CSS 样式增强，使笔记更接近学习档案阅读体验。

## 项目结构

```text
视界专注/
  desktop/                  Electron + React 桌面端
  src/                      Python 本地素材、转写、原材料包和总结打包工具
  docs/
    prompts/                Codex 学习笔记提示词和审计提示词
  output/                   本地运行输出，已被 .gitignore 忽略
    materials/              *.course_material 原材料包
    cache/                  字幕、音频、转写缓存
```

## 关键文件

```text
desktop/electron/main.ts                       Electron 主进程、文件系统、设置、Python 桥接
desktop/electron/preload.ts                    Renderer 可调用的桌面 API
desktop/src/components/WorkspacePane.tsx       工作台、材料整理、整理记录
desktop/src/components/CoachPane.tsx           学习台主界面
desktop/src/components/CoachChatTimeline.tsx   学习笔记正文和主动回忆后的内容渲染
desktop/src/components/CoachComposer.tsx       主动回忆输入框
desktop/src/components/MarkdownRenderer.tsx    Markdown / 表格 / Mermaid 等内容渲染
desktop/src/components/CourseVisualMapDialog.tsx 全局学习地图展示
desktop/src/store.ts                           学习状态、学习包导入和进度记录

src/bilibili_api.py                            B 站视频信息与字幕抓取
src/audio_fallback.py                          无字幕音频兜底转写
src/local_audio_client.py                      本地转写桥接
src/distiller.py                               原材料包生成器
src/validate_content_synthesis_plan.py         学习笔记计划校验

src/schemas/content_synthesis_plan.schema.json  学习笔记工作计划合约
docs/prompts/codex-goal-content-synthesis-v8.md Codex Goal 学习笔记提示词
docs/prompts/readonly-synthesis-audit.md        只读学习笔记审计提示词
docs/content-synthesis-authoring.md             学习笔记作者手册
PROJECT_CONTEXT.md                              项目长期上下文和方向护栏
```

新主线只认 `*.course_material` 和新提示词入口；旧 JSON 学习包只作为学习台内部兼容层，不作为新的生产流程。

## 推荐整理流程

1. 打开桌面端工作台。
2. 输入 B 站链接 / BV 号，或选择本地音视频。
3. 生成 `*.course_material`。
4. 点击“开始整理”，复制 Codex Goal 提示词到新的 Codex Goal 对话。
5. Codex 先建立知识树和覆盖层，再生成 `content_draft/learning_notes.md` 和 `content_draft/chapter_mindmap.md`。
6. 审核学习笔记和章节思维导图；通过后点击“开始学习”。
7. 可选：点击“审计”，第二个 Codex 窗口复制 `authoring/03_readonly_synthesis_audit.md` 做只读审计，报告写入 `content_draft/review_exports/latest-readonly-audit.md`。
8. 需要时直接在工作台打开知识稿、章节地图和审计报告。

## 本地运行

安装桌面端依赖：

```powershell
cd C:\Users\Yu\AI\视界专注\desktop
npm install
```

启动开发服务器：

```powershell
npm run dev
```

构建前端和 Electron 入口：

```powershell
npm run build:web
```

打包便携版：

```powershell
npm run build:portable
```

## Python 检查

改动 Python 文件后建议运行：

```powershell
cd C:\Users\Yu\AI\视界专注
python -m py_compile src\bilibili_api.py src\audio_fallback.py src\local_audio_client.py src\distiller.py src\validate_content_synthesis_plan.py
```

校验 schema：

```powershell
python src\validate_content_synthesis_plan.py "<course_material_dir>\content_draft\synthesis_plan.json"
```

## 本地文件与隐私

运行输出默认放在：

```text
C:\Users\Yu\AI\视界专注\output
```

该目录被 `.gitignore` 忽略，里面可能包含字幕、音频缓存、转写文本、学习笔记和本地配置，不应提交到 GitHub。

本地设置文件也会被忽略：

```text
.shijie-focus.local.json
.shijie-focus.window.json
.onboard-tts-cache/
```

## 设计原则

- 本地优先。
- 软件轻量，主流程清晰。
- 视频只是知识范围，不是知识稿正文。
- 字幕/转写文本只作为材料，不直接暴露给阅读界面。
- Codex Goal 负责学习笔记计划、知识稿、章节地图和审稿配合。
- Electron 负责稳定展示、搜索、进度记录和增强功能。
- 运行时不依赖 Groq / MiniMax / 远程 API 判分。
- TTS、Obsidian 和章节地图都是增强能力，不应污染主阅读流。

## 当前下一步

- 用一条新视频完整测试“原材料包 -> Codex 学习笔记 -> 章节地图 -> 只读审计 -> 入库”。
- 继续评估章节地图是否应长期采用 Mermaid、分层标题还是图片导图。
- 优化知识稿的展示块，让软件成为更开放的学习笔记阅读器，而不是固定模板展示器。
- 继续观察 Codex 分轮整理中的信息差、提示词负担和学科适配问题。

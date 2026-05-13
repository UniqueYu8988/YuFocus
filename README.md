# 视界专注

**视界专注** 是一个本地优先的桌面学习工作台。它的核心不是聊天、判分或复刻视频，而是把视频和字幕整理成高质量课程制作材料，再由 AI 离线生成可直接学习的 Course Package。

当前项目路线已经从旧版 Groq / MiniMax 运行时教练，重构为：

```text
视频 / 字幕 / 本地音频转写
  -> 软件生成 course_material 原材料包
  -> ChatGPT 担任课程总设计师，输出 course_blueprint.json
  -> Codex 按蓝图和本地材料执行制课、审稿、strict 打包
  -> Electron 学习台导入课程包，进行主动回忆式学习
```

运行时软件不依赖远程 AI 判卷，也不把用户卡在某一关。学习价值来自“先学习 -> 主动回忆 -> 对照标准答案和关键点 -> 继续推进”。

## 当前能力

### 工作台

- 输入 B 站链接 / BV 号生成课程原材料包。
- 支持本地音视频文件作为输入来源。
- 优先读取中文字幕；无字幕时调用本地音频转写。
- 生成结构化 `*.course_material`，包含 GPT 设计工作区、Codex 制课入口、schema 和打包工具。
- 支持独立的视频总结功能，复用本地字幕/转写能力，不污染课程制作主链路。
- 制作记录按时间展示，可打开材料包、复制 GPT/Codex 提示词、导入最终课包、绑定全局学习地图。

### GPT + Codex 制课链路

- ChatGPT 负责课程总设计：理解完整材料、判断课程类型、设计学习路径、输出 `course_blueprint.json`。
- Codex 负责工程执行：读取本地材料和蓝图，生成 lessons，运行质量检查，输出 `final.course-package.json`。
- Codex skill `shijie-course-builder` 已用于固化视界专注制课规则，减少每次复制长提示词的负担。
- 课程质量规则强调内容密度、结构合理和学科适配，不再机械追求统一字数。

### 学习台

- 深色极简界面，保留类 Codex 的问答式学习体验。
- 左侧课程树展示章节与小节进度。
- 已解锁课程可答题；未解锁课程可浏览，但不能答题。
- 每节课展示教学内容、主动回忆输入框、标准答案、关键点和常见误区。
- 不做实时 AI 判分，不阻塞继续学习。
- 支持 TTS 朗读、预热本节、预热本章。
- 支持打开 Obsidian 笔记和同步课程笔记。

### 全局学习地图

目前已经加入 `course_visual_map` 工作流：

- GPT 蓝图阶段设计整门课的全局学习地图提示词。
- Codex 打包时保留 `course_visual_map`。
- 工作台可复制图片生成提示词。
- 用户用 ChatGPT Image 等图像模型生成一张 16:9 全局学习地图。
- 软件可将图片绑定回课包，并在学习台右上角打开。

图片会复制到课包旁边：

```text
*.assets/maps/global-course-map.*
```

课包中记录：

```json
{
  "course_visual_map": {
    "kind": "image",
    "status": "attached",
    "uri": "...",
    "alt": "...",
    "prompt": "..."
  }
}
```

### TTS

- 支持 MiniMax Speech 2.8。
- 支持 Xiaomi MiMo TTS。
- MiMo 方向已作为主要实验通道，支持预置音色试听与选择。
- 本节音频已缓存时，学习提交后可播放标准答案。

### Obsidian

Obsidian 同步作为独立导出/存档能力保留：

- 不进入主学习流。
- 支持课程笔记导出。
- 提供 CSS 样式增强，使笔记更接近课程阅读体验。

## 项目结构

```text
视界专注/
  desktop/                  Electron + React 桌面端
  src/                      Python 本地素材、转写、原材料包和制课打包工具
  docs/
    course-design/          课程设计链路和展示块设计
    prompts/                GPT / Codex 制课提示词
  output/                   本地运行输出，已被 .gitignore 忽略
    materials/              *.course_material 原材料包
    courses/                可导入的最终课程包
    cache/                  字幕、音频、转写缓存
```

## 关键文件

```text
desktop/electron/main.ts                       Electron 主进程、文件系统、设置、Python 桥接
desktop/electron/preload.ts                    Renderer 可调用的桌面 API
desktop/src/components/WorkspacePane.tsx       工作台、课程制作、视频总结、制作记录
desktop/src/components/CoachPane.tsx           学习台主界面
desktop/src/components/CoachChatTimeline.tsx   课程正文和回答后的内容渲染
desktop/src/components/CoachComposer.tsx       主动回忆输入框
desktop/src/components/MarkdownRenderer.tsx    Markdown / 表格 / Mermaid 等内容渲染
desktop/src/components/CourseVisualMapDialog.tsx 全局学习地图展示
desktop/src/store.ts                           学习状态、课程导入和进度记录

src/bilibili_api.py                            B 站视频信息与字幕抓取
src/audio_fallback.py                          无字幕音频兜底转写
src/local_audio_client.py                      本地转写桥接
src/distiller.py                               原材料包生成器
src/codex_course_packager.py                   课程草稿 strict 打包和发布
src/course_quality_audit.py                    课程质量检查
src/coverage_audit.py                          蓝图/材料覆盖审计

src/schemas/course_blueprint.schema.json       GPT 课程蓝图合约
src/schemas/course_package.schema.json         最终 Course Package 合约
docs/prompts/chatgpt-course-designer-v1.md     GPT 总设计师提示词
docs/prompts/codex-blueprint-executor-v1.md    Codex 蓝图执行提示词
```

## 推荐制课流程

1. 打开桌面端工作台。
2. 输入 B 站链接 / BV 号，或选择本地音视频。
3. 生成 `*.course_material`。
4. 点击 GPT 按钮，打开材料包里的 `gpt_course_design_workspace.zip` 并复制提示词。
5. 在 ChatGPT 新对话上传 zip，生成 `course_blueprint.json`。
6. 将 `course_blueprint.json` 放回材料包根目录。
7. 点击 Codex 按钮，复制制课提示词到新 Codex 对话。
8. Codex 生成并 strict 打包课程。
9. 回到软件导入最终课包。
10. 如需全局地图，点击“地图”复制图片提示词，用图像模型生成图片，再点击“导图”绑定回课包。

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
python -m py_compile src\bilibili_api.py src\audio_fallback.py src\local_audio_client.py src\distiller.py src\codex_course_packager.py src\course_quality_audit.py src\coverage_audit.py
```

校验 schema：

```powershell
python src\validate_course_blueprint.py --help
python src\codex_course_packager.py "<course_material_dir>" --strict
```

## 本地文件与隐私

运行输出默认放在：

```text
C:\Users\Yu\AI\视界专注\output
```

该目录被 `.gitignore` 忽略，里面可能包含字幕、音频缓存、转写文本、课程包和本地配置，不应提交到 GitHub。

本地设置文件也会被忽略：

```text
.shijie-focus.local.json
.shijie-focus.window.json
.onboard-tts-cache/
```

## 设计原则

- 本地优先。
- 软件轻量，主流程清晰。
- 视频只是知识范围，不是课程正文。
- 字幕/转写文本只作为材料，不直接暴露给学生端。
- GPT 负责课程蓝图和学习设计。
- Codex 负责本地制课执行、审稿和打包。
- Electron 负责稳定展示、主动回忆、进度记录和增强功能。
- 运行时不依赖 Groq / MiniMax / 远程 API 判分。
- TTS、Obsidian、全局地图、视频总结都是增强能力，不应污染主学习流。

## 当前下一步

- 用一条新视频完整测试“原材料包 -> GPT 蓝图 -> Codex skill 制课 -> 软件导入 -> 全局学习地图绑定”。
- 继续评估全局学习地图是否应长期采用“整门课一张 AI 生成大图”的方案。
- 优化 Course Package 的展示块，让软件成为更开放的课程内容渲染器，而不是固定模板展示器。
- 继续观察 GPT / Codex 交接中的信息差、提示词负担和学科适配问题。

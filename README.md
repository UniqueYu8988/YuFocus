# 视界专注

视界专注是一个本地优先的桌面学习工作台。它不再把运行时 AI 教练当作核心，也不再依赖 Groq / MiniMax 来直接生成最终课程。

当前主流程是：

1. 输入 B 站链接 / BV 号，或选择本地音视频文件。
2. 优先抓取中文字幕；没有字幕时调用本地 SenseVoice 转写。
3. 清洗、分块并生成 Codex 友好的原材料包。
4. 在新的 Codex 对话中复制材料包自带的短提示，基于原材料包制作 Course Package JSON。
5. 运行 strict 打包器，最终课包会写入材料包并自动发布到 `output/courses`。
6. 将最终课包导入桌面端学习台。
7. 学习台按小节展示讲解、主动回忆输入框、标准答案和下一节推进。

## 目录

```text
视界专注/
  desktop/                 Electron + React 桌面端
  src/                     Python 本地素材与原材料包流水线
  output/
    materials/             Codex 原材料包
    courses/               可直接导入的最终课包
    cache/                 字幕、音频、转写缓存
  docs/codex-course-authoring.md
```

## 关键模块

- `src/bilibili_api.py`：B 站视频信息与字幕抓取。
- `src/audio_fallback.py`：无字幕时的音频下载、切片、本地转写兜底。
- `src/distiller.py`：本地原材料包生成器。
- `src/codex_course_packager.py`：Codex 制作后的课程草稿严格打包、质量检查和最终课包发布。
- `desktop/electron/main.ts`：桌面主进程、设置、文件导入、Python 子进程桥接。
- `desktop/src/components/WorkspacePane.tsx`：课程制作工作台、课程中心、设置面板。
- `desktop/src/components/CoachPane.tsx`：轻量学习台。

## 输出文件

正式输出目录固定为：

```text
C:\Users\Yu\AI\视界专注\output
```

其中：

- `materials` 保存可复用的 `*.course_material`。
- `courses` 保存打包器自动发布、可直接导入的最终课包。
- `cache` 保存可删除、可重建的运行缓存。

## Codex 制课

每份 `*.course_material` 都会自带：

- `START_HERE.md`：新 Codex 对话的入口。
- `codex_tasks/00_new_window_prompt.md`：可直接复制的短提示。
- `codex_tasks/01-09_*.md`：大纲、分节生成、审稿、打包和质量升级任务。

新 Codex 对话完成课程草稿后，在项目根目录运行：

```powershell
python src\codex_course_packager.py "<course_material_dir>" --strict
```

该命令会生成 `course_draft/final.course-package.json`，并自动复制到 `output/courses`。

## 本地运行

```powershell
cd C:\Users\Yu\AI\视界专注\desktop
npm install
npm run dev
```

## 构建检查

前端构建：

```powershell
cd C:\Users\Yu\AI\视界专注\desktop
npm run build:web
```

Python 编译检查：

```powershell
cd C:\Users\Yu\AI\视界专注
python -m py_compile src\config.py src\bilibili_api.py src\audio_fallback.py src\distiller.py
```

## 设计原则

- 本地优先。
- 运行时不依赖远程 API 判分。
- 软件只负责素材整理、课包导入、学习展示和进度记录。
- Codex 负责离线课程设计和课包质量升级。
- Obsidian、TTS 等能力是独立增强功能，不污染主学习流。

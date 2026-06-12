# 视界专注

视界专注是一个本地优先的视频资料处理与阅读工具。

当前产品只围绕两条主线：

1. 长视频 / 本地视频：提取字幕或转写音频，清洗成可读文本，并导出 NotebookLM 可导入资料。
2. 短视频：在字幕清洗后调用 MiMo API 自动生成视频精读稿，并进入专注、档案与灵犀归档阅读。

旧的 Codex Goal 深写、知识树学习包、验证器和课程打包路线已经退出默认生产链路。相关历史只保留在纪念或兼容文档中，不再作为制作按钮、材料包结构或用户流程出现。

## 当前流程

### 长视频与本地视频

输入 B 站 BV / 链接，或选择本地音视频文件。

软件会完成：

- 获取视频基础信息。
- 优先读取字幕；缺字幕时使用本地 SenseVoice 转写。
- 清洗字幕，生成正文资料。
- 写出 NotebookLM 导入文件。

主要产物在 `.course_material` 目录内：

```text
raw_transcript.txt
content.md
exports/notebooklm.md
indexes/source_index.jsonl
summary/article.md       # 短视频精读稿存在时生成
summary/article.html     # 短视频精读稿存在时生成
summary/summary_status.json
metrics.json             # 制作耗时、token 汇总和产物规模
manifest.json
run_state.json
HANDOFF.md
```

### 短视频精读

短视频不再复制提示词到 Codex 制作。制作页会在字幕清洗完成后，通过 MiMo 文稿模型生成：

- `summary/article.md`
- `summary/article.html`
- `summary/cards.json`
- `summary/review.json`
- `summary/summary_status.json`

这些文件用于专注阅读、灵犀归档、未来邮件推送与其他导出通道。

### 后台与推送

桌面端预留后台自动化框架：

- 关闭窗口后驻留托盘。
- 主进程维护定时检查、暂停恢复和立即检查。
- 定时检查和手动检查共用同一套机制：只发现收藏来源最近 24 小时内的新视频。
- 同一 BV 全局去重，已经入队或已经生成资料的视频不会重复制作。
- 任务队列由主进程顺序处理，窗口关闭后也能继续清洗字幕和生成短视频精读稿。
- 已有清洗稿或精读稿时按阶段复用，不重复消耗字幕处理或 MiMo 文稿资源。
- 新生成资料会写入 `metrics.json`，用于统计字幕清洗、API 编稿、产物字数、文件大小和 token 消耗。
- 设置中配置 SMTP 邮件推送参数。
- 邮件服务已支持真实 SMTP 发送，并优先使用浅色 HTML 正文与纯文本兜底。

未来稳定形态是：收藏来源发布新视频后，软件自动清洗字幕、生成短视频精读稿，并按日报或批次推送到邮箱。

## 桌面端

```powershell
cd desktop
npm install
npm run dev
```

构建前检查：

```powershell
npx tsc --noEmit
npm run build:web
```

后端语法检查：

```powershell
python -m py_compile src\bilibili_api.py src\audio_fallback.py src\local_audio_client.py src\distiller.py src\validate_content_synthesis_plan.py
```

## 配置

桌面端设置中配置：

- B 站 SESSDATA：读取关注源、最近视频和字幕。
- MiMo API Key：短视频精读稿与后续文本处理。
- MiMo 文稿模型：默认 `mimo-v2.5-pro`。
- MiMo TTS / MiniMax TTS：保留朗读能力。
- 本地转写环境：用于无字幕视频或本地音视频。
- 后台定时与 SMTP：用于未来自动检查和邮件推送。

## 项目边界

默认产品语言使用：

- 制作
- 视频来源
- 任务队列
- 专注
- 档案
- 灵犀
- 清洗稿
- 精读稿
- NotebookLM 导入资料

旧的 `CoursePackage`、`lesson`、`quiz_question`、`standard_answer` 等字段只作为专注页内部兼容层存在，不代表当前产品方向。

不要恢复旧课程制作、答题验收、Codex Goal 制作学习包或 course-package 主生产流程。

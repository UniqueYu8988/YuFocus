# 视界专注 Codex 制课工作流

## 目标

视界专注只负责把视频、字幕或本地音视频转成 Codex 友好的 `*.course_material` 原材料包。课程质量由新的 Codex 制课对话完成。最终交付物是一个可以直接导入学习台的 `*.course-package.json`。

## 用户流程

1. 在软件的课程制作工作台输入 B 站链接、BV 号，或选择本地音视频。
2. 软件生成原材料包到 `output/materials/<title>.course_material/`。
3. 点击“复制制课提示”，新开一个 Codex 对话后直接粘贴。
4. 新 Codex 对话读取 `START_HERE.md`，按 `codex_tasks/` 制作大纲和 lessons。
5. 新 Codex 对话运行 strict 打包命令。
6. 打包器生成 `course_draft/final.course-package.json`，并自动复制到 `output/courses/`。
7. 回到软件，在制作记录里点击导入，或从 `output/courses/` 导入。

## 新对话最短提示

```text
请读取并执行这份视界专注材料包的 START_HERE.md：<START_HERE.md 路径>
目标：生成可直接导入视界专注学习台的 Course Package JSON。
要求：先设计教学大纲，再分批生成 lesson，最后 strict 打包；不要把字幕证据、原材料分析或制课过程写进学生端正文。
边界：辅助脚本只能放在本材料包的 course_draft/tools/ 或系统临时目录；最终汇报必须用中文，不要输出英文内部备注或自我提醒。
```

## 制课原则

- 不一次性读取 `raw_transcript.txt`。
- 先读 `manifest.json` 和 `indexes/`，设计课程总大纲。
- 每次只回读 1-3 个 `blocks/block_XXX.json`，生成 1-3 节 lesson。
- 字幕只限定知识范围，不限定课程质量上限。
- 学生端只显示 `teacher_ready_content`。
- `source_refs` 只做隐藏来源追溯，不进入学生端正文。
- 课程正文要像老师直接讲课，不像材料整理说明。
- 课程类型必须动态判断：概念课、操作课、工具配置课、考试课、病例分析课、策略课不能套同一个模板。
- 辅助脚本只能放在材料包的 `course_draft/tools/` 或系统临时目录，不能写到项目外的随手目录。
- 最终回复必须中文简洁，只列出路径、质量分数、lesson 数和剩余风险，不输出英文内部备注或 Markdown 路径格式自检。

## 打包命令

在项目根目录运行：

```powershell
python src\codex_course_packager.py "<course_material_dir>" --strict
```

默认输出：

- `<course_material_dir>/course_draft/final.course-package.json`
- `<course_material_dir>/course_draft/final.course-package.quality-report.json`
- `output/courses/<course title>.course-package.json`
- `output/courses/<course title>.course-package.quality-report.json`

如只想留在材料包目录内，可以加 `--no-publish`。

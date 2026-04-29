# 课包制作检查清单

## 制作前

- 只处理一个 `*.course_material` 目录。
- 先读 `START_HERE.md`、`manifest.json` 和 `indexes/`。
- 不一次性读取 `raw_transcript.txt`。
- 先判断课程类型，并给每节 lesson 标注 `lesson_profile`：`concept`、`operation`、`tool_config`、`exam`、`case_analysis`、`strategy` 或 `mixed`。
- 大纲阶段只做课程结构，不写完整课文。

## 大纲检查

- 每章有清晰学习目的。
- 每个 lesson 只解决一个核心目标。
- 每个 lesson 有 `source_block_ids`。
- 章节顺序符合从基础到应用的难度曲线。
- 没有把 block 摘要直接当课程标题。

## Lesson 检查

- `teacher_ready_content.teaching_markdown` 是直接教学，不是材料说明。
- `teacher_ready_content.lesson_profile` 与内容匹配，不把所有课都写成考试训练。
- `teaching_markdown` 建议 800-1500 字；简单动作课可以略短，但不能只有提纲。
- 有主动回忆题 `quiz_question`。
- 有可对照的 `standard_answer`，建议 140-300 字。
- `key_points` 至少 4 条，能帮助学生快速发现漏点。
- `common_mistakes` 至少 3 条，是具体错误，不是泛泛提醒。
- 概念课有例子、场景、反例或迁移应用。
- 操作课有明确顺序、关键动作、完成标准、漏步风险；缺少画面时要用文字补足可观察细节。
- 工具配置课有前置条件、配置步骤、命令/路径/参数、验证和排错。
- 考试课有评分点、扣分点、答题表达和易混点。
- 病例/案例课有线索识别、判断路径、分支条件和处理方案。
- 所有口诀、缩写、顺口溜和编号法都已逐项展开。
- 150 字以上的解释段已拆成项目符号或短段，不让学生在学习台里读整块长文。
- 核心名词、关键概念、关键参数已少量使用 `**加粗**`；判断标准、操作红线或易混关键句可少量使用 `<u>下划线</u>`。
- 没有整段加粗、满屏下划线，视觉重点不喧宾夺主。
- `source_refs` 有 block 来源，但学生端正文不暴露来源证据。

## 学生端禁词

学生端正文不能出现：

```text
视频给出的范围
视频范围
字幕证据
字幕原文
素材证据
原材料
材料中
材料覆盖
source
evidence
block
debug
我会把
补成一节课
这一关信息量偏高
```

## 打包检查

运行：

```powershell
python src\codex_course_packager.py "<course_material_dir>" --strict
```

通过标准：

- 生成 `course_draft/final.course-package.json`。
- 生成 `course_draft/final.course-package.quality-report.json`。
- 质量报告没有 error。
- 如果质量报告出现大量 `teaching_below_density_target`，说明课程只是可用 MVP，还需要扩写。
- 学习台导入后首屏直接显示教学正文。
- 提交回答后只展示标准答案、关键点和常见误区。

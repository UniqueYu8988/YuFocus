# Codex 制课手册

这份手册用于每次新开一个 Codex 对话制作单个课程包。软件负责提供原材料包和播放课包；Codex 负责把视频材料限定的知识范围升级成可学习课程。

## 核心目标

最终交付物只有一个：

```text
course_draft/final.course-package.json
```

这个文件导入“视界专注”后，学生应该能直接学习，而不是看到材料分析、字幕证据或制课过程说明。

## 工作入口

新对话只处理一个 `*.course_material` 目录。先读：

```text
START_HERE.md
manifest.json
indexes/global_outline.json
indexes/concept_index.json
indexes/timeline_index.json
codex_tasks/00_new_window_prompt.md
```

不要一开始读取 `raw_transcript.txt`。大文本由文件系统承载长期记忆，Codex 只按任务回读相关 blocks。

## 两阶段制作

第一阶段：设计教学大纲。

输出 `course_draft/outline.draft.json`。这一步只确定课程目标、章节顺序、lesson 划分和每节课需要回读的 `source_block_ids`。

第二阶段：分批写课程。

每次只处理 1-3 个 lesson，只回读相关 1-3 个 blocks。每个 lesson 都要写完整 `teacher_ready_content`，包括讲解正文、主动回忆题、标准答案、关键点和常见误区。

## 内容密度目标

结构合格不等于课程好用。每节 lesson 的建议密度：

- `teaching_markdown`：800-1500 字。特别简单的动作课可以更短，但不能只写成提纲。
- `standard_answer`：140-300 字，要像学生对照答案，不是一句结论。
- `key_points`：至少 4 条。
- `common_mistakes`：至少 3 条，必须具体到误解、漏步、判断错误或使用场景。
- 按课型补齐最有学习价值的信息：概念课重例子和误区，操作/配置课重步骤、检查和排错，考试课重评分点和答题表达。
- 操作/配置课不要为了讲“为什么”牺牲步骤细节；缺少画面时，要用文字补足顺序、部位、按钮、命令、验证方法和失败处理。
- 如果出现口诀、缩写、顺口溜或编号法，必须逐项展开，不允许只写口诀。例如“内、外、夹、弓、大、立、腕”必须解释成掌心、手背、指缝、指背、拇指、指尖和腕部。
- 避免 150 字以上的大段落。较长解释请拆成短句列表，尤其是标准答案、理由链、例子场景和排错提示。
- 可以少量使用 `**加粗**` 标出关键名词、核心概念、关键参数；用 `<u>下划线</u>` 标出判断标准、操作红线或最容易混淆的关键句。每段通常 1-3 处，不要把整段都标成重点。

## 课程类型判断

不要把所有课都写成考试训练。每个 lesson 建议在 `teacher_ready_content.lesson_profile` 写一个课型：

| lesson_profile | 适合内容 | 优先补强 |
| --- | --- | --- |
| `concept` | 通识、新领域入门、原理课 | 核心概念、因果关系、例子、误区、迁移应用 |
| `operation` | 医学操作、实验、手工流程、演示课 | 标准步骤、关键细节、完成标准、漏步风险、文字化视觉细节 |
| `tool_config` | 网络配置、开发环境、OpenClaw、软件使用 | 前置条件、配置步骤、命令/路径/参数、验证、排错和恢复 |
| `exam` | 纯考试、答题模板、评分训练 | 评分点、扣分点、答题表达、易混题型 |
| `case_analysis` | 病例、故障案例、业务案例 | 线索识别、判断路径、分支条件、处理方案 |
| `strategy` | 学习方法、规划、复盘策略 | 使用场景、执行流程、检查清单、迁移方式 |
| `mixed` | 跨类型内容 | 只选择真正有用的模块，不强行凑固定标题 |

## 学生端内容标准

`teacher_ready_content.teaching_markdown` 必须像老师直接讲课。推荐结构按课程类型变化，不要强行凑不适合的模块。

正文允许少量视觉重点，但重点必须“少而准”：核心名词用 `**加粗**`，关键判断句用 `<u>下划线</u>`。强调只帮助阅读层级，不能代替解释，也不能把页面变成满屏重点。

不要在正文里手动添加全角空格做首行缩进。学习台会自动给普通段落做阅读式首行缩进，Codex 只需要写干净 Markdown。

操作/医学演示课优先使用：

```markdown
## 这一关要学会什么

## 标准操作步骤

## 关键细节

## 检查清单

## 常见错误

## 一句话记忆
```

考试导向的操作课可以继续补：

```markdown
## 现场怎么判断

## 容易被扣分的细节

## 和相似项目的区别
```

医学操作课里的口诀必须展开成具体动作。学生真正需要记住的往往不是口诀本身，而是口诀每个字对应的部位、动作、评分点和漏项风险。

概念/新领域入门课可以使用：

```markdown
## 核心概念

## 关键关系

## 应用场景

## 常见误区
```

通识/新领域入门课如果内容较薄，可以继续补：

```markdown
## 反例或边界

## 可以迁移到哪里

## 自查问题
```

工具配置课可以使用：

```markdown
## 这一关要学会什么

## 前置条件

## 配置步骤

## 验证与排错

## 常见错误

## 一句话记忆
```

## 禁止出现在学生端

这些词和句式只能出现在制作笔记或 `source_refs`，不能进入 `teacher_ready_content`：

- 视频给出的范围
- 字幕证据
- 原材料
- 材料中
- source / evidence / block / debug
- 我会把它补成一节课
- 这一关信息量偏高
- 这关材料比较薄
- 证据链

## 完成后命令

在项目根目录运行：

```powershell
python src\codex_course_packager.py "<course_material_dir>" --strict
```

如果通过，会生成：

```text
course_draft/final.course-package.json
course_draft/final.course-package.quality-report.json
```

`final.course-package.json` 就是给软件导入的文件。

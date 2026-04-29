# 课包质量升级提示词

当一个课包已经能导入学习台，但审计报告出现大量 `info` 时，用这份提示开启新 Codex 对话做二次升级。

```text
请对这份已经生成的“视界专注”课程包做质量升级，不要推翻现有章节结构：

<course_material_dir>

请先读：
1. course_draft/final.course-package.json
2. course_draft/final.course-package.quality-report.json
3. desktop/docs/codex-course-authoring-handbook.md
4. desktop/docs/course-making-checklist.md

目标：
- 保持原来的 章节数、lesson_ids 和 source_refs。
- 逐节扩写 teacher_ready_content，不重写素材整理层。
- 先给每节补/校准 `teacher_ready_content.lesson_profile`：concept、operation、tool_config、exam、case_analysis、strategy 或 mixed。
- 每节 teaching_markdown 尽量达到 800-1500 字。
- 每节 standard_answer 达到 140-300 字。
- key_points 至少 4 条。
- common_mistakes 至少 3 条。
- 按 lesson_profile 补强内容，不要把所有课写成同一种模板。
- concept：补核心概念、因果关系、例子、误区和迁移应用。
- operation：补标准步骤、关键动作、完成标准、漏步风险；缺少画面时用文字补足可观察细节。
- tool_config：补前置条件、配置步骤、命令/路径/参数、验证、排错和恢复。
- exam：补评分点、扣分点、答题表达和易混点。
- case_analysis：补线索识别、判断路径、分支条件和处理方案。
- 遇到口诀、缩写、顺口溜或编号法，必须逐项展开。比如“内、外、夹、弓、大、立、腕”要展开为掌心、手背、指缝、指背、拇指、指尖和腕部，并说明容易漏哪一步。
- 把 150 字以上的大段解释拆成项目符号或短段。标准答案也尽量一句一行，便于学生对照记忆。
- 给 `teaching_markdown` 增加少量视觉重点：核心名词、关键概念、关键参数用 `**加粗**`；判断标准、操作红线、易混淆关键句用 `<u>下划线</u>`。每段通常 1-3 处，禁止整段加粗或满屏下划线。
- 学生端正文仍然不能出现“视频范围、字幕证据、原材料、材料中、source、block、debug”等词。

工作方式：
1. 先读取质量报告，列出需要升级的 lesson。
2. 每次只处理 1-3 个 lesson。
3. 必要时回读对应 source_refs 指向的 blocks。
4. 直接修改 course_draft/lessons/lesson_XXX.json。
5. 最后运行：
   python src\codex_course_packager.py "<course_material_dir>" --strict

交付：
- 更新后的 course_draft/lessons/lesson_XXX.json。
- 更新后的 course_draft/final.course-package.json。
- 新的 quality-report，要求 auditErrors 为 0，并尽量降低 info 数量。
```

注意：这一步是“扩写和提纯”，不是重新分章。不要改 course_id、lesson_id、章节顺序，避免用户学习记录失效。

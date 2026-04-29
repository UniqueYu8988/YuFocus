# Codex Course Making Workflow

这个流程用于“新开一个 Codex 对话，专门制作一个课程包”。软件只负责材料整理和课包播放；Codex 负责课程设计。

配套文件：

- `desktop/docs/codex-course-authoring-handbook.md`：完整制课手册。
- `desktop/docs/codex-course-draft-templates.md`：大纲和 lesson 草稿模板。
- `desktop/docs/course-making-checklist.md`：制作前、审稿、打包检查清单。

## 目录输入

Codex 新窗口只需要拿到一个 `*.course_material` 目录：

```text
course_material/
  manifest.json
  START_HERE.md
  raw_transcript.txt
  blocks/
  indexes/
  codex_tasks/
  course_draft/
    outline.draft.json
    lessons/
```

先读 `START_HERE.md`、`manifest.json`、`indexes/global_outline.json`，不要一上来读完整 `raw_transcript.txt`。

如果材料包里有 `codex_tasks/06_authoring_handbook.md`、`07_draft_templates.md`、`08_final_delivery_checklist.md`，优先按这些文件执行；它们是随材料包自动生成的制课工作说明。

## 两步生成

第一步：生成 `course_draft/outline.draft.json`

```json
{
  "course": {
    "title": "课程名",
    "subtitle": "可选副标题",
    "overall_goal": "学完后能做什么",
    "target_audience": "适合谁",
    "learning_outcomes": ["结果 1", "结果 2"],
    "completion_definition": "完成标准"
  },
  "chapters": [
    {
      "id": "chapter_01",
      "title": "第一章",
      "summary": "这一章解决什么问题",
      "lesson_ids": ["lesson_001", "lesson_002"]
    }
  ]
}
```

第二步：分批生成 `course_draft/lessons/lesson_XXX.json`

每次只读相关 1-3 个 blocks，每个 lesson 文件保持小而完整。

内容密度建议：

- `teaching_markdown`：800-1500 字，简单动作课可以略短，但不能只有提纲。
- `standard_answer`：140-300 字。
- `key_points`：至少 4 条。
- `common_mistakes`：至少 3 条。
- 每节至少有一个例子/场景/应用/反例，一段理由链，一个检查/排错/对比/迁移提示。
- 150 字以上的解释要拆成项目符号或短段，标准答案尽量一句一行。
- 视觉重点要少而准：核心名词、关键概念、关键参数用 `**加粗**`；判断标准、操作红线、易混关键句可用 `<u>下划线</u>`。不要整段加粗或满屏下划线。

```json
{
  "id": "lesson_001",
  "chapter_id": "chapter_01",
  "title": "洗手",
  "summary": "进入无菌操作前的手卫生标准流程。",
  "learning_objectives": ["能说出洗手目的、流程和常见失误"],
  "teacher_ready_content": {
    "lesson_profile": "operation",
    "display_hints": ["操作课优先展开步骤和漏步风险"],
    "teaching_markdown": "## 这一关要学会什么\n\n...",
    "quiz_question": "不用看资料，写出洗手的使用目标、主要流程和一个排错检查点。",
    "standard_answer": "标准答案应包括...",
    "key_points": ["..."],
    "common_mistakes": ["..."],
    "memory_hook": "..."
  },
  "source_refs": [
    {
      "kind": "material_block",
      "label": "block_001",
      "block_id": "block_001"
    }
  ],
  "knowledge": {
    "concepts": [],
    "examples": [],
    "checkpoints": [],
    "common_mistakes": []
  }
}
```

## 组装命令

在项目根目录运行：

```powershell
python src\codex_course_packager.py "C:\path\to\course_material" --strict
```

输出：

```text
course_draft/final.course-package.json
course_draft/final.course-package.quality-report.json
```

`final.course-package.json` 可以直接导入视界专注学习台。

如果质量报告只有 `info`，说明课包可以导入，但仍可能只是“可用 MVP”。大量 `teaching_below_density_target`、`missing_step_detail`、`missing_verification_or_troubleshooting`、`missing_example_or_application` 或 `common_mistakes_below_target` 代表需要按课型继续扩写。

## 学生端禁忌

`teacher_ready_content` 里不要出现：

- 视频给出的范围
- 字幕证据
- 材料中
- block/source/debug/evidence
- 我会把它补成一节课
- 这一关信息量偏高

这些内容只能放进 `source_refs` 或制作阶段笔记。

## 推荐交付方式

Codex 对话最终不要手写一个巨大 JSON。推荐交付小文件：

```text
course_draft/
  outline.draft.json
  lesson_manifest.json
  lessons/
    lesson_001.json
    lesson_002.json
```

然后由 `src/codex_course_packager.py` 组装成最终课包。这样出错时可以只修某一节课，不需要重写整门课。

# Codex 课包草稿模板

这些模板用于写入 `course_draft/`，不要直接把模板文字暴露给学生。

## outline.draft.json

```json
{
  "course": {
    "title": "课程名",
    "subtitle": "可选副标题",
    "overall_goal": "学完后能解决什么问题",
    "target_audience": "适合谁",
    "prerequisites": [],
    "learning_outcomes": [
      "学习结果 1",
      "学习结果 2"
    ],
    "completion_definition": "完成整门课的标准"
  },
  "chapters": [
    {
      "id": "chapter_01",
      "title": "第一章标题",
      "summary": "这一章解决什么问题",
      "lesson_ids": ["lesson_001", "lesson_002"],
      "lessons": [
        {
          "id": "lesson_001",
          "title": "第一节标题",
          "purpose": "这一节让学生真正学会什么",
          "source_block_ids": ["block_001"],
          "estimated_minutes": 6
        }
      ]
    }
  ]
}
```

## lesson_XXX.json

```json
{
  "id": "lesson_001",
  "chapter_id": "chapter_01",
  "title": "小节标题",
  "summary": "一句话说明本节学习目标。",
  "learning_objectives": [
    "学生学完后能做到什么"
  ],
  "teacher_ready_content": {
    "lesson_profile": "concept",
    "display_hints": [
      "按内容选择标题，不强行套固定模板"
    ],
    "teaching_markdown": "## 这一关要学会什么\n\n直接讲课正文。建议 800-1500 字，不要只写提纲。核心名词可以用 **加粗**，关键判断句可以少量用 <u>下划线</u>。\n\n## 核心概念\n\n解释概念。\n\n## 关键关系\n\n解释为什么。\n\n## 应用场景\n\n给例子、反例或真实使用场景。\n\n## 常见误区\n\n- 误区一\n- 误区二\n- 误区三\n\n## 一句话记忆\n\n一句能带走的话。",
    "quiz_question": "不用看资料，用自己的话回答本节最核心的问题。",
    "standard_answer": "标准答案应覆盖哪些内容，给学生对照用。建议 140-300 字，包含完整判断链。",
    "key_points": [
      "关键点 1",
      "关键点 2",
      "关键点 3",
      "关键点 4"
    ],
    "common_mistakes": [
      "常见误区 1",
      "常见误区 2",
      "常见误区 3"
    ],
    "memory_hook": "一句话记忆"
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
    "common_mistakes": [],
    "source_scope": [],
    "teaching_expansion": [],
    "practical_steps": [],
    "practice_tasks": [],
    "transfer_prompts": [],
    "enrichment_notes": []
  }
}
```

## 医学/考试/操作课标题建议

```markdown
## 这一关要学会什么

## 标准操作步骤

## 每一步为什么重要

## 考试/实操评分点

## 常见错误

## 一句话记忆
```

内容较薄时继续补：

```markdown
## 现场怎么判断

## 容易被扣分的细节

## 和相似项目的区别
```

如果本节出现口诀、缩写或编号法，必须增加一个段落逐项展开。例：`内、外、夹、弓、大、立、腕` 要写清楚掌心、手背、指缝、指背、拇指、指尖、腕部分别怎么做。

## 通识/新领域入门课标题建议

```markdown
## 这一关要学会什么

## 核心概念

## 关键关系

## 应用场景

## 常见误区

## 一句话记忆
```

内容较薄时继续补：

```markdown
## 反例或边界

## 可以迁移到哪里

## 自查问题
```

## 技能/工具课标题建议

技能操作课：

```markdown
## 这一关要学会什么

## 操作或使用流程

## 关键细节

## 检查清单

## 常见错误

## 一句话记忆
```

工具配置课：

```markdown
## 这一关要学会什么

## 前置条件

## 配置步骤

## 验证与排错

## 常见错误

## 一句话记忆
```

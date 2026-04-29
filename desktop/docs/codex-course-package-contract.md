# Codex Course Package Contract

视界专注运行时只承接 Codex 已经写好的学习内容，不再把字幕、素材证据或旧知识字段二次拼装成课程。

## Runtime Principle

学习台只读取每个 lesson 的 `teacher_ready_content`：

- `teaching_markdown`: Codex 写好的完整讲课正文。
- `lesson_profile`: 可选课型，用来约束内容重点，可为 `concept`、`operation`、`tool_config`、`exam`、`case_analysis`、`strategy` 或 `mixed`。
- `display_hints`: 可选展示/写作提示，只用于制课与后续优化，不替代正文。
- `quiz_question`: 学完后让用户主动回忆的问题。
- `standard_answer`: 用户回答后展示的标准答案。
- `key_points`: 对照答案时必须抓住的关键点。
- `common_mistakes`: 常见误区。
- `memory_hook`: 一句话记忆。

`knowledge`、`source_refs`、`source_scope`、`evidence` 只用于制作阶段和溯源，不直接进入学生主学习区。

## Lesson Shape

每个可学习节点应该像一节短课，而不是字幕摘要。推荐结构：

```json
{
  "title": "洗手",
  "teacher_ready_content": {
    "lesson_profile": "operation",
    "display_hints": ["操作课优先展开步骤、部位和漏步风险"],
    "teaching_markdown": "## 洗手\n\n洗手这一关要掌握的是……",
    "quiz_question": "不用看资料，写出……",
    "standard_answer": "标准回答应包括……",
    "key_points": ["……"],
    "common_mistakes": ["……"],
    "memory_hook": "……"
  }
}
```

## Emphasis Rules

`teaching_markdown` 可以使用少量 Markdown 强调来帮助学生抓重点：

- 核心名词、关键概念、关键参数用 `**加粗**`。
- 判断标准、操作红线、容易混淆的关键句可以用 `<u>下划线</u>`。
- 每个自然段通常强调 1-3 处即可；不要整段加粗，也不要为了装饰而强调。
- 强调必须服务理解和记忆，不能替代完整解释。
- 不要手动输入全角空格做首行缩进；学习台会在渲染普通段落时统一处理。

## Codex Workflow

1. 先读取 `course_material/manifest.json` 和 indexes，设计学习框架。
2. 再按单元回读相关 blocks，补足知识树和教学内容。
3. 每个 lesson 输出完整 `teacher_ready_content`。
4. 最后检查学生端正文没有“视频范围、字幕证据、材料中、生成过程、结构/边界万能话术”。

## Learning Runtime

用户流程固定为：

1. 阅读 Codex 写好的课程正文。
2. 写下自己的主动回忆。
3. 对照标准答案、关键点、常见误区。
4. 进入下一关。

运行时不做智能判分，不追问，不把用户卡在本关。

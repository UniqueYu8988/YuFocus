# 未来课程展示块设计草案 vNext

## 目标

未来视界专注学习台应从“固定 Markdown 课程播放器”升级为“课程展示器”。课程包应该能根据内容需要组合不同展示块，而不是把所有内容塞进同一套固定模板。

这个文档不是当前软件必须立即支持的 schema，而是 GPT 蓝图和 Codex 制课时的设计语言。

## 设计原则

- 课程设计优先，软件适配其后。
- 展示块服务理解，不做装饰。
- 不同内容类型使用不同表达形式。
- 操作类内容要能清楚展示步骤。
- 概念类内容要能清楚展示边界、对比和关系。
- 工具类内容要能清楚展示配置、验证和排错。
- 考试类内容要能清楚展示评分点和标准表述。
- 每节课保留主动回忆和答后对照。
- 先按学习任务选择格式，不按领域套模板：医学课也可以用步骤、空间示意和病例推理；计算机课也可以用表格、架构图和排错树。
- 每个展示块可以带 `priority`：`required` 必须落地，`optional` 有空间才写，`avoid_if_redundant` 已讲清时不要硬塞。
- 每节课可以有 `format_policy` 和 `teaching_voice`：前者说明主展示形式和避免形式，后者说明像什么老师在讲，避免课程变成资料堆。

## 基础块

### narrative

用于老师式正文讲解。适合解释背景、承接上下文、建立理解框架。

字段建议：

```json
{
  "type": "narrative",
  "title": "先抓住问题",
  "content": "..."
}
```

### key_concept

用于关键概念解释。适合定义、边界、反例。

```json
{
  "type": "key_concept",
  "title": "Token",
  "definition": "...",
  "boundary": "...",
  "example": "..."
}
```

### memory_hook

用于一句话记忆、口诀或高度压缩的抓手。

```json
{
  "type": "memory_hook",
  "content": "洗手：内、外、夹、弓、大、立、腕。"
}
```

## 操作与流程块

### step_list

用于操作步骤、配置步骤、流程步骤。

```json
{
  "type": "step_list",
  "title": "标准操作步骤",
  "steps": [
    {
      "label": "检查前置条件",
      "action": "...",
      "why": "...",
      "check": "..."
    }
  ]
}
```

### flow_steps

用于短标签线性流程，例如界面区域、学习路线、概念流转。只适合每步很短的情况；如果每步需要解释，改用 `step_list`。

```json
{
  "type": "flow_steps",
  "title": "流程图",
  "steps": ["明确目标", "选择项目", "执行任务", "检查结果"]
}
```

### operation_script_table

用于操作、考试实操、实验、工具演示中的“动作 / 口述或提示语 / 检查点”并列展示。缺少视频画面时尤其有用。

```json
{
  "type": "operation_script_table",
  "title": "考场操作脚本",
  "columns": ["动作", "口述", "检查点"],
  "rows": [
    ["调整体位和灯光", "接下来为您进行检查，如不适请示意", "术区清楚，灯光不直射眼睛"]
  ]
}
```

### checklist

用于学习前检查、操作后核对、考试评分核对。

```json
{
  "type": "checklist",
  "title": "完成后检查",
  "items": ["...", "..."]
}
```

### troubleshooting

用于工具配置、软件操作、实验流程中的错误排查。

```json
{
  "type": "troubleshooting",
  "title": "常见失败原因",
  "items": [
    {
      "symptom": "...",
      "cause": "...",
      "fix": "..."
    }
  ]
}
```

### spatial_schematic

用于牙面、洞形、界面布局、设备连接、动作姿势等空间关系。当前可以退化成文字示意、ASCII 简图、方向说明和自检表。

```json
{
  "type": "spatial_schematic",
  "title": "形态自检",
  "description": "用文字示意关键边界、方向、尺寸和错误形态。",
  "checks": ["龈壁位置是否清楚", "外展角是否与就位道一致"]
}
```

## 对比与结构块

### comparison_table

用于概念辨析、方案比较、优缺点分析、参数对照、禁忌证、评分点、鉴别诊断、框架/工具取舍和风险矩阵。它不适合替代操作步骤、病例推理或排错过程；这些内容如果用表格，表格后还要说明如何用它完成操作、判断或排错。

```json
{
  "type": "comparison_table",
  "title": "RNN 与 Attention",
  "columns": ["维度", "RNN", "Attention"],
  "rows": [["信息流动", "...", "..."]]
}
```

### mermaid_diagram

用于流程图、概念图、依赖关系、排错树。

```json
{
  "type": "mermaid_diagram",
  "title": "Transformer 信息流",
  "diagram": "graph TD\nA[Token] --> B[Embedding]"
}
```

### formula

用于公式和符号解释。

```json
{
  "type": "formula",
  "title": "Attention 分数",
  "formula": "softmax(QK^T / sqrt(d_k))V",
  "explanation": "..."
}
```

## 实例与练习块

### case_example

用于真实案例、场景判断、应用迁移。

```json
{
  "type": "case_example",
  "title": "一个常见误用场景",
  "scenario": "...",
  "analysis": "...",
  "takeaway": "..."
}
```

### practice_task

用于操作练习、思考题、配置任务。

```json
{
  "type": "practice_task",
  "title": "动手验证",
  "task": "...",
  "expected_result": "...",
  "hint": "..."
}
```

### case_answer_template

用于病例、故障、业务决策等需要固定答题结构的内容。

```json
{
  "type": "case_answer_template",
  "title": "病例分析答题模板",
  "slots": ["诊断", "依据", "鉴别诊断", "治疗原则"]
}
```

### oral_practice_prompt

用于病史采集、访谈、需求调研、排障问询。核心是把关键词变成对方听得懂的问题。

```json
{
  "type": "oral_practice_prompt",
  "title": "问诊口述训练",
  "prompts": [
    {
      "question": "疼痛是突然出现，还是慢慢加重？",
      "checks": "排查急性炎症、外伤或慢性进展"
    }
  ]
}
```

### flashcard

用于考官追问、术语、参数、短标准答案。

```json
{
  "type": "flashcard",
  "front": "血压测量为什么要让患者休息？",
  "back": "减少活动、紧张等因素对测量值的影响。"
}
```

### active_recall

用于用户答题前的主动回忆。

```json
{
  "type": "active_recall",
  "question": "不用看材料，解释 Attention 为什么适合并行计算。"
}
```

### standard_answer

用于用户回答后的标准答案。

```json
{
  "type": "standard_answer",
  "answer": ["...", "..."],
  "key_points": ["...", "..."],
  "common_mistakes": ["...", "..."]
}
```

## 风险块

### warning

用于重要注意事项、禁忌、风险提醒。

```json
{
  "type": "warning",
  "title": "容易踩坑",
  "content": "..."
}
```

### common_mistakes

用于错法集合。

```json
{
  "type": "common_mistakes",
  "items": [
    {
      "mistake": "...",
      "correction": "..."
    }
  ]
}
```

## v1 落地策略

短期 Codex 可以先把这些块转成结构化 Markdown：

- 标题对应二级标题。
- `step_list` 转成编号列表。
- `comparison_table` 转成 Markdown 表格。
- `mermaid_diagram` 保留 Mermaid 代码块。
- `active_recall` 和 `standard_answer` 保持独立区块。

中期软件再支持真正的 blocks renderer。

长期 Course Package 应从：

```text
teacher_ready_content.teaching_markdown
```

升级为：

```text
lesson.blocks[]
```

但在新 schema 成熟前，蓝图中的 `display_plan` 先作为过渡层。

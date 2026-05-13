# 视界专注 Codex 制课工作流

## 目标

视界专注只负责把视频、字幕或本地音视频转成完整的 `*.course_material` 原材料包。课程设计由 ChatGPT 担任总设计师，课程工程化落地由 Codex 完成。最终交付物是一个可以直接导入学习台的 `*.course-package.json`。

## 主流程：ChatGPT 总设计师 + Codex 执行

当前主流程是在原材料包和 Codex 制课之间加入 ChatGPT 总设计师：

```text
完整原材料包
  -> ChatGPT 完整阅读材料，输出 course_blueprint.json
  -> Codex 按蓝图和本地完整材料生成最终课包
```

新链路的设计文件位于：

- `docs/course-design/gpt-course-designer-workflow.md`
- `docs/prompts/chatgpt-course-designer-v1.md`
- `src/schemas/course_blueprint.schema.json`
- `docs/prompts/codex-blueprint-executor-v1.md`

## 用户流程

1. 在软件的课程制作工作台输入 B 站链接、BV 号，或选择本地音视频。
2. 软件生成原材料包到 `output/materials/<title>.course_material/`。
3. 工作台记录会生成 `gpt_designer/gpt_course_design_workspace.zip`。
4. 新开 ChatGPT 对话，上传这个 zip，复制工作台里的 GPT 提示。
5. ChatGPT 输出 `course_blueprint.json`，保存到材料包根目录。蓝图应包含 `course_design_mode`、每节 `primary_training_action`/`training_policy`、`topic_inventory`、`compression_review`、`chapter_roadmap` 和 `design_review`；其中 `topic_inventory` 要作为候选主题池，`chapter_roadmap` 要作为章节认知地图，而不只是小节目录。
6. 回到工作台复制 Codex 提示，新开 Codex 对话执行蓝图。
7. Codex 运行 strict 打包命令。
8. 打包器生成 `course_draft/final.course-package.json`，并自动复制到 `output/courses/`。
9. 回到软件，在制作记录里点击导入，或从 `output/courses/` 导入。

## GPT 总设计师最短提示

```text
请担任“视界专注”的课程总设计师。
我会上传这份完整课程原材料工作包：<gpt_course_design_workspace.zip 路径>
请先读取并执行：<START_GPT_DESIGNER.md 路径>
你的目标不是生成最终课程正文，而是完整理解视频/字幕/转写材料，设计一份可交给 Codex 执行的 course_blueprint.json。
最终请生成一个可下载文件 course_blueprint.json，内容是符合 schemas/course_blueprint.schema.json 的 JSON 对象。
```

## 制课原则

- ChatGPT 可以完整读取原材料，负责课程总设计和个性化蓝图。
- Codex 先读 `course_blueprint.json`，再按每节课的蓝图回读本地材料，并运行 `python src\coverage_audit.py "<course_material_dir>"` 辅助检查覆盖风险、全局地图提示、章节地图重复、表格占比和训练密度。
- `course_design_mode` 和 `primary_training_action` 是当前制课护栏：语言/语法课要训练识别、解析、改错和产出，医学操作课要训练步骤、检查点和错误形态，工具课要训练配置、验证和排错，观点材料要训练观点重建、反例和迁移。`training_policy.must_include` 只应保留本节最关键的 2-3 个 required 槽位，不能每节复用同一套全量训练结构。
- `chapter_roadmap` 优先服务软件章节地图：使用 `map_label/action_tag/risk_tag/output_tag` 等短标签和 `edges` 关系；`summary/core_question/key_claim` 保持短句，长说明放回 lesson 正文或隐藏设计备注。`edges[].label` 必须写出知识推进关系，说明“为什么从上一节走到下一节”，不要写“下一步”“继续”这类空标签。
- `course_visual_map` 服务整门课的全局学习地图：第一阶段只保留 `status=planned`、`alt` 和图片生成 `prompt`；软件导入课包后可复制提示词生成图片，再把图片挂回课包。
- Codex 必须读取 `design_review` 和每节 `quality_bar`；高密度 lesson 不要批量粗写。
- Codex 每次只回读当前需要的 `blocks/block_XXX.json` 或原文片段，生成可导入 lesson。
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

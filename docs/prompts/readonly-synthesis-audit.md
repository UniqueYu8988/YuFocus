# 只读学习笔记审计

你是视界专注的只读审计 Codex Goal。你的任务是检查学习笔记和章节思维导图质量，不是重写正文。

## 只允许读取

- `HANDOFF.md`
- `manifest.json`
- `blocks/`
- `indexes/`
- `content_draft/synthesis_plan.json`
- `content_draft/work/knowledge_tree.json`
- `content_draft/work/tree_outline.md`
- `content_draft/work/structure_review.md`
- `content_draft/learning_notes.md`
- `content_draft/chapter_mindmap.md`
- `authoring/content-synthesis-authoring.md`

## 只允许写入

- `content_draft/review_exports/latest-readonly-audit.md`

## 审计重点

- 是否以视频内容为主体，而不是脱离视频另写主题文章。
- 是否只是字幕压缩版或总结文章，缺少重新编排、补足和可视化。
- 对长材料，是否存在“一次性假完成”：多个阶段时间戳几乎相同、coverage 在未深写前已经全部 `published`、`learning_notes.md` 明显过薄、`self_check.md` 只是文件存在清单。
- `run_state.json`、`content_draft/work/run_state.json` 和真实文件是否一致；如果状态写成 `learning_notes_ready` 但缺少正文、导图、concept graph、复查文件或有效分支 drafts，应判定不通过。
- coverage 阶段是否只证明 topic 去向；如果没有正文证据却提前把大量 topic 标记为 `published`，应判定需要回退。
- dossier 是否真的按知识树分支回读 blocks；如果只是 topic 清单、摘要、写作计划或过短材料包，应判定 `dossier_ready` 不成立。
- 知识树是否先于正文建立，章节是否真的挂在树上，而不是 topic 先行、正文后补。
- 是否出现“为了凑层级而拆出很多短小节点”“只有提纲没有导图关系”“上层太粗、下层太碎”的结构退化。
- 是否丢掉作者的解读方向、强调点、例子或操作细节。
- 适度补全是否服务理解，是否喧宾夺主。
- 正文是否只有一个 `#` 总标题，并按材料选择合适结构：短材料可用少量 `##` 学习小节，中长材料才使用 `##` 大章节和 `###` 完整小节。
- 高价值学习小节是否讲充分：是否有明确问题、核心解释、具体访谈情境、判断链路、例子或反例、误区边界和回看价值。
- 可打开小节是否是完整阅读单位，而不是一个 topic 一页；更细知识点是否保留在同一小节内部自然排版。
- 章节思维导图是否适合作为学习台对话流中的一整条图文消息展示：是否清楚展示知识树主干、分支、概念关系和回看入口，是否过密或过碎。
- 对长材料，`indexes/learning_notes_trace.json` 和 `indexes/chapter_mindmap_trace.json` 是否能把主要学习单位、导图节点映射回 `indexes/source_index.jsonl` 与 blocks。
- 版本敏感或高风险内容是否有保守表达。
- 是否混入后台过程词，例如 `source`、`block`、`debug`、`字幕证据`。

## 输出

写一份中文审计报告到：

`content_draft/review_exports/latest-readonly-audit.md`

报告包含：

- 是否通过
- 主要问题
- 对应位置或证据
- 建议返工方向
- 若不通过，建议回退到哪个 stage：`needs_restructure`、`coverage_ready`、`dossier_ready`、`partial_learning_notes` 或 `needs_deepening`

不要直接修改 `learning_notes.md` 或 `chapter_mindmap.md`。

# Codex Goal 学习笔记任务 v8

你是“视界专注”的主生产 Codex Goal。你的任务是把本地视频材料整理成可导航、可展开、可回看的学习笔记和章节思维导图。

v8 的核心改变：**先搭知识树，再做 topic 覆盖，再写正文。** 不要把 `coverage_matrix` 当成结构设计器，也不要把材料写成几篇长文章。最终 `learning_notes.md` 必须像学习台可导入的章节笔记，而不是总结文章。

## 状态语义

`material_ready`：软件已生成原材料包，等待 Codex。

`knowledge_tree_ready`：知识树初稿完成，已经明确主干、分支、子节点和跨章关系；不能导入学习。

`coverage_ready`：topic 已挂到知识树节点，材料覆盖和证据去向完成；不能导入学习。

`dossier_ready`：分支材料包完成，证明已经按知识树分支回读 blocks，并准备好深写素材；不能导入学习。

`partial_learning_notes`：部分知识树分支已深写，仍需继续下一批分支。

`learning_notes_ready`：全部高价值分支通过结构复查、薄度复查和具体性复查，可导入学习。

`needs_restructure`：知识树层级不合理，例如上层过粗、下层过碎、横向关系缺失、正文会天然变成长文章。

`needs_deepening`：正文、dossier 或 draft 偏薄，需要回到对应阶段返工。

## 必读文件

先读取：

- `manifest.json`
- 根目录 `run_state.json`
- `content_draft/work/run_state.json`（如果存在）
- `HANDOFF.md`
- `indexes/global_outline.json`
- `indexes/part_index.json`
- `indexes/teaching_map.json`
- `blocks/*.json`（按阶段逐步回读，不要一次吞完整 raw_transcript）

根据当前 stage 选择本轮任务：

- `material_ready`：执行阶段 1，做到 `knowledge_tree_ready` 后正常停止。
- `knowledge_tree_ready`：执行阶段 2，做到 `coverage_ready` 后正常停止。
- `coverage_ready`：执行阶段 3，做到 `dossier_ready` 后正常停止。
- `dossier_ready` 或 `partial_learning_notes`：执行阶段 4，每轮只深写 1-2 个知识树分支。
- `needs_restructure`：先修 `knowledge_tree.json`、`tree_outline.md` 和 `synthesis_plan.json`，不要直接补正文。
- `needs_deepening`：先读取 `thinness_review.md`，只修复被标记偏薄的分支。
- `learning_notes_ready`：只读检查，不重复生成。

满足任一条件，按长材料处理：

- `manifest.text_length` 超过 100000。
- `manifest.block_count` 超过 8。
- 材料属于考试、医学、法律、金融、安全、教程、操作训练、密集攻略。
- 单个 block 覆盖多个知识模块。

## 阶段 1：knowledge_tree_ready

目标：先建立这门材料的学习结构，而不是先追 topic 完成度。

读取 `HANDOFF.md`、`manifest.json`、`run_state.json`、`indexes/`，再抽读能代表主题边界的 `blocks/*.json`。不要写正文。

写入：

- `content_draft/work/run_state.json`
- `content_draft/work/intake_inventory.md`
- `content_draft/work/tree_outline.md`
- `content_draft/work/knowledge_tree.json`
- `content_draft/work/structure_review.md`
- `content_draft/synthesis_plan.json`

本阶段不写：

- `content_draft/work/block_digest/*.md`
- `content_draft/work/topic_inventory.json`
- `content_draft/work/coverage_matrix.json`
- `content_draft/work/section_dossiers/*.md`
- `content_draft/work/drafts/*.md`
- `content_draft/learning_notes.md`
- `content_draft/chapter_mindmap.md`

### knowledge_tree.json

`knowledge_tree.json` 是 v8 的结构锚点。建议包含：

```json
{
  "schema_version": "shijie.knowledge-tree.v0.1",
  "tree_id": "tree_material_id",
  "title": "材料标题",
  "root_question": "这份材料最终帮助用户理解什么",
  "main_branches": [
    {
      "branch_id": "branch_001",
      "title": "主分支标题",
      "learning_role": "这个分支在整棵树里解决什么问题",
      "child_nodes": [
        {
          "node_id": "node_001_001",
          "title": "子节点标题",
          "node_role": "概念 / 机制 / 对比 / 流程 / 病例 / 边界 / 题干判断",
          "expected_depth": "brief | normal | deep",
          "source_hints": ["block_003", "block_004"]
        }
      ]
    }
  ],
  "cross_links": [
    {
      "from": "node_001_002",
      "to": "node_007_001",
      "relation": "same_boundary | prerequisite | contrast | reused_concept | common_error",
      "why_it_matters": "为什么学习时需要把这两个节点连起来"
    }
  ],
  "structure_risks": ["哪些分支可能过粗、过碎或需要后续拆合"]
}
```

### tree_outline.md

`tree_outline.md` 面向人读，要能一眼看出：

- 总主线是什么。
- 一级分支有哪些。
- 每个分支下有哪些子节点。
- 哪些节点互相依赖、容易混淆或需要跨章回看。
- 哪些分支需要深写，哪些只需轻描。

完成后更新根目录和工作目录的 `run_state.json`：

- `stage = knowledge_tree_ready`
- `next_action = 再次复制 authoring/02_start_codex_synthesis.md，进入 coverage_ready 阶段`

## 阶段 2：coverage_ready

目标：把材料 topic 挂到知识树，而不是用 topic 反过来决定章节。

读取：

- `content_draft/work/knowledge_tree.json`
- `content_draft/work/tree_outline.md`
- `indexes/`
- `blocks/*.json`

写入：

- `content_draft/work/source_map.json`
- `content_draft/work/block_digest/block_XXX.md`
- `content_draft/work/topic_inventory.json`
- `content_draft/work/source_cards/*.jsonl`
- `content_draft/work/evidence_ledger.jsonl`
- `content_draft/work/coverage_matrix.json`
- `content_draft/work/coverage_gap_report.md`
- 必要时更新 `content_draft/work/structure_review.md`

本阶段不写：

- `content_draft/work/section_dossiers/*.md`
- `content_draft/work/drafts/*.md`
- `content_draft/learning_notes.md`
- `content_draft/chapter_mindmap.md`

`topic_inventory.json` 和 `coverage_matrix.json` 中的 topic 必须带 `branch_id` 或 `node_id`。如果大量 topic 无法挂树，不要硬塞正文；应把 `run_state.stage` 标为 `needs_restructure`，并说明需要拆合哪些分支。

本阶段只证明 topic 去向。`coverage_status` 最高只能是 `mentioned`，不能写 `published`。

完成后更新：

- `stage = coverage_ready`
- `next_action = 再次复制 authoring/02_start_codex_synthesis.md，进入 dossier_ready 阶段`

## 阶段 3：dossier_ready

目标：按知识树分支回读原文，写可支撑深写的分支材料包。

如果当前 stage 是 `coverage_ready`，必须按 `knowledge_tree.json` 的分支回读 blocks 原文，不得只依赖 `topic_inventory`、`coverage_matrix` 或 block digest 写材料包。

写入：

- `content_draft/work/block_reread_ledger.jsonl`
- `content_draft/work/theme_model.json`
- `content_draft/work/section_dossiers/*.md`
- `content_draft/work/thinness_review.md` 初版
- 更新 `content_draft/synthesis_plan.json`
- 更新 `content_draft/work/coverage_matrix.json`

本阶段不写：

- `content_draft/work/drafts/*.md`
- `content_draft/learning_notes.md`
- `content_draft/chapter_mindmap.md`

`section_dossiers/*.md` 虽然沿用文件名，但语义是“知识树分支材料包”。每个 dossier 应围绕一个主分支或紧密分支组，而不是机械对应 topic 清单。

建议结构：

```md
# 分支材料包：分支名

## 在知识树中的位置
## 子节点和相邻节点
## 回读范围
## 必写知识骨架
## 原文教学素材
## 机制链 / 流程链 / 对比链
## 题干触发词或使用场景
## 易混边界和跨章连接
## 需要核验或保守表达
## 正文呈现建议
## 完成信号
```

如果 dossier 只是 topic 清单、短摘要或写作计划，更新 `run_state.stage = dossier_incomplete` 或 `needs_deepening`，不要进入下一阶段。

完成后更新：

- `stage = dossier_ready`
- `next_action = 再次复制 authoring/02_start_codex_synthesis.md，进入 partial_learning_notes 阶段`

## 阶段 4：partial_learning_notes

目标：把知识树分支写成学习台可导航的 Markdown。

长材料每轮只写 1-2 个主分支或一组紧密相关分支。读取对应：

- `content_draft/work/knowledge_tree.json`
- `content_draft/work/tree_outline.md`
- `content_draft/work/section_dossiers/*.md`
- `content_draft/work/block_reread_ledger.jsonl`
- `content_draft/work/coverage_matrix.json`
- 必要时再次回读 `blocks/*.json`

写入或更新：

- `content_draft/work/drafts/section_XXX.md`
- `content_draft/learning_notes.md`
- `content_draft/work/thinness_review.md`
- `content_draft/work/editorial_review.md`
- `content_draft/work/specificity_review.md`
- `content_draft/work/self_check.md`
- 更新 `content_draft/work/coverage_matrix.json`

### Markdown 层级硬边界

这是导入学习台的结构合同：

- `learning_notes.md` 只能有一个顶层 `# 标题`。
- 主章节必须使用 `##`。
- 学习小节必须使用 `###`。
- 不要用多个 `#` 当章节；那会让学习台看起来“每章只有一节”。
- 每个 `##` 下面应有若干有意义的 `###` 子节点；如果一个主章节只能写出一个子节点，优先考虑合并到相邻主章节或拆分子节点。

正文不应按“每章自洽长文”一路写完。每个分支开头要说明它在整棵树里的位置；章内按父节点、子节点、兄弟节点、横向关系和易混边界展开。

`published` 的含义：

- 已挂到知识树节点。
- 已定义或定位。
- 已解释机制、原因、流程或判断逻辑。
- 已处理题干触发词、变体、例外、应用线索或使用场景。
- 已处理易混边界和必要跨章关系。
- 已进入 `learning_notes.md` 的对应 `##` / `###` 层级。

如果只写了部分分支：

- `run_state.stage = partial_learning_notes`
- `next_action` 写明下一轮应处理哪些分支或章节。

只有全部高价值分支通过复查后，才进入阶段 5。

## 阶段 5：learning_notes_ready

目标：织网和收口，而不是再写一篇提纲。

写入：

- `content_draft/work/concept_graph.json`
- `content_draft/chapter_mindmap.md`
- `content_draft/work/editorial_review.md`
- `content_draft/work/specificity_review.md`
- `content_draft/work/self_check.md`
- 更新 `content_draft/synthesis_plan.json`
- 更新根目录和工作目录 `run_state.json`

`concept_graph.json` 应从 `knowledge_tree.json` 演进而来，保留节点、父子关系、横向关系、易混关系和回看入口。

`chapter_mindmap.md` 不要只列目录。它应至少呈现：

- 全局主干。
- 主要分支。
- 分支下的关键子节点。
- 跨章连接。
- 易混节点和回看路径。

可以使用 Mermaid mindmap、Mermaid flowchart 或清晰树状 Markdown。内容密时可以拆成多张图，但每张图都要能在学习台对话流里独立阅读。

完成后标记：

- `run_state.stage = learning_notes_ready`
- `learning_notes_ready.importable = true`

## 结构复查

`structure_review.md` 和最终 `self_check.md` 必须检查：

- 是否先有知识树，再有 topic 覆盖。
- `learning_notes.md` 是否只有一个 `#` 标题。
- 主章节是否使用 `##`，学习小节是否使用 `###`。
- 是否存在“一个主章只有一个小节”的目录退化。
- 上层是否过粗，下层是否过碎。
- 章节之间是否有必要的跨章连接。
- `chapter_mindmap.md` 是否是网络图/树，而不是提纲。
- `coverage_matrix` 是否只是映射账本，没有反过来支配结构。

若结构不合格，停在 `needs_restructure`，不要标记 `learning_notes_ready`。

## 内容原则

视频决定范围、重点、判断方向和叙述重心。你可以补定义、背景、步骤、例子、常见误区和概念连接，但补充必须服务于理解视频，不要脱离材料另写百科。

不要设置固定字数、固定例子数、固定表格数作为完成条件。它们可以作为 sanity check，但不是模板。质量判断看：是否具体、是否讲透、是否保留边界、是否有学习价值、是否能看出来自当前材料。

不要写“完成方式”“验收方式”或后台过程到学生正文。不要暴露 `source`、`block_id`、`debug`、`字幕证据`、`制作过程` 等后台词。

## 完成回复

完成时只汇报：

- 当前 stage。
- 本轮写入哪些文件。
- 知识树 / coverage / dossier / draft / published 的真实状态。
- 如果是 `partial_learning_notes`，下一轮处理哪些分支。
- 如果是 `needs_restructure`，哪些结构问题需要修。
- 如果是 `needs_deepening`，哪些分支偏薄以及为什么。
- 是否已经可导入学习台。

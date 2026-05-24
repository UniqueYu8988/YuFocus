# .course_material 底座升级路线

更新时间：2026-05-24

本文记录 30 万字量级测试后形成的长期架构共识。目标是防止上下文压缩、换窗口或后续调试时重新回到“继续加提示词、继续让 Codex 自己宣布完成”的旧路。

## 定稿判断

`.course_material` 是唯一材料包协议；Codex Goal 是材料包状态机执行代理；最终学生正文保持干净；追溯、验证、审计全部旁路化；学习台最终只读取 `content_draft/learning_notes.md` 和 `content_draft/chapter_mindmap.md`。

这意味着：

- 不重建新的 `input/data/src` 目录。
- 不要求用户手动执行多个阶段 Goal。
- 不把 `source_ref`、`block_id`、raw offset、调试词写进学生正文。
- 不把大量 node notes 作为最终学习体验。
- 不用 deterministic validator 替代内容审美判断。
- 不让 Codex 主观设置最终发布状态。

## 保留的 v8 产品状态

现有 v8 状态名继续保留：

```text
material_ready
  -> knowledge_tree_ready
  -> coverage_ready
  -> dossier_ready
  -> partial_learning_notes
  -> learning_notes_ready
```

大写的工程阶段名，如 `BUILD_SOURCE_INDEX`、`BUILD_TRACE_MAPS`、`VALIDATE_PIPELINE`，只作为内部能力或文档说明，不替换产品状态机。

建议长期语义：

- `learning_notes_ready`：Codex 已生成最终学习笔记、章节思维导图和必要复查文件。
- `pipeline_ready`：deterministic validator 通过，说明材料包工程上不是假完成。
- `audit_ready`：只读质量审计没有发现高风险，或人工确认通过。
- `release_ready`：产品层允许进入正式学习台展示，不能由 Codex 主观设置。

`learning_notes_ready` 以后不应单独等于“可以放心导入”。至少应配合 `pipeline_ready = true`。

## 目录职责

保持现有 `.course_material` 边界，并按以下职责演进：

```text
<name>.course_material/
  manifest.json
  raw_transcript.txt
  raw_tracks.json
  run_state.json

  blocks/
    block_manifest.jsonl
    block_*.json

  indexes/
    source_index.jsonl
    learning_notes_trace.json
    chapter_mindmap_trace.json
    node_contexts/

  authoring/
    *.md

  content_draft/
    learning_notes.md
    chapter_mindmap.md

    work/
      knowledge_tree.json
      tree_outline.md
      structure_review.md
      coverage_matrix.json
      block_reread_ledger.jsonl
      section_dossiers/
      drafts/
      concept_graph.json
      self_check.md

    review_exports/
      validation_report.json
      quality_audit_report.md
      latest-readonly-audit.md
```

职责边界：

- `blocks/`：稳定分块、resume、hash、原文范围。
- `indexes/`：旁路追溯、source index、node contexts、trace maps。
- `authoring/`：提示词、制作说明、authoring guide、production rules。不要放生产中间物。
- `content_draft/work/`：知识树、coverage、dossier、章节草稿、复查文件等制作中间物。
- `content_draft/review_exports/`：validator、只读审计、golden eval、压力测试报告。
- `learning_notes.md` / `chapter_mindmap.md`：学习台最终读取的干净正文。

## 旁路追溯规则

学生正文必须干净：

```text
content_draft/learning_notes.md
content_draft/chapter_mindmap.md
```

追溯信息必须完整，但只放旁路：

```text
indexes/source_index.jsonl
indexes/node_contexts/
indexes/learning_notes_trace.json
indexes/chapter_mindmap_trace.json
```

推荐追溯链路：

```text
raw_transcript.txt
  -> blocks/block_*.json
  -> indexes/source_index.jsonl
  -> indexes/node_contexts/*.json
  -> content_draft/work/knowledge_tree.json
  -> content_draft/learning_notes.md
  -> indexes/learning_notes_trace.json
```

`learning_notes_trace.json` 应能把主要章节、段落或知识单元映射回 `source_ref`、`block_id` 和 `raw_transcript` 范围。`chapter_mindmap_trace.json` 应能把脑图节点映射回知识树节点或原文范围。学习台未来可以做“显示依据”功能，但默认不展示这些后台引用。

## Deterministic Validator

validator 的职责是挡住结构性假完成，只回答：

```text
这个材料包在工程上是否真的完成、可追溯、可读取？
```

validator 应检查：

- `manifest.json`、`raw_transcript.txt`、`run_state.json` 存在且基本合法。
- `blocks/` 和 `block_manifest.jsonl` 合法。
- block 连续性、范围、hash、prev/next 关系成立。
- `indexes/source_index.jsonl` 合法，能反查 block 和字符范围。
- `indexes/node_contexts/` 存在或符合当前阶段协议，且 source refs 可追溯。
- `content_draft/work/knowledge_tree.json`、coverage、dossier、draft 等 v8 中间物存在且基本合法。
- `content_draft/learning_notes.md` 和 `content_draft/chapter_mindmap.md` 存在、非空、结构完整。
- 学生正文不包含 `source_ref`、`block_id`、raw offset、`debug`、`字幕证据` 等调试噪音。
- 学生正文不包含 `TODO`、`待补充`、`略`、`此处省略`、`placeholder` 等占位。
- trace maps 能旁路映射回 `source_index.jsonl`。
- `run_state.json` 状态一致。
- 300k synthetic transcript 不会被一次性吞入单个 prompt 或单个处理单元。
- resume / idempotency 测试成立。

validator 不判断：

- 文风是否优美。
- 例子是否最有启发性。
- 学习路径是否最佳。
- 学生是否喜欢。
- 内容是否达到最终出版水准。

validator 通过只能设置或建议 `pipeline_ready = true`。失败时必须保持 `pipeline_ready = false`，并输出 `content_draft/review_exports/validation_report.json`，写清失败项。

## 只读质量审计

read-only quality audit 用来显性化内容风险，不越权改正文。

建议读取：

```text
content_draft/learning_notes.md
content_draft/chapter_mindmap.md
content_draft/work/knowledge_tree.json
content_draft/work/coverage_matrix.json
content_draft/work/section_dossiers/
indexes/learning_notes_trace.json
indexes/chapter_mindmap_trace.json
indexes/node_contexts/
```

建议输出：

```text
content_draft/review_exports/quality_audit_report.md
```

审计报告关注：

- 学习可读性。
- 章节连贯性。
- 是否像学习材料，而不是摘要堆砌。
- 覆盖度风险。
- 疑似幻觉风险。
- 过度碎片化风险。
- 建议人工抽检章节。

只读审计不能直接修改 `learning_notes.md` / `chapter_mindmap.md`，不能直接设置 `release_ready`，也不能替代人工审美判断。

## 分期落地计划

不要把底座升级写成一个巨大 Goal。按下面四轮推进，每轮都要有明确产物和失败条件。

### 第一轮：validator + ready 分层骨架

目标：先建立“谁有资格设置 ready”。

完成条件：

- `run_state.json` 或现有 v8 状态承载处出现 `pipeline_ready`、`audit_ready`、`release_ready`。
- 兼容或降级旧 `ready` / `importable`，避免单一 ready 直接代表发布完成。
- 新增 `content_draft/review_exports/validation_report.json`。
- validator 至少检查关键文件存在、最终正文存在、正文无 source ref 噪音、正文无 TODO/占位符、`run_state` 状态一致。
- validator 失败时 `pipeline_ready = false`。
- validator 通过时才允许 `pipeline_ready = true`。
- `release_ready` 不允许由 Codex 自动设置。

### 第二轮：source_index + trace map

目标：让最终正文干净，但旁路可追溯。

完成条件：

- `indexes/source_index.jsonl` 存在。
- `indexes/learning_notes_trace.json` 存在。
- `indexes/chapter_mindmap_trace.json` 存在。
- `indexes/node_contexts/` 存在或有生成协议。
- `learning_notes.md` / `chapter_mindmap.md` 不出现 source refs。
- trace map 能把主要章节或知识单元映射回 block/source range。
- validator 能验证 trace map 指向合法 `source_index`。

### 第三轮：只读 quality audit

目标：让质量风险显性化，但不让审计器越权。

完成条件：

- 输出 `content_draft/review_exports/quality_audit_report.md`。
- audit 只读取最终正文、work 中间物、trace map、node contexts。
- audit 不修改 `learning_notes.md` / `chapter_mindmap.md`。
- audit 不设置 `release_ready`。
- 报告包含覆盖度、学习可读性、章节连贯性、疑似幻觉、过度碎片化、建议人工抽检章节。

### 第四轮：golden eval + 300k synthetic test

目标：证明底座抗长文本，而不是证明所有内容都完美。

完成条件：

- 小样本 golden eval 能检查结构、覆盖、正文干净、trace 可追溯。
- 300k synthetic transcript 能验证不会一次性吞全文。
- resume / idempotency 测试存在。
- validator 能在测试中挡住假 ready。
- 输出 `synthetic_300k_report` 或测试日志。

## 当前测试后的决策规则

当前正在跑的 30 万字测试先让它完成。若出现以下任一现象，不要继续优先调 prompt，应直接进入第一轮底座升级：

- 文件不完整但声称完成。
- 正文很薄但标记 ready。
- 没有 `validation_report.json` 却声称可导入。
- 状态和文件不一致。
- 没有 trace 却声称可追溯。
- 正文有占位符但标 ready。
- 在短时间内同时完成 coverage、dossier、draft、导图并自封 ready。

当前优先级：

```text
1. validator + ready 分层骨架
2. source_index + trace map
3. read-only quality audit
4. golden eval + 300k synthetic test
5. 最后才回到内容提示词优化
```


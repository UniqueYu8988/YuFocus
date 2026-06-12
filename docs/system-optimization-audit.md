# 系统优化审计

更新时间：2026-06-03

本文记录本轮“文件管理优化 + 制作效率优化”的判断，供后续重构时对齐方向。

## 当前主线

必须保留并继续强化的主线：

- 视频来源与关注源：B 站关注源、收藏 UP、手动 BV、最近视频。
- 字幕链路：字幕获取、本地音频转写、字幕清洗、NotebookLM 导入稿。
- 短视频编稿：MiMo API 多通路编辑、主编成稿、忠实性审稿、HTML 邮件稿。
- 任务队列：固定 3 个完整任务并发，同一视频内部按阶段顺序推进。
- 档案：按来源、类型、推送和异常状态管理本地资料。
- 邮件推送：SMTP 配置、HTML 正文、纯文本兜底。
- 流程透明页：让用户能看到核心流程文件和运行原则。

## 需要继续整理的边界

当前仍然存在历史命名或职责偏重的部分：

- `.course_material` 仍是内部材料目录名。它可以暂时保留，但语义已经变成轻量资料目录，不再是 Codex Goal 工作区。
- `CoursePackage`、`lesson`、`quiz_question`、`standard_answer` 等字段仍用于专注页兼容包。它们只能留在兼容层，不能回到产品语言。
- `desktop/electron/main.ts` 仍承担视频来源、队列、材料扫描、邮件、TTS、学习兼容等多种职责。后续可按 source / material / queue / delivery / reader 分模块迁移。
- `src/distiller.py` 是字幕清洗和编稿核心，短期保留集中实现；中期可把 cleaning、editorial、metrics 拆成独立模块。

## 已退出默认链路

以下内容不应恢复为主流程：

- v8 / v9 Codex Goal 深写。
- content_draft、coverage、dossier、validator 工作区。
- 课程制作、学习包、答题验收。
- course_blueprint、course_draft、course-package。
- quiz / standard_answer 驱动的生产验收。

历史纪念内容可以保留在 `PROJECT_MEMORIAL_REPORT.md`，但不能作为执行说明。

## 轻量材料目录方向

`.course_material` 当前仍作为兼容目录名，但内部应只服务当前两条路线。

推荐核心结构：

```text
manifest.json
run_state.json
raw_transcript.txt
content.md
content.meta.json
metrics.json
exports/notebooklm.md
indexes/source_index.jsonl
summary/article.md
summary/article.html
summary/cards.json
summary/review.json
summary/summary_status.json
summary/meta.json
work/cleaning/
```

`metrics.json` 是本轮新增的效率观测总账。它记录各阶段耗时、输入输出规模、API token 汇总和主要产物大小，后续用于判断哪里慢、哪里贵、哪里产物收益不足。

## 制作效率原则

优化目标不是单纯压低 token，而是提高 token 投入产出比。

优先级：

1. 先清洗输入，减少噪声、重复口语和无效上下文进入 API。
2. 昂贵 API 优先负责主线理解、编辑判断和最终成稿。
3. 本地规则或本地小模型优先处理切段、去重、格式检查、HTML 兼容检查、重复检测。
4. 同一 BV 全局去重，避免重复入队、重复清洗和重复编稿。
5. 队列保持完整任务级 3 并发，不让单个视频内部阶段乱序。
6. 每个阶段都要留下可统计指标，后续用数据决定优化方向。

## 下一阶段建议

- 把 Electron 主进程中的材料扫描、任务队列、邮件推送逐步拆成独立服务文件。
- 以 `docs/cleanup-baseline.md` 作为清理基线，先保持旧 v8/v9、schema、validator 和课程组件删除状态，再推进模块拆分。
- 在流程页或设置页增加“效率观测”区，读取 `metrics.json` 展示最近任务耗时和 token。
- 给清洗阶段加入更明确的缓存命中统计，区分真实 API 消耗和复用产物。
- 为短视频编稿加入轻量质量评分，结合字数、结构、审稿状态和 token 消耗判断收益。
- 等 `.course_material` 语义彻底稳定后，再考虑迁移到更中性的内部目录后缀。

# VERIFICATION_BACKLOG.md

> 本文件记录旧对话中提到、但尚未通过当前运行结果确认的问题。  
> 它不是“当前已知 Bug 清单”，而是“需要验证的候选问题”。

## 一、功能稳定性

- [x] 是否能建立不会写真实 AppData / Electron Store / `knowledge_library.json` 的受控启动验收方式；结论：已改为允许最小可逆写入并完成短时间验收，完全只读启动不作为当前要求。
- [ ] 档案主页面为什么显示为空，且与左侧档案计数和材料包数量不一致；
- [ ] 独立灵犀页是否仍有可达入口，还是只剩左侧来源区；
- [ ] 删除档案后，侧边栏是否仍残留旧内容；
- [ ] 工作台状态是否与本地文件保持同步；
- [ ] 学习包或材料被清理后，是否会被意外恢复；
- [ ] 精读稿阅读弹窗是否仍出现 high risk 报错；
- [ ] 复制路径和复制内容是否仍可能因 Electron clipboard 失败；
- [ ] 队列重启后是否重复加入大量任务；
- [ ] 并发是否严格保持在 3 个完整任务以内；
- [ ] 应用重启时遗留的 `processing` 任务是否会恢复为 `queued`，且不会与新任务叠加；
- [ ] 手动 BV、关注来源加入队列、已有材料复用的实际路由规则是否仍与旧 `PROJECT_CONTEXT.md` 描述一致；
- [ ] 清空任务队列时，已完成、待处理、失败、正在处理任务的真实删除/归档语义是否符合当前预期；
- [ ] 后台自动化是否在前端关闭后继续稳定运行；
- [ ] 同一 BV 是否能可靠去重；
- [ ] 短视频摘要链路是否稳定完成；
- [ ] 字幕清洗结果导入 NotebookLM 后质量是否满足需求。

## 二、产品方向

- [ ] 当前短视频摘要是否仍然过长；
- [ ] 当前 token 消耗是否需要降低；
- [ ] 长视频流程是否已完全退出总结路线；
- [ ] 邮件是单篇推送还是日报合刊；
- [ ] 效率观测 UI 是否真实展示 token、耗时和产出比。
- [ ] 旧视频编稿流程中的 HTML 邮件样式、标题规则和删减板块规则是否仍符合当前产品方向；
- [ ] 旧系统优化审计中的“效率观测”和“质量评分”建议是否仍值得进入后续稳定化任务；

## 三、结构和兼容层

- [ ] `src/distiller.py` 当前具体承担哪些职责；
- [ ] `WorkspacePane.tsx` 当前承担哪些状态和业务逻辑；
- [ ] `main.ts` 是否只是装配中心；
- [ ] 旧 CoursePackage / lesson / standard_answer 是否仍被真实运行链路使用；
- [ ] `desktop/src/lib/learningTurn.ts`、`learningState.ts`、`learningProgression.ts` 是否仍只是旧学习包兼容层；
- [ ] `src/schemas/` 是否仍有实际调用者，还是旧 validator/schema 遗留目录；
- [ ] 旧清理基线中标记已删除的 v8 prompt、`materialValidation.ts`、`eval_material_pipeline.py` 是否仍应保持删除状态；
- [ ] `.course_material` 是否只是命名遗留，还是仍有兼容依赖；
- [ ] `PROJECT_CONTEXT.md` 哪些内容仍有效；
- [x] 流程页白名单中的 `project_context`、`editorial_pipeline`、`system_optimization_audit`、`cleanup_baseline` 是否仍应展示给用户，还是应替换为当前正式文档；结论：已替换为 `AGENTS.md`、`PRODUCT.md`、`ARCHITECTURE.md`、`CURRENT_STATE.md`、`docs/BASELINE_ACCEPTANCE.md`、`docs/plans/STABILIZATION_PLAN.md`。
- [x] `desktop/electron/runtimePaths.ts` 是否仍需要依赖 `PROJECT_CONTEXT.md` 来探测开发项目根目录；结论：已改为使用 `AGENTS.md`、`PRODUCT.md`、`ARCHITECTURE.md`、`src/distiller.py`、`desktop/package.json` 的组合标志。
- [x] `PROJECT_MEMORIAL_REPORT.md` 是否仅应归档；结论：纪念性历史资料，不作为当前执行说明，归档到 `docs/history/legacy-md/`。

## 四、验证记录

| 日期 | 项目版本 | 验证项 | 结果 | 证据位置 | 后续处理 |
|---|---|---|---|---|---|
| 2026-06-12 | 当前工作区 | 受控启动前风险审计 | 未启动；队列 53 项全为 `done`，无等待/运行任务；启动不会立刻制作，但会写运行日志，队列加载可能写回 Store，灵犀读取会写回索引 | `docs/BASELINE_ACCEPTANCE.md`、`CURRENT_STATE.md` | 先选择允许最小写入或建立隔离验收方式 |
| 2026-06-12 | 当前工作区 | 短时间受控启动验收 | 启动和关闭成功；首页、设置页可打开；左侧灵犀来源区可展开；队列和材料包数量未变化；档案主页面为空、独立灵犀页入口不明确 | `docs/BASELINE_ACCEPTANCE.md`、`CURRENT_STATE.md` | 后续只读排查档案和灵犀入口 |

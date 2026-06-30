# 最近页实时状态提示

最后更新：2026-06-29

## 目标

在“最近”页增加一个极简实时状态提示，让用户能一眼看到后台自动同步和队列当前状态，例如：

- 正在处理某个视频；
- 队列还有多少条等待；
- 后台同步是否暂停；
- 下次自动检查时间；
- 最近一次同步是否异常。

## 范围

- 只调整“最近”页的轻量状态展示。
- 读取现有后台自动化状态和队列状态，不改变自动同步、入队、下载、转写或清洗规则。
- 保持首页仍然只做元数据刷新；不会因为显示状态而触发下载或转写。

## 不做

- 不新增并发处理。
- 不改变队列优先级。
- 不修改真实材料文件。
- 不新增复杂监控面板。

## 验证

- `node --experimental-strip-types --no-warnings scripts/check-home-dashboard-safety.mjs`：通过。
- `node --experimental-strip-types --no-warnings scripts/check-up-sync-scheduler.mjs`：通过。
- `node --experimental-strip-types --no-warnings scripts/check-queue-record-feed.mjs`：通过。
- `npx tsc --noEmit`：通过。
- `git diff --check`：通过；仅出现 Windows 换行提示。

## 状态

- 已完成。

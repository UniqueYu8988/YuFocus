# 后台自动运行补丁

最后更新：2026-06-29

## 问题汇总

下午挂机暴露出 4 个实际问题：

1. 历史补足太保守：处理完 1 条历史视频后会等下一次整点，不会在电脑空闲时持续处理。
2. 未来重试会堵塞历史补足：未到 `nextRetryAt` 的 retry 项仍被当成“队列里有任务”，导致不再补新历史任务。
3. 付费 / 充电 / 权限视频会反复失败：无字幕、音频兜底被 `HTTP 412` 或无音频轨拦住时，会进入普通重试，浪费时间。
4. 重试到点唤醒不精确：到重试时间后可能还要等下次整点或队列保存事件。

## 补丁目标

- 仍然坚持一次只处理 1 条视频，不做并发。
- 队列空闲时自动补历史任务，处理完继续补下一条，直到没有可补历史视频。
- 新视频仍优先于历史补足。
- 未到期重试不阻塞历史补足。
- 权限 / 付费 / 充电类失败直接跳过，不自动重试。
- 最近页和队列页能看见“已跳过”的记录。

## 不做

- 不删除、移动或改写 `data/materials`。
- 不新增依赖。
- 不改变 subtitle-only 主线。
- 不把队列改成并发。
- 不做复杂性能调度，只做单线程持续运行补丁。

## 验收

- `node --experimental-strip-types --no-warnings scripts/check-up-sync-scheduler.mjs`：通过。
- `node --experimental-strip-types --no-warnings scripts/check-queue-record-feed.mjs`：通过。
- `node --experimental-strip-types --no-warnings scripts/check-home-dashboard-safety.mjs`：通过。
- `node --experimental-strip-types --no-warnings scripts/check-subtitle-only-queue-mode.mjs`：通过。
- `node --experimental-strip-types --no-warnings scripts/check-queue-clear-safety.mjs`：通过。
- `node scripts/check-efficiency-observability.mjs`：通过。
- `npx tsc --noEmit`：通过。
- `git diff --check`：通过；仅出现 Windows 换行提示。

## 状态

- 已完成。

# 计划：UP 主自动同步调度升级

## 当前情况

当前产品已经从旧课程制作路线收束为 UP 主驱动的 subtitle-only 字幕清洗主线。已有能力包括：

- 固定 UP / 来源列表；
- 本地 `data/registry/{up_id}.json` 视频注册表；
- 手动刷新最近视频；
- 手动选择视频加入队列；
- 队列执行 subtitle-only；
- 后台自动化框架；
- `data/materials/{up_id}/{video_id}` 资料落点；
- 清空队列不删除材料包；
- 最近页和侧边栏已成为 UP 主驱动入口。

现有不足：

- 新视频追踪还不够自动，依赖用户主动刷新或已有后台发现能力；
- 没有从新到旧补齐某个 UP 主历史视频的稳定机制；
- 自动化、队列和历史补足之间缺少统一调度；
- 过去并发或队列未规范曾导致任务过多；
- 队列页偏重操作面板，不适合作为长期运行记录流。

## 目标

实现一个长期后台运行的 UP 主同步调度器：

```text
软件运行
→ 每个准点自动检查已跟踪 UP 的新视频
→ 新视频自动入队并优先处理
→ 空闲时按 UP 优先级补足历史视频
→ 全局一次只处理 1 条视频
→ 支持暂停、恢复、失败重试、重启后接续
→ 队列页变成轻量记录流
```

最终用户效果：

> 晚上电脑保持运行或软件处于后台时，第二天早上用户能看到软件已经自动发现新视频、继续补足历史视频，并且队列页以简洁记录流显示已经发生和正在发生的任务。

## 明确不做

- 不做并发。
- 不做多 UP 同时历史补足。
- 不一次性把所有历史视频塞入队列。
- 不删除、迁移或改写 `data/materials`。
- 不恢复总结、邮件、TTS 或旧课程路线。
- 不第一版实现复杂电脑闲置检测。
- 不第一版实现复杂能耗策略。
- 不把队列页做成新的复杂控制台。

## 相关模块与数据

### 现有模块

| 模块 | 当前作用 | 本计划影响 |
|---|---|---|
| `sourceDiscoveryRuntime.ts` | 后台来源发现 | 收敛到新调度器统一调用 |
| `workbenchQueueStore.ts` | 队列读写与恢复 | 增加单工调度保护和来源类型 |
| `queueExecutor.ts` | 队列执行 | 强化一次只执行 1 条 |
| `videoRegistry.ts` | 视频注册表 | 继续作为视频元数据事实来源 |
| `pinnedSourcesStore.ts` | 固定 UP 来源 | 扩展为“已跟踪 UP”的基础 |
| `HomePane.tsx` | 最近页 | 增加暂停同步按钮 |
| `SourceSidebarPane.tsx` | 侧边栏 UP 列表 | 支持优先级排序和追踪状态展示 |
| `WorkbenchQueueParts.tsx` | 队列 UI | 重构为记录流 |

### 建议新增模块

| 新模块 | 作用 |
|---|---|
| `trackedSourcesStore.ts` | 保存已跟踪 UP、优先级、历史补足开关 |
| `upSyncStateStore.ts` | 保存全局同步状态、暂停时间、当前任务 |
| `upHistoryCrawler.ts` | 从新到旧扫描 UP 历史视频，维护游标 |
| `upSyncScheduler.ts` | 唯一自动调度器，决定下一条任务 |
| `check-up-sync-scheduler.mjs` | 自动检查调度规则 |
| `check-queue-record-feed.mjs` | 自动检查队列记录流 UI |

### 建议新增数据

```text
data/tracking/
├── tracked_sources.json
├── sync_state.json
└── history/
    ├── {up_id}.json
    └── ...
```

其中：

- `tracked_sources.json`：UP 主优先级、是否启用新视频追踪、是否启用历史补足；
- `sync_state.json`：全局暂停状态、暂停到什么时候、当前调度状态；
- `history/{up_id}.json`：单个 UP 历史补足游标和失败状态。

## 总体调度规则

### 任务来源

所有任务都必须进入统一调度器：

```text
manual  用户手动加入
fresh   准点发现的新视频
history 历史补足视频
retry   失败重试
```

### 执行优先级

```text
manual
> fresh
> history
> retry
```

### 单工规则

```text
如果存在 processing：
  不启动新任务
否则：
  从最高优先级来源领取 1 条任务
```

### 新视频打断历史补足

```text
历史补足正在排队或等待领取
→ 准点发现新视频
→ 新视频排到历史任务前
→ 当前正在处理的视频做完
→ 下一条先处理新视频
```

## 分阶段步骤

### 阶段 0：只做计划和安全边界

- 修改：
  - 新建任务文件；
  - 新建计划文件；
  - 明确数据边界、调度规则、验收标准。
- 验证：
  - 文档覆盖用户要求；
  - 未修改业务代码；
  - 未触发真实队列。
- 完成标准：
  - `docs/tasks/up-auto-sync-scheduler.md` 存在；
  - `docs/plans/up-auto-sync-scheduler-plan.md` 存在；
  - 目标模式已开启。
- 回退：
  - 删除本阶段新增文档即可。

### 阶段 1：队列单工化

状态：已完成（2026-06-29）

- 修改：
  - 把实际执行器收敛为全局一次只处理 1 条；
  - 旧并发配置不再影响真实执行；
  - 增加队列单工检查脚本；
  - 确保手动任务和后台任务都走同一执行锁。
- 验证：
  - 同时最多 1 条 `processing`；
  - 重启恢复不会产生多个 processing；
  - subtitle-only 主线仍通过；
  - 清空队列仍不删除材料。
- 完成标准：
  - 任何任务来源都不能绕过单工执行；
  - 自动检查覆盖单工规则。
- 回退：
  - 回退队列执行器和检查脚本；
  - 不涉及 `data/materials` 数据迁移。

实施记录：

- `desktop/electron/main.ts` 的工作台队列并发配置已固定为 1。
- `desktop/electron/queue/workbenchQueue.ts` 新增单工上限常量，并在领取任务时强制生效。
- `desktop/electron/queue/queueExecutor.ts` 已移除多 worker 并发执行方式，一次调度调用只处理 1 条视频。
- `desktop/scripts/check-up-sync-scheduler.mjs` 已覆盖单工领取、单次处理和禁止 `Promise.all` worker 回流。
- 验证通过：`check-up-sync-scheduler`、`check-subtitle-only-queue-mode`、`check-queue-clear-safety`、`npx tsc --noEmit`、`git diff --check`。

### 阶段 2：跟踪源状态模型

状态：已完成（阶段 2A 后端账本、阶段 2B 侧边栏优先级保存均已完成）

- 修改：
  - 第一版先在 Electron Store 中新增 `trackedBilibiliSources`，避免立即迁移真实数据；
  - 后续如需要跨工具读写，再把 Store 中的 tracking 状态安全迁移到 `data/tracking/tracked_sources.json`；
  - 将固定 UP 扩展为可跟踪 UP；
  - 为每个 UP 保存：
    - `mid`
    - `name`
    - `face`
    - `priority`
    - `trackFresh`
    - `trackHistory`
    - `historyStatus`
    - `lastCheckedAt`
  - 侧边栏支持拖动排序并保存。
- 验证：
  - 拖动 UP 顺序后重启仍保留；
  - 不影响当前固定 UP 展示；
  - 不创建队列任务；
  - 不读取或改写 `data/materials`。
- 完成标准：
  - 已跟踪 UP 有稳定状态文件；
  - UP 优先级可保存。
- 回退：
  - 删除新增 tracking store；
  - 回退侧边栏排序 UI。

阶段 2A 实施记录：

- 新增 `desktop/electron/services/trackedSourcesStore.ts`。
- 新增 `trackedBilibiliSources` Store 字段，用于保存 UP 的 `priority`、`trackFresh`、`trackHistory`、`historyStatus`、`lastCheckedAt` 等追踪状态。
- 保存固定 UP 时会同步 tracking 账本；启动时也会用现有固定 UP 校准 tracking 账本。
- 新增 `loadTrackedBilibiliSources` / `saveTrackedBilibiliSources` IPC 和 preload 类型，为侧边栏排序与追踪开关做准备。
- 新增 `desktop/scripts/check-tracked-sources-store.mjs`，覆盖默认追踪状态、优先级保留、开关保留、删除固定 UP 后 tracking 收敛，以及不触碰 `data/materials`。
- 阶段 2A 验证通过：`check-tracked-sources-store`、`check-up-sync-scheduler`、`check-subtitle-only-queue-mode`、`check-queue-clear-safety`、`check-home-dashboard-safety`、`npx tsc --noEmit`、`git diff --check`。

阶段 2B 待做：

- 无。

阶段 2B 实施记录：

- 侧边栏固定 UP 列表改为按 `trackedBilibiliSources.priority` 排序。
- 每个固定 UP 旁新增提高 / 降低优先级按钮，保存到 tracking 账本。
- 固定 UP 变化事件会同步刷新 tracking 状态，避免多个入口状态不一致。
- 档案来源分组也使用同一排序结果，保证 UP 顺序表现一致。
- 新增静态检查断言：侧边栏必须读取 / 保存 tracking、必须使用排序后的 UP 列表、必须提供提高 / 降低历史补足优先级入口。
- 验证通过：`check-home-dashboard-safety`、`check-tracked-sources-store`、`check-up-sync-scheduler`、`check-subtitle-only-queue-mode`、`npx tsc --noEmit`、`git diff --check`。

### 阶段 3：准点新视频追踪

状态：已完成（2026-06-29）

- 修改：
  - 新增准点触发器；
  - 每个准点检查已启用 `trackFresh` 的 UP；
  - API 结果合并写入 `data/registry/{up_id}.json`；
  - 与已有队列和已有材料按 BV 去重；
  - 新视频创建 `sourceType: fresh` 的 subtitle-only 队列项；
  - 增加新视频追踪检查脚本。
- 验证：
  - 准点触发只执行一次；
  - API 临时失败不清空 registry；
  - 新视频进入队列；
  - 已有视频不重复入队；
  - 历史任务让位于 fresh 任务。
- 完成标准：
  - 软件运行时无需用户点击刷新，也能在准点发现新视频；
  - 新视频自动进入统一调度器。
- 回退：
  - 关闭准点触发器；
  - 保留已写 registry，不删除真实数据。

实施记录：

- 后台检查间隔从 360 分钟收敛为 60 分钟。
- 自动化调度默认对齐到下一个整点，而不是从启动时间简单顺延 60 分钟。
- 后台发现来源从固定 UP 切换为 tracking 账本中启用 `trackFresh` 的 UP。
- 自动发现的新视频队列来源标记为 `fresh`，仍显式使用 subtitle-only。
- 准点检查成功后会更新对应 UP 的 `lastCheckedAt`，为后续同步状态和暂停后接续做准备。
- 队列领取优先级已建立：`manual > fresh/follow_source > history > retry`，为“新视频优先于历史补足”打基础。
- 新增 / 更新检查覆盖：整点调度函数、60 分钟后台间隔、`trackFresh` 过滤、新视频 `fresh` 来源、`lastCheckedAt` 更新、fresh 优先于 history/retry。
- 验证通过：`check-up-sync-scheduler`、`check-tracked-sources-store`、`check-subtitle-only-queue-mode`、`check-queue-clear-safety`、`check-home-dashboard-safety`、`npx tsc --noEmit`、`git diff --check`。

### 阶段 4：历史视频补足

状态：已完成（阶段 4A registry 单步补足、阶段 4B 深分页历史爬取和游标均已完成）

- 修改：
  - 新增 `data/tracking/history/{up_id}.json`；
  - 新增历史视频扫描器；
  - 单 UP 从新到旧扫描；
  - 每次只领取少量候选，不把全部历史一次性入队；
  - 当前 UP 完成后进入下一位；
  - 保存历史游标、失败状态和完成状态。
- 验证：
  - 按侧边栏优先级选择 UP；
  - 点击暂停后不再领取历史任务；
  - 新视频出现后历史任务让位；
  - 重启后从游标继续；
  - 已有材料和已入队视频不重复处理。
- 完成标准：
  - 可以对单个 UP 从新到旧持续补足；
  - 单 UP 完成后自动进入下一位。
- 回退：
  - 停用历史补足；
  - 保留 registry 和 history 游标作为可诊断数据；
  - 不删除材料包。

阶段 4A 实施记录：

- 新增历史补足候选选择器：从 `data/registry/{up_id}.json` 中按 UP 优先级和发布时间从新到旧选择 1 条未处理视频。
- 自动历史候选以 `queueSource: 'history'`、`pipelineMode: 'subtitle_only'` 入队。
- 后台检查只有在本轮没有 fresh 新视频、且当前没有 queued 项时，才追加 1 条 history；避免历史任务压过新视频或堆积队列。
- 队列来源优先级已覆盖 `manual > fresh/follow_source > history > retry`。
- 新增检查覆盖：history 候选按 UP 优先级选择、单 UP 内从新到旧、跳过已知 BV、关闭 `trackHistory` 时不生成任务、history 保持 subtitle-only。
- 验证通过：`check-up-sync-scheduler`、`check-subtitle-only-queue-mode`、`check-tracked-sources-store`、`check-queue-clear-safety`、`check-home-dashboard-safety`、`npx tsc --noEmit`、`git diff --check`。

阶段 4B 待做：

- 无。

阶段 4B 实施记录：

- B 站投稿列表 API 已支持指定页读取。
- tracking 状态新增 `historyPage` 和 `historyReachedEnd`，用于保存每个 UP 的历史补足页游标和是否到末页。
- 历史补足无 registry 候选时，会按 UP 优先级选择 1 个未完成 UP，翻取下一页历史投稿并合并进 registry。
- 翻页成功后推进该 UP 的 `historyPage`；若没有下一页，标记 `historyReachedEnd` 并把 `historyStatus` 置为 `completed`。
- 翻页失败时把该 UP 标记为 `failed` 并记录 runtime log，不删除资料、不清空 registry。
- 翻页后仍只从 registry 中选择 1 条 history 入队，保持每轮最多追加 1 条历史任务。
- 验证通过：`check-up-sync-scheduler`、`check-tracked-sources-store`、`check-subtitle-only-queue-mode`、`check-queue-clear-safety`、`check-home-dashboard-safety`、`npx tsc --noEmit`、`git diff --check`。

### 阶段 5：暂停同步入口

状态：已完成（2026-06-29）

- 修改：
  - 最近页刷新按钮旁增加暂停同步按钮；
  - 支持暂停 2 小时、5 小时、暂停到手动恢复；
  - 支持恢复同步；
  - 暂停状态写入 `sync_state.json`；
  - 暂停后当前视频完成，但不领取下一条。
- 验证：
  - 暂停 2 小时后自动恢复；
  - 暂停 5 小时后自动恢复；
  - 手动暂停不会自动恢复；
  - 恢复后继续新视频和历史游标；
  - 暂停不删除队列和材料。
- 完成标准：
  - 用户可以明确控制自动同步；
  - 暂停状态跨重启保留。
- 回退：
  - 隐藏暂停 UI；
  - 调度器默认只在未暂停时运行。

实施记录：

- 后台暂停状态从 boolean 升级为 `backgroundAutomationPause`，包含 `paused`、`pausedUntil` 和 `reason`，并兼容旧 `backgroundAutomationPaused`。
- 支持暂停 2 小时、暂停 5 小时、暂停到手动恢复和恢复同步。
- 暂停到期后自动恢复为非暂停状态。
- 暂停期间不安排准点检查；当前队列任务完成后不会继续领取下一条 queued 任务。
- 最近页刷新按钮旁新增极简暂停同步入口，显示暂停 / 恢复状态和暂停菜单。
- 验证通过：`check-up-sync-scheduler`、`check-home-dashboard-safety`、`check-subtitle-only-queue-mode`、`check-queue-clear-safety`、`check-tracked-sources-store`、`npx tsc --noEmit`、`git diff --check`。

### 阶段 6：失败恢复和重置

状态：已完成（2026-06-29）

- 修改：
  - 建立失败分类：
    - 临时失败；
    - 配置失败；
    - 单视频不可处理；
  - 临时失败有限重试；
  - 配置失败暂停自动化；
  - 单视频失败不阻塞整个 UP；
  - 提供失败重置入口；
  - 记录失败原因和下次重试时间。
- 验证：
  - 网络失败不会无限重试；
  - 配置失败会暂停；
  - 单视频失败后继续下一个；
  - 重置失败任务后可重新入队；
  - 重启后失败状态不丢。
- 完成标准：
  - 软件可以长期静默运行，失败不会导致全局卡死。
- 回退：
  - 保留失败记录；
  - 关闭自动重试。

实施记录：

- 队列项新增 `retryCount`、`nextRetryAt` 和 `failedAt`，失败原因继续写入 `lastError`。
- 临时失败会有限自动重试，最多 3 次，退避间隔为 5 分钟、30 分钟、2 小时。
- 未到 `nextRetryAt` 的失败重试项不会被领取，也不会阻塞其他已经可领取的任务。
- 配置类失败（例如登录 Cookie / SESSDATA / Key / 鉴权失效）会把当前任务标记为失败，并自动暂停后台同步，避免持续消耗任务。
- 自动重试耗尽后任务保留为 `failed`，不删除队列记录、不删除材料。
- 现有队列行已支持失败项点击“重新处理”；阶段 7 队列记录流会继续精简这个入口的视觉呈现。
- 验证通过：`check-up-sync-scheduler`、`check-subtitle-only-queue-mode`、`check-queue-clear-safety`、`check-home-dashboard-safety`、`check-tracked-sources-store`、`npx tsc --noEmit`、`git diff --check`。

### 阶段 7：队列页记录流重构

状态：已完成（2026-06-29）

- 修改：
  - 去除队列页旧外框和复杂操作区；
  - 使用圆角矩形记录流；
  - 初始展示 10 条；
  - 下滑继续加载；
  - 新完成视频置顶；
  - 删除多余按钮和复杂状态；
  - 保留最少必要信息：
    - 标题；
    - UP 主；
    - BV；
    - 当前状态；
    - 完成时间或失败原因；
    - 必要的重试 / 查看入口。
- 验证：
  - 记录数量超过 10 时初始只显示 10 条；
  - 滚动后加载更多；
  - 新完成记录排在顶部；
  - 已完成、失败、等待、处理中都能读懂；
  - 不影响队列执行和清空队列保护。
- 完成标准：
  - 队列页成为轻量“记录”页面；
  - 不再像复杂任务操作台。
- 回退：
  - 回退 UI 组件；
  - 不影响队列数据。

实施记录：

- 队列页移除旧大卡片外框、顶部复杂操作区、分页器、清空队列、移出队列和删除资料包等重型入口。
- 队列记录改为一条一条圆角矩形展示，保留标题、UP / BV、状态文字、失败原因和必要的查看 / 复制路径 / 重试入口。
- 初始展示数量改为 `WORKBENCH_RECORD_BATCH_SIZE = 10`；滚动接近底部时自动追加下一批，并保留一个轻量“继续加载”兜底按钮。
- 已完成资料继续使用材料 `updatedAt` 倒序输入队列记录流，新完成视频会自然排到已完成记录顶部；处理中、失败、等待任务仍优先显示，便于观察当前队列。
- 新增 `desktop/scripts/check-queue-record-feed.mjs`，防止旧外框、分页器、状态灯和清空 / 删除类按钮回流。
- 本阶段只改 UI 展示和静态检查，不读取、不迁移、不删除、不改写 `data/materials`。
- 验证通过：`check-queue-record-feed`、`check-product-refactor-surface`、`check-home-dashboard-safety`、`check-up-sync-scheduler`、`check-subtitle-only-queue-mode`、`check-queue-clear-safety`、`check-tracked-sources-store`、`npx tsc --noEmit`、`git diff --check`。
- 备注：本地 `http://localhost:5173/` HTTP 探测返回 200；本轮 in-app browser 刷新等待超时，真实桌面端视觉回归并入阶段 8 继续做。

### 阶段 8：效率观测和闲置处理研究

状态：已完成（2026-06-29）

- 修改：
  - 暂不做复杂自动闲置处理；
  - 先记录效率指标：
    - 每条视频总耗时；
    - 字幕获取耗时；
    - 转写耗时；
    - 清洗耗时；
    - token 使用；
    - 失败率；
    - 每晚完成数量。
- 验证：
  - 指标不会写入秘密值；
  - 不影响材料输出；
  - 能用来判断后续是否需要闲置处理。
- 完成标准：
  - 后续可以基于真实数据决定是否加“电脑闲置时处理”。
- 回退：
  - 删除新增观测展示；
  - 保留已有材料和队列。

实施记录：

- 第一版不新增后台采集流程，复用材料包现有 `metrics.json` 摘要。
- 队列记录流的已完成记录会显示单条视频总耗时和总 Token，便于观察自动同步处理效率。
- 档案总览继续显示累计耗时和累计 Token。
- 新增 `desktop/scripts/check-efficiency-observability.mjs`，确认库存层暴露耗时 / token 摘要、队列记录显示单条效率指标、档案页保留总量指标，并防止队列元信息显示秘密字段。
- 验证通过：`check-efficiency-observability`、`check-queue-record-feed`、`check-product-refactor-surface`、`npx tsc --noEmit`。
- 真实运行回归：当前存在 `npm run dev`、Vite 和 Electron 进程，`http://localhost:5173/` 返回 200。
- 真实自动同步证据：`data/logs/runtime.log` 记录了 2026-06-28 21:00 至 2026-06-29 02:00 多次 `background automation check trigger=timer`，并自动产生 `workbench queue processing` 记录。
- 数据安全核验：本轮只读统计 `data/materials` 文件数为 288；相关检查证明清空队列保护、subtitle-only 主线、registry 合并和队列记录流均未要求迁移、删除或改写材料。
- 备注：in-app browser DOM 读取当前仍超时；本次以真实 Electron 进程、HTTP 200、runtime log 和静态 / 类型 / 数据安全检查作为完成证据。后续如需视觉截图，可另开纯 UI 验收。

## 风险

| 风险 | 影响 | 处理方式 |
|---|---|---|
| 调度器和旧后台自动化重复运行 | 同一视频重复入队或重复处理 | 新调度器成为唯一自动领取入口，旧入口逐步转为调用新调度器 |
| 单工锁不可靠 | 多个视频同时处理 | 队列执行层和调度层双重保护 |
| 历史补足塞爆队列 | 大量历史视频导致队列不可读 | 历史补足按游标领取，限制每轮候选数量 |
| 暂停语义不清 | 用户以为暂停了但任务仍继续 | 明确：当前视频完成后停止领取下一条 |
| 失败恢复过度复杂 | 第一版难以稳定 | 先做有限重试和配置失败暂停，再做更细策略 |
| UI 拖动排序误操作 | 历史补足顺序变化 | 排序只影响历史补足，不影响新视频优先 |
| 写坏真实资料 | 数据损失 | 本计划禁止改写 `data/materials`，验收前后核对文件数量 |
| 资源消耗过高 | 夜间或闲置处理影响电脑 | 第一版单工处理，后续再加闲置策略 |

## 依赖变化

第一版不新增外部依赖。

如果后续拖动排序需要引入库，优先评估是否能用现有 React 事件实现。只有在实现成本明显过高时，才单独讨论新增依赖。

## 数据与备份

- 新增 `data/tracking` 前，应先确认 `data` 目录不在 Git 中提交。
- 不迁移 `data/materials`。
- 不删除 `data/registry`。
- 不展示或提交 Electron Store 中的秘密配置。
- 自动验收只读扫描 `data/materials`，不打开、不改写、不删除材料包。

## 完成定义

本升级完成时，应同时满足：

- 软件运行后，已跟踪 UP 主可在每个准点自动刷新；
- 新视频自动进入队列；
- 有新视频时优先处理新视频；
- 没有新视频时，按 UP 优先级从新到旧补足历史视频；
- 全局一次只处理 1 条视频；
- 暂停 2h、暂停 5h、暂停到手动恢复均可用；
- 失败可重试、可重置，配置失败会暂停；
- 软件重启后能接续同步状态和历史游标；
- 队列页是轻量记录流，初始最多 10 条，滚动加载，新完成置顶；
- subtitle-only 主线仍通过；
- 清空队列仍不删除材料；
- `data/materials` 没有被迁移、删除或改写；
- 用户第二天早上能看到后台自动同步已经产生的队列记录、处理中任务或完成资料。

2026-06-29 完成核验：

- 以上完成定义均已由 `check-up-sync-scheduler`、`check-queue-record-feed`、`check-efficiency-observability`、`check-subtitle-only-queue-mode`、`check-queue-clear-safety`、`check-video-registry-layer`、`check-home-dashboard-safety`、`check-tracked-sources-store`、`npx tsc --noEmit`、`git diff --check` 和真实 `data/logs/runtime.log` 运行记录覆盖。

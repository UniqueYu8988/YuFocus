# UP 主自动同步调度升级

创建日期：2026-06-29
状态：已完成（2026-06-29）

## 1. 目标

把当前“手动查看最近视频、手动加入队列”的工作方式，升级为长期后台自动同步机制：

- 软件运行后，已跟踪 UP 主在每个准点自动刷新视频数据；
- 发现新视频后自动进入队列；
- 队列全局一次只处理一条视频，不做并发处理；
- 新视频优先于历史补足；
- 已跟踪 UP 主可以从新到旧补足历史视频；
- 历史补足按侧边栏 UP 主优先级顺序执行，一个 UP 完成后再进入下一位；
- 支持暂停同步 2 小时、5 小时、暂停到手动恢复；
- 支持失败重试、失败重置、暂停后接续和重启后恢复；
- “队列”板块改为轻量记录流，重点展示任务记录，而不是复杂操作台。

最终效果：

> 软件运行时会在后台静默同步和处理。用户早上打开电脑或查看软件时，能看到程序已经自动发现、入队并正在处理或已经完成部分 UP 主视频资料。

## 2. 背景

当前系统已经具备：

- 固定 UP / 来源列表；
- `data/registry/{up_id}.json` 本地视频注册表；
- 队列；
- subtitle-only 资料生成；
- 后台自动化框架；
- `data/materials/{up_id}/{video_id}` 资料落点；
- 清空队列不删除材料包的保护。

当前不足：

- 只能稳定看到最近视频，缺乏自动补足历史视频的机制；
- 自动化发现和队列执行还没有统一调度规则；
- 过去并发设计曾导致任务过多和状态混乱；
- 队列页目前仍偏“操作面板”，而未来它更应该是“处理记录流”。

## 3. 本次范围

- 新建 UP 主自动同步调度机制。
- 新建两条追踪线：
  - 新视频追踪线：每个准点刷新已跟踪 UP 主，发现新视频后自动入队；
  - 历史补足线：对已跟踪 UP 主从新到旧扫描历史视频，逐步补齐。
- 建立全局单工队列规则：任何时候最多只有 1 条视频处于实际处理状态。
- 建立新视频优先规则：有新视频时，历史补足暂停领取新任务，先处理新视频。
- 建立 UP 主历史优先级：侧边栏支持拖动排序，历史补足按排序逐个 UP 执行。
- 建立暂停同步入口：最近页刷新按钮旁增加暂停同步按钮。
- 建立暂停选项：
  - 暂停 2 小时；
  - 暂停 5 小时；
  - 暂停到手动恢复；
  - 恢复同步。
- 建立失败处理机制：
  - 临时失败自动重试；
  - 配置失败暂停自动处理并提示；
  - 单视频失败可跳过，不阻塞整个 UP；
  - 支持重置失败任务。
- 重构队列页 UI：
  - 去除外框；
  - 只展示一条一条圆角矩形记录；
  - 删除多余按钮和复杂状态显示；
  - 初始最多展示 10 条；
  - 向下滚动继续加载；
  - 新完成的视频显示在最上方；
  - 队列页重点作为“记录”而不是“控制台”。

## 4. 明确不做

- 不做并发处理。
- 不一次性把某个 UP 的所有历史视频全部塞进队列。
- 不在没有去重检查的情况下自动入队。
- 不在历史补足时压过新视频。
- 不删除、不迁移、不重命名 `data/materials` 中的真实资料。
- 不恢复总结、邮件、TTS 或旧课程制作路线。
- 不把历史补足和 Summary Pipeline 绑定。
- 不在第一版做复杂闲置检测、GPU/CPU 调度或夜间电源策略。
- 不把失败任务无限重试。
- 不把队列页继续扩成复杂操作台。

## 5. 验收标准

### 自动追踪

- [ ] 软件运行时，每个准点会触发一次已跟踪 UP 主刷新。
- [ ] 准点错过后，恢复运行只补一次检查，不连续补跑多个错过准点。
- [ ] API 临时失败不会清空 `data/registry/{up_id}.json`。
- [ ] 新视频会自动进入队列。
- [ ] 已有材料或已在队列的视频不会重复入队。

### 队列单工

- [ ] 任意时刻最多 1 条任务处于 `processing`。
- [ ] 手动加入、新视频追踪、历史补足和失败重试都必须通过同一个调度器领取任务。
- [ ] 没有任何旧入口能绕过调度器直接启动处理。

### 新视频优先

- [ ] 历史补足运行时，如果发现新视频，新视频排在历史任务前。
- [ ] 正在处理的视频不被强行中断；处理完当前视频后优先处理新视频。

### 历史补足

- [ ] 历史补足按侧边栏 UP 主优先级执行。
- [ ] 单个 UP 从新到旧扫描历史视频。
- [ ] 当前 UP 完成后才进入下一位 UP。
- [ ] 每个 UP 的历史扫描游标可保存和恢复。
- [ ] 暂停或关闭软件后，下次能从上次游标继续。

### 暂停与恢复

- [ ] 最近页刷新按钮旁有暂停同步入口。
- [ ] 可暂停 2 小时。
- [ ] 可暂停 5 小时。
- [ ] 可暂停到手动恢复。
- [ ] 暂停后不领取新任务；当前正在处理的视频允许完成。
- [ ] 恢复后继续处理新视频和历史游标。

### 失败恢复

- [ ] 网络或接口临时失败会有限次数重试。
- [ ] 配置失败会暂停自动化并提示，不继续消耗任务。
- [ ] 单视频失败不会阻塞整个 UP。
- [ ] 失败任务可以重置。
- [ ] 重启软件后，异常中断的任务可恢复到安全状态。

### 队列页减负

- [x] 队列页去除旧外框和多余复杂操作区。
- [x] 队列页以圆角矩形记录流展示任务。
- [x] 初始最多展示 10 条。
- [x] 向下滚动继续加载更多记录。
- [x] 新完成的视频显示在最上方。
- [x] 队列页保留必要记录信息：标题、UP 主、BV、状态、完成时间或错误原因。
- [x] 删除多余按钮和状态显示，不影响核心暂停、恢复和失败处理入口。

### 数据安全

- [ ] 不删除 `data/materials`。
- [ ] 不迁移 `data/materials`。
- [ ] 不改写已有材料包内容。
- [ ] 清空队列仍不删除材料包。
- [ ] 自动同步只写必要的 registry、队列、同步状态和日志。

## 6. 相关文件和数据

预计会涉及：

- `desktop/electron/runtime/automationRuntime.ts`
- `desktop/electron/queue/workbenchQueueStore.ts`
- `desktop/electron/queue/queueExecutor.ts`
- `desktop/electron/providers/sourceDiscoveryRuntime.ts`
- `desktop/electron/providers/sourceDiscovery.ts`
- `desktop/electron/services/videoRegistry.ts`
- `desktop/electron/services/pinnedSourcesStore.ts`
- `desktop/electron/ipc/sourceIpcHandlers.ts`
- `desktop/electron/ipc/workbenchQueueIpcHandlers.ts`
- `desktop/src/ui/pages/HomePane.tsx`
- `desktop/src/ui/panels/SourceSidebarPane.tsx`
- `desktop/src/ui/panels/workspace/WorkbenchQueueParts.tsx`
- `desktop/src/ui/pages/WorkspacePane.tsx`
- `desktop/src/vite-env.d.ts`
- `desktop/scripts/check-subtitle-only-queue-mode.mjs`
- `desktop/scripts/check-home-dashboard-safety.mjs`

建议新增：

- `desktop/electron/services/trackedSourcesStore.ts`
- `desktop/electron/services/upSyncStateStore.ts`
- `desktop/electron/providers/upHistoryCrawler.ts`
- `desktop/electron/runtime/upSyncScheduler.ts`
- `desktop/scripts/check-up-sync-scheduler.mjs`
- `desktop/scripts/check-queue-record-feed.mjs`

建议新增数据：

```text
data/tracking/
├── tracked_sources.json
├── sync_state.json
└── history/
    ├── {up_id}.json
    └── ...
```

说明：

- `data/registry/{up_id}.json` 继续只保存视频元数据；
- `data/tracking` 保存同步调度状态、UP 优先级和历史游标；
- `data/materials` 仍只保存生产资料，不参与调度状态存储。

## 7. 风险

| 风险 | 影响 | 处理方式 |
|---|---|---|
| 自动化失控入队 | 队列爆炸、重复处理、资源浪费 | 所有自动任务统一经过调度器，先去重再入队 |
| 并发处理回流 | 多条视频同时下载、转写或清洗 | 全局单工锁；检查脚本禁止并发配置重新生效 |
| 历史视频数量巨大 | 长时间占用资源 | 历史补足按 UP 游标小步推进，不一次性塞满队列 |
| 新视频被历史任务淹没 | 用户关心的新内容延迟 | 新视频优先，历史补足只在新视频为空时领取 |
| 失败无限重试 | 资源浪费、日志膨胀 | 有限重试和指数退避；配置失败直接暂停 |
| 软件重启后状态错乱 | 重复处理或丢失进度 | 每条任务和每个 UP 游标持久化 |
| 写坏真实资料 | 数据损失 | 本任务禁止改写 `data/materials`；只读材料扫描 |
| UI 过重 | 队列页难读 | 队列页改为记录流，复杂操作转移到必要菜单或详情 |

## 8. 验证方式

- 自动测试：
  - 单工调度纯函数检查；
  - 新视频优先检查；
  - 历史游标恢复检查；
  - 暂停 / 恢复状态检查；
  - 队列记录流 UI 静态检查；
  - subtitle-only 主线检查；
  - 清空队列保护检查；
  - registry 合并不丢视频检查。
- 人工验收：
  - 启动桌面端，确认同步状态可见；
  - 设置 1 个低风险 UP；
  - 验证准点或模拟准点发现新视频；
  - 验证历史补足只领取 1 条；
  - 验证暂停 2h / 5h / 手动恢复；
  - 验证队列页为记录流。
- 构建或类型检查：
  - `desktop` 下 `npx tsc --noEmit`；
  - 必要时运行受控 Electron 验收；
  - 不执行会改写构建产物的完整 build，除非单独确认。

## 9. 完成记录

### 2026-06-29：阶段 0 计划完成

- 已建立任务文件和升级计划。
- 已明确自动追踪、历史补足、单工队列、暂停恢复、失败处理和队列页减负范围。
- 本阶段未修改业务代码，未触发真实队列，未读取或改写 `data/materials`。

### 2026-06-29：阶段 1 队列单工化完成

- `WORKBENCH_QUEUE_CONCURRENCY` 已从 3 收敛为 1。
- 队列领取函数新增硬性单工上限，即使传入更高并发，也不能在已有 `processing` 时领取第二条。
- 队列执行器一次调用只领取并处理 1 条任务，剩余等待项交回调度器续跑。
- 新增 `desktop/scripts/check-up-sync-scheduler.mjs`，覆盖并发参数回流、多 worker 回流和一次调用处理多条任务的风险。
- 已验证：新增单工检查、subtitle-only 主线检查、清空队列保护检查、TypeScript 类型检查和 Git 空白检查。

### 2026-06-29：阶段 2A 跟踪源后端账本完成

- 新增 `trackedBilibiliSources` Store 字段，先在现有 Electron Store 内保存追踪状态，不立即做 `data/tracking` 文件迁移。
- 新增 `trackedSourcesStore`，可从固定 UP 自动生成追踪状态，并保留已有 `priority`、`trackFresh`、`trackHistory`、`historyStatus` 和 `lastCheckedAt`。
- 固定 UP 保存时会同步 tracking 账本；启动时也会用现有固定 UP 校准 tracking。
- 新增 tracking 读取 / 保存 IPC 和 preload 类型，为侧边栏排序和追踪开关做准备。
- 新增 `desktop/scripts/check-tracked-sources-store.mjs`，覆盖 tracking 默认值、优先级保留、删除固定 UP 后收敛，以及不触碰 `data/materials`。
- 已验证：tracking 检查、单工检查、subtitle-only 主线检查、清空队列保护、最近页安全检查、TypeScript 类型检查和 Git 空白检查。
- 尚未完成：侧边栏拖动排序 UI、准点新视频追踪、历史补足、暂停同步入口和队列记录流 UI。

### 2026-06-29：阶段 2B 侧边栏 UP 优先级完成

- 侧边栏固定 UP 列表现在按 `trackedBilibiliSources.priority` 展示。
- 每个固定 UP 提供提高 / 降低优先级按钮，保存后会更新 tracking 账本。
- 固定 UP 变化时会同步刷新 tracking 状态，避免显示顺序和追踪账本脱节。
- 档案来源分组复用同一排序结果，UP 顺序表现更一致。
- 最近页 / 侧边栏安全检查已补充 tracking 排序断言。
- 已验证：最近页安全检查、tracking 检查、单工检查、subtitle-only 主线检查、TypeScript 类型检查和 Git 空白检查。
- 尚未完成：准点新视频追踪、历史补足、暂停同步入口、失败重试策略和队列记录流 UI。

### 2026-06-29：阶段 3 准点新视频追踪完成

- 后台检查间隔已收敛为 60 分钟，并默认对齐到下一个整点。
- 自动新视频追踪来源改为 tracking 账本中启用 `trackFresh` 的 UP。
- 自动发现的新视频会继续走 registry 合并和已知 BV 去重，并以 `queueSource: 'fresh'`、`pipelineMode: 'subtitle_only'` 自动入队。
- 准点检查成功后会更新对应 UP 的 `lastCheckedAt`。
- 队列领取优先级已建立：`manual > fresh/follow_source > history > retry`，保证后续历史补足上线后，新视频能排在历史任务前。
- 已验证：调度检查、tracking 检查、subtitle-only 主线检查、清空队列保护、最近页安全检查、TypeScript 类型检查和 Git 空白检查。
- 尚未完成：历史视频补足、暂停同步入口、失败重试策略、队列记录流 UI。

### 2026-06-29：阶段 4A 历史补足单步调度完成

- 新增历史补足候选选择器，先基于当前 `data/registry/{up_id}.json` 中已有视频做安全单步补足。
- 历史补足按 tracking 优先级选择 UP，并在单个 UP 内按发布时间从新到旧选择未处理视频。
- 每次后台检查最多只追加 1 条 `history` 队列项。
- 如果本轮发现 fresh 新视频，或当前队列已有 queued 项，则不会追加 history，避免队列被历史任务淹没。
- history 队列项保持 `pipelineMode: 'subtitle_only'`、`editorialMode: 'off'`。
- 已验证：调度检查、subtitle-only 主线检查、tracking 检查、清空队列保护、最近页安全检查、TypeScript 类型检查和 Git 空白检查。
- 尚未完成：B 站历史投稿深分页、每 UP 历史游标、单 UP 完成后切换下一位、暂停 / 重启后按历史游标接续、失败重试策略、队列记录流 UI。

### 2026-06-29：阶段 4B 历史深分页和游标完成

- B 站投稿列表 API 已支持指定页读取。
- tracking 状态新增 `historyPage` 和 `historyReachedEnd`，保存每个 UP 的历史补足游标。
- 当 registry 中没有可补历史候选时，后台会按 UP 优先级选择 1 个未完成 UP，翻取下一页历史投稿并合并进 registry。
- 翻页成功后推进 `historyPage`；到末页后标记 `historyReachedEnd`，并把 `historyStatus` 置为 `completed`。
- 翻页失败时把该 UP 标记为 `failed` 并写 runtime log，不删除、不迁移、不改写 `data/materials`。
- 翻页后仍只追加 1 条 `history` 队列任务，保持单步补足和新视频优先。
- 已验证：调度检查、tracking 检查、subtitle-only 主线检查、清空队列保护、最近页安全检查、TypeScript 类型检查和 Git 空白检查。
- 尚未完成：暂停 2h / 5h / 手动恢复、失败重试细化、队列记录流 UI。

### 2026-06-29：阶段 5 暂停同步入口完成

- 后台暂停状态从旧 boolean 升级为带 `pausedUntil` 和 `reason` 的状态，并兼容旧暂停字段。
- 最近页刷新按钮旁新增暂停同步入口。
- 支持暂停 2 小时、暂停 5 小时、暂停到手动恢复和恢复同步。
- 暂停期间不会安排准点检查。
- 当前正在处理的视频允许完成，但完成后不会继续领取下一条 queued 任务。
- 暂停到期后会自动恢复为非暂停状态。
- 已验证：调度检查、最近页安全检查、subtitle-only 主线检查、清空队列保护、tracking 检查、TypeScript 类型检查和 Git 空白检查。
- 尚未完成：队列记录流 UI。

### 2026-06-29：阶段 6 失败恢复和重试完成

- 队列项新增 `retryCount`、`nextRetryAt` 和 `failedAt`，失败原因继续保存在 `lastError`。
- 临时失败会自动转回 queued，并以 `queueSource: 'retry'` 标记，最多重试 3 次。
- 自动重试采用 5 分钟、30 分钟、2 小时退避；未到重试时间的任务不会被领取，也不会阻塞其他可领取任务。
- 配置类失败（登录 Cookie / SESSDATA / Key / 鉴权失效等）会标记当前任务失败，并暂停后台同步，避免静默反复失败。
- 重试耗尽后保留失败队列记录，不删除材料、不清空 registry。
- 现有队列行已支持失败项重新处理；后续阶段 7 会在记录流 UI 中保留必要入口并进一步减负。
- 已验证：调度检查、subtitle-only 主线检查、清空队列保护、最近页安全检查、tracking 检查、TypeScript 类型检查和 Git 空白检查。
- 当时尚未完成：队列记录流 UI；现已在阶段 7 完成。

### 2026-06-29：阶段 7 队列记录流 UI 完成

- 队列页从旧操作台改为轻量记录流：去掉旧大外框、顶部操作区、分页器、清空队列、移出队列和删除资料包等重型入口。
- 队列记录改为圆角矩形条目，只保留标题、UP 主 / BV、状态文字、失败原因，以及必要的查看、复制路径、失败重试入口。
- 初始展示数量改为 10 条；滚动接近底部时自动追加下一批，并保留“继续加载”作为兜底。
- 已完成资料按材料更新时间倒序输入记录流，新完成视频会排在已完成记录顶部；处理中、失败、等待任务仍优先显示。
- 新增 `desktop/scripts/check-queue-record-feed.mjs`，覆盖初始 10 条、滚动加载、旧外框 / 分页器 / 状态灯 / 清空删除按钮不回流。
- 已验证：队列记录流检查、产品表面检查、最近页安全检查、调度检查、subtitle-only 主线检查、清空队列保护、tracking 检查、TypeScript 类型检查和 Git 空白检查。
- 本地 `http://localhost:5173/` HTTP 探测返回 200；in-app browser 刷新等待超时，后续如需截图可另开纯 UI 验收。
- 当时尚未完成：阶段 8 效率观测与真实运行回归；现已在阶段 8 完成。

### 2026-06-29：阶段 8 效率观测和真实运行回归完成

- 第一版暂不新增复杂闲置检测或后台采集流程，先复用材料包已有 `metrics.json` 摘要。
- 队列记录流的已完成记录会显示单条视频总耗时和总 Token，方便判断自动同步处理效率。
- 档案总览继续显示累计耗时和累计 Token。
- 新增 `desktop/scripts/check-efficiency-observability.mjs`，覆盖库存层 metrics 字段、队列记录单条效率指标、档案总量指标，以及队列元信息不显示秘密字段。
- 真实运行回归：当前存在 `npm run dev`、Vite 和 Electron 进程；`http://localhost:5173/` 返回 200。
- 真实自动同步证据：`data/logs/runtime.log` 记录了 2026-06-28 21:00 至 2026-06-29 02:00 多次准点后台检查，并自动产生队列处理记录。
- 数据安全核验：本轮只读统计 `data/materials` 文件数为 288；未执行删除、迁移、重命名或真实清空材料操作。
- 已验证：效率观测检查、队列记录流检查、产品表面检查、最近页安全检查、自动同步调度检查、subtitle-only 主线检查、清空队列保护、tracking 检查、视频注册表检查、TypeScript 类型检查和 Git 空白检查。

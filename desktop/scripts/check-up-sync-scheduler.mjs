import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  claimNextQueuedWorkbenchItemFromList,
  getNextWorkbenchQueueRetryAt,
  normalizeWorkbenchQueueItem,
  WORKBENCH_QUEUE_SINGLE_WORKER_LIMIT,
} from '../electron/queue/workbenchQueue.ts'

async function importQueueExecutorForNodeCheck() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-up-sync-scheduler-'))
  const sourceRoot = path.resolve(import.meta.dirname, '..', 'electron', 'queue')
  const workbenchQueueSource = fs.readFileSync(path.join(sourceRoot, 'workbenchQueue.ts'), 'utf-8')
  const queueExecutorSource = fs.readFileSync(path.join(sourceRoot, 'queueExecutor.ts'), 'utf-8')
    .replace("from './workbenchQueue'", "from './workbenchQueue.ts'")

  fs.writeFileSync(path.join(tempDir, 'workbenchQueue.ts'), workbenchQueueSource, 'utf-8')
  fs.writeFileSync(path.join(tempDir, 'queueExecutor.ts'), queueExecutorSource, 'utf-8')
  const module = await import(pathToFileURL(path.join(tempDir, 'queueExecutor.ts')).href)
  fs.rmSync(tempDir, { recursive: true, force: true })
  return module
}

async function importAutomationControllerForNodeCheck() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-automation-controller-'))
  const electronRoot = path.resolve(import.meta.dirname, '..', 'electron')
  const automationControllerSource = fs.readFileSync(path.join(electronRoot, 'runtime', 'automationController.ts'), 'utf-8')
    .replace("from '../queue/workbenchQueue'", "from './workbenchQueue.ts'")
    .replace("from '../queue/workbenchQueue'", "from './workbenchQueue.ts'")
  fs.writeFileSync(path.join(tempDir, 'automationController.ts'), automationControllerSource, 'utf-8')
  fs.copyFileSync(path.join(electronRoot, 'queue', 'workbenchQueue.ts'), path.join(tempDir, 'workbenchQueue.ts'))
  const module = await import(pathToFileURL(path.join(tempDir, 'automationController.ts')).href)
  fs.rmSync(tempDir, { recursive: true, force: true })
  return module
}

async function importSourceDiscoveryForNodeCheck() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-source-discovery-'))
  const electronRoot = path.resolve(import.meta.dirname, '..', 'electron')
  const providerRoot = path.join(electronRoot, 'providers')
  const servicesRoot = path.join(electronRoot, 'services')
  const queueRoot = path.join(electronRoot, 'queue')
  const sourceDiscoverySource = fs.readFileSync(path.join(providerRoot, 'sourceDiscovery.ts'), 'utf-8')
    .replace("from './bilibiliSourceApi'", "from './bilibiliSourceApi.ts'")
    .replace("from '../services/materialInventory'", "from './materialInventory.ts'")
    .replace("from '../queue/workbenchQueue'", "from './workbenchQueue.ts'")
    .replace("from '../services/videoRegistry'", "from './videoRegistry.ts'")
  fs.writeFileSync(path.join(tempDir, 'sourceDiscovery.ts'), sourceDiscoverySource, 'utf-8')
  fs.copyFileSync(path.join(providerRoot, 'bilibiliSourceApi.ts'), path.join(tempDir, 'bilibiliSourceApi.ts'))
  fs.copyFileSync(path.join(servicesRoot, 'videoRegistry.ts'), path.join(tempDir, 'videoRegistry.ts'))
  fs.copyFileSync(path.join(queueRoot, 'workbenchQueue.ts'), path.join(tempDir, 'workbenchQueue.ts'))
  fs.writeFileSync(path.join(tempDir, 'materialInventory.ts'), 'export {}\n', 'utf-8')
  const module = await import(pathToFileURL(path.join(tempDir, 'sourceDiscovery.ts')).href)
  fs.rmSync(tempDir, { recursive: true, force: true })
  return module
}

function readProjectSource(relativePath) {
  return fs.readFileSync(path.resolve(import.meta.dirname, '..', relativePath), 'utf-8')
}

function makeQueueItem(queueId, bvid, status = 'queued') {
  return {
    queueId,
    bvid,
    aid: '',
    title: `单工检查 ${queueId}`,
    authorMid: 'codex-up',
    authorName: 'Codex UP',
    sourceName: 'Codex UP',
    pic: '',
    description: '',
    durationText: '00:30',
    durationSeconds: 30,
    pubdate: 1_700_000_000,
    statView: 0,
    url: `https://www.bilibili.com/video/${bvid}`,
    queueSource: 'manual',
    editorialMode: 'off',
    pipelineMode: 'subtitle_only',
    status,
    queuedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function writeRegistryFixture(registryRoot, upId, videos) {
  fs.mkdirSync(registryRoot, { recursive: true })
  const entries = Object.fromEntries(videos.map((video) => [video.bvid, {
    title: video.title,
    bvid: video.bvid,
    aid: '',
    author_mid: upId,
    author_name: video.authorName,
    pic: '',
    description: '',
    published_time: new Date(video.pubdate * 1000).toISOString(),
    pubdate: video.pubdate,
    duration: '00:30',
    duration_seconds: 30,
    stat_view: 0,
    url: `https://www.bilibili.com/video/${video.bvid}`,
    status: 'fetched',
    last_seen: new Date().toISOString(),
    cached: true,
  }]))
  fs.writeFileSync(path.join(registryRoot, `${upId}.json`), `${JSON.stringify({
    up_id: upId,
    videos: entries,
    last_sync: new Date().toISOString(),
  }, null, 2)}\n`, 'utf-8')
}

const { getNextHourlyCheckDelayMs } = await importAutomationControllerForNodeCheck()

assert.equal(WORKBENCH_QUEUE_SINGLE_WORKER_LIMIT, 1, '队列单工上限必须固定为 1。')
assert.equal(getNextHourlyCheckDelayMs(0), 60 * 60 * 1000, '整点检查完成后，下一次应排到下一个整点。')
assert.equal(getNextHourlyCheckDelayMs(10 * 60 * 60 * 1000 + 13 * 60 * 1000), 47 * 60 * 1000, '非整点启动时应对齐到下一个整点。')
assert.equal(getNextHourlyCheckDelayMs(10 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59_000), 1_000, '整点前 1 秒应在 1 秒后检查。')

const freshQueueItem = normalizeWorkbenchQueueItem({
  ...makeQueueItem('fresh-queue', 'BVfresh001'),
  queueSource: 'fresh',
})
assert.equal(freshQueueItem?.queueSource, 'fresh', '新视频自动追踪任务必须保留 fresh 来源。')
assert.equal(freshQueueItem?.pipelineMode, 'subtitle_only', 'fresh 队列项默认仍应保持 subtitle-only。')
assert.equal(normalizeWorkbenchQueueItem({
  ...makeQueueItem('skipped-queue', 'BVskipped001'),
  status: 'skipped',
})?.status, 'skipped', '队列必须保留 skipped 状态，不能回退成 queued。')

const firstClaim = claimNextQueuedWorkbenchItemFromList([
  makeQueueItem('queue-1', 'BVsingle001'),
  makeQueueItem('queue-2', 'BVsingle002'),
], 3)
assert.equal(firstClaim.item?.queueId, 'queue-1')
assert.equal(firstClaim.items.filter((item) => item.status === 'processing').length, 1)

const secondClaim = claimNextQueuedWorkbenchItemFromList(firstClaim.items, 3)
assert.equal(secondClaim.item, null, '已有 processing 时，即使传入并发 3，也不能再领取第二条。')
assert.equal(secondClaim.items.filter((item) => item.status === 'processing').length, 1)

const priorityClaim = claimNextQueuedWorkbenchItemFromList([
  { ...makeQueueItem('history-queue', 'BVhistory001'), queueSource: 'history', queuedAt: 1 },
  { ...makeQueueItem('retry-queue', 'BVretry001'), queueSource: 'retry', queuedAt: 2 },
  { ...makeQueueItem('fresh-queue', 'BVfresh002'), queueSource: 'fresh', queuedAt: 3 },
], 1)
assert.equal(priorityClaim.item?.queueId, 'fresh-queue', 'fresh 新视频必须优先于 history 和 retry。')

const manualPriorityClaim = claimNextQueuedWorkbenchItemFromList([
  { ...makeQueueItem('fresh-queue', 'BVfresh003'), queueSource: 'fresh', queuedAt: 1 },
  { ...makeQueueItem('manual-queue', 'BVmanual001'), queueSource: 'manual', queuedAt: 2 },
], 1)
assert.equal(manualPriorityClaim.item?.queueId, 'manual-queue', '用户手动任务必须优先于自动 fresh。')

const futureRetryClaim = claimNextQueuedWorkbenchItemFromList([
  { ...makeQueueItem('future-retry', 'BVretryFuture'), queueSource: 'retry', nextRetryAt: Date.now() + 60_000 },
  { ...makeQueueItem('history-ready', 'BVhistoryReady'), queueSource: 'history' },
], 1)
assert.equal(futureRetryClaim.item?.queueId, 'history-ready', '未到期 retry 不能被领取，也不能阻塞其它可领取任务。')

const nextRetryAtProbe = Date.now() + 120_000
assert.equal(getNextWorkbenchQueueRetryAt([
  { ...makeQueueItem('future-retry-late', 'BVretryLate'), queueSource: 'retry', nextRetryAt: Date.now() + 240_000 },
  { ...makeQueueItem('future-retry-soon', 'BVretrySoon'), queueSource: 'retry', nextRetryAt: nextRetryAtProbe },
  { ...makeQueueItem('ready-history', 'BVreadyHistory'), queueSource: 'history' },
]), nextRetryAtProbe, '队列必须能找到最近的未来重试唤醒时间。')

const { discoverHistoryBackfillVideo } = await importSourceDiscoveryForNodeCheck()
const historyRegistryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-history-registry-'))
writeRegistryFixture(historyRegistryRoot, 'up-low', [
  { bvid: 'BVlowNew', title: '低优先级新视频', pubdate: 300, authorName: '低优先级 UP' },
])
writeRegistryFixture(historyRegistryRoot, 'up-high', [
  { bvid: 'BVhighOld', title: '高优先级旧视频', pubdate: 100, authorName: '高优先级 UP' },
  { bvid: 'BVhighNewKnown', title: '高优先级已知新视频', pubdate: 400, authorName: '高优先级 UP' },
  { bvid: 'BVhighMiddle', title: '高优先级候选视频', pubdate: 200, authorName: '高优先级 UP' },
])
const historyCandidate = discoverHistoryBackfillVideo({
  registryRoot: historyRegistryRoot,
  sources: [
    { mid: 'up-low', name: '低优先级 UP', face: '', sign: '', officialTitle: '', pinnedAt: 2, priority: 9, trackHistory: true },
    { mid: 'up-high', name: '高优先级 UP', face: '', sign: '', officialTitle: '', pinnedAt: 1, priority: 0, trackHistory: true },
  ],
  knownBvids: new Set(['BVhighNewKnown']),
})
assert.equal(historyCandidate?.bvid, 'BVhighMiddle', '历史补足必须按 UP 优先级，并在单 UP 内从新到旧选择未处理视频。')
assert.equal(historyCandidate?.queueSource, 'history')
assert.equal(historyCandidate?.pipelineMode, 'subtitle_only')
assert.equal(discoverHistoryBackfillVideo({
  registryRoot: historyRegistryRoot,
  sources: [{ mid: 'up-high', name: '高优先级 UP', face: '', sign: '', officialTitle: '', pinnedAt: 1, priority: 0, trackHistory: false }],
  knownBvids: new Set(),
}), null, '关闭 trackHistory 的 UP 不能产生历史补足任务。')
fs.rmSync(historyRegistryRoot, { recursive: true, force: true })

const { runWorkbenchQueueExecutor } = await importQueueExecutorForNodeCheck()
let queue = [
  makeQueueItem('queue-1', 'BVsingle001'),
  makeQueueItem('queue-2', 'BVsingle002'),
]
let claimCount = 0
let distillCount = 0

const result = await runWorkbenchQueueExecutor({
  reason: 'single-worker-check',
  concurrency: 3,
  loadQueue: () => queue,
  claimNextQueuedItem: () => {
    const claimed = claimNextQueuedWorkbenchItemFromList(queue, 3)
    queue = claimed.items
    if (claimed.item) claimCount += 1
    return claimed.item
  },
  updateQueueItem: (queueId, patch) => {
    queue = queue.map((item) => (item.queueId === queueId ? { ...item, ...patch } : item))
  },
  loadSettings: () => ({ memoryOnly: true }),
  findMaterialRecordByBvid: () => null,
  findMaterialRecordByPath: () => null,
  isMaterialRecordSummaryReady: () => false,
  isMaterialRecordCleaned: () => false,
  archiveMaterialRecord: () => {},
  runDistiller: async () => {
    distillCount += 1
    return { materialPath: 'memory://materials/codex-up/bvsingle001' }
  },
  runMaterialSummary: async () => ({ editorialSummary: { status: 'summary_ready' } }),
  getMaterialPathFromDistillResult: (distillResult) => distillResult.materialPath ?? '',
  setAutomationStatus: () => {},
  appendRuntimeLog: () => {},
  broadcastStatus: () => {},
})

assert.equal(result.processed, 1, '执行器一次调用只能处理 1 条。')
assert.equal(result.failed, 0)
assert.equal(result.shouldContinue, true, '剩余 queued 任务应交回调度器续跑，而不是同一次并发处理。')
assert.equal(claimCount, 1)
assert.equal(distillCount, 1)
assert.equal(queue.filter((item) => item.status === 'done').length, 1)
assert.equal(queue.filter((item) => item.status === 'queued').length, 1)

let retryQueue = [makeQueueItem('retry-source', 'BVretrySource')]
const retryResult = await runWorkbenchQueueExecutor({
  reason: 'retry-check',
  concurrency: 1,
  loadQueue: () => retryQueue,
  claimNextQueuedItem: () => {
    const claimed = claimNextQueuedWorkbenchItemFromList(retryQueue, 1)
    retryQueue = claimed.items
    return claimed.item
  },
  updateQueueItem: (queueId, patch) => {
    retryQueue = retryQueue.map((item) => (item.queueId === queueId ? { ...item, ...patch } : item))
  },
  loadSettings: () => ({ memoryOnly: true }),
  findMaterialRecordByBvid: () => null,
  findMaterialRecordByPath: () => null,
  isMaterialRecordSummaryReady: () => false,
  isMaterialRecordCleaned: () => false,
  archiveMaterialRecord: () => {},
  runDistiller: async () => {
    throw new Error('网络临时失败')
  },
  runMaterialSummary: async () => ({ editorialSummary: { status: 'summary_ready' } }),
  getMaterialPathFromDistillResult: (distillResult) => distillResult.materialPath ?? '',
  setAutomationStatus: () => {},
  appendRuntimeLog: () => {},
  broadcastStatus: () => {},
})
assert.equal(retryResult.failed, 1)
assert.equal(retryResult.skipped, 0)
assert.equal(retryQueue[0].status, 'queued')
assert.equal(retryQueue[0].queueSource, 'retry')
assert.equal(retryQueue[0].retryCount, 1)
assert.ok((retryQueue[0].nextRetryAt ?? 0) > Date.now())
assert.equal(retryResult.shouldContinue, false, '未到期 retry 不能让调度器立即继续空转。')
assert.ok(retryResult.nextRetryAt, '临时失败进入 retry 后必须返回下一次唤醒时间。')

let skippedQueue = [makeQueueItem('paid-video', 'BVpaidVideo')]
const skippedLogs = []
const skippedResult = await runWorkbenchQueueExecutor({
  reason: 'skip-paid-check',
  concurrency: 1,
  loadQueue: () => skippedQueue,
  claimNextQueuedItem: () => {
    const claimed = claimNextQueuedWorkbenchItemFromList(skippedQueue, 1)
    skippedQueue = claimed.items
    return claimed.item
  },
  updateQueueItem: (queueId, patch) => {
    skippedQueue = skippedQueue.map((item) => (item.queueId === queueId ? { ...item, ...patch } : item))
  },
  loadSettings: () => ({ memoryOnly: true }),
  findMaterialRecordByBvid: () => null,
  findMaterialRecordByPath: () => null,
  isMaterialRecordSummaryReady: () => false,
  isMaterialRecordCleaned: () => false,
  archiveMaterialRecord: () => {},
  runDistiller: async () => {
    throw new Error('HTTP Error 412: Precondition Failed，playurl 未返回可用音频轨。')
  },
  runMaterialSummary: async () => ({ editorialSummary: { status: 'summary_ready' } }),
  getMaterialPathFromDistillResult: (distillResult) => distillResult.materialPath ?? '',
  setAutomationStatus: () => {},
  appendRuntimeLog: (message) => skippedLogs.push(message),
  broadcastStatus: () => {},
})
assert.equal(skippedResult.failed, 0, '权限/付费类错误不应计入普通失败。')
assert.equal(skippedResult.skipped, 1, '权限/付费类错误必须计入跳过。')
assert.equal(skippedQueue[0].status, 'skipped', '权限/付费类错误必须直接跳过，不再重试。')
assert.equal(skippedQueue[0].nextRetryAt, 0)
assert.match(skippedQueue[0].lastError, /已跳过：疑似付费、充电或权限受限视频/)
assert.ok(skippedLogs.some((line) => line.includes('workbench queue item skipped')), '跳过必须写入运行日志。')

let configFailurePaused = false
let configQueue = [makeQueueItem('config-failure', 'BVconfigFailure')]
await runWorkbenchQueueExecutor({
  reason: 'config-failure-check',
  concurrency: 1,
  loadQueue: () => configQueue,
  claimNextQueuedItem: () => {
    const claimed = claimNextQueuedWorkbenchItemFromList(configQueue, 1)
    configQueue = claimed.items
    return claimed.item
  },
  updateQueueItem: (queueId, patch) => {
    configQueue = configQueue.map((item) => (item.queueId === queueId ? { ...item, ...patch } : item))
  },
  loadSettings: () => ({ memoryOnly: true }),
  findMaterialRecordByBvid: () => null,
  findMaterialRecordByPath: () => null,
  isMaterialRecordSummaryReady: () => false,
  isMaterialRecordCleaned: () => false,
  archiveMaterialRecord: () => {},
  runDistiller: async () => {
    throw new Error('SESSDATA 登录已失效')
  },
  runMaterialSummary: async () => ({ editorialSummary: { status: 'summary_ready' } }),
  getMaterialPathFromDistillResult: (distillResult) => distillResult.materialPath ?? '',
  setAutomationStatus: () => {},
  pauseAutomation: () => {
    configFailurePaused = true
  },
  appendRuntimeLog: () => {},
  broadcastStatus: () => {},
})
assert.equal(configQueue[0].status, 'failed')
assert.equal(configFailurePaused, true, '配置类失败必须暂停自动化。')

const mainSource = readProjectSource('electron/main.ts')
assert.match(mainSource, /const WORKBENCH_QUEUE_CONCURRENCY = 1/)
assert.match(mainSource, /const BACKGROUND_CHECK_INTERVAL_MINUTES = 60/)
assert.match(mainSource, /loadFreshTrackedBilibiliSources[\s\S]*\.filter\(\(source\) => source\.trackFresh\)/)
assert.match(mainSource, /loadPinnedSources:\s*loadFreshTrackedBilibiliSources/)
assert.match(mainSource, /discoverFreshTrackedSourceVideosForWorkbench/)
assert.match(mainSource, /lastCheckedAt:\s*now/)
assert.match(mainSource, /discoverPinnedSourceVideos:\s*discoverFreshTrackedSourceVideosForWorkbench/)
assert.match(mainSource, /backgroundAutomationPause/)
assert.match(mainSource, /loadHistoryTrackedBilibiliSources[\s\S]*\.filter\(\(source\) => source\.trackHistory\)/)
assert.match(mainSource, /hasClaimableWorkbenchItems/)
assert.doesNotMatch(mainSource, /hasQueuedWorkbenchItems/, '未来重试项不能继续阻塞历史补足。')
assert.match(mainSource, /trigger === 'idle-backfill'[\s\S]*discovered:\s*\[\]/, '空闲补足必须跳过 fresh 全量检查，只补历史。')
assert.match(mainSource, /discoverHistoryBackfillVideoForWorkbench/)
assert.match(mainSource, /BILIBILI_HISTORY_BACKFILL_PAGE_SIZE = 30/)
assert.match(mainSource, /fetchHistoryBackfillPageForWorkbench/)
assert.match(mainSource, /historyPage:\s*pageResult\.page/)
assert.match(mainSource, /historyReachedEnd:\s*!pageResult\.hasMore/)
assert.match(mainSource, /historyStatus:\s*pageResult\.hasMore \? 'running' : 'completed'/)
assert.match(mainSource, /historyStatus:\s*'failed'/)

const executorSource = readProjectSource('electron/queue/queueExecutor.ts')
assert.doesNotMatch(executorSource, /Promise\.all\s*\(/, '队列执行器不能再用 Promise.all 启动多个 worker。')
assert.doesNotMatch(executorSource, /Array\.from\s*\(\s*\{\s*length:\s*workerCount/, '队列执行器不能再按 workerCount 批量创建 worker。')

const workbenchQueueSource = readProjectSource('electron/queue/workbenchQueue.ts')
assert.match(workbenchQueueSource, /getWorkbenchQueueSourcePriority/)
assert.match(workbenchQueueSource, /item\.queueSource === 'fresh'/)
assert.match(workbenchQueueSource, /item\.queueSource === 'history'/)
assert.match(workbenchQueueSource, /nextRetryAt/)
assert.match(workbenchQueueSource, /isWorkbenchQueueItemClaimable/)
assert.match(workbenchQueueSource, /getNextWorkbenchQueueRetryAt/)

const automationControllerSource = readProjectSource('electron/runtime/automationController.ts')
assert.match(automationControllerSource, /getNextHourlyCheckDelayMs/)
assert.match(automationControllerSource, /delayMs \?\? getNextHourlyCheckDelayMs\(\)/)
assert.match(automationControllerSource, /pausedUntil/)
assert.match(automationControllerSource, /durationMs/)
assert.match(automationControllerSource, /!deps\.readPauseState\(\)\.paused[\s\S]*scheduleQueueProcessing\('queue-continued'\)/)
assert.match(automationControllerSource, /isWorkbenchQueueItemClaimable/)
assert.match(automationControllerSource, /pauseAutomation/)
assert.match(automationControllerSource, /scheduleRetryWake/)
assert.match(automationControllerSource, /scheduleIdleBackfill/)
assert.match(automationControllerSource, /runCheck\('idle-backfill'\)/)
assert.match(automationControllerSource, /trigger === 'idle-backfill' \? '空闲补足'/)
assert.match(automationControllerSource, /else if \(deps\.loadQueue\(\)\.some\(\(item\) => isWorkbenchQueueItemClaimable\(item\)\)\)/, '空队列不能触发自动化空转。')

const queueExecutorSource = readProjectSource('electron/queue/queueExecutor.ts')
assert.match(queueExecutorSource, /MAX_QUEUE_RETRY_COUNT = 3/)
assert.match(queueExecutorSource, /QUEUE_RETRY_DELAYS_MS/)
assert.match(queueExecutorSource, /isConfigurationQueueError/)
assert.match(queueExecutorSource, /queueSource:\s*'retry'/)
assert.match(queueExecutorSource, /pauseAutomation/)
assert.match(queueExecutorSource, /isNonRetryableMediaAccessError/)
assert.match(queueExecutorSource, /status:\s*'skipped'/)
assert.match(queueExecutorSource, /疑似付费、充电或权限受限视频/)

const automationRuntimeSource = readProjectSource('electron/runtime/automationRuntime.ts')
assert.match(automationRuntimeSource, /normalizePauseState/)
assert.match(automationRuntimeSource, /pausedUntil <= Date\.now\(\)/)
assert.match(automationRuntimeSource, /writePauseState\(next\)/)

const settingsAutomationIpcSource = readProjectSource('electron/ipc/settingsAutomationIpcHandlers.ts')
assert.match(settingsAutomationIpcSource, /durationMs/)
assert.match(settingsAutomationIpcSource, /automation:set-paused/)

const sourceDiscoverySource = readProjectSource('electron/providers/sourceDiscovery.ts')
assert.match(sourceDiscoverySource, /createSourceQueueItem\(video,\s*sourceName,\s*'fresh'\)/)
assert.match(sourceDiscoverySource, /createHistoryBackfillQueueItem/)
assert.match(sourceDiscoverySource, /discoverHistoryBackfillVideo/)
assert.match(sourceDiscoverySource, /fetchAndMergeHistoryBackfillPage/)
assert.match(sourceDiscoverySource, /listBilibiliSourceVideoPage/)
assert.match(sourceDiscoverySource, /mergeVideosIntoRegistry/)
assert.match(sourceDiscoverySource, /queueSource,\n\s+editorialMode:\s*'off'[\s\S]*pipelineMode:\s*'subtitle_only'/)

const bilibiliSourceApiSource = readProjectSource('electron/providers/bilibiliSourceApi.ts')
assert.match(bilibiliSourceApiSource, /export async function listBilibiliSourceVideoPage/)
assert.match(bilibiliSourceApiSource, /pn:\s*Math\.max\(1,\s*Math\.floor\(page\)/)
assert.match(bilibiliSourceApiSource, /hasMore:\s*result\.videos\.length >= safePageSize/)

console.log('up sync scheduler single-worker check passed')

import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')

function readDesktopSource(relativePath) {
  return readFileSync(path.join(desktopRoot, relativePath), 'utf8')
}

async function importAutomationControllerForCheck() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'shijie-idle-backfill-loop-'))
  const electronRoot = path.join(desktopRoot, 'electron')
  const automationControllerSource = readFileSync(path.join(electronRoot, 'runtime', 'automationController.ts'), 'utf8')
    .replaceAll("from '../queue/workbenchQueue'", "from './workbenchQueue.ts'")
  writeFileSync(path.join(tempDir, 'automationController.ts'), automationControllerSource, 'utf8')
  copyFileSync(path.join(electronRoot, 'queue', 'workbenchQueue.ts'), path.join(tempDir, 'workbenchQueue.ts'))
  const module = await import(pathToFileURL(path.join(tempDir, 'automationController.ts')).href)
  rmSync(tempDir, { recursive: true, force: true })
  return module
}

function makeQueueItem(queueId, bvid, status = 'queued') {
  return {
    queueId,
    bvid,
    aid: '',
    title: `空闲补足检查 ${queueId}`,
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
    queueSource: 'history',
    editorialMode: 'off',
    pipelineMode: 'subtitle_only',
    status,
    queuedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }
}

const queueStoreSource = readDesktopSource('electron/queue/workbenchQueueStore.ts')
assert.match(
  queueStoreSource,
  /const current = loadQueue\(\)[\s\S]*const next = appendWorkbenchQueueItemsToList\(current, items\)/,
  '追加队列项时必须先保留追加前后的队列快照。',
)
assert.match(
  queueStoreSource,
  /const unchanged = next\.length === current\.length[\s\S]*item\.queueId === current\[index\]\?\.queueId && item\.bvid === current\[index\]\?\.bvid/,
  '重复历史视频不能被当成真实新增队列项。',
)
assert.match(
  queueStoreSource,
  /if \(unchanged\) return current[\s\S]*return saveQueue\(next\)/,
  '重复视频不应触发 saveQueue，因为 saveQueue 会继续安排队列处理。',
)

const automationControllerSource = readDesktopSource('electron/runtime/automationController.ts')
assert.match(
  automationControllerSource,
  /appendQueueItems: \(items: WorkbenchQueueItem\[\]\) => WorkbenchQueueItem\[\]/,
  '自动化控制器需要拿到追加后的队列，判断是否真的有可处理任务。',
)
assert.match(
  automationControllerSource,
  /const queueAfterAppend = deps\.appendQueueItems\(discovery\.discovered\)[\s\S]*queueAfterAppend\.some\(\(item\) => isWorkbenchQueueItemClaimable\(item\)\)[\s\S]*scheduleQueueProcessing\(`automation-\$\{trigger\}`\)/,
  '发现结果非空时，也只有队列里存在可领取任务才应继续处理。',
)
assert.match(
  automationControllerSource,
  /else if \(deps\.loadQueue\(\)\.some\(\(item\) => isWorkbenchQueueItemClaimable\(item\)\)\)/,
  '没有发现新视频时，已有可领取队列项仍需被处理。',
)

const { createAutomationController } = await importAutomationControllerForCheck()

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

{
  const duplicate = makeQueueItem('failed-duplicate', 'BVduplicate', 'failed')
  let queue = [duplicate]
  let runQueueCalls = 0
  const controller = createAutomationController({
    checkIntervalMinutes: 60,
    loadSettings: () => ({ background_automation_enabled: true }),
    readPauseState: () => ({ paused: false, pausedUntil: null, reason: '' }),
    writePauseState: () => {},
    loadPinnedSources: () => [{ mid: 'codex-up' }],
    discoverPinnedSourceVideos: async () => ({ discovered: [makeQueueItem('new-duplicate', 'BVduplicate')], checkedSourceCount: 0, totalVideoCount: 0 }),
    appendQueueItems: () => queue,
    loadQueue: () => queue,
    recoverQueue: () => {},
    runQueue: async () => {
      runQueueCalls += 1
      return { processed: 0, failed: 0, skipped: 0 }
    },
    appendRuntimeLog: () => {},
    emitStatus: () => {},
  })
  await controller.runCheck('idle-backfill')
  await wait(450)
  controller.shutdown()
  assert.equal(runQueueCalls, 0, '重复历史项被队列去重后，不能再次启动队列处理。')
}

{
  let queue = []
  let runQueueCalls = 0
  const freshItem = makeQueueItem('fresh-history', 'BVfreshHistory')
  const controller = createAutomationController({
    checkIntervalMinutes: 60,
    loadSettings: () => ({ background_automation_enabled: true }),
    readPauseState: () => ({ paused: false, pausedUntil: null, reason: '' }),
    writePauseState: () => {},
    loadPinnedSources: () => [{ mid: 'codex-up' }],
    discoverPinnedSourceVideos: async () => ({ discovered: [freshItem], checkedSourceCount: 0, totalVideoCount: 0 }),
    appendQueueItems: () => {
      queue = [freshItem]
      return queue
    },
    loadQueue: () => queue,
    recoverQueue: () => {},
    runQueue: async () => {
      runQueueCalls += 1
      queue = []
      return { processed: 1, failed: 0, skipped: 0 }
    },
    appendRuntimeLog: () => {},
    emitStatus: () => {},
  })
  await controller.runCheck('idle-backfill')
  await wait(450)
  controller.shutdown()
  assert.equal(runQueueCalls, 1, '真正新增且可领取的历史项仍应自动启动队列处理。')
}

console.log('auto sync idle-backfill loop guard checks passed')

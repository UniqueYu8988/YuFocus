import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')

function readDesktopSource(relativePath) {
  return readFileSync(path.join(desktopRoot, relativePath), 'utf8')
}

function makeQueueItem(index, status = 'done') {
  return {
    queueId: `queue-${index}`,
    bvid: `BV${String(index).padStart(10, '0')}`,
    aid: '',
    title: `队列项 ${index}`,
    authorMid: 'codex-up',
    authorName: 'Codex UP',
    sourceName: 'Codex UP',
    pic: '',
    description: '',
    durationText: '00:30',
    durationSeconds: 30,
    pubdate: 1_700_000_000 - index,
    statView: 0,
    url: `https://www.bilibili.com/video/BV${String(index).padStart(10, '0')}`,
    queueSource: 'history',
    editorialMode: 'off',
    pipelineMode: 'subtitle_only',
    status,
    queuedAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_000_000 + index,
  }
}

const mainSource = readDesktopSource('electron/main.ts')
assert.match(mainSource, /const BILIBILI_RECENT_FEED_LIMIT = 9/)
assert.match(mainSource, /recentFeedLimit:\s*BILIBILI_RECENT_FEED_LIMIT/)
assert.doesNotMatch(mainSource, /BACKGROUND_DISCOVERY_WINDOW_MS/)
assert.match(mainSource, /registerAppLifecycle\(\{[\s\S]*runBackgroundAutomationCheck,[\s\S]*\}\)/)

const sourceDiscoverySource = readDesktopSource('electron/providers/sourceDiscovery.ts')
const freshDiscoveryBody = sourceDiscoverySource.slice(
  sourceDiscoverySource.indexOf('export async function discoverPinnedSourceVideos'),
  sourceDiscoverySource.indexOf('export function discoverHistoryBackfillVideo'),
)
assert.match(freshDiscoveryBody, /candidateVideos/)
assert.match(freshDiscoveryBody, /\.slice\(0,\s*Math\.max\(1,\s*recentFeedLimit\)\)/)
assert.match(freshDiscoveryBody, /createBackgroundQueueItem\(video,\s*sourceName\)/)
assert.doesNotMatch(
  freshDiscoveryBody,
  /isVideoPublishedInDiscoveryWindow/,
  '最近列表发现不能再被 24 小时时间窗过滤。',
)

const sourceDiscoveryRuntimeSource = readDesktopSource('electron/providers/sourceDiscoveryRuntime.ts')
assert.match(sourceDiscoveryRuntimeSource, /recentFeedLimit:\s*number/)
assert.match(sourceDiscoveryRuntimeSource, /recentFeedLimit,/)

const appLifecycleSource = readDesktopSource('electron/runtime/appLifecycle.ts')
assert.match(appLifecycleSource, /runBackgroundAutomationCheck:\s*\(trigger:\s*'startup'\) => unknown/)
assert.match(appLifecycleSource, /void runBackgroundAutomationCheck\('startup'\)/)

const automationControllerSource = readDesktopSource('electron/runtime/automationController.ts')
assert.match(automationControllerSource, /refreshSchedule\(300\)/)
assert.match(automationControllerSource, /最近列表\$\{discoveryHint\}/)
assert.doesNotMatch(automationControllerSource, /24小时内/)

const homePaneSource = readDesktopSource('src/ui/pages/HomePane.tsx')
assert.match(homePaneSource, /\.slice\(0,\s*9\)/)

const workbenchQueueSource = readDesktopSource('electron/queue/workbenchQueue.ts')
assert.match(workbenchQueueSource, /pendingCurrent/)
assert.match(workbenchQueueSource, /terminalCurrent/)
assert.match(workbenchQueueSource, /\[\.\.\.pendingCurrent,\s*\.\.\.freshItems,\s*\.\.\.terminalCurrent\]/)

const { appendWorkbenchQueueItemsToList } = await import(
  pathToFileURL(path.join(desktopRoot, 'electron/queue/workbenchQueue.ts')).href
)
const fullTerminalQueue = Array.from({ length: 200 }, (_, index) => makeQueueItem(index + 1, 'done'))
const newHistoryItem = makeQueueItem(999, 'queued')
newHistoryItem.bvid = 'BVNEW_HISTORY'
newHistoryItem.queueId = 'queue-new-history'
newHistoryItem.queueSource = 'history'
const appended = appendWorkbenchQueueItemsToList(fullTerminalQueue, [newHistoryItem])
assert.equal(appended.length, 200)
assert.equal(appended[0].bvid, 'BVNEW_HISTORY')
assert.equal(appended[0].status, 'queued')
assert.equal(appended.filter((item) => item.status === 'queued').length, 1)

console.log('recent and history autopilot check passed')

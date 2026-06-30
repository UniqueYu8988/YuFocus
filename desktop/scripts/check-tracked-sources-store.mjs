import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  normalizeTrackedBilibiliSources,
  reconcileTrackedSourcesWithPinnedSources,
} from '../electron/services/trackedSourcesStore.ts'

function readProjectSource(relativePath) {
  return fs.readFileSync(path.resolve(import.meta.dirname, '..', relativePath), 'utf-8')
}

const pinnedSources = [
  {
    mid: '1001',
    name: '马督工',
    face: 'https://example.test/ma.jpg',
    sign: 'sign-a',
    officialTitle: '',
    pinnedAt: 20,
  },
  {
    mid: '1002',
    name: 'TED官方精选',
    face: 'https://example.test/ted.jpg',
    sign: 'sign-b',
    officialTitle: '官方',
    pinnedAt: 10,
  },
]

const initialTracked = reconcileTrackedSourcesWithPinnedSources([], pinnedSources)
assert.equal(initialTracked.length, 2)
assert.equal(initialTracked[0].mid, '1001')
assert.equal(initialTracked[0].priority, 0)
assert.equal(initialTracked[0].trackFresh, true)
assert.equal(initialTracked[0].trackHistory, true)
assert.equal(initialTracked[0].historyStatus, 'idle')
assert.equal(initialTracked[0].historyPage, 0)
assert.equal(initialTracked[0].historyReachedEnd, false)
assert.equal(initialTracked[0].lastCheckedAt, 0)
assert.equal(initialTracked[1].priority, 1)

const customizedTracked = normalizeTrackedBilibiliSources([
  {
    ...initialTracked[0],
    priority: 1,
    trackFresh: false,
    trackHistory: true,
    historyStatus: 'paused',
    historyPage: 3,
    historyReachedEnd: true,
    lastCheckedAt: 123,
    updatedAt: 456,
  },
  {
    ...initialTracked[1],
    priority: 0,
    trackFresh: true,
    trackHistory: false,
    historyStatus: 'running',
    historyPage: 5,
    historyReachedEnd: false,
    lastCheckedAt: 789,
    updatedAt: 999,
  },
])

const reconciled = reconcileTrackedSourcesWithPinnedSources(customizedTracked, [
  { ...pinnedSources[0], name: '马督工更新名' },
  pinnedSources[1],
])
assert.equal(reconciled[0].mid, '1002', '已有优先级应优先于 pinnedAt 顺序。')
assert.equal(reconciled[0].trackFresh, true)
assert.equal(reconciled[0].trackHistory, false)
assert.equal(reconciled[0].historyStatus, 'running')
assert.equal(reconciled[0].historyPage, 5)
assert.equal(reconciled[0].historyReachedEnd, false)
assert.equal(reconciled[0].lastCheckedAt, 789)
assert.equal(reconciled[1].mid, '1001')
assert.equal(reconciled[1].name, '马督工更新名')
assert.equal(reconciled[1].trackFresh, false)
assert.equal(reconciled[1].historyStatus, 'paused')
assert.equal(reconciled[1].historyPage, 3)
assert.equal(reconciled[1].historyReachedEnd, true)
assert.equal(reconciled[1].lastCheckedAt, 123)

const pruned = reconcileTrackedSourcesWithPinnedSources(reconciled, [pinnedSources[1]])
assert.deepEqual(pruned.map((source) => source.mid), ['1002'])
assert.equal(pruned[0].priority, 0)

const invalidNormalized = normalizeTrackedBilibiliSources([
  { mid: '1003', name: '无效状态 UP', priority: -10, historyStatus: 'strange', trackFresh: 'yes' },
  { mid: '1003', name: '重复 UP' },
  { mid: '', name: '无 MID' },
])
assert.equal(invalidNormalized.length, 1)
assert.equal(invalidNormalized[0].priority, 0)
assert.equal(invalidNormalized[0].historyStatus, 'idle')
assert.equal(invalidNormalized[0].trackFresh, true)

const trackedStoreSource = readProjectSource('electron/services/trackedSourcesStore.ts')
assert.doesNotMatch(trackedStoreSource, /data[\\/]materials|listMaterialPackages|delete|rmSync|unlink/i)

const runtimeStoreSource = readProjectSource('electron/runtime/runtimeStores.ts')
assert.match(runtimeStoreSource, /trackedBilibiliSources:\s*TrackedBilibiliSource\[\]/)

const sourceIpcSource = readProjectSource('electron/ipc/sourceIpcHandlers.ts')
assert.match(sourceIpcSource, /sources:bilibili:tracked:load/)
assert.match(sourceIpcSource, /sources:bilibili:tracked:save/)

const preloadSource = readProjectSource('electron/preload.ts')
assert.match(preloadSource, /loadTrackedBilibiliSources/)
assert.match(preloadSource, /saveTrackedBilibiliSources/)

const mainSource = readProjectSource('electron/main.ts')
assert.match(mainSource, /syncTrackedSourcesWithPinnedSources\(pinnedSources\)/)
assert.match(mainSource, /syncTrackedSourcesWithPinnedSources\(loadPinnedBilibiliSources\(\)\)/)

console.log('tracked sources store check passed')

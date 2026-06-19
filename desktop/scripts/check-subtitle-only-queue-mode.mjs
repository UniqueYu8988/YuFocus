import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  normalizeWorkbenchQueueItem,
  sanitizePipelineMode,
} from '../electron/queue/workbenchQueue.ts'

async function importQueueExecutorForNodeCheck() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-subtitle-only-'))
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

const { runWorkbenchQueueExecutor } = await importQueueExecutorForNodeCheck()

function readProjectSource(relativePath) {
  return fs.readFileSync(path.resolve(import.meta.dirname, '..', relativePath), 'utf-8')
}

const baseVideo = {
  bvid: 'BV1subtitleOnly',
  aid: '100',
  title: '字幕清洗队列样例',
  authorMid: '200',
  authorName: '样例 UP',
  pic: '',
  description: '',
  durationText: '12:34',
  durationSeconds: 754,
  pubdate: 1_700_000_000,
  statView: 123,
  url: 'https://www.bilibili.com/video/BV1subtitleOnly',
}

function makeQueueItem(patch = {}) {
  const item = normalizeWorkbenchQueueItem({
    ...baseVideo,
    queueId: patch.queueId ?? `queue-${Math.random().toString(36).slice(2)}`,
    status: 'queued',
    ...patch,
  })
  assert.ok(item)
  return item
}

function makeCleanedRecord(path = 'memory://materials/sample-up/sample-video') {
  return {
    path,
    rawTranscriptExists: true,
    notebooklmExists: true,
    editorialSummaryExists: false,
    editorialSummaryHtmlExists: false,
  }
}

async function runMemoryQueueScenario({
  item,
  existingRecord = null,
  distillMaterialPath = 'memory://materials/generated-up/generated-video',
}) {
  let queue = [item]
  const calls = {
    runDistiller: 0,
    runMaterialSummary: 0,
    archiveMaterialRecord: 0,
    pushMaterialEmail: 0,
    setAutomationStatus: [],
    runtimeLogs: [],
  }

  const result = await runWorkbenchQueueExecutor({
    reason: 'memory-check',
    concurrency: 1,
    loadQueue: () => queue,
    claimNextQueuedItem: () => {
      const target = queue.find((entry) => entry.status === 'queued')
      if (!target) return null
      const claimed = { ...target, status: 'processing', lastError: '' }
      queue = queue.map((entry) => (entry.queueId === target.queueId ? claimed : entry))
      return claimed
    },
    updateQueueItem: (queueId, patch) => {
      queue = queue.map((entry) => (entry.queueId === queueId ? { ...entry, ...patch } : entry))
    },
    loadSettings: () => ({ memoryOnly: true }),
    findMaterialRecordByBvid: () => existingRecord,
    findMaterialRecordByPath: (_settings, materialPath) => makeCleanedRecord(materialPath),
    isMaterialRecordSummaryReady: (record) => Boolean(record?.editorialSummaryExists || record?.editorialSummaryHtmlExists),
    isMaterialRecordCleaned: (record) => Boolean(record?.notebooklmExists || record?.rawTranscriptExists),
    archiveMaterialRecord: () => {
      calls.archiveMaterialRecord += 1
    },
    pushMaterialEmail: async () => {
      calls.pushMaterialEmail += 1
    },
    runDistiller: async (payload) => {
      calls.runDistiller += 1
      calls.lastDistillPayload = payload
      return { materialPath: distillMaterialPath }
    },
    runMaterialSummary: async (payload) => {
      calls.runMaterialSummary += 1
      calls.lastSummaryPayload = payload
      return { editorialSummary: { status: 'summary_ready' } }
    },
    getMaterialPathFromDistillResult: (distillResult) => distillResult.materialPath ?? '',
    setAutomationStatus: (result, error) => {
      calls.setAutomationStatus.push({ result, error })
    },
    appendRuntimeLog: (message) => {
      calls.runtimeLogs.push(message)
    },
    broadcastStatus: () => {},
  })

  return { result, queue, calls }
}

const explicitSubtitleOnly = makeQueueItem({
  editorialMode: 'force',
  pipelineMode: 'subtitle_only',
})
assert.equal(explicitSubtitleOnly.pipelineMode, 'subtitle_only')
assert.equal(explicitSubtitleOnly.editorialMode, 'off')

const oldManualItem = makeQueueItem({
  editorialMode: 'off',
})
assert.equal(oldManualItem.pipelineMode, 'subtitle_only')
assert.equal(oldManualItem.editorialMode, 'off')

const oldFollowSourceItem = makeQueueItem({
  queueSource: 'follow_source',
  editorialMode: 'force',
})
assert.equal(oldFollowSourceItem.pipelineMode, 'full_editorial')
assert.equal(oldFollowSourceItem.editorialMode, 'force')

const invalidPipelineItem = makeQueueItem({
  editorialMode: 'force',
  pipelineMode: 'unexpected-mode',
})
assert.equal(invalidPipelineItem.pipelineMode, 'full_editorial')
assert.equal(sanitizePipelineMode('bad-value', 'off'), 'subtitle_only')
assert.equal(sanitizePipelineMode('bad-value', 'force'), 'full_editorial')

const channelBatchItem = makeQueueItem({
  queueSource: 'follow_source',
  editorialMode: 'off',
  pipelineMode: 'subtitle_only',
})
assert.equal(channelBatchItem.queueSource, 'follow_source')
assert.equal(channelBatchItem.pipelineMode, 'subtitle_only')
assert.equal(channelBatchItem.editorialMode, 'off')

const subtitleOnlyNewMaterial = await runMemoryQueueScenario({
  item: explicitSubtitleOnly,
})
assert.equal(subtitleOnlyNewMaterial.result.processed, 1)
assert.equal(subtitleOnlyNewMaterial.result.failed, 0)
assert.equal(subtitleOnlyNewMaterial.calls.runDistiller, 1)
assert.equal(subtitleOnlyNewMaterial.calls.lastDistillPayload.editorialMode, 'off')
assert.equal(subtitleOnlyNewMaterial.calls.runMaterialSummary, 0)
assert.equal(subtitleOnlyNewMaterial.calls.archiveMaterialRecord, 0)
assert.equal(subtitleOnlyNewMaterial.calls.pushMaterialEmail, 0)
assert.equal(subtitleOnlyNewMaterial.queue[0].status, 'done')
assert.equal(subtitleOnlyNewMaterial.queue[0].materialPath, 'memory://materials/generated-up/generated-video')

const unnormalizedSubtitleOnly = await runMemoryQueueScenario({
  item: {
    ...baseVideo,
    queueId: 'unnormalized-subtitle-only',
    status: 'queued',
    editorialMode: 'force',
    pipelineMode: 'subtitle_only',
  },
})
assert.equal(unnormalizedSubtitleOnly.calls.runDistiller, 1)
assert.equal(unnormalizedSubtitleOnly.calls.lastDistillPayload.editorialMode, 'off')
assert.equal(unnormalizedSubtitleOnly.calls.runMaterialSummary, 0)

const channelBatchExecution = await runMemoryQueueScenario({
  item: channelBatchItem,
})
assert.equal(channelBatchExecution.calls.runDistiller, 1)
assert.equal(channelBatchExecution.calls.lastDistillPayload.editorialMode, 'off')
assert.equal(channelBatchExecution.calls.runMaterialSummary, 0)
assert.equal(channelBatchExecution.calls.archiveMaterialRecord, 0)
assert.equal(channelBatchExecution.calls.pushMaterialEmail, 0)

const subtitleOnlyExistingMaterial = await runMemoryQueueScenario({
  item: makeQueueItem({ editorialMode: 'off', pipelineMode: 'subtitle_only' }),
  existingRecord: makeCleanedRecord('memory://materials/existing-up/existing-video'),
})
assert.equal(subtitleOnlyExistingMaterial.calls.runDistiller, 0)
assert.equal(subtitleOnlyExistingMaterial.calls.runMaterialSummary, 0)
assert.equal(subtitleOnlyExistingMaterial.calls.archiveMaterialRecord, 0)
assert.equal(subtitleOnlyExistingMaterial.calls.pushMaterialEmail, 0)
assert.equal(subtitleOnlyExistingMaterial.queue[0].status, 'done')
assert.equal(subtitleOnlyExistingMaterial.queue[0].materialPath, 'memory://materials/existing-up/existing-video')

const fullEditorialMaterial = await runMemoryQueueScenario({
  item: oldFollowSourceItem,
})
assert.equal(fullEditorialMaterial.result.processed, 1)
assert.equal(fullEditorialMaterial.result.failed, 0)
assert.equal(fullEditorialMaterial.calls.runDistiller, 1)
assert.equal(fullEditorialMaterial.calls.runMaterialSummary, 1)
assert.equal(fullEditorialMaterial.calls.archiveMaterialRecord, 1)
assert.equal(fullEditorialMaterial.calls.pushMaterialEmail, 1)
assert.equal(fullEditorialMaterial.queue[0].status, 'done')

const workspacePaneSource = readProjectSource('src/ui/pages/WorkspacePane.tsx')
assert.match(
  workspacePaneSource,
  /handleAddSelectedVideosToQueue[\s\S]*createWorkbenchQueueItem\(video,\s*'queued',\s*\{[\s\S]*editorialMode:\s*'off'[\s\S]*pipelineMode:\s*'subtitle_only'/,
)
assert.match(
  workspacePaneSource,
  /handleQueueManualBilibiliVideo[\s\S]*return \[\.\.\.current,\s*createWorkbenchQueueItem\(video\)\]/,
)

const sourceDiscoverySource = readProjectSource('electron/providers/sourceDiscovery.ts')
assert.match(
  sourceDiscoverySource,
  /createBackgroundQueueItem[\s\S]*editorialMode:\s*'off'[\s\S]*pipelineMode:\s*'subtitle_only'/,
)

console.log(JSON.stringify({
  ok: true,
  checked: {
    subtitleOnlyKeepsPipelineMode: true,
    subtitleOnlyForcesEditorialOff: true,
    executorForcesSubtitleOnlyEditorialOff: true,
    oldManualItemInfersSubtitleOnly: true,
    oldFollowSourceItemInfersFullEditorial: true,
    invalidPipelineModeFallsBackSafely: true,
    channelBatchItemIsSubtitleOnly: true,
    channelBatchSourceUsesSubtitleOnly: true,
    backgroundDiscoveryUsesSubtitleOnly: true,
    manualSingleVideoEntryUnchanged: true,
    channelBatchDoesNotCallRunMaterialSummary: true,
    subtitleOnlyDoesNotCallRunMaterialSummary: true,
    subtitleOnlyDoesNotPushEmail: true,
    fullEditorialKeepsSummaryBehavior: true,
    noAppDataRead: true,
    noBilibiliCall: true,
    noPythonCall: true,
    noMimoEmailTtsCall: true,
    noRealOutputWrite: true,
  },
}, null, 2))

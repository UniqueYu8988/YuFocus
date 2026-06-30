import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-queue-clear-safety-'))
const electronRoot = path.resolve(import.meta.dirname, '..', 'electron')
const materialDeletionSource = fs.readFileSync(path.join(electronRoot, 'services', 'materialDeletion.ts'), 'utf-8')
  .replace("from './pathSafety'", "from './pathSafety.ts'")
  .replace("from './libraryExportService'", "from './libraryExportService.ts'")
  .replace("from '../runtime/settings'", "from './settings.ts'")
fs.writeFileSync(path.join(tempDir, 'materialDeletion.ts'), materialDeletionSource, 'utf-8')
fs.copyFileSync(path.join(electronRoot, 'services', 'pathSafety.ts'), path.join(tempDir, 'pathSafety.ts'))
fs.writeFileSync(
  path.join(tempDir, 'libraryExportService.ts'),
  fs.readFileSync(path.join(electronRoot, 'services', 'libraryExportService.ts'), 'utf-8')
    .replace("from './pathSafety'", "from './pathSafety.ts'"),
  'utf-8',
)
fs.copyFileSync(path.join(electronRoot, 'runtime', 'settings.ts'), path.join(tempDir, 'settings.ts'))

const { createMaterialDeletion } = await import(pathToFileURL(path.join(tempDir, 'materialDeletion.ts')).href)

let savedQueue = null
let materialScanCalls = 0
let archiveCalls = 0
const queue = [
  { queueId: 'queued', bvid: 'BVqueued', status: 'queued' },
  { queueId: 'done', bvid: 'BVdone', status: 'done' },
  { queueId: 'processing', bvid: 'BVprocessing', status: 'processing' },
]

const deletion = createMaterialDeletion({
  loadSettings: () => {
    throw new Error('清空队列不应读取材料设置。')
  },
  resolveMaterialOutputDir: () => 'memory://materials',
  resolveLibraryRoot: () => 'memory://library',
  resolveKnowledgeOutputDir: () => 'memory://knowledge',
  resolveOutputRoot: () => 'memory://data',
  listMaterialPackages: () => {
    materialScanCalls += 1
    return { records: [{ path: 'memory://materials/real-data', sourceId: 'BVdone' }] }
  },
  loadKnowledgeLibraryFile: () => ({ records: [] }),
  saveKnowledgeLibraryFile: () => {},
  loadLearningLibraryState: () => ({ currentRecordId: null, records: {} }),
  saveLearningLibraryState: () => {},
  loadWorkbenchQueue: () => queue,
  saveWorkbenchQueueDirect: (items) => {
    savedQueue = items
  },
  isQueueProcessing: () => true,
  isMaterialRecordSummaryReady: () => true,
  buildArchivedLearningRecord: () => {
    archiveCalls += 1
    return {}
  },
  saveArchivedLearningRecord: () => {
    archiveCalls += 1
  },
})

const result = deletion.clearWorkbenchQueue()

assert.deepEqual(savedQueue?.map((item) => item.queueId), ['processing'], '清空队列时只应保留正在处理的任务。')
assert.equal(result.clearedCount, 2)
assert.equal(result.archivedCount, 0)
assert.equal(result.deletedMaterialCount, 0)
assert.deepEqual(result.deletedPaths, [])
assert.deepEqual(result.skippedPaths, [])
assert.equal(materialScanCalls, 0, '清空队列不应扫描或遍历材料包。')
assert.equal(archiveCalls, 0, '清空队列不应归档或改写材料记录。')

console.log('queue clear safety check passed')
fs.rmSync(tempDir, { recursive: true, force: true })

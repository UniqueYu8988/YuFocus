import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-material-slim-'))
const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const electronRoot = path.join(repoRoot, 'desktop', 'electron')
const servicesRoot = path.join(electronRoot, 'services')
const providersRoot = path.join(electronRoot, 'providers')

function copyTs(sourcePath, targetName, replacements = []) {
  let text = fs.readFileSync(sourcePath, 'utf-8')
  for (const [from, to] of replacements) text = text.replaceAll(from, to)
  fs.writeFileSync(path.join(tempDir, targetName), text, 'utf-8')
}

copyTs(path.join(servicesRoot, 'pathSafety.ts'), 'pathSafety.ts')
copyTs(path.join(servicesRoot, 'materialStats.ts'), 'materialStats.ts')
copyTs(path.join(servicesRoot, 'libraryExportService.ts'), 'libraryExportService.ts', [
  ["from './pathSafety'", "from './pathSafety.ts'"],
])
copyTs(path.join(servicesRoot, 'materialSlimmingService.ts'), 'materialSlimmingService.ts', [
  ["from './libraryExportService'", "from './libraryExportService.ts'"],
  ["from './pathSafety'", "from './pathSafety.ts'"],
])
copyTs(path.join(servicesRoot, 'materialInventory.ts'), 'materialInventory.ts', [
  ["from './materialStats'", "from './materialStats.ts'"],
  ["from './libraryExportService'", "from './libraryExportService.ts'"],
  ["from './pathSafety'", "from './pathSafety.ts'"],
])
copyTs(path.join(providersRoot, 'sourceDiscovery.ts'), 'sourceDiscovery.ts', [
  ["from './bilibiliSourceApi'", "from './bilibiliSourceApi.ts'"],
  ["from '../services/videoRegistry'", "from './videoRegistry.ts'"],
])
fs.writeFileSync(path.join(tempDir, 'bilibiliSourceApi.ts'), `
export function extractBilibiliBvid(value: unknown) {
  const match = String(value ?? '').match(/BV[0-9A-Za-z]+/u)
  return match ? match[0] : ''
}
export async function listBilibiliSourceVideoPage() { return { videos: [], page: 1, pageSize: 1, total: 0, hasMore: false } }
export async function listBilibiliSourceVideos() { return { provider: 'bilibili', fetchedAt: 0, totalVideos: 0, sources: [] } }
export type BilibiliSettings = Record<string, unknown>
export type BilibiliSourceVideosPayload = { sources: Array<{ mid: string; name: string; error: string; videos: BilibiliVideoMetadata[] }>; provider: 'bilibili'; fetchedAt: number; totalVideos: number }
export type BilibiliVideoMetadata = { bvid: string; title: string; pubdate?: number; authorName?: string }
`, 'utf-8')
fs.writeFileSync(path.join(tempDir, 'videoRegistry.ts'), `
export function listRegistryVideos() { return [] }
export function mergeVideosIntoRegistry() {}
export function readVideoRegistry() { return { last_sync: '' } }
`, 'utf-8')

const { syncMaterialToLibrary, listLibraryExportItems } = await import(pathToFileURL(path.join(tempDir, 'libraryExportService.ts')).href)
const { slimMaterialPackage } = await import(pathToFileURL(path.join(tempDir, 'materialSlimmingService.ts')).href)
const { listMaterialPackages } = await import(pathToFileURL(path.join(tempDir, 'materialInventory.ts')).href)
const { collectKnownWorkbenchBvids } = await import(pathToFileURL(path.join(tempDir, 'sourceDiscovery.ts')).href)

const dataRoot = path.join(tempDir, 'data')
const materialRoot = path.join(dataRoot, 'materials')
const libraryRoot = path.join(dataRoot, 'library')
const materialPath = path.join(materialRoot, '10086', 'bvslimtest')
fs.mkdirSync(path.join(materialPath, 'exports'), { recursive: true })
fs.mkdirSync(path.join(materialPath, 'delivery'), { recursive: true })
fs.mkdirSync(path.join(materialPath, 'work'), { recursive: true })
fs.mkdirSync(path.join(materialPath, 'indexes'), { recursive: true })

fs.writeFileSync(path.join(materialPath, 'manifest.json'), JSON.stringify({
  material_id: 'bvslimtest',
  text_length: 42,
  source: {
    source_id: 'BVslimtest',
    source_type: 'bilibili',
    url: 'https://www.bilibili.com/video/BVslimtest',
    title: '测试瘦身视频',
    creator: '测试UP',
    published_at: '2026-06-01T00:00:00.000Z',
  },
}, null, 2), 'utf-8')
fs.writeFileSync(path.join(materialPath, 'metrics.json'), JSON.stringify({ elapsed_seconds: 12, total_tokens: 345 }), 'utf-8')
fs.writeFileSync(path.join(materialPath, 'run_state.json'), JSON.stringify({ stage: 'content_ready' }), 'utf-8')
fs.writeFileSync(path.join(materialPath, 'raw_transcript.txt'), 'raw transcript', 'utf-8')
fs.writeFileSync(path.join(materialPath, 'exports', 'notebooklm.md'), '# 清洗稿\n\n正文', 'utf-8')
fs.writeFileSync(path.join(materialPath, 'delivery', 'email.md'), '# email\n\n正文', 'utf-8')
fs.writeFileSync(path.join(materialPath, 'delivery', 'email_status.json'), JSON.stringify({ status: 'sent' }), 'utf-8')
fs.writeFileSync(path.join(materialPath, 'work', 'tmp.txt'), 'tmp', 'utf-8')
fs.writeFileSync(path.join(materialPath, 'indexes', 'source_index.jsonl'), '{}\n', 'utf-8')

const exportResult = syncMaterialToLibrary({
  libraryRoot,
  materialPath,
  queueItem: {
    bvid: 'BVslimtest',
    title: '测试瘦身视频',
    sourceName: '测试UP',
    authorMid: '10086',
    pubdate: Math.floor(Date.parse('2026-06-01T00:00:00.000Z') / 1000),
  },
})
assert.equal(exportResult.status, 'ok')
assert.ok(fs.existsSync(exportResult.notebooklmPath), '清洗稿成品应存在。')
assert.ok(fs.existsSync(exportResult.emailPath), 'email 成品应存在。')

const slimResult = slimMaterialPackage({ materialRoot, libraryRoot, materialPath })
assert.equal(slimResult.status, 'ok')
assert.ok(!fs.existsSync(path.join(materialPath, 'raw_transcript.txt')), 'raw transcript 应被删除。')
assert.ok(!fs.existsSync(path.join(materialPath, 'exports', 'notebooklm.md')), 'materials 内清洗稿副本应被删除。')
assert.ok(!fs.existsSync(path.join(materialPath, 'delivery', 'email.md')), 'materials 内 email 副本应被删除。')
assert.ok(fs.existsSync(path.join(materialPath, 'manifest.json')), 'manifest 应保留。')
assert.ok(fs.existsSync(path.join(materialPath, 'metrics.json')), 'metrics 应保留。')
assert.ok(fs.existsSync(path.join(materialPath, 'run_state.json')), 'run_state 应保留。')
assert.ok(fs.existsSync(path.join(materialPath, 'library_refs.json')), '成品引用应保留。')
assert.ok(fs.existsSync(path.join(materialPath, 'delivery', 'email_status.json')), 'email 轻状态应保留。')

const inventory = listMaterialPackages(materialRoot)
assert.equal(inventory.records.length, 1)
assert.equal(inventory.notebooklmLibraryDir, path.join(libraryRoot, 'notebooklm'))
assert.equal(inventory.emailLibraryDir, path.join(libraryRoot, 'email'))
assert.equal(inventory.records[0].notebooklmPath, exportResult.notebooklmPath)
assert.equal(inventory.records[0].emailPath, exportResult.emailPath)
assert.equal(inventory.records[0].notebooklmExists, true)
assert.equal(inventory.records[0].emailExists, true)
assert.equal(inventory.records[0].rawTranscriptExists, false)

const libraryItems = listLibraryExportItems(libraryRoot).items
const known = collectKnownWorkbenchBvids([], [], libraryItems)
assert.equal(known.has('BVslimtest'), true, '成品库索引中的 BV 应进入自动发现去重集合。')

console.log('materials slimming and library dedupe check passed')
fs.rmSync(tempDir, { recursive: true, force: true })

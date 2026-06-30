import fs, { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')
const projectRoot = path.resolve(desktopRoot, '..')
const dataRoot = path.join(projectRoot, 'data')
const materialRoot = path.join(dataRoot, 'materials')
const registryRoot = path.join(dataRoot, 'registry')
const libraryRoot = path.join(dataRoot, 'library')
const dryRun = process.argv.includes('--dry-run')

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function importLibraryExportService() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'shijie-library-migration-module-'))
  const serviceRoot = path.join(desktopRoot, 'electron', 'services')
  const serviceSource = readFileSync(path.join(serviceRoot, 'libraryExportService.ts'), 'utf-8')
    .replace("from './pathSafety'", "from './pathSafety.ts'")
  writeFileSync(path.join(tempDir, 'libraryExportService.ts'), serviceSource, 'utf-8')
  copyFileSync(path.join(serviceRoot, 'pathSafety.ts'), path.join(tempDir, 'pathSafety.ts'))
  const module = await import(pathToFileURL(path.join(tempDir, 'libraryExportService.ts')).href)
  return module
}

function collectMaterialPaths() {
  if (!fs.existsSync(materialRoot)) return []
  const paths = []
  for (const upEntry of fs.readdirSync(materialRoot, { withFileTypes: true })) {
    if (!upEntry.isDirectory()) continue
    const upPath = path.join(materialRoot, upEntry.name)
    for (const videoEntry of fs.readdirSync(upPath, { withFileTypes: true })) {
      if (!videoEntry.isDirectory()) continue
      const materialPath = path.join(upPath, videoEntry.name)
      const hasManifest = fs.existsSync(path.join(materialPath, 'manifest.json'))
      const hasNotebooklm = fs.existsSync(path.join(materialPath, 'exports', 'notebooklm.md'))
      const hasEmail = fs.existsSync(path.join(materialPath, 'delivery', 'email.md'))
      if (hasManifest && (hasNotebooklm || hasEmail)) paths.push(materialPath)
    }
  }
  return paths.sort((left, right) => left.localeCompare(right))
}

function loadRegistryVideos(upId) {
  const registry = readJson(path.join(registryRoot, `${upId}.json`))
  const videos = registry?.videos && typeof registry.videos === 'object' ? registry.videos : {}
  const byBvid = new Map()
  for (const [key, value] of Object.entries(videos)) {
    if (!value || typeof value !== 'object') continue
    const bvid = String(value.bvid || key || '').trim()
    if (bvid) byBvid.set(bvid.toLowerCase(), value)
  }
  return byBvid
}

const registryCache = new Map()

function registryVideoFor(upId, bvid) {
  if (!registryCache.has(upId)) registryCache.set(upId, loadRegistryVideos(upId))
  return registryCache.get(upId).get(String(bvid || '').toLowerCase()) || null
}

function buildQueueItem(materialPath) {
  const upId = path.basename(path.dirname(materialPath))
  const videoId = path.basename(materialPath)
  const manifest = readJson(path.join(materialPath, 'manifest.json')) || {}
  const source = manifest.source && typeof manifest.source === 'object' ? manifest.source : {}
  const sourceId = String(source.source_id || videoId || '').trim()
  const registryVideo = registryVideoFor(upId, sourceId)
  const title = String(registryVideo?.title || source.title || videoId)
  const bvid = String(registryVideo?.bvid || sourceId || videoId)
  const authorMid = String(registryVideo?.author_mid || upId)
  const authorName = String(registryVideo?.author_name || source.creator || upId)
  return {
    queueId: `migration-${bvid}`,
    bvid,
    aid: String(registryVideo?.aid || ''),
    title,
    authorMid,
    authorName,
    sourceName: authorName,
    pic: String(registryVideo?.pic || ''),
    description: String(registryVideo?.description || ''),
    durationText: String(registryVideo?.duration || ''),
    durationSeconds: Number(registryVideo?.duration_seconds || 0) || 0,
    pubdate: Number(registryVideo?.pubdate || source.pubdate || 0) || 0,
    statView: Number(registryVideo?.stat_view || 0) || 0,
    url: String(registryVideo?.url || source.url || ''),
    queueSource: 'history',
    editorialMode: 'off',
    pipelineMode: 'subtitle_only',
    status: 'done',
  }
}

const materialPaths = collectMaterialPaths()
const beforeMaterialCount = materialPaths.length
const { syncMaterialToLibrary } = dryRun ? { syncMaterialToLibrary: null } : await importLibraryExportService()
const results = {
  dryRun,
  materialRoot,
  libraryRoot,
  scanned: beforeMaterialCount,
  exported: 0,
  skipped: 0,
  failed: 0,
  notebooklmFiles: 0,
  emailFiles: 0,
  samples: [],
}

for (const materialPath of materialPaths) {
  const queueItem = buildQueueItem(materialPath)
  const hasNotebooklm = fs.existsSync(path.join(materialPath, 'exports', 'notebooklm.md'))
  const hasEmail = fs.existsSync(path.join(materialPath, 'delivery', 'email.md'))
  if (dryRun) {
    results.exported += 1
    if (hasNotebooklm) results.notebooklmFiles += 1
    if (hasEmail) results.emailFiles += 1
    if (results.samples.length < 5) results.samples.push({ materialPath, title: queueItem.title, bvid: queueItem.bvid, hasNotebooklm, hasEmail })
    continue
  }

  try {
    const result = syncMaterialToLibrary({
      libraryRoot,
      materialPath,
      queueItem,
    })
    if (result.status === 'ok') {
      results.exported += 1
      if (result.notebooklmPath) results.notebooklmFiles += 1
      if (result.emailPath) results.emailFiles += 1
      if (results.samples.length < 5) {
        results.samples.push({
          materialPath,
          notebooklmPath: result.notebooklmPath,
          emailPath: result.emailPath,
        })
      }
    } else {
      results.skipped += 1
    }
  } catch (error) {
    results.failed += 1
    if (results.samples.length < 5) {
      results.samples.push({ materialPath, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

const afterMaterialCount = collectMaterialPaths().length
if (afterMaterialCount !== beforeMaterialCount) {
  throw new Error(`迁移前后 materials 可迁移目录数量变化：${beforeMaterialCount} -> ${afterMaterialCount}`)
}

console.log(JSON.stringify(results, null, 2))

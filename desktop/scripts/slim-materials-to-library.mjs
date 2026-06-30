import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const dataRoot = path.join(repoRoot, 'data')
const materialRoot = path.join(dataRoot, 'materials')
const libraryRoot = path.join(dataRoot, 'library')
const indexPath = path.join(libraryRoot, 'index.json')
const apply = process.argv.includes('--apply')

const keepRelativePaths = new Set([
  'manifest.json',
  'metrics.json',
  'run_state.json',
  'library_refs.json',
  path.join('delivery', 'email_status.json'),
])

function comparable(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isInside(target, root) {
  const targetComparable = comparable(target)
  const rootComparable = comparable(root)
  return targetComparable === rootComparable || targetComparable.startsWith(`${rootComparable}${path.sep}`)
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

function collectMaterialDirs(rootDir) {
  const dirs = []
  if (!fs.existsSync(rootDir)) return dirs
  for (const upEntry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!upEntry.isDirectory()) continue
    const upPath = path.join(rootDir, upEntry.name)
    for (const videoEntry of fs.readdirSync(upPath, { withFileTypes: true })) {
      if (!videoEntry.isDirectory()) continue
      const materialPath = path.join(upPath, videoEntry.name)
      if (fs.existsSync(path.join(materialPath, 'manifest.json'))) dirs.push(materialPath)
    }
  }
  return dirs
}

function collectFiles(root) {
  const files = []
  if (!fs.existsSync(root)) return files
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(entryPath))
    else files.push(entryPath)
  }
  return files
}

function removeEmptyDirectories(root) {
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const entryPath = path.join(root, entry.name)
    removeEmptyDirectories(entryPath)
    try {
      if (fs.readdirSync(entryPath).length === 0) fs.rmdirSync(entryPath)
    } catch {
      // ignore
    }
  }
}

function findLibraryItem(items, materialPath, sourceId) {
  const materialComparable = comparable(materialPath)
  return items.find((item) => {
    const itemMaterialPath = item.materialPath ? comparable(item.materialPath) : ''
    return Boolean(
      (itemMaterialPath && itemMaterialPath === materialComparable) ||
      (sourceId && (item.sourceId === sourceId || item.bvid === sourceId)),
    )
  }) || null
}

const index = readJson(indexPath, { items: [] })
const items = Array.isArray(index.items) ? index.items : []
const materialDirs = collectMaterialDirs(materialRoot)
const summary = {
  mode: apply ? 'apply' : 'dry-run',
  materialRoot,
  libraryRoot,
  scanned: materialDirs.length,
  slimmed: 0,
  skipped: 0,
  deletedFiles: 0,
  keptFiles: 0,
  skippedReasons: {},
}

for (const materialPath of materialDirs) {
  if (!isInside(materialPath, materialRoot) || comparable(materialPath) === comparable(materialRoot)) {
    summary.skipped += 1
    summary.skippedReasons.outside_material_root = (summary.skippedReasons.outside_material_root || 0) + 1
    continue
  }
  const manifest = readJson(path.join(materialPath, 'manifest.json'), {})
  const source = manifest && typeof manifest.source === 'object' && !Array.isArray(manifest.source) ? manifest.source : {}
  const sourceId = String(source.source_id || '').trim()
  const item = findLibraryItem(items, materialPath, sourceId)
  const notebooklmPath = item?.notebooklmPath || ''
  const emailPath = item?.emailPath || ''
  const hasNotebooklm = Boolean(notebooklmPath && fs.existsSync(notebooklmPath) && isInside(notebooklmPath, libraryRoot))
  const hasEmail = Boolean(emailPath && fs.existsSync(emailPath) && isInside(emailPath, libraryRoot))
  if (!hasNotebooklm && !hasEmail) {
    summary.skipped += 1
    summary.skippedReasons.missing_library_artifact = (summary.skippedReasons.missing_library_artifact || 0) + 1
    continue
  }

  const files = collectFiles(materialPath)
  const deletable = []
  const kept = []
  for (const filePath of files) {
    const relativePath = path.relative(materialPath, filePath).split(/[\\/]+/u).join(path.sep)
    if (keepRelativePaths.has(relativePath)) kept.push(filePath)
    else deletable.push(filePath)
  }

  if (apply) {
    writeJson(path.join(materialPath, 'library_refs.json'), {
      schema_version: 'shijie.material-library-refs.v0.1',
      updated_at: new Date().toISOString(),
      libraryRoot,
      indexPath,
      bvid: item?.bvid || sourceId,
      sourceId: item?.sourceId || sourceId,
      notebooklmPath,
      emailPath,
    })
    for (const filePath of deletable) {
      if (!isInside(filePath, materialPath)) throw new Error(`拒绝删除资料包外文件：${filePath}`)
      fs.unlinkSync(filePath)
    }
    removeEmptyDirectories(materialPath)
  }

  summary.slimmed += 1
  summary.deletedFiles += deletable.length
  summary.keptFiles += kept.length + (fs.existsSync(path.join(materialPath, 'library_refs.json')) ? 0 : 1)
}

console.log(JSON.stringify(summary, null, 2))

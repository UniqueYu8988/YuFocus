import fs from 'node:fs'
import path from 'node:path'

import {
  findLibraryExportItem,
} from './libraryExportService'
import {
  assertPathInside,
  isPathInsideRoot,
} from './pathSafety'

export type MaterialSlimResult = {
  status: 'ok' | 'skipped'
  reason: string
  materialPath: string
  deletedPaths: string[]
  keptPaths: string[]
}

export type MaterialSlimOptions = {
  materialRoot: string
  libraryRoot: string
  materialPath: string
}

const KEEP_RELATIVE_PATHS = new Set([
  'manifest.json',
  'metrics.json',
  'run_state.json',
  'library_refs.json',
  path.join('delivery', 'email_status.json'),
])

function normalizeRelativePath(value: string) {
  return value.split(/[\\/]+/u).join(path.sep)
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

function collectDescendantFiles(root: string) {
  const files: string[] = []
  if (!fs.existsSync(root)) return files
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectDescendantFiles(entryPath))
    } else {
      files.push(entryPath)
    }
  }
  return files
}

function removeEmptyDirectories(root: string) {
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const entryPath = path.join(root, entry.name)
    removeEmptyDirectories(entryPath)
    try {
      if (fs.readdirSync(entryPath).length === 0) fs.rmdirSync(entryPath)
    } catch {
      // ignore directories that were concurrently changed
    }
  }
}

export function slimMaterialPackage(options: MaterialSlimOptions): MaterialSlimResult {
  const materialRoot = path.resolve(options.materialRoot)
  const libraryRoot = path.resolve(options.libraryRoot)
  const materialPath = assertPathInside(options.materialPath, materialRoot, '资料包')
  const manifestPath = path.join(materialPath, 'manifest.json')
  const manifest = readJson(manifestPath)
  const source = manifest?.source && typeof manifest.source === 'object' && !Array.isArray(manifest.source)
    ? manifest.source as Record<string, unknown>
    : {}
  const sourceId = String(source.source_id ?? '').trim()
  const libraryItem = findLibraryExportItem({
    libraryRoot,
    materialPath,
    sourceId,
  })
  const notebooklmPath = libraryItem?.notebooklmPath || ''
  const emailPath = libraryItem?.emailPath || ''
  const hasNotebooklm = Boolean(notebooklmPath && fs.existsSync(notebooklmPath) && isPathInsideRoot(notebooklmPath, libraryRoot))
  const hasEmail = Boolean(emailPath && fs.existsSync(emailPath) && isPathInsideRoot(emailPath, libraryRoot))

  if (!hasNotebooklm && !hasEmail) {
    return {
      status: 'skipped',
      reason: '成品库中还没有可确认的 Markdown 成品，跳过瘦身。',
      materialPath,
      deletedPaths: [],
      keptPaths: [],
    }
  }

  writeJson(path.join(materialPath, 'library_refs.json'), {
    schema_version: 'shijie.material-library-refs.v0.1',
    updated_at: new Date().toISOString(),
    libraryRoot,
    indexPath: path.join(libraryRoot, 'index.json'),
    bvid: libraryItem?.bvid || sourceId,
    sourceId: libraryItem?.sourceId || sourceId,
    notebooklmPath,
    emailPath,
  })

  const deletedPaths: string[] = []
  const keptPaths: string[] = []
  for (const filePath of collectDescendantFiles(materialPath)) {
    const relativePath = normalizeRelativePath(path.relative(materialPath, filePath))
    if (KEEP_RELATIVE_PATHS.has(relativePath)) {
      keptPaths.push(filePath)
      continue
    }
    fs.unlinkSync(filePath)
    deletedPaths.push(filePath)
  }
  removeEmptyDirectories(materialPath)

  return {
    status: 'ok',
    reason: `已保留 ${keptPaths.length} 个轻量记录，删除 ${deletedPaths.length} 个中间文件。`,
    materialPath,
    deletedPaths,
    keptPaths,
  }
}

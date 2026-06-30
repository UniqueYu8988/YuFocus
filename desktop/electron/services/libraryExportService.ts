import fs from 'node:fs'
import path from 'node:path'

import type { WorkbenchQueueItem } from '../queue/workbenchQueue'
import { isPathInsideRoot } from './pathSafety'

export type LibraryExportItem = {
  bvid: string
  sourceId: string
  title: string
  sourceName: string
  sourceMid: string
  publishedAt: string
  materialPath: string
  notebooklmPath: string
  emailPath: string
  exportedAt: string
}

export type LibraryIndex = {
  version: 1
  updatedAt: string
  items: LibraryExportItem[]
}

export type LibraryExportResult = {
  status: 'ok' | 'skipped'
  reason: string
  libraryRoot: string
  notebooklmPath: string
  emailPath: string
  indexPath: string
}

export type LibraryExportOptions = {
  libraryRoot: string
  materialPath: string
  queueItem?: WorkbenchQueueItem
  now?: () => number
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

export function getLibraryIndexPath(libraryRoot: string) {
  return path.join(path.resolve(libraryRoot), 'index.json')
}

function sanitizeDisplayText(value: unknown, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text || fallback
}

function sanitizePathSegment(value: unknown, fallback: string) {
  const normalized = sanitizeDisplayText(value, fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/u, '')
    .trim()
  return truncateText(normalized || fallback, 120)
}

function truncateText(value: string, maxLength: number) {
  const chars = Array.from(value)
  return chars.length > maxLength ? chars.slice(0, maxLength).join('').trim() : value
}

function parseDateFromUnknown(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const timestampMs = value < 10_000_000_000 ? value * 1000 : value
    const date = new Date(timestampMs)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const text = String(value ?? '').trim()
  if (!text) return null
  const numeric = Number(text)
  if (Number.isFinite(numeric) && numeric > 0) return parseDateFromUnknown(numeric)
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeBvid(value: unknown) {
  return String(value ?? '').trim()
}

function getSourcePayload(manifest: Record<string, unknown> | null) {
  return manifest?.source && typeof manifest.source === 'object' && !Array.isArray(manifest.source)
    ? manifest.source as Record<string, unknown>
    : {}
}

function resolvePublishedDate(source: Record<string, unknown>, queueItem?: WorkbenchQueueItem) {
  return parseDateFromUnknown(queueItem?.pubdate) ||
    parseDateFromUnknown(source.published_at) ||
    parseDateFromUnknown(source.publishedAt) ||
    parseDateFromUnknown(source.published_time) ||
    parseDateFromUnknown(source.pubdate) ||
    null
}

function loadIndex(indexPath: string): LibraryIndex {
  const payload = readJson(indexPath)
  const items = Array.isArray(payload?.items)
    ? payload.items.filter((item): item is LibraryExportItem => Boolean(item && typeof item === 'object'))
    : []
  return {
    version: 1,
    updatedAt: sanitizeDisplayText(payload?.updatedAt ?? ''),
    items,
  }
}

export function listLibraryExportItems(libraryRoot: string) {
  const resolvedLibraryRoot = path.resolve(libraryRoot)
  const indexPath = getLibraryIndexPath(resolvedLibraryRoot)
  return {
    libraryRoot: resolvedLibraryRoot,
    indexPath,
    items: loadIndex(indexPath).items,
  }
}

export function findLibraryExportItem(options: {
  libraryRoot: string
  materialPath?: string
  sourceId?: string
  bvid?: string
}) {
  const materialPath = options.materialPath ? path.resolve(options.materialPath) : ''
  const sourceId = sanitizeDisplayText(options.sourceId ?? '')
  const bvid = sanitizeDisplayText(options.bvid ?? '')
  return listLibraryExportItems(options.libraryRoot).items.find((item) => {
    const itemMaterialPath = item.materialPath ? path.resolve(item.materialPath) : ''
    return Boolean(
      (materialPath && itemMaterialPath && samePath(itemMaterialPath, materialPath)) ||
      (sourceId && (item.sourceId === sourceId || item.bvid === sourceId)) ||
      (bvid && (item.bvid === bvid || item.sourceId === bvid)),
    )
  }) ?? null
}

function writeMaterialLibraryRefs(options: {
  materialPath: string
  libraryRoot: string
  indexPath: string
  item: LibraryExportItem
}) {
  writeJson(path.join(options.materialPath, 'library_refs.json'), {
    schema_version: 'shijie.material-library-refs.v0.1',
    updated_at: options.item.exportedAt,
    libraryRoot: options.libraryRoot,
    indexPath: options.indexPath,
    bvid: options.item.bvid,
    sourceId: options.item.sourceId,
    notebooklmPath: options.item.notebooklmPath,
    emailPath: options.item.emailPath,
  })
}

export function removeLibraryExportItem(options: {
  libraryRoot: string
  materialPath?: string
  sourceId?: string
  bvid?: string
  deletedPaths?: string[]
  skippedPaths?: string[]
}) {
  const libraryRoot = path.resolve(options.libraryRoot)
  const indexPath = getLibraryIndexPath(libraryRoot)
  const index = loadIndex(indexPath)
  const materialPath = options.materialPath ? path.resolve(options.materialPath) : ''
  const sourceId = sanitizeDisplayText(options.sourceId ?? '')
  const bvid = sanitizeDisplayText(options.bvid ?? '')
  const deletedPaths = options.deletedPaths ?? []
  const skippedPaths = options.skippedPaths ?? []
  const nextItems: LibraryExportItem[] = []
  let removedCount = 0

  for (const item of index.items) {
    const itemMaterialPath = item.materialPath ? path.resolve(item.materialPath) : ''
    const matches = Boolean(
      (materialPath && itemMaterialPath && samePath(itemMaterialPath, materialPath)) ||
      (sourceId && (item.sourceId === sourceId || item.bvid === sourceId)) ||
      (bvid && (item.bvid === bvid || item.sourceId === bvid)),
    )
    if (!matches) {
      nextItems.push(item)
      continue
    }

    removedCount += 1
    for (const targetPath of [item.notebooklmPath, item.emailPath]) {
      if (!targetPath) continue
      const resolvedTarget = path.resolve(targetPath)
      if (!isPathInsideRoot(resolvedTarget, libraryRoot) || samePath(resolvedTarget, libraryRoot)) {
        skippedPaths.push(resolvedTarget)
        continue
      }
      if (fs.existsSync(resolvedTarget)) {
        const stat = fs.statSync(resolvedTarget)
        if (stat.isDirectory()) fs.rmSync(resolvedTarget, { recursive: true, force: true })
        else fs.unlinkSync(resolvedTarget)
        deletedPaths.push(resolvedTarget)
      }
    }
  }

  if (removedCount > 0) {
    writeJson(indexPath, {
      version: 1,
      updatedAt: new Date().toISOString(),
      items: nextItems,
    })
  }

  return {
    removedCount,
    deletedPaths,
    skippedPaths,
    indexPath,
  }
}

function copyTextArtifact(sourcePath: string, targetPath: string, libraryRoot: string, publishedDate: Date | null) {
  if (!fs.existsSync(sourcePath)) return ''
  const resolvedTarget = path.resolve(targetPath)
  if (!isPathInsideRoot(resolvedTarget, path.resolve(libraryRoot))) {
    throw new Error(`长期成品库拒绝写入库目录之外的路径：${targetPath}`)
  }
  fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true })
  fs.copyFileSync(sourcePath, resolvedTarget)
  if (publishedDate) {
    fs.utimesSync(resolvedTarget, publishedDate, publishedDate)
  }
  return resolvedTarget
}

function samePath(left: string, right: string) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function resolveIndexedArtifactPath(index: LibraryIndex, bvid: string, sourceId: string, artifact: 'notebooklm' | 'email') {
  const key = bvid || sourceId
  if (!key) return ''
  const existing = index.items.find((item) => (item.bvid || item.sourceId) === key)
  return artifact === 'notebooklm' ? existing?.notebooklmPath || '' : existing?.emailPath || ''
}

function artifactPathOwner(index: LibraryIndex, candidatePath: string, artifact: 'notebooklm' | 'email') {
  return index.items.find((item) => {
    const itemPath = artifact === 'notebooklm' ? item.notebooklmPath : item.emailPath
    return itemPath && samePath(itemPath, candidatePath)
  })
}

function resolveArtifactTargetPath(options: {
  libraryRoot: string
  folderName: string
  title: string
  bvid: string
  sourceId: string
  artifact: 'notebooklm' | 'email'
  index: LibraryIndex
}) {
  const folderPath = path.join(options.libraryRoot, options.artifact, options.folderName)
  const existingPath = resolveIndexedArtifactPath(options.index, options.bvid, options.sourceId, options.artifact)
  const key = options.bvid || options.sourceId

  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? '' : ` (${index + 1})`
    const candidatePath = path.join(folderPath, `${options.title}${suffix}.md`)
    const owner = artifactPathOwner(options.index, candidatePath, options.artifact)
    if (existingPath && samePath(existingPath, candidatePath)) return candidatePath
    if (owner && (owner.bvid || owner.sourceId) === key) return candidatePath
    if (!owner && !fs.existsSync(candidatePath)) return candidatePath
  }

  return path.join(folderPath, `${options.title} (${Date.now()}).md`)
}

function upsertIndexItem(index: LibraryIndex, item: LibraryExportItem) {
  const key = item.bvid || item.sourceId
  const nextItems = index.items.filter((existing) => {
    const existingKey = existing.bvid || existing.sourceId
    return existingKey !== key
  })
  nextItems.push(item)
  nextItems.sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || '')))
  return {
    ...index,
    updatedAt: item.exportedAt,
    items: nextItems,
  }
}

export function syncMaterialToLibrary(options: LibraryExportOptions): LibraryExportResult {
  const libraryRoot = path.resolve(options.libraryRoot)
  const materialPath = path.resolve(options.materialPath)
  const manifestPath = path.join(materialPath, 'manifest.json')
  const notebooklmSourcePath = path.join(materialPath, 'exports', 'notebooklm.md')
  const emailSourcePath = path.join(materialPath, 'delivery', 'email.md')
  const indexPath = path.join(libraryRoot, 'index.json')
  const manifest = readJson(manifestPath)
  const source = getSourcePayload(manifest)

  if (!fs.existsSync(notebooklmSourcePath) && !fs.existsSync(emailSourcePath)) {
    return {
      status: 'skipped',
      reason: '资料包缺少 NotebookLM 清洗稿和邮件稿。',
      libraryRoot,
      notebooklmPath: '',
      emailPath: '',
      indexPath,
    }
  }

  const title = sanitizeDisplayText(options.queueItem?.title ?? source.title, path.basename(materialPath))
  const sourceName = sanitizeDisplayText(options.queueItem?.sourceName ?? options.queueItem?.authorName ?? source.creator, '未知 UP')
  const sourceMid = sanitizeDisplayText(options.queueItem?.authorMid ?? path.basename(path.dirname(materialPath)), 'unknown_up')
  const bvid = normalizeBvid(options.queueItem?.bvid ?? source.source_id ?? path.basename(materialPath))
  const publishedDate = resolvePublishedDate(source, options.queueItem)
  const safeUpName = sanitizePathSegment(sourceName || sourceMid, sourceMid)
  const safeTitle = sanitizePathSegment(title, bvid || 'untitled')
  const sourceId = normalizeBvid(source.source_id ?? bvid)
  const existingIndex = loadIndex(indexPath)
  const notebooklmTargetPath = resolveArtifactTargetPath({
    libraryRoot,
    folderName: safeUpName,
    title: safeTitle,
    bvid,
    sourceId,
    artifact: 'notebooklm',
    index: existingIndex,
  })
  const emailTargetPath = resolveArtifactTargetPath({
    libraryRoot,
    folderName: safeUpName,
    title: safeTitle,
    bvid,
    sourceId,
    artifact: 'email',
    index: existingIndex,
  })

  const notebooklmPath = copyTextArtifact(notebooklmSourcePath, notebooklmTargetPath, libraryRoot, publishedDate)
  const emailPath = copyTextArtifact(emailSourcePath, emailTargetPath, libraryRoot, publishedDate)
  const exportedAt = new Date(options.now ? options.now() : Date.now()).toISOString()
  const item: LibraryExportItem = {
    bvid,
    sourceId,
    title,
    sourceName,
    sourceMid,
    publishedAt: publishedDate ? publishedDate.toISOString() : '',
    materialPath,
    notebooklmPath,
    emailPath,
    exportedAt,
  }
  writeJson(indexPath, upsertIndexItem(existingIndex, item))
  writeMaterialLibraryRefs({
    materialPath,
    libraryRoot,
    indexPath,
    item,
  })

  return {
    status: 'ok',
    reason: [
      notebooklmPath ? 'NotebookLM 清洗稿已同步' : '',
      emailPath ? '邮件稿已同步' : '',
    ].filter(Boolean).join('，') || '索引已同步',
    libraryRoot,
    notebooklmPath,
    emailPath,
    indexPath,
  }
}

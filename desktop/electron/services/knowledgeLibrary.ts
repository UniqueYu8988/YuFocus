import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getComparablePath } from './pathSafety'
import { sanitizeDisplayText, type RuntimeSettings } from '../runtime/settings'

export type KnowledgeRecord = {
  id: string
  title: string
  sourceTitle: string
  sourceId: string
  sourceUrl: string
  materialPath: string
  knowledgeBriefPath: string
  libraryPath: string
  textLength: number
  importedAt: number
  updatedAt: number
}

export type KnowledgeLibraryFile = {
  schema_version: 'shijie.knowledge-library.v0.1'
  records: KnowledgeRecord[]
}

export type KnowledgeLibrarySummary = KnowledgeRecord & {
  fileExists: boolean
  preview: string
  searchText: string
}

export type KnowledgeLibraryPayload = {
  rootDir: string
  libraryPath: string
  records: KnowledgeLibrarySummary[]
}

export function resolveKnowledgeOutputDir(settings: RuntimeSettings) {
  return path.join(settings.output_dir, 'legacy', 'knowledge')
}

function resolveKnowledgeLibraryPath(settings: RuntimeSettings) {
  return path.join(resolveKnowledgeOutputDir(settings), 'knowledge_library.json')
}

function createKnowledgeRecordId(materialPath: string, sourceId: string) {
  const identity = `${sourceId || ''}\n${path.resolve(materialPath)}`
  return `knowledge-${crypto.createHash('sha1').update(identity).digest('hex').slice(0, 12)}`
}

function normalizeKnowledgeRecord(raw: Partial<KnowledgeRecord> | null | undefined): KnowledgeRecord | null {
  const materialPath = String(raw?.materialPath ?? '').trim()
  const knowledgeBriefPath = String(raw?.knowledgeBriefPath ?? '').trim()
  const libraryPath = String(raw?.libraryPath ?? '').trim()
  if (!materialPath || !knowledgeBriefPath || !libraryPath) return null

  const sourceId = sanitizeDisplayText(raw?.sourceId ?? '')
  const id = sanitizeDisplayText(raw?.id ?? createKnowledgeRecordId(materialPath, sourceId))
  const title = sanitizeDisplayText(raw?.title ?? raw?.sourceTitle ?? '未命名学习笔记', '未命名学习笔记')
  const now = Date.now()

  return {
    id,
    title,
    sourceTitle: sanitizeDisplayText(raw?.sourceTitle ?? title, title),
    sourceId,
    sourceUrl: sanitizeDisplayText(raw?.sourceUrl ?? ''),
    materialPath: path.resolve(materialPath),
    knowledgeBriefPath: path.resolve(knowledgeBriefPath),
    libraryPath: path.resolve(libraryPath),
    textLength: Math.max(0, Number(raw?.textLength ?? 0) || 0),
    importedAt: Number(raw?.importedAt ?? now),
    updatedAt: Number(raw?.updatedAt ?? now),
  }
}

export function loadKnowledgeLibraryFile(settings: RuntimeSettings): KnowledgeLibraryFile {
  const libraryPath = resolveKnowledgeLibraryPath(settings)
  try {
    if (!fs.existsSync(libraryPath)) {
      return {
        schema_version: 'shijie.knowledge-library.v0.1',
        records: [],
      }
    }

    const raw = JSON.parse(fs.readFileSync(libraryPath, 'utf-8')) as Partial<KnowledgeLibraryFile>
    const records = Array.isArray(raw.records)
      ? raw.records
          .map((record) => normalizeKnowledgeRecord(record))
          .filter((record): record is KnowledgeRecord => Boolean(record))
      : []

    return {
      schema_version: 'shijie.knowledge-library.v0.1',
      records,
    }
  } catch {
    return {
      schema_version: 'shijie.knowledge-library.v0.1',
      records: [],
    }
  }
}

export function saveKnowledgeLibraryFile(settings: RuntimeSettings, library: KnowledgeLibraryFile) {
  const knowledgeDir = resolveKnowledgeOutputDir(settings)
  fs.mkdirSync(knowledgeDir, { recursive: true })
  const libraryPath = resolveKnowledgeLibraryPath(settings)
  const normalized: KnowledgeLibraryFile = {
    schema_version: 'shijie.knowledge-library.v0.1',
    records: library.records
      .map((record) => normalizeKnowledgeRecord(record))
      .filter((record): record is KnowledgeRecord => Boolean(record))
      .sort((left, right) => right.updatedAt - left.updatedAt),
  }
  fs.writeFileSync(libraryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8')
  return normalized
}

function stripKnowledgeBriefMetadata(content: string) {
  return String(content ?? '')
    .replace(/^<!--\s*shijie:learning-notes[\s\S]*?-->\s*/u, '')
    .replace(/^<!--\s*shijie:knowledge-brief[\s\S]*?-->\s*/u, '')
    .trim()
}

function buildKnowledgePreview(content: string) {
  const normalized = stripKnowledgeBriefMetadata(content)
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/[#>*_`~\[\]()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized
}

export function listKnowledgeLibrary(settings: RuntimeSettings): KnowledgeLibraryPayload {
  const rootDir = resolveKnowledgeOutputDir(settings)
  const libraryPath = resolveKnowledgeLibraryPath(settings)
  fs.mkdirSync(rootDir, { recursive: true })
  const library = saveKnowledgeLibraryFile(settings, loadKnowledgeLibraryFile(settings))

  const records = library.records.map<KnowledgeLibrarySummary>((record) => {
    const fileExists = Boolean(record.libraryPath && fs.existsSync(record.libraryPath))
    let content = ''
    try {
      content = fileExists ? fs.readFileSync(record.libraryPath, 'utf-8') : ''
    } catch {
      content = ''
    }
    const body = stripKnowledgeBriefMetadata(content)
    return {
      ...record,
      fileExists,
      preview: buildKnowledgePreview(content),
      searchText: [
        record.title,
        record.sourceTitle,
        record.sourceId,
        record.sourceUrl,
        body.slice(0, 80_000),
      ].join(' ').toLowerCase(),
    }
  })

  return {
    rootDir,
    libraryPath,
    records,
  }
}

export function findKnowledgeRecordForMaterial(library: KnowledgeLibraryFile, materialPath: string, sourceId: string) {
  const resolvedMaterialPath = path.resolve(materialPath)
  const normalizedSourceId = sanitizeDisplayText(sourceId)
  return library.records.find((record) => {
    const materialMatches = getComparablePath(record.materialPath) === getComparablePath(resolvedMaterialPath)
    const sourceMatches = Boolean(normalizedSourceId && record.sourceId && record.sourceId === normalizedSourceId)
    const targetExists = Boolean(record.libraryPath && fs.existsSync(record.libraryPath))
    return targetExists && (materialMatches || sourceMatches)
  }) ?? null
}

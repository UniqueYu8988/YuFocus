import fs from 'node:fs'
import path from 'node:path'
import {
  getDirectoryByteSize,
  getFileByteSize,
  getTextFileLength,
  readMaterialMetricsSummary,
} from './materialStats'
import {
  listLibraryExportItems,
  type LibraryExportItem,
} from './libraryExportService'
import { getComparablePath } from './pathSafety'

type MaterialReadinessReport = {
  schema_version: 'shijie.material-readiness.v0.1'
  generated_at: string
  material_id: string
  material_path: string
  stage: string
  pipeline_ready: boolean
  summary: {
    source_index_entries: number
  }
}

export type MaterialPackageSummary = {
  name: string
  path: string
  title: string
  sourceId: string
  sourceType: string
  sourceUrl: string
  creator: string
  textSourceType: string
  blockCount: number
  textLength: number
  byteSize: number
  rawTranscriptTextLength: number
  notebooklmTextLength: number
  editorialSummaryTextLength: number
  editorialSummaryHtmlBytes: number
  metricsPath: string
  metricsExists: boolean
  metricsElapsedSeconds: number
  metricsInputTokens: number
  metricsOutputTokens: number
  metricsTotalTokens: number
  metricsMimoCredits: number
  emailPushedAt: number
  updatedAt: number
  libraryRoot: string
  libraryIndexPath: string
  libraryNotebooklmPath: string
  libraryNotebooklmExists: boolean
  libraryEmailPath: string
  libraryEmailExists: boolean
  notebooklmPath: string
  notebooklmExists: boolean
  emailPath: string
  emailExists: boolean
  editorialSummaryStatus: string
  editorialSummaryPath: string
  editorialSummaryExists: boolean
  editorialSummaryHtmlPath: string
  editorialSummaryHtmlExists: boolean
  editorialCardsPath: string
  editorialCardsExists: boolean
  editorialReviewPath: string
  editorialReviewExists: boolean
  rawTranscriptPath: string
  rawTranscriptExists: boolean
  sourceIndexPath: string
  sourceIndexExists: boolean
  handoffPath: string
  handoffExists: boolean
  runStatePath: string
  runStateExists: boolean
  handoffStatusPath: string
  handoffStatusExists: boolean
  workflowStage: string
  workflowStageLabel: string
  nextActionLabel: string
  pipelineReady: boolean
}

function sanitizeDisplayText(value: unknown, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text || fallback
}

function readJsonDocument(documentPath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(documentPath)) return null
    const parsed = JSON.parse(fs.readFileSync(documentPath, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function isUsableEditorialSummary(documentPath: string) {
  if (!fs.existsSync(documentPath)) return false
  try {
    const content = fs.readFileSync(documentPath, 'utf-8').trim()
    if (!content) return false
    if (/request was rejected|considered high risk|cannot read properties/i.test(content)) return false
    return content.length >= 120
  } catch {
    return false
  }
}

function readSourceIndexSummary(documentPath: string) {
  const entryIds = new Set<string>()
  const blockIds = new Set<string>()
  let invalidLineCount = 0
  if (!fs.existsSync(documentPath)) return { entryCount: 0, invalidLineCount, entryIds, blockIds }
  try {
    const lines = fs.readFileSync(documentPath, 'utf-8').split(/\r?\n/u).filter((line) => line.trim())
    for (const line of lines) {
      try {
        const payload = JSON.parse(line) as Record<string, unknown>
        const entryId = sanitizeDisplayText(payload.entry_id ?? '')
        const blockId = sanitizeDisplayText(payload.block_id ?? '')
        if (entryId) entryIds.add(entryId)
        if (blockId) blockIds.add(blockId)
      } catch {
        invalidLineCount += 1
      }
    }
    return { entryCount: lines.length, invalidLineCount, entryIds, blockIds }
  } catch {
    return { entryCount: 0, invalidLineCount: 1, entryIds, blockIds }
  }
}

function buildLightweightMaterialValidationReport({
  materialPath,
  materialId,
  stage,
  ready,
  sourceIndexEntries,
}: {
  materialPath: string
  materialId: string
  stage: string
  ready: boolean
  sourceIndexEntries: number
}): MaterialReadinessReport {
  return {
    schema_version: 'shijie.material-readiness.v0.1',
    generated_at: new Date().toISOString(),
    material_id: materialId,
    material_path: materialPath,
    stage,
    pipeline_ready: ready,
    summary: {
      source_index_entries: sourceIndexEntries,
    },
  }
}

function isMaterialPackageDirectory(materialPath: string) {
  const manifestPath = path.join(materialPath, 'manifest.json')
  const rawTranscriptPath = path.join(materialPath, 'raw_transcript.txt')
  const notebooklmPath = path.join(materialPath, 'exports', 'notebooklm.md')
  const libraryRefsPath = path.join(materialPath, 'library_refs.json')
  const runStatePath = path.join(materialPath, 'run_state.json')
  return fs.existsSync(manifestPath) && (
    fs.existsSync(rawTranscriptPath) ||
    fs.existsSync(notebooklmPath) ||
    fs.existsSync(libraryRefsPath) ||
    fs.existsSync(runStatePath)
  )
}

function collectMaterialPackagePaths(rootDir: string) {
  const materialPaths: string[] = []

  for (const upEntry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!upEntry.isDirectory()) continue
    const upPath = path.join(rootDir, upEntry.name)

    for (const videoEntry of fs.readdirSync(upPath, { withFileTypes: true })) {
      if (!videoEntry.isDirectory()) continue
      const materialPath = path.join(upPath, videoEntry.name)
      if (isMaterialPackageDirectory(materialPath)) {
        materialPaths.push(materialPath)
      }
    }
  }

  return materialPaths
}

export function listMaterialPackages(rootDir: string) {
  fs.mkdirSync(rootDir, { recursive: true })

  const libraryRoot = path.resolve(rootDir, '..', 'library')
  const libraryIndex = listLibraryExportItems(libraryRoot)
  const records: MaterialPackageSummary[] = []
  for (const materialPath of collectMaterialPackagePaths(rootDir)) {
    const entryName = path.basename(materialPath)
    const manifestPath = path.join(materialPath, 'manifest.json')
    let manifest: Record<string, unknown> = {}
    try {
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
      }
    } catch {
      manifest = {}
    }
    const source = manifest.source && typeof manifest.source === 'object' ? manifest.source as Record<string, unknown> : {}
    const acquisition = manifest.acquisition && typeof manifest.acquisition === 'object' ? manifest.acquisition as Record<string, unknown> : {}
    const stat = fs.statSync(materialPath)
    const title = sanitizeDisplayText(source.title ?? entryName, entryName)
    const sourceId = sanitizeDisplayText(source.source_id ?? '')
    const sourceType = sanitizeDisplayText(source.source_type ?? '')
    const sourceUrl = sanitizeDisplayText(source.url ?? '')
    const creator = sanitizeDisplayText(source.creator ?? '')
    const textSourceType = sanitizeDisplayText(acquisition.text_source_type ?? '')
    const comparableMaterialPath = getComparablePath(materialPath)
    const libraryItem: LibraryExportItem | null = libraryIndex.items.find((item) => {
      const itemMaterialPath = item.materialPath ? getComparablePath(item.materialPath) : ''
      return Boolean(
        (itemMaterialPath && itemMaterialPath === comparableMaterialPath) ||
        (sourceId && (item.sourceId === sourceId || item.bvid === sourceId)),
      )
    }) ?? null
    const localNotebooklmPath = path.join(materialPath, 'exports', 'notebooklm.md')
    const localEmailPath = path.join(materialPath, 'delivery', 'email.md')
    const libraryNotebooklmPath = libraryItem?.notebooklmPath || ''
    const libraryEmailPath = libraryItem?.emailPath || ''
    const libraryNotebooklmExists = Boolean(libraryNotebooklmPath && fs.existsSync(libraryNotebooklmPath))
    const libraryEmailExists = Boolean(libraryEmailPath && fs.existsSync(libraryEmailPath))
    const notebooklmPath = libraryNotebooklmExists ? libraryNotebooklmPath : localNotebooklmPath
    const emailPath = libraryEmailExists ? libraryEmailPath : localEmailPath
    const editorialStatusPath = path.join(materialPath, 'summary', 'summary_status.json')
    const editorialSummaryPath = path.join(materialPath, 'summary', 'article.md')
    const editorialSummaryHtmlPath = path.join(materialPath, 'summary', 'article.html')
    const editorialCardsPath = path.join(materialPath, 'summary', 'cards.json')
    const editorialReviewPath = path.join(materialPath, 'summary', 'review.json')
    const metricsPath = path.join(materialPath, 'metrics.json')
    const metricsSummary = readMaterialMetricsSummary(metricsPath)
    const editorialStatusPayload = fs.existsSync(editorialStatusPath)
      ? readJsonDocument(editorialStatusPath) ?? {}
      : {}
    const editorialSummaryUsable = isUsableEditorialSummary(editorialSummaryPath)
    const storedEditorialSummaryStatus = sanitizeDisplayText(
      editorialStatusPayload.status ?? (editorialSummaryUsable ? 'summary_ready' : ''),
    )
    const editorialSummaryStatus = storedEditorialSummaryStatus === 'summary_ready' && !editorialSummaryUsable
      ? 'failed'
      : storedEditorialSummaryStatus
    const emailPushedAt = Number(
      editorialStatusPayload.email_pushed_at ??
      editorialStatusPayload.emailPushedAt ??
      editorialStatusPayload.email_sent_at ??
      editorialStatusPayload.emailSentAt ??
      0,
    ) || 0
    const rawTranscriptPath = path.join(materialPath, 'raw_transcript.txt')
    const sourceIndexPath = path.join(materialPath, 'indexes', 'source_index.jsonl')
    const handoffPath = path.join(materialPath, 'HANDOFF.md')
    const runStatePath = path.join(materialPath, 'run_state.json')
    const handoffStatusPath = path.join(materialPath, 'handoff_status.json')
    const editorialSummaryReady = editorialSummaryStatus === 'summary_ready' && editorialSummaryUsable
    const hasLightweightMaterialFiles =
      fs.existsSync(manifestPath) &&
      (fs.existsSync(rawTranscriptPath) || fs.existsSync(notebooklmPath) || fs.existsSync(editorialStatusPath) || libraryNotebooklmExists || libraryEmailExists)
    if (!hasLightweightMaterialFiles) continue
    const sourceIndexSummary = readSourceIndexSummary(sourceIndexPath)
    const materialId = sanitizeDisplayText(manifest.material_id ?? entryName, entryName)
    const lightweightStage = editorialSummaryReady
      ? 'summary_ready'
      : editorialSummaryStatus === 'failed'
        ? 'summary_failed'
        : fs.existsSync(notebooklmPath)
          ? 'content_ready'
          : fs.existsSync(rawTranscriptPath)
            ? 'transcript_ready'
            : 'material_ready'
    const validationReport = buildLightweightMaterialValidationReport({
      materialPath,
      materialId,
      stage: lightweightStage,
      ready: editorialSummaryReady || fs.existsSync(notebooklmPath) || fs.existsSync(rawTranscriptPath) || libraryNotebooklmExists || libraryEmailExists,
      sourceIndexEntries: sourceIndexSummary.entryCount,
    })
    const workflowStage = lightweightStage
    const workflowStageLabels: Record<string, string> = {
      summary_failed: '编稿失败',
      content_ready: '字幕清洗完成',
      transcript_ready: '原始字幕完成',
      summary_ready: '视频精读稿已就绪',
      material_ready: '字幕资料已就绪',
    }
    const workflowStageLabel = workflowStageLabels[workflowStage] ?? '字幕资料已就绪'
    const nextActionLabels: Record<string, string> = {
      summary_failed: '重新制作文稿',
      content_ready: '制作文稿',
      transcript_ready: '制作文稿',
      summary_ready: '打开精读稿',
      material_ready: '制作文稿',
    }
    const nextActionLabel = nextActionLabels[workflowStage] ?? '制作文稿'
    records.push({
      name: entryName,
      path: materialPath,
      title,
      sourceId,
      sourceType,
      sourceUrl,
      creator,
      textSourceType,
      blockCount: Number(manifest.block_count ?? 0) || 0,
      textLength: Number(manifest.text_length ?? manifest.raw_transcript_length ?? 0) || 0,
      byteSize: getDirectoryByteSize(materialPath),
      rawTranscriptTextLength: getTextFileLength(rawTranscriptPath),
      notebooklmTextLength: getTextFileLength(notebooklmPath),
      editorialSummaryTextLength: getTextFileLength(editorialSummaryPath),
      editorialSummaryHtmlBytes: getFileByteSize(editorialSummaryHtmlPath),
      metricsPath,
      metricsExists: metricsSummary.exists,
      metricsElapsedSeconds: metricsSummary.elapsedSeconds,
      metricsInputTokens: metricsSummary.inputTokens,
      metricsOutputTokens: metricsSummary.outputTokens,
      metricsTotalTokens: metricsSummary.totalTokens,
      metricsMimoCredits: metricsSummary.mimoCredits,
      emailPushedAt,
      updatedAt: stat.mtimeMs,
      libraryRoot,
      libraryIndexPath: libraryIndex.indexPath,
      libraryNotebooklmPath,
      libraryNotebooklmExists,
      libraryEmailPath,
      libraryEmailExists,
      notebooklmPath,
      notebooklmExists: fs.existsSync(notebooklmPath),
      emailPath,
      emailExists: fs.existsSync(emailPath),
      editorialSummaryStatus,
      editorialSummaryPath,
      editorialSummaryExists: editorialSummaryReady,
      editorialSummaryHtmlPath,
      editorialSummaryHtmlExists: editorialSummaryReady && fs.existsSync(editorialSummaryHtmlPath),
      editorialCardsPath,
      editorialCardsExists: fs.existsSync(editorialCardsPath),
      editorialReviewPath,
      editorialReviewExists: fs.existsSync(editorialReviewPath),
      rawTranscriptPath,
      rawTranscriptExists: fs.existsSync(rawTranscriptPath),
      sourceIndexPath,
      sourceIndexExists: fs.existsSync(sourceIndexPath),
      handoffPath,
      handoffExists: fs.existsSync(handoffPath),
      runStatePath,
      runStateExists: fs.existsSync(runStatePath),
      handoffStatusPath,
      handoffStatusExists: fs.existsSync(handoffStatusPath),
      workflowStage,
      workflowStageLabel,
      nextActionLabel,
      pipelineReady: validationReport.pipeline_ready,
    })
  }

  return {
    rootDir,
    libraryRoot,
    libraryIndexPath: libraryIndex.indexPath,
    notebooklmLibraryDir: path.join(libraryRoot, 'notebooklm'),
    emailLibraryDir: path.join(libraryRoot, 'email'),
    records: records.sort((left, right) => right.updatedAt - left.updatedAt),
  }
}

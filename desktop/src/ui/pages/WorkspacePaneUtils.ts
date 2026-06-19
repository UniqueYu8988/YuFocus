import {
  DEFAULT_LOCAL_TRANSCRIPTION_DEVICE,
  DEFAULT_LOCAL_TRANSCRIPTION_LANGUAGE,
  DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID,
  DEFAULT_RESOURCE_MODE,
  DEFAULT_TRANSCRIPTION_PROVIDER,
} from '@/domain/pipeline/coachPreferences'
import type { LearningRecordSummary } from '@/legacy/types/course'
import {
  getMaterialLibraryReadPath,
  getMaterialPrimaryTextLength,
  hasMaterialIssue,
  isMaterialLongDraft,
  isMaterialShortDraft,
  type ArchiveFilterItem,
  type ArchiveShelfFilter,
  type ArchiveStats,
} from '@/ui/panels/workspace/ArchivePaneParts'
import type { KnowledgeSourceFilter } from '@/ui/panels/workspace/KnowledgePaneParts'
import type {
  MaterialInventoryRecord,
  RuntimeSettingsFallback,
  WorkbenchQueueItem,
  WorkbenchSourceItem,
} from '@/ui/panels/workspace/WorkbenchShared'

type PinnedBilibiliSource = Awaited<ReturnType<typeof window.desktopAPI.loadPinnedBilibiliSources>>[number]
type BilibiliFollowSource = Awaited<ReturnType<typeof window.desktopAPI.listBilibiliFollowSources>>['items'][number]
type BilibiliSourceVideos = Awaited<ReturnType<typeof window.desktopAPI.listBilibiliSourceVideos>>

export const FOLLOW_SOURCE_WINDOW_SIZE = 8
export const SOURCE_VIDEO_WINDOW_SIZE = 6
export const WORKBENCH_LIST_PAGE_SIZE = 6

export const MIMO_TEXT_MODELS = ['mimo-v2.5-pro', 'mimo-v2.5'] as const

export function buildInitialDraft(runtimeSettings: RuntimeSettingsFallback) {
  return {
    sessdata: runtimeSettings?.sessdata || '',
    output_dir: runtimeSettings?.output_dir || '',
    obsidian_vault_path: runtimeSettings?.obsidian_vault_path || '',
    obsidian_export_folder: runtimeSettings?.obsidian_export_folder || '视界专注',
    obsidian_auto_sync: runtimeSettings?.obsidian_auto_sync ?? true,
    tts_provider: runtimeSettings?.tts_provider && runtimeSettings.tts_provider !== 'none' ? runtimeSettings.tts_provider : 'mimo',
    minimax_api_key: runtimeSettings?.minimax_api_key || '',
    minimax_tts_endpoint: runtimeSettings?.minimax_tts_endpoint || 'https://api.minimaxi.com/v1/t2a_v2',
    minimax_tts_model: runtimeSettings?.minimax_tts_model || 'speech-2.8-hd',
    minimax_tts_voice_id: runtimeSettings?.minimax_tts_voice_id || '',
    minimax_tts_speed: runtimeSettings?.minimax_tts_speed ?? 1,
    minimax_tts_volume: runtimeSettings?.minimax_tts_volume ?? 1,
    minimax_tts_pitch: runtimeSettings?.minimax_tts_pitch ?? 0,
    mimo_api_key: runtimeSettings?.mimo_api_key || '',
    mimo_text_endpoint: runtimeSettings?.mimo_text_endpoint || 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
    mimo_text_model: runtimeSettings?.mimo_text_model || 'mimo-v2.5-pro',
    mimo_tts_endpoint: runtimeSettings?.mimo_tts_endpoint || 'https://api.xiaomimimo.com/v1/chat/completions',
    mimo_tts_model: runtimeSettings?.mimo_tts_model || 'mimo-v2.5-tts',
    mimo_tts_voice_id: runtimeSettings?.mimo_tts_voice_id || '茉莉',
    mimo_tts_style_prompt: runtimeSettings?.mimo_tts_style_prompt || '自然 清晰 语速适中',
    transcription_provider: runtimeSettings?.transcription_provider || DEFAULT_TRANSCRIPTION_PROVIDER,
    local_transcription_root: runtimeSettings?.local_transcription_root || '',
    local_transcription_python: runtimeSettings?.local_transcription_python || '',
    local_transcription_model_id: runtimeSettings?.local_transcription_model_id || DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID,
    local_transcription_device: runtimeSettings?.local_transcription_device || DEFAULT_LOCAL_TRANSCRIPTION_DEVICE,
    local_transcription_language: runtimeSettings?.local_transcription_language || DEFAULT_LOCAL_TRANSCRIPTION_LANGUAGE,
    resource_mode: runtimeSettings?.resource_mode || DEFAULT_RESOURCE_MODE,
    background_automation_enabled: runtimeSettings?.background_automation_enabled ?? true,
    background_check_interval_minutes: runtimeSettings?.background_check_interval_minutes ?? 360,
    email_push_enabled: runtimeSettings?.email_push_enabled ?? false,
    email_smtp_host: runtimeSettings?.email_smtp_host || '',
    email_smtp_port: runtimeSettings?.email_smtp_port ?? 465,
    email_smtp_secure: runtimeSettings?.email_smtp_secure ?? true,
    email_smtp_user: runtimeSettings?.email_smtp_user || '',
    email_smtp_password: runtimeSettings?.email_smtp_password || '',
    email_from: runtimeSettings?.email_from || '',
    email_to: runtimeSettings?.email_to || '',
    workbench_queue_concurrency: runtimeSettings?.workbench_queue_concurrency ?? 3,
  }
}

export function formatRelativeTime(timestamp: number) {
  if (!timestamp) return '刚刚'
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚继续过'
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟前`
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时前`
  if (diff < day * 7) return `${Math.max(1, Math.round(diff / day))} 天前`

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(timestamp)
}

export function formatCompactNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`
  return String(Math.round(value))
}

export function getDurationBarPercent(durationSeconds: number, maxDurationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  return Math.max(8, Math.min(100, Math.round((durationSeconds / Math.max(1, maxDurationSeconds)) * 100)))
}

export function buildRecordSearchText(record: LearningRecordSummary) {
  return [record.title, record.sourceTitle, record.sourceId, record.packageId, record.currentNodeTitle ?? '']
    .join(' ')
    .toLowerCase()
}

export function stripKnowledgeBriefMetadata(content: string) {
  return content
    .replace(/^<!--\s*shijie:learning-notes[\s\S]*?-->\s*/u, '')
    .replace(/^<!--\s*shijie:knowledge-brief[\s\S]*?-->\s*/u, '')
    .trim()
}

export function isRejectedModelDocument(content: string) {
  const normalized = content.toLowerCase()
  return (
    normalized.includes('the request was rejected') ||
    normalized.includes('considered high risk') ||
    normalized.includes('content policy') ||
    normalized.includes('safety policy')
  )
}

export function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function getNotebookLmImportPath(record: MaterialInventoryRecord) {
  if (record.notebooklmExists && record.notebooklmPath) return record.notebooklmPath
  if (record.rawTranscriptExists && record.rawTranscriptPath) return record.rawTranscriptPath
  return record.path
}

export function getNotebookLmPathTitle(record: MaterialInventoryRecord) {
  if (record.notebooklmExists && record.notebooklmPath) return '复制 NotebookLM 清洗稿路径'
  if (record.rawTranscriptExists && record.rawTranscriptPath) return '复制原始字幕路径'
  return '复制资料包路径'
}

export function normalizeCreatorName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

export function materialMatchesPinnedSource(record: MaterialInventoryRecord, pinnedSources: PinnedBilibiliSource[]) {
  const creator = normalizeCreatorName(record.creator || '')
  return Boolean(creator && pinnedSources.some((source) => normalizeCreatorName(source.name) === creator))
}

export function canOpenMaterialBrief(record: MaterialInventoryRecord) {
  return record.editorialSummaryExists || record.workflowStage === 'summary_ready'
}

export function normalizeWorkbenchSourceKey(value: string) {
  return value.trim().toLowerCase()
}

export function getQueueSourceKey(queue: WorkbenchQueueItem) {
  return normalizeWorkbenchSourceKey(queue.bvid || queue.url || queue.queueId)
}

export function getMaterialSourceKey(record: MaterialInventoryRecord) {
  return normalizeWorkbenchSourceKey(record.sourceId || record.sourceUrl || record.path)
}

export function notifyMaterialPackagesChanged() {
  window.dispatchEvent(new CustomEvent('shijie:material-packages-changed'))
}

export function getWorkbenchSourceTitle(item: WorkbenchSourceItem) {
  return item.record?.title || item.queue?.title || '未命名资料'
}

export function getWorkbenchSourceStatus(item: WorkbenchSourceItem) {
  const record = item.record

  if (item.queue?.status === 'processing') {
    return { label: '正在处理', tone: 'red' as const, active: true }
  }

  if (item.queue?.status === 'failed' && !record) {
    return { label: '处理失败', tone: 'red' as const, active: false }
  }

  if (record?.editorialSummaryStatus === 'failed') {
    return { label: '编稿失败', tone: 'red' as const, active: false }
  }

  if (
    record?.workflowStage === 'needs_restructure' ||
    record?.workflowStage === 'needs_deepening' ||
    record?.workflowStage === 'dossier_incomplete'
  ) {
    return { label: '需要处理', tone: 'red' as const, active: false }
  }

  if (record?.editorialSummaryExists) {
    return { label: '精读稿完成', tone: 'green' as const, active: false }
  }

  if (record && canOpenMaterialBrief(record)) {
    return { label: '资料已完成', tone: 'green' as const, active: false }
  }

  if (record?.notebooklmExists || record?.rawTranscriptExists || item.queue?.status === 'done') {
    return { label: '字幕清理完成', tone: 'yellow' as const, active: false }
  }

  return { label: '待处理', tone: 'gray' as const, active: false }
}

export function getWorkbenchSourceMeta(item: WorkbenchSourceItem) {
  if (item.record) {
    const record = item.record
    return [
      record.sourceId,
      record.creator,
      record.textLength ? `${formatCompactNumber(record.textLength)} 字` : '',
      formatRelativeTime(record.updatedAt),
    ].filter(Boolean)
  }

  const queue = item.queue
  if (!queue) return []
  return [
    queue.sourceName || queue.authorName,
    queue.bvid,
  ].filter(Boolean)
}

function createWorkbenchQueueId(bvid: string) {
  return `${bvid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function createWorkbenchQueueItem(
  video: BilibiliVideoMetadata & { sourceName?: string },
  status: WorkbenchQueueItem['status'] = 'queued',
  options: {
    queueSource?: WorkbenchQueueItem['queueSource']
    editorialMode?: WorkbenchQueueItem['editorialMode']
    pipelineMode?: WorkbenchQueueItem['pipelineMode']
  } = {},
): WorkbenchQueueItem {
  const queueSource = options.queueSource || 'manual'
  return {
    ...video,
    sourceName: video.sourceName || video.authorName,
    queueId: createWorkbenchQueueId(video.bvid),
    queueSource,
    editorialMode: options.editorialMode || (queueSource === 'follow_source' ? 'force' : 'off'),
    pipelineMode: options.pipelineMode,
    status,
  }
}

export function getArchiveMaterialRecords(records: MaterialInventoryRecord[]) {
  return records.filter((record) =>
    record.rawTranscriptExists ||
    record.notebooklmExists ||
    record.editorialSummaryExists ||
    record.editorialSummaryStatus === 'failed',
  )
}

export function filterArchiveMaterialRecords(options: {
  records: MaterialInventoryRecord[]
  shelfFilter: ArchiveShelfFilter
  query: string
  pinnedSources: PinnedBilibiliSource[]
}) {
  const normalizedQuery = options.query.trim().toLocaleLowerCase('zh-CN')
  return options.records.filter((record) => {
    if (options.shelfFilter === 'pinned') return materialMatchesPinnedSource(record, options.pinnedSources)
    if (options.shelfFilter === 'misc') return !materialMatchesPinnedSource(record, options.pinnedSources)
    if (options.shelfFilter === 'long') return isMaterialLongDraft(record)
    if (options.shelfFilter === 'short') return isMaterialShortDraft(record)
    if (options.shelfFilter === 'issue') return hasMaterialIssue(record)
    return true
  }).filter((record) => {
    if (!normalizedQuery) return true
    return [
      record.title,
      record.creator,
      record.sourceId,
      record.sourceUrl,
      record.workflowStageLabel,
      record.path,
    ].join(' ').toLocaleLowerCase('zh-CN').includes(normalizedQuery)
  })
}

export function buildArchiveStats(records: MaterialInventoryRecord[]): ArchiveStats {
  const now = Date.now()
  const todayStart = startOfLocalDay(now)
  const weekWindowMs = 7 * 24 * 60 * 60 * 1000
  const latestUpdatedAt = records.reduce((latest, record) => Math.max(latest, record.updatedAt || 0), 0)
  return {
    articles: records.filter((record) => record.editorialSummaryExists).length,
    materials: records.filter((record) => record.rawTranscriptExists || record.notebooklmExists).length,
    todayNew: records.filter((record) => record.updatedAt >= todayStart).length,
    weekNew: records.filter((record) => now - record.updatedAt <= weekWindowMs).length,
    totalTextLength: records.reduce((sum, record) => sum + getMaterialPrimaryTextLength(record), 0),
    totalBytes: records.reduce((sum, record) => sum + (record.byteSize || 0), 0),
    totalElapsedSeconds: records.reduce((sum, record) => sum + (record.metricsElapsedSeconds || 0), 0),
    totalTokens: records.reduce((sum, record) => sum + (record.metricsTotalTokens || 0), 0),
    issues: records.filter(hasMaterialIssue).length,
    latestUpdatedAt,
  }
}

export function buildArchiveFilters(records: MaterialInventoryRecord[], pinnedSources: PinnedBilibiliSource[]): ArchiveFilterItem[] {
  const pinnedCount = records.filter((record) => materialMatchesPinnedSource(record, pinnedSources)).length
  return [
    { id: 'all' as const, label: '全部', count: records.length },
    { id: 'pinned' as const, label: '收藏源', count: pinnedCount },
    { id: 'misc' as const, label: '拾遗', count: records.length - pinnedCount },
    { id: 'long' as const, label: '长稿', count: records.filter(isMaterialLongDraft).length },
    { id: 'short' as const, label: '短稿', count: records.filter(isMaterialShortDraft).length },
    { id: 'issue' as const, label: '异常', count: records.filter(hasMaterialIssue).length },
  ]
}

export function filterKnowledgeMaterialRecords(options: {
  records: MaterialInventoryRecord[]
  query: string
  sourceFilter: KnowledgeSourceFilter
}) {
  const normalizedQuery = options.query.trim().toLowerCase()
  const pinnedCreators = new Set(
    options.sourceFilter.kind === 'misc'
      ? options.sourceFilter.pinnedCreatorNames.map(normalizeCreatorName)
      : [],
  )
  const selectedCreator = options.sourceFilter.kind === 'creator'
    ? normalizeCreatorName(options.sourceFilter.creator)
    : ''

  return options.records.filter((record) => {
    const hasReadableOutput = Boolean(getMaterialLibraryReadPath(record))
    if (!hasReadableOutput) return false
    const creator = normalizeCreatorName(record.creator || '')
    if (options.sourceFilter.kind === 'creator' && creator !== selectedCreator) return false
    if (options.sourceFilter.kind === 'misc' && creator && pinnedCreators.has(creator)) return false
    if (!normalizedQuery) return true
    const searchText = [
      record.title,
      record.creator,
      record.sourceId,
      record.sourceUrl,
      record.workflowStageLabel,
      record.textSourceType,
    ].join(' ').toLowerCase()
    return searchText.includes(normalizedQuery)
  })
}

export function filterFollowSources(options: {
  items: BilibiliFollowSource[]
  pinnedOnly: boolean
  pinnedSources: PinnedBilibiliSource[]
  query: string
}) {
  const query = options.query.trim().toLowerCase()
  const pinnedIds = new Set(options.pinnedSources.map((source) => source.mid))
  const filtered = query
    ? options.items.filter((item) => `${item.name} ${item.mid} ${item.sign} ${item.officialTitle}`.toLowerCase().includes(query))
    : options.items
  const visible = options.pinnedOnly
    ? filtered.filter((item) => pinnedIds.has(item.mid))
    : filtered

  return [...visible].sort((left, right) => {
    const leftPinned = pinnedIds.has(left.mid) ? 0 : 1
    const rightPinned = pinnedIds.has(right.mid) ? 0 : 1
    if (leftPinned !== rightPinned) return leftPinned - rightPinned
    return 0
  })
}

export function flattenBilibiliSourceVideos(payload: BilibiliSourceVideos | null) {
  return (payload?.sources ?? []).flatMap((source) =>
    source.videos.map((video) => ({
      ...video,
      sourceName: source.name,
    })),
  )
}

export function buildWorkbenchSourceItems(records: MaterialInventoryRecord[], queueItems: WorkbenchQueueItem[]): WorkbenchSourceItem[] {
  const queuePriority: Record<WorkbenchQueueItem['status'], number> = {
    processing: 0,
    failed: 1,
    queued: 2,
    done: 4,
  }
  const bySource = new Map<string, WorkbenchSourceItem>()

  records.forEach((record, index) => {
    const key = getMaterialSourceKey(record)
    bySource.set(key, {
      key,
      record,
      order: 10 + index,
    })
  })

  queueItems.forEach((queue) => {
    const key = getQueueSourceKey(queue)
    const existing = bySource.get(key)
    if (existing) {
      existing.queue = queue
      existing.order = Math.min(existing.order, queue.status === 'done' ? existing.order : queuePriority[queue.status])
      return
    }

    bySource.set(key, {
      key,
      queue,
      order: queuePriority[queue.status],
    })
  })

  return Array.from(bySource.values()).sort((left, right) => left.order - right.order)
}

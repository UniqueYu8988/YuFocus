import {
  extractBilibiliBvid,
  listBilibiliSourceVideoPage,
  listBilibiliSourceVideos,
  type BilibiliSettings,
  type BilibiliSourceVideosPayload,
  type BilibiliVideoMetadata,
} from './bilibiliSourceApi'
import type { MaterialPackageSummary } from '../services/materialInventory'
import type { WorkbenchQueueItem } from '../queue/workbenchQueue'
import {
  listRegistryVideos,
  mergeVideosIntoRegistry,
  readVideoRegistry,
} from '../services/videoRegistry'

export type PinnedBilibiliSource = {
  mid: string
  name: string
  face: string
  sign: string
  officialTitle: string
  pinnedAt: number
}

export type SourceDiscoveryResult = {
  discovered: WorkbenchQueueItem[]
  checkedSourceCount: number
  totalVideoCount: number
}

type HistoryBackfillSource = PinnedBilibiliSource & {
  priority?: number
  trackHistory?: boolean
  historyStatus?: string
}

function sanitizeDisplayText(value: unknown, fallback = '') {
  const normalized = String(value ?? '').replace(/[\x00-\x1F]/g, '').trim()
  return normalized || fallback
}

export function normalizePinnedBilibiliSource(raw: unknown): PinnedBilibiliSource | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const mid = sanitizeDisplayText(item.mid ?? '')
  const name = sanitizeDisplayText(item.name ?? '')
  if (!mid || !name) return null

  return {
    mid,
    name,
    face: sanitizeDisplayText(item.face ?? ''),
    sign: sanitizeDisplayText(item.sign ?? ''),
    officialTitle: sanitizeDisplayText(item.officialTitle ?? ''),
    pinnedAt: Number(item.pinnedAt ?? Date.now()) || Date.now(),
  }
}

export function normalizePinnedBilibiliSources(raw: unknown): PinnedBilibiliSource[] {
  const items = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const normalized: PinnedBilibiliSource[] = []
  for (const item of items) {
    const normalizedItem = normalizePinnedBilibiliSource(item)
    if (!normalizedItem || seen.has(normalizedItem.mid)) continue
    seen.add(normalizedItem.mid)
    normalized.push(normalizedItem)
  }
  return normalized.sort((left, right) => right.pinnedAt - left.pinnedAt).slice(0, 48)
}

function createSourceQueueItem(
  video: BilibiliVideoMetadata,
  sourceName = '',
  queueSource: WorkbenchQueueItem['queueSource'],
): WorkbenchQueueItem {
  const now = Date.now()
  return {
    ...video,
    sourceName: sourceName || video.authorName,
    queueId: `${video.bvid}-${now}`,
    queueSource,
    editorialMode: 'off',
    pipelineMode: 'subtitle_only',
    status: 'queued',
    lastError: '',
    queuedAt: now,
    updatedAt: now,
  }
}

export function createBackgroundQueueItem(video: BilibiliVideoMetadata, sourceName = ''): WorkbenchQueueItem {
  return createSourceQueueItem(video, sourceName, 'fresh')
}

export function createHistoryBackfillQueueItem(video: BilibiliVideoMetadata, sourceName = ''): WorkbenchQueueItem {
  return createSourceQueueItem(video, sourceName, 'history')
}

export function tryExtractBilibiliBvid(input: unknown) {
  try {
    return extractBilibiliBvid(input)
  } catch {
    return ''
  }
}

export function isVideoPublishedInDiscoveryWindow(video: BilibiliVideoMetadata, discoveryWindowMs: number, now = Date.now()) {
  const pubdateMs = Number(video.pubdate || 0) * 1000
  return pubdateMs > 0 && pubdateMs >= now - discoveryWindowMs && pubdateMs <= now + 5 * 60 * 1000
}

export function materialRecordMatchesBvid(record: MaterialPackageSummary, bvid: string) {
  if (!bvid) return false
  return record.sourceId === bvid || tryExtractBilibiliBvid(record.sourceUrl || record.name || '') === bvid
}

export function collectKnownWorkbenchBvids(
  queue: WorkbenchQueueItem[],
  materialRecords: MaterialPackageSummary[],
  libraryItems: Array<{ bvid?: string; sourceId?: string }> = [],
) {
  const known = new Set<string>()
  for (const item of queue) {
    if (item.bvid) known.add(item.bvid)
  }
  for (const record of materialRecords) {
    if (record.sourceId) known.add(record.sourceId)
    const bvid = tryExtractBilibiliBvid(record.sourceUrl || record.name || '')
    if (bvid) known.add(bvid)
  }
  for (const item of libraryItems) {
    if (item.bvid) known.add(item.bvid)
    if (item.sourceId) known.add(item.sourceId)
  }
  return known
}

function normalizeSourceRequest(source: { mid: string; name?: string }) {
  return {
    mid: sanitizeDisplayText(source.mid),
    name: sanitizeDisplayText(source.name ?? source.mid),
  }
}

export function readRegisteredBilibiliSourceVideos(options: {
  registryRoot: string
  sources: Array<{ mid: string; name?: string }>
  error?: string
}): BilibiliSourceVideosPayload {
  const sources = options.sources
    .map(normalizeSourceRequest)
    .filter((source) => source.mid)
    .slice(0, 12)
  const resultSources = sources.map((source) => {
    const registry = readVideoRegistry(options.registryRoot, source.mid)
    return {
      mid: source.mid,
      name: source.name,
      error: options.error ?? '',
      videos: listRegistryVideos(options.registryRoot, source.mid),
      lastSync: Date.parse(registry.last_sync || '') || 0,
    }
  })
  return {
    provider: 'bilibili',
    fetchedAt: resultSources.reduce((latest, source) => Math.max(latest, source.lastSync), 0),
    totalVideos: resultSources.reduce((sum, source) => sum + source.videos.length, 0),
    sources: resultSources.map(({ lastSync: _lastSync, ...source }) => source),
  }
}

export async function listRegisteredBilibiliSourceVideos(options: {
  settings: BilibiliSettings
  sources: Array<{ mid: string; name?: string }>
  pageSize?: number
  registryRoot: string
}): Promise<BilibiliSourceVideosPayload> {
  const normalizedSources = options.sources
    .map(normalizeSourceRequest)
    .filter((source) => source.mid)
    .slice(0, 12)

  if (!normalizedSources.length) {
    return {
      provider: 'bilibili',
      fetchedAt: Date.now(),
      totalVideos: 0,
      sources: [],
    }
  }

  let apiPayload: BilibiliSourceVideosPayload
  try {
    apiPayload = await listBilibiliSourceVideos(options.settings, normalizedSources, options.pageSize)
  } catch (error) {
    return readRegisteredBilibiliSourceVideos({
      registryRoot: options.registryRoot,
      sources: normalizedSources,
      error: error instanceof Error ? error.message : '投稿列表读取失败',
    })
  }

  const bySource = new Map(apiPayload.sources.map((source) => [source.mid, source]))
  const resultSources = normalizedSources.map((source) => {
    const apiSource = bySource.get(source.mid)
    if (apiSource?.videos.length) {
      mergeVideosIntoRegistry({
        registryRoot: options.registryRoot,
        upId: source.mid,
        videos: apiSource.videos,
      })
    }
    return {
      mid: source.mid,
      name: apiSource?.name || source.name,
      error: apiSource?.error || '',
      videos: listRegistryVideos(options.registryRoot, source.mid),
    }
  })

  return {
    provider: 'bilibili',
    fetchedAt: apiPayload.fetchedAt,
    totalVideos: resultSources.reduce((sum, source) => sum + source.videos.length, 0),
    sources: resultSources,
  }
}

export async function discoverPinnedSourceVideos(options: {
  settings: BilibiliSettings
  pinnedSources: PinnedBilibiliSource[]
  knownBvids: Set<string>
  registryRoot: string
  sourceQueryBatchSize: number
  recentVideoPageSize: number
  recentFeedLimit: number
}): Promise<SourceDiscoveryResult> {
  const {
    settings,
    pinnedSources,
    knownBvids,
    registryRoot,
    sourceQueryBatchSize,
    recentVideoPageSize,
    recentFeedLimit,
  } = options

  if (!pinnedSources.length) {
    return { discovered: [], checkedSourceCount: 0, totalVideoCount: 0 }
  }

  const candidateVideos: { video: BilibiliVideoMetadata; sourceName: string }[] = []
  const candidateBvids = new Set<string>()
  let checkedSourceCount = 0
  let totalVideoCount = 0

  for (let index = 0; index < pinnedSources.length; index += sourceQueryBatchSize) {
    const batch = pinnedSources.slice(index, index + sourceQueryBatchSize)
    const response = await listRegisteredBilibiliSourceVideos({
      settings,
      sources: batch.map((source) => ({ mid: source.mid, name: source.name })),
      pageSize: recentVideoPageSize,
      registryRoot,
    })
    checkedSourceCount += response.sources.length
    totalVideoCount += response.totalVideos

    for (const source of response.sources) {
      for (const video of source.videos) {
        if (knownBvids.has(video.bvid)) continue
        if (candidateBvids.has(video.bvid)) continue
        candidateBvids.add(video.bvid)
        candidateVideos.push({ video, sourceName: source.name })
      }
    }
  }

  const discovered = candidateVideos
    .sort((left, right) => (right.video.pubdate || 0) - (left.video.pubdate || 0))
    .slice(0, Math.max(1, recentFeedLimit))
    .map(({ video, sourceName }) => {
      knownBvids.add(video.bvid)
      return createBackgroundQueueItem(video, sourceName)
    })

  return {
    discovered,
    checkedSourceCount,
    totalVideoCount,
  }
}

export function discoverHistoryBackfillVideo(options: {
  registryRoot: string
  sources: HistoryBackfillSource[]
  knownBvids: Set<string>
}) {
  const sources = options.sources
    .filter((source) => source.trackHistory !== false)
    .sort((left, right) => (
      (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER) ||
      right.pinnedAt - left.pinnedAt
    ))

  for (const source of sources) {
    const candidate = listRegistryVideos(options.registryRoot, source.mid)
      .filter((video) => video.bvid && !options.knownBvids.has(video.bvid))
      .sort((left, right) => (right.pubdate || 0) - (left.pubdate || 0))[0]
    if (!candidate) continue
    options.knownBvids.add(candidate.bvid)
    return createHistoryBackfillQueueItem(candidate, source.name)
  }

  return null
}

export async function fetchAndMergeHistoryBackfillPage(options: {
  settings: BilibiliSettings
  registryRoot: string
  source: HistoryBackfillSource
  page: number
  pageSize: number
}) {
  const result = await listBilibiliSourceVideoPage(
    options.settings,
    { mid: options.source.mid, name: options.source.name },
    options.page,
    options.pageSize,
  )
  if (result.videos.length) {
    mergeVideosIntoRegistry({
      registryRoot: options.registryRoot,
      upId: options.source.mid,
      videos: result.videos,
    })
  }
  return {
    sourceMid: options.source.mid,
    page: result.page,
    pageSize: result.pageSize,
    fetchedVideoCount: result.videos.length,
    total: result.total,
    hasMore: result.hasMore,
  }
}

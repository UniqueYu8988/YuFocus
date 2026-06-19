import { extractBilibiliBvid, listBilibiliSourceVideos, type BilibiliSettings, type BilibiliSourceVideosPayload, type BilibiliVideoMetadata } from './bilibiliSourceApi'
import type { MaterialPackageSummary } from '../services/materialInventory'
import type { WorkbenchQueueItem } from '../queue/workbenchQueue'
import {
  listRegistryVideos,
  mergeVideosIntoRegistry,
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

export function createBackgroundQueueItem(video: BilibiliVideoMetadata, sourceName = ''): WorkbenchQueueItem {
  const now = Date.now()
  return {
    ...video,
    sourceName: sourceName || video.authorName,
    queueId: `${video.bvid}-${now}`,
    queueSource: 'follow_source',
    editorialMode: 'off',
    pipelineMode: 'subtitle_only',
    status: 'queued',
    lastError: '',
    queuedAt: now,
    updatedAt: now,
  }
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

export function collectKnownWorkbenchBvids(queue: WorkbenchQueueItem[], materialRecords: MaterialPackageSummary[]) {
  const known = new Set<string>()
  for (const item of queue) {
    if (item.bvid) known.add(item.bvid)
  }
  for (const record of materialRecords) {
    if (record.sourceId) known.add(record.sourceId)
    const bvid = tryExtractBilibiliBvid(record.sourceUrl || record.name || '')
    if (bvid) known.add(bvid)
  }
  return known
}

function normalizeSourceRequest(source: { mid: string; name?: string }) {
  return {
    mid: sanitizeDisplayText(source.mid),
    name: sanitizeDisplayText(source.name ?? source.mid),
  }
}

function registryPayloadFromSources(options: {
  registryRoot: string
  sources: Array<{ mid: string; name: string }>
  fetchedAt?: number
  error?: string
}): BilibiliSourceVideosPayload {
  const fetchedAt = options.fetchedAt ?? Date.now()
  const resultSources = options.sources.map((source) => ({
    mid: source.mid,
    name: source.name,
    error: options.error ?? '',
    videos: listRegistryVideos(options.registryRoot, source.mid),
  }))
  return {
    provider: 'bilibili',
    fetchedAt,
    totalVideos: resultSources.reduce((sum, source) => sum + source.videos.length, 0),
    sources: resultSources,
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
    return registryPayloadFromSources({
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
  discoveryWindowMs: number
  sourceQueryBatchSize: number
  recentVideoPageSize: number
}): Promise<SourceDiscoveryResult> {
  const {
    settings,
    pinnedSources,
    knownBvids,
    registryRoot,
    discoveryWindowMs,
    sourceQueryBatchSize,
    recentVideoPageSize,
  } = options

  if (!pinnedSources.length) {
    return { discovered: [], checkedSourceCount: 0, totalVideoCount: 0 }
  }

  const discovered: WorkbenchQueueItem[] = []
  let checkedSourceCount = 0
  let totalVideoCount = 0
  const now = Date.now()

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
        if (!isVideoPublishedInDiscoveryWindow(video, discoveryWindowMs, now)) continue
        if (knownBvids.has(video.bvid)) continue
        knownBvids.add(video.bvid)
        discovered.push(createBackgroundQueueItem(video, source.name))
      }
    }
  }

  discovered.sort((left, right) => (right.pubdate || 0) - (left.pubdate || 0))
  return {
    discovered,
    checkedSourceCount,
    totalVideoCount,
  }
}

import { extractBilibiliBvid, listBilibiliSourceVideos, type BilibiliSettings, type BilibiliVideoMetadata } from './bilibiliSourceApi'
import type { MaterialPackageSummary } from './materialInventory'
import type { WorkbenchQueueItem } from './workbenchQueue'

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
    editorialMode: 'force',
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

export async function discoverPinnedSourceVideos(options: {
  settings: BilibiliSettings
  pinnedSources: PinnedBilibiliSource[]
  knownBvids: Set<string>
  discoveryWindowMs: number
  sourceQueryBatchSize: number
  recentVideoPageSize: number
}): Promise<SourceDiscoveryResult> {
  const {
    settings,
    pinnedSources,
    knownBvids,
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
    const response = await listBilibiliSourceVideos(
      settings,
      batch.map((source) => ({ mid: source.mid, name: source.name })),
      recentVideoPageSize,
    )
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

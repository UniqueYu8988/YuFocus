import path from 'node:path'

export type EditorialSummaryMode = 'auto' | 'force' | 'off'

export type WorkbenchQueueVideo = {
  bvid: string
  aid: string
  title: string
  authorMid: string
  authorName: string
  pic: string
  description: string
  durationText: string
  durationSeconds: number
  pubdate: number
  statView: number
  url: string
}

export type WorkbenchQueueItem = WorkbenchQueueVideo & {
  queueId: string
  sourceName?: string
  queueSource?: 'manual' | 'follow_source'
  editorialMode?: EditorialSummaryMode
  status: 'queued' | 'processing' | 'done' | 'failed'
  materialPath?: string
  lastError?: string
  queuedAt?: number
  updatedAt?: number
}

function sanitizeDisplayText(value: unknown, fallback = '') {
  const normalized = String(value ?? '').replace(/[\x00-\x1F]/g, '').trim()
  return normalized || fallback
}

function sanitizeOptionalPath(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  return path.resolve(normalized)
}

export function sanitizeEditorialSummaryMode(value: unknown): EditorialSummaryMode {
  const mode = sanitizeDisplayText(value ?? 'auto').toLowerCase()
  if (mode === 'force' || mode === 'off') return mode
  return 'auto'
}

export function normalizeWorkbenchQueueItem(raw: unknown): WorkbenchQueueItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const bvid = sanitizeDisplayText(item.bvid ?? '')
  const title = sanitizeDisplayText(item.title ?? '')
  if (!bvid || !title) return null
  const rawStatus = sanitizeDisplayText(item.status ?? 'queued')
  const status: WorkbenchQueueItem['status'] =
    rawStatus === 'done' || rawStatus === 'failed' || rawStatus === 'processing'
      ? rawStatus
      : 'queued'
  const queueSource = sanitizeDisplayText(item.queueSource ?? '') === 'follow_source' ? 'follow_source' : 'manual'

  return {
    queueId: sanitizeDisplayText(item.queueId ?? `${bvid}-${Date.now()}`),
    bvid,
    aid: sanitizeDisplayText(item.aid ?? ''),
    title,
    authorMid: sanitizeDisplayText(item.authorMid ?? ''),
    authorName: sanitizeDisplayText(item.authorName ?? ''),
    sourceName: sanitizeDisplayText(item.sourceName ?? item.authorName ?? ''),
    pic: sanitizeDisplayText(item.pic ?? ''),
    description: sanitizeDisplayText(item.description ?? ''),
    durationText: sanitizeDisplayText(item.durationText ?? ''),
    durationSeconds: Number(item.durationSeconds ?? 0) || 0,
    pubdate: Number(item.pubdate ?? 0) || 0,
    statView: Number(item.statView ?? 0) || 0,
    url: sanitizeDisplayText(item.url ?? `https://www.bilibili.com/video/${bvid}`),
    queueSource,
    editorialMode: sanitizeEditorialSummaryMode(item.editorialMode ?? (queueSource === 'follow_source' ? 'force' : 'off')),
    status,
    materialPath: sanitizeOptionalPath(item.materialPath ?? ''),
    lastError: sanitizeDisplayText(item.lastError ?? ''),
    queuedAt: Number(item.queuedAt ?? Date.now()) || Date.now(),
    updatedAt: Number(item.updatedAt ?? Date.now()) || Date.now(),
  }
}

export function normalizeWorkbenchQueue(raw: unknown): WorkbenchQueueItem[] {
  const items = Array.isArray(raw) ? raw : []
  const seenQueueIds = new Set<string>()
  const seenBvids = new Set<string>()
  const normalized: WorkbenchQueueItem[] = []
  for (const item of items) {
    const normalizedItem = normalizeWorkbenchQueueItem(item)
    if (!normalizedItem || seenQueueIds.has(normalizedItem.queueId) || seenBvids.has(normalizedItem.bvid)) continue
    seenQueueIds.add(normalizedItem.queueId)
    seenBvids.add(normalizedItem.bvid)
    normalized.push(normalizedItem)
  }
  return normalized.slice(0, 200)
}

export function countProcessingWorkbenchItems(items: WorkbenchQueueItem[]) {
  return items.filter((item) => item.status === 'processing').length
}

export function recoverInterruptedWorkbenchQueueItems(items: WorkbenchQueueItem[]) {
  if (!items.some((item) => item.status === 'processing')) return { changed: false, items }
  const now = Date.now()
  return {
    changed: true,
    items: items.map((item) => (
      item.status === 'processing'
        ? { ...item, status: 'queued' as const, updatedAt: now }
        : item
    )),
  }
}

export function appendWorkbenchQueueItemsToList(current: WorkbenchQueueItem[], items: WorkbenchQueueItem[]) {
  if (!items.length) return current
  const known = new Set(current.map((item) => item.bvid).filter(Boolean))
  const merged = [...current]
  for (const item of items) {
    if (known.has(item.bvid)) continue
    known.add(item.bvid)
    merged.push(item)
  }
  return normalizeWorkbenchQueue(merged)
}

export function updateWorkbenchQueueItemInList(
  items: WorkbenchQueueItem[],
  queueId: string,
  patch: Partial<WorkbenchQueueItem>,
) {
  const now = Date.now()
  return normalizeWorkbenchQueue(items.map((item) => (
    item.queueId === queueId
      ? { ...item, ...patch, updatedAt: now }
      : item
  )))
}

export function claimNextQueuedWorkbenchItemFromList(
  items: WorkbenchQueueItem[],
  concurrency: number,
) {
  if (countProcessingWorkbenchItems(items) >= concurrency) return { item: null, items }
  const target = items.find((item) => item.status === 'queued') ?? null
  if (!target) return { item: null, items }

  const claimedTarget: WorkbenchQueueItem = {
    ...target,
    status: 'processing',
    lastError: '',
    updatedAt: Date.now(),
  }
  return {
    item: claimedTarget,
    items: normalizeWorkbenchQueue(items.map((item) => (item.queueId === target.queueId ? claimedTarget : item))),
  }
}

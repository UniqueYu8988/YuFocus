import type { PinnedBilibiliSource } from '../providers/sourceDiscovery'

export type TrackedBilibiliSource = PinnedBilibiliSource & {
  priority: number
  trackFresh: boolean
  trackHistory: boolean
  historyStatus: 'idle' | 'running' | 'completed' | 'paused' | 'failed'
  historyPage: number
  historyReachedEnd: boolean
  lastCheckedAt: number
  updatedAt: number
}

type TrackedSourcesStoreDeps = {
  readTrackedSources: () => TrackedBilibiliSource[] | undefined
  writeTrackedSources: (items: TrackedBilibiliSource[]) => void
}

function sanitizeDisplayText(value: unknown, fallback = '') {
  const normalized = String(value ?? '').replace(/[\x00-\x1F]/g, '').trim()
  return normalized || fallback
}

function sanitizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeHistoryStatus(value: unknown): TrackedBilibiliSource['historyStatus'] {
  const status = sanitizeDisplayText(value)
  if (status === 'running' || status === 'completed' || status === 'paused' || status === 'failed') return status
  return 'idle'
}

function sanitizePriority(value: unknown, fallbackPriority: number) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric >= 0) return numeric
  return Math.max(0, fallbackPriority)
}

export function normalizeTrackedBilibiliSource(raw: unknown, fallbackPriority = 0): TrackedBilibiliSource | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const mid = sanitizeDisplayText(item.mid)
  const name = sanitizeDisplayText(item.name)
  if (!mid || !name) return null
  const now = Date.now()

  return {
    mid,
    name,
    face: sanitizeDisplayText(item.face),
    sign: sanitizeDisplayText(item.sign),
    officialTitle: sanitizeDisplayText(item.officialTitle),
    pinnedAt: Number(item.pinnedAt ?? now) || now,
    priority: sanitizePriority(item.priority, fallbackPriority),
    trackFresh: sanitizeBoolean(item.trackFresh, true),
    trackHistory: sanitizeBoolean(item.trackHistory, true),
    historyStatus: sanitizeHistoryStatus(item.historyStatus),
    historyPage: Math.max(0, Number(item.historyPage ?? 0) || 0),
    historyReachedEnd: sanitizeBoolean(item.historyReachedEnd, false),
    lastCheckedAt: Math.max(0, Number(item.lastCheckedAt ?? 0) || 0),
    updatedAt: Math.max(0, Number(item.updatedAt ?? now) || now),
  }
}

export function normalizeTrackedBilibiliSources(raw: unknown): TrackedBilibiliSource[] {
  const items = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const normalized: TrackedBilibiliSource[] = []
  for (const [index, item] of items.entries()) {
    const normalizedItem = normalizeTrackedBilibiliSource(item, index)
    if (!normalizedItem || seen.has(normalizedItem.mid)) continue
    seen.add(normalizedItem.mid)
    normalized.push(normalizedItem)
  }
  return normalized
    .sort((left, right) => left.priority - right.priority || right.pinnedAt - left.pinnedAt)
    .slice(0, 48)
    .map((item, index) => ({ ...item, priority: index }))
}

export function reconcileTrackedSourcesWithPinnedSources(
  current: unknown,
  pinnedSources: PinnedBilibiliSource[],
) {
  const existingSources = normalizeTrackedBilibiliSources(current)
  const existingByMid = new Map(existingSources.map((source) => [source.mid, source]))
  const now = Date.now()

  return pinnedSources.slice(0, 48).map((source, index) => {
    const existing = existingByMid.get(source.mid)
    const metadataChanged = !existing ||
      existing.name !== source.name ||
      existing.face !== source.face ||
      existing.sign !== source.sign ||
      existing.officialTitle !== source.officialTitle ||
      existing.pinnedAt !== source.pinnedAt
    return {
      ...source,
      priority: existing?.priority ?? index,
      trackFresh: existing?.trackFresh ?? true,
      trackHistory: existing?.trackHistory ?? true,
      historyStatus: existing?.historyStatus ?? 'idle',
      historyPage: existing?.historyPage ?? 0,
      historyReachedEnd: existing?.historyReachedEnd ?? false,
      lastCheckedAt: existing?.lastCheckedAt ?? 0,
      updatedAt: metadataChanged ? now : existing.updatedAt,
    }
  }).sort((left, right) => left.priority - right.priority || right.pinnedAt - left.pinnedAt)
    .map((source, index) => ({ ...source, priority: index }))
}

function isSameTrackedSources(left: TrackedBilibiliSource[], right: TrackedBilibiliSource[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function createTrackedSourcesStore({
  readTrackedSources,
  writeTrackedSources,
}: TrackedSourcesStoreDeps) {
  const loadTrackedSources = () => normalizeTrackedBilibiliSources(readTrackedSources())

  const saveTrackedSources = (items: unknown) => {
    const normalized = normalizeTrackedBilibiliSources(items)
    writeTrackedSources(normalized)
    return normalized
  }

  const syncTrackedSourcesWithPinnedSources = (pinnedSources: PinnedBilibiliSource[]) => {
    const current = normalizeTrackedBilibiliSources(readTrackedSources())
    const next = reconcileTrackedSourcesWithPinnedSources(current, pinnedSources)
    if (isSameTrackedSources(current, next)) return current
    writeTrackedSources(next)
    return next
  }

  return {
    loadTrackedSources,
    saveTrackedSources,
    syncTrackedSourcesWithPinnedSources,
  }
}

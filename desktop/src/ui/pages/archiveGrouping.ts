import type { MaterialInventoryRecord } from '@/ui/panels/workspace/WorkbenchShared'

export type ArchiveCreatorGroupKind = 'all' | 'pinned' | 'creator' | 'misc'

export type ArchiveCreatorGroup = {
  id: string
  kind: ArchiveCreatorGroupKind
  title: string
  subtitle: string
  face: string
  mid: string
  count: number
  latestUpdatedAt: number
  records: MaterialInventoryRecord[]
}

type PinnedBilibiliSource = {
  mid: string
  name: string
  face: string
}

export const ARCHIVE_ALL_GROUP_ID = 'all'
export const ARCHIVE_MISC_GROUP_ID = 'misc'

export function normalizeArchiveCreatorName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

function getRecordCreatorKey(record: MaterialInventoryRecord) {
  const creator = normalizeArchiveCreatorName(record.creator || '')
  if (creator) return `creator:${creator}`
  const sourceType = normalizeArchiveCreatorName(record.sourceType || '')
  const sourceUrl = normalizeArchiveCreatorName(record.sourceUrl || '')
  if (sourceType === 'bilibili' && sourceUrl) return `source:${sourceUrl}`
  return ''
}

function sortRecordsByUpdatedAt(records: MaterialInventoryRecord[]) {
  return [...records].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
}

function getLatestUpdatedAt(records: MaterialInventoryRecord[]) {
  return records.reduce((latest, record) => Math.max(latest, record.updatedAt || 0), 0)
}

function createGroup(options: {
  id: string
  kind: ArchiveCreatorGroupKind
  title: string
  subtitle?: string
  face?: string
  mid?: string
  records: MaterialInventoryRecord[]
}): ArchiveCreatorGroup {
  const records = sortRecordsByUpdatedAt(options.records)
  return {
    id: options.id,
    kind: options.kind,
    title: options.title,
    subtitle: options.subtitle ?? '',
    face: options.face ?? '',
    mid: options.mid ?? '',
    count: records.length,
    latestUpdatedAt: getLatestUpdatedAt(records),
    records,
  }
}

export function buildArchiveCreatorGroups({
  records,
  pinnedSources,
}: {
  records: MaterialInventoryRecord[]
  pinnedSources: PinnedBilibiliSource[]
}) {
  const sortedRecords = sortRecordsByUpdatedAt(records)
  const recordsByCreatorKey = new Map<string, MaterialInventoryRecord[]>()
  const assignedRecords = new Set<string>()

  for (const record of sortedRecords) {
    const key = getRecordCreatorKey(record)
    if (!key) continue
    const items = recordsByCreatorKey.get(key) ?? []
    items.push(record)
    recordsByCreatorKey.set(key, items)
  }

  const pinnedGroups = pinnedSources.map((source) => {
    const sourceKey = `creator:${normalizeArchiveCreatorName(source.name || '')}`
    const sourceRecords = sourceKey === 'creator:' ? [] : recordsByCreatorKey.get(sourceKey) ?? []
    for (const record of sourceRecords) assignedRecords.add(record.path)
    return createGroup({
      id: `pinned:${source.mid}`,
      kind: 'pinned',
      title: source.name || '未命名 UP',
      subtitle: source.mid ? `MID ${source.mid}` : '固定 UP',
      face: source.face,
      mid: source.mid,
      records: sourceRecords,
    })
  })

  const pinnedCreatorKeys = new Set(pinnedSources.map((source) => `creator:${normalizeArchiveCreatorName(source.name || '')}`))
  const creatorGroups = Array.from(recordsByCreatorKey.entries())
    .filter(([key]) => !pinnedCreatorKeys.has(key))
    .map(([key, sourceRecords]) => {
      for (const record of sourceRecords) assignedRecords.add(record.path)
      const firstRecord = sourceRecords[0]
      return createGroup({
        id: key,
        kind: 'creator',
        title: firstRecord?.creator || '未命名来源',
        subtitle: firstRecord?.sourceId || firstRecord?.sourceType || '非固定来源',
        records: sourceRecords,
      })
    })
    .sort((left, right) => right.latestUpdatedAt - left.latestUpdatedAt)

  const miscRecords = sortedRecords.filter((record) => !assignedRecords.has(record.path))
  const allGroup = createGroup({
    id: ARCHIVE_ALL_GROUP_ID,
    kind: 'all',
    title: '全部',
    subtitle: `${sortedRecords.length} 份资料`,
    records: sortedRecords,
  })
  const miscGroup = createGroup({
    id: ARCHIVE_MISC_GROUP_ID,
    kind: 'misc',
    title: '拾遗',
    subtitle: '未匹配到固定 UP 的资料',
    records: miscRecords,
  })

  return [
    allGroup,
    ...pinnedGroups,
    ...creatorGroups,
    miscGroup,
  ]
}

export function findArchiveCreatorGroup(groups: ArchiveCreatorGroup[], groupId: string) {
  return groups.find((group) => group.id === groupId) ?? groups[0] ?? null
}

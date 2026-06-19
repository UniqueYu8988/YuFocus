import { Copy, Eye, FileText, FolderOpen, RefreshCcw, Search, Trash2 } from 'lucide-react'
import { Badge } from '@/ui/components/base/badge'
import { Button } from '@/ui/components/base/button'
import { cn } from '@/ui/components/utils'

type MaterialInventory = Awaited<ReturnType<typeof window.desktopAPI.listMaterialPackages>>
type MaterialInventoryRecord = MaterialInventory['records'][number]

export type ArchiveShelfFilter = 'all' | 'pinned' | 'misc' | 'long' | 'short' | 'issue'

export type ArchiveStats = {
  articles: number
  materials: number
  totalTextLength: number
  totalBytes: number
  totalElapsedSeconds: number
  totalTokens: number
  todayNew: number
  weekNew: number
  issues: number
  latestUpdatedAt: number
}

export type ArchiveFilterItem = {
  id: ArchiveShelfFilter
  label: string
  count: number
}

export function getMaterialLibraryReadPath(record: MaterialInventoryRecord) {
  if (record.editorialSummaryExists && record.editorialSummaryPath) return record.editorialSummaryPath
  if (record.notebooklmExists && record.notebooklmPath) return record.notebooklmPath
  if (record.rawTranscriptExists && record.rawTranscriptPath) return record.rawTranscriptPath
  return ''
}

export function getMaterialLibraryReadHtmlPath(record: MaterialInventoryRecord) {
  if (record.editorialSummaryHtmlExists && record.editorialSummaryHtmlPath) return record.editorialSummaryHtmlPath
  return ''
}

export function getMaterialLibraryReadLabel(record: MaterialInventoryRecord) {
  if (record.editorialSummaryExists) return '精读稿'
  if (record.notebooklmExists) return '清洗稿'
  if (record.rawTranscriptExists) return '原始稿'
  return '资料'
}

export function isMaterialShortDraft(record: MaterialInventoryRecord) {
  return Boolean(record.editorialSummaryExists)
}

export function isMaterialLongDraft(record: MaterialInventoryRecord) {
  return Boolean(!record.editorialSummaryExists && record.notebooklmExists)
}

export function hasMaterialIssue(record: MaterialInventoryRecord) {
  return (
    record.editorialSummaryStatus === 'failed' ||
    (!record.rawTranscriptExists && !record.notebooklmExists && !record.editorialSummaryExists) ||
    (record.editorialSummaryStatus === 'summary_ready' && !record.editorialSummaryExists)
  )
}

export function getMaterialPrimaryTextLength(record: MaterialInventoryRecord) {
  return record.editorialSummaryTextLength || record.notebooklmTextLength || record.rawTranscriptTextLength || record.textLength || 0
}

function getMaterialArchiveTypeLabel(record: MaterialInventoryRecord) {
  if (hasMaterialIssue(record)) return '异常'
  if (isMaterialShortDraft(record)) return '短稿'
  if (isMaterialLongDraft(record)) return '长稿'
  if (record.rawTranscriptExists) return '字幕'
  return '资料'
}

function getMaterialArchiveTypeClass(record: MaterialInventoryRecord) {
  if (hasMaterialIssue(record)) return 'border-destructive/20 bg-destructive/10 text-destructive-foreground'
  if (isMaterialShortDraft(record)) return 'border-emerald-400/16 bg-emerald-400/[0.08] text-emerald-100'
  if (isMaterialLongDraft(record)) return 'border-sky-400/16 bg-sky-400/[0.08] text-sky-100'
  return 'border-amber-400/18 bg-amber-400/[0.08] text-amber-100'
}

function getMaterialSourceLabel(record: MaterialInventoryRecord) {
  return record.creator || record.sourceId || record.sourceType || '拾遗'
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1
  return `${size.toFixed(digits)} ${units[unitIndex]}`
}

function formatElapsedSeconds(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0s'
  if (value < 60) return `${Math.round(value)}s`
  const minutes = Math.floor(value / 60)
  const seconds = Math.round(value % 60)
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`
}

export function ArchivePaneContent({
  stats,
  filters,
  activeFilter,
  query,
  records,
  materialRootDir,
  canOpenRoot,
  onFilterChange,
  onQueryChange,
  onOpenRoot,
  onRefresh,
  onOpenRecord,
  onCopyNotebookLmPath,
  onRevealPath,
  onDeleteRecord,
  formatRelativeTime,
  formatCompactNumber,
  getNotebookLmPathTitle,
}: {
  stats: ArchiveStats
  filters: ArchiveFilterItem[]
  activeFilter: ArchiveShelfFilter
  query: string
  records: MaterialInventoryRecord[]
  materialRootDir: string
  canOpenRoot: boolean
  onFilterChange: (filter: ArchiveShelfFilter) => void
  onQueryChange: (query: string) => void
  onOpenRoot: () => void
  onRefresh: () => void
  onOpenRecord: (record: MaterialInventoryRecord) => void
  onCopyNotebookLmPath: (record: MaterialInventoryRecord) => void
  onRevealPath: (targetPath: string) => void
  onDeleteRecord: (record: MaterialInventoryRecord) => void
  formatRelativeTime: (timestamp: number) => string
  formatCompactNumber: (value: number) => string
  getNotebookLmPathTitle: (record: MaterialInventoryRecord) => string
}) {
  const statItems = [
    ['文稿', `${stats.articles}`],
    ['字幕', `${stats.materials}`],
    ['总字数', formatCompactNumber(stats.totalTextLength)],
    ['占用', formatBytes(stats.totalBytes)],
    ['耗时', formatElapsedSeconds(stats.totalElapsedSeconds)],
    ['Token', formatCompactNumber(stats.totalTokens)],
    ['今日', `${stats.todayNew}`],
    ['本周', `${stats.weekNew}`],
    ['异常', `${stats.issues}`],
  ]

  return (
    <div className="grid w-full gap-5">
      <section className="grid gap-2 md:grid-cols-4">
        {statItems.map(([label, value]) => (
          <div key={label} className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2">
            <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
            <div className="mt-1 truncate text-[17px] font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </section>

      <section className="grid min-h-[520px] gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="grid content-start gap-2 rounded-[12px] border border-white/[0.075] bg-[#1f1f1f] p-3">
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <div className="text-[13px] font-semibold text-foreground">分类</div>
            <div className="text-[10px] text-muted-foreground">
              {stats.latestUpdatedAt ? formatRelativeTime(stats.latestUpdatedAt) : '暂无更新'}
            </div>
          </div>
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={cn(
                'flex h-9 items-center gap-2 rounded-[9px] px-2.5 text-left text-[12px] transition-colors',
                activeFilter === filter.id
                  ? 'bg-sky-300/[0.08] text-sky-50'
                  : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
              )}
              onClick={() => onFilterChange(filter.id)}
            >
              <span className="min-w-0 flex-1 truncate">{filter.label}</span>
              <span className="shrink-0 rounded-full bg-black/18 px-1.5 text-[10px] font-semibold leading-4">
                {filter.count}
              </span>
            </button>
          ))}
        </aside>

        <div className="min-w-0 rounded-[12px] border border-white/[0.075] bg-[#1f1f1f] p-3">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 border-b border-white/[0.12] px-1 pb-1">
              <Search size={13} className="shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="搜索标题、来源、BV 或路径"
                className="min-w-0 flex-1 bg-transparent py-1 text-[12px] font-medium text-foreground outline-none placeholder:text-muted-foreground/70"
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 rounded-lg text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
              onClick={onOpenRoot}
              disabled={!canOpenRoot}
              aria-label="打开档案目录"
              title={materialRootDir}
            >
              <FolderOpen size={14} />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 rounded-lg text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
              onClick={onRefresh}
              aria-label="刷新档案"
              title="刷新档案"
            >
              <RefreshCcw size={14} />
            </Button>
          </div>

          <div className="grid gap-2">
            {records.map((record) => (
              <ArchiveRecordRow
                key={record.path}
                record={record}
                formatRelativeTime={formatRelativeTime}
                formatCompactNumber={formatCompactNumber}
                getNotebookLmPathTitle={getNotebookLmPathTitle}
                onOpenRecord={onOpenRecord}
                onCopyNotebookLmPath={onCopyNotebookLmPath}
                onRevealPath={onRevealPath}
                onDeleteRecord={onDeleteRecord}
              />
            ))}

            {!records.length ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-[12px] border border-white/[0.06] bg-black/10 px-4 py-8 text-center">
                <FileText className="size-8 text-muted-foreground/70" />
                <div className="text-[13px] font-semibold text-foreground">
                  {query.trim() ? '没有匹配的档案' : '档案还是空的'}
                </div>
                <div className="max-w-md text-[12px] leading-6 text-muted-foreground">
                  完成字幕清洗后，这里会按来源、类型、阶段和异常状态集中管理。
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

function ArchiveRecordRow({
  record,
  formatRelativeTime,
  formatCompactNumber,
  getNotebookLmPathTitle,
  onOpenRecord,
  onCopyNotebookLmPath,
  onRevealPath,
  onDeleteRecord,
}: {
  record: MaterialInventoryRecord
  formatRelativeTime: (timestamp: number) => string
  formatCompactNumber: (value: number) => string
  getNotebookLmPathTitle: (record: MaterialInventoryRecord) => string
  onOpenRecord: (record: MaterialInventoryRecord) => void
  onCopyNotebookLmPath: (record: MaterialInventoryRecord) => void
  onRevealPath: (targetPath: string) => void
  onDeleteRecord: (record: MaterialInventoryRecord) => void
}) {
  const readPath = getMaterialLibraryReadPath(record)
  const sourceLabel = getMaterialSourceLabel(record)
  const fileFlags = [
    ['原字', record.rawTranscriptExists],
    ['清洗', record.notebooklmExists],
    ['文稿', record.editorialSummaryExists],
    ['HTML', record.editorialSummaryHtmlExists],
  ] as const

  return (
    <div className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_80px_86px_76px_112px] items-center gap-3 rounded-[10px] border border-white/[0.06] bg-white/[0.018] px-3 py-2 transition-colors hover:bg-white/[0.035]">
      <button
        type="button"
        className="min-w-0 text-left"
        disabled={!readPath}
        onClick={() => onOpenRecord(record)}
        title={record.title}
      >
        <div className="truncate text-[13px] font-semibold text-foreground">{record.title}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
          <span className="max-w-[160px] truncate">{sourceLabel}</span>
          {record.sourceId ? <span className="shrink-0">{record.sourceId}</span> : null}
          <span className="shrink-0">{formatRelativeTime(record.updatedAt)}</span>
        </div>
      </button>

      <Badge variant="outline" className={cn('justify-center', getMaterialArchiveTypeClass(record))}>
        {getMaterialArchiveTypeLabel(record)}
      </Badge>

      <div className="text-right text-[11px] leading-5 text-muted-foreground">
        <div className="font-semibold text-foreground/82">{formatCompactNumber(getMaterialPrimaryTextLength(record))} 字</div>
        <div>{formatBytes(record.byteSize || 0)}</div>
      </div>

      <div className="text-right text-[11px] leading-5 text-muted-foreground">
        <div>阶段</div>
        <div>{record.workflowStageLabel}</div>
      </div>

      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 rounded-lg text-foreground/68 hover:bg-emerald-400/[0.10] hover:text-emerald-100"
          disabled={!readPath}
          onClick={() => onOpenRecord(record)}
          aria-label="打开"
          title="打开"
        >
          <Eye size={13} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 rounded-lg text-foreground/68 hover:bg-amber-400/[0.10] hover:text-amber-100"
          onClick={() => onCopyNotebookLmPath(record)}
          aria-label="复制路径"
          title={getNotebookLmPathTitle(record)}
        >
          <Copy size={13} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 rounded-lg text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
          onClick={() => onRevealPath(readPath || record.path)}
          aria-label="定位"
          title="定位"
        >
          <FolderOpen size={13} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 rounded-lg text-foreground/58 hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onDeleteRecord(record)}
          aria-label="删除"
          title="删除"
        >
          <Trash2 size={13} />
        </Button>
      </div>

      <div className="col-span-5 flex min-w-0 items-center gap-1.5 border-t border-white/[0.045] pt-1.5">
        {fileFlags.map(([label, exists]) => (
          <span
            key={label}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px]',
              exists
                ? 'border-white/[0.07] bg-white/[0.035] text-foreground/78'
                : 'border-white/[0.04] bg-transparent text-muted-foreground/45',
            )}
          >
            {label}
          </span>
        ))}
        {record.metricsExists ? (
          <>
            <span className="rounded-full border border-sky-300/[0.16] bg-sky-300/[0.06] px-2 py-0.5 text-[10px] text-sky-50/78">
              {formatElapsedSeconds(record.metricsElapsedSeconds)}
            </span>
            <span className="rounded-full border border-violet-300/[0.14] bg-violet-300/[0.06] px-2 py-0.5 text-[10px] text-violet-50/78">
              {formatCompactNumber(record.metricsTotalTokens)} token
            </span>
          </>
        ) : null}
        <span className="min-w-0 flex-1 truncate pl-1 text-[10px] text-muted-foreground/70">{record.path}</span>
      </div>
    </div>
  )
}

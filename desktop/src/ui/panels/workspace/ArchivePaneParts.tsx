import { Clock, Database, FileText, HardDrive, Mail, Search, Trash2, Type, UserRound } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/ui/components/base/button'
import { cn } from '@/ui/components/utils'
import type { ArchiveCreatorGroup } from '@/ui/pages/archiveGrouping'

type MaterialInventory = Awaited<ReturnType<typeof window.desktopAPI.listMaterialPackages>>
type MaterialInventoryRecord = MaterialInventory['records'][number]

export type ArchiveStats = {
  articles: number
  materials: number
  totalTextLength: number
  totalBytes: number
  totalElapsedSeconds: number
  totalTokens: number
  totalMimoCredits: number
  todayNew: number
  weekNew: number
  issues: number
  latestUpdatedAt: number
}

export function getMaterialLibraryReadPath(record: MaterialInventoryRecord) {
  if (record.notebooklmExists && record.notebooklmPath) return record.notebooklmPath
  if (record.emailExists && record.emailPath) return record.emailPath
  if (record.editorialSummaryExists && record.editorialSummaryPath) return record.editorialSummaryPath
  if (record.rawTranscriptExists && record.rawTranscriptPath) return record.rawTranscriptPath
  return ''
}

export function getMaterialCleanMarkdownPath(record: MaterialInventoryRecord) {
  return record.notebooklmExists && record.notebooklmPath ? record.notebooklmPath : ''
}

export function getMaterialEmailMarkdownPath(record: MaterialInventoryRecord) {
  return record.emailExists && record.emailPath ? record.emailPath : ''
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
    (!record.rawTranscriptExists && !record.notebooklmExists && !record.emailExists && !record.editorialSummaryExists) ||
    (record.editorialSummaryStatus === 'summary_ready' && !record.editorialSummaryExists)
  )
}

export function getMaterialPrimaryTextLength(record: MaterialInventoryRecord) {
  return record.editorialSummaryTextLength || record.notebooklmTextLength || record.rawTranscriptTextLength || record.textLength || 0
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
  groups,
  activeGroup,
  query,
  records,
  totalRecordCount,
  canLoadMore,
  materialRootDir,
  notebooklmLibraryDir,
  emailLibraryDir,
  canOpenRoot,
  onGroupChange,
  onQueryChange,
  onLoadMore,
  onOpenRoot,
  onOpenRecord,
  onOpenEmailRecord,
  onDeleteRecord,
  formatRelativeTime,
  formatCompactNumber,
  getNotebookLmPathTitle,
}: {
  stats: ArchiveStats
  groups: ArchiveCreatorGroup[]
  activeGroup: ArchiveCreatorGroup | null
  query: string
  records: MaterialInventoryRecord[]
  totalRecordCount: number
  canLoadMore: boolean
  materialRootDir: string
  notebooklmLibraryDir: string
  emailLibraryDir: string
  canOpenRoot: boolean
  onGroupChange: (groupId: string) => void
  onQueryChange: (query: string) => void
  onLoadMore: () => void
  onOpenRoot: () => void
  onOpenRecord: (record: MaterialInventoryRecord) => void
  onOpenEmailRecord: (record: MaterialInventoryRecord) => void
  onDeleteRecord: (record: MaterialInventoryRecord) => void
  formatRelativeTime: (timestamp: number) => string
  formatCompactNumber: (value: number) => string
  getNotebookLmPathTitle: (record: MaterialInventoryRecord) => string
}) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const loadMoreArmedRef = useRef(false)
  const statItems = [
    {
      label: '总字数',
      value: formatCompactNumber(stats.totalTextLength),
      icon: <Type size={13} />,
      accent: 'text-sky-100 bg-sky-300/[0.10] ring-sky-200/[0.15]',
    },
    {
      label: '占用',
      value: formatBytes(stats.totalBytes),
      icon: <HardDrive size={13} />,
      accent: 'text-emerald-100 bg-emerald-300/[0.10] ring-emerald-200/[0.15]',
    },
    {
      label: '耗时',
      value: formatElapsedSeconds(stats.totalElapsedSeconds),
      icon: <Clock size={13} />,
      accent: 'text-amber-100 bg-amber-300/[0.10] ring-amber-200/[0.15]',
    },
    {
      label: 'MiMo Credits',
      value: formatCompactNumber(stats.totalMimoCredits),
      icon: <Database size={13} />,
      accent: 'text-violet-100 bg-violet-300/[0.10] ring-violet-200/[0.15]',
    },
  ]

  useEffect(() => {
    const armLoadMore = (event: WheelEvent) => {
      if (event.deltaY > 0) loadMoreArmedRef.current = true
    }
    document.addEventListener('wheel', armLoadMore, { passive: true })
    return () => document.removeEventListener('wheel', armLoadMore)
  }, [])

  useEffect(() => {
    if (!canLoadMore) return
    const target = loadMoreRef.current
    if (!target) return
    const observer = new IntersectionObserver((entries) => {
      if (!loadMoreArmedRef.current) return
      if (!entries.some((entry) => entry.isIntersecting)) return
      loadMoreArmedRef.current = false
      onLoadMore()
    }, { root: null, rootMargin: '180px 0px', threshold: 0.01 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [canLoadMore, onLoadMore])

  return (
    <div className="grid w-full gap-5">
      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {statItems.map((item) => (
          <div key={item.label} className="flex items-center gap-3 rounded-[14px] border border-white/[0.055] bg-white/[0.024] px-3 py-2.5 shadow-[0_12px_34px_rgba(0,0,0,0.12)]">
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-xl ring-1', item.accent)}>
              {item.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-muted-foreground">{item.label}</div>
              <div className="mt-0.5 truncate text-[16px] font-semibold tracking-tight text-foreground">{item.value}</div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-3" data-archive-vertical-avatar-layout="true">
          <div className="flex gap-3 overflow-x-auto px-1 pb-1 pt-1" data-archive-avatar-strip="true" aria-label="按 UP 主筛选档案">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={cn(
                  'group flex w-[76px] shrink-0 flex-col items-center gap-2 px-1 py-1.5 text-center transition-colors',
                  activeGroup?.id === group.id
                    ? 'text-sky-50'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => onGroupChange(group.id)}
                title={group.subtitle ? `${group.title} · ${group.subtitle}` : group.title}
              >
                <ArchiveGroupAvatar group={group} count={group.count} active={activeGroup?.id === group.id} />
                <span className="w-full truncate text-[11px] font-semibold leading-4">{group.title}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 px-1 py-3">
            <div className="flex min-w-[260px] flex-1 items-center gap-2 border-b border-white/[0.12] px-1 pb-1">
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
              aria-label="打开清洗稿成品库"
              title={`清洗稿成品库：${notebooklmLibraryDir || materialRootDir}`}
            >
              <FileText size={14} />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 rounded-lg text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
              onClick={() => void window.desktopAPI.openPath(emailLibraryDir)}
              disabled={!canOpenRoot}
              aria-label="打开 email 成品库"
              title={`email 成品库：${emailLibraryDir || materialRootDir}`}
            >
              <Mail size={14} />
            </Button>
          </div>

          <div className="grid gap-2" data-archive-linear-record-list="true">
            {records.map((record) => (
              <ArchiveRecordRow
                key={record.path}
                record={record}
                formatRelativeTime={formatRelativeTime}
                formatCompactNumber={formatCompactNumber}
                getNotebookLmPathTitle={getNotebookLmPathTitle}
                onOpenRecord={onOpenRecord}
                onOpenEmailRecord={onOpenEmailRecord}
                onDeleteRecord={onDeleteRecord}
              />
            ))}

            {canLoadMore ? (
              <div ref={loadMoreRef} className="flex justify-center py-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 rounded-full px-4 text-[11px] text-foreground/58 hover:bg-white/[0.05] hover:text-foreground"
                  onClick={onLoadMore}
                >
                  继续加载 {Math.max(0, totalRecordCount - records.length)}
                </Button>
              </div>
            ) : null}

            {!records.length ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 border-y border-white/[0.05] bg-black/10 px-4 py-8 text-center">
                <FileText className="size-8 text-muted-foreground/70" />
                <div className="text-[13px] font-semibold text-foreground">
                  {query.trim() ? '没有匹配的档案' : activeGroup?.kind === 'pinned' ? `${activeGroup.title} 暂无资料` : '档案还是空的'}
                </div>
                <div className="max-w-md text-[12px] leading-6 text-muted-foreground">
                  完成字幕清洗后，这里会按 UP 主、视频和资料状态集中管理。
                </div>
              </div>
            ) : null}
          </div>
      </section>
    </div>
  )
}

function ArchiveGroupAvatar({ group, count, active = false }: { group: ArchiveCreatorGroup; count: number; active?: boolean }) {
  const badgeLabel = count > 99 ? '99+' : String(count)
  if (group.face) {
    return (
      <span className={cn(
        'relative flex size-[52px] shrink-0 items-center justify-center overflow-visible rounded-full transition-colors',
        active && 'ring-2 ring-sky-300/80 shadow-[0_0_0_4px_rgba(125,211,252,0.10),0_0_22px_rgba(56,189,248,0.22)]',
      )} data-archive-avatar-with-count="true" data-archive-active-avatar-ring={active ? 'true' : undefined}>
        <span className={cn(
          'flex size-11 overflow-hidden rounded-full bg-white/[0.035] ring-1 ring-white/[0.055]',
        )}>
          <img
            src={group.face}
            alt={`${group.title} 头像`}
            className="size-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </span>
        <span className={cn(
          'absolute -right-0.5 -top-0.5 min-w-5 rounded-full border px-1 text-center text-[10px] font-bold leading-5 shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-md ring-1',
          active
            ? 'border-sky-100/40 bg-sky-300 text-slate-950 ring-sky-100/35'
            : 'border-white/[0.20] bg-white/[0.18] text-white ring-white/[0.15]',
        )} aria-label={`${group.title} 视频数量 ${count}`}>
          {badgeLabel}
        </span>
      </span>
    )
  }

  return (
    <span className={cn(
      'relative flex size-[52px] shrink-0 items-center justify-center rounded-full bg-white/[0.035] text-foreground/50 ring-1 ring-white/[0.055] transition-colors',
      active && 'bg-sky-300/[0.09] text-sky-50 ring-2 ring-sky-300/80 shadow-[0_0_0_4px_rgba(125,211,252,0.10),0_0_22px_rgba(56,189,248,0.22)]',
    )} data-archive-avatar-with-count="true" data-archive-active-avatar-ring={active ? 'true' : undefined}>
      <UserRound size={16} aria-hidden="true" />
      <span className={cn(
        'absolute -right-0.5 -top-0.5 min-w-5 rounded-full border px-1 text-center text-[10px] font-bold leading-5 shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-md ring-1',
        active
          ? 'border-sky-100/40 bg-sky-300 text-slate-950 ring-sky-100/35'
          : 'border-white/[0.20] bg-white/[0.18] text-white ring-white/[0.15]',
      )} aria-label={`${group.title} 视频数量 ${count}`}>
        {badgeLabel}
      </span>
    </span>
  )
}

function ArchiveRecordRow({
  record,
  formatRelativeTime,
  formatCompactNumber,
  getNotebookLmPathTitle,
  onOpenRecord,
  onOpenEmailRecord,
  onDeleteRecord,
}: {
  record: MaterialInventoryRecord
  formatRelativeTime: (timestamp: number) => string
  formatCompactNumber: (value: number) => string
  getNotebookLmPathTitle: (record: MaterialInventoryRecord) => string
  onOpenRecord: (record: MaterialInventoryRecord) => void
  onOpenEmailRecord: (record: MaterialInventoryRecord) => void
  onDeleteRecord: (record: MaterialInventoryRecord) => void
}) {
  const readPath = getMaterialCleanMarkdownPath(record)
  const emailPath = getMaterialEmailMarkdownPath(record)
  const sourceLabel = getMaterialSourceLabel(record)
  const wordCount = getMaterialPrimaryTextLength(record)
  const hasMetrics = record.metricsExists && (record.metricsElapsedSeconds > 0 || record.metricsMimoCredits > 0)

  return (
    <article className="border-b border-white/[0.055] px-1 py-3 transition-colors hover:bg-white/[0.018]">
      <div className="flex flex-wrap items-start gap-3">
        <button
          type="button"
          className="min-w-[220px] flex-1 text-left"
          disabled={!readPath}
          onClick={() => onOpenRecord(record)}
          title={record.title}
        >
          <div className="flex min-w-0 items-center gap-2">
            {record.sourceId ? <span className="shrink-0 text-[10px] font-semibold text-sky-100/80">{record.sourceId}</span> : null}
            <span className="min-w-0 truncate text-[10px] text-muted-foreground">{sourceLabel}</span>
            {hasMaterialIssue(record) ? (
              <span className="rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                需检查
              </span>
            ) : null}
          </div>
          <div className="mt-2 truncate text-[14px] font-semibold leading-5 text-foreground">{record.title}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/88">
            <span>更新 {formatRelativeTime(record.updatedAt)}</span>
            <span>{formatCompactNumber(wordCount)} 字</span>
            <span>{formatBytes(record.byteSize || 0)}</span>
            {hasMetrics ? (
              <>
                {record.metricsElapsedSeconds > 0 ? <span>{formatElapsedSeconds(record.metricsElapsedSeconds)}</span> : null}
                {record.metricsMimoCredits > 0 ? <span>{formatCompactNumber(record.metricsMimoCredits)} MiMo Credits</span> : null}
              </>
            ) : null}
          </div>
        </button>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 rounded-lg text-foreground/68 hover:bg-emerald-400/[0.10] hover:text-emerald-100"
              disabled={!readPath}
              onClick={() => onOpenRecord(record)}
              aria-label="打开清洗稿"
              title={`${getNotebookLmPathTitle(record)}（外部应用）`}
            >
              <FileText size={13} />
            </Button>
            {emailPath ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 rounded-lg text-foreground/68 hover:bg-sky-400/[0.10] hover:text-sky-100"
                onClick={() => onOpenEmailRecord(record)}
                aria-label="打开 email 稿"
                title="打开 email 稿（外部应用）"
              >
                <Mail size={13} />
              </Button>
            ) : null}
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
        </div>
      </div>
    </article>
  )
}

import { Clock, Copy, Database, Eye, FileText, FolderOpen, HardDrive, RefreshCcw, Search, Trash2, Type, UserRound } from 'lucide-react'
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
  todayNew: number
  weekNew: number
  issues: number
  latestUpdatedAt: number
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
  materialRootDir,
  canOpenRoot,
  onGroupChange,
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
  groups: ArchiveCreatorGroup[]
  activeGroup: ArchiveCreatorGroup | null
  query: string
  records: MaterialInventoryRecord[]
  materialRootDir: string
  canOpenRoot: boolean
  onGroupChange: (groupId: string) => void
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
      label: 'Token',
      value: formatCompactNumber(stats.totalTokens),
      icon: <Database size={13} />,
      accent: 'text-violet-100 bg-violet-300/[0.10] ring-violet-200/[0.15]',
    },
  ]

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

      <section className="grid min-h-[520px] gap-4" data-archive-vertical-avatar-layout="true">
        <div className="min-w-0 rounded-[22px] border border-white/[0.06] bg-[#1f1f1f]/92 p-3 shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
          <div className="flex items-center justify-between gap-2 px-1 pb-3">
            <div>
              <div className="text-[13px] font-semibold text-foreground">UP 主</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">选择一个来源，下方直接展开对应资料。</div>
            </div>
            <div className="shrink-0 text-[10px] text-muted-foreground">
              {stats.latestUpdatedAt ? `最近 ${formatRelativeTime(stats.latestUpdatedAt)}` : '暂无更新'}
            </div>
          </div>
          <div className="flex gap-2.5 overflow-x-auto border-b border-white/[0.055] px-1 pb-3" data-archive-avatar-strip="true" aria-label="按 UP 主筛选档案">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className={cn(
                  'group flex w-[74px] shrink-0 flex-col items-center gap-2 rounded-[16px] px-2 py-2 text-center transition-colors',
                  activeGroup?.id === group.id
                    ? 'bg-white/[0.055] text-sky-50 ring-1 ring-sky-200/[0.18]'
                    : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
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
            <div className="flex min-w-[180px] flex-1 items-center gap-3">
              {activeGroup ? <ArchiveGroupAvatar group={activeGroup} count={activeGroup.count} active /> : null}
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-foreground">{activeGroup?.title || '全部'}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {activeGroup ? `${activeGroup.count} 份资料${activeGroup.latestUpdatedAt ? ` · 最近 ${formatRelativeTime(activeGroup.latestUpdatedAt)}` : ''}` : '按 UP 主整理清洗资料'}
                </div>
              </div>
            </div>
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
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-[18px] border border-white/[0.05] bg-black/10 px-4 py-8 text-center">
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
        </div>
      </section>
    </div>
  )
}

function ArchiveGroupAvatar({ group, count, active = false }: { group: ArchiveCreatorGroup; count: number; active?: boolean }) {
  const badgeLabel = count > 99 ? '99+' : String(count)
  if (group.face) {
    return (
      <span className="relative flex size-11 shrink-0 overflow-visible" data-archive-avatar-with-count="true">
        <span className={cn(
          'flex size-11 overflow-hidden rounded-full bg-white/[0.035] ring-1 ring-white/[0.055]',
          active && 'ring-sky-200/35',
        )}>
        <img
          src={group.face}
          alt={`${group.title} 头像`}
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
        </span>
        <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full border border-white/[0.20] bg-white/[0.18] px-1 text-center text-[10px] font-bold leading-5 text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-md ring-1 ring-white/[0.15]" aria-label={`${group.title} 视频数量 ${count}`}>
          {badgeLabel}
        </span>
      </span>
    )
  }

  return (
    <span className={cn(
      'relative flex size-11 shrink-0 items-center justify-center rounded-full bg-white/[0.035] text-foreground/50 ring-1 ring-white/[0.055]',
      active && 'bg-sky-300/[0.09] text-sky-50 ring-sky-200/35',
      group.kind === 'all' && 'rounded-2xl',
      group.kind === 'misc' && 'rounded-2xl',
    )} data-archive-avatar-with-count="true">
      <UserRound size={16} aria-hidden="true" />
      <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full border border-white/[0.20] bg-white/[0.18] px-1 text-center text-[10px] font-bold leading-5 text-white shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-md ring-1 ring-white/[0.15]" aria-label={`${group.title} 视频数量 ${count}`}>
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
  const wordCount = getMaterialPrimaryTextLength(record)
  const hasMetrics = record.metricsExists && (record.metricsElapsedSeconds > 0 || record.metricsTotalTokens > 0)

  return (
    <article className="rounded-[16px] border border-white/[0.045] bg-white/[0.018] px-3 py-3 transition-colors hover:border-white/[0.08] hover:bg-white/[0.035]">
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
                {record.metricsTotalTokens > 0 ? <span>{formatCompactNumber(record.metricsTotalTokens)} token</span> : null}
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
        </div>
      </div>
    </article>
  )
}

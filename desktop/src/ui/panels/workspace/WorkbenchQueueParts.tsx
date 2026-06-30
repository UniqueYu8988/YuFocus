import { useEffect, useRef, useState } from 'react'
import {
  FileText,
  LoaderCircle,
  Mail,
  Play,
} from 'lucide-react'
import { Button } from '@/ui/components/base/button'
import { cn } from '@/ui/components/utils'
import {
  type MaterialInventoryRecord,
  type WorkbenchSourceItem,
  type WorkbenchSourceStatus,
} from '@/ui/panels/workspace/WorkbenchShared'

export function WorkbenchQueuePanel({
  items,
  visibleItems,
  foldedIssueItems = [],
  canLoadMore,
  distillRequestState,
  editorialSummaryBuildingPath,
  onLoadMore,
  getItemStatus,
  getItemMeta,
  getItemTitle,
  onRetryQueueItem,
  onOpenCleanFile,
  onOpenEmailFile,
}: {
  items: WorkbenchSourceItem[]
  visibleItems: WorkbenchSourceItem[]
  foldedIssueItems?: WorkbenchSourceItem[]
  canLoadMore: boolean
  distillRequestState: string
  editorialSummaryBuildingPath: string
  onLoadMore: () => void
  getItemStatus: (item: WorkbenchSourceItem) => WorkbenchSourceStatus
  getItemMeta: (item: WorkbenchSourceItem) => string[]
  getItemTitle: (item: WorkbenchSourceItem) => string
  onRetryQueueItem: (queueId: string) => void
  onOpenCleanFile: (record: MaterialInventoryRecord) => void
  onOpenEmailFile: (record: MaterialInventoryRecord) => void
}) {
  const [issuesOpen, setIssuesOpen] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const loadMoreArmedRef = useRef(false)

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
    }, { root: null, rootMargin: '160px 0px', threshold: 0.01 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [canLoadMore, onLoadMore])

  const hasMainItems = visibleItems.length > 0
  const failedIssueCount = foldedIssueItems.filter((item) => item.queue?.status === 'failed').length
  const skippedIssueCount = foldedIssueItems.filter((item) => item.queue?.status === 'skipped').length

  return (
    <section data-queue-record-feed="true">
      {items.length ? (
        <div
          className="min-h-[240px] space-y-2"
          aria-label="队列记录流"
        >
          {hasMainItems ? (
            visibleItems.map((item) => (
              <WorkbenchQueueRow
                key={item.key}
                item={item}
                status={item.record && editorialSummaryBuildingPath === item.record.path
                  ? { label: '制作中', tone: 'blue', active: true }
                  : getItemStatus(item)}
                meta={getItemMeta(item)}
                title={getItemTitle(item)}
                distillRequestState={distillRequestState}
                onRetryQueueItem={onRetryQueueItem}
                onOpenCleanFile={onOpenCleanFile}
                onOpenEmailFile={onOpenEmailFile}
              />
            ))
          ) : (
            <div className="rounded-[14px] border border-white/6 bg-white/[0.018] px-4 py-3 text-[12px] leading-6 text-muted-foreground">
              暂无正在处理或等待处理的记录。
            </div>
          )}
          {canLoadMore ? (
            <div ref={loadMoreRef} className="flex justify-center py-2">
              <Button
                type="button"
                variant="ghost"
                className="h-8 rounded-full px-4 text-[11px] text-foreground/58 hover:bg-white/[0.05] hover:text-foreground"
                onClick={onLoadMore}
              >
                继续加载
              </Button>
            </div>
          ) : null}
          {foldedIssueItems.length ? (
            <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.018]">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                onClick={() => setIssuesOpen((open) => !open)}
                aria-expanded={issuesOpen}
                data-folded-queue-issues="true"
              >
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-foreground/72">
                    已折叠 {foldedIssueItems.length} 条无法获取的视频
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {failedIssueCount ? `${failedIssueCount} 条失败` : ''}
                    {failedIssueCount && skippedIssueCount ? ' · ' : ''}
                    {skippedIssueCount ? `${skippedIssueCount} 条已跳过` : ''}
                    {!failedIssueCount && !skippedIssueCount ? '不会影响后续历史补全。' : ' · 不影响后续历史补全。'}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-white/[0.055] px-2 py-0.5 text-[10px] text-foreground/55">
                  {issuesOpen ? '收起' : '展开'}
                </span>
              </button>
              {issuesOpen ? (
                <div className="space-y-2 border-t border-white/[0.05] p-2">
                  {foldedIssueItems.map((item) => (
                    <WorkbenchQueueRow
                      key={item.key}
                      item={item}
                      status={getItemStatus(item)}
                      meta={getItemMeta(item)}
                      title={getItemTitle(item)}
                      distillRequestState={distillRequestState}
                      folded
                      onRetryQueueItem={onRetryQueueItem}
                      onOpenCleanFile={onOpenCleanFile}
                      onOpenEmailFile={onOpenEmailFile}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[14px] border border-white/6 bg-white/[0.018] px-4 py-3 text-[12px] leading-6 text-muted-foreground">
          队列和资料记录都是空的。
        </div>
      )}
    </section>
  )
}

function WorkbenchQueueRow({
  item,
  status,
  meta,
  title,
  distillRequestState,
  onRetryQueueItem,
  onOpenCleanFile,
  onOpenEmailFile,
  folded = false,
}: {
  item: WorkbenchSourceItem
  status: WorkbenchSourceStatus
  meta: string[]
  title: string
  distillRequestState: string
  onRetryQueueItem: (queueId: string) => void
  onOpenCleanFile: (record: MaterialInventoryRecord) => void
  onOpenEmailFile: (record: MaterialInventoryRecord) => void
  folded?: boolean
}) {
  const queueItem = item.queue
  const record = item.record
  const queueItemCanRetry = Boolean(!folded && queueItem && !record && distillRequestState !== 'loading' && queueItem.status === 'failed')
  const failedMessage = (queueItem?.status === 'failed' || queueItem?.status === 'skipped') && queueItem.lastError ? queueItem.lastError : ''
  return (
    <div
      role={queueItemCanRetry ? 'button' : undefined}
      tabIndex={queueItemCanRetry ? 0 : undefined}
      title={queueItemCanRetry ? '点击重新处理' : undefined}
      className={cn(
        'rounded-[16px] border px-4 py-3 transition-colors',
        record ? 'border-white/6 bg-white/[0.026]' : folded ? 'border-white/[0.045] bg-black/10' : 'border-amber-300/10 bg-amber-300/[0.045]',
        queueItemCanRetry && 'cursor-pointer hover:border-amber-200/25 hover:bg-amber-300/[0.06]',
      )}
      onClick={() => {
        if (queueItemCanRetry && queueItem) onRetryQueueItem(queueItem.queueId)
      }}
      onKeyDown={(event) => {
        if (!queueItemCanRetry || !queueItem || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onRetryQueueItem(queueItem.queueId)
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className={cn('min-w-0 truncate text-[12px] leading-5 text-foreground', record ? 'font-medium' : 'font-semibold')}>
              {title}
            </span>
            <span className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px]',
              status.tone === 'red' && 'bg-red-400/10 text-red-100/78',
              status.tone === 'amber' && 'bg-amber-300/10 text-amber-100/78',
              status.tone === 'blue' && 'bg-sky-300/10 text-sky-100/82',
              status.tone === 'green' && 'bg-emerald-300/10 text-emerald-100/76',
              status.tone === 'gray' && 'bg-white/[0.055] text-foreground/58',
            )}>
              {status.label}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {meta.map((part) => <span key={part}>{part}</span>)}
          </div>
          {failedMessage ? (
            <div className="mt-1 truncate text-[10px] text-red-100/60">
              {failedMessage}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {record ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg text-foreground/62 hover:bg-emerald-400/[0.10] hover:text-emerald-100"
              disabled={!record.notebooklmExists}
              onClick={(event) => {
                event.stopPropagation()
                onOpenCleanFile(record)
              }}
              aria-label="打开清洗稿"
              title="打开清洗稿（外部应用）"
            >
              <FileText size={12} />
            </Button>
          ) : null}
          {record?.emailExists ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg text-foreground/62 hover:bg-sky-400/[0.10] hover:text-sky-100"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenEmailFile(record)
                }}
                aria-label="打开 email 稿"
                title="打开 email 稿（外部应用）"
              >
                <Mail size={12} />
              </Button>
          ) : null}
          {!record && !folded && queueItem && (queueItem.status === 'processing' || queueItem.status === 'failed') ? (
            <Button
              type="button"
              variant="ghost"
              className="h-7 rounded-lg px-2 text-[11px] text-foreground/62 hover:bg-white/[0.055] hover:text-foreground"
              disabled={distillRequestState === 'loading' || queueItem.status === 'processing'}
              onClick={(event) => {
                event.stopPropagation()
                onRetryQueueItem(queueItem.queueId)
              }}
              aria-label={queueItem.status === 'failed' ? '重新处理' : '制作中'}
              title={queueItem.status === 'failed' ? '重新处理' : '制作中'}
            >
              {queueItem.status === 'processing' ? <LoaderCircle size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
              {queueItem.status === 'processing' ? '制作中' : '重试'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

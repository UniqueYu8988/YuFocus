import type { UIEvent } from 'react'
import {
  Copy,
  GraduationCap,
  LoaderCircle,
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
  canLoadMore,
  distillRequestState,
  editorialSummaryBuildingPath,
  onLoadMore,
  getItemStatus,
  getItemMeta,
  getItemTitle,
  canOpenBrief,
  getNotebookLmPathTitle,
  onRetryQueueItem,
  onCopyNotebookLmPath,
  onOpenBrief,
}: {
  items: WorkbenchSourceItem[]
  visibleItems: WorkbenchSourceItem[]
  canLoadMore: boolean
  distillRequestState: string
  editorialSummaryBuildingPath: string
  onLoadMore: () => void
  getItemStatus: (item: WorkbenchSourceItem) => WorkbenchSourceStatus
  getItemMeta: (item: WorkbenchSourceItem) => string[]
  getItemTitle: (item: WorkbenchSourceItem) => string
  canOpenBrief: (record: MaterialInventoryRecord) => boolean
  getNotebookLmPathTitle: (record: MaterialInventoryRecord) => string
  onRetryQueueItem: (queueId: string) => void
  onCopyNotebookLmPath: (record: MaterialInventoryRecord) => void
  onOpenBrief: (record: MaterialInventoryRecord) => void
}) {
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!canLoadMore) return
    const target = event.currentTarget
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceToBottom <= 72) onLoadMore()
  }

  return (
    <section data-queue-record-feed="true">
      {items.length ? (
        <div
          className="max-h-[calc(100vh-210px)] min-h-[240px] space-y-2 overflow-y-auto pr-1"
          onScroll={handleScroll}
          aria-label="队列记录流"
        >
          {visibleItems.map((item) => (
            <WorkbenchQueueRow
              key={item.key}
              item={item}
              status={item.record && editorialSummaryBuildingPath === item.record.path
                ? { label: '正在编稿', tone: 'red', active: true }
                : getItemStatus(item)}
              meta={getItemMeta(item)}
              title={getItemTitle(item)}
              canOpenBrief={canOpenBrief}
              getNotebookLmPathTitle={getNotebookLmPathTitle}
              distillRequestState={distillRequestState}
              onRetryQueueItem={onRetryQueueItem}
              onCopyNotebookLmPath={onCopyNotebookLmPath}
              onOpenBrief={onOpenBrief}
            />
          ))}
          {canLoadMore ? (
            <div className="flex justify-center py-2">
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
  canOpenBrief,
  getNotebookLmPathTitle,
  distillRequestState,
  onRetryQueueItem,
  onCopyNotebookLmPath,
  onOpenBrief,
}: {
  item: WorkbenchSourceItem
  status: WorkbenchSourceStatus
  meta: string[]
  title: string
  canOpenBrief: (record: MaterialInventoryRecord) => boolean
  getNotebookLmPathTitle: (record: MaterialInventoryRecord) => string
  distillRequestState: string
  onRetryQueueItem: (queueId: string) => void
  onCopyNotebookLmPath: (record: MaterialInventoryRecord) => void
  onOpenBrief: (record: MaterialInventoryRecord) => void
}) {
  const queueItem = item.queue
  const record = item.record
  const queueItemCanRetry = Boolean(queueItem && !record && distillRequestState !== 'loading' && queueItem.status === 'failed')
  const recordCanOpenBrief = record ? canOpenBrief(record) : false
  const failedMessage = (queueItem?.status === 'failed' || queueItem?.status === 'skipped') && queueItem.lastError ? queueItem.lastError : ''
  return (
    <div
      role={queueItemCanRetry ? 'button' : undefined}
      tabIndex={queueItemCanRetry ? 0 : undefined}
      title={queueItemCanRetry ? '点击重新处理' : undefined}
      className={cn(
        'rounded-[16px] border px-4 py-3 transition-colors',
        record ? 'border-white/6 bg-white/[0.026]' : 'border-amber-300/10 bg-amber-300/[0.045]',
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
              status.tone === 'yellow' && 'bg-yellow-300/10 text-yellow-100/76',
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
              className="h-7 rounded-lg px-2 text-[11px] text-foreground/62 hover:bg-white/[0.055] hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation()
                onCopyNotebookLmPath(record)
              }}
              aria-label={getNotebookLmPathTitle(record)}
              title={getNotebookLmPathTitle(record)}
            >
              <Copy size={12} />
              路径
            </Button>
          ) : null}
          {record ? (
            recordCanOpenBrief ? (
              <Button
                variant="ghost"
                className="h-7 rounded-lg px-2 text-[11px] text-foreground/62 hover:bg-white/[0.055] hover:text-foreground"
                onClick={() => onOpenBrief(record)}
                aria-label="打开资料"
                title="打开资料"
              >
                <GraduationCap size={12} />
                查看
              </Button>
            ) : null
          ) : queueItem && (queueItem.status === 'processing' || queueItem.status === 'failed') ? (
            <Button
              type="button"
              variant="ghost"
              className="h-7 rounded-lg px-2 text-[11px] text-foreground/62 hover:bg-white/[0.055] hover:text-foreground"
              disabled={distillRequestState === 'loading' || queueItem.status === 'processing'}
              onClick={(event) => {
                event.stopPropagation()
                onRetryQueueItem(queueItem.queueId)
              }}
              aria-label={queueItem.status === 'failed' ? '重新处理' : '正在处理'}
              title={queueItem.status === 'failed' ? '重新处理' : '正在处理'}
            >
              {queueItem.status === 'processing' ? <LoaderCircle size={12} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
              {queueItem.status === 'processing' ? '处理中' : '重试'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

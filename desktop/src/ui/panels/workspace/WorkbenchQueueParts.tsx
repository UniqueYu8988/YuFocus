import {
  ArchiveRestore,
  Copy,
  FileText,
  FolderOpen,
  GraduationCap,
  LoaderCircle,
  Play,
  RefreshCcw,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/ui/components/base/badge'
import { Button } from '@/ui/components/base/button'
import { Card, CardContent } from '@/ui/components/base/card'
import { cn } from '@/ui/components/utils'
import {
  FixedPageControls,
  WorkbenchStatusLight,
  type MaterialInventoryRecord,
  type PageSlice,
  type RuntimeSettingsFallback,
  type WorkbenchSourceItem,
  type WorkbenchSourceStatus,
} from '@/ui/panels/workspace/WorkbenchShared'

export function WorkbenchQueuePanel({
  items,
  pagedItems,
  pageSize,
  canClear,
  distillRequestState,
  materialRootDir,
  runtimeSettings,
  editorialSummaryBuildingPath,
  onClear,
  onOpenMaterialRoot,
  onRefreshMaterials,
  onPageChange,
  getItemStatus,
  getItemMeta,
  getItemTitle,
  canOpenBrief,
  getNotebookLmPathTitle,
  onRetryQueueItem,
  onCopyNotebookLmPath,
  onOpenBrief,
  onDeleteMaterial,
  onRemoveQueuedVideo,
}: {
  items: WorkbenchSourceItem[]
  pagedItems: PageSlice<WorkbenchSourceItem>
  pageSize: number
  canClear: boolean
  distillRequestState: string
  materialRootDir: string
  runtimeSettings: RuntimeSettingsFallback
  editorialSummaryBuildingPath: string
  onClear: () => void
  onOpenMaterialRoot: () => void
  onRefreshMaterials: () => void
  onPageChange: (page: number) => void
  getItemStatus: (item: WorkbenchSourceItem) => WorkbenchSourceStatus
  getItemMeta: (item: WorkbenchSourceItem) => string[]
  getItemTitle: (item: WorkbenchSourceItem) => string
  canOpenBrief: (record: MaterialInventoryRecord) => boolean
  getNotebookLmPathTitle: (record: MaterialInventoryRecord) => string
  onRetryQueueItem: (queueId: string) => void
  onCopyNotebookLmPath: (record: MaterialInventoryRecord) => void
  onOpenBrief: (record: MaterialInventoryRecord) => void
  onDeleteMaterial: (record: MaterialInventoryRecord) => void
  onRemoveQueuedVideo: (queueId: string) => void
}) {
  return (
    <section>
      <Card className="overflow-hidden rounded-[10px] border-white/[0.09] bg-[#1f1f1f] shadow-none">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-foreground">
              <ArchiveRestore size={14} />
              <span>任务队列</span>
              <Badge variant="outline" className="border-white/8 bg-white/[0.035] px-2 text-[10px] text-foreground/74">
                {items.length}
              </Badge>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 rounded-md text-foreground/58 hover:bg-destructive/10 hover:text-destructive"
                disabled={!canClear || distillRequestState === 'loading'}
                onClick={onClear}
                aria-label="清空任务队列"
                title="清空任务队列"
              >
                <Trash2 size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="ml-1 size-6 rounded-md text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
                onClick={onOpenMaterialRoot}
                disabled={!runtimeSettings?.output_dir}
                title={materialRootDir}
                aria-label="打开材料目录"
              >
                <FolderOpen size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 rounded-md text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
                onClick={onRefreshMaterials}
                aria-label="刷新资料记录"
                title="刷新资料记录"
              >
                <RefreshCcw size={12} />
              </Button>
            </div>
          </div>

          {items.length ? (
            <div className="grid gap-2">
              {pagedItems.items.map((item) => (
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
                  editorialSummaryBuildingPath={editorialSummaryBuildingPath}
                  onRetryQueueItem={onRetryQueueItem}
                  onCopyNotebookLmPath={onCopyNotebookLmPath}
                  onOpenBrief={onOpenBrief}
                  onDeleteMaterial={onDeleteMaterial}
                  onRemoveQueuedVideo={onRemoveQueuedVideo}
                />
              ))}
              <FixedPageControls
                page={pagedItems.page}
                pageSize={pageSize}
                total={items.length}
                onPageChange={onPageChange}
                align="center"
              />
            </div>
          ) : (
            <div className="rounded-[14px] border border-white/6 bg-white/[0.018] px-4 py-3 text-[12px] leading-6 text-muted-foreground">
              队列和资料记录都是空的。
            </div>
          )}
        </CardContent>
      </Card>
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
  editorialSummaryBuildingPath,
  onRetryQueueItem,
  onCopyNotebookLmPath,
  onOpenBrief,
  onDeleteMaterial,
  onRemoveQueuedVideo,
}: {
  item: WorkbenchSourceItem
  status: WorkbenchSourceStatus
  meta: string[]
  title: string
  canOpenBrief: (record: MaterialInventoryRecord) => boolean
  getNotebookLmPathTitle: (record: MaterialInventoryRecord) => string
  distillRequestState: string
  editorialSummaryBuildingPath: string
  onRetryQueueItem: (queueId: string) => void
  onCopyNotebookLmPath: (record: MaterialInventoryRecord) => void
  onOpenBrief: (record: MaterialInventoryRecord) => void
  onDeleteMaterial: (record: MaterialInventoryRecord) => void
  onRemoveQueuedVideo: (queueId: string) => void
}) {
  const queueItem = item.queue
  const record = item.record
  const editorialSummaryBuilding = Boolean(record && editorialSummaryBuildingPath === record.path)
  const queueItemCanRetry = Boolean(queueItem && !record && distillRequestState !== 'loading' && queueItem.status === 'failed')
  const recordCanOpenBrief = record ? canOpenBrief(record) : false
  return (
    <div
      role={queueItemCanRetry ? 'button' : undefined}
      tabIndex={queueItemCanRetry ? 0 : undefined}
      title={queueItemCanRetry ? '点击重新处理' : undefined}
      className={cn(
        'rounded-[14px] border p-3 transition-colors',
        record ? 'border-white/6 bg-white/[0.018]' : 'border-amber-300/10 bg-amber-300/[0.035]',
        queueItemCanRetry && 'cursor-pointer hover:border-white/[0.11] hover:bg-white/[0.035]',
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
          <div className={cn('truncate text-[12px] leading-5 text-foreground', record ? 'font-medium' : 'font-semibold')}>
            {title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {meta.map((part) => <span key={part}>{part}</span>)}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <WorkbenchStatusLight status={status} />
          {record ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg text-foreground/68 hover:bg-yellow-300/[0.11] hover:text-yellow-100"
              onClick={(event) => {
                event.stopPropagation()
                onCopyNotebookLmPath(record)
              }}
              aria-label={getNotebookLmPathTitle(record)}
              title={getNotebookLmPathTitle(record)}
            >
              <Copy size={13} />
            </Button>
          ) : null}
          {record ? (
            recordCanOpenBrief ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
                onClick={() => onOpenBrief(record)}
                aria-label={record.editorialSummaryExists ? '打开精读稿' : '打开资料'}
                title={record.editorialSummaryExists ? '打开精读稿' : '打开资料'}
              >
                {record.editorialSummaryExists ? <FileText size={13} /> : <GraduationCap size={13} />}
              </Button>
            ) : null
          ) : queueItem && (queueItem.status === 'processing' || queueItem.status === 'failed') ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
              disabled={distillRequestState === 'loading' || queueItem.status === 'processing'}
              onClick={(event) => {
                event.stopPropagation()
                onRetryQueueItem(queueItem.queueId)
              }}
              aria-label={queueItem.status === 'failed' ? '重新处理' : '正在处理'}
              title={queueItem.status === 'failed' ? '重新处理' : '正在处理'}
            >
              {queueItem.status === 'processing' ? <LoaderCircle size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
            </Button>
          ) : null}
          {record ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg text-foreground/58 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDeleteMaterial(record)}
              aria-label="删除资料包"
              title="删除资料包"
            >
              <Trash2 size={13} />
            </Button>
          ) : queueItem ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg text-foreground/58 hover:bg-destructive/10 hover:text-destructive"
              disabled={queueItem.status === 'processing'}
              onClick={(event) => {
                event.stopPropagation()
                onRemoveQueuedVideo(queueItem.queueId)
              }}
              aria-label="移出队列"
              title="移出队列"
            >
              <Trash2 size={13} />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

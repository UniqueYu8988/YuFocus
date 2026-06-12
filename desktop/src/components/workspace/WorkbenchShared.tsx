import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type RuntimeSettingsFallback = Awaited<ReturnType<typeof window.desktopAPI.loadSettings>> | null
export type MaterialInventory = Awaited<ReturnType<typeof window.desktopAPI.listMaterialPackages>>
export type MaterialInventoryRecord = MaterialInventory['records'][number]
export type BilibiliFollowSources = Awaited<ReturnType<typeof window.desktopAPI.listBilibiliFollowSources>>
export type BilibiliFollowSource = BilibiliFollowSources['items'][number]
export type BilibiliSourceVideos = Awaited<ReturnType<typeof window.desktopAPI.listBilibiliSourceVideos>>
export type BilibiliSourceVideo = BilibiliSourceVideos['sources'][number]['videos'][number] & { sourceName?: string }
export type WorkbenchQueueItem = Awaited<ReturnType<typeof window.desktopAPI.loadWorkbenchQueue>>[number]
export type MaterialSourceMode = 'bilibili' | 'local_media'

export type WorkbenchSourceItem = {
  key: string
  queue?: WorkbenchQueueItem
  record?: MaterialInventoryRecord
  order: number
}

export type WorkbenchSourceStatus = {
  label: string
  tone: 'red' | 'yellow' | 'green' | 'gray'
  active: boolean
}

export type PageSlice<T> = {
  page: number
  totalPages: number
  items: T[]
}

function getPageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
}

export function clampPage(page: number, total: number, pageSize: number) {
  return Math.min(Math.max(1, page), getPageCount(total, pageSize))
}

export function getPageSlice<T>(items: T[], page: number, pageSize: number): PageSlice<T> {
  const safePage = clampPage(page, items.length, pageSize)
  const start = (safePage - 1) * pageSize
  return {
    page: safePage,
    totalPages: getPageCount(items.length, pageSize),
    items: items.slice(start, start + pageSize),
  }
}

export function FixedPageControls({
  page,
  total,
  pageSize,
  onPageChange,
  align = 'end',
}: {
  page: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  align?: 'center' | 'end'
}) {
  const pageCount = getPageCount(total, pageSize)
  const safePage = clampPage(page, total, pageSize)
  return (
    <div className={cn('flex h-6 items-center gap-3 text-[10px] text-muted-foreground', align === 'center' ? 'justify-center' : 'justify-end')}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 rounded-md text-foreground/50 hover:bg-white/[0.06] hover:text-foreground"
        disabled={safePage <= 1}
        onClick={() => onPageChange(safePage - 1)}
        aria-label="上一页"
        title="上一页"
      >
        <span aria-hidden>‹</span>
      </Button>
      <span className="w-10 text-center tabular-nums">
        {safePage}/{pageCount}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 rounded-md text-foreground/50 hover:bg-white/[0.06] hover:text-foreground"
        disabled={safePage >= pageCount}
        onClick={() => onPageChange(safePage + 1)}
        aria-label="下一页"
        title="下一页"
      >
        <span aria-hidden>›</span>
      </Button>
    </div>
  )
}

export function WorkbenchStatusLight({ status }: { status: WorkbenchSourceStatus }) {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center"
      aria-label={status.label}
      title={status.label}
    >
      <span
        className={cn(
          'size-3.5 rounded-full shadow-[inset_0_-1px_1px_rgba(0,0,0,0.22),0_0_10px_rgba(255,255,255,0.05)]',
          status.tone === 'red' && 'bg-[#ff5f57] shadow-[inset_0_-1px_1px_rgba(0,0,0,0.24),0_0_10px_rgba(255,95,87,0.22)]',
          status.tone === 'yellow' && 'bg-[#ffbd2e] shadow-[inset_0_-1px_1px_rgba(0,0,0,0.24),0_0_10px_rgba(255,189,46,0.20)]',
          status.tone === 'green' && 'bg-[#28c840] shadow-[inset_0_-1px_1px_rgba(0,0,0,0.24),0_0_10px_rgba(40,200,64,0.22)]',
          status.tone === 'gray' && 'bg-white/18 shadow-[inset_0_-1px_1px_rgba(0,0,0,0.24)]',
          status.active && 'animate-pulse',
        )}
      />
    </span>
  )
}

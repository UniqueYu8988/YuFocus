import { Eye, FileText, FolderOpen, LoaderCircle, RefreshCcw, Search } from 'lucide-react'
import { Badge } from '@/ui/components/base/badge'
import { Button } from '@/ui/components/base/button'
import { Card, CardContent } from '@/ui/components/base/card'
import { Input } from '@/ui/components/base/input'
import {
  getMaterialLibraryReadLabel,
  getMaterialLibraryReadPath,
} from '@/ui/panels/workspace/ArchivePaneParts'

type MaterialInventory = Awaited<ReturnType<typeof window.desktopAPI.listMaterialPackages>>
type MaterialInventoryRecord = MaterialInventory['records'][number]
type KnowledgeInventory = Awaited<ReturnType<typeof window.desktopAPI.listKnowledgeLibrary>>
type KnowledgeInventoryRecord = KnowledgeInventory['records'][number]

export type KnowledgeSourceFilter =
  | { kind: 'all'; title: string }
  | { kind: 'creator'; title: string; creator: string }
  | { kind: 'misc'; title: string; pinnedCreatorNames: string[] }

export function KnowledgePaneContent({
  totalCount,
  totalTextLength,
  libraryPath,
  rootDir,
  query,
  sourceFilter,
  loading,
  initialLoading,
  error,
  materialRecords,
  records,
  onQueryChange,
  onRefresh,
  onClearSourceFilter,
  onRevealLibraryPath,
  onOpenMaterialRecord,
  onOpenKnowledgeRecord,
  onRevealPath,
  onOpenPath,
  formatRelativeTime,
  formatCompactNumber,
}: {
  totalCount: number
  totalTextLength: number
  libraryPath: string
  rootDir: string
  query: string
  sourceFilter: KnowledgeSourceFilter
  loading: boolean
  initialLoading: boolean
  error: string
  materialRecords: MaterialInventoryRecord[]
  records: KnowledgeInventoryRecord[]
  onQueryChange: (query: string) => void
  onRefresh: () => void
  onClearSourceFilter: () => void
  onRevealLibraryPath: () => void
  onOpenMaterialRecord: (record: MaterialInventoryRecord) => void
  onOpenKnowledgeRecord: (record: KnowledgeInventoryRecord) => void
  onRevealPath: (targetPath: string) => void
  onOpenPath: (targetPath: string) => void
  formatRelativeTime: (timestamp: number) => string
  formatCompactNumber: (value: number) => string
}) {
  return (
    <div className="grid w-full gap-5">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-[16px] border border-white/7 bg-white/[0.025] p-4">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <FileText size={13} />
            已整理资料
          </div>
          <div className="mt-2 text-[24px] font-semibold text-foreground">{totalCount}</div>
        </div>
        <div className="rounded-[16px] border border-white/7 bg-white/[0.025] p-4">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Search size={13} />
            正文字数
          </div>
          <div className="mt-2 text-[24px] font-semibold text-foreground">
            {formatCompactNumber(totalTextLength)}
          </div>
        </div>
        <div className="rounded-[16px] border border-white/7 bg-white/[0.025] p-4">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <FolderOpen size={13} />
            索引
          </div>
          <button
            type="button"
            className="mt-2 block max-w-full truncate text-left text-[12px] leading-6 text-muted-foreground hover:text-foreground"
            disabled={!libraryPath}
            onClick={onRevealLibraryPath}
          >
            {libraryPath || 'knowledge_library.json'}
          </button>
        </div>
      </div>

      <Card className="rounded-[10px] border-white/[0.09] bg-[#1f1f1f] shadow-none">
        <CardContent className="grid gap-4 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="grid gap-1.5">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/86">
                <Search size={14} />
                搜索资料
              </span>
              <Input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="搜索标题、来源、正文关键词"
              />
            </label>
            <div className="flex items-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={loading}
                onClick={onRefresh}
              >
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw size={14} />}
                刷新
              </Button>
            </div>
          </div>

          <div className="rounded-[12px] border border-white/6 bg-black/10 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            灵犀目录：{rootDir}
          </div>

          {error ? (
            <div className="rounded-[14px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-[12px] leading-6 text-destructive-foreground">
              {error}
            </div>
          ) : null}

          {sourceFilter.kind !== 'all' ? (
            <div className="flex items-center justify-between gap-3 rounded-[12px] border border-white/6 bg-white/[0.025] px-3 py-2 text-[11px] text-muted-foreground">
              <span className="min-w-0 truncate">当前灵犀：{sourceFilter.title}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-lg px-2 text-[11px]"
                onClick={onClearSourceFilter}
              >
                全部
              </Button>
            </div>
          ) : null}

          {initialLoading ? (
            <div className="flex min-h-[220px] items-center justify-center gap-2 text-[12px] text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在读取灵犀
            </div>
          ) : null}

          {materialRecords.length ? (
            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3 text-[12px] font-semibold text-foreground">
                <span>视频资料</span>
                <span className="text-[10px] font-medium text-muted-foreground">{materialRecords.length} 条</span>
              </div>
              {materialRecords.map((record) => (
                <KnowledgeMaterialRecordCard
                  key={record.path}
                  record={record}
                  onOpen={onOpenMaterialRecord}
                  onOpenPath={onOpenPath}
                  formatRelativeTime={formatRelativeTime}
                  formatCompactNumber={formatCompactNumber}
                />
              ))}
            </section>
          ) : null}

          {records.length ? (
            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3 text-[12px] font-semibold text-foreground">
                <span>入档资料</span>
                <span className="text-[10px] font-medium text-muted-foreground">{records.length} 条</span>
              </div>
              {records.map((record) => (
                <KnowledgeLibraryRecordCard
                  key={record.id}
                  record={record}
                  onOpen={onOpenKnowledgeRecord}
                  onRevealPath={onRevealPath}
                  onOpenPath={onOpenPath}
                  formatRelativeTime={formatRelativeTime}
                  formatCompactNumber={formatCompactNumber}
                />
              ))}
            </section>
          ) : null}

          {!loading && !materialRecords.length && !records.length ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[18px] border border-white/6 bg-black/10 px-4 py-8 text-center">
              <FileText className="size-8 text-muted-foreground/70" />
              <div className="text-[13px] font-semibold text-foreground">
                {query.trim() ? '没有匹配的资料' : '灵犀还是空的'}
              </div>
              <div className="max-w-md text-[12px] leading-6 text-muted-foreground">
                先在制作页整理视频资料，之后会进入灵犀。
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function KnowledgeMaterialRecordCard({
  record,
  onOpen,
  onOpenPath,
  formatRelativeTime,
  formatCompactNumber,
}: {
  record: MaterialInventoryRecord
  onOpen: (record: MaterialInventoryRecord) => void
  onOpenPath: (targetPath: string) => void
  formatRelativeTime: (timestamp: number) => string
  formatCompactNumber: (value: number) => string
}) {
  const readPath = getMaterialLibraryReadPath(record)
  const readLabel = getMaterialLibraryReadLabel(record)
  return (
    <div className="rounded-[18px] border border-white/[0.075] bg-[linear-gradient(180deg,rgba(31,31,31,0.92),rgba(24,24,24,0.96))] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-sky-300/14 bg-sky-300/[0.07] text-sky-100">
              <FileText size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-foreground">{record.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                {record.creator ? <span>{record.creator}</span> : null}
                {record.sourceId ? <span>{record.sourceId}</span> : null}
                <span>{formatCompactNumber(record.textLength)} 字</span>
                <span>{formatRelativeTime(record.updatedAt)}</span>
              </div>
            </div>
            <Badge
              variant="outline"
              className={record.editorialSummaryExists
                ? 'border-emerald-400/16 bg-emerald-400/[0.08] text-emerald-100'
                : 'border-amber-400/18 bg-amber-400/[0.08] text-amber-100'}
            >
              {readLabel}
            </Badge>
          </div>

          <div className="grid gap-1 text-[10px] text-muted-foreground">
            {readPath ? <div className="truncate">阅读文件：{readPath}</div> : null}
            <div className="truncate">材料包：{record.path}</div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <Button
            type="button"
            size="sm"
            className="rounded-xl"
            disabled={!readPath}
            onClick={() => onOpen(record)}
          >
            <Eye size={13} />
            阅读
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            disabled={!record.path}
            onClick={() => onOpenPath(record.path)}
          >
            <FolderOpen size={13} />
            定位
          </Button>
        </div>
      </div>
    </div>
  )
}

function KnowledgeLibraryRecordCard({
  record,
  onOpen,
  onRevealPath,
  onOpenPath,
  formatRelativeTime,
  formatCompactNumber,
}: {
  record: KnowledgeInventoryRecord
  onOpen: (record: KnowledgeInventoryRecord) => void
  onRevealPath: (targetPath: string) => void
  onOpenPath: (targetPath: string) => void
  formatRelativeTime: (timestamp: number) => string
  formatCompactNumber: (value: number) => string
}) {
  return (
    <div className="rounded-[18px] border border-white/[0.075] bg-[linear-gradient(180deg,rgba(31,31,31,0.92),rgba(24,24,24,0.96))] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-emerald-400/14 bg-emerald-400/[0.07] text-emerald-100">
              <FileText size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-foreground">{record.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                {record.sourceId ? <span>{record.sourceId}</span> : null}
                <span>{formatCompactNumber(record.textLength)} 字</span>
                <span>{formatRelativeTime(record.updatedAt)}</span>
              </div>
            </div>
            <Badge
              variant="outline"
              className={record.fileExists
                ? 'border-emerald-400/16 bg-emerald-400/[0.08] text-emerald-100'
                : 'border-amber-400/18 bg-amber-400/[0.08] text-amber-100'}
            >
              {record.fileExists ? '可阅读' : '文件缺失'}
            </Badge>
          </div>

          <p className="line-clamp-3 text-[12px] leading-6 text-muted-foreground">
            {record.preview || '这份资料还没有可用预览。'}
          </p>

          <div className="grid gap-1 text-[10px] text-muted-foreground">
            <div className="truncate">资料文件：{record.libraryPath}</div>
            <div className="truncate">材料包：{record.materialPath}</div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <Button
            type="button"
            size="sm"
            className="rounded-xl"
            disabled={!record.fileExists}
            onClick={() => onOpen(record)}
          >
            <Eye size={13} />
            阅读
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            disabled={!record.libraryPath}
            onClick={() => onRevealPath(record.libraryPath)}
          >
            <FolderOpen size={13} />
            定位
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            disabled={!record.materialPath}
            onClick={() => onOpenPath(record.materialPath)}
          >
            <FolderOpen size={13} />
            材料
          </Button>
        </div>
      </div>
    </div>
  )
}

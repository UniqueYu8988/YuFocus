import {
  FileVideo,
  FolderOpen,
  Link2,
  ListPlus,
  LoaderCircle,
  Play,
  RefreshCcw,
  Star,
} from 'lucide-react'
import { Badge } from '@/ui/components/base/badge'
import { Button } from '@/ui/components/base/button'
import { Input } from '@/ui/components/base/input'
import { Progress } from '@/ui/components/base/progress'
import { cn } from '@/ui/components/utils'
import {
  FixedPageControls,
  type BilibiliFollowSource,
  type BilibiliSourceVideo,
  type MaterialSourceMode,
  type PageSlice,
} from '@/ui/panels/workspace/WorkbenchShared'
import settingsBilibiliIcon from '@/assets/settings-bilibili.svg'

export function ManualSourceForm({
  materialSourceMode,
  videoInput,
  distillRequestState,
  manualSourceLoading,
  distillError,
  onVideoInputChange,
  onMaterialSourceModeChange,
  onSubmit,
}: {
  materialSourceMode: MaterialSourceMode
  videoInput: string
  distillRequestState: string
  manualSourceLoading: boolean
  distillError: string
  onVideoInputChange: (value: string) => void
  onMaterialSourceModeChange: (mode: MaterialSourceMode) => void
  onSubmit: () => void
}) {
  const loading = distillRequestState === 'loading' || manualSourceLoading
  return (
    <div className="grid gap-2">
      <form
        className="flex min-w-0 items-center gap-2 border-b border-white/[0.12] pb-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (loading || !videoInput.trim()) return
          onSubmit()
        }}
      >
        <span className="shrink-0 text-foreground/58">
          {materialSourceMode === 'local_media' ? <FileVideo size={13} /> : <Link2 size={13} />}
        </span>
        <input
          value={videoInput}
          onChange={(event) => {
            onVideoInputChange(event.target.value)
            onMaterialSourceModeChange('bilibili')
          }}
          placeholder={materialSourceMode === 'local_media' ? '本地音视频路径' : '输入 BV 或 B站链接'}
          disabled={loading}
          className="min-w-0 flex-1 bg-transparent py-1 text-[12px] font-medium leading-5 text-foreground outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-45"
        />
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          className={cn(
            'size-7 rounded-lg border-0 bg-transparent shadow-none',
            loading
              ? 'text-sky-100 hover:bg-sky-400/[0.08]'
              : 'text-foreground/74 hover:bg-white/[0.06] hover:text-foreground',
          )}
          disabled={!videoInput.trim() || loading}
          aria-label={manualSourceLoading ? '正在读取视频信息' : distillRequestState === 'loading' ? '资料包生成中' : '加入队列'}
          title={manualSourceLoading ? '正在读取视频信息' : distillRequestState === 'loading' ? '资料包生成中' : '加入队列'}
        >
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
        </Button>
      </form>

      {distillError ? (
        <div className="truncate text-[11px] leading-5 text-destructive-foreground">
          {distillError}
        </div>
      ) : null}
    </div>
  )
}

export function FollowSourceList({
  allSourceCount,
  loading,
  filteredSources,
  pagedSources,
  pinnedSourceIds,
  activeSourceId,
  pinnedOnly,
  query,
  error,
  message,
  onQueryChange,
  onPageChange,
  onOpenSource,
  onTogglePinnedSource,
}: {
  allSourceCount: number
  loading: boolean
  filteredSources: BilibiliFollowSource[]
  pagedSources: PageSlice<BilibiliFollowSource>
  pinnedSourceIds: Set<string>
  activeSourceId: string
  pinnedOnly: boolean
  query: string
  error: string
  message?: string
  onQueryChange: (value: string) => void
  onPageChange: (page: number) => void
  onOpenSource: (source: BilibiliFollowSource) => void
  onTogglePinnedSource: (source: BilibiliFollowSource) => void
}) {
  return (
    <div className="min-w-0 space-y-2">
      {allSourceCount ? (
        <>
          {allSourceCount > 8 ? (
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索视频来源"
              className="h-8 text-[12px]"
            />
          ) : null}
          <div className="grid h-[298px] content-start gap-1.5 overflow-hidden">
            {filteredSources.length ? pagedSources.items.map((source) => {
              const pinned = pinnedSourceIds.has(source.mid)
              const active = activeSourceId === source.mid
              return (
                <div
                  key={source.mid}
                  className={cn(
                    'flex h-8 items-center gap-1 rounded-[9px] border px-1 transition-colors',
                    active
                      ? 'border-sky-300/18 bg-sky-300/[0.06]'
                      : pinned
                        ? 'border-amber-300/18 bg-amber-300/[0.06]'
                        : 'border-white/[0.055] bg-white/[0.018]',
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'size-6 shrink-0 rounded-md hover:bg-white/[0.07]',
                      pinned ? 'text-amber-200' : 'text-foreground/42 hover:text-foreground/86',
                    )}
                    onClick={() => onTogglePinnedSource(source)}
                    aria-label={pinned ? '取消固定信息源' : '固定信息源'}
                    title={pinned ? '取消固定' : '固定到侧边栏'}
                  >
                    <Star size={12} fill={pinned ? 'currentColor' : 'none'} />
                  </Button>
                  <button
                    type="button"
                    className="flex h-6 min-w-0 flex-1 items-center rounded-md px-1 text-left text-foreground transition-colors hover:bg-white/[0.04]"
                    title={`${source.name} ${source.mid}`}
                    onClick={() => onOpenSource(source)}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-5">{source.name}</span>
                  </button>
                </div>
              )
            }) : (
              <div className="rounded-[12px] border border-white/6 bg-white/[0.018] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                {pinnedOnly ? '还没有收藏的视频来源。' : '没有匹配的视频来源。'}
              </div>
            )}
          </div>
          <FixedPageControls
            page={pagedSources.page}
            pageSize={8}
            total={filteredSources.length}
            onPageChange={onPageChange}
            align="center"
          />
        </>
      ) : (
        <div className="rounded-[12px] border border-white/6 bg-white/[0.018] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          {error || message || (loading ? '正在读取视频来源。' : '配置 SESSDATA 后可读取关注账号。')}
        </div>
      )}
    </div>
  )
}

export function SourceVideoList({
  activeSource,
  activeSourceId,
  videos,
  pagedVideos,
  selectedVideoIds,
  maxDurationSeconds,
  sourceVideoPage,
  fetchedAt,
  loading,
  error,
  onToggleVideo,
  onPageChange,
  getDurationBarPercent,
  formatRelativeTime,
}: {
  activeSource: BilibiliFollowSource | null
  activeSourceId: string
  videos: BilibiliSourceVideo[]
  pagedVideos: PageSlice<BilibiliSourceVideo>
  selectedVideoIds: string[]
  maxDurationSeconds: number
  sourceVideoPage: number
  fetchedAt: number
  loading: boolean
  error: string
  onToggleVideo: (bvid: string) => void
  onPageChange: (page: number) => void
  getDurationBarPercent: (durationSeconds: number, maxDurationSeconds: number) => number
  formatRelativeTime: (timestamp: number) => string
}) {
  return (
    <>
      <div className="grid h-[298px] content-start gap-1.5 overflow-hidden">
        {activeSource && videos.length ? pagedVideos.items.map((video) => {
          const selected = selectedVideoIds.includes(video.bvid)
          const durationBarPercent = getDurationBarPercent(Number(video.durationSeconds) || 0, maxDurationSeconds)
          const dateLabel = video.pubdate ? formatRelativeTime(video.pubdate * 1000) : ''
          const durationLabel = video.durationText || '--:--'
          return (
            <button
              key={video.bvid}
              type="button"
              aria-pressed={selected}
              className={cn(
                'flex h-11 items-center gap-2 rounded-[10px] border px-2.5 text-left transition-colors',
                selected
                  ? 'border-sky-400/20 bg-sky-400/[0.08] text-sky-50'
                  : 'border-white/[0.055] bg-white/[0.018] text-foreground hover:bg-white/[0.04]',
              )}
              onClick={() => onToggleVideo(video.bvid)}
            >
              <div className={cn(
                'relative grid h-8 w-[52px] shrink-0 content-center gap-1 rounded-md border px-1.5',
                selected
                  ? 'border-sky-300/25 bg-sky-300/[0.10]'
                  : 'border-white/8 bg-white/[0.026]',
              )}>
                <span className={cn(
                  'truncate text-[10px] font-semibold leading-3 tabular-nums',
                  selected ? 'text-sky-50' : 'text-foreground/70',
                )}>
                  {durationLabel}
                </span>
                <div
                  className="h-0.5 w-10 overflow-hidden rounded-full bg-white/[0.09]"
                  role="meter"
                  aria-label={video.durationText ? `时长 ${video.durationText}` : '时长未知'}
                  aria-valuemin={0}
                  aria-valuemax={maxDurationSeconds}
                  aria-valuenow={Number(video.durationSeconds) || 0}
                  title={video.durationText ? `时长 ${video.durationText}` : '时长未知'}
                >
                  <div
                    key={`${activeSourceId}:${sourceVideoPage}:${fetchedAt}:${video.bvid}`}
                    className={cn(
                      'duration-bar-inject h-full rounded-full transition-colors duration-300 ease-out',
                      selected ? 'bg-sky-300/90' : 'bg-foreground/46',
                    )}
                    style={{ width: `${durationBarPercent}%` }}
                  />
                </div>
              </div>
              <div className="grid h-8 min-w-0 flex-1 content-between overflow-hidden">
                <div className="truncate text-[12px] font-semibold leading-4" title={video.title}>{video.title}</div>
                <div className="flex min-w-0 justify-end text-[10px] leading-4">
                  {dateLabel ? (
                    <span className="shrink-0 whitespace-nowrap text-[10px] leading-4 text-muted-foreground">
                      {dateLabel}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          )
        }) : (
          <div className="rounded-[12px] border border-white/6 bg-white/[0.018] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
            {!activeSource
              ? '从左侧选择一个视频来源后，这里会显示最近视频。'
              : error || (loading ? '正在读取最近视频。' : '还没有读取到最近视频。')}
          </div>
        )}
      </div>
      <div className="relative h-7 min-w-0">
        <div className="absolute left-1/2 top-1/2 flex max-w-[calc(100%-180px)] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-2 text-[10px] leading-4">
          <span className="min-w-0 truncate font-semibold text-foreground/82">
            {activeSource ? activeSource.name : '未选择'}
          </span>
          {activeSource?.mid ? (
            <span className="shrink-0 tabular-nums text-muted-foreground/68">
              ID {activeSource.mid}
            </span>
          ) : null}
        </div>
        <div className="absolute right-0 top-1/2 -translate-y-1/2">
          {activeSource && videos.length ? (
            <FixedPageControls
              page={pagedVideos.page}
              pageSize={6}
              total={videos.length}
              onPageChange={onPageChange}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}

export function WorkbenchToolbar({
  activeSource,
  filteredSourceCount,
  sourcesLoading,
  distillRequestState,
  distillProgressPercent,
  automationStatus,
  automationStatusLabel,
  automationLastCheckLabel,
  selectedVideoCount,
  pinnedOnly,
  sourceVideosLoading,
  onAddSelectedVideos,
  onPickLocalMedia,
  onTogglePinnedOnly,
  onRefresh,
}: {
  activeSource: BilibiliFollowSource | null
  filteredSourceCount: number
  sourcesLoading: boolean
  distillRequestState: string
  distillProgressPercent: number
  automationStatus: { running: boolean; paused: boolean; enabled: boolean } | null
  automationStatusLabel: string
  automationLastCheckLabel: string
  selectedVideoCount: number
  pinnedOnly: boolean
  sourceVideosLoading: boolean
  onAddSelectedVideos: () => void
  onPickLocalMedia: () => void
  onTogglePinnedOnly: () => void
  onRefresh: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-foreground">
        <img src={settingsBilibiliIcon} alt="" className="size-3.5 opacity-90" />
        <span>视频来源</span>
        <Badge variant="outline" className="border-white/8 bg-white/[0.035] px-2 text-[10px] text-foreground/74">
          {sourcesLoading ? '读取中' : `${filteredSourceCount}`}
        </Badge>
      </div>
      {distillRequestState === 'loading' ? (
        <div className="hidden min-w-[180px] max-w-[360px] flex-1 items-center justify-end gap-2 md:flex">
          <Progress
            value={Math.max(4, Math.min(100, distillProgressPercent || 4))}
            className="h-1 w-full max-w-[300px] bg-white/[0.08]"
          />
          <span className="w-9 text-right text-[10px] font-semibold tabular-nums text-[#dbe4ef]">
            {Math.max(0, Math.min(100, Math.round(distillProgressPercent || 0)))}%
          </span>
        </div>
      ) : automationStatus ? (
        <div className="hidden min-w-[180px] max-w-[360px] flex-1 items-center justify-end gap-2 text-[10px] leading-4 text-muted-foreground md:flex">
          <span
            className={cn(
              'size-1.5 rounded-full',
              automationStatus.running
                ? 'bg-sky-300'
                : automationStatus.paused || !automationStatus.enabled
                  ? 'bg-amber-300'
                  : 'bg-emerald-300',
            )}
          />
          <span className="font-semibold text-foreground/76">{automationStatusLabel}</span>
          <span>{automationLastCheckLabel}</span>
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-1.5">
        {activeSource ? (
          <Button
            type="button"
            size="icon"
            className="relative size-7 rounded-lg"
            onClick={onAddSelectedVideos}
            disabled={selectedVideoCount === 0}
            aria-label="加入队列"
            title="加入队列"
          >
            <ListPlus size={13} />
            {selectedVideoCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full border border-[#1f1f1f] bg-sky-300 px-1 text-[9px] font-semibold leading-4 text-black">
                {selectedVideoCount}
              </span>
            ) : null}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
          onClick={onPickLocalMedia}
          disabled={distillRequestState === 'loading'}
          aria-label="选择本地文件"
          title="选择本地文件"
        >
          <FolderOpen size={13} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          role="switch"
          aria-checked={pinnedOnly}
          className={cn(
            'size-7 rounded-lg hover:bg-white/[0.06]',
            pinnedOnly ? 'text-amber-100' : 'text-foreground/70 hover:text-foreground',
          )}
          onClick={onTogglePinnedOnly}
          aria-label="仅显示收藏"
          title="仅显示收藏"
        >
          <Star size={13} fill={pinnedOnly ? 'currentColor' : 'none'} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-lg text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
          onClick={onRefresh}
          disabled={activeSource ? sourceVideosLoading : sourcesLoading}
          aria-label={activeSource ? '刷新最近视频' : '刷新视频来源'}
          title={activeSource ? '刷新最近视频' : '刷新视频来源'}
        >
          {(activeSource ? sourceVideosLoading : sourcesLoading)
            ? <LoaderCircle size={13} className="animate-spin" />
            : <RefreshCcw size={13} />}
        </Button>
      </div>
    </div>
  )
}

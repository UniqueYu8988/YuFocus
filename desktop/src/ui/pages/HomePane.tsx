import {
  ListPlus,
  Pause,
  Play,
  RefreshCw,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/ui/components/base/badge'
import { Button } from '@/ui/components/base/button'
import { cn } from '@/ui/components/utils'
import { createWorkbenchQueueItem } from '@/ui/pages/WorkspacePaneUtils'
import { WorkspaceShell } from '@/ui/panels/workspace/WorkspaceShell'

type PinnedSource = Awaited<ReturnType<typeof window.desktopAPI.loadPinnedBilibiliSources>>[number]
type VideoPayload = Awaited<ReturnType<typeof window.desktopAPI.listRegisteredBilibiliSourceVideos>>
type QueueItem = Awaited<ReturnType<typeof window.desktopAPI.loadWorkbenchQueue>>[number]
type MaterialInventory = Awaited<ReturnType<typeof window.desktopAPI.listMaterialPackages>>
type AutomationStatus = Awaited<ReturnType<typeof window.desktopAPI.getAutomationStatus>>
type HomeVideo = VideoPayload['sources'][number]['videos'][number] & { sourceMid: string; sourceName: string; sourceFace: string }

type HomePaneSnapshot = {
  pinnedSources: PinnedSource[]
  queueItems: QueueItem[]
  materialInventory: MaterialInventory | null
  videoPayload: VideoPayload | null
  automationStatus: AutomationStatus | null
  cachedAt: number
}

let homePaneSnapshotCache: HomePaneSnapshot | null = null

type HomePaneProps = {
  windowFocused: boolean
  activeSourceId: string
  onActiveSourceChange: (sourceId: string) => void
}

function formatVideoTime(pubdate: number) {
  if (!pubdate) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(pubdate * 1000)
}

function formatUpdatedAt(timestamp: number) {
  if (!timestamp) return '尚未更新'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function formatPauseUntil(timestamp: number | null) {
  if (!timestamp) return '手动恢复'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function formatClockTime(timestamp: number | null | undefined) {
  if (!timestamp) return '待安排'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function compactStatusText(value: string, maxLength = 42) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized
}

function SourceAvatar({ src, name, className = 'size-9 rounded-xl' }: { src: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const canShowAvatar = Boolean(src) && !failed

  return (
    <div className={cn('flex shrink-0 items-center justify-center overflow-hidden bg-white/[0.035] text-foreground/50 ring-1 ring-white/[0.045]', className)}>
      {canShowAvatar ? (
        <img
          src={src}
          alt={`${name || 'UP 主'}头像`}
          className="size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Video size={16} aria-hidden="true" />
      )}
    </div>
  )
}

export function HomePane({ windowFocused, activeSourceId, onActiveSourceChange }: HomePaneProps) {
  const [pinnedSources, setPinnedSources] = useState<PinnedSource[]>(() => homePaneSnapshotCache?.pinnedSources ?? [])
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([])
  const [videoPayload, setVideoPayload] = useState<VideoPayload | null>(() => homePaneSnapshotCache?.videoPayload ?? null)
  const [queueItems, setQueueItems] = useState<QueueItem[]>(() => homePaneSnapshotCache?.queueItems ?? [])
  const [materialInventory, setMaterialInventory] = useState<MaterialInventory | null>(() => homePaneSnapshotCache?.materialInventory ?? null)
  const [loading, setLoading] = useState(() => !homePaneSnapshotCache)
  const [refreshing, setRefreshing] = useState(false)
  const [queueSaving, setQueueSaving] = useState(false)
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(() => homePaneSnapshotCache?.automationStatus ?? null)
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false)
  const [error, setError] = useState('')

  const loadLocalSnapshot = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [sources, queue, materials] = await Promise.all([
        window.desktopAPI.loadPinnedBilibiliSources(),
        window.desktopAPI.loadWorkbenchQueue(),
        window.desktopAPI.listMaterialPackages(),
      ])
      const videos = await window.desktopAPI.listRegisteredBilibiliSourceVideos({
        sources: sources.map((source) => ({ mid: source.mid, name: source.name })),
      })
      setPinnedSources(sources)
      setQueueItems(queue)
      setMaterialInventory(materials)
      setVideoPayload(videos)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取最近数据。')
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadRegisteredVideos = useCallback(async (sources: PinnedSource[]) => {
    const videos = await window.desktopAPI.listRegisteredBilibiliSourceVideos({
      sources: sources.map((source) => ({ mid: source.mid, name: source.name })),
    })
    setVideoPayload(videos)
  }, [])

  useEffect(() => {
    if (homePaneSnapshotCache) {
      setLoading(false)
      return
    }
    void loadLocalSnapshot()
  }, [loadLocalSnapshot])

  useEffect(() => {
    if (!videoPayload && !materialInventory && pinnedSources.length === 0 && queueItems.length === 0 && !automationStatus) return
    homePaneSnapshotCache = {
      pinnedSources,
      queueItems,
      materialInventory,
      videoPayload,
      automationStatus,
      cachedAt: Date.now(),
    }
  }, [automationStatus, materialInventory, pinnedSources, queueItems, videoPayload])

  useEffect(() => {
    if (!activeSourceId || pinnedSources.length === 0) return
    if (!pinnedSources.some((source) => source.mid === activeSourceId)) {
      onActiveSourceChange('')
    }
  }, [activeSourceId, onActiveSourceChange, pinnedSources])

  useEffect(() => {
    let alive = true
    void window.desktopAPI.getAutomationStatus()
      .then((status) => {
        if (alive) setAutomationStatus(status)
      })
      .catch(() => {
        if (alive) setAutomationStatus(null)
      })
    const unsubscribe = window.desktopAPI.onAutomationStatus((status) => {
      setAutomationStatus(status)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    setSelectedVideoIds([])
  }, [activeSourceId])

  useEffect(() => {
    const unsubscribeQueue = window.desktopAPI.onWorkbenchQueueChanged((items) => {
      setQueueItems(items)
    })
    const refreshMaterials = () => {
      void window.desktopAPI.listMaterialPackages()
        .then(setMaterialInventory)
        .catch(() => undefined)
    }
    window.addEventListener('shijie:material-packages-changed', refreshMaterials)
    return () => {
      unsubscribeQueue()
      window.removeEventListener('shijie:material-packages-changed', refreshMaterials)
    }
  }, [])

  useEffect(() => {
    const handlePinnedSourcesChanged = (event: Event) => {
      const detail = (event as CustomEvent<PinnedSource[]>).detail
      if (!Array.isArray(detail)) return
      setPinnedSources(detail)
      if (activeSourceId && !detail.some((source) => source.mid === activeSourceId)) {
        onActiveSourceChange('')
      }
      void reloadRegisteredVideos(detail)
    }

    window.addEventListener('shijie:pinned-bilibili-sources-changed', handlePinnedSourcesChanged)
    return () => window.removeEventListener('shijie:pinned-bilibili-sources-changed', handlePinnedSourcesChanged)
  }, [activeSourceId, onActiveSourceChange, reloadRegisteredVideos])

  const handleRefreshData = async () => {
    if (!pinnedSources.length || refreshing) return
    setRefreshing(true)
    setError('')
    try {
      const [videos, queue, materials] = await Promise.all([
        window.desktopAPI.listBilibiliSourceVideos({
          sources: pinnedSources.map((source) => ({ mid: source.mid, name: source.name })),
          pageSize: 30,
        }),
        window.desktopAPI.loadWorkbenchQueue(),
        window.desktopAPI.listMaterialPackages(),
      ])
      setVideoPayload(videos)
      setQueueItems(queue)
      setMaterialInventory(materials)
      const failedSources = videos.sources.filter((source) => source.error)
      if (failedSources.length === videos.sources.length && failedSources.length > 0) {
        setError('联网更新未完成，当前仍显示本地注册表数据。')
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : '刷新失败，已保留本地数据。')
    } finally {
      setRefreshing(false)
    }
  }

  const handleSetAutomationPause = async (durationMs?: number) => {
    try {
      const status = await window.desktopAPI.setAutomationPaused({ paused: true, durationMs })
      setAutomationStatus(status)
      setPauseMenuOpen(false)
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : '无法暂停同步。')
    }
  }

  const handleResumeAutomation = async () => {
    try {
      const status = await window.desktopAPI.setAutomationPaused({ paused: false })
      setAutomationStatus(status)
      setPauseMenuOpen(false)
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : '无法恢复同步。')
    }
  }

  const handleToggleSourceVideo = (bvid: string) => {
    setSelectedVideoIds((current) =>
      current.includes(bvid) ? current.filter((id) => id !== bvid) : [...current, bvid],
    )
  }

  const handleAddSelectedVideosToQueue = async () => {
    if (queueSaving) return
    const selectedVideos = sourceVideosForActiveSource.filter((video) => selectedVideoIds.includes(video.bvid))
    if (!selectedVideos.length) return
    const existingBvids = new Set(queueItems.map((item) => item.bvid).filter(Boolean))
    const nextItems = selectedVideos
      .filter((video) => !existingBvids.has(video.bvid) && !materialBvids.has(video.bvid))
      .map((video) => createWorkbenchQueueItem(video, 'queued', {
        queueSource: 'follow_source',
        editorialMode: 'off',
        pipelineMode: 'subtitle_only',
      }))

    if (!nextItems.length) {
      setError('选中的视频已经在队列中，或已有资料。')
      setSelectedVideoIds([])
      return
    }

    setQueueSaving(true)
    setError('')
    try {
      const saved = await window.desktopAPI.saveWorkbenchQueue([...queueItems, ...nextItems])
      setQueueItems(saved)
      setSelectedVideoIds([])
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '加入队列失败。')
    } finally {
      setQueueSaving(false)
    }
  }

  const recentVideos = useMemo(() => {
    const byBvid = new Map<string, HomeVideo>()
    const sourceFaces = new Map(pinnedSources.map((source) => [source.mid, source.face]))
    for (const source of videoPayload?.sources ?? []) {
      for (const video of source.videos) {
        const existing = byBvid.get(video.bvid)
        if (!existing || video.pubdate > existing.pubdate) {
          byBvid.set(video.bvid, {
            ...video,
            sourceMid: source.mid,
            sourceName: source.name,
            sourceFace: sourceFaces.get(source.mid) ?? '',
          })
        }
      }
    }
    return Array.from(byBvid.values())
      .sort((left, right) => (right.pubdate || 0) - (left.pubdate || 0))
      .slice(0, 8)
  }, [pinnedSources, videoPayload?.sources])
  const activeSource = useMemo(
    () => pinnedSources.find((source) => source.mid === activeSourceId) ?? null,
    [activeSourceId, pinnedSources],
  )
  const sourceVideosForActiveSource = useMemo(() => {
    if (!activeSourceId) return []
    const source = videoPayload?.sources.find((item) => item.mid === activeSourceId)
    const sourceFace = pinnedSources.find((item) => item.mid === activeSourceId)?.face ?? ''
    return (source?.videos ?? []).map((video) => ({
      ...video,
      sourceMid: source?.mid ?? activeSourceId,
      sourceName: source?.name ?? activeSource?.name ?? '当前 UP',
      sourceFace,
    }))
  }, [activeSource?.name, activeSourceId, pinnedSources, videoPayload?.sources])
  const queueByBvid = useMemo(
    () => new Map(queueItems.filter((item) => item.bvid).map((item) => [item.bvid, item])),
    [queueItems],
  )
  const materialBvids = useMemo(
    () => new Set((materialInventory?.records ?? []).map((record) => record.sourceId).filter(Boolean)),
    [materialInventory?.records],
  )
  const selectedQueueableCount = sourceVideosForActiveSource
    .filter((video) => selectedVideoIds.includes(video.bvid) && !queueByBvid.has(video.bvid) && !materialBvids.has(video.bvid))
    .length
  const visibleVideos = activeSource ? sourceVideosForActiveSource : recentVideos
  const processingQueueItem = useMemo(
    () => queueItems.find((item) => item.status === 'processing') ?? null,
    [queueItems],
  )
  const queuedCount = useMemo(
    () => queueItems.filter((item) => item.status === 'queued').length,
    [queueItems],
  )
  const automationLiveStatus = useMemo(() => {
    if (automationStatus?.paused) {
      return {
        tone: 'paused',
        label: `同步已暂停 · ${formatPauseUntil(automationStatus.pausedUntil)}`,
      }
    }
    if (processingQueueItem) {
      return {
        tone: 'running',
        label: `正在处理：${compactStatusText(processingQueueItem.title || processingQueueItem.bvid || '未命名视频')}`,
      }
    }
    if (automationStatus?.running) {
      return {
        tone: 'running',
        label: '正在同步：检查更新或准备下一条任务',
      }
    }
    if (queuedCount > 0) {
      return {
        tone: 'waiting',
        label: `后台待处理：${queuedCount} 条，空闲时会按顺序继续`,
      }
    }
    if (automationStatus?.lastError) {
      return {
        tone: 'error',
        label: `同步异常：${compactStatusText(automationStatus.lastError, 36)}`,
      }
    }
    if (automationStatus?.enabled) {
      return {
        tone: 'idle',
        label: `后台运行 · 下次检查 ${formatClockTime(automationStatus.nextCheckAt)}`,
      }
    }
    return {
      tone: 'off',
      label: '后台同步未启用',
    }
  }, [automationStatus, processingQueueItem, queuedCount])

  return (
    <WorkspaceShell
      eyebrow="Overview"
      title={activeSource ? activeSource.name : '最近'}
      windowFocused={windowFocused}
      actions={(
        <div className="flex items-center gap-2">
          {activeSource ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-xl text-[11px]"
              disabled={!selectedQueueableCount || queueSaving}
              onClick={() => void handleAddSelectedVideosToQueue()}
            >
              <ListPlus size={13} />
              {queueSaving ? '正在加入' : selectedQueueableCount ? `加入队列 ${selectedQueueableCount}` : '加入队列'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full text-foreground/62 hover:bg-white/[0.055] hover:text-foreground"
            disabled={loading || refreshing || pinnedSources.length === 0}
            onClick={() => void handleRefreshData()}
            aria-label={refreshing ? '正在刷新视频元数据' : '刷新视频元数据'}
            title="刷新视频元数据，不会下载或转写"
          >
            <RefreshCw size={15} className={cn(refreshing && 'animate-spin')} />
          </Button>
          <div className="relative">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'size-9 rounded-full text-foreground/62 hover:bg-white/[0.055] hover:text-foreground',
                automationStatus?.paused && 'bg-amber-300/[0.08] text-amber-100',
              )}
              onClick={() => setPauseMenuOpen((open) => !open)}
              aria-label={automationStatus?.paused ? '同步已暂停，点击管理' : '暂停同步'}
              title={automationStatus?.paused ? `同步已暂停至：${formatPauseUntil(automationStatus.pausedUntil)}` : '暂停同步'}
            >
              {automationStatus?.paused ? <Play size={15} /> : <Pause size={15} />}
            </Button>
            {pauseMenuOpen ? (
              <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111318] p-1.5 shadow-2xl shadow-black/35">
                <div className="px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                  {automationStatus?.paused ? `已暂停：${formatPauseUntil(automationStatus.pausedUntil)}` : '暂停后当前视频会完成，不再领取下一条。'}
                </div>
                <button type="button" className="w-full rounded-xl px-2 py-1.5 text-left text-[11px] text-foreground/82 hover:bg-white/[0.055]" onClick={() => void handleSetAutomationPause(2 * 60 * 60 * 1000)}>
                  暂停 2 小时
                </button>
                <button type="button" className="w-full rounded-xl px-2 py-1.5 text-left text-[11px] text-foreground/82 hover:bg-white/[0.055]" onClick={() => void handleSetAutomationPause(5 * 60 * 60 * 1000)}>
                  暂停 5 小时
                </button>
                <button type="button" className="w-full rounded-xl px-2 py-1.5 text-left text-[11px] text-foreground/82 hover:bg-white/[0.055]" onClick={() => void handleSetAutomationPause()}>
                  暂停到手动恢复
                </button>
                {automationStatus?.paused ? (
                  <button type="button" className="mt-1 w-full rounded-xl bg-emerald-300/[0.09] px-2 py-1.5 text-left text-[11px] text-emerald-100 hover:bg-emerald-300/[0.14]" onClick={() => void handleResumeAutomation()}>
                    恢复同步
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}
    >
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <section className="overflow-hidden rounded-2xl border border-white/[0.055] bg-white/[0.018]">
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {activeSource ? (
                <SourceAvatar src={activeSource.face} name={activeSource.name} className="size-10 rounded-full" />
              ) : null}
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {activeSource ? `${activeSource.name}的视频` : '最近视频'}
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  最近更新：{formatUpdatedAt(videoPayload?.fetchedAt ?? 0)}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0 border-white/[0.08] bg-black/15 text-foreground/65">
              仅元数据
            </Badge>
          </div>
          <div
            className={cn(
              'flex items-center justify-between gap-3 border-b border-white/[0.045] px-4 py-2 text-[11px]',
              automationLiveStatus.tone === 'running' && 'bg-sky-300/[0.045] text-sky-100/85',
              automationLiveStatus.tone === 'paused' && 'bg-amber-300/[0.05] text-amber-100/85',
              automationLiveStatus.tone === 'waiting' && 'bg-white/[0.018] text-foreground/70',
              automationLiveStatus.tone === 'error' && 'bg-rose-300/[0.05] text-rose-100/85',
              (automationLiveStatus.tone === 'idle' || automationLiveStatus.tone === 'off') && 'bg-white/[0.012] text-muted-foreground',
            )}
            role="status"
            aria-live="polite"
            data-automation-live-status="true"
          >
            <span className="truncate">{automationLiveStatus.label}</span>
            {automationStatus?.lastResult && !processingQueueItem ? (
              <span className="hidden max-w-[42%] truncate text-foreground/38 md:inline">
                {compactStatusText(automationStatus.lastResult, 32)}
              </span>
            ) : null}
          </div>

          <div className="min-h-[420px]">
            {loading ? (
              <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
                正在读取本地数据…
              </div>
            ) : activeSource && visibleVideos.length === 0 ? (
              <div className="flex h-[420px] flex-col items-center justify-center gap-2 px-6 text-center">
                <SourceAvatar src={activeSource.face} name={activeSource.name} className="size-12 rounded-full" />
                <p className="text-sm font-medium text-foreground/80">{activeSource.name} 还没有本地视频数据</p>
                <p className="max-w-md text-xs leading-5 text-muted-foreground">
                  点击右上角刷新图标后，只会刷新视频标题、BV 号和发布时间，不会下载或转写。
                </p>
              </div>
            ) : !activeSource && visibleVideos.length === 0 ? (
              <div className="flex h-[420px] flex-col items-center justify-center gap-2 px-6 text-center">
                <Video size={24} className="text-foreground/35" />
                <p className="text-sm font-medium text-foreground/80">还没有本地视频数据</p>
                <p className="max-w-md text-xs leading-5 text-muted-foreground">
                  在左侧固定 UP 后点击右上角刷新图标，这里只会保存标题、BV 号和发布时间。
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.045]">
                {visibleVideos.map((video) => {
                  const queueItem = queueByBvid.get(video.bvid)
                  const hasMaterial = materialBvids.has(video.bvid)
                  const selected = selectedVideoIds.includes(video.bvid)
                  const selectable = activeSource ? !hasMaterial && !queueItem : false
                  const status = hasMaterial
                    ? '已有资料'
                    : queueItem?.status === 'processing'
                      ? '处理中'
                      : queueItem?.status === 'queued'
                        ? '等待中'
                        : queueItem?.status === 'failed'
                          ? '处理失败'
                          : queueItem?.status === 'skipped'
                            ? '已跳过'
                          : queueItem?.status === 'done'
                            ? '已处理'
                            : '未入队'
                  return (
                    <li key={video.bvid} className="flex items-center gap-3 px-4 py-3">
                      {activeSource ? (
                        <button
                          type="button"
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-lg border text-[11px] transition-colors',
                            selected
                              ? 'border-sky-300/35 bg-sky-300/[0.11] text-sky-100'
                              : 'border-white/[0.07] bg-white/[0.02] text-foreground/45 hover:bg-white/[0.055] hover:text-foreground/80',
                            !selectable && 'cursor-not-allowed opacity-35 hover:bg-white/[0.02] hover:text-foreground/45',
                          )}
                          disabled={!selectable}
                          onClick={() => handleToggleSourceVideo(video.bvid)}
                          aria-pressed={selected}
                          aria-label={selected ? '取消选择视频' : '选择视频加入队列'}
                          title={selectable ? '选择后可加入队列' : '已在队列中或已有资料'}
                        >
                          {selected ? '✓' : '+'}
                        </button>
                      ) : null}
                      <SourceAvatar src={video.sourceFace} name={video.sourceName || video.authorName} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-foreground">{video.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
                          <span>{video.sourceName}</span>
                          <span>{video.durationText || '--:--'}</span>
                          <span>{formatVideoTime(video.pubdate)}</span>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 border-white/[0.07] bg-black/12 text-[10px] text-foreground/55',
                          hasMaterial && 'border-emerald-400/20 text-emerald-300/80',
                          queueItem?.status === 'processing' && 'border-sky-400/20 text-sky-300/80',
                        )}
                      >
                        {status}
                      </Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <div className="min-h-5 text-center text-xs text-muted-foreground" role="status" aria-live="polite">
          {error || (refreshing ? '正在向 B 站请求最新视频信息，不会下载视频。' : '')}
        </div>
      </div>
    </WorkspaceShell>
  )
}

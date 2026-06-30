import {
  Archive,
  ChevronDown,
  ChevronUp,
  Folder,
  Home,
  ListChecks,
  RefreshCw,
  Route,
  Search,
  Settings,
  Settings2,
  Star,
  Video,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge } from '@/ui/components/base/badge'
import { Button } from '@/ui/components/base/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/base/dialog'
import { Input } from '@/ui/components/base/input'
import { cn } from '@/ui/components/utils'
import { useLearningStore } from '@/state/store'
import type { WorkspaceView } from '@/ui/pages/WorkspacePane'

type SourceSidebarPaneProps = {
  workspaceView: WorkspaceView
  onSelectView: (view: WorkspaceView) => void
  activeBilibiliSourceId: string
  onSelectRecent: () => void
  onSelectBilibiliSource: (sourceId: string) => void
  sidebarWidth: number
  windowFocused: boolean
}

type PinnedBilibiliSource = Awaited<ReturnType<typeof window.desktopAPI.loadPinnedBilibiliSources>>[number]
type TrackedBilibiliSource = Awaited<ReturnType<typeof window.desktopAPI.loadTrackedBilibiliSources>>[number]
type FollowSource = Awaited<ReturnType<typeof window.desktopAPI.listBilibiliFollowSources>>['items'][number]
type MaterialInventory = Awaited<ReturnType<typeof window.desktopAPI.listMaterialPackages>>
type MaterialInventoryRecord = MaterialInventory['records'][number]

type SourceLibraryFolder = {
  id: string
  title: string
  count: number
  kind: 'creator' | 'misc'
  records: MaterialInventoryRecord[]
  creator?: string
  pinnedCreatorNames?: string[]
}

function collectStudyDescendants(nodeId: string, nodeMap: ReturnType<typeof useLearningStore.getState>['nodeMap']) {
  const collected: string[] = []
  const stack = [nodeId]

  while (stack.length > 0) {
    const currentId = stack.pop()
    if (!currentId) continue
    const currentNode = nodeMap[currentId]
    if (!currentNode) continue

    if (currentNode.childIds.length === 0) {
      collected.push(currentId)
      continue
    }

    stack.push(...currentNode.childIds)
  }

  return collected
}

function NavEntry({
  icon,
  title,
  active,
  trailing,
  onClick,
}: {
  icon: ReactNode
  title: string
  active: boolean
  trailing?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors duration-150',
        active
          ? 'bg-white/[0.038] text-[#f4f7fb]'
          : 'text-[#aab2bd] hover:bg-white/[0.038] hover:text-[#edf1f6]',
      )}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center transition-colors',
          active ? 'text-[#f1f5fb]' : 'text-[#b6bec9] group-hover:text-[#f0f4fa]',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-4">{title}</span>
      {trailing}
    </button>
  )
}

function SourceAvatar({ src, name, className = 'size-7 rounded-full' }: { src: string; name: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const canShowAvatar = Boolean(src) && !failed

  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden bg-white/[0.035] text-foreground/50 ring-1 ring-white/[0.045]', className)}>
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
        <Video size={12} aria-hidden="true" />
      )}
    </span>
  )
}

function orderPinnedSourcesByTracking(
  pinnedSources: PinnedBilibiliSource[],
  trackedSources: TrackedBilibiliSource[],
) {
  const priorityByMid = new Map(trackedSources.map((source) => [source.mid, source.priority]))
  return [...pinnedSources].sort((left, right) => {
    const leftPriority = priorityByMid.get(left.mid) ?? Number.MAX_SAFE_INTEGER
    const rightPriority = priorityByMid.get(right.mid) ?? Number.MAX_SAFE_INTEGER
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    return right.pinnedAt - left.pinnedAt
  })
}

function normalizeSourceName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

function materialRecordHasLibraryOutput(record: MaterialInventoryRecord) {
  return (
    record.editorialSummaryExists ||
    record.notebooklmExists ||
    record.rawTranscriptExists
  )
}

function getSourceMaterialReadPath(record: MaterialInventoryRecord) {
  if (record.editorialSummaryExists && record.editorialSummaryPath) return record.editorialSummaryPath
  if (record.notebooklmExists && record.notebooklmPath) return record.notebooklmPath
  if (record.rawTranscriptExists && record.rawTranscriptPath) return record.rawTranscriptPath
  return ''
}

function getSourceMaterialReadHtmlPath(record: MaterialInventoryRecord) {
  if (record.editorialSummaryHtmlExists && record.editorialSummaryHtmlPath) return record.editorialSummaryHtmlPath
  return ''
}

function getSourceMaterialReadLabel(record: MaterialInventoryRecord) {
  if (record.editorialSummaryExists) return '精读稿'
  if (record.notebooklmExists) return '清洗稿'
  if (record.rawTranscriptExists) return '字幕'
  return '资料'
}

function normalizePathForCompare(value: string) {
  return value.replace(/\\/g, '/').toLocaleLowerCase('zh-CN')
}

function recordMatchesActiveCourse(record: MaterialInventoryRecord, courseData: ReturnType<typeof useLearningStore.getState>['courseData']) {
  if (!courseData) return false
  const activeSourceId = courseData.source?.source_id ?? ''
  const activeSourceUrl = courseData.source?.url ?? ''
  const activeNotes = courseData.source?.notes ?? ''
  if (activeSourceId && record.sourceId && activeSourceId === record.sourceId) return true
  if (activeSourceUrl && record.sourceUrl && activeSourceUrl === record.sourceUrl) return true
  if (activeNotes && record.path && normalizePathForCompare(activeNotes).includes(normalizePathForCompare(record.path))) return true
  return false
}

function materialRecordMatchesSource(record: MaterialInventoryRecord, source: PinnedBilibiliSource) {
  const recordCreator = normalizeSourceName(record.creator || '')
  const sourceName = normalizeSourceName(source.name || '')
  return Boolean(recordCreator && sourceName && recordCreator === sourceName)
}

function FolderHint({
  title,
  count,
  muted,
  expanded,
  active,
  onClick,
}: {
  title: string
  count?: number
  muted?: boolean
  expanded?: boolean
  active?: boolean
  onClick?: () => void
}) {
  const className = cn(
    'flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[11px] font-medium leading-[16px] transition-colors',
    muted ? 'text-[#7f8996]' : 'text-[#c9d2de]',
    active && 'bg-white/[0.038] text-[#f4f7fb]',
    onClick && 'hover:bg-white/[0.035] hover:text-[#edf1f6]',
  )
  const content = (
    <>
      <Folder size={13} strokeWidth={1.9} className="shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {typeof count === 'number' ? (
        <span className="shrink-0 rounded-full bg-black/18 px-1.5 text-[10px] font-semibold leading-4 text-[#aab2bd]">
          {count}
        </span>
      ) : null}
      <ChevronDown
        size={12}
        className={cn('shrink-0 text-[#8d96a2] transition-transform duration-200', expanded && 'rotate-180 text-[#d7dee8]')}
      />
    </>
  )

  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  )
}

export function SourceSidebarPane({
  workspaceView,
  onSelectView,
  activeBilibiliSourceId,
  onSelectRecent,
  onSelectBilibiliSource,
  sidebarWidth,
  windowFocused: _windowFocused,
}: SourceSidebarPaneProps) {
  const courseData = useLearningStore((state) => state.courseData)
  const rootNodeIds = useLearningStore((state) => state.rootNodeIds)
  const nodeMap = useLearningStore((state) => state.nodeMap)
  const orderedStudyNodeIds = useLearningStore((state) => state.orderedStudyNodeIds)
  const completedNodeIds = useLearningStore((state) => state.completedNodeIds)
  const libraryRecords = useLearningStore((state) => state.libraryRecords)
  const isNodeUnlocked = useLearningStore((state) => state.isNodeUnlocked)
  const [pinnedBilibiliSources, setPinnedBilibiliSources] = useState<PinnedBilibiliSource[]>([])
  const [trackedBilibiliSources, setTrackedBilibiliSources] = useState<TrackedBilibiliSource[]>([])
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
  const [followSources, setFollowSources] = useState<FollowSource[]>([])
  const [followSourcesLoading, setFollowSourcesLoading] = useState(false)
  const [followSourcesError, setFollowSourcesError] = useState('')
  const [followSourceQuery, setFollowSourceQuery] = useState('')
  const [materialInventory, setMaterialInventory] = useState<MaterialInventory | null>(null)
  const [expandedSourceLibraryFolderId, setExpandedSourceLibraryFolderId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const loadPinnedSources = () => {
      void Promise.all([
        window.desktopAPI.loadPinnedBilibiliSources(),
        window.desktopAPI.loadTrackedBilibiliSources(),
      ])
        .then(([pinnedItems, trackedItems]) => {
          if (!alive) return
          setPinnedBilibiliSources(pinnedItems)
          setTrackedBilibiliSources(trackedItems)
        })
        .catch(() => {
          if (!alive) return
          setPinnedBilibiliSources([])
          setTrackedBilibiliSources([])
        })
    }
    const handlePinnedSourcesChanged = (event: Event) => {
      const detail = (event as CustomEvent<PinnedBilibiliSource[]>).detail
      if (Array.isArray(detail)) {
        setPinnedBilibiliSources(detail)
        void window.desktopAPI.loadTrackedBilibiliSources()
          .then((items) => {
            if (alive) setTrackedBilibiliSources(items)
          })
          .catch(() => {
            if (alive) setTrackedBilibiliSources([])
          })
        return
      }
      loadPinnedSources()
    }

    loadPinnedSources()
    window.addEventListener('shijie:pinned-bilibili-sources-changed', handlePinnedSourcesChanged)
    return () => {
      alive = false
      window.removeEventListener('shijie:pinned-bilibili-sources-changed', handlePinnedSourcesChanged)
    }
  }, [])

  useEffect(() => {
    let alive = true
    const loadMaterialInventory = () => {
      void window.desktopAPI.listMaterialPackages()
        .then((result) => {
          if (alive) setMaterialInventory(result)
        })
        .catch(() => {
          if (alive) setMaterialInventory(null)
        })
    }

    loadMaterialInventory()
    window.addEventListener('focus', loadMaterialInventory)
    window.addEventListener('shijie:material-packages-changed', loadMaterialInventory)
    return () => {
      alive = false
      window.removeEventListener('focus', loadMaterialInventory)
      window.removeEventListener('shijie:material-packages-changed', loadMaterialInventory)
    }
  }, [])

  const refreshFollowSources = async () => {
    setFollowSourcesLoading(true)
    setFollowSourcesError('')
    try {
      const result = await window.desktopAPI.listBilibiliFollowSources()
      setFollowSources(result.items)
      if (!result.authenticated) {
        setFollowSourcesError(result.message || 'B 站登录状态不可用。')
      }
    } catch (sourceError) {
      setFollowSourcesError(sourceError instanceof Error ? sourceError.message : '无法读取关注来源。')
    } finally {
      setFollowSourcesLoading(false)
    }
  }

  const handleSourceDialogOpenChange = (open: boolean) => {
    setSourceDialogOpen(open)
    if (open && followSources.length === 0 && !followSourcesLoading) {
      void refreshFollowSources()
    }
  }

  const handleTogglePinnedSource = async (source: FollowSource) => {
    const alreadyPinned = pinnedBilibiliSources.some((item) => item.mid === source.mid)
    const nextPinned = alreadyPinned
      ? pinnedBilibiliSources.filter((item) => item.mid !== source.mid)
      : [
          {
            mid: source.mid,
            name: source.name,
            face: source.face,
            sign: source.sign,
            officialTitle: source.officialTitle,
            pinnedAt: Date.now(),
          },
          ...pinnedBilibiliSources.filter((item) => item.mid !== source.mid),
        ].slice(0, 24)

    try {
      const saved = await window.desktopAPI.savePinnedBilibiliSources(nextPinned)
      const tracked = await window.desktopAPI.loadTrackedBilibiliSources()
      setPinnedBilibiliSources(saved)
      setTrackedBilibiliSources(tracked)
      if (activeBilibiliSourceId && !saved.some((item) => item.mid === activeBilibiliSourceId)) {
        onSelectRecent()
      }
      window.dispatchEvent(new CustomEvent('shijie:pinned-bilibili-sources-changed', { detail: saved }))
    } catch (saveError) {
      setFollowSourcesError(saveError instanceof Error ? saveError.message : '无法保存固定 UP。')
    }
  }

  const orderedPinnedBilibiliSources = useMemo(
    () => orderPinnedSourcesByTracking(pinnedBilibiliSources, trackedBilibiliSources),
    [pinnedBilibiliSources, trackedBilibiliSources],
  )

  const handleMovePinnedSource = async (sourceId: string, direction: -1 | 1) => {
    const currentIndex = orderedPinnedBilibiliSources.findIndex((source) => source.mid === sourceId)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedPinnedBilibiliSources.length) return

    const reordered = [...orderedPinnedBilibiliSources]
    const [moved] = reordered.splice(currentIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    const trackedByMid = new Map(trackedBilibiliSources.map((source) => [source.mid, source]))
    const now = Date.now()
    const nextTracked = reordered.map((source, index) => {
      const existing = trackedByMid.get(source.mid)
      return {
        ...source,
        priority: index,
        trackFresh: existing?.trackFresh ?? true,
        trackHistory: existing?.trackHistory ?? true,
        historyStatus: existing?.historyStatus ?? 'idle',
        historyPage: existing?.historyPage ?? 0,
        historyReachedEnd: existing?.historyReachedEnd ?? false,
        lastCheckedAt: existing?.lastCheckedAt ?? 0,
        updatedAt: now,
      }
    })

    try {
      const saved = await window.desktopAPI.saveTrackedBilibiliSources(nextTracked)
      setTrackedBilibiliSources(saved)
    } catch (saveError) {
      setFollowSourcesError(saveError instanceof Error ? saveError.message : '无法保存 UP 优先级。')
    }
  }

  const unlockedStudyCount = orderedStudyNodeIds.filter((nodeId) => isNodeUnlocked(nodeId)).length
  const activeLibraryCount = libraryRecords.filter((record) => !record.isArchived).length
  const archivedLibraryCount = libraryRecords.filter((record) => record.isArchived).length
  const stageSegments = rootNodeIds.map((rootNodeId) => {
    const studyNodeIds = collectStudyDescendants(rootNodeId, nodeMap)
    const total = studyNodeIds.length
    const completed = studyNodeIds.filter((nodeId) => completedNodeIds.includes(nodeId)).length
    const unlocked = studyNodeIds.filter((nodeId) => isNodeUnlocked(nodeId)).length
    const completionRatio = total > 0 ? completed / total : 0
    const unlockedRatio = total > 0 ? unlocked / total : 0
    return {
      id: rootNodeId,
      completionRatio,
      unlockedRatio,
    }
  })
  const completedStageCount = stageSegments.filter((segment) => segment.completionRatio >= 1).length
  const progress =
    orderedStudyNodeIds.length > 0 ? Math.round((completedNodeIds.length / orderedStudyNodeIds.length) * 100) : 0
  const sourceLibraryFolders = useMemo<SourceLibraryFolder[]>(() => {
    const materialRecords = (materialInventory?.records ?? []).filter(materialRecordHasLibraryOutput)
    const pinnedCreatorNames = orderedPinnedBilibiliSources.map((source) => source.name).filter(Boolean)
    const pinnedFolders = orderedPinnedBilibiliSources
      .map((source) => {
        const records = materialRecords
          .filter((record) => materialRecordMatchesSource(record, source))
          .sort((left, right) => right.updatedAt - left.updatedAt)
        return {
          id: `creator:${source.mid}`,
          title: source.name,
          kind: 'creator' as const,
          creator: source.name,
          records,
          count: records.length,
        }
      })
      .filter((folder) => folder.count > 0)

    const miscRecords = materialRecords
      .filter((record) => !orderedPinnedBilibiliSources.some((source) => materialRecordMatchesSource(record, source)))
      .sort((left, right) => right.updatedAt - left.updatedAt)
    const miscFolder = miscRecords.length > 0
      ? [{
          id: 'misc',
          title: '拾遗',
          kind: 'misc' as const,
          count: miscRecords.length,
          records: miscRecords,
          pinnedCreatorNames,
        }]
      : []

    return [...pinnedFolders, ...miscFolder]
  }, [materialInventory?.records, orderedPinnedBilibiliSources])
  const activeSourceLibraryFolderId = useMemo(() => {
    if (!courseData) return null
    return sourceLibraryFolders.find((folder) =>
      folder.records.some((record) => recordMatchesActiveCourse(record, courseData)),
    )?.id ?? null
  }, [courseData, sourceLibraryFolders])
  const pinnedSourceIds = useMemo(() => new Set(pinnedBilibiliSources.map((source) => source.mid)), [pinnedBilibiliSources])
  const filteredFollowSources = useMemo(() => {
    const query = followSourceQuery.trim().toLowerCase()
    if (!query) return followSources
    return followSources.filter((source) =>
      source.name.toLowerCase().includes(query) ||
      source.mid.includes(query),
    )
  }, [followSourceQuery, followSources])

  useEffect(() => {
    if (activeSourceLibraryFolderId) {
      setExpandedSourceLibraryFolderId(activeSourceLibraryFolderId)
    }
  }, [activeSourceLibraryFolderId])

  const handleOpenSourceLibraryFolder = (folder: SourceLibraryFolder) => {
    setExpandedSourceLibraryFolderId((current) => current === folder.id ? null : folder.id)
    window.dispatchEvent(new CustomEvent('shijie:knowledge-source-filter', { detail: folder }))
  }

  return (
    <>
    <aside className="flex h-full shrink-0 flex-col bg-transparent px-2 pb-2 pt-1.5" style={{ width: sidebarWidth }}>
      <div className="space-y-1.5">
        <nav className="space-y-0.5 py-0.5">
          <NavEntry
            icon={<Home size={14} strokeWidth={2} />}
            title="最近"
            active={workspaceView === 'home' && !activeBilibiliSourceId}
            onClick={onSelectRecent}
          />
          <NavEntry
            icon={<ListChecks size={14} strokeWidth={2} />}
            title="队列"
            active={workspaceView === 'workbench'}
            onClick={() => onSelectView('workbench')}
          />
          <NavEntry
            icon={<Archive size={14} strokeWidth={2} />}
            title="档案"
            active={workspaceView === 'archive'}
            trailing={
              <Badge variant="outline" className="h-4 border-white/0 bg-black/18 px-1.5 text-[9px] text-foreground/74">
                {materialInventory?.records.filter(materialRecordHasLibraryOutput).length ?? 0}
              </Badge>
            }
            onClick={() => onSelectView('archive')}
          />
        </nav>
      </div>

      <div className="mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden pt-2">
        <div className="flex items-center justify-between gap-1.5 px-1 pb-1.5">
          <div className="text-[11px] font-semibold leading-4 text-[#aab2bd]">视频来源</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 rounded-lg text-[#aab2bd] hover:bg-white/[0.045] hover:text-[#edf1f6]"
            onClick={() => handleSourceDialogOpenChange(true)}
            aria-label="管理固定 UP"
            title="管理固定 UP"
          >
            <Settings2 size={13} />
          </Button>
        </div>

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-0.5 pr-0">
          <div className="space-y-0.5 px-0.5 pb-2">
            {pinnedBilibiliSources.length === 0 ? (
              <button
                type="button"
                className="w-full rounded-[10px] border border-white/[0.055] bg-white/[0.018] px-2.5 py-2 text-left text-[10px] leading-4 text-muted-foreground hover:bg-white/[0.035]"
                onClick={() => handleSourceDialogOpenChange(true)}
              >
                还没有固定 UP，点击这里设置。
              </button>
            ) : orderedPinnedBilibiliSources.map((source, index) => (
              <div
                key={source.mid}
                className={cn(
                  'group flex w-full items-center gap-1.5 rounded-[10px] px-1.5 py-1.5 text-left transition-colors duration-150',
                  workspaceView === 'home' && activeBilibiliSourceId === source.mid
                    ? 'bg-sky-300/[0.08] text-sky-100 ring-1 ring-sky-300/20'
                    : 'text-[#aab2bd] hover:bg-white/[0.038] hover:text-[#edf1f6]',
                )}
                title={source.name}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-0.5 text-left"
                  onClick={() => onSelectBilibiliSource(source.mid)}
                >
                  <SourceAvatar src={source.face} name={source.name} />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-4">{source.name}</span>
                </button>
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded-md text-[#9aa4b2] hover:bg-white/[0.06] hover:text-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => void handleMovePinnedSource(source.mid, -1)}
                    aria-label={`提高 ${source.name} 的历史补足优先级`}
                    title="提高优先级"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    type="button"
                    className="flex size-5 items-center justify-center rounded-md text-[#9aa4b2] hover:bg-white/[0.06] hover:text-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-30"
                    disabled={index === orderedPinnedBilibiliSources.length - 1}
                    onClick={() => void handleMovePinnedSource(source.mid, 1)}
                    aria-label={`降低 ${source.name} 的历史补足优先级`}
                    title="降低优先级"
                  >
                    <ChevronDown size={12} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-1.5 pt-1.5">
        <NavEntry
          icon={<Route size={14} strokeWidth={2} />}
          title="流程"
          active={workspaceView === 'workflow'}
          onClick={() => onSelectView('workflow')}
        />
        <NavEntry
          icon={<Settings size={14} strokeWidth={2} />}
          title="设置"
          active={workspaceView === 'settings'}
          onClick={() => onSelectView('settings')}
        />
      </div>
    </aside>
    <Dialog open={sourceDialogOpen} onOpenChange={handleSourceDialogOpenChange}>
      <DialogContent className="max-h-[82vh] w-[min(92vw,760px)] overflow-hidden rounded-3xl border-white/8 bg-[#101115] p-0">
        <DialogHeader className="border-b border-white/[0.06] px-5 py-4">
          <DialogTitle className="text-base">管理固定 UP</DialogTitle>
          <DialogDescription className="text-xs">
            从当前 B 站关注中选择要固定到侧边栏的 UP。这里只保存订阅来源，不会加入队列。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={followSourceQuery}
                onChange={(event) => setFollowSourceQuery(event.target.value)}
                placeholder="搜索 UP 名称或 MID"
                className="h-9 pl-9 text-[12px]"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl"
              disabled={followSourcesLoading}
              onClick={() => void refreshFollowSources()}
            >
              <RefreshCw size={13} className={cn(followSourcesLoading && 'animate-spin')} />
              刷新关注
            </Button>
          </div>

          {followSourcesError ? (
            <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-[12px] leading-5 text-amber-100/80">
              {followSourcesError}
            </div>
          ) : null}

          <div className="max-h-[52vh] overflow-y-auto pr-1">
            {followSourcesLoading && followSources.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">正在读取关注来源…</div>
            ) : filteredFollowSources.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {followSourceQuery ? '没有匹配的 UP。' : '还没有读取到关注来源。'}
              </div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {filteredFollowSources.map((source) => {
                  const pinned = pinnedSourceIds.has(source.mid)
                  return (
                    <li key={source.mid}>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors',
                          pinned
                            ? 'border-amber-300/24 bg-amber-300/[0.07]'
                            : 'border-white/[0.055] bg-white/[0.018] hover:bg-white/[0.045]',
                        )}
                        onClick={() => void handleTogglePinnedSource(source)}
                      >
                        <SourceAvatar src={source.face} name={source.name} className="size-10 rounded-full" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-foreground">{source.name}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">MID {source.mid}</span>
                        </span>
                        <Star
                          size={16}
                          className={pinned ? 'text-amber-200' : 'text-foreground/35'}
                          fill={pinned ? 'currentColor' : 'none'}
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

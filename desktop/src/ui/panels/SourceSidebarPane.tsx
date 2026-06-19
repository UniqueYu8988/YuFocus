import {
  Archive,
  ChevronDown,
  Folder,
  ListChecks,
  Route,
  Settings,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge } from '@/ui/components/base/badge'
import { cn } from '@/ui/components/utils'
import { useLearningStore } from '@/state/store'
import type { WorkspaceView } from '@/ui/pages/WorkspacePane'

type SourceSidebarPaneProps = {
  workspaceView: WorkspaceView
  onSelectView: (view: WorkspaceView) => void
  sidebarWidth: number
  windowFocused: boolean
}

type PinnedBilibiliSource = Awaited<ReturnType<typeof window.desktopAPI.loadPinnedBilibiliSources>>[number]
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
        'group flex w-full items-center gap-2.5 rounded-[11px] px-2.5 py-1.5 text-left transition-colors duration-150',
        active
          ? 'bg-white/[0.038] text-[#f4f7fb]'
          : 'text-[#aab2bd] hover:bg-white/[0.038] hover:text-[#edf1f6]',
      )}
    >
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center transition-colors',
          active ? 'text-[#f1f5fb]' : 'text-[#b6bec9] group-hover:text-[#f0f4fa]',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-[18px]">{title}</span>
      {trailing}
    </button>
  )
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

export function SourceSidebarPane({ workspaceView, onSelectView, sidebarWidth, windowFocused: _windowFocused }: SourceSidebarPaneProps) {
  const courseData = useLearningStore((state) => state.courseData)
  const rootNodeIds = useLearningStore((state) => state.rootNodeIds)
  const nodeMap = useLearningStore((state) => state.nodeMap)
  const orderedStudyNodeIds = useLearningStore((state) => state.orderedStudyNodeIds)
  const completedNodeIds = useLearningStore((state) => state.completedNodeIds)
  const libraryRecords = useLearningStore((state) => state.libraryRecords)
  const isNodeUnlocked = useLearningStore((state) => state.isNodeUnlocked)
  const [pinnedBilibiliSources, setPinnedBilibiliSources] = useState<PinnedBilibiliSource[]>([])
  const [materialInventory, setMaterialInventory] = useState<MaterialInventory | null>(null)
  const [expandedSourceLibraryFolderId, setExpandedSourceLibraryFolderId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const loadPinnedSources = () => {
      void window.desktopAPI.loadPinnedBilibiliSources()
        .then((items) => {
          if (alive) setPinnedBilibiliSources(items)
        })
        .catch(() => {
          if (alive) setPinnedBilibiliSources([])
        })
    }
    const handlePinnedSourcesChanged = (event: Event) => {
      const detail = (event as CustomEvent<PinnedBilibiliSource[]>).detail
      if (Array.isArray(detail)) {
        setPinnedBilibiliSources(detail)
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
    const pinnedCreatorNames = pinnedBilibiliSources.map((source) => source.name).filter(Boolean)
    const pinnedFolders = pinnedBilibiliSources
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
      .filter((record) => !pinnedBilibiliSources.some((source) => materialRecordMatchesSource(record, source)))
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
  }, [materialInventory?.records, pinnedBilibiliSources])
  const activeSourceLibraryFolderId = useMemo(() => {
    if (!courseData) return null
    return sourceLibraryFolders.find((folder) =>
      folder.records.some((record) => recordMatchesActiveCourse(record, courseData)),
    )?.id ?? null
  }, [courseData, sourceLibraryFolders])

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
    <aside className="flex h-full shrink-0 flex-col bg-transparent px-2.5 pb-2.5 pt-2" style={{ width: sidebarWidth }}>
      <div className="space-y-2">
        <nav className="space-y-0.5 py-1">
          <NavEntry
            icon={<WandSparkles size={16} strokeWidth={2} />}
            title="字幕流水线"
            active={workspaceView === 'workbench'}
            onClick={() => onSelectView('workbench')}
          />
          <NavEntry
            icon={<Archive size={16} strokeWidth={2} />}
            title="输出"
            active={workspaceView === 'archive'}
            trailing={
              <Badge variant="outline" className="h-5 border-white/0 bg-black/18 px-2 text-[10px] text-foreground/74">
                {materialInventory?.records.filter(materialRecordHasLibraryOutput).length ?? 0}
              </Badge>
            }
            onClick={() => onSelectView('archive')}
          />
        </nav>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden pt-2.5">
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <div className="text-[12px] font-semibold leading-[18px] text-[#aab2bd]">核心流程</div>
        </div>

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-0.5 pr-0">
          <div className="px-2 py-2">
            <div className="space-y-1.5 rounded-[12px] border border-white/[0.055] bg-white/[0.018] px-3 py-3 text-[11px] leading-5 text-muted-foreground">
              <div className="flex items-center gap-2 text-[#d7dee8]">
                <ListChecks size={13} />
                <span className="font-semibold">UP 主 → 视频 → 字幕 → 清洗稿</span>
              </div>
              <div>主入口只保留字幕流水线；旧专注、灵犀和学习包入口已从主导航降级。</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 pt-2">
        <NavEntry
          icon={<Route size={16} strokeWidth={2} />}
          title="流程"
          active={workspaceView === 'workflow'}
          onClick={() => onSelectView('workflow')}
        />
        <NavEntry
          icon={<Settings size={16} strokeWidth={2} />}
          title="设置"
          active={workspaceView === 'settings'}
          onClick={() => onSelectView('settings')}
        />
      </div>
    </aside>
  )
}

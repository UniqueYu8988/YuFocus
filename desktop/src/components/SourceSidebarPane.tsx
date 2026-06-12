import {
  ChevronDown,
  FileText,
  Folder,
  Route,
  Settings,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import sidebarArchiveIcon from '@/assets/sidebar-archive.svg'
import sidebarLearnIcon from '@/assets/sidebar-learn.svg'
import { OutlineNodeItem } from '@/components/OutlineNodeItem'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'
import type { WorkspaceView } from '@/components/WorkspacePane'

type SourceSidebarPaneProps = {
  workspaceView: WorkspaceView
  onSelectView: (view: WorkspaceView) => void
  onActivateLearningNode: () => void
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

export function SourceSidebarPane({ workspaceView, onSelectView, onActivateLearningNode, sidebarWidth, windowFocused: _windowFocused }: SourceSidebarPaneProps) {
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

  const handleOpenSourceLibraryRecord = (record: MaterialInventoryRecord) => {
    const targetPath = getSourceMaterialReadPath(record)
    if (!targetPath) return
    window.dispatchEvent(new CustomEvent('shijie:open-material-document', {
      detail: {
        title: record.title,
        path: targetPath,
        htmlPath: getSourceMaterialReadHtmlPath(record),
        materialPath: record.path,
        sourceId: record.sourceId,
        sourceUrl: record.sourceUrl,
      },
    }))
    onSelectView('learn')
  }

  return (
    <aside className="flex h-full shrink-0 flex-col bg-transparent px-2.5 pb-2.5 pt-2" style={{ width: sidebarWidth }}>
      <div className="space-y-2">
        <nav className="space-y-0.5 py-1">
          <NavEntry
            icon={<img src={sidebarLearnIcon} alt="" className="size-[17px]" />}
            title="专注"
            active={workspaceView === 'learn'}
            trailing={courseData ? <Badge variant="outline" className="h-5 border-white/0 bg-black/18 px-2 text-[10px] text-foreground/74">{progress}%</Badge> : undefined}
            onClick={() => onSelectView('learn')}
          />
          <NavEntry
            icon={<WandSparkles size={16} strokeWidth={2} />}
            title="制作"
            active={workspaceView === 'workbench'}
            onClick={() => onSelectView('workbench')}
          />
          <NavEntry
            icon={<img src={sidebarArchiveIcon} alt="" className="size-[17px]" />}
            title="档案"
            active={workspaceView === 'archive'}
            trailing={
              <Badge variant="outline" className="h-5 border-white/0 bg-black/18 px-2 text-[10px] text-foreground/74">
                {activeLibraryCount + archivedLibraryCount}
              </Badge>
            }
            onClick={() => onSelectView('archive')}
          />
        </nav>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden pt-2.5">
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <div className="text-[12px] font-semibold leading-[18px] text-[#aab2bd]">灵犀</div>
          {courseData ? (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <div className="relative h-1.5 w-[132px] overflow-hidden rounded-full bg-white/[0.07]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-sky-300/90 shadow-[0_0_10px_rgba(125,211,252,0.22)] transition-[width] duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
              <span className="w-8 text-right text-[11px] font-semibold tabular-nums text-[#dbe4ef]">{progress}%</span>
            </div>
          ) : null}
        </div>

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-0.5 pr-0">
          {sourceLibraryFolders.length ? (
            <div className="px-2 py-2">
              <div className="space-y-0.5">
                {sourceLibraryFolders.map((folder) => {
                  const expanded = expandedSourceLibraryFolderId === folder.id
                  const activeFolder = activeSourceLibraryFolderId === folder.id
                  return (
                    <div key={folder.id}>
                      <FolderHint
                        title={folder.title}
                        count={folder.count}
                        expanded={expanded}
                        active={activeFolder}
                        onClick={() => handleOpenSourceLibraryFolder(folder)}
                      />
                      {expanded ? (
                        <div className="ml-4 mt-1 space-y-0.5 border-l border-white/[0.06] pl-2">
                          {folder.records.slice(0, 12).map((record) => {
                            const readPath = getSourceMaterialReadPath(record)
                            const activeRecord = recordMatchesActiveCourse(record, courseData)
                            return (
                              <button
                                key={record.path}
                                type="button"
                                className={cn(
                                  'group flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[11px] leading-4 transition-colors',
                                  activeRecord
                                    ? 'bg-white/[0.055] text-[#f4f7fb]'
                                    : 'text-[#aab2bd] hover:bg-white/[0.035] hover:text-[#edf1f6]',
                                )}
                                disabled={!readPath}
                                onClick={() => handleOpenSourceLibraryRecord(record)}
                                title={record.title}
                              >
                                <FileText size={12} strokeWidth={1.9} className="shrink-0 opacity-75 group-hover:opacity-100" />
                                <span className="min-w-0 flex-1 truncate">{record.title}</span>
                                <span className="shrink-0 text-[10px] text-muted-foreground/75">{getSourceMaterialReadLabel(record)}</span>
                              </button>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : courseData ? (
            <div className="space-y-0.5">
              {rootNodeIds.map((nodeId) => (
                <OutlineNodeItem key={nodeId} nodeId={nodeId} onActivateStudyNode={onActivateLearningNode} />
              ))}
            </div>
          ) : (
            <div className="px-2 py-2">
              <div className="rounded-[12px] border border-white/[0.055] bg-white/[0.018] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                制作完成后，收藏 UP 会在这里生成灵犀文件夹。
              </div>
            </div>
          )}
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

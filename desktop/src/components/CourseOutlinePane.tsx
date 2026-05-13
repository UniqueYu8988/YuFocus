import {
  Settings,
  WandSparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'
import sidebarArchiveIcon from '@/assets/sidebar-archive.svg'
import sidebarLearnIcon from '@/assets/sidebar-learn.svg'
import { OutlineNodeItem } from '@/components/OutlineNodeItem'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'
import type { WorkspaceView } from '@/components/WorkspacePane'

type CourseOutlinePaneProps = {
  workspaceView: WorkspaceView
  onSelectView: (view: WorkspaceView) => void
  sidebarWidth: number
  windowFocused: boolean
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

export function CourseOutlinePane({ workspaceView, onSelectView, sidebarWidth, windowFocused: _windowFocused }: CourseOutlinePaneProps) {
  const courseData = useLearningStore((state) => state.courseData)
  const rootNodeIds = useLearningStore((state) => state.rootNodeIds)
  const nodeMap = useLearningStore((state) => state.nodeMap)
  const orderedStudyNodeIds = useLearningStore((state) => state.orderedStudyNodeIds)
  const completedNodeIds = useLearningStore((state) => state.completedNodeIds)
  const libraryRecords = useLearningStore((state) => state.libraryRecords)
  const isNodeUnlocked = useLearningStore((state) => state.isNodeUnlocked)

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

  return (
    <aside className="flex h-full shrink-0 flex-col bg-transparent px-2.5 pb-2.5 pt-2" style={{ width: sidebarWidth }}>
      <div className="space-y-2">
        <nav className="space-y-0.5 py-1">
          <NavEntry
            icon={<img src={sidebarLearnIcon} alt="" className="size-[17px]" />}
            title="学习台"
            active={workspaceView === 'learn'}
            trailing={courseData ? <Badge variant="outline" className="h-5 border-white/0 bg-black/18 px-2 text-[10px] text-foreground/74">{progress}%</Badge> : undefined}
            onClick={() => onSelectView('learn')}
          />
          <NavEntry
            icon={<WandSparkles size={16} strokeWidth={2} />}
            title="工作台"
            active={workspaceView === 'workbench'}
            onClick={() => onSelectView('workbench')}
          />
          <NavEntry
            icon={<img src={sidebarArchiveIcon} alt="" className="size-[17px]" />}
            title="学习档案"
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
          <div className="text-[12px] font-semibold leading-[18px] text-[#aab2bd]">主线</div>
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
          {courseData ? (
            <div className="space-y-0.5">
              {rootNodeIds.map((nodeId) => (
                <OutlineNodeItem key={nodeId} nodeId={nodeId} onActivateStudyNode={() => onSelectView('learn')} />
              ))}
            </div>
          ) : (
            <div className="px-2 py-2">
              <div className="text-[11px] leading-5 text-muted-foreground">
                课程载入后，主线会在这里展开。
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" className="h-8 rounded-xl px-3" onClick={() => onSelectView('workbench')}>
                  工作台
                </Button>
                <Button size="sm" variant="outline" className="h-8 rounded-xl px-3" onClick={() => onSelectView('learn')}>
                  学习台
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 pt-2">
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

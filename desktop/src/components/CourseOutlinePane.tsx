import {
  LibraryBig,
  Settings2,
  Sparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { OutlineNodeItem } from '@/components/OutlineNodeItem'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'
import type { WorkspaceView } from '@/components/WorkspacePane'

type CourseOutlinePaneProps = {
  workspaceView: WorkspaceView
  onSelectView: (view: WorkspaceView) => void
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
        'flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition',
        active
          ? 'border-[#6e84c8]/20 bg-[#5e73a8]/11 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]'
          : 'border-transparent text-muted-foreground hover:bg-white/[0.016] hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'flex size-6.5 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-[#8ea4de]/9 text-foreground' : 'text-foreground/70',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{title}</span>
      {trailing}
    </button>
  )
}

export function CourseOutlinePane({ workspaceView, onSelectView, windowFocused: _windowFocused }: CourseOutlinePaneProps) {
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
    stageSegments.length > 0 ? Math.round((stageSegments.reduce((sum, segment) => sum + segment.completionRatio, 0) / stageSegments.length) * 100) : 0

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col bg-transparent px-2 pb-2.5 pt-2">
      <div className="space-y-2">
        <nav className="space-y-0.5 py-1">
          <NavEntry
            icon={<Sparkles size={15} />}
            title="学习台"
            active={workspaceView === 'learn'}
            trailing={courseData ? <Badge variant="outline" className="h-5 px-2 text-[10px]">{progress}%</Badge> : undefined}
            onClick={() => onSelectView('learn')}
          />
          <NavEntry
            icon={<LibraryBig size={15} />}
            title="课程中心"
            active={workspaceView === 'hub'}
            trailing={
              <Badge variant="outline" className="h-5 px-2 text-[10px]">
                {activeLibraryCount + archivedLibraryCount}
              </Badge>
            }
            onClick={() => onSelectView('hub')}
          />
          <NavEntry
            icon={<Settings2 size={15} />}
            title="设置"
            active={workspaceView === 'settings'}
            onClick={() => onSelectView('settings')}
          />
        </nav>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-white/[0.02] pt-2.5">
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">主线</div>
          {courseData ? (
            <div className="flex items-center gap-2 rounded-full border border-white/[0.04] bg-white/[0.015] px-2.5 py-1">
              <div className="flex h-2 w-[132px] items-center gap-[3px]">
                {stageSegments.map((segment) => (
                  <div key={segment.id} className="relative h-full flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                    {segment.unlockedRatio > 0 ? (
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-white/[0.09]"
                        style={{ width: `${Math.max(segment.unlockedRatio * 100, segment.unlockedRatio > 0 ? 14 : 0)}%` }}
                      />
                    ) : null}
                    {segment.completionRatio > 0 ? (
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-sky-300/85 shadow-[0_0_10px_rgba(125,211,252,0.24)]"
                        style={{ width: `${Math.max(segment.completionRatio * 100, segment.completionRatio > 0 ? 16 : 0)}%` }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              <span className="text-[10px] font-medium text-foreground/78">{progress}%</span>
            </div>
          ) : null}
        </div>

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-0.5 pr-0">
          {courseData ? (
            <div className="space-y-1">
              {rootNodeIds.map((nodeId) => (
                <OutlineNodeItem key={nodeId} nodeId={nodeId} />
              ))}
            </div>
          ) : (
            <div className="px-2 py-2">
              <div className="text-[11px] leading-5 text-muted-foreground">
                课程载入后，主线会在这里展开。
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" className="h-8 rounded-xl px-3" onClick={() => onSelectView('hub')}>
                  课程中心
                </Button>
                <Button size="sm" variant="outline" className="h-8 rounded-xl px-3" onClick={() => onSelectView('learn')}>
                  学习台
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

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
        'flex w-full items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left transition',
        active ? 'bg-white/[0.06] text-foreground' : 'text-muted-foreground hover:bg-white/[0.03] hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-xl',
          active ? 'bg-white/[0.06] text-foreground' : 'text-foreground/70',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{title}</span>
      {trailing}
    </button>
  )
}

export function CourseOutlinePane({ workspaceView, onSelectView, windowFocused }: CourseOutlinePaneProps) {
  const courseData = useLearningStore((state) => state.courseData)
  const rootNodeIds = useLearningStore((state) => state.rootNodeIds)
  const orderedStudyNodeIds = useLearningStore((state) => state.orderedStudyNodeIds)
  const completedNodeIds = useLearningStore((state) => state.completedNodeIds)
  const libraryRecords = useLearningStore((state) => state.libraryRecords)
  const isNodeUnlocked = useLearningStore((state) => state.isNodeUnlocked)

  const unlockedStudyCount = orderedStudyNodeIds.filter((nodeId) => isNodeUnlocked(nodeId)).length
  const activeLibraryCount = libraryRecords.filter((record) => !record.isArchived).length
  const archivedLibraryCount = libraryRecords.filter((record) => record.isArchived).length
  const progress = orderedStudyNodeIds.length > 0 ? Math.round((completedNodeIds.length / orderedStudyNodeIds.length) * 100) : 0

  return (
    <aside className={cn('flex h-full w-[252px] shrink-0 flex-col px-2.5 pb-2.5 pt-3 transition-colors duration-200', windowFocused ? 'bg-[#202020]' : 'bg-[#1b1b1b]')}>
      <div className="space-y-2.5">
        <nav className="space-y-0.5 border-y border-white/6 py-2">
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

      <div className="mt-2.5 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-1.5 pb-2.5">
          <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">主线</div>
          {courseData ? (
            <Badge variant="outline" className="h-5 px-2 text-[10px]">
              {Math.max(0, orderedStudyNodeIds.length - unlockedStudyCount)} 待解锁
            </Badge>
          ) : null}
        </div>

        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-0.5 pr-0">
          {courseData ? (
            <div className="space-y-1.5">
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

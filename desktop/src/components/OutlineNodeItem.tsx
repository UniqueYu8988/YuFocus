import { Check, ChevronDown, CircleDot, Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'

function collectStudyDescendants(
  nodeId: string,
  nodeMap: ReturnType<typeof useLearningStore.getState>['nodeMap'],
) {
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

export function OutlineNodeItem({ nodeId }: { nodeId: string }) {
  const node = useLearningStore((state) => state.nodeMap[nodeId])
  const nodeMap = useLearningStore((state) => state.nodeMap)
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const setCurrentNode = useLearningStore((state) => state.setCurrentNode)
  const isNodeUnlocked = useLearningStore((state) => state.isNodeUnlocked)
  const isNodeCompleted = useLearningStore((state) => state.isNodeCompleted)
  const isStudyNode = useLearningStore((state) => state.isStudyNode)
  const failedNodeIds = useLearningStore((state) => state.failedNodeIds)
  const completedNodeIds = useLearningStore((state) => state.completedNodeIds)
  const [expanded, setExpanded] = useState(() => false)

  if (!node) return null

  const unlocked = isNodeUnlocked(node.id)
  const completed = isNodeCompleted(node.id)
  const active = currentNodeId === node.id
  const failed = failedNodeIds.includes(node.id)
  const hasChildren = node.childIds.length > 0
  const learnable = isStudyNode(node.id)
  const showBranchProgress = hasChildren && node.depth <= 1

  const statusIcon = completed ? <Check size={13} /> : unlocked ? <CircleDot size={13} /> : <Lock size={13} />
  const isInActivePath = useMemo(() => {
    if (!currentNodeId) return false
    let cursorId: string | null = currentNodeId
    while (cursorId) {
      if (cursorId === node.id) return true
      cursorId = nodeMap[cursorId]?.parentId ?? null
    }
    return false
  }, [currentNodeId, node.id, nodeMap])
  const descendantStudyNodeIds = useMemo(
    () => (hasChildren ? collectStudyDescendants(node.id, nodeMap) : []),
    [hasChildren, node.id, nodeMap],
  )
  const branchTotalCount = descendantStudyNodeIds.length
  const branchCompletedCount = useMemo(
    () => descendantStudyNodeIds.filter((studyNodeId) => completedNodeIds.includes(studyNodeId)).length,
    [completedNodeIds, descendantStudyNodeIds],
  )
  const branchUnlockedCount = useMemo(
    () => descendantStudyNodeIds.filter((studyNodeId) => isNodeUnlocked(studyNodeId)).length,
    [descendantStudyNodeIds, isNodeUnlocked],
  )
  const branchProgressPercent = branchTotalCount > 0 ? Math.round((branchCompletedCount / branchTotalCount) * 100) : 0
  const branchUnlockedPercent = branchTotalCount > 0 ? Math.round((branchUnlockedCount / branchTotalCount) * 100) : 0
  const branchStatusLabel =
    branchCompletedCount >= branchTotalCount && branchTotalCount > 0
      ? '已完成'
      : isInActivePath
        ? '进行中'
        : branchUnlockedCount > 0
          ? '已展开'
          : '未开始'

  useEffect(() => {
    if (hasChildren && isInActivePath) {
      setExpanded(true)
    }
  }, [hasChildren, isInActivePath])

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'group relative flex items-center gap-2 overflow-hidden rounded-lg border px-2 py-1.5 transition-all duration-300',
          active &&
            'outline-node-active border-sky-400/20 bg-[linear-gradient(135deg,rgba(56,189,248,0.16),rgba(56,189,248,0.06))]',
          !active && 'border-transparent hover:border-white/8 hover:bg-white/[0.024]',
          failed && !active && 'border-amber-500/15 bg-amber-500/6',
          isInActivePath && !active && 'border-white/[0.04] bg-white/[0.018]',
        )}
        style={{ marginLeft: `${node.depth * 8}px` }}
      >
        {active ? (
          <>
            <span className="pointer-events-none absolute inset-0 rounded-lg bg-sky-400/[0.03]" />
            <span className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-[radial-gradient(circle_at_left,rgba(125,211,252,0.22),transparent_70%)]" />
          </>
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'relative size-5.5 rounded-md border border-transparent text-muted-foreground transition-transform duration-300',
            unlocked && 'text-foreground/78',
            completed && 'text-emerald-300',
            !unlocked && 'text-muted-foreground/70',
            active && 'outline-node-active-icon scale-[1.03] text-sky-100',
          )}
          onClick={() => setCurrentNode(node.id)}
          disabled={!unlocked || !learnable}
          aria-label={`进入 ${node.title}`}
        >
          {active ? (
            <>
              <span className="absolute inset-[-2px] rounded-full border border-sky-200/15" />
            </>
          ) : null}
          {statusIcon}
        </Button>

        <div className="min-w-0 flex-1">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-label={expanded ? `收起 ${node.title}` : `展开 ${node.title}`}
              className="flex w-full items-center justify-between gap-3 rounded-lg text-left"
            >
              <span
                className={cn(
                  'truncate text-[11px] font-medium text-foreground/95 transition-colors',
                  active && 'text-sky-50',
                  !unlocked && 'text-muted-foreground',
                )}
              >
                {node.title}
              </span>
              <ChevronDown
                size={12}
                className={cn(
                  'shrink-0 text-muted-foreground transition-transform duration-200',
                  expanded && 'rotate-180 text-foreground',
                )}
              />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCurrentNode(node.id)}
              disabled={!unlocked || !learnable}
              aria-label={`进入 ${node.title}`}
              className="flex w-full items-center justify-between gap-3 rounded-lg text-left disabled:cursor-not-allowed"
            >
              <span
                className={cn(
                  'truncate text-[11px] font-medium text-foreground/95 transition-colors',
                  active && 'text-sky-50',
                  !unlocked && 'text-muted-foreground',
                )}
              >
                {node.title}
              </span>
            </button>
          )}

          {showBranchProgress ? (
            <div className="mt-1.5 flex items-center gap-2 pr-5">
              <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                {branchUnlockedCount > 0 ? (
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-white/[0.12]"
                    style={{ width: `${Math.max(branchUnlockedPercent, 12)}%` }}
                  />
                ) : null}
                {branchCompletedCount > 0 ? (
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full shadow-[0_0_12px_rgba(125,211,252,0.28)] transition-all duration-300',
                      isInActivePath ? 'bg-sky-300/95' : 'bg-sky-300/75',
                    )}
                    style={{ width: `${Math.max(branchProgressPercent, branchProgressPercent > 0 ? 14 : 0)}%` }}
                  />
                ) : null}
              </div>
              <div
                className={cn(
                  'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium tracking-[0.08em]',
                  branchStatusLabel === '已完成' && 'border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-200',
                  branchStatusLabel === '进行中' && 'border-sky-400/15 bg-sky-400/[0.08] text-sky-100',
                  branchStatusLabel === '已展开' && 'border-white/[0.07] bg-white/[0.04] text-foreground/72',
                  branchStatusLabel === '未开始' && 'border-white/[0.06] bg-transparent text-muted-foreground',
                )}
              >
                {branchStatusLabel}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {hasChildren && expanded ? (
        <div className="ml-3 space-y-1 border-l border-white/[0.05] pl-2">
          {node.childIds.map((childId) => (
            <OutlineNodeItem key={childId} nodeId={childId} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

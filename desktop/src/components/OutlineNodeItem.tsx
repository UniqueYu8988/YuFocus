import { Check, ChevronDown, CircleDot, Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'

export function OutlineNodeItem({ nodeId }: { nodeId: string }) {
  const node = useLearningStore((state) => state.nodeMap[nodeId])
  const nodeMap = useLearningStore((state) => state.nodeMap)
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const setCurrentNode = useLearningStore((state) => state.setCurrentNode)
  const isNodeUnlocked = useLearningStore((state) => state.isNodeUnlocked)
  const isNodeCompleted = useLearningStore((state) => state.isNodeCompleted)
  const isStudyNode = useLearningStore((state) => state.isStudyNode)
  const failedNodeIds = useLearningStore((state) => state.failedNodeIds)
  const [expanded, setExpanded] = useState(() => false)

  if (!node) return null

  const unlocked = isNodeUnlocked(node.id)
  const completed = isNodeCompleted(node.id)
  const active = currentNodeId === node.id
  const failed = failedNodeIds.includes(node.id)
  const hasChildren = node.childIds.length > 0
  const learnable = isStudyNode(node.id)

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

  useEffect(() => {
    if (hasChildren && isInActivePath) {
      setExpanded(true)
    }
  }, [hasChildren, isInActivePath])

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'group flex items-center gap-2 rounded-xl border px-2 py-1.5 transition',
          active && 'border-white/12 bg-white/[0.05] shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]',
          !active && 'border-transparent hover:border-white/8 hover:bg-white/[0.03]',
          failed && !active && 'border-amber-500/15 bg-amber-500/6',
        )}
        style={{ marginLeft: `${node.depth * 10}px` }}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'size-6 rounded-lg border border-transparent text-muted-foreground',
            unlocked && 'text-foreground/78',
            completed && 'text-emerald-300',
            !unlocked && 'text-muted-foreground/70',
          )}
          onClick={() => setCurrentNode(node.id)}
          disabled={!unlocked || !learnable}
          aria-label={`进入 ${node.title}`}
        >
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
              <span className={cn('truncate text-[12px] font-medium text-foreground/95', !unlocked && 'text-muted-foreground')}>
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
              <span className={cn('truncate text-[12px] font-medium text-foreground/95', !unlocked && 'text-muted-foreground')}>
                {node.title}
              </span>
            </button>
          )}
        </div>
      </div>

      {hasChildren && expanded ? (
        <div className="space-y-1">
          {node.childIds.map((childId) => (
            <OutlineNodeItem key={childId} nodeId={childId} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

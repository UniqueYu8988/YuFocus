import { Check, ChevronDown, CircleDot, Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'

function getSidebarTitle(title: string) {
  const [prefix] = title.split(/[：:]/u)
  const compact = prefix.trim()
  return compact.length >= 2 ? compact : title
}

export function OutlineNodeItem({
  nodeId,
  onActivateStudyNode,
}: {
  nodeId: string
  onActivateStudyNode?: () => void
}) {
  const node = useLearningStore((state) => state.nodeMap[nodeId])
  const nodeMap = useLearningStore((state) => state.nodeMap)
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const setCurrentNode = useLearningStore((state) => state.setCurrentNode)
  const isNodeUnlocked = useLearningStore((state) => state.isNodeUnlocked)
  const isNodeCompleted = useLearningStore((state) => state.isNodeCompleted)
  const isStudyNode = useLearningStore((state) => state.isStudyNode)
  const completedNodeIds = useLearningStore((state) => state.completedNodeIds)
  const [expanded, setExpanded] = useState(() => false)

  if (!node) return null

  const descendantStudyNodeIds = useMemo(() => {
    const collected: string[] = []
    const stack = [...node.childIds]

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
  }, [node.childIds, nodeMap])

  const unlocked = isNodeUnlocked(node.id)
  const completed = isStudyNode(node.id)
    ? isNodeCompleted(node.id)
    : descendantStudyNodeIds.length > 0 && descendantStudyNodeIds.every((studyNodeId) => completedNodeIds.includes(studyNodeId))
  const active = currentNodeId === node.id
  const hasChildren = node.childIds.length > 0
  const learnable = isStudyNode(node.id)
  const sidebarTitle = getSidebarTitle(node.title)

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

  const activateStudyNode = () => {
    setCurrentNode(node.id)
    onActivateStudyNode?.()
  }

  return (
    <div className="space-y-0.5">
      <div
        className={cn(
          'group relative flex items-center gap-2 overflow-hidden rounded-[11px] border px-2 py-1.5 transition-all duration-200',
          active &&
            'border-transparent bg-white/[0.038]',
          !active && 'border-transparent hover:border-transparent hover:bg-white/[0.035]',
          isInActivePath && !active && 'border-transparent bg-white/[0.022]',
        )}
        style={{ marginLeft: `${node.depth * 4}px` }}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'relative size-5.5 rounded-md border border-transparent text-muted-foreground transition-transform duration-300',
            unlocked && 'text-[#b6bec9]',
            completed && 'text-emerald-300',
            !unlocked && 'text-muted-foreground/60',
            active && 'text-[#f1f5fb]',
          )}
          onClick={activateStudyNode}
          disabled={!learnable}
          aria-label={`进入 ${node.title}`}
          title={unlocked ? `进入 ${node.title}` : `预览 ${node.title}`}
        >
          {statusIcon}
        </Button>

        <div className="min-w-0 flex-1">
          {hasChildren ? (
            <div className="flex w-full items-center gap-1 rounded-lg">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                aria-label={expanded ? `收起 ${node.title}` : `展开 ${node.title}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg text-left"
              >
                <span
                  className={cn(
                    'truncate text-[12px] font-semibold leading-[18px] text-[#d7dee8] transition-colors',
                    active && 'text-[#f4f7fb]',
                    !unlocked && 'text-[#7d858f]',
                  )}
                >
                  {sidebarTitle}
                </span>
                <ChevronDown
                  size={12}
                  className={cn(
                    'shrink-0 text-[#8d96a2] transition-transform duration-200',
                    expanded && 'rotate-180 text-[#d7dee8]',
                  )}
                />
              </button>
            </div>
          ) : (
            <div className="flex w-full items-center gap-1 rounded-lg">
              <button
                type="button"
                onClick={activateStudyNode}
                disabled={!learnable}
                aria-label={unlocked ? `进入 ${node.title}` : `预览 ${node.title}`}
                title={unlocked ? `进入 ${node.title}` : `预览 ${node.title}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg text-left disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    'truncate text-[12px] font-semibold leading-[18px] text-[#d7dee8] transition-colors',
                    active && 'text-[#f4f7fb]',
                    !unlocked && 'text-[#7d858f]',
                  )}
                >
                  {sidebarTitle}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {hasChildren && expanded ? (
        <div className="ml-2 space-y-0.5 border-l border-white/[0.03] pl-1.5">
          {node.childIds.map((childId) => (
            <OutlineNodeItem key={childId} nodeId={childId} onActivateStudyNode={onActivateStudyNode} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

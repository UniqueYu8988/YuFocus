import type { CourseNode, CoursePackage, FlatCourseNode } from '../types/course'

type FlattenedCourse = {
  nodeMap: Record<string, FlatCourseNode>
  rootNodeIds: string[]
  orderedNodeIds: string[]
  orderedStudyNodeIds: string[]
}

function sortNodes(nodes: CourseNode[]) {
  return [...nodes].sort((left, right) => left.order - right.order)
}

export function flattenCourse(course: CoursePackage): FlattenedCourse {
  const nodeMap: Record<string, FlatCourseNode> = {}
  const rootNodeIds: string[] = []
  const orderedNodeIds: string[] = []
  const orderedStudyNodeIds: string[] = []

  const walk = (node: CourseNode, parentId: string | null, depth: number) => {
    const sortedChildren = sortNodes(node.children)
    const flatNode: FlatCourseNode = {
      ...node,
      children: sortedChildren,
      parentId,
      depth,
      childIds: sortedChildren.map((child) => child.id),
    }
    nodeMap[node.id] = flatNode
    orderedNodeIds.push(node.id)
    if (isStudyNode(flatNode)) {
      orderedStudyNodeIds.push(node.id)
    }

    if (parentId === null) {
      rootNodeIds.push(node.id)
    }

    sortedChildren.forEach((child) => walk(child, node.id, depth + 1))
  }

  sortNodes(course.chapters).forEach((chapter) => walk(chapter, null, 0))

  return { nodeMap, rootNodeIds, orderedNodeIds, orderedStudyNodeIds }
}

export function isStudyNode(node: FlatCourseNode | CourseNode) {
  return node.children.length === 0
}

export function areDependenciesMet(node: FlatCourseNode, completedNodeIds: string[]) {
  return node.dependencies.every((dependencyId) => completedNodeIds.includes(dependencyId))
}

function isNodeReachable(
  nodeId: string,
  nodeMap: Record<string, FlatCourseNode>,
  completedNodeIds: string[],
  memo: Map<string, boolean>,
): boolean {
  if (memo.has(nodeId)) {
    return memo.get(nodeId) ?? false
  }

  const node = nodeMap[nodeId]
  if (!node) {
    memo.set(nodeId, false)
    return false
  }

  if (!areDependenciesMet(node, completedNodeIds)) {
    memo.set(nodeId, false)
    return false
  }

  if (!node.parentId) {
    memo.set(nodeId, true)
    return true
  }

  const reachable: boolean = isNodeReachable(node.parentId, nodeMap, completedNodeIds, memo)
  memo.set(nodeId, reachable)
  return reachable
}

export function getUnlockedNodeIds(nodeMap: Record<string, FlatCourseNode>, completedNodeIds: string[]) {
  const memo = new Map<string, boolean>()
  return Object.values(nodeMap)
    .filter((node) => isNodeReachable(node.id, nodeMap, completedNodeIds, memo))
    .map((node) => node.id)
}

export function getNextNodeId(
  orderedNodeIds: string[],
  nodeMap: Record<string, FlatCourseNode>,
  completedNodeIds: string[],
) {
  const memo = new Map<string, boolean>()
  return (
    orderedNodeIds.find((nodeId) => {
      const node = nodeMap[nodeId]
      if (!node) return false
      if (completedNodeIds.includes(nodeId)) return false
      return isNodeReachable(nodeId, nodeMap, completedNodeIds, memo)
    }) ?? null
  )
}

export function getNextSequentialNodeId(orderedNodeIds: string[], currentNodeId: string | null) {
  if (!currentNodeId) return orderedNodeIds[0] ?? null
  const currentIndex = orderedNodeIds.indexOf(currentNodeId)
  if (currentIndex < 0) return orderedNodeIds[0] ?? null
  return orderedNodeIds[currentIndex + 1] ?? null
}

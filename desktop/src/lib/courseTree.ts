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

function isDeprecatedReviewNode(node: CourseNode) {
  const title = node.title.trim().toLocaleLowerCase('zh-CN')
  return Boolean(title) && (title.includes('阶段复盘') || title.includes('阶段练习') || ['复盘', '练习', '回顾'].includes(title))
}

function collectDeprecatedReviewNodeIds(nodes: CourseNode[]) {
  const collected = new Set<string>()
  const visit = (node: CourseNode) => {
    if (isDeprecatedReviewNode(node)) {
      collected.add(node.id)
    }
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return collected
}

export function flattenCourse(course: CoursePackage): FlattenedCourse {
  const nodeMap: Record<string, FlatCourseNode> = {}
  const rootNodeIds: string[] = []
  const orderedNodeIds: string[] = []
  const orderedStudyNodeIds: string[] = []
  const deprecatedReviewNodeIds = collectDeprecatedReviewNodeIds(course.chapters)

  const walk = (node: CourseNode, parentId: string | null, depth: number) => {
    if (deprecatedReviewNodeIds.has(node.id)) return

    const sortedChildren = sortNodes(node.children.filter((child) => !deprecatedReviewNodeIds.has(child.id)))
    const flatNode: FlatCourseNode = {
      ...node,
      dependencies: node.dependencies.filter((dependencyId) => !deprecatedReviewNodeIds.has(dependencyId)),
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

function hasCompletedDescendantStudyNodes(
  nodeId: string,
  nodeMap: Record<string, FlatCourseNode>,
  completedNodeIds: Set<string>,
  memo: Map<string, boolean>,
): boolean {
  if (completedNodeIds.has(nodeId)) {
    memo.set(nodeId, true)
    return true
  }

  if (memo.has(nodeId)) {
    return memo.get(nodeId) ?? false
  }

  const node = nodeMap[nodeId]
  if (!node) {
    memo.set(nodeId, false)
    return false
  }

  if (isStudyNode(node)) {
    const completed = completedNodeIds.has(nodeId)
    memo.set(nodeId, completed)
    return completed
  }

  const completed = node.childIds.length > 0 && node.childIds.every((childId) => hasCompletedDescendantStudyNodes(childId, nodeMap, completedNodeIds, memo))
  memo.set(nodeId, completed)
  return completed
}

export function areDependenciesMet(
  node: FlatCourseNode,
  completedNodeIds: string[],
  nodeMap: Record<string, FlatCourseNode>,
  memo = new Map<string, boolean>(),
) {
  const completedSet = new Set(completedNodeIds)
  return node.dependencies.every((dependencyId) =>
    hasCompletedDescendantStudyNodes(dependencyId, nodeMap, completedSet, memo),
  )
}

function isNodeReachable(
  nodeId: string,
  nodeMap: Record<string, FlatCourseNode>,
  completedNodeIds: string[],
  memo: Map<string, boolean>,
  dependencyMemo: Map<string, boolean>,
): boolean {
  if (memo.has(nodeId)) {
    return memo.get(nodeId) ?? false
  }

  const node = nodeMap[nodeId]
  if (!node) {
    memo.set(nodeId, false)
    return false
  }

  if (!areDependenciesMet(node, completedNodeIds, nodeMap, dependencyMemo)) {
    memo.set(nodeId, false)
    return false
  }

  if (!node.parentId) {
    memo.set(nodeId, true)
    return true
  }

  const reachable: boolean = isNodeReachable(node.parentId, nodeMap, completedNodeIds, memo, dependencyMemo)
  memo.set(nodeId, reachable)
  return reachable
}

export function getUnlockedNodeIds(nodeMap: Record<string, FlatCourseNode>, completedNodeIds: string[]) {
  const memo = new Map<string, boolean>()
  const dependencyMemo = new Map<string, boolean>()
  return Object.values(nodeMap)
    .filter((node) => isNodeReachable(node.id, nodeMap, completedNodeIds, memo, dependencyMemo))
    .map((node) => node.id)
}

export function getNextNodeId(
  orderedNodeIds: string[],
  nodeMap: Record<string, FlatCourseNode>,
  completedNodeIds: string[],
) {
  const memo = new Map<string, boolean>()
  const dependencyMemo = new Map<string, boolean>()
  return (
    orderedNodeIds.find((nodeId) => {
      const node = nodeMap[nodeId]
      if (!node) return false
      if (completedNodeIds.includes(nodeId)) return false
      return isNodeReachable(nodeId, nodeMap, completedNodeIds, memo, dependencyMemo)
    }) ?? null
  )
}

export function getNextSequentialNodeId(orderedNodeIds: string[], currentNodeId: string | null) {
  if (!currentNodeId) return orderedNodeIds[0] ?? null
  const currentIndex = orderedNodeIds.indexOf(currentNodeId)
  if (currentIndex < 0) return orderedNodeIds[0] ?? null
  return orderedNodeIds[currentIndex + 1] ?? null
}

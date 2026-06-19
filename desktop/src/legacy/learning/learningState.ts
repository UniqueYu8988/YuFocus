import { flattenCourse, getNextNodeId, getUnlockedNodeIds, isStudyNode } from './studyTree'
import type {
  AchievementBadge,
  CoursePackage,
  FlatCourseNode,
  LearningMilestoneEvent,
  LearningRecord,
  NodeLearningSession,
  PersistedNodeLearningSession,
} from '../types/course'

// Reader-state compatibility layer. CoursePackage-shaped data is allowed here
// as an internal bridge for 专注, but new 制作/档案/灵犀 flows should not depend
// on the old course/lesson product model.
export type StageCelebration = {
  id: string
  stageId: string
  stageTitle: string
  completedCount: number
  totalCount: number
}

export type CourseStateSnapshot = {
  courseData: CoursePackage
  importedCoursePath: string | null
  nodeMap: Record<string, FlatCourseNode>
  rootNodeIds: string[]
  orderedNodeIds: string[]
  orderedStudyNodeIds: string[]
  currentNodeId: string | null
  unlockedNodeIds: string[]
  completedNodeIds: string[]
  nodeSessions: Record<string, NodeLearningSession>
}

export function createEmptySession(nodeId: string): NodeLearningSession {
  return {
    nodeId,
    learningStatus: 'teaching',
    messages: [],
    activeQuestion: null,
    lastUserAnswer: '',
    lastEvaluation: null,
    requestState: 'idle',
    error: null,
    hydrated: false,
    preloaded: false,
    updatedAt: Date.now(),
  }
}

export function restoreSession(nodeId: string, persisted?: PersistedNodeLearningSession | null): NodeLearningSession {
  if (!persisted) {
    return createEmptySession(nodeId)
  }

  return {
    nodeId,
    learningStatus: persisted.learningStatus,
    messages: Array.isArray(persisted.messages) ? persisted.messages : [],
    activeQuestion: persisted.activeQuestion ?? null,
    lastUserAnswer: persisted.lastUserAnswer ?? '',
    lastEvaluation: persisted.lastEvaluation ?? null,
    requestState: 'idle',
    error: null,
    hydrated: Boolean(persisted.hydrated),
    preloaded: Boolean(persisted.preloaded),
    updatedAt: persisted.updatedAt ?? Date.now(),
  }
}

export function persistSession(session: NodeLearningSession): PersistedNodeLearningSession {
  return {
    nodeId: session.nodeId,
    learningStatus: session.learningStatus,
    messages: session.messages,
    activeQuestion: session.activeQuestion,
    lastUserAnswer: session.lastUserAnswer,
    lastEvaluation: session.lastEvaluation,
    hydrated: session.hydrated,
    preloaded: session.preloaded,
    updatedAt: session.updatedAt,
  }
}

function collectDescendantStudyNodeIds(nodeId: string, nodeMap: Record<string, FlatCourseNode>) {
  const collected: string[] = []
  const queue = [nodeId]

  while (queue.length > 0) {
    const currentId = queue.shift()
    if (!currentId) continue
    const currentNode = nodeMap[currentId]
    if (!currentNode) continue

    if (isStudyNode(currentNode)) {
      collected.push(currentId)
      continue
    }

    queue.push(...currentNode.childIds)
  }

  return collected
}

function normalizeProgressState(
  orderedStudyNodeIds: string[],
  completedNodeIds: string[],
  persistedSessions: Record<string, PersistedNodeLearningSession>,
) {
  const validStudyIds = new Set(orderedStudyNodeIds)
  const completed = new Set(completedNodeIds.filter((nodeId) => validStudyIds.has(nodeId)))

  Object.entries(persistedSessions).forEach(([nodeId, session]) => {
    if (!validStudyIds.has(nodeId)) return
    if (session.learningStatus === 'completed' || session.lastEvaluation === 'correct') {
      completed.add(nodeId)
    }
  })

  return {
    completedNodeIds: [...completed],
  }
}

export function isEffectivelyCompletedSession(
  session: NodeLearningSession | PersistedNodeLearningSession | null | undefined,
) {
  return session?.learningStatus === 'completed' || session?.lastEvaluation === 'correct'
}

export function buildEffectiveCompletedNodeIds(
  currentNodeId: string | null,
  completedNodeIds: string[],
  nodeSessions: Record<string, NodeLearningSession>,
) {
  if (!currentNodeId) return completedNodeIds
  if (completedNodeIds.includes(currentNodeId)) return completedNodeIds
  return isEffectivelyCompletedSession(nodeSessions[currentNodeId])
    ? [...completedNodeIds, currentNodeId]
    : completedNodeIds
}

function getRootStageNode(nodeId: string, nodeMap: Record<string, FlatCourseNode>) {
  let cursor = nodeMap[nodeId] ?? null
  while (cursor?.parentId && nodeMap[cursor.parentId]) {
    cursor = nodeMap[cursor.parentId]
  }
  return cursor
}

export function resolveStageCelebration(
  nodeId: string,
  nodeMap: Record<string, FlatCourseNode>,
  previousCompletedNodeIds: string[],
  nextCompletedNodeIds: string[],
): StageCelebration | null {
  const stageNode = getRootStageNode(nodeId, nodeMap)
  if (!stageNode) return null

  const stageStudyNodeIds = collectDescendantStudyNodeIds(stageNode.id, nodeMap)
  if (stageStudyNodeIds.length === 0) return null

  const previousCompletedCount = stageStudyNodeIds.filter((studyNodeId) =>
    previousCompletedNodeIds.includes(studyNodeId),
  ).length
  const nextCompletedCount = stageStudyNodeIds.filter((studyNodeId) =>
    nextCompletedNodeIds.includes(studyNodeId),
  ).length

  if (nextCompletedCount < stageStudyNodeIds.length || previousCompletedCount >= stageStudyNodeIds.length) {
    return null
  }

  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    stageId: stageNode.id,
    stageTitle: stageNode.title,
    completedCount: nextCompletedCount,
    totalCount: stageStudyNodeIds.length,
  }
}

export function buildCourseState(
  course: CoursePackage,
  importedPath: string | null,
  completedNodeIds: string[],
  preferredCurrentNodeId: string | null,
  persistedSessions: Record<string, PersistedNodeLearningSession> = {},
): CourseStateSnapshot {
  const flattened = flattenCourse(course)
  const orderedStudyNodeIds = flattened.orderedStudyNodeIds
  const normalizedProgress = normalizeProgressState(orderedStudyNodeIds, completedNodeIds, persistedSessions)
  const unlockedNodeIds = getUnlockedNodeIds(flattened.nodeMap, normalizedProgress.completedNodeIds)
  const fallbackCurrentNodeId = getNextNodeId(orderedStudyNodeIds, flattened.nodeMap, normalizedProgress.completedNodeIds)
  const currentNodeId =
    preferredCurrentNodeId &&
    orderedStudyNodeIds.includes(preferredCurrentNodeId) &&
    unlockedNodeIds.includes(preferredCurrentNodeId)
      ? preferredCurrentNodeId
      : fallbackCurrentNodeId

  const nodeSessions = orderedStudyNodeIds.reduce<Record<string, NodeLearningSession>>((accumulator, nodeId) => {
    accumulator[nodeId] = restoreSession(nodeId, persistedSessions[nodeId])
    return accumulator
  }, {})

  return {
    courseData: course,
    importedCoursePath: importedPath,
    nodeMap: flattened.nodeMap,
    rootNodeIds: flattened.rootNodeIds,
    orderedNodeIds: flattened.orderedNodeIds,
    orderedStudyNodeIds,
    currentNodeId,
    unlockedNodeIds,
    completedNodeIds: normalizedProgress.completedNodeIds,
    nodeSessions,
  }
}

export function mergeRecordIntoCourseState(
  course: CoursePackage,
  importedPath: string | null,
  record: LearningRecord,
) {
  const flattened = flattenCourse(course)
  const completedNodeIds = (record.completedNodeIds ?? []).filter((nodeId) => flattened.nodeMap[nodeId])

  return buildCourseState(
    course,
    importedPath,
    completedNodeIds,
    record.currentNodeId ?? null,
    {},
  )
}

export function buildAchievementBadgesSummary(
  completedCount: number,
  progressPercent: number,
  milestoneEvents: LearningMilestoneEvent[],
) {
  const stageCompleteCount = new Set(
    milestoneEvents.filter((event) => event.kind === 'stage_complete' && event.stageId).map((event) => event.stageId as string),
  ).size
  const badges: AchievementBadge[] = []

  if (completedCount >= 1) {
    badges.push({
      code: 'first_step',
      label: '起步完成',
      description: '已经读完第一个小节，开始进入稳定节奏。',
      tone: 'neutral',
    })
  }

  if (completedCount >= 5) {
    badges.push({
      code: 'steady_stride',
      label: '稳定推进',
      description: '连续推进多个小节，节奏已经慢慢稳住了。',
      tone: 'info',
    })
  }

  if (stageCompleteCount >= 1) {
    badges.push({
      code: 'stage_breaker',
      label: '阶段突破',
      description: '已经完整打通至少一个主线阶段。',
      tone: 'accent',
    })
  }

  if (progressPercent >= 50) {
    badges.push({
      code: 'midway',
      label: '半程已过',
      description: '这份资料已经进入中段，不再只是开始试读。',
      tone: 'success',
    })
  }

  if (progressPercent >= 100) {
    badges.push({
      code: 'course_finisher',
      label: '资料归档',
      description: '这份资料已经完成，可以沉淀为长期知识资产。',
      tone: 'success',
    })
  }

  return badges
}

export function appendMilestoneEvent(
  events: LearningMilestoneEvent[],
  event: Omit<LearningMilestoneEvent, 'id' | 'createdAt'> & { createdAt?: number },
) {
  const createdAt = event.createdAt ?? Date.now()
  const duplicate = events.some(
    (existing) =>
      existing.kind === event.kind &&
      (existing.nodeId ?? null) === (event.nodeId ?? null) &&
      (existing.stageId ?? null) === (event.stageId ?? null),
  )
  if (duplicate) return events

  const nextEvent: LearningMilestoneEvent = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    createdAt,
    ...event,
  }

  return [nextEvent, ...events].sort((left, right) => right.createdAt - left.createdAt).slice(0, 60)
}

export function collectNewBadgeUnlocks(previousBadges: AchievementBadge[], nextBadges: AchievementBadge[]) {
  const previousCodes = new Set(previousBadges.map((badge) => badge.code))
  return nextBadges.filter((badge) => !previousCodes.has(badge.code))
}

export function computeNodeCompletionStreak(milestoneEvents: LearningMilestoneEvent[]) {
  const nodeEvents = milestoneEvents
    .filter((event) => event.kind === 'node_complete')
    .sort((left, right) => right.createdAt - left.createdAt)

  if (nodeEvents.length === 0) return 0

  const streakWindowMs = 90 * 60 * 1000
  const freshWindowMs = 12 * 60 * 60 * 1000
  if (Date.now() - nodeEvents[0].createdAt > freshWindowMs) return 0

  let streak = 1
  for (let index = 1; index < nodeEvents.length; index += 1) {
    const previous = nodeEvents[index - 1]
    const current = nodeEvents[index]
    if (previous.createdAt - current.createdAt <= streakWindowMs) {
      streak += 1
      continue
    }
    break
  }

  return streak
}

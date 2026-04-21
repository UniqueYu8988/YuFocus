import { create } from 'zustand'
import { requestCoachTurn, resolveCoachApiConfig } from './lib/coachApi'
import {
  buildCoachSystemPrompt,
  buildCorrectionMarkdown,
  buildCurrentNodeMeta,
  buildFocusedFollowupQuestion,
  buildFollowupQuizMarkdown,
  buildLocalAnswerGuide,
  buildQuizMarkdown,
  buildSuccessMarkdown,
  buildTeachingMarkdown,
  evaluateAnswer,
  getNodeStageQuizQuestions,
  getPreferredQuizQuestion,
  isStageRecapNode,
} from './lib/coachPrompt'
import { flattenCourse, getNextNodeId, getNextSequentialNodeId, getUnlockedNodeIds, isStudyNode } from './lib/courseTree'
import type {
  AchievementBadge,
  CoachTurnResult,
  CoachMessage,
  CoursePackage,
  FlatCourseNode,
  LearningMilestoneEvent,
  LearningLibraryPayload,
  LearningRecord,
  LearningRecordSummary,
  NodeLearningSession,
  PersistedNodeLearningSession,
  QuizAttemptInsight,
  StageReplayInsight,
  TeachingIntent,
} from './types/course'

type RuntimeSettings = Awaited<ReturnType<typeof window.desktopAPI.loadSettings>>
type DistillRequestState = 'idle' | 'loading' | 'error'
type BootState = 'booting' | 'ready'
type ToastTone = 'info' | 'success' | 'error'
type DistillStage =
  | 'metadata'
  | 'subtitle'
  | 'audio'
  | 'chunking'
  | 'chunk_distilling'
  | 'batch_reducing'
  | 'synthesizing'
  | 'cache'
  | 'injecting'
  | 'complete'
  | 'unknown'
type AppToast = {
  id: string
  title: string
  description?: string
  tone: ToastTone
}
type LearningMomentumSnapshot = {
  todayCompletedCount: number
  todayStageCount: number
  recentMilestoneCount: number
  latestMilestoneAt: number | null
  currentStreak: number
  momentumLabel: string
}
type StageCelebration = {
  id: string
  stageId: string
  stageTitle: string
  completedCount: number
  totalCount: number
}
type DistillProgressSnapshot = {
  stage: DistillStage
  stageLabel: string
  message: string
  cacheHint: string | null
  audioCompleted: number
  audioTotal: number
  chunkCompleted: number
  chunkTotal: number
  batchCompleted: number
  batchTotal: number
  resumed: boolean
   prefetchReuseChunkRatio: number
   prefetchReuseBatchRatio: number
}

const DISTILL_UI_TIMEOUT_MS = 1_860_000
const TOAST_LIFETIME_MS = 3200
const STAGE_CELEBRATION_LIFETIME_MS = 4200
let toastTimer: ReturnType<typeof globalThis.setTimeout> | null = null
let stageCelebrationTimer: ReturnType<typeof globalThis.setTimeout> | null = null

function makeMessage(role: CoachMessage['role'], content: string, nodeId?: string): CoachMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    role,
    content,
    nodeId,
    createdAt: Date.now(),
  }
}

function createEmptySession(nodeId: string): NodeLearningSession {
  return {
    nodeId,
    learningStatus: 'teaching',
    messages: [],
    activeQuestion: null,
    attemptHistory: [],
    lastUserAnswer: '',
    lastEvaluation: null,
    requestState: 'idle',
    error: null,
    hydrated: false,
    preloaded: false,
    updatedAt: Date.now(),
  }
}

function appendAttemptInsight(
  attemptHistory: QuizAttemptInsight[],
  insight: Omit<QuizAttemptInsight, 'id' | 'createdAt'>,
) {
  const nextInsight: QuizAttemptInsight = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    createdAt: Date.now(),
    ...insight,
  }
  return [...attemptHistory, nextInsight].slice(-8)
}

function formatDistillTimingSummary(stageTimings?: {
  total_seconds?: number
  cache_hit?: string
  cache_total_seconds?: number
  historical_total_seconds?: number
  prefetch_chunk_warm_seconds?: number
  prefetch_chunk_count?: number
  prefetch_reuse_chunk_count?: number
  prefetch_batch_warm_seconds?: number
  prefetch_batch_count?: number
  prefetch_reuse_batch_count?: number
}) {
  if (!stageTimings) return ''
  if (stageTimings.cache_hit === 'course_package' || stageTimings.cache_hit === 'final_course_package') {
    const cacheSeconds = Number(stageTimings.cache_total_seconds ?? stageTimings.total_seconds ?? 0)
    const historicalTotalSeconds = Number(stageTimings.historical_total_seconds ?? 0)
    const cacheSummary =
      Number.isFinite(cacheSeconds) && cacheSeconds > 0
        ? cacheSeconds >= 60
          ? `本次约 ${(cacheSeconds / 60).toFixed(1)} 分钟`
          : `本次约 ${Math.round(cacheSeconds)} 秒`
        : '本次几乎瞬时完成'
    if (Number.isFinite(historicalTotalSeconds) && historicalTotalSeconds > 0) {
      const historicalSummary =
        historicalTotalSeconds >= 120
          ? `上次完整提炼约 ${(historicalTotalSeconds / 60).toFixed(1)} 分钟`
          : `上次完整提炼约 ${Math.round(historicalTotalSeconds)} 秒`
      return `命中本地缓存，${cacheSummary} · ${historicalSummary}`
    }
    return `命中本地缓存，${cacheSummary}`
  }
  const totalSeconds = Number(stageTimings.total_seconds ?? 0)
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return ''
  const prefetchSeconds = Number(stageTimings.prefetch_chunk_warm_seconds ?? 0)
  const prefetchCount = Number(stageTimings.prefetch_reuse_chunk_count ?? stageTimings.prefetch_chunk_count ?? 0)
  const prefetchBatchSeconds = Number(stageTimings.prefetch_batch_warm_seconds ?? 0)
  const prefetchBatchCount = Number(stageTimings.prefetch_reuse_batch_count ?? stageTimings.prefetch_batch_count ?? 0)
  const prefetchSummary =
    Number.isFinite(prefetchSeconds) && prefetchSeconds > 0 && Number.isFinite(prefetchCount) && prefetchCount > 0
      ? ` · 预热 ${prefetchCount} 个分片（约 ${prefetchSeconds >= 60 ? `${(prefetchSeconds / 60).toFixed(1)} 分钟` : `${Math.round(prefetchSeconds)} 秒`}）`
      : ''
  const prefetchBatchSummary =
    Number.isFinite(prefetchBatchSeconds) &&
    prefetchBatchSeconds > 0 &&
    Number.isFinite(prefetchBatchCount) &&
    prefetchBatchCount > 0
      ? ` · 预热 ${prefetchBatchCount} 个批次（约 ${prefetchBatchSeconds >= 60 ? `${(prefetchBatchSeconds / 60).toFixed(1)} 分钟` : `${Math.round(prefetchBatchSeconds)} 秒`}）`
      : ''
  if (totalSeconds >= 120) {
    return `本次提炼耗时约 ${(totalSeconds / 60).toFixed(1)} 分钟${prefetchSummary}${prefetchBatchSummary}`
  }
  return `本次提炼耗时约 ${Math.round(totalSeconds)} 秒${prefetchSummary}${prefetchBatchSummary}`
}

function normalizeDistillStage(stage?: string): DistillStage {
  switch ((stage || '').trim()) {
    case 'metadata':
      return 'metadata'
    case 'subtitle':
      return 'subtitle'
    case 'audio':
      return 'audio'
    case 'chunking':
      return 'chunking'
    case 'chunk_distilling':
      return 'chunk_distilling'
    case 'batch_reducing':
      return 'batch_reducing'
    case 'synthesizing':
      return 'synthesizing'
    case 'cache':
      return 'cache'
    case 'injecting':
      return 'injecting'
    case 'complete':
      return 'complete'
    default:
      return 'unknown'
  }
}

function formatDistillStageLabel(stage: DistillStage, cacheHint?: string | null) {
  if (stage === 'cache') {
    if (cacheHint === 'course_package') return '复用课程缓存'
    if (cacheHint === 'final_course_package') return '复用最终课包'
    return '命中缓存'
  }
  switch (stage) {
    case 'metadata':
      return '解析视频'
    case 'subtitle':
      return '抓取字幕'
    case 'audio':
      return '音频补全'
    case 'chunking':
      return '切片预处理'
    case 'chunk_distilling':
      return '蒸馏分片'
    case 'batch_reducing':
      return '批次归并'
    case 'synthesizing':
      return '最终合成'
    case 'injecting':
      return '注入界面'
    case 'complete':
      return '完成回传'
    default:
      return '处理中'
  }
}

function buildDistillProgressSnapshot(payload: DistillProgressPayload): DistillProgressSnapshot {
  const stage = normalizeDistillStage(payload.stage)
  const cacheHint = payload.cacheHint ?? null
  return {
    stage,
    stageLabel: formatDistillStageLabel(stage, cacheHint),
    message: payload.message || '正在呼叫 AI 蒸馏课程，请稍候…',
    cacheHint,
    audioCompleted: Number(payload.audioCompleted ?? 0) || 0,
    audioTotal: Number(payload.audioTotal ?? 0) || 0,
    chunkCompleted: Number(payload.chunkCompleted ?? 0) || 0,
    chunkTotal: Number(payload.chunkTotal ?? 0) || 0,
    batchCompleted: Number(payload.batchCompleted ?? 0) || 0,
    batchTotal: Number(payload.batchTotal ?? 0) || 0,
    resumed: Boolean(payload.resumed),
    prefetchReuseChunkRatio: Number(payload.prefetchReuseChunkRatio ?? 0) || 0,
    prefetchReuseBatchRatio: Number(payload.prefetchReuseBatchRatio ?? 0) || 0,
  }
}

function restoreSession(nodeId: string, persisted?: PersistedNodeLearningSession | null): NodeLearningSession {
  if (!persisted) {
    return createEmptySession(nodeId)
  }

  return {
    nodeId,
    learningStatus: persisted.learningStatus,
    messages: Array.isArray(persisted.messages) ? persisted.messages : [],
    activeQuestion: persisted.activeQuestion ?? null,
    attemptHistory: Array.isArray(persisted.attemptHistory) ? persisted.attemptHistory : [],
    lastUserAnswer: persisted.lastUserAnswer ?? '',
    lastEvaluation: persisted.lastEvaluation ?? null,
    requestState: 'idle',
    error: null,
    hydrated: Boolean(persisted.hydrated),
    preloaded: Boolean(persisted.preloaded),
    updatedAt: persisted.updatedAt ?? Date.now(),
  }
}

function persistSession(session: NodeLearningSession): PersistedNodeLearningSession {
  return {
    nodeId: session.nodeId,
    learningStatus: session.learningStatus,
    messages: session.messages,
    activeQuestion: session.activeQuestion,
    attemptHistory: session.attemptHistory,
    lastUserAnswer: session.lastUserAnswer,
    lastEvaluation: session.lastEvaluation,
    hydrated: session.hydrated,
    preloaded: session.preloaded,
    updatedAt: session.updatedAt,
  }
}

function buildFallbackCoachTurn(options: {
  node: FlatCourseNode
  dependencyTitles: string[]
  learningStatus: 'teaching' | 'quizzing' | 'correcting'
  activeQuestion?: string | null
  answer?: string
  nextNode: FlatCourseNode | null
  teachingIntent?: TeachingIntent
}): CoachTurnResult {
  const { node, dependencyTitles, learningStatus, activeQuestion, answer = '', nextNode, teachingIntent = 'default' } = options
  const preferredQuestion = getPreferredQuizQuestion(node, activeQuestion)

  if (learningStatus === 'teaching') {
    return {
      reply: [buildTeachingMarkdown(node, dependencyTitles, teachingIntent), buildQuizMarkdown(node, preferredQuestion)].join('\n\n'),
      learningStatus: 'quizzing',
      markCurrentNodeCompleted: false,
      suggestedNextNodeId: null,
    }
  }

  const answerGuide = buildLocalAnswerGuide(node, answer, preferredQuestion)
  const heuristic = evaluateAnswer(node, answer)
  const correct =
    answerGuide.likelyVerdict === 'likely_correct' ||
    (answerGuide.likelyVerdict === 'uncertain' && heuristic.correct)
  const partial =
    !correct &&
    (answerGuide.likelyVerdict === 'likely_partial' ||
      (answerGuide.matchedKeywords.length > 0 && answerGuide.missingKeywords.length > 0))

  if (correct) {
    return {
      reply: buildSuccessMarkdown(node, nextNode),
      learningStatus: 'completed',
      markCurrentNodeCompleted: true,
      suggestedNextNodeId: nextNode?.id ?? null,
    }
  }

  if (partial) {
    const cautionHint =
      answerGuide.cautionNotes.length > 0
        ? `\n\n**继续补一句：** 别忘了顺手避开 ${answerGuide.cautionNotes.join('；')}`
        : ''

    return {
      reply: `${buildFollowupQuizMarkdown(node, answerGuide, preferredQuestion)}${cautionHint}`.trim(),
      learningStatus: 'quizzing',
      markCurrentNodeCompleted: false,
      suggestedNextNodeId: null,
    }
  }

  const missingHint =
    answerGuide.missingKeywords.length > 0
      ? `\n\n**这次还漏掉了：** ${answerGuide.missingKeywords.join('、')}`
      : ''
  const cautionHint =
    answerGuide.cautionNotes.length > 0
      ? `\n\n**特别提醒：** ${answerGuide.cautionNotes.join('；')}`
      : ''

  return {
    reply: `${buildCorrectionMarkdown(node, answer)}${missingHint}${cautionHint}\n\n${buildQuizMarkdown(node, preferredQuestion)}`.trim(),
    learningStatus: 'correcting',
    markCurrentNodeCompleted: false,
    suggestedNextNodeId: null,
  }
}

function resolveTrackedQuestion(node: FlatCourseNode, learningStatus: string, fallback: string | null) {
  const stageQuizQuestions = getNodeStageQuizQuestions(node)
  if (!isStageRecapNode(node) || stageQuizQuestions.length === 0) {
    return fallback
  }
  if (fallback && stageQuizQuestions.some((question) => fallback.includes(question) || question.includes(fallback))) {
    return fallback
  }
  if (learningStatus === 'correcting' || learningStatus === 'quizzing') {
    return fallback || stageQuizQuestions[0]
  }
  return fallback
}

function resolveReplayPreferredQuestion(stageReplay: StageReplayInsight | null, fallback: string | null) {
  if (fallback && fallback.trim()) return fallback
  if (!stageReplay) return null
  return stageReplay.focusQuestions[0] ?? stageReplay.followupQuestions[0] ?? null
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

function buildStageReplayInsight(
  currentNode: FlatCourseNode | null,
  nodeMap: Record<string, FlatCourseNode>,
  nodeSessions: Record<string, NodeLearningSession>,
): StageReplayInsight | null {
  if (!currentNode || !isStageRecapNode(currentNode) || !currentNode.parentId) {
    return null
  }

  const stageStudyNodeIds = collectDescendantStudyNodeIds(currentNode.parentId, nodeMap).filter((nodeId) => nodeId !== currentNode.id)
  const recentAttempts = stageStudyNodeIds
    .flatMap((nodeId) => nodeSessions[nodeId]?.attemptHistory ?? [])
    .filter((attempt) => attempt.verdict !== 'correct')
    .sort((left, right) => right.createdAt - left.createdAt)

  if (recentAttempts.length === 0) {
    return null
  }

  const keywordScores = new Map<string, number>()
  const cautionScores = new Map<string, number>()
  const questionScores = new Map<string, number>()
  const nodeTitleScores = new Map<string, number>()

  recentAttempts.slice(0, 6).forEach((attempt, index) => {
    const weight = Math.max(1, 6 - index) * (attempt.verdict === 'partial' ? 0.65 : 1)
    attempt.missingKeywords.forEach((keyword) => {
      keywordScores.set(keyword, (keywordScores.get(keyword) ?? 0) + weight)
    })
    attempt.cautionNotes.forEach((note) => {
      cautionScores.set(note, (cautionScores.get(note) ?? 0) + weight)
    })
    if (attempt.question) {
      questionScores.set(attempt.question, (questionScores.get(attempt.question) ?? 0) + weight)
    }
    nodeTitleScores.set(attempt.nodeTitle, (nodeTitleScores.get(attempt.nodeTitle) ?? 0) + weight)
  })

  const sortByScore = (scoreMap: Map<string, number>) =>
    [...scoreMap.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([value]) => value)

  const focusNodeTitles = sortByScore(nodeTitleScores).slice(0, 3)
  const focusQuestions = sortByScore(questionScores).slice(0, 2)
  const focusKeywords = sortByScore(keywordScores).slice(0, 5)
  const cautionNotes = sortByScore(cautionScores).slice(0, 3)

  const followupQuestions = [
    focusKeywords.length > 0
      ? `如果让你现在重新解释一次，请把 ${focusKeywords.slice(0, 2).join('、')} 这几个关键词自然带进去。你会怎么说？`
      : '',
    focusNodeTitles.length > 0
      ? `回到 ${focusNodeTitles[0]} 这一小关，你最容易漏掉的关键动作或判断依据是什么？`
      : '',
    cautionNotes.length > 0
      ? `如果再来一次，怎样回答才能避开“${cautionNotes[0]}”这个常见错误？`
      : '',
  ].filter(Boolean)

  return {
    recentMistakeCount: recentAttempts.length,
    focusNodeTitles,
    focusQuestions,
    focusKeywords,
    cautionNotes,
    followupQuestions,
  }
}

function normalizeProgressState(
  orderedStudyNodeIds: string[],
  completedNodeIds: string[],
  failedNodeIds: string[],
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

  const failed = failedNodeIds.filter((nodeId) => validStudyIds.has(nodeId) && !completed.has(nodeId))

  return {
    completedNodeIds: [...completed],
    failedNodeIds: failed,
  }
}

function isEffectivelyCompletedSession(session: NodeLearningSession | PersistedNodeLearningSession | null | undefined) {
  return session?.learningStatus === 'completed' || session?.lastEvaluation === 'correct'
}

function buildEffectiveCompletedNodeIds(
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

function resolveStageCelebration(
  nodeId: string,
  nodeMap: Record<string, FlatCourseNode>,
  previousCompletedNodeIds: string[],
  nextCompletedNodeIds: string[],
): StageCelebration | null {
  const stageNode = getRootStageNode(nodeId, nodeMap)
  if (!stageNode) return null

  const stageStudyNodeIds = collectDescendantStudyNodeIds(stageNode.id, nodeMap)
  if (stageStudyNodeIds.length === 0) return null

  const previousCompletedCount = stageStudyNodeIds.filter((studyNodeId) => previousCompletedNodeIds.includes(studyNodeId)).length
  const nextCompletedCount = stageStudyNodeIds.filter((studyNodeId) => nextCompletedNodeIds.includes(studyNodeId)).length

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

function buildCourseState(
  course: CoursePackage,
  importedPath: string | null,
  completedNodeIds: string[],
  failedNodeIds: string[],
  preferredCurrentNodeId: string | null,
  persistedSessions: Record<string, PersistedNodeLearningSession> = {},
) {
  const flattened = flattenCourse(course)
  const orderedStudyNodeIds = flattened.orderedStudyNodeIds
  const normalizedProgress = normalizeProgressState(
    orderedStudyNodeIds,
    completedNodeIds,
    failedNodeIds,
    persistedSessions,
  )
  const unlockedNodeIds = getUnlockedNodeIds(flattened.nodeMap, normalizedProgress.completedNodeIds)
  const fallbackCurrentNodeId = getNextNodeId(orderedStudyNodeIds, flattened.nodeMap, normalizedProgress.completedNodeIds)
  const currentNodeId =
    preferredCurrentNodeId && orderedStudyNodeIds.includes(preferredCurrentNodeId) && unlockedNodeIds.includes(preferredCurrentNodeId)
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
    failedNodeIds: normalizedProgress.failedNodeIds,
    nodeSessions,
  }
}

function mergeRecordIntoCourseState(
  course: CoursePackage,
  importedPath: string | null,
  record: LearningRecord,
) {
  const flattened = flattenCourse(course)
  const completedNodeIds = (record.completedNodeIds ?? []).filter((nodeId) =>
    flattened.nodeMap[nodeId],
  )
  const failedNodeIds = (record.failedNodeIds ?? []).filter((nodeId) =>
    flattened.nodeMap[nodeId],
  )
  const persistedSessions = Object.entries(record.nodeSessions ?? {}).reduce<Record<string, PersistedNodeLearningSession>>(
    (accumulator, [nodeId, session]) => {
      if (flattened.nodeMap[nodeId]) {
        accumulator[nodeId] = session
      }
      return accumulator
    },
    {},
  )

  return buildCourseState(
    course,
    importedPath,
    completedNodeIds,
    failedNodeIds,
    record.currentNodeId ?? null,
    persistedSessions,
  )
}

function buildAchievementBadgesSummary(
  completedCount: number,
  progressPercent: number,
  milestoneEvents: LearningMilestoneEvent[],
) {
  const stageCompleteCount = new Set(
    milestoneEvents.filter((event) => event.kind === 'stage_complete' && event.stageId).map((event) => event.stageId as string),
  ).size
  const hasComeback = milestoneEvents.some((event) => event.kind === 'correction_recovery')
  const badges: AchievementBadge[] = []

  if (completedCount >= 1) {
    badges.push({
      code: 'first_step',
      label: '起步完成',
      description: '已经顺利拿下第一个小关，开始进入学习节奏。',
      tone: 'neutral',
    })
  }

  if (completedCount >= 5) {
    badges.push({
      code: 'steady_stride',
      label: '稳定推进',
      description: '连续推进多个小关，节奏已经慢慢稳住了。',
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

  if (hasComeback) {
    badges.push({
      code: 'comeback',
      label: '越错越稳',
      description: '出现过卡点，但靠纠错真正掌握住了。',
      tone: 'info',
    })
  }

  if (progressPercent >= 50) {
    badges.push({
      code: 'midway',
      label: '半程已过',
      description: '这门课已经进入中段，不再只是开始试水。',
      tone: 'success',
    })
  }

  if (progressPercent >= 100) {
    badges.push({
      code: 'course_finisher',
      label: '结课归档',
      description: '整门课程已经完成，可以沉淀为长期知识资产。',
      tone: 'success',
    })
  }

  return badges
}

function appendMilestoneEvent(
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

function collectNewBadgeUnlocks(previousBadges: AchievementBadge[], nextBadges: AchievementBadge[]) {
  const previousCodes = new Set(previousBadges.map((badge) => badge.code))
  return nextBadges.filter((badge) => !previousCodes.has(badge.code))
}

function computeNodeCompletionStreak(milestoneEvents: LearningMilestoneEvent[]) {
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

type LearningStore = {
  bootState: BootState
  runtimeSettings: RuntimeSettings | null
  distillRequestState: DistillRequestState
  distillProgressPercent: number
  distillStatusMessage: string
  distillError: string | null
  distillOutlinePreview: DistillOutlinePreview | null
  distillProgressSnapshot: DistillProgressSnapshot | null
  videoInput: string
  toast: AppToast | null
  stageCelebration: StageCelebration | null
  milestoneEvents: LearningMilestoneEvent[]

  libraryRecords: LearningRecordSummary[]
  activeRecordId: string | null
  activeRecordCreatedAt: number | null

  courseData: CoursePackage | null
  importedCoursePath: string | null
  nodeMap: Record<string, FlatCourseNode>
  rootNodeIds: string[]
  orderedNodeIds: string[]
  orderedStudyNodeIds: string[]

  currentNodeId: string | null
  unlockedNodeIds: string[]
  completedNodeIds: string[]
  failedNodeIds: string[]
  nodeSessions: Record<string, NodeLearningSession>

  hydrateApp: () => Promise<void>
  loadRuntimeSettings: () => Promise<void>
  setRuntimeSettings: (runtimeSettings: RuntimeSettings) => void
  refreshLibrary: () => Promise<LearningLibraryPayload>
  loadCourse: (course: CoursePackage, importedPath?: string | null) => Promise<void>
  loadCourseFromText: (text: string, importedPath?: string | null) => Promise<void>
  restoreLearningRecord: (record: LearningRecord) => Promise<void>
  openSavedRecord: (recordId: string) => Promise<void>
  openDeepLinkedNode: (packageId: string, nodeId?: string | null) => Promise<void>
  deleteSavedRecord: (recordId: string) => Promise<void>
  importCoursePackage: () => Promise<void>
  setVideoInput: (value: string) => void
  distillCourseFromVideo: () => Promise<void>
  setCurrentNode: (nodeId: string) => void
  openNodeSession: (nodeId: string, options?: { forceRestart?: boolean; teachingIntent?: TeachingIntent }) => Promise<void>
  reteachCurrentNode: (teachingIntent?: Exclude<TeachingIntent, 'default'>) => Promise<void>
  startQuizForCurrentNode: () => Promise<void>
  submitUserAnswer: (answer: string) => Promise<void>
  appendCoachMessage: (message: CoachMessage) => void
  recomputeUnlockedNodes: () => void
  goToNextNode: () => Promise<void>
  saveCurrentProgress: () => Promise<void>
  preloadNextNode: (nodeId: string | null) => Promise<void>
  pushToast: (title: string, description?: string, tone?: ToastTone) => void
  dismissToast: () => void
  dismissStageCelebration: () => void

  isNodeUnlocked: (nodeId: string) => boolean
  isNodeCompleted: (nodeId: string) => boolean
  isStudyNode: (nodeId: string) => boolean
  getCurrentAchievementBadges: () => AchievementBadge[]
  getRecentMilestones: (limit?: number) => LearningMilestoneEvent[]
  getMomentumSnapshot: () => LearningMomentumSnapshot
  getCurrentNode: () => FlatCourseNode | null
  getCurrentSession: () => NodeLearningSession | null
  getCurrentNodeMeta: () => ReturnType<typeof buildCurrentNodeMeta>
  getCurrentStageReplay: () => StageReplayInsight | null
}

type LearningStoreSetter = (
  partial:
    | Partial<LearningStore>
    | ((state: LearningStore) => Partial<LearningStore>),
  replace?: false,
) => void

function emitToast(set: LearningStoreSetter, toast: Omit<AppToast, 'id'>) {
  if (toastTimer) {
    globalThis.clearTimeout(toastTimer)
    toastTimer = null
  }

  const nextToast: AppToast = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    ...toast,
  }

  set({ toast: nextToast })

  toastTimer = globalThis.setTimeout(() => {
    set((state) => (state.toast?.id === nextToast.id ? { toast: null } : {}))
    toastTimer = null
  }, TOAST_LIFETIME_MS)
}

function emitStageCelebration(set: LearningStoreSetter, celebration: StageCelebration) {
  if (stageCelebrationTimer) {
    globalThis.clearTimeout(stageCelebrationTimer)
    stageCelebrationTimer = null
  }

  set({ stageCelebration: celebration })

  stageCelebrationTimer = globalThis.setTimeout(() => {
    set((state) => (state.stageCelebration?.id === celebration.id ? { stageCelebration: null } : {}))
    stageCelebrationTimer = null
  }, STAGE_CELEBRATION_LIFETIME_MS)
}

export const useLearningStore = create<LearningStore>((set, get) => ({
  bootState: 'booting',
  runtimeSettings: null,
  distillRequestState: 'idle',
  distillProgressPercent: 0,
  distillStatusMessage: '',
  distillError: null,
  distillOutlinePreview: null,
  distillProgressSnapshot: null,
  videoInput: '',
  toast: null,
  stageCelebration: null,
  milestoneEvents: [],

  libraryRecords: [],
  activeRecordId: null,
  activeRecordCreatedAt: null,

  courseData: null,
  importedCoursePath: null,
  nodeMap: {},
  rootNodeIds: [],
  orderedNodeIds: [],
  orderedStudyNodeIds: [],

  currentNodeId: null,
  unlockedNodeIds: [],
  completedNodeIds: [],
  failedNodeIds: [],
  nodeSessions: {},

  hydrateApp: async () => {
    await get().loadRuntimeSettings()
    const library = await get().refreshLibrary()

    if (library.currentRecordId) {
      try {
        const record = await window.desktopAPI.openLearningRecord(library.currentRecordId)
        await get().restoreLearningRecord(record)
      } finally {
        set({ bootState: 'ready' })
      }
      return
    }

    set({
      bootState: 'ready',
      courseData: null,
      importedCoursePath: null,
      nodeMap: {},
      rootNodeIds: [],
      orderedNodeIds: [],
      orderedStudyNodeIds: [],
      currentNodeId: null,
      unlockedNodeIds: [],
      completedNodeIds: [],
      failedNodeIds: [],
      nodeSessions: {},
      activeRecordId: null,
      activeRecordCreatedAt: null,
      stageCelebration: null,
      milestoneEvents: [],
    })
  },

  loadRuntimeSettings: async () => {
    const runtimeSettings = await window.desktopAPI.loadSettings()
    set({ runtimeSettings })
  },

  setRuntimeSettings: (runtimeSettings) => {
    set({
      runtimeSettings,
      distillError: null,
    })
  },

  refreshLibrary: async () => {
    const payload = await window.desktopAPI.loadLearningLibrary()
    set({
      libraryRecords: payload.records,
      activeRecordId: payload.currentRecordId,
    })
    return payload
  },

  loadCourse: async (course, importedPath = null) => {
    const existingSummary = get().libraryRecords.find((record) => record.packageId === course.package_id)
    let nextState = buildCourseState(course, importedPath, [], [], null)
    let activeRecordId = course.package_id
    let activeRecordCreatedAt: number | null = null
    let milestoneEvents: LearningMilestoneEvent[] = []

    if (existingSummary) {
      try {
        const existingRecord = await window.desktopAPI.openLearningRecord(existingSummary.id)
        nextState = mergeRecordIntoCourseState(course, importedPath, existingRecord)
        activeRecordId = existingRecord.id
        activeRecordCreatedAt = existingRecord.createdAt
        milestoneEvents = existingRecord.milestoneEvents ?? []
      } catch {
        // fall back to a fresh course state if the stored record is unavailable
      }
    }

    set({
      ...nextState,
      activeRecordId,
      activeRecordCreatedAt,
      distillError: null,
      distillProgressSnapshot: null,
      stageCelebration: null,
      milestoneEvents,
    })
    await get().saveCurrentProgress()
    if (nextState.currentNodeId) {
      await get().openNodeSession(nextState.currentNodeId)
    }
  },

  loadCourseFromText: async (text, importedPath = null) => {
    const parsed = JSON.parse(text) as CoursePackage
    await get().loadCourse(parsed, importedPath)
  },

  restoreLearningRecord: async (record) => {
    const parsed = JSON.parse(record.courseText) as CoursePackage
    const nextState = buildCourseState(
      parsed,
      record.packagePath ?? record.importedCoursePath ?? null,
      record.completedNodeIds ?? [],
      record.failedNodeIds ?? [],
      record.currentNodeId ?? null,
      record.nodeSessions ?? {},
    )

    set({
      ...nextState,
      activeRecordId: record.id,
      activeRecordCreatedAt: record.createdAt,
      distillError: null,
      distillProgressSnapshot: null,
      stageCelebration: null,
      milestoneEvents: record.milestoneEvents ?? [],
    })

    const currentSession = nextState.currentNodeId ? nextState.nodeSessions[nextState.currentNodeId] : null
    if (nextState.currentNodeId && (!currentSession || !currentSession.hydrated)) {
      await get().openNodeSession(nextState.currentNodeId)
    } else {
      await get().saveCurrentProgress()
      await get().preloadNextNode(nextState.currentNodeId)
    }
  },

  openSavedRecord: async (recordId) => {
    const record = await window.desktopAPI.openLearningRecord(recordId)
    await get().restoreLearningRecord(record)
    await get().refreshLibrary()
    get().pushToast('已恢复学习', `回到《${record.title}》`, 'success')
  },

  openDeepLinkedNode: async (packageId, nodeId = null) => {
    if (!packageId) return

    let targetRecord =
      get().libraryRecords.find((record) => record.packageId === packageId || record.id === packageId) ?? null

    if (!targetRecord) {
      const library = await get().refreshLibrary()
      targetRecord = library.records.find((record) => record.packageId === packageId || record.id === packageId) ?? null
    }

    if (!targetRecord) {
      get().pushToast('找不到这门课程', '这条 Obsidian 回跳链接对应的课程还没有出现在本地学习档案里。', 'error')
      return
    }

    if (get().activeRecordId !== targetRecord.id || get().courseData?.package_id !== targetRecord.packageId) {
      const record = await window.desktopAPI.openLearningRecord(targetRecord.id)
      await get().restoreLearningRecord(record)
      await get().refreshLibrary()
    }

    const state = get()
    if (!nodeId) {
      get().pushToast('已回到课程', `已打开《${targetRecord.title}》`, 'success')
      return
    }

    const node = state.nodeMap[nodeId]
    if (!node) {
      get().pushToast('已回到课程', `已打开《${targetRecord.title}》，但没有找到对应节点。`, 'info')
      return
    }

    if (!state.isStudyNode(nodeId)) {
      get().pushToast('已回到课程', `已打开《${targetRecord.title}》，该链接对应的是目录节点。`, 'info')
      return
    }

    if (!state.isNodeUnlocked(nodeId)) {
      get().pushToast('节点暂未解锁', `已回到《${targetRecord.title}》，但《${node.title}》还不能直接进入。`, 'info')
      return
    }

    await get().openNodeSession(nodeId)
    get().pushToast('已跳回当前小节', `继续学习《${node.title}》`, 'success')
  },

  deleteSavedRecord: async (recordId) => {
    const currentRecordId = get().activeRecordId
    const record = get().libraryRecords.find((item) => item.id === recordId) ?? null
    const payload = await window.desktopAPI.deleteLearningRecord(recordId)
    set({
      libraryRecords: payload.records,
      activeRecordId: payload.currentRecordId,
    })

    if (currentRecordId === recordId) {
      if (payload.currentRecordId) {
        const record = await window.desktopAPI.openLearningRecord(payload.currentRecordId)
        await get().restoreLearningRecord(record)
      } else {
        set({
          courseData: null,
          importedCoursePath: null,
          nodeMap: {},
          rootNodeIds: [],
          orderedNodeIds: [],
          orderedStudyNodeIds: [],
          currentNodeId: null,
          unlockedNodeIds: [],
          completedNodeIds: [],
          failedNodeIds: [],
          nodeSessions: {},
          activeRecordId: null,
          activeRecordCreatedAt: null,
        })
      }
    }
    get().pushToast('学习记录已删除', record ? `《${record.title}》已从本地档案柜移除` : '本地记录已移除', 'success')
  },

  importCoursePackage: async () => {
    const result = await window.desktopAPI.importCoursePackage()
    if (!result) return
    await get().loadCourseFromText(result.text, result.path)
    await get().refreshLibrary()
    try {
      const parsed = JSON.parse(result.text) as CoursePackage
      get().pushToast('课程包已导入', `已载入《${parsed.course.title}》`, 'success')
    } catch {
      get().pushToast('课程包已导入', result.path, 'success')
    }
  },

  setVideoInput: (value) => {
    set({
      videoInput: value,
      distillError: null,
      distillRequestState: 'idle',
      distillProgressPercent: 0,
      distillOutlinePreview: null,
      distillProgressSnapshot: null,
    })
  },

  distillCourseFromVideo: async () => {
    const videoInput = get().videoInput.trim()
    if (!videoInput) {
      set({
        distillRequestState: 'error',
        distillError: '请先粘贴 B 站视频链接或 BV 号。',
      })
      return
    }

    set({
      distillRequestState: 'loading',
      distillProgressPercent: 3,
      distillStatusMessage: '正在呼叫 AI 蒸馏课程，请稍候…',
      distillError: null,
      distillOutlinePreview: null,
      distillProgressSnapshot: {
        stage: 'unknown',
        stageLabel: '准备启动',
        message: '正在呼叫 AI 蒸馏课程，请稍候…',
        cacheHint: null,
        audioCompleted: 0,
        audioTotal: 0,
        chunkCompleted: 0,
        chunkTotal: 0,
        batchCompleted: 0,
        batchTotal: 0,
        resumed: false,
        prefetchReuseChunkRatio: 0,
        prefetchReuseBatchRatio: 0,
      },
    })

    const unsubscribe = window.desktopAPI.onDistillProgress((payload) => {
      const snapshot = buildDistillProgressSnapshot(payload)
      set({
        distillProgressPercent: Number(payload.percent || 0),
        distillStatusMessage: payload.message || '正在呼叫 AI 蒸馏课程，请稍候…',
        distillOutlinePreview: payload.outlinePreview ?? get().distillOutlinePreview,
        distillProgressSnapshot: snapshot,
      })
    })

    try {
      const result = await Promise.race([
        window.desktopAPI.runDistillation({ video: videoInput }),
        new Promise<never>((_, reject) => {
          globalThis.setTimeout(() => {
            reject(new Error(`蒸馏流程等待超时（>${Math.floor(DISTILL_UI_TIMEOUT_MS / 1000)} 秒）。`))
          }, DISTILL_UI_TIMEOUT_MS)
        }),
      ])
      await get().loadCourseFromText(result.text, result.packagePath)
      await get().refreshLibrary()
      set({
        distillRequestState: 'idle',
        distillProgressPercent: 100,
        distillStatusMessage: '',
        distillError: null,
        distillOutlinePreview: null,
        distillProgressSnapshot: null,
        videoInput: '',
      })
      const timingSummary = formatDistillTimingSummary(result.stageTimings)
      get().pushToast(
        '课程提炼完成',
        timingSummary ? `《${result.title}》已注入伴学界面 · ${timingSummary}` : `《${result.title}》已注入伴学界面`,
        'success',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '课程蒸馏失败'
      set({
        distillRequestState: 'error',
        distillProgressPercent: 0,
        distillStatusMessage: '',
        distillError: message,
        distillOutlinePreview: get().distillOutlinePreview,
        distillProgressSnapshot: get().distillProgressSnapshot,
      })
      get().pushToast('提炼失败', message, 'error')
    } finally {
      unsubscribe()
    }
  },

  setCurrentNode: (nodeId) => {
    if (!get().isNodeUnlocked(nodeId) || !get().isStudyNode(nodeId)) return
    void get().openNodeSession(nodeId)
  },

  openNodeSession: async (nodeId, options: { forceRestart?: boolean; teachingIntent?: TeachingIntent } = {}) => {
    const state = get()
    const node = state.nodeMap[nodeId]
    if (!node || !state.courseData || !state.isNodeUnlocked(nodeId) || !state.isStudyNode(nodeId)) return

    const existingSession = state.nodeSessions[nodeId] ?? createEmptySession(nodeId)

    set((latestState) => ({
      currentNodeId: nodeId,
      nodeSessions: {
        ...latestState.nodeSessions,
        [nodeId]: {
          ...existingSession,
          preloaded: false,
          error: null,
        },
      },
    }))

    if (existingSession.hydrated && !options.forceRestart) {
      await get().saveCurrentProgress()
      await get().preloadNextNode(nodeId)
      return
    }

    await state.loadRuntimeSettings()
    const runtimeSettings = get().runtimeSettings
    if (!runtimeSettings) return

    const dependencyTitles = node.dependencies.map((dependencyId) => state.nodeMap[dependencyId]?.title).filter(Boolean) as string[]
    const stageReplay = buildStageReplayInsight(node, state.nodeMap, state.nodeSessions)
    const replayQuestion = resolveReplayPreferredQuestion(stageReplay, existingSession.activeQuestion)
    const teachingIntent = options.teachingIntent ?? 'default'
    const systemPrompt = buildCoachSystemPrompt(state.courseData, node, 'teaching', dependencyTitles, teachingIntent)
    const nextMessages = [makeMessage('system', systemPrompt, nodeId)]

    set((latestState) => ({
      currentNodeId: nodeId,
      nodeSessions: {
        ...latestState.nodeSessions,
        [nodeId]: {
          ...createEmptySession(nodeId),
          messages: nextMessages,
          requestState: 'loading',
          updatedAt: Date.now(),
        },
      },
    }))

    try {
      const turn = await requestCoachTurn({
        config: resolveCoachApiConfig(runtimeSettings),
        courseData: state.courseData,
        currentNode: node,
        dependencyTitles,
        learningStatus: 'teaching',
        messages: nextMessages,
        activeQuestion: replayQuestion,
        stageReplay,
        teachingIntent,
        unlockedNodeIds: get().unlockedNodeIds,
        completedNodeIds: get().completedNodeIds,
      })

      const trackedQuestion = resolveTrackedQuestion(
        node,
        turn.learningStatus,
        replayQuestion,
      )

      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [nodeId]: {
            ...latestState.nodeSessions[nodeId],
            messages: [...nextMessages, makeMessage('coach', turn.reply, nodeId)],
            learningStatus: turn.learningStatus,
            activeQuestion: turn.learningStatus === 'quizzing' ? trackedQuestion || turn.reply : null,
            requestState: 'idle',
            error: null,
            hydrated: true,
            preloaded: false,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
      await get().preloadNextNode(nodeId)
    } catch (error) {
      const nextNodeId = getNextSequentialNodeId(state.orderedStudyNodeIds, nodeId)
      const nextNode = nextNodeId ? state.nodeMap[nextNodeId] ?? null : null
      const fallbackTurn = buildFallbackCoachTurn({
        node,
        dependencyTitles,
        learningStatus: 'teaching',
        activeQuestion: replayQuestion,
        nextNode,
        teachingIntent,
      })
      const trackedQuestion = resolveTrackedQuestion(
        node,
        fallbackTurn.learningStatus,
        replayQuestion,
      )
      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [nodeId]: {
            ...latestState.nodeSessions[nodeId],
            messages: [
              ...latestState.nodeSessions[nodeId].messages,
              makeMessage('coach', fallbackTurn.reply, nodeId),
            ],
            learningStatus: fallbackTurn.learningStatus,
            activeQuestion: fallbackTurn.learningStatus === 'quizzing' ? trackedQuestion || fallbackTurn.reply : null,
            requestState: 'idle',
            error: null,
            hydrated: true,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
    }
  },

  reteachCurrentNode: async (teachingIntent = 'reframe') => {
    const state = get()
    if (!state.currentNodeId) return
    await get().openNodeSession(state.currentNodeId, { forceRestart: true, teachingIntent })
  },

  startQuizForCurrentNode: async () => {
    await get().loadRuntimeSettings()
    const state = get()
    const node = state.getCurrentNode()
    const session = state.getCurrentSession()
    if (!node || !state.courseData || !state.runtimeSettings || !session) return

    const dependencyTitles = node.dependencies.map((dependencyId) => state.nodeMap[dependencyId]?.title).filter(Boolean) as string[]
    const stageReplay = buildStageReplayInsight(node, state.nodeMap, state.nodeSessions)
    const replayQuestion = resolveReplayPreferredQuestion(stageReplay, session.activeQuestion)

    set((latestState) => ({
      nodeSessions: {
        ...latestState.nodeSessions,
        [node.id]: {
          ...latestState.nodeSessions[node.id],
          requestState: 'loading',
          error: null,
          updatedAt: Date.now(),
        },
      },
    }))

    try {
      const turn = await requestCoachTurn({
        config: resolveCoachApiConfig(state.runtimeSettings),
        courseData: state.courseData,
        currentNode: node,
        dependencyTitles,
        learningStatus: 'quizzing',
        messages: session.messages,
        activeQuestion: replayQuestion,
        stageReplay,
        unlockedNodeIds: state.unlockedNodeIds,
        completedNodeIds: state.completedNodeIds,
      })

      const trackedQuestion = resolveTrackedQuestion(
        node,
        turn.learningStatus,
        replayQuestion,
      )

      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [node.id]: {
            ...latestState.nodeSessions[node.id],
            messages: [...latestState.nodeSessions[node.id].messages, makeMessage('coach', turn.reply, node.id)],
            learningStatus: turn.learningStatus,
            activeQuestion:
              turn.learningStatus === 'quizzing' || turn.learningStatus === 'correcting'
                ? trackedQuestion || latestState.nodeSessions[node.id].activeQuestion
                : latestState.nodeSessions[node.id].activeQuestion,
            requestState: 'idle',
            error: null,
            hydrated: true,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
    } catch (error) {
      const nextNodeId = getNextSequentialNodeId(state.orderedStudyNodeIds, node.id)
      const nextNode = nextNodeId ? state.nodeMap[nextNodeId] ?? null : null
      const fallbackTurn = buildFallbackCoachTurn({
        node,
        dependencyTitles,
        learningStatus: 'quizzing',
        activeQuestion: replayQuestion,
        nextNode,
      })
      const trackedQuestion = resolveTrackedQuestion(
        node,
        fallbackTurn.learningStatus,
        replayQuestion,
      )
      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [node.id]: {
            ...latestState.nodeSessions[node.id],
            messages: [...latestState.nodeSessions[node.id].messages, makeMessage('coach', fallbackTurn.reply, node.id)],
            learningStatus: fallbackTurn.learningStatus,
            activeQuestion:
              fallbackTurn.learningStatus === 'quizzing' || fallbackTurn.learningStatus === 'correcting'
                ? trackedQuestion || latestState.nodeSessions[node.id].activeQuestion
                : latestState.nodeSessions[node.id].activeQuestion,
            requestState: 'idle',
            error: null,
            hydrated: true,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
    }
  },

  submitUserAnswer: async (answer) => {
    await get().loadRuntimeSettings()
    const state = get()
    const node = state.getCurrentNode()
    const session = state.getCurrentSession()
    if (!node || !state.courseData || !state.runtimeSettings || !session) return

    const userMessage = makeMessage('user', answer, node.id)
    const dependencyTitles = node.dependencies.map((dependencyId) => state.nodeMap[dependencyId]?.title).filter(Boolean) as string[]
    const pendingMessages = [...session.messages, userMessage]
    const stageReplay = buildStageReplayInsight(node, state.nodeMap, state.nodeSessions)
    const currentQuestion = resolveReplayPreferredQuestion(stageReplay, session.activeQuestion)
    const localAnswerGuide = buildLocalAnswerGuide(node, answer, currentQuestion)

    set((latestState) => ({
      nodeSessions: {
        ...latestState.nodeSessions,
        [node.id]: {
          ...latestState.nodeSessions[node.id],
          messages: pendingMessages,
          requestState: 'loading',
          error: null,
          lastUserAnswer: answer,
          updatedAt: Date.now(),
        },
      },
    }))

    try {
      const turn = await requestCoachTurn({
        config: resolveCoachApiConfig(state.runtimeSettings),
        courseData: state.courseData,
        currentNode: node,
        dependencyTitles,
        learningStatus: session.learningStatus === 'completed' ? 'quizzing' : session.learningStatus,
        messages: pendingMessages,
        userAnswer: answer,
        activeQuestion: currentQuestion,
        stageReplay,
        unlockedNodeIds: state.unlockedNodeIds,
        completedNodeIds: state.completedNodeIds,
      })

      const evaluation =
        turn.markCurrentNodeCompleted ? 'correct' : turn.learningStatus === 'quizzing' ? 'partial' : 'incorrect'
      const followupQuestion =
        evaluation === 'partial' ? buildFocusedFollowupQuestion(node, localAnswerGuide, currentQuestion) : currentQuestion
      const trackedQuestion = resolveTrackedQuestion(node, turn.learningStatus, followupQuestion)

      const alreadyCompleted = state.completedNodeIds.includes(node.id)
      const completedNodeIds = turn.markCurrentNodeCompleted && !alreadyCompleted
        ? [...state.completedNodeIds, node.id]
        : state.completedNodeIds
      const totalStudyNodeCount = state.orderedStudyNodeIds.length || 1
      const nextProgressPercent = Math.round((completedNodeIds.length / totalStudyNodeCount) * 100)
      const stageCelebration =
        turn.markCurrentNodeCompleted
          ? resolveStageCelebration(node.id, state.nodeMap, state.completedNodeIds, completedNodeIds)
          : null
      let milestoneEvents = state.milestoneEvents
      if (turn.markCurrentNodeCompleted && !alreadyCompleted) {
        milestoneEvents = appendMilestoneEvent(milestoneEvents, {
          kind: 'node_complete',
          title: `拿下《${node.title}》`,
          detail: `这已经是本课程完成的第 ${completedNodeIds.length} 个小关了，继续保持这个节奏。`,
          nodeId: node.id,
          progressPercent: nextProgressPercent,
        })

        if (session.lastEvaluation === 'incorrect' || session.lastEvaluation === 'partial') {
          milestoneEvents = appendMilestoneEvent(milestoneEvents, {
            kind: 'correction_recovery',
            title: `《${node.title}》纠错成功`,
            detail: '刚才虽然有卡顿，但你已经把这个知识点真正修正过来了。',
            nodeId: node.id,
            progressPercent: nextProgressPercent,
          })
        }

        if (stageCelebration) {
          milestoneEvents = appendMilestoneEvent(milestoneEvents, {
            kind: 'stage_complete',
            title: `阶段《${stageCelebration.stageTitle}》已打通`,
            detail: `这一阶段的 ${stageCelebration.totalCount} 个小关已经全部通过，可以进入下一段主线。`,
            stageId: stageCelebration.stageId,
            progressPercent: nextProgressPercent,
          })
        }

        if (nextProgressPercent >= 100) {
          milestoneEvents = appendMilestoneEvent(milestoneEvents, {
            kind: 'course_complete',
            title: `《${state.courseData.course.title}》顺利结课`,
            detail: '这门课已经完整学完，可以沉淀到你的长期知识资产里了。',
            progressPercent: 100,
          })
        }
      }
      const previousBadges = buildAchievementBadgesSummary(
        state.completedNodeIds.length,
        Math.round((state.completedNodeIds.length / totalStudyNodeCount) * 100),
        state.milestoneEvents,
      )
      const nextBadges = buildAchievementBadgesSummary(completedNodeIds.length, nextProgressPercent, milestoneEvents)
      const unlockedBadges = collectNewBadgeUnlocks(previousBadges, nextBadges)
      const previousStreak = computeNodeCompletionStreak(state.milestoneEvents)
      const nextStreak = computeNodeCompletionStreak(milestoneEvents)
      const unlockedNodeIds = getUnlockedNodeIds(state.nodeMap, completedNodeIds)
      const nextAttemptHistory =
        session.learningStatus === 'quizzing' || session.learningStatus === 'correcting'
          ? appendAttemptInsight(session.attemptHistory, {
              nodeTitle: node.title,
              question: currentQuestion,
              answer,
              verdict: evaluation,
              matchedKeywords: localAnswerGuide.matchedKeywords,
              missingKeywords: localAnswerGuide.missingKeywords,
              cautionNotes: localAnswerGuide.cautionNotes,
            })
          : session.attemptHistory

      set((latestState) => ({
        completedNodeIds,
        unlockedNodeIds,
        milestoneEvents,
        failedNodeIds:
          turn.markCurrentNodeCompleted
            ? latestState.failedNodeIds.filter((id) => id !== node.id)
            : evaluation === 'incorrect'
              ? latestState.failedNodeIds.includes(node.id)
                ? latestState.failedNodeIds
                : [...latestState.failedNodeIds, node.id]
              : latestState.failedNodeIds,
        nodeSessions: {
          ...latestState.nodeSessions,
          [node.id]: {
            ...latestState.nodeSessions[node.id],
            messages: [...pendingMessages, makeMessage('coach', turn.reply, node.id)],
            learningStatus: turn.learningStatus,
            activeQuestion:
              turn.learningStatus === 'quizzing' || turn.learningStatus === 'correcting'
                ? trackedQuestion || latestState.nodeSessions[node.id].activeQuestion
                : latestState.nodeSessions[node.id].activeQuestion,
            attemptHistory: nextAttemptHistory,
            requestState: 'idle',
            error: null,
            hydrated: true,
            lastEvaluation: evaluation,
            updatedAt: Date.now(),
          },
        },
      }))

      if (stageCelebration) {
        emitStageCelebration(set, stageCelebration)
        get().pushToast(
          '阶段已打通',
          `《${stageCelebration.stageTitle}》这一阶段已经全部通过，可以安心进入下一段主线了。`,
          'success',
        )
      } else if (nextStreak >= 5 && previousStreak < 5) {
        get().pushToast('连过 5 关', '势头已经完全起来了，继续往下推会非常顺。', 'success')
      } else if (nextStreak >= 3 && previousStreak < 3) {
        get().pushToast('连过 3 关', '状态很稳，已经进入连续推进节奏。', 'success')
      } else if (unlockedBadges.length > 0) {
        get().pushToast(
          '解锁成长徽章',
          unlockedBadges.map((badge) => badge.label).join('、'),
          'success',
        )
      }
      await get().saveCurrentProgress()
      await get().preloadNextNode(node.id)
    } catch (error) {
      const nextNodeId = getNextSequentialNodeId(state.orderedStudyNodeIds, node.id)
      const nextNode = nextNodeId ? state.nodeMap[nextNodeId] ?? null : null
      const fallbackTurn = buildFallbackCoachTurn({
        node,
        dependencyTitles,
        learningStatus: session.learningStatus === 'completed' ? 'quizzing' : session.learningStatus,
        activeQuestion: currentQuestion,
        answer,
        nextNode,
      })
      const evaluation =
        fallbackTurn.markCurrentNodeCompleted
          ? 'correct'
          : fallbackTurn.learningStatus === 'quizzing'
            ? 'partial'
            : 'incorrect'
      const alreadyCompleted = state.completedNodeIds.includes(node.id)
      const completedNodeIds = fallbackTurn.markCurrentNodeCompleted && !alreadyCompleted
        ? [...state.completedNodeIds, node.id]
        : state.completedNodeIds
      const totalStudyNodeCount = state.orderedStudyNodeIds.length || 1
      const nextProgressPercent = Math.round((completedNodeIds.length / totalStudyNodeCount) * 100)
      const stageCelebration =
        fallbackTurn.markCurrentNodeCompleted
          ? resolveStageCelebration(node.id, state.nodeMap, state.completedNodeIds, completedNodeIds)
          : null
      let milestoneEvents = state.milestoneEvents
      if (fallbackTurn.markCurrentNodeCompleted && !alreadyCompleted) {
        milestoneEvents = appendMilestoneEvent(milestoneEvents, {
          kind: 'node_complete',
          title: `拿下《${node.title}》`,
          detail: `这已经是本课程完成的第 ${completedNodeIds.length} 个小关了，继续保持这个节奏。`,
          nodeId: node.id,
          progressPercent: nextProgressPercent,
        })

        if (session.lastEvaluation === 'incorrect' || session.lastEvaluation === 'partial') {
          milestoneEvents = appendMilestoneEvent(milestoneEvents, {
            kind: 'correction_recovery',
            title: `《${node.title}》纠错成功`,
            detail: '刚才虽然有卡顿，但你已经把这个知识点真正修正过来了。',
            nodeId: node.id,
            progressPercent: nextProgressPercent,
          })
        }

        if (stageCelebration) {
          milestoneEvents = appendMilestoneEvent(milestoneEvents, {
            kind: 'stage_complete',
            title: `阶段《${stageCelebration.stageTitle}》已打通`,
            detail: `这一阶段的 ${stageCelebration.totalCount} 个小关已经全部通过，可以进入下一段主线。`,
            stageId: stageCelebration.stageId,
            progressPercent: nextProgressPercent,
          })
        }

        if (nextProgressPercent >= 100) {
          milestoneEvents = appendMilestoneEvent(milestoneEvents, {
            kind: 'course_complete',
            title: `《${state.courseData.course.title}》顺利结课`,
            detail: '这门课已经完整学完，可以沉淀到你的长期知识资产里了。',
            progressPercent: 100,
          })
        }
      }
      const previousBadges = buildAchievementBadgesSummary(
        state.completedNodeIds.length,
        Math.round((state.completedNodeIds.length / totalStudyNodeCount) * 100),
        state.milestoneEvents,
      )
      const nextBadges = buildAchievementBadgesSummary(completedNodeIds.length, nextProgressPercent, milestoneEvents)
      const unlockedBadges = collectNewBadgeUnlocks(previousBadges, nextBadges)
      const previousStreak = computeNodeCompletionStreak(state.milestoneEvents)
      const nextStreak = computeNodeCompletionStreak(milestoneEvents)
      const unlockedNodeIds = getUnlockedNodeIds(state.nodeMap, completedNodeIds)
      const followupQuestion =
        evaluation === 'partial' ? buildFocusedFollowupQuestion(node, localAnswerGuide, currentQuestion) : currentQuestion
      const trackedQuestion = resolveTrackedQuestion(node, fallbackTurn.learningStatus, followupQuestion)
      const nextAttemptHistory =
        session.learningStatus === 'quizzing' || session.learningStatus === 'correcting'
          ? appendAttemptInsight(session.attemptHistory, {
              nodeTitle: node.title,
              question: currentQuestion,
              answer,
              verdict: evaluation,
              matchedKeywords: localAnswerGuide.matchedKeywords,
              missingKeywords: localAnswerGuide.missingKeywords,
              cautionNotes: localAnswerGuide.cautionNotes,
            })
          : session.attemptHistory
      set((latestState) => ({
        completedNodeIds,
        unlockedNodeIds,
        milestoneEvents,
        failedNodeIds:
          fallbackTurn.markCurrentNodeCompleted
            ? latestState.failedNodeIds.filter((id) => id !== node.id)
            : evaluation === 'incorrect'
              ? latestState.failedNodeIds.includes(node.id)
                ? latestState.failedNodeIds
                : [...latestState.failedNodeIds, node.id]
              : latestState.failedNodeIds,
        nodeSessions: {
          ...latestState.nodeSessions,
          [node.id]: {
            ...latestState.nodeSessions[node.id],
            messages: [...latestState.nodeSessions[node.id].messages, makeMessage('coach', fallbackTurn.reply, node.id)],
            learningStatus: fallbackTurn.learningStatus,
            activeQuestion:
              fallbackTurn.learningStatus === 'quizzing' || fallbackTurn.learningStatus === 'correcting'
                ? trackedQuestion || latestState.nodeSessions[node.id].activeQuestion
                : latestState.nodeSessions[node.id].activeQuestion,
            attemptHistory: nextAttemptHistory,
            requestState: 'idle',
            error: null,
            hydrated: true,
            lastEvaluation: evaluation,
            updatedAt: Date.now(),
          },
        },
      }))
      if (stageCelebration) {
        emitStageCelebration(set, stageCelebration)
        get().pushToast(
          '阶段已打通',
          `《${stageCelebration.stageTitle}》这一阶段已经全部通过，可以安心进入下一段主线了。`,
          'success',
        )
      } else if (nextStreak >= 5 && previousStreak < 5) {
        get().pushToast('连过 5 关', '势头已经完全起来了，继续往下推会非常顺。', 'success')
      } else if (nextStreak >= 3 && previousStreak < 3) {
        get().pushToast('连过 3 关', '状态很稳，已经进入连续推进节奏。', 'success')
      } else if (unlockedBadges.length > 0) {
        get().pushToast(
          '解锁成长徽章',
          unlockedBadges.map((badge) => badge.label).join('、'),
          'success',
        )
      }
      await get().saveCurrentProgress()
    }
  },

  appendCoachMessage: (message) => {
    const nodeId = message.nodeId ?? get().currentNodeId
    if (!nodeId) return
    set((state) => ({
      nodeSessions: {
        ...state.nodeSessions,
        [nodeId]: {
          ...(state.nodeSessions[nodeId] ?? createEmptySession(nodeId)),
          messages: [...(state.nodeSessions[nodeId]?.messages ?? []), message],
          updatedAt: Date.now(),
        },
      },
    }))
  },

  recomputeUnlockedNodes: () => {
    const state = get()
    set({ unlockedNodeIds: getUnlockedNodeIds(state.nodeMap, state.completedNodeIds) })
  },

  goToNextNode: async () => {
    const state = get()
    const currentSession = state.getCurrentSession()
    const currentNodeCompleted =
      Boolean(state.currentNodeId && state.completedNodeIds.includes(state.currentNodeId)) ||
      isEffectivelyCompletedSession(currentSession)
    if (!currentNodeCompleted) return
    const effectiveCompletedNodeIds = buildEffectiveCompletedNodeIds(
      state.currentNodeId,
      state.completedNodeIds,
      state.nodeSessions,
    )
    const nextNodeId = getNextNodeId(state.orderedStudyNodeIds, state.nodeMap, effectiveCompletedNodeIds)
    if (!nextNodeId) return
    await get().openNodeSession(nextNodeId)
  },

  saveCurrentProgress: async () => {
    const state = get()
    if (!state.courseData) return

    const now = Date.now()
    const recordId = state.activeRecordId || state.courseData.package_id
    const previousSummary = state.libraryRecords.find((record) => record.id === recordId) ?? null
    const wasArchived = Boolean(previousSummary?.isArchived)
    const totalStudyNodeCount = state.orderedStudyNodeIds.length || 1
    const progressPercent = Math.round((state.completedNodeIds.length / totalStudyNodeCount) * 100)
    const nodeSessions = Object.entries(state.nodeSessions).reduce<Record<string, PersistedNodeLearningSession>>(
      (accumulator, [nodeId, session]) => {
        if (!session.hydrated && session.messages.length === 0) return accumulator
        accumulator[nodeId] = persistSession({
          ...session,
          requestState: 'idle',
          error: null,
        })
        return accumulator
      },
      {},
    )

    const record = await window.desktopAPI.saveLearningRecord({
      id: recordId,
      packageId: state.courseData.package_id,
      title: state.courseData.course.title,
      sourceTitle: state.courseData.source.title,
      sourceId: state.courseData.source.source_id,
      sourceUrl: state.courseData.source.url,
      importedCoursePath: state.importedCoursePath,
      packagePath: state.importedCoursePath,
      courseText: JSON.stringify(state.courseData, null, 2),
      currentNodeId: state.currentNodeId,
      completedNodeIds: state.completedNodeIds,
      failedNodeIds: state.failedNodeIds,
      nodeSessions,
      milestoneEvents: state.milestoneEvents,
      progressPercent,
      isArchived: progressPercent >= 100,
      createdAt: state.activeRecordCreatedAt ?? now,
      updatedAt: now,
      lastOpenedAt: now,
    })

    set({
      activeRecordId: record.id,
      activeRecordCreatedAt: record.createdAt,
    })
    await get().refreshLibrary()
    if (!wasArchived && progressPercent >= 100) {
      get().pushToast('课程已归档', `《${state.courseData.course.title}》已完成并收录到归档区`, 'success')
    }
  },

  preloadNextNode: async (nodeId) => {
    const state = get()
    if (!state.courseData) return
    const nextNodeId = getNextSequentialNodeId(state.orderedStudyNodeIds, nodeId)
    if (!nextNodeId) return

    const nextNode = state.nodeMap[nextNodeId]
    const existingSession = state.nodeSessions[nextNodeId]
    if (!nextNode || !state.isStudyNode(nextNodeId) || existingSession?.hydrated || existingSession?.requestState === 'loading') {
      return
    }

    await state.loadRuntimeSettings()
    const runtimeSettings = get().runtimeSettings
    if (!runtimeSettings) return

    const dependencyTitles = nextNode.dependencies
      .map((dependencyId) => state.nodeMap[dependencyId]?.title)
      .filter(Boolean) as string[]
    const stageReplay = buildStageReplayInsight(nextNode, state.nodeMap, state.nodeSessions)
    const replayQuestion = resolveReplayPreferredQuestion(stageReplay, existingSession?.activeQuestion ?? null)
    const systemPrompt = buildCoachSystemPrompt(state.courseData, nextNode, 'teaching', dependencyTitles)
    const nextMessages = [makeMessage('system', systemPrompt, nextNodeId)]

    set((latestState) => ({
      nodeSessions: {
        ...latestState.nodeSessions,
        [nextNodeId]: {
          ...createEmptySession(nextNodeId),
          messages: nextMessages,
          requestState: 'loading',
          preloaded: true,
          updatedAt: Date.now(),
        },
      },
    }))

    try {
      const turn = await requestCoachTurn({
        config: resolveCoachApiConfig(runtimeSettings),
        courseData: state.courseData,
        currentNode: nextNode,
        dependencyTitles,
        learningStatus: 'teaching',
        messages: nextMessages,
        activeQuestion: replayQuestion,
        stageReplay,
        unlockedNodeIds: state.unlockedNodeIds,
        completedNodeIds: state.completedNodeIds,
      })

      const trackedQuestion = resolveTrackedQuestion(
        nextNode,
        turn.learningStatus,
        replayQuestion,
      )

      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [nextNodeId]: {
            ...latestState.nodeSessions[nextNodeId],
            messages: [...nextMessages, makeMessage('coach', turn.reply, nextNodeId)],
            learningStatus: turn.learningStatus,
            activeQuestion: turn.learningStatus === 'quizzing' ? trackedQuestion || turn.reply : null,
            requestState: 'idle',
            error: null,
            hydrated: true,
            preloaded: true,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
    } catch {
      const nextNextNodeId = getNextSequentialNodeId(state.orderedStudyNodeIds, nextNodeId)
      const nextNextNode = nextNextNodeId ? state.nodeMap[nextNextNodeId] ?? null : null
      const fallbackTurn = buildFallbackCoachTurn({
        node: nextNode,
        dependencyTitles,
        learningStatus: 'teaching',
        activeQuestion: replayQuestion,
        nextNode: nextNextNode,
      })
      const trackedQuestion = resolveTrackedQuestion(
        nextNode,
        fallbackTurn.learningStatus,
        replayQuestion,
      )
      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [nextNodeId]: {
            ...latestState.nodeSessions[nextNodeId],
            messages: [...nextMessages, makeMessage('coach', fallbackTurn.reply, nextNodeId)],
            learningStatus: fallbackTurn.learningStatus,
            activeQuestion: fallbackTurn.learningStatus === 'quizzing' ? trackedQuestion || fallbackTurn.reply : null,
            requestState: 'idle',
            error: null,
            hydrated: true,
            preloaded: true,
            updatedAt: Date.now(),
          },
        },
      }))
    }
  },

  pushToast: (title, description, tone = 'info') => {
    emitToast(set, { title, description, tone })
  },

  dismissToast: () => {
    if (toastTimer) {
      globalThis.clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toast: null })
  },

  dismissStageCelebration: () => {
    if (stageCelebrationTimer) {
      globalThis.clearTimeout(stageCelebrationTimer)
      stageCelebrationTimer = null
    }
    set({ stageCelebration: null })
  },

  isNodeUnlocked: (nodeId) => get().unlockedNodeIds.includes(nodeId),
  isNodeCompleted: (nodeId) => get().completedNodeIds.includes(nodeId),
  isStudyNode: (nodeId) => {
    const node = get().nodeMap[nodeId]
    return Boolean(node && isStudyNode(node))
  },
  getCurrentAchievementBadges: () => {
    const state = get()
    const totalStudyNodeCount = state.orderedStudyNodeIds.length || 1
    const progressPercent = Math.round((state.completedNodeIds.length / totalStudyNodeCount) * 100)
    return buildAchievementBadgesSummary(state.completedNodeIds.length, progressPercent, state.milestoneEvents)
  },
  getRecentMilestones: (limit = 4) => get().milestoneEvents.slice(0, limit),
  getMomentumSnapshot: () => {
    const now = Date.now()
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayTs = startOfToday.getTime()
    const recentThreshold = now - 24 * 60 * 60 * 1000
    const events = get().milestoneEvents
    const todayCompletedCount = events.filter(
      (event) => event.kind === 'node_complete' && event.createdAt >= todayTs,
    ).length
    const todayStageCount = events.filter(
      (event) => event.kind === 'stage_complete' && event.createdAt >= todayTs,
    ).length
    const recentMilestoneCount = events.filter((event) => event.createdAt >= recentThreshold).length
    const latestMilestoneAt = events[0]?.createdAt ?? null
    const currentStreak = computeNodeCompletionStreak(events)
    const momentumLabel =
      todayStageCount > 0
        ? `今天已经打通 ${todayStageCount} 个阶段`
        : currentStreak >= 5
          ? `当前已经连过 ${currentStreak} 关`
          : currentStreak >= 3
            ? `当前正处在连过 ${currentStreak} 关的节奏里`
        : todayCompletedCount >= 4
          ? `今天已经连续拿下 ${todayCompletedCount} 个小关`
          : todayCompletedCount > 0
            ? '今天正在稳定推进'
            : recentMilestoneCount > 0
              ? '最近 24 小时还在持续推进'
              : '这门课还在起步阶段'

    return {
      todayCompletedCount,
      todayStageCount,
      recentMilestoneCount,
      latestMilestoneAt,
      currentStreak,
      momentumLabel,
    }
  },
  getCurrentNode: () => {
    const state = get()
    return state.currentNodeId ? state.nodeMap[state.currentNodeId] ?? null : null
  },
  getCurrentSession: () => {
    const state = get()
    return state.currentNodeId ? state.nodeSessions[state.currentNodeId] ?? null : null
  },
  getCurrentNodeMeta: () => {
    const state = get()
    const node = state.getCurrentNode()
    if (!node) {
      return {
        concepts: '- 暂无概念清单',
        checkpoints: '- 暂无检查点',
        mistakes: '- 暂无常见误区',
        dependencies: '无',
        stageQuizzes: '- 暂无预设阶段题',
      }
    }
    const dependencyTitles = node.dependencies.map((dependencyId) => state.nodeMap[dependencyId]?.title).filter(Boolean) as string[]
    return buildCurrentNodeMeta(node, dependencyTitles)
  },
  getCurrentStageReplay: () => {
    const state = get()
    return buildStageReplayInsight(state.getCurrentNode(), state.nodeMap, state.nodeSessions)
  },
}))

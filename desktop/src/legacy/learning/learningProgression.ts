import {
  buildAchievementBadgesSummary,
  appendMilestoneEvent,
  collectNewBadgeUnlocks,
  computeNodeCompletionStreak,
  resolveStageCelebration,
} from './learningState'
import { getUnlockedNodeIds } from './studyTree'
import type { FlatCourseNode, LearningMilestoneEvent } from '../types/course'
import type { StageCelebration } from './learningState'

// Completion bookkeeping for the 专注 reader compatibility runtime. This does
// not define the current material production pipeline.
type ToastTone = 'info' | 'success' | 'error'

type CompletionToast = {
  title: string
  description: string
  tone: ToastTone
} | null

export type CompletionCelebrationPayload = {
  completedNodeIds: string[]
  unlockedNodeIds: string[]
  milestoneEvents: LearningMilestoneEvent[]
  nextProgressPercent: number
  toast: CompletionToast
}

function resolveCompletionToast(options: {
  stageCelebration: StageCelebration | null
  previousStreak: number
  nextStreak: number
  unlockedBadges: ReturnType<typeof buildAchievementBadgesSummary>
}): CompletionToast {
  const { stageCelebration, previousStreak, nextStreak, unlockedBadges } = options

  if (stageCelebration) {
    return {
      title: '阶段已打通',
      description: `《${stageCelebration.stageTitle}》这一阶段已经全部通过，可以安心进入下一段主线了。`,
      tone: 'success',
    }
  }

  if (nextStreak >= 5 && previousStreak < 5) {
    return {
      title: '连读 5 节',
      description: '势头已经完全起来了，继续往下推会非常顺。',
      tone: 'success',
    }
  }

  if (nextStreak >= 3 && previousStreak < 3) {
    return {
      title: '连读 3 节',
      description: '状态很稳，已经进入连续推进节奏。',
      tone: 'success',
    }
  }

  if (unlockedBadges.length > 0) {
    return {
      title: '解锁成长徽章',
      description: unlockedBadges.map((badge) => badge.label).join('、'),
      tone: 'success',
    }
  }

  return null
}

export function buildCompletionCelebrationPayload(options: {
  courseTitle: string
  node: FlatCourseNode
  nodeMap: Record<string, FlatCourseNode>
  orderedStudyNodeIds: string[]
  previousCompletedNodeIds: string[]
  milestoneEvents: LearningMilestoneEvent[]
}) : CompletionCelebrationPayload {
  const { courseTitle, node, nodeMap, orderedStudyNodeIds, previousCompletedNodeIds } = options
  const alreadyCompleted = previousCompletedNodeIds.includes(node.id)
  const completedNodeIds = alreadyCompleted ? previousCompletedNodeIds : [...previousCompletedNodeIds, node.id]
  const totalStudyNodeCount = orderedStudyNodeIds.length || 1
  const nextProgressPercent = Math.round((completedNodeIds.length / totalStudyNodeCount) * 100)
  const stageCelebration = !alreadyCompleted
    ? resolveStageCelebration(node.id, nodeMap, previousCompletedNodeIds, completedNodeIds)
    : null

  let milestoneEvents = options.milestoneEvents
  if (!alreadyCompleted) {
    milestoneEvents = appendMilestoneEvent(milestoneEvents, {
      kind: 'node_complete',
      title: `拿下《${node.title}》`,
      detail: `这已经是本资料完成的第 ${completedNodeIds.length} 个小节了，继续保持这个节奏。`,
      nodeId: node.id,
      progressPercent: nextProgressPercent,
    })

    if (stageCelebration) {
      milestoneEvents = appendMilestoneEvent(milestoneEvents, {
        kind: 'stage_complete',
        title: `阶段《${stageCelebration.stageTitle}》已打通`,
        detail: `这一阶段的 ${stageCelebration.totalCount} 个小节已经全部完成，可以进入下一段主线。`,
        stageId: stageCelebration.stageId,
        progressPercent: nextProgressPercent,
      })
    }

    if (nextProgressPercent >= 100) {
      milestoneEvents = appendMilestoneEvent(milestoneEvents, {
        kind: 'course_complete',
        title: `《${courseTitle}》已完成`,
        detail: '这份资料已经完整读完，可以沉淀到你的长期知识资产里了。',
        progressPercent: 100,
      })
    }
  }

  const previousBadges = buildAchievementBadgesSummary(
    previousCompletedNodeIds.length,
    Math.round((previousCompletedNodeIds.length / totalStudyNodeCount) * 100),
    options.milestoneEvents,
  )
  const nextBadges = buildAchievementBadgesSummary(completedNodeIds.length, nextProgressPercent, milestoneEvents)
  const unlockedBadges = collectNewBadgeUnlocks(previousBadges, nextBadges)
  const previousStreak = computeNodeCompletionStreak(options.milestoneEvents)
  const nextStreak = computeNodeCompletionStreak(milestoneEvents)

  return {
    completedNodeIds,
    unlockedNodeIds: getUnlockedNodeIds(nodeMap, completedNodeIds),
    milestoneEvents,
    nextProgressPercent,
    toast: resolveCompletionToast({
      stageCelebration,
      previousStreak,
      nextStreak,
      unlockedBadges,
    }),
  }
}

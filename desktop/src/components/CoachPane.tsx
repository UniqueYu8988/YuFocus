import { useMemo, useState } from 'react'
import {
  ArrowRight,
  FolderSync,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { CoachChatTimeline } from '@/components/CoachChatTimeline'
import { CoachComposer } from '@/components/CoachComposer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getNextSequentialNodeId } from '@/lib/courseTree'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'

function stripStagePrefix(title: string) {
  return title.replace(/^(?:学习)?阶段\s*\d+\s*[·\-:：]\s*/u, '').replace(/^阶段\s*\d+\s*/u, '').trim()
}

function collectStageStudyNodeIds(nodeId: string, nodeMap: Record<string, { childIds: string[] }>) {
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

function getBadgeToneClass(tone: 'neutral' | 'info' | 'success' | 'accent') {
  switch (tone) {
    case 'success':
      return 'border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-100'
    case 'accent':
      return 'border-sky-400/15 bg-sky-400/[0.08] text-sky-100'
    case 'info':
      return 'border-violet-400/15 bg-violet-400/[0.08] text-violet-100'
    default:
      return 'border-white/[0.07] bg-[#232323] text-foreground/82'
  }
}

function formatCompletionDate(timestamp: number | null) {
  if (!timestamp) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

export function CoachPane() {
  const courseData = useLearningStore((state) => state.courseData)
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const nodeMap = useLearningStore((state) => state.nodeMap)
  const completedNodeIds = useLearningStore((state) => state.completedNodeIds)
  const orderedStudyNodeIds = useLearningStore((state) => state.orderedStudyNodeIds)
  const currentSession = useLearningStore((state) =>
    state.currentNodeId ? state.nodeSessions[state.currentNodeId] ?? null : null,
  )
  const getCurrentAchievementBadges = useLearningStore((state) => state.getCurrentAchievementBadges)
  const goToNextNode = useLearningStore((state) => state.goToNextNode)
  const getRecentMilestones = useLearningStore((state) => state.getRecentMilestones)
  const pushToast = useLearningStore((state) => state.pushToast)
  const isCurrentNodeUnlocked = useLearningStore((state) =>
    state.currentNodeId ? state.isNodeUnlocked(state.currentNodeId) : false,
  )
  const [obsidianSyncing, setObsidianSyncing] = useState(false)
  const currentNode = currentNodeId ? nodeMap[currentNodeId] ?? null : null
  const effectiveCompletedNodeIds = useMemo(() => {
    if (!currentNodeId || !currentSession) return completedNodeIds
    const currentNodeCompleted =
      currentSession.learningStatus === 'completed' ||
      currentSession.lastEvaluation === 'correct' ||
      completedNodeIds.includes(currentNodeId)
    if (!currentNodeCompleted || completedNodeIds.includes(currentNodeId)) {
      return completedNodeIds
    }
    return [...completedNodeIds, currentNodeId]
  }, [completedNodeIds, currentNodeId, currentSession])
  const canAdvanceToNext =
    Boolean(currentNodeId && effectiveCompletedNodeIds.includes(currentNodeId)) &&
    currentSession?.requestState !== 'loading'

  const totalStudyCount = orderedStudyNodeIds.length
  const progressPercent = totalStudyCount > 0 ? Math.round((effectiveCompletedNodeIds.length / totalStudyCount) * 100) : 0
  const nextNodeId = useMemo(
    () => getNextSequentialNodeId(orderedStudyNodeIds, currentNodeId),
    [currentNodeId, orderedStudyNodeIds],
  )
  const isCourseCompleted = totalStudyCount > 0 && effectiveCompletedNodeIds.length >= totalStudyCount
  const remainingCount = Math.max(0, totalStudyCount - effectiveCompletedNodeIds.length)
  const currentStage = useMemo(() => {
    if (!currentNode) return null
    let cursor = currentNode
    while (cursor.parentId && nodeMap[cursor.parentId]) {
      cursor = nodeMap[cursor.parentId]
    }
    return cursor
  }, [currentNode, nodeMap])
  const stageTitle = currentStage ? stripStagePrefix(currentStage.title) || currentStage.title : ''
  const currentStageStudyNodeIds = useMemo(
    () => (currentStage ? collectStageStudyNodeIds(currentStage.id, nodeMap) : []),
    [currentStage, nodeMap],
  )
  const stageCompletedCount = useMemo(
    () => currentStageStudyNodeIds.filter((nodeId) => effectiveCompletedNodeIds.includes(nodeId)).length,
    [currentStageStudyNodeIds, effectiveCompletedNodeIds],
  )
  const stageTotalCount = currentStageStudyNodeIds.length
  const achievementBadges = getCurrentAchievementBadges()
  const archiveMilestones = getRecentMilestones(10)
  const completionMilestone =
    archiveMilestones.find((event) => event.kind === 'course_complete') ?? null
  const completionNarrative =
    false
      ? ''
      : archiveMilestones.some((event) => event.kind === 'stage_complete')
        ? '你是靠一段一段稳稳推进，把整门课完整打通下来的。'
        : '你把这门课完整学完了，而且路径非常干净，说明理解链路已经相当顺。'
  const lightweightStatusHint = useMemo(() => {
    if (!isCurrentNodeUnlocked) {
      return '预览模式：按顺序学到这里后再答题'
    }
    if (currentSession?.learningStatus === 'completed' && nextNodeId) {
      return '这一关已掌握，点击下一节继续'
    }
    if (currentSession?.learningStatus === 'quizzing') {
      return '先写下你的回忆，再对照标准答案和关键点'
    }
    return '先阅读这一关，再写下自己的回忆'
  }, [
    currentSession?.learningStatus,
    isCurrentNodeUnlocked,
    nextNodeId,
  ])
  const lightweightStatusTone: 'neutral' | 'progress' | 'warning' | 'success' =
    !isCurrentNodeUnlocked
      ? 'warning'
      : currentSession?.learningStatus === 'completed'
        ? 'success'
        : currentSession?.learningStatus === 'quizzing'
          ? 'progress'
          : 'neutral'

  const syncObsidian = async (target: 'current' | 'board' | 'index') => {
    if (!courseData) return
    setObsidianSyncing(true)
    try {
      const result = await window.desktopAPI.openObsidianCourse({
        course: courseData as unknown as Record<string, unknown>,
        currentNodeId,
        completedNodeIds: effectiveCompletedNodeIds,
        target,
      })
      pushToast(
        'Obsidian 已同步',
        target === 'current'
          ? `已打开当前小节笔记：${result.openedPath}`
          : target === 'board'
            ? `已打开学习看板：${result.openedPath}`
            : `已打开课程总览：${result.openedPath}`,
        'success',
      )
    } catch (error) {
      pushToast('Obsidian 同步失败', error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setObsidianSyncing(false)
    }
  }

  if (!currentNode || !currentSession) {
    return (
      <section className="flex min-h-0 flex-1">
        <Card className="work-surface flex min-h-0 w-full items-center justify-center rounded-l-[24px] rounded-r-none border-0 bg-[#181818] shadow-[-14px_0_34px_rgba(0,0,0,0.12)]">
          <CardContent className="w-full max-w-4xl space-y-8 p-8">
            <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
              <div className="flex size-16 items-center justify-center rounded-[24px] border border-white/8 bg-white/[0.035] text-foreground/78">
                <Sparkles size={24} />
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-muted-foreground">开始学习</div>
                <h2 className="text-[32px] font-semibold tracking-tight text-foreground">准备开始一门新课程</h2>
                <p className="text-[13px] leading-7 text-muted-foreground">
                  左侧输入 BV 开始提炼，或者从学习档案直接续上。这里会始终保持为唯一主舞台，课程讲解、主动回忆、标准答案对照和推进都会连续发生在这一侧。
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <Badge variant="outline">BV 到课程树</Badge>
                  <Badge variant="outline">本地闯关学习</Badge>
                  <Badge variant="outline">进度自动保存</Badge>
                </div>
              </div>
            </div>

            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2.5">
              {[
                ['提炼或导入', '从 B 站视频自动蒸馏成知识树，或者导入现成课包。'],
                ['轻量闯关学习', '每一小关都会经历讲解、主动回忆、标准答案对照和通过四个阶段。'],
                ['自动保存', '关闭应用也不会丢，回来会恢复到你上次的进度位置。'],
              ].map(([title, description]) => (
                <div
                  key={title}
                  className="min-w-[220px] rounded-[22px] border border-white/7 bg-white/[0.025] px-4 py-2.5 text-left"
                >
                  <div className="text-[11px] font-medium text-foreground">{title}</div>
                  <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{description}</div>
                </div>
              ))}
            </div>

            <div className="mx-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              <FolderSync className="size-3.5" />
              提炼、学习、归档会在同一条工作流里自动接力。
            </div>
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-1">
      <Card className="work-surface flex min-h-0 w-full flex-col overflow-hidden rounded-l-[24px] rounded-r-none border-0 bg-[#181818] shadow-[-14px_0_34px_rgba(0,0,0,0.12)]">
        <CardHeader className="pl-7 pr-5 py-2">
          <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-2.5">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div>
                <CardTitle className="flex items-center gap-2 text-[18px] leading-tight tracking-tight">
                  <span aria-hidden className="text-[14px] opacity-90">✨</span>
                  <span>{currentNode.title}</span>
                </CardTitle>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {currentStage ? `${stageTitle} · ` : ''}
                  {progressPercent}% 已完成
                {!isCurrentNodeUnlocked ? ' · 预览中' : ''}
                {currentSession.requestState === 'loading' ? ' · 老师思考中' : ''}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-xl px-3 text-[11px]"
                onClick={() => void syncObsidian('board')}
                disabled={obsidianSyncing}
              >
                <FolderSync size={13} />
                同步 Obsidian
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-8 rounded-xl px-3 text-[11px]"
                onClick={() => void syncObsidian('current')}
                disabled={obsidianSyncing}
              >
                打开笔记
              </Button>
            </div>
          </div>

          {currentSession.error ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
              {currentSession.error}
            </div>
          ) : null}

          {isCourseCompleted ? (
            <Card className="border-emerald-500/14 bg-[linear-gradient(180deg,rgba(24,32,28,0.96),rgba(19,24,21,0.96))] shadow-[0_0_30px_rgba(16,185,129,0.06)]">
              <CardContent className="space-y-5 p-4.5">
                <div className="flex items-start gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/12 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.12)]">
                    <Trophy size={18} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-emerald-200/80">课程征服回顾</div>
                    <div className="text-base font-semibold text-foreground">《{courseData?.course.title ?? '当前课程'}》已经完整结课</div>
                    <p className="text-sm leading-6 text-muted-foreground">
                    全部 {totalStudyCount} 个小关已完成，这门课会自动沉淀进归档区，之后随时都能回来继续学习。
                    </p>
                    <div className="text-[11px] text-emerald-100/78">
                      {completionMilestone ? `结课时间：${formatCompletionDate(completionMilestone.createdAt)}` : '结课记录已保存到本地档案'}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">总小关</div>
                    <div className="mt-2 text-2xl font-semibold">{totalStudyCount}</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">掌握率</div>
                    <div className="mt-2 text-2xl font-semibold">100%</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">完成阶段</div>
                    <div className="mt-2 text-2xl font-semibold">{stageTotalCount}</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">能力徽章</div>
                    <div className="mt-2 text-2xl font-semibold">{achievementBadges.length}</div>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
                  <div className="space-y-3 rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">这门课你是怎么拿下的</div>
                    <div className="text-[13px] leading-6 text-foreground/92">{completionNarrative}</div>
                    {achievementBadges.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {achievementBadges.map((badge) => (
                          <span
                            key={badge.code}
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-[10px] font-medium',
                              getBadgeToneClass(badge.tone),
                            )}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3 rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">结课里程碑</div>
                    <div className="space-y-2">
                      {archiveMilestones.slice(0, 4).map((event) => (
                        <div key={event.id} className="rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
                          <div className="text-[11px] font-medium text-foreground">{event.title}</div>
                          <div className="mt-0.5 text-[10px] leading-5 text-muted-foreground">{event.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {courseData?.course.learning_outcomes?.length ? (
                  <div className="space-y-2 rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">本门课最终带走什么</div>
                    <ul className="space-y-2 text-sm text-foreground/90">
                      {courseData.course.learning_outcomes.slice(0, 3).map((item) => (
                        <li key={item} className="list-inside list-disc">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </CardHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pt-1.5 pb-4">
          <Card className="work-surface relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-white/[0.055] bg-[#181818] shadow-none">
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit] p-0">
              <div className="work-surface h-0 min-h-0 flex-1 overflow-hidden rounded-t-[inherit] bg-[#181818] px-4 py-0">
                <CoachChatTimeline />
              </div>
              <div className="work-surface relative z-10 shrink-0 rounded-b-[inherit] bg-[#181818]">
                <CoachComposer
                  progressText={`${effectiveCompletedNodeIds.length}/${totalStudyCount} · 阶段 ${stageCompletedCount}/${Math.max(stageTotalCount, 0)}`}
                  statusHint={lightweightStatusHint}
                  statusTone={lightweightStatusTone}
                  onGoToNext={() => void goToNextNode()}
                  canGoToNext={canAdvanceToNext && Boolean(nextNodeId)}
                  nextLabel={isCourseCompleted ? '课程已完成' : '下一节'}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </Card>
    </section>
  )
}

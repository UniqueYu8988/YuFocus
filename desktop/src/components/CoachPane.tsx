import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Award,
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  Compass,
  History,
  FolderSync,
  Flame,
  Gauge,
  Milestone,
  Orbit,
  RefreshCcw,
  Sparkles,
  Trophy,
  TrendingUp,
} from 'lucide-react'
import { CoachChatTimeline } from '@/components/CoachChatTimeline'
import { CoachComposer } from '@/components/CoachComposer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getNextNodeId } from '@/lib/courseTree'
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

function formatRelativeMilestoneTime(timestamp: number | null) {
  if (!timestamp) return '刚刚'
  const diff = Date.now() - timestamp
  const hour = 60 * 60 * 1000
  const day = 24 * hour
  if (diff < hour) return `${Math.max(1, Math.round(diff / (60 * 1000)))} 分钟前`
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)
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
      return 'border-white/8 bg-white/[0.03] text-foreground/82'
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
  const startQuizForCurrentNode = useLearningStore((state) => state.startQuizForCurrentNode)
  const reteachCurrentNode = useLearningStore((state) => state.reteachCurrentNode)
  const goToNextNode = useLearningStore((state) => state.goToNextNode)
  const getCurrentStageReplay = useLearningStore((state) => state.getCurrentStageReplay)
  const getCurrentAchievementBadges = useLearningStore((state) => state.getCurrentAchievementBadges)
  const getRecentMilestones = useLearningStore((state) => state.getRecentMilestones)
  const getMomentumSnapshot = useLearningStore((state) => state.getMomentumSnapshot)
  const stageCelebration = useLearningStore((state) => state.stageCelebration)
  const dismissStageCelebration = useLearningStore((state) => state.dismissStageCelebration)
  const currentNode = currentNodeId ? nodeMap[currentNodeId] ?? null : null
  const stageReplay = getCurrentStageReplay()
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
    () => getNextNodeId(orderedStudyNodeIds, nodeMap, effectiveCompletedNodeIds),
    [effectiveCompletedNodeIds, nodeMap, orderedStudyNodeIds],
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
  const stageObjectives = useMemo(
    () => currentStage?.learning_objectives.filter(Boolean).slice(0, 3) ?? [],
    [currentStage],
  )
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
  const stageProgressPercent = stageTotalCount > 0 ? Math.round((stageCompletedCount / stageTotalCount) * 100) : 0
  const stageCompleted = stageTotalCount > 0 && stageCompletedCount >= stageTotalCount
  const stageMomentumLabel =
    stageCompleted
      ? '本阶段已打通'
      : stageCompletedCount > 0
        ? `本阶段推进中 · 已拿下 ${stageCompletedCount}/${stageTotalCount}`
        : '本阶段刚开始'
  const achievementBadges = getCurrentAchievementBadges()
  const recentMilestones = getRecentMilestones(3)
  const archiveMilestones = getRecentMilestones(10)
  const momentumSnapshot = getMomentumSnapshot()
  const completionMilestone =
    archiveMilestones.find((event) => event.kind === 'course_complete') ?? null
  const completionNarrative =
    achievementBadges.some((badge) => badge.code === 'comeback')
      ? '这门课不是一路平推拿下的，而是经历过卡顿、纠错，再慢慢打磨成真正掌握。'
      : achievementBadges.some((badge) => badge.code === 'stage_breaker')
        ? '你是靠一段一段稳稳推进，把整门课完整打通下来的。'
        : '你把这门课完整学完了，而且路径非常干净，说明理解链路已经相当顺。'
  const seenBadgeCodesRef = useRef<string[]>([])
  const [freshBadgeCodes, setFreshBadgeCodes] = useState<string[]>([])

  useEffect(() => {
    const nextCodes = achievementBadges.map((badge) => badge.code)
    const previousCodes = seenBadgeCodesRef.current
    const unlocked = nextCodes.filter((code) => !previousCodes.includes(code))
    if (unlocked.length > 0) {
      setFreshBadgeCodes(unlocked)
      const timeout = window.setTimeout(() => setFreshBadgeCodes([]), 1800)
      seenBadgeCodesRef.current = nextCodes
      return () => window.clearTimeout(timeout)
    }
    seenBadgeCodesRef.current = nextCodes
    return
  }, [achievementBadges])

  if (!currentNode || !currentSession) {
    return (
      <section className="flex min-h-0 flex-1">
        <Card className="work-surface flex min-h-0 w-full items-center justify-center rounded-l-[24px] rounded-r-none border-0 bg-[#181818] shadow-[-14px_0_34px_rgba(0,0,0,0.12)]">
          <CardContent className="w-full max-w-4xl space-y-8 p-8">
            <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
              <div className="flex size-16 items-center justify-center rounded-[24px] border border-white/8 bg-white/[0.035] text-foreground/78">
                <Compass size={24} />
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-[0.28em] text-muted-foreground">开始学习</div>
                <h2 className="text-[32px] font-semibold tracking-tight text-foreground">准备开始一门新课程</h2>
                <p className="text-[13px] leading-7 text-muted-foreground">
                  左侧输入 BV 开始提炼，或者从学习档案直接续上。这里会始终保持为唯一主舞台，课程讲解、提问、纠错和推进都会连续发生在这一侧。
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <Badge variant="outline">BV 到课程树</Badge>
                  <Badge variant="outline">AI 教练带学</Badge>
                  <Badge variant="outline">进度自动保存</Badge>
                </div>
              </div>
            </div>

            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2.5">
              {[
                ['提炼或导入', '从 B 站视频自动蒸馏成知识树，或者导入现成课包。'],
                ['跟着 AI 教练闯关', '每一小关都会经历讲解、提问、纠错和通过四个阶段。'],
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

  const learningStatusLabel = {
    teaching: '讲解中',
    quizzing: '提问中',
    correcting: '纠错中',
    completed: '已掌握',
  }[currentSession.learningStatus]

  return (
    <section className="flex min-h-0 flex-1">
      <Card className="work-surface flex min-h-0 w-full flex-col overflow-hidden rounded-l-[24px] rounded-r-none border-0 bg-[#181818] shadow-[-14px_0_34px_rgba(0,0,0,0.12)]">
        <CardHeader className="pl-7 pr-5 py-2.5">
          <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div>
                <CardTitle className="text-[19px] leading-tight tracking-tight">{currentNode.title}</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/7 bg-white/[0.03] px-2 py-0.5 text-[10px] normal-case tracking-normal">
                  <Orbit className="size-3.5" />
                  当前小关
                </span>
                <span className="max-w-[220px] truncate text-muted-foreground/80">{courseData?.course.title ?? '未载入课程'}</span>
                <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
                  {progressPercent}% 已完成
                </Badge>
                <Badge
                  variant={currentSession.learningStatus === 'completed' ? 'success' : currentSession.learningStatus === 'correcting' ? 'warning' : 'outline'}
                  className={cn('h-5 rounded-full px-2 text-[10px]', currentSession.requestState === 'loading' && 'animate-pulse')}
                >
                  <BrainCircuit className="size-3" />
                  <span>{currentSession.requestState === 'loading' ? `${learningStatusLabel} · 思考中` : learningStatusLabel}</span>
                </Badge>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 self-center">
              <Button variant="ghost" className="h-7 rounded-2xl px-3 text-[11px]" onClick={() => void reteachCurrentNode('reframe')}>
                <RefreshCcw size={14} />
                换个说法
              </Button>
              <Button variant="ghost" className="h-7 rounded-2xl px-3 text-[11px]" onClick={() => void reteachCurrentNode('deepen')}>
                <Sparkles size={14} />
                讲深一点
              </Button>
            </div>
          </div>

          {currentSession.error ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
              {currentSession.error}
            </div>
          ) : null}

          {stageReplay ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-amber-500/10 bg-amber-500/[0.04] px-3.5 py-2.5 text-[11px] text-amber-100/86">
              <Badge variant="warning" className="h-5 rounded-full px-2 text-[10px]">
                <Flame className="size-3" />
                阶段回放
              </Badge>
              <span>本阶段最近卡住了 {stageReplay.recentMistakeCount} 次</span>
              {stageReplay.focusNodeTitles.length > 0 ? (
                <span className="text-amber-50/92">重点回看：{stageReplay.focusNodeTitles.join('、')}</span>
              ) : null}
              {stageReplay.focusKeywords.length > 0 ? (
                <span className="text-amber-200/72">· 高频漏点：{stageReplay.focusKeywords.slice(0, 3).join('、')}</span>
              ) : null}
              {stageReplay.followupQuestions.length > 0 ? (
                <span className="basis-full text-amber-50/80">回放追问：{stageReplay.followupQuestions[0]}</span>
              ) : null}
            </div>
          ) : null}

          {stageCelebration && currentStage && stageCelebration.stageId === currentStage.id ? (
            <div className="stage-celebration-glow rounded-[18px] border border-emerald-400/14 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(16,185,129,0.04))] px-4 py-3 shadow-[0_0_24px_rgba(16,185,129,0.08)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/18 bg-emerald-400/[0.10] text-emerald-200">
                    <Milestone size={16} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[12px] font-semibold text-emerald-100">这一阶段拿下了</div>
                    <div className="text-[11px] leading-6 text-emerald-50/82">
                      《{stageCelebration.stageTitle}》已经完整打通，共完成 {stageCelebration.completedCount}/{stageCelebration.totalCount} 个小关。现在可以很顺地切进下一段主线。
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="h-7 rounded-2xl px-3 text-[11px] text-emerald-100 hover:bg-emerald-400/[0.08] hover:text-emerald-50"
                  onClick={dismissStageCelebration}
                >
                  收起
                </Button>
              </div>
            </div>
          ) : null}

          {currentStage ? (
            <div className="rounded-[18px] border border-white/7 bg-white/[0.022] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
                    <Compass className="size-3" />
                    当前阶段
                  </Badge>
                  <span className="text-[12px] font-semibold text-foreground">{stageTitle}</span>
                </div>
                <div
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10px] font-medium',
                    stageCompleted
                      ? 'border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-200'
                      : 'border-sky-400/15 bg-sky-400/[0.08] text-sky-100',
                  )}
                >
                  {stageMomentumLabel}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  {stageCompletedCount > 0 ? (
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
                        stageCompleted
                          ? 'bg-emerald-300/90 shadow-[0_0_18px_rgba(52,211,153,0.26)]'
                          : 'bg-sky-300/90 shadow-[0_0_18px_rgba(125,211,252,0.24)]',
                      )}
                      style={{ width: `${Math.max(stageProgressPercent, stageProgressPercent > 0 ? 12 : 0)}%` }}
                    />
                  ) : null}
                </div>
                <span className="shrink-0 text-[10px] font-medium text-foreground/75">{stageProgressPercent}%</span>
              </div>

              <div className="mt-2 text-[11px] text-muted-foreground/90">
                {stageCompleted
                  ? `这一阶段的 ${stageTotalCount} 个小关都已经通过，可以放心进入下一段主线。`
                  : `这一阶段共有 ${stageTotalCount} 个小关，目前已经拿下 ${stageCompletedCount} 个。`}
              </div>

              <div className="mt-2 text-[12px] leading-6 text-muted-foreground">
                {currentStage.summary}
              </div>
              {stageObjectives.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {stageObjectives.map((objective) => (
                    <Badge key={objective} variant="outline" className="rounded-full border-white/8 bg-white/[0.025] px-2.5 py-0.5 text-[10px] text-foreground/82">
                      {objective}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {achievementBadges.length > 0 || recentMilestones.length > 0 ? (
            <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[18px] border border-white/7 bg-white/[0.022] px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  <Award className="size-3.5" />
                  已解锁能力
                </div>
                {achievementBadges.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {achievementBadges.map((badge) => (
                      <span
                        key={badge.code}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[10px] font-medium transition-transform duration-300',
                          freshBadgeCodes.includes(badge.code) && 'achievement-badge-enter',
                          getBadgeToneClass(badge.tone),
                        )}
                        title={badge.description}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-[12px] leading-6 text-muted-foreground">
                    拿下第一个小关后，这里会开始积累属于这门课的能力标签。
                  </div>
                )}
                {recentMilestones.length > 0 ? (
                  <div className="mt-3 rounded-2xl border border-white/6 bg-white/[0.018] px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      <History className="size-3.5" />
                      最近突破
                    </div>
                    <div className="mt-1.5 text-[12px] font-medium text-foreground">{recentMilestones[0].title}</div>
                    <div className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                      {recentMilestones[0].detail}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-[18px] border border-white/7 bg-white/[0.022] px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  <TrendingUp className="size-3.5" />
                  今日推进
                </div>
                <div className="mt-2 text-[13px] font-semibold text-foreground">{momentumSnapshot.momentumLabel}</div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-white/6 bg-white/[0.018] px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">今日小关</div>
                    <div className="mt-1 text-[18px] font-semibold text-foreground">{momentumSnapshot.todayCompletedCount}</div>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-white/[0.018] px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">今日阶段</div>
                    <div className="mt-1 text-[18px] font-semibold text-foreground">{momentumSnapshot.todayStageCount}</div>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-white/[0.018] px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">近24h</div>
                    <div className="mt-1 text-[18px] font-semibold text-foreground">{momentumSnapshot.recentMilestoneCount}</div>
                  </div>
                </div>
                {momentumSnapshot.currentStreak > 0 ? (
                  <div className="mt-3 flex items-center gap-2 rounded-2xl border border-sky-400/12 bg-sky-400/[0.05] px-3 py-2.5 text-[11px] text-sky-100/90">
                    <Gauge className="size-3.5" />
                    <span>当前连过 {momentumSnapshot.currentStreak} 关</span>
                    <span className="text-sky-200/72">
                      {momentumSnapshot.currentStreak >= 5 ? '势头很足，适合继续趁热推进。' : '节奏已经起来了，继续保持。'}
                    </span>
                  </div>
                ) : null}
                <div className="mt-3 text-[11px] text-muted-foreground">
                  最近一次里程碑：{formatRelativeMilestoneTime(momentumSnapshot.latestMilestoneAt)}
                </div>
                {recentMilestones.length > 1 ? (
                  <div className="mt-2 text-[11px] text-muted-foreground/88">
                    最近还完成了：{recentMilestones.slice(1).map((event) => event.title).join('、')}
                  </div>
                ) : null}
              </div>
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
                      全部 {totalStudyCount} 个小关已掌握，这门课会自动沉淀进归档区，之后随时都能回来复习或同步到 Obsidian。
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
          <Card className="work-surface relative flex min-h-0 flex-1 flex-col overflow-hidden border-white/7 bg-[#181818]">
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
              <div className="work-surface h-0 min-h-0 flex-1 overflow-hidden bg-[#181818] px-4 py-4">
                <CoachChatTimeline />
              </div>
              <div className="work-surface relative z-10 shrink-0 bg-[#181818]">
                <CoachComposer
                  progressText={`${effectiveCompletedNodeIds.length}/${totalStudyCount} 已掌握 · ${remainingCount} 节待完成${nextNodeId ? ' · 下一节已预热' : ''}`}
                  onStartQuiz={() => void startQuizForCurrentNode()}
                  onGoToNext={() => void goToNextNode()}
                  canStartQuiz={currentSession.learningStatus === 'teaching' && currentSession.requestState !== 'loading' && !isCourseCompleted}
                  canGoToNext={canAdvanceToNext && Boolean(nextNodeId)}
                  nextLabel={isCourseCompleted || !nextNodeId ? '课程已完成' : '下一节'}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </Card>
    </section>
  )
}

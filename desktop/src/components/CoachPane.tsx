import { useMemo } from 'react'
import {
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  Compass,
  FolderSync,
  Orbit,
  RefreshCcw,
  Sparkles,
} from 'lucide-react'
import { CoachChatTimeline } from '@/components/CoachChatTimeline'
import { CoachComposer } from '@/components/CoachComposer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getNextNodeId } from '@/lib/courseTree'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'

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
  const openNodeSession = useLearningStore((state) => state.openNodeSession)
  const goToNextNode = useLearningStore((state) => state.goToNextNode)
  const currentNode = currentNodeId ? nodeMap[currentNodeId] ?? null : null

  const totalStudyCount = orderedStudyNodeIds.length
  const progressPercent = totalStudyCount > 0 ? Math.round((completedNodeIds.length / totalStudyCount) * 100) : 0
  const nextNodeId = useMemo(
    () => getNextNodeId(orderedStudyNodeIds, nodeMap, completedNodeIds),
    [completedNodeIds, nodeMap, orderedStudyNodeIds],
  )
  const isCourseCompleted = totalStudyCount > 0 && completedNodeIds.length >= totalStudyCount
  const remainingCount = Math.max(0, totalStudyCount - completedNodeIds.length)

  if (!currentNode || !currentSession) {
    return (
      <section className="flex min-h-0 flex-1">
        <Card className="flex min-h-0 w-full items-center justify-center rounded-l-[28px] rounded-r-none border-0 border-l border-t border-white/7 bg-[#181818] shadow-[-14px_0_36px_rgba(0,0,0,0.12)]">
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
      <Card className="flex min-h-0 w-full flex-col overflow-hidden rounded-l-[28px] rounded-r-none border-0 border-l border-t border-white/7 bg-[#181818] shadow-[-14px_0_36px_rgba(0,0,0,0.12)]">
        <CardHeader className="space-y-2 border-b border-white/7 px-5 pb-3 pt-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="space-y-1">
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

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="ghost" className="h-7 rounded-2xl px-3 text-[11px]" onClick={() => void openNodeSession(currentNode.id, { forceRestart: true })}>
                <RefreshCcw size={14} />
                重讲
              </Button>
            </div>
          </div>

          {currentSession.error ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
              {currentSession.error}
            </div>
          ) : null}

          {isCourseCompleted ? (
            <Card className="glass-panel border-emerald-500/15 bg-emerald-500/8">
              <CardContent className="space-y-5 p-4.5">
                <div className="flex items-start gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/12 text-emerald-300">
                    <BookOpenCheck size={18} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-emerald-200/80">完成回顾</div>
                    <div className="text-base font-semibold text-foreground">这门课已经打通了</div>
                    <p className="text-sm leading-6 text-muted-foreground">
                      全部 {totalStudyCount} 个小关已掌握，课程会自动留在左侧归档区，之后你随时都能回来复习。
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">总小关</div>
                    <div className="mt-2 text-2xl font-semibold">{totalStudyCount}</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">掌握率</div>
                    <div className="mt-2 text-2xl font-semibold">100%</div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">课程标题</div>
                    <div className="mt-2 text-base font-semibold">{courseData?.course.title ?? '当前课程'}</div>
                  </div>
                </div>

                {courseData?.course.learning_outcomes?.length ? (
                  <div className="space-y-2 rounded-2xl border border-white/8 bg-black/10 p-4">
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
          <Card className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-white/7 bg-[#161616]">
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
              <div className="h-0 min-h-0 flex-1 overflow-hidden bg-[#161616] px-4 py-4">
                <CoachChatTimeline />
              </div>
              <div className="relative z-10 shrink-0 bg-[#181818]">
                <CoachComposer
                  progressText={`${completedNodeIds.length}/${totalStudyCount} 已掌握 · ${remainingCount} 节待完成${nextNodeId ? ' · 下一节已预热' : ''}`}
                  onStartQuiz={() => void startQuizForCurrentNode()}
                  onGoToNext={() => void goToNextNode()}
                  canStartQuiz={currentSession.learningStatus === 'teaching' && currentSession.requestState !== 'loading' && !isCourseCompleted}
                  canGoToNext={currentSession.learningStatus === 'completed' && currentSession.requestState !== 'loading' && Boolean(nextNodeId)}
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

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderSync,
  LoaderCircle,
  Sparkles,
  Square,
  Trophy,
} from 'lucide-react'
import { ChapterRoadmapDialog } from '@/components/ChapterRoadmapDialog'
import { CourseVisualMapDialog } from '@/components/CourseVisualMapDialog'
import learnChapterMapIcon from '@/assets/learn-chapter-map.svg'
import learnOpenNoteIcon from '@/assets/learn-open-note.svg'
import learnReadSectionIcon from '@/assets/learn-read-section.svg'
import warmStageIcon from '@/assets/warm-stage.svg'
import { CoachChatTimeline } from '@/components/CoachChatTimeline'
import { CoachComposer } from '@/components/CoachComposer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getNextSequentialNodeId } from '@/lib/courseTree'
import { buildLessonSpeechMarkdown, buildStandardAnswerSpeechMarkdown, formatMiniMaxCharacters } from '@/lib/tts'
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
  const importedCoursePath = useLearningStore((state) => state.importedCoursePath)
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
  const [ttsState, setTtsState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle')
  const [stageWarmState, setStageWarmState] = useState<'idle' | 'warming' | 'ready'>('idle')
  const [roadmapOpen, setRoadmapOpen] = useState(false)
  const speechClickTimerRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speechTokenRef = useRef(0)
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
  const courseVisualMap = courseData?.course_visual_map
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
  const lessonSpeechText = useMemo(() => (currentNode ? buildLessonSpeechMarkdown(currentNode) : ''), [currentNode])
  const standardAnswerSpeechText = useMemo(
    () => (currentNode ? buildStandardAnswerSpeechMarkdown(currentNode) : ''),
    [currentNode],
  )

  const stopSpeech = () => {
    speechTokenRef.current += 1
    audioRef.current?.pause()
    audioRef.current?.removeAttribute('src')
    audioRef.current?.load()
    audioRef.current = null
    setTtsState('idle')
  }

  useEffect(() => {
    stopSpeech()
  }, [currentNodeId])

  useEffect(() => {
    return () => {
      if (speechClickTimerRef.current) {
        window.clearTimeout(speechClickTimerRef.current)
        speechClickTimerRef.current = null
      }
      stopSpeech()
    }
  }, [])

  const playSpeechText = async (text: string, nodeId: string | null) => {
    if (!text.trim()) return
    stopSpeech()
    const speechToken = speechTokenRef.current + 1
    speechTokenRef.current = speechToken
    setTtsState('loading')
    try {
      const result = await window.desktopAPI.synthesizeSpeech({
        text,
        nodeId,
      })
      if (speechTokenRef.current !== speechToken) return
      if (!result.cached) {
        pushToast(
          '语音已生成',
          result.provider === 'minimax'
            ? `本节消耗约 ${formatMiniMaxCharacters(result.characters)} MiniMax 字符；今日本地估算剩余 ${formatMiniMaxCharacters(result.usage.remainingCharacters)}。`
            : '本节已用 MiMo 生成；缓存命中不会重复调用。',
          'success',
        )
      }
      setTtsState('playing')
      const dataUrls = result.dataUrls?.length ? result.dataUrls : [result.dataUrl]
      for (const dataUrl of dataUrls) {
        if (speechTokenRef.current !== speechToken) return
        const audio = new Audio(dataUrl)
        audioRef.current = audio
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve()
          audio.onerror = () => reject(new Error('音频播放失败，请检查系统音频设置。'))
          void audio.play().catch(reject)
        })
      }
      if (speechTokenRef.current !== speechToken) return
      audioRef.current = null
      setTtsState('idle')
    } catch (error) {
      if (speechTokenRef.current !== speechToken) return
      setTtsState('idle')
      pushToast('朗读失败', error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const playSpeech = async () => {
    if (!lessonSpeechText) return
    if (ttsState === 'playing') {
      audioRef.current?.pause()
      setTtsState('paused')
      return
    }
    if (ttsState === 'paused') {
      setTtsState('playing')
      await audioRef.current?.play().catch((error) => {
        setTtsState('paused')
        pushToast('继续播放失败', error instanceof Error ? error.message : String(error), 'error')
      })
      return
    }
    if (ttsState === 'loading') return
    await playSpeechText(lessonSpeechText, currentNodeId)
  }

  const handleSpeechClick = () => {
    if (speechClickTimerRef.current) {
      window.clearTimeout(speechClickTimerRef.current)
      speechClickTimerRef.current = null
    }
    speechClickTimerRef.current = window.setTimeout(() => {
      speechClickTimerRef.current = null
      void playSpeech()
    }, 220)
  }

  const handleSpeechDoubleClick = () => {
    if (speechClickTimerRef.current) {
      window.clearTimeout(speechClickTimerRef.current)
      speechClickTimerRef.current = null
    }
    stopSpeech()
    void playSpeechText(lessonSpeechText, currentNodeId)
  }

  const warmCurrentStageSpeech = async () => {
    if (stageWarmState === 'warming') return
    const targetIds = currentStageStudyNodeIds.length > 0
      ? currentStageStudyNodeIds
      : currentNodeId
        ? [currentNodeId]
        : []
    if (targetIds.length === 0) return

    setStageWarmState('warming')
    try {
      let warmedTextCount = 0
      for (const nodeId of targetIds) {
        const node = nodeMap[nodeId]
        if (!node) continue
        const texts = [buildLessonSpeechMarkdown(node), buildStandardAnswerSpeechMarkdown(node)]
          .map((text) => text.trim())
          .filter(Boolean)
        for (const text of texts) {
          const cacheStatus = await window.desktopAPI.checkSpeechCache({ text, nodeId })
          if (!cacheStatus.cached) {
            await window.desktopAPI.synthesizeSpeech({ text, nodeId })
          }
          warmedTextCount += 1
        }
      }
      setStageWarmState('ready')
      pushToast('章节语音已预热', `已准备 ${targetIds.length} 节内容，包含答后标准答案。`, 'success')
      window.setTimeout(() => setStageWarmState('idle'), 2200)
      void warmedTextCount
    } catch (error) {
      setStageWarmState('idle')
      pushToast('章节预热失败', error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const playStandardAnswerIfCached = async () => {
    if (!standardAnswerSpeechText || !currentNodeId) return
    const cacheStatus = await window.desktopAPI.checkSpeechCache({
      text: standardAnswerSpeechText,
      nodeId: currentNodeId,
    })
    if (!cacheStatus.cached) return
    await playSpeechText(standardAnswerSpeechText, currentNodeId)
  }

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
        target === 'current' ? '笔记已打开' : 'Obsidian 已打开',
        target === 'current'
          ? `已打开当前小节笔记：${result.openedPath}`
          : target === 'board'
            ? `已打开学习看板：${result.openedPath}`
            : `已打开课程总览：${result.openedPath}`,
        'success',
      )
    } catch (error) {
      pushToast('打开 Obsidian 失败', error instanceof Error ? error.message : String(error), 'error')
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
    <section className="work-surface flex min-h-0 flex-1 flex-col overflow-hidden rounded-l-[24px] bg-[#171717]">
      <header className="flex h-[58px] shrink-0 items-center justify-between gap-4 px-6">
        <h1 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-foreground/92">
          {currentNode.title}
        </h1>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl border-0 bg-transparent text-foreground/78 hover:bg-white/[0.07] hover:text-foreground"
            onClick={() => setRoadmapOpen(true)}
            disabled={!currentStage && !courseVisualMap}
            aria-label={courseVisualMap ? '全局地图' : '章节地图'}
            title={courseVisualMap ? '全局地图' : '章节地图'}
          >
            <img src={learnChapterMapIcon} alt="" className="size-[18px]" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl border-0 bg-transparent text-foreground/78 hover:bg-white/[0.07] hover:text-foreground"
            onClick={handleSpeechClick}
            onDoubleClick={handleSpeechDoubleClick}
            disabled={!lessonSpeechText}
            aria-label="朗读本节"
            title="单击播放/暂停，双击重新开始"
          >
            {ttsState === 'loading' ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : ttsState === 'playing' ? (
              <Square className="size-4" />
            ) : (
              <img src={learnReadSectionIcon} alt="" className="size-[18px]" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl border-0 bg-transparent text-foreground/78 hover:bg-white/[0.07] hover:text-foreground"
            onClick={() => void warmCurrentStageSpeech()}
            disabled={stageWarmState === 'warming' || currentStageStudyNodeIds.length === 0}
            aria-label="预热本章语音"
            title="预热本章语音"
          >
            {stageWarmState === 'warming' ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : stageWarmState === 'ready' ? (
              <Sparkles className="size-4" />
            ) : (
              <img src={warmStageIcon} alt="" className="size-[18px]" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl border-0 bg-transparent text-foreground/78 hover:bg-white/[0.07] hover:text-foreground"
            onClick={() => void syncObsidian('current')}
            disabled={obsidianSyncing}
            aria-label="打开笔记"
            title="打开笔记"
          >
            {obsidianSyncing ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <img src={learnOpenNoteIcon} alt="" className="size-[18px]" />
            )}
          </Button>
        </div>
      </header>

      {currentSession.error ? (
        <div className="mx-6 mb-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
          {currentSession.error}
        </div>
      ) : null}

      {courseVisualMap ? (
        <CourseVisualMapDialog
          open={roadmapOpen}
          onOpenChange={setRoadmapOpen}
          courseTitle={courseData?.course.title || '课程地图'}
          chapterCount={courseData?.chapters.length || 0}
          courseVisualMap={courseVisualMap}
          coursePackagePath={importedCoursePath}
        />
      ) : (
        <ChapterRoadmapDialog
          open={roadmapOpen}
          onOpenChange={setRoadmapOpen}
          chapter={currentStage}
          nodeMap={nodeMap}
          completedNodeIds={effectiveCompletedNodeIds}
          currentNodeId={currentNodeId}
          coursePackagePath={importedCoursePath}
        />
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#171717] px-6 pb-24">
        <CoachChatTimeline />
        <CoachComposer
          progressText=""
          onGoToNext={() => void goToNextNode()}
          canGoToNext={canAdvanceToNext && Boolean(nextNodeId)}
          nextLabel={isCourseCompleted ? '课程已完成' : '下一节'}
          onAnswerSubmitted={playStandardAnswerIfCached}
        />
      </div>
    </section>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowRight,
  BookOpenText,
  FolderOpen,
  LoaderCircle,
  Sparkles,
  Square,
} from 'lucide-react'
import learnChapterMapIcon from '@/assets/learn-chapter-map.svg'
import learnOpenNoteIcon from '@/assets/learn-open-note.svg'
import learnReadSectionIcon from '@/assets/learn-read-section.svg'
import warmStageIcon from '@/assets/warm-stage.svg'
import { CoachChatTimeline } from '@/components/CoachChatTimeline'
import { CoachComposer } from '@/components/CoachComposer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getNextSequentialNodeId } from '@/lib/studyTree'
import { buildLessonSpeechMarkdown, formatMiniMaxCharacters } from '@/lib/tts'
import { useLearningStore } from '@/store'

// 专注 still consumes the internal study-package adapter so existing reading,
// TTS, and Obsidian affordances remain available after the product pivot.
function stripStagePrefix(title: string) {
  return title.replace(/^(?:学习)?阶段\s*\d+\s*[·\-:：]\s*/u, '').replace(/^阶段\s*\d+\s*/u, '').trim()
}

function stripGeneratedTitleNumber(title: string) {
  const stripped = title
    .replace(/^第\s*\d+\s*[章节部]\s*[：:、.\-\s]*/u, '')
    .replace(/^\d+(?:\.\d+)*\s*[、.．:：\-\s]+/u, '')
    .replace(/^[一二三四五六七八九十百千万]+[、.．:：\-\s]+/u, '')
    .trim()
  return stripped || title
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

function buildInlineMindmapMessage({
  fullMap,
  stage,
  studyNodeIds,
  nodeMap,
}: {
  fullMap?: string
  stage: { title: string; summary: string } | null
  studyNodeIds: string[]
  nodeMap: Record<string, { title: string; summary: string }>
}) {
  if (fullMap?.trim()) {
    return `## 章节思维导图\n\n${fullMap.trim()}`
  }

  if (!stage) return ''

  const title = stripGeneratedTitleNumber(stripStagePrefix(stage.title) || stage.title)
  const studyNodes = studyNodeIds
    .map((nodeId) => nodeMap[nodeId])
    .filter((node): node is { title: string; summary: string } => Boolean(node))

  const lines = [`## ${title}：章节思维导图`]
  if (stage.summary) {
    lines.push(`**本章主线**：${stage.summary}`)
  }

  if (studyNodes.length > 0) {
    lines.push(
      [
        '**学习分支**',
        ...studyNodes.map((node, index) => {
          const nodeTitle = stripGeneratedTitleNumber(node.title)
          const summary = node.summary ? `\n   ${node.summary}` : ''
          return `${index + 1}. **${nodeTitle}**${summary}`
        }),
      ].join('\n'),
    )
  }

  if (studyNodes.length > 1) {
    lines.push(`**推荐阅读路径**：${studyNodes.map((node) => stripGeneratedTitleNumber(node.title)).join(' -> ')}`)
  }

  lines.push('切到其他章节后再点一次地图按钮，会把那一章的结构发送到这里。')
  return lines.join('\n\n')
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

function formatHomeRelativeTime(timestamp: number) {
  if (!timestamp) return '刚刚'
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟前`
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时前`
  if (diff < day * 7) return `${Math.max(1, Math.round(diff / day))} 天前`

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(timestamp)
}

type PetExpression = '' | 'blink' | 'tension' | 'happy'

const HOME_PET_SEQUENCE: { state: PetExpression; duration: number }[] = [
  { state: '', duration: 3000 },
  { state: 'blink', duration: 150 },
  { state: 'tension', duration: 2500 },
  { state: 'blink', duration: 150 },
  { state: 'happy', duration: 2500 },
  { state: 'blink', duration: 150 },
]

function LearningHomePet() {
  const [expression, setExpression] = useState<PetExpression>('')

  useEffect(() => {
    let step = 0
    let timer: number | null = null

    const nextExpression = () => {
      const current = HOME_PET_SEQUENCE[step]
      setExpression(current.state)
      step = (step + 1) % HOME_PET_SEQUENCE.length
      timer = window.setTimeout(nextExpression, current.duration)
    }

    timer = window.setTimeout(nextExpression, HOME_PET_SEQUENCE[0].duration)
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className="relative flex size-[112px] items-center justify-center" aria-hidden="true">
      <div className="relative h-[90px] w-[92px]">
        <div
          className={[
            'flex h-[78px] w-[86px] items-center justify-evenly rounded-[30px] bg-[#d8d8d8] px-3 transition-colors',
            expression,
          ].filter(Boolean).join(' ')}
        >
          <span className="yu-home-eye yu-home-eye-left" />
          <span className="yu-home-eye yu-home-eye-right" />
        </div>
      </div>
      <style>{`
        .yu-home-eye {
          width: 14px;
          height: 25px;
          border: 0 solid #171717;
          border-radius: 999px;
          background: #171717;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .blink .yu-home-eye {
          width: 18px;
          height: 4px;
          border-radius: 999px;
          background: #171717;
          transform: translateY(0);
        }
        .tension .yu-home-eye {
          width: 20px;
          height: 6px;
          border-radius: 999px;
          background: #171717;
        }
        .tension .yu-home-eye-left {
          transform: rotate(35deg);
        }
        .tension .yu-home-eye-right {
          transform: rotate(-35deg);
        }
        .happy .yu-home-eye {
          width: 24px;
          height: 12px;
          border: 4px solid #171717;
          border-bottom: 0;
          border-radius: 999px 999px 0 0;
          background: transparent;
          transform: translateY(-4px);
        }
      `}</style>
    </div>
  )
}

type CoachPaneProps = {
  showHome?: boolean
  onStartLearning?: () => void
  onOpenWorkbench?: () => void
  onOpenArchive?: () => void
}

export function CoachPane({
  showHome = false,
  onStartLearning,
  onOpenWorkbench,
  onOpenArchive,
}: CoachPaneProps) {
  const courseData = useLearningStore((state) => state.courseData)
  const libraryRecords = useLearningStore((state) => state.libraryRecords)
  const activeRecordId = useLearningStore((state) => state.activeRecordId)
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
  const openSavedRecord = useLearningStore((state) => state.openSavedRecord)
  const appendCoachMessage = useLearningStore((state) => state.appendCoachMessage)
  const pushToast = useLearningStore((state) => state.pushToast)
  const isCurrentNodeUnlocked = useLearningStore((state) =>
    state.currentNodeId ? state.isNodeUnlocked(state.currentNodeId) : false,
  )
  const [obsidianSyncing, setObsidianSyncing] = useState(false)
  const [ttsState, setTtsState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle')
  const [stageWarmState, setStageWarmState] = useState<'idle' | 'warming' | 'ready'>('idle')
  const [homeOpeningRecordId, setHomeOpeningRecordId] = useState<string | null>(null)
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
  const chapterMindmapMarkdown = courseData?.course_visual_map?.prompt ?? ''
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
        : '你已经把这份资料完整读完，后续可以作为长期资料回看。'
  const lessonSpeechText = useMemo(() => (currentNode ? buildLessonSpeechMarkdown(currentNode) : ''), [currentNode])
  const resumeRecord = useMemo(() => {
    const sortedRecords = [...libraryRecords].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    return (
      sortedRecords.find((record) => record.id === activeRecordId) ??
      sortedRecords.find((record) => !record.isArchived) ??
      sortedRecords[0] ??
      null
    )
  }, [activeRecordId, libraryRecords])
  const activeRecordCount = libraryRecords.filter((record) => !record.isArchived).length
  const archivedRecordCount = libraryRecords.length - activeRecordCount

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
        const texts = [buildLessonSpeechMarkdown(node)]
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
      pushToast('章节语音已预热', `已准备 ${targetIds.length} 节内容。`, 'success')
      window.setTimeout(() => setStageWarmState('idle'), 2200)
      void warmedTextCount
    } catch (error) {
      setStageWarmState('idle')
      pushToast('章节预热失败', error instanceof Error ? error.message : String(error), 'error')
    }
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
            : `已打开资料总览：${result.openedPath}`,
        'success',
      )
    } catch (error) {
      pushToast('打开 Obsidian 失败', error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setObsidianSyncing(false)
    }
  }

  const handleResumeFromHome = async () => {
    if (!resumeRecord) {
      onOpenWorkbench?.()
      return
    }

    if (courseData && currentNode && currentSession && resumeRecord.id === activeRecordId) {
      onStartLearning?.()
      return
    }

    setHomeOpeningRecordId(resumeRecord.id)
    try {
      await openSavedRecord(resumeRecord.id)
      onStartLearning?.()
    } catch (error) {
      pushToast('恢复学习失败', error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setHomeOpeningRecordId(null)
    }
  }

  const sendCurrentStageMindmap = () => {
    if (!currentNodeId || !currentStage) return
    const content = buildInlineMindmapMessage({
      fullMap: chapterMindmapMarkdown,
      stage: currentStage,
      studyNodeIds: currentStageStudyNodeIds,
      nodeMap,
    })
    if (!content) return

    appendCoachMessage({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      role: 'coach',
      content,
      nodeId: currentNodeId,
      createdAt: Date.now(),
    })
    pushToast('章节思维导图已发送', stripGeneratedTitleNumber(currentStage.title), 'success')
  }

  if (showHome || !currentNode || !currentSession) {
    return (
      <section className="flex min-h-0 flex-1">
        <Card className="work-surface flex min-h-0 w-full items-center justify-center rounded-l-[24px] rounded-r-none border-0 bg-[#181818] shadow-[-14px_0_34px_rgba(0,0,0,0.12)]">
          <CardContent className="w-full max-w-[760px] space-y-6 px-10 py-8">
            <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
              <LearningHomePet />
              <div className="space-y-2">
                <h2 className="text-[30px] font-semibold tracking-tight text-foreground">今天从哪里开始</h2>
                <p className="text-[13px] leading-6 text-muted-foreground">接着上次阅读，或者去制作页整理新的资料。</p>
              </div>
            </div>

            {resumeRecord ? (
              <button
                type="button"
                className="group w-full rounded-[22px] border border-white/[0.08] bg-white/[0.03] p-4 text-left transition hover:border-sky-300/18 hover:bg-white/[0.045]"
                onClick={() => void handleResumeFromHome()}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="truncate text-[15px] font-semibold text-foreground">{resumeRecord.title}</div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{resumeRecord.progressPercent}%</span>
                      {resumeRecord.currentNodeTitle ? <span className="truncate">继续：{resumeRecord.currentNodeTitle}</span> : null}
                      <span>{formatHomeRelativeTime(resumeRecord.lastOpenedAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[12px] font-semibold text-foreground/86">
                    {homeOpeningRecordId === resumeRecord.id ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
                    )}
                    继续
                  </div>
                </div>
              </button>
            ) : (
              <div className="rounded-[22px] border border-white/[0.08] bg-white/[0.025] px-4 py-4 text-center text-[13px] text-muted-foreground">
                还没有资料记录。
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <Button
                type="button"
                className="h-12 rounded-2xl"
                onClick={() => void handleResumeFromHome()}
                disabled={Boolean(homeOpeningRecordId)}
              >
                {homeOpeningRecordId ? <LoaderCircle className="size-4 animate-spin" /> : <BookOpenText size={16} />}
                {resumeRecord ? '继续阅读' : '去制作'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-2xl"
                onClick={onOpenWorkbench}
              >
                <FolderOpen size={16} />
                制作
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-2xl"
                onClick={onOpenArchive}
              >
                <Archive size={16} />
                档案
              </Button>
            </div>

            <div className="flex items-center justify-center gap-3 text-[11px] text-muted-foreground">
              <span>进行中 {activeRecordCount}</span>
              <span className="h-1 w-1 rounded-full bg-white/20" />
              <span>已归档 {archivedRecordCount}</span>
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
          {stripGeneratedTitleNumber(currentNode.title)}
        </h1>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl border-0 bg-transparent text-foreground/78 hover:bg-white/[0.07] hover:text-foreground"
            onClick={sendCurrentStageMindmap}
            disabled={!currentStage && !chapterMindmapMarkdown.trim()}
            aria-label="发送章节思维导图"
            title="发送章节思维导图"
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

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#171717] px-6 pb-24">
        <CoachChatTimeline />
        <CoachComposer
          progressText=""
          onGoToNext={() => void goToNextNode()}
          canGoToNext={canAdvanceToNext && Boolean(nextNodeId)}
          nextLabel={isCourseCompleted ? '已完成' : '下一节'}
        />
      </div>
    </section>
  )
}

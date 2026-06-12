import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, MessageSquareDashed, Square, Volume2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArticleHtmlRenderer } from '@/components/ArticleHtmlRenderer'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { buildLessonSpeechMarkdown, estimateMiniMaxSpeechCharacters, formatMiniMaxCharacters } from '@/lib/tts'
import teacherAvatar from '@/assets/teacher-avatar.svg'
import studentAvatar from '@/assets/student-avatar.svg'

// Chat-style rendering for the 专注 compatibility reader. Current short-video
// production enters this surface as article/readable material, not as a course.
function hasRenderableCoachContent(content: string) {
  const withoutCodeFences = content.replace(/```[\s\S]*?```/g, ' ')
  const withoutHeadings = withoutCodeFences.replace(/^\s*#{1,6}\s+/gm, '')
  const withoutRules = withoutHeadings.replace(/^\s*([-*_]\s*){3,}\s*$/gm, ' ')
  const withoutListMarkers = withoutRules.replace(/^\s*([-*]|\d+\.)\s+/gm, '')
  const normalized = withoutListMarkers.replace(/[`>*|]/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.length > 0
}

export function CoachChatTimeline() {
  const coachDisplayName = '知知老师'
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const currentNode = useLearningStore((state) =>
    state.currentNodeId ? state.nodeMap[state.currentNodeId] ?? null : null,
  )
  const currentSession = useLearningStore((state) =>
    state.currentNodeId ? state.nodeSessions[state.currentNodeId] ?? null : null,
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const previousNodeIdRef = useRef<string | null>(null)
  const previousMessageIdsRef = useRef<string[]>([])
  const scrollNodeIdRef = useRef<string | null>(null)
  const scrollMessageCountRef = useRef(0)
  const suppressInitialAutoScrollRef = useRef(false)
  const pendingScrollTargetMessageIdRef = useRef<string | null>(null)
  const revealTimersRef = useRef<number[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speechTokenRef = useRef(0)
  const [revealedMessageIds, setRevealedMessageIds] = useState<string[]>([])
  const [ttsState, setTtsState] = useState<{ messageId: string; status: 'loading' | 'playing' } | null>(null)
  const pushToast = useLearningStore((state) => state.pushToast)

  const visibleMessages = useMemo(
    () =>
      (currentSession?.messages ?? []).filter((message) => {
        if (message.role === 'system') return false
        if (message.role !== 'coach') return true
        return hasRenderableCoachContent(message.content)
      }),
    [currentSession?.messages],
  )
  const visibleMessageIds = useMemo(() => visibleMessages.map((message) => message.id), [visibleMessages])
  const requestState = currentSession?.requestState ?? 'idle'
  const hiddenCoachMessageCount = useMemo(
    () =>
      visibleMessages.filter((message) => message.role === 'coach' && !revealedMessageIds.includes(message.id)).length,
    [revealedMessageIds, visibleMessages],
  )
  const showTypingBubble = requestState === 'loading' || hiddenCoachMessageCount > 0
  const lessonSpeechId = currentNodeId ? `lesson:${currentNodeId}` : 'lesson'

  useEffect(() => {
    return () => {
      revealTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      revealTimersRef.current = []
      speechTokenRef.current += 1
      audioRef.current?.pause()
      audioRef.current?.removeAttribute('src')
      audioRef.current?.load()
      audioRef.current = null
    }
  }, [])

  const stopSpeech = () => {
    speechTokenRef.current += 1
    audioRef.current?.pause()
    audioRef.current?.removeAttribute('src')
    audioRef.current?.load()
    audioRef.current = null
    setTtsState(null)
  }

  useEffect(() => {
    stopSpeech()
  }, [currentNodeId])

  const playSpeech = async (speechId: string, content: string) => {
    if (ttsState?.messageId === speechId) {
      stopSpeech()
      return
    }

    stopSpeech()
    const speechToken = speechTokenRef.current + 1
    speechTokenRef.current = speechToken
    setTtsState({ messageId: speechId, status: 'loading' })
    try {
      const result = await window.desktopAPI.synthesizeSpeech({
        text: content,
        nodeId: currentNodeId,
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
      setTtsState({ messageId: speechId, status: 'playing' })
      const dataUrls = result.dataUrls?.length ? result.dataUrls : [result.dataUrl]
      for (let index = 0; index < dataUrls.length; index += 1) {
        if (speechTokenRef.current !== speechToken) return
        const audio = new Audio(dataUrls[index])
        audioRef.current = audio
        audio.ontimeupdate = () => {
          const container = containerRef.current
          if (!container || !Number.isFinite(audio.duration) || audio.duration <= 0) return
          const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
          const segmentProgress = Math.min(1, audio.currentTime / audio.duration)
          container.scrollTo({
            top: maxScrollTop * Math.min(1, (index + segmentProgress) / dataUrls.length),
            behavior: 'smooth',
          })
        }
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve()
          audio.onerror = () => reject(new Error('音频播放失败，请检查系统音频设置。'))
          void audio.play().catch(reject)
        })
      }
      if (speechTokenRef.current !== speechToken) return
      audioRef.current = null
      setTtsState(null)
    } catch (error) {
      if (speechTokenRef.current !== speechToken) return
      setTtsState(null)
      pushToast('朗读失败', error instanceof Error ? error.message : String(error), 'error')
    }
  }

  useEffect(() => {
    const currentIds = visibleMessageIds
    const previousIds = previousMessageIdsRef.current
    const sameNode = previousNodeIdRef.current === currentNodeId

    revealTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    revealTimersRef.current = []

    if (!sameNode) {
      setRevealedMessageIds(currentIds)
      previousNodeIdRef.current = currentNodeId
      previousMessageIdsRef.current = currentIds
      return
    }

    const addedMessages = visibleMessages.filter((message) => !previousIds.includes(message.id))
    if (addedMessages.length === 0) {
      previousMessageIdsRef.current = currentIds
      return
    }

    const addedCoachMessage = addedMessages.find((message) => message.role === 'coach') ?? null
    const addedUserMessage = addedMessages.some((message) => message.role === 'user')
    if (addedUserMessage && addedCoachMessage) {
      pendingScrollTargetMessageIdRef.current = addedCoachMessage.id
    }

    const baseIds = currentIds.filter((id) => previousIds.includes(id))
    const shouldStaggerCoachMessages = addedMessages.every((message) => message.role === 'coach')

    if (!shouldStaggerCoachMessages) {
      setRevealedMessageIds(currentIds)
      previousMessageIdsRef.current = currentIds
      return
    }

    setRevealedMessageIds(baseIds)
    addedMessages.forEach((message, index) => {
      const timer = window.setTimeout(() => {
        setRevealedMessageIds((current) => (current.includes(message.id) ? current : [...current, message.id]))
      }, 260 + index * 240)
      revealTimersRef.current.push(timer)
    })

    previousMessageIdsRef.current = currentIds
  }, [currentNodeId, visibleMessageIds, visibleMessages])

  const renderedMessages = useMemo(
    () => visibleMessages.filter((message) => revealedMessageIds.includes(message.id)),
    [revealedMessageIds, visibleMessages],
  )
  const articleReadingMode = Boolean(currentNode?.teacher_ready_content?.display_hints?.includes('article_reading'))
  const articleHtml = currentNode?.teacher_ready_content?.teaching_html?.trim() ?? ''
  const lessonSpeechText = useMemo(() => (currentNode ? buildLessonSpeechMarkdown(currentNode) : ''), [currentNode])
  const lessonSpeechCharacters = useMemo(
    () => estimateMiniMaxSpeechCharacters(lessonSpeechText),
    [lessonSpeechText],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const isNewNode = scrollNodeIdRef.current !== currentNodeId
    const hasNewMessageInSameNode =
      !isNewNode && renderedMessages.length > scrollMessageCountRef.current

    scrollNodeIdRef.current = currentNodeId
    scrollMessageCountRef.current = renderedMessages.length

    if (isNewNode) {
      suppressInitialAutoScrollRef.current = renderedMessages.length === 0
      container.scrollTo({
        top: 0,
        behavior: 'auto',
      })
      return
    }

    if (suppressInitialAutoScrollRef.current) {
      if (renderedMessages.length > 0) {
        suppressInitialAutoScrollRef.current = false
        container.scrollTo({
          top: 0,
          behavior: 'auto',
        })
      }
      return
    }

    if (pendingScrollTargetMessageIdRef.current && hasNewMessageInSameNode) {
      const target = container.querySelector<HTMLElement>(
        `[data-message-id="${pendingScrollTargetMessageIdRef.current}"]`,
      )
      pendingScrollTargetMessageIdRef.current = null
      if (target) {
        container.scrollTo({
          top: Math.max(0, target.offsetTop - 12),
          behavior: 'smooth',
        })
        return
      }
    }

    if (!hasNewMessageInSameNode && requestState !== 'loading' && hiddenCoachMessageCount === 0) return

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    })
  }, [currentNodeId, renderedMessages.length, requestState, hiddenCoachMessageCount])

  return (
    <div
      ref={containerRef}
      className={cn(
        'subtle-scrollbar h-full min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1',
        articleReadingMode
          ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(76,90,130,0.10),transparent_34%),linear-gradient(180deg,#191a1f_0%,#15161a_100%)]'
          : 'bg-[#171717]',
      )}
    >
      <div className="flex w-full flex-col gap-3 pt-2 pb-28">
        {renderedMessages.length ? (
          renderedMessages.map((message, index) => {
            const previousMessage = index > 0 ? renderedMessages[index - 1] : null
            const nextMessage = index < renderedMessages.length - 1 ? renderedMessages[index + 1] : null
            const showAvatar = previousMessage?.role !== message.role
            const isGroupStart = previousMessage?.role !== message.role
            const isGroupEnd = nextMessage?.role !== message.role
            const groupLabel = message.role === 'coach' ? coachDisplayName : ''
            const isArticleCoachMessage =
              message.role === 'coach' &&
              articleReadingMode &&
              message.content.length > 800 &&
              /(^|\n)#{1,3}\s+/u.test(message.content)

            return (
              <article
                key={message.id}
                data-message-id={message.id}
                className={cn(
                  'chat-message-enter flex w-full',
                  message.role === 'user' ? 'justify-end' : 'justify-start',
                  isGroupStart ? 'mt-1' : 'mt-[-4px]',
                )}
              >
                <div
                  className={cn(
                    'flex min-w-0 items-start gap-2',
                    isArticleCoachMessage
                      ? 'w-full max-w-full'
                      : message.role === 'coach'
                        ? 'max-w-[94%]'
                        : 'max-w-[72%] ml-auto flex-row-reverse',
                  )}
                >
                  {showAvatar && !isArticleCoachMessage ? (
                    <div
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/[0.08] bg-[#202224]',
                        message.role === 'coach' ? 'mt-0 translate-x-6' : 'mt-[2px]',
                        message.role === 'coach'
                          ? 'shadow-[0_8px_18px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.02)_inset]'
                          : 'shadow-[0_8px_16px_rgba(0,0,0,0.10),0_0_0_1px_rgba(255,255,255,0.02)_inset]',
                      )}
                    >
                      <img
                        src={message.role === 'coach' ? teacherAvatar : studentAvatar}
                        alt={message.role === 'coach' ? '老师头像' : '学生头像'}
                        className="size-full object-cover"
                      />
                    </div>
                  ) : !isArticleCoachMessage ? (
                    <div className="size-9 shrink-0" aria-hidden />
                  ) : null}

                  <div
                    className={cn(
                      'min-w-0 max-w-full',
                      isArticleCoachMessage ? 'w-full' : message.role === 'coach' && 'pl-6',
                      message.role === 'user' && 'flex flex-col items-end',
                    )}
                  >
                    {showAvatar && groupLabel && !isArticleCoachMessage ? (
                      <div
                        className={cn(
                          'mb-1 pl-3 text-[12px] font-semibold leading-[18px] tracking-tight text-[#d7dee8]',
                          message.role === 'user' && 'text-right',
                        )}
                      >
                        {groupLabel}
                      </div>
                    ) : null}

                    {message.role === 'coach' ? (
                      isArticleCoachMessage ? (
                        <div className="mx-auto w-full max-w-[1160px] px-3 py-4">
                          {articleHtml ? (
                            <ArticleHtmlRenderer html={articleHtml} />
                          ) : (
                            <MarkdownRenderer
                              content={message.content}
                              hideLeadHeading
                              articleMode
                              className="space-y-5"
                            />
                          )}
                        </div>
                      ) : (
                        <div className="inline-flex max-w-full flex-col rounded-[22px] border border-white/[0.06] bg-[#181818] px-4 py-3.5 shadow-[0_8px_22px_rgba(0,0,0,0.10)]">
                          <MarkdownRenderer
                            content={message.content}
                            hideLeadHeading
                            className="space-y-3"
                          />
                        </div>
                      )
                    ) : (
                      <div
                        className={cn(
                          'w-fit max-w-full border border-sky-200/[0.12] bg-[linear-gradient(180deg,rgba(31,41,54,0.98),rgba(24,31,41,0.98))] px-4 py-3 shadow-[0_0_0_1px_rgba(125,211,252,0.04)_inset]',
                          isGroupStart ? 'rounded-t-[22px]' : 'rounded-t-[17px]',
                          !isGroupEnd && 'rounded-b-[18px]',
                          isGroupEnd && 'rounded-b-[22px]',
                        )}
                      >
                        <MarkdownRenderer content={message.content} />
                      </div>
                    )}
                  </div>
                </div>
              </article>
            )
          })
        ) : (
          <Card className="border-dashed border-white/8 bg-[#1a1a1a] shadow-none">
            <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-white/7 bg-[#222222] text-muted-foreground">
                <MessageSquareDashed size={18} />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">阅读台已就绪</div>
                <p className="text-sm leading-6 text-muted-foreground">选中一个小节后，这里会显示正文、回看和推进记录。</p>
              </div>
            </CardContent>
          </Card>
        )}

        {showTypingBubble ? (
          <article className="chat-message-enter flex w-full justify-start">
            <div className="flex min-w-0 max-w-[94%] items-start gap-2">
              <div className="mt-0 flex size-9 shrink-0 translate-x-6 items-center justify-center overflow-hidden rounded-full border border-white/[0.08] bg-[#202224] shadow-[0_8px_18px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.02)_inset]">
                <img
                  src={teacherAvatar}
                  alt="老师头像"
                  className="size-full object-cover"
                />
              </div>

              <div className="min-w-0 max-w-full pl-6">
                <div className="mb-1 pl-3 text-[12px] font-semibold leading-[18px] tracking-tight text-[#d7dee8]">{coachDisplayName}</div>
                <div className="w-fit min-w-0 max-w-full">
                  <div className="max-w-[280px] rounded-[24px] border border-white/[0.075] bg-[linear-gradient(180deg,rgba(29,29,30,0.98),rgba(26,26,27,0.98))] px-4 py-3.5 shadow-[0_0_0_1px_rgba(255,255,255,0.025)_inset]">
                    <div className="flex items-center gap-1.5">
                      <span className="typing-dot size-2 rounded-full bg-foreground/70" />
                      <span className="typing-dot size-2 rounded-full bg-foreground/58 [animation-delay:120ms]" />
                      <span className="typing-dot size-2 rounded-full bg-foreground/46 [animation-delay:240ms]" />
                      <span className="ml-2 whitespace-nowrap text-[12px] text-muted-foreground">
                        {requestState === 'loading' ? '老师正在组织这一段讲解…' : '老师正在继续往下说…'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </article>
        ) : null}
      </div>
    </div>
  )
}

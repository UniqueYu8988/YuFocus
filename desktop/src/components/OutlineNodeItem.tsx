import { AudioLines, Check, CheckCircle2, ChevronDown, CircleDot, LoaderCircle, Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { buildLessonSpeechMarkdown, estimateMiniMaxSpeechCharacters, formatMiniMaxCharacters } from '@/lib/tts'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'

type TtsWarmState = {
  status: 'idle' | 'warming' | 'ready' | 'error'
  done: number
  total: number
  characters: number
}

export function OutlineNodeItem({ nodeId }: { nodeId: string }) {
  const node = useLearningStore((state) => state.nodeMap[nodeId])
  const nodeMap = useLearningStore((state) => state.nodeMap)
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const setCurrentNode = useLearningStore((state) => state.setCurrentNode)
  const isNodeUnlocked = useLearningStore((state) => state.isNodeUnlocked)
  const isNodeCompleted = useLearningStore((state) => state.isNodeCompleted)
  const isStudyNode = useLearningStore((state) => state.isStudyNode)
  const pushToast = useLearningStore((state) => state.pushToast)
  const [expanded, setExpanded] = useState(() => false)
  const [ttsWarmState, setTtsWarmState] = useState<TtsWarmState>({ status: 'idle', done: 0, total: 0, characters: 0 })

  if (!node) return null

  const unlocked = isNodeUnlocked(node.id)
  const completed = isNodeCompleted(node.id)
  const active = currentNodeId === node.id
  const hasChildren = node.childIds.length > 0
  const learnable = isStudyNode(node.id)
  const canPreheatSpeech = learnable && !hasChildren
  const lessonSpeechText = useMemo(() => buildLessonSpeechMarkdown(node), [node])
  const estimatedSpeechCharacters = useMemo(
    () => estimateMiniMaxSpeechCharacters(lessonSpeechText),
    [lessonSpeechText],
  )

  const statusIcon = completed ? <Check size={13} /> : unlocked ? <CircleDot size={13} /> : <Lock size={13} />
  const isInActivePath = useMemo(() => {
    if (!currentNodeId) return false
    let cursorId: string | null = currentNodeId
    while (cursorId) {
      if (cursorId === node.id) return true
      cursorId = nodeMap[cursorId]?.parentId ?? null
    }
    return false
  }, [currentNodeId, node.id, nodeMap])

  useEffect(() => {
    if (hasChildren && isInActivePath) {
      setExpanded(true)
    }
  }, [hasChildren, isInActivePath])

  useEffect(() => {
    let cancelled = false
    if (!canPreheatSpeech || !lessonSpeechText) {
      setTtsWarmState({ status: 'idle', done: 0, total: 0, characters: 0 })
      return () => {
        cancelled = true
      }
    }

    setTtsWarmState((current) => ({
      ...current,
      status: current.status === 'warming' ? 'warming' : 'idle',
      characters: estimatedSpeechCharacters,
    }))
    void window.desktopAPI.checkSpeechCache({ text: lessonSpeechText, nodeId: node.id }).then((cacheStatus) => {
      if (cancelled) return
      setTtsWarmState((current) =>
        current.status === 'warming'
          ? current
          : {
              status: cacheStatus.cached ? 'ready' : 'idle',
              done: cacheStatus.cached ? 1 : 0,
              total: 1,
              characters: cacheStatus.characters || estimatedSpeechCharacters,
            },
      )
    }).catch(() => {
      if (cancelled) return
      setTtsWarmState((current) => ({ ...current, status: current.status === 'warming' ? 'warming' : 'idle' }))
    })

    return () => {
      cancelled = true
    }
  }, [canPreheatSpeech, estimatedSpeechCharacters, lessonSpeechText, node.id])

  const preheatLessonSpeech = async () => {
    if (ttsWarmState.status === 'warming' || !canPreheatSpeech) return
    setTtsWarmState({ status: 'warming', done: 0, total: 1, characters: estimatedSpeechCharacters })

    try {
      const cacheStatus = await window.desktopAPI.checkSpeechCache({ text: lessonSpeechText, nodeId: node.id })
      let synthesizeResult: Awaited<ReturnType<typeof window.desktopAPI.synthesizeSpeech>> | null = null
      if (!cacheStatus.cached) {
        synthesizeResult = await window.desktopAPI.synthesizeSpeech({ text: lessonSpeechText, nodeId: node.id })
      }
      const usage = synthesizeResult?.usage ?? cacheStatus.usage
      const characters = synthesizeResult?.characters || cacheStatus.characters || estimatedSpeechCharacters
      setTtsWarmState({
        status: 'ready',
        done: 1,
        total: 1,
        characters,
      })
      pushToast(
        cacheStatus.cached ? '语音已在缓存中' : '语音预热完成',
        cacheStatus.cached
          ? `「${node.title}」已使用本地缓存，不消耗今日额度。`
          : synthesizeResult?.provider === 'minimax'
            ? `「${node.title}」消耗约 ${formatMiniMaxCharacters(characters)} MiniMax 字符；今日本地估算剩余 ${formatMiniMaxCharacters(usage.remainingCharacters)}。`
            : `「${node.title}」已用 MiMo 生成，约 ${formatMiniMaxCharacters(characters)} TTS 字符；缓存命中不会重复调用。`,
        'success',
      )
    } catch (error) {
      setTtsWarmState((current) => ({ ...current, status: 'error' }))
      pushToast('语音预热失败', error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const ttsWarmTitle =
    ttsWarmState.status === 'warming'
      ? '正在预热本节语音'
      : ttsWarmState.status === 'ready'
        ? `本节语音已预热，重复播放不消耗额度，约 ${formatMiniMaxCharacters(ttsWarmState.characters || estimatedSpeechCharacters)} TTS 字符`
        : `预热本节正文语音，预计 ${formatMiniMaxCharacters(ttsWarmState.characters || estimatedSpeechCharacters)} TTS 字符`

  return (
    <div className="space-y-1">
      <div
        className={cn(
          'group relative flex items-center gap-2 overflow-hidden rounded-lg border px-2 py-1.5 transition-all duration-300',
          active &&
            'outline-node-active border-sky-400/18 bg-[linear-gradient(135deg,rgba(56,189,248,0.14),rgba(56,189,248,0.045))]',
          !active && 'border-transparent hover:border-white/[0.06] hover:bg-white/[0.014]',
          isInActivePath && !active && 'border-white/[0.035] bg-white/[0.012]',
        )}
        style={{ marginLeft: `${node.depth * 8}px` }}
      >
        {active ? (
          <>
            <span className="pointer-events-none absolute inset-0 rounded-lg bg-sky-400/[0.03]" />
            <span className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-[radial-gradient(circle_at_left,rgba(125,211,252,0.18),transparent_72%)]" />
          </>
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'relative size-5.5 rounded-md border border-transparent text-muted-foreground transition-transform duration-300',
            unlocked && 'text-foreground/78',
            completed && 'text-emerald-300',
            !unlocked && 'text-muted-foreground/70',
            active && 'text-sky-100',
          )}
          onClick={() => setCurrentNode(node.id)}
          disabled={!learnable}
          aria-label={`进入 ${node.title}`}
          title={unlocked ? `进入 ${node.title}` : `预览 ${node.title}`}
        >
          {statusIcon}
        </Button>

        <div className="min-w-0 flex-1">
          {hasChildren ? (
            <div className="flex w-full items-center gap-1 rounded-lg">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                aria-label={expanded ? `收起 ${node.title}` : `展开 ${node.title}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg text-left"
              >
                <span
                  className={cn(
                    'truncate text-[11px] font-medium text-foreground/95 transition-colors',
                    active && 'text-sky-50',
                    !unlocked && 'text-muted-foreground',
                  )}
                >
                  {node.title}
                </span>
                <ChevronDown
                  size={12}
                  className={cn(
                    'shrink-0 text-muted-foreground transition-transform duration-200',
                    expanded && 'rotate-180 text-foreground',
                  )}
                />
              </button>
            </div>
          ) : (
            <div className="flex w-full items-center gap-1 rounded-lg">
              <button
                type="button"
                onClick={() => setCurrentNode(node.id)}
                disabled={!learnable}
                aria-label={unlocked ? `进入 ${node.title}` : `预览 ${node.title}`}
                title={unlocked ? `进入 ${node.title}` : `预览 ${node.title}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg text-left disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    'truncate text-[11px] font-medium text-foreground/95 transition-colors',
                    active && 'text-sky-50',
                    !unlocked && 'text-muted-foreground',
                  )}
                >
                  {node.title}
                </span>
              </button>
              {canPreheatSpeech ? (
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className={cn(
                      'hidden text-[9px] tabular-nums text-muted-foreground/55 group-hover:inline',
                      active && 'inline text-sky-100/70',
                      ttsWarmState.status === 'ready' && 'inline text-emerald-200/80',
                    )}
                    title={ttsWarmTitle}
                  >
                    {formatMiniMaxCharacters(ttsWarmState.characters || estimatedSpeechCharacters)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'size-6 rounded-lg text-muted-foreground opacity-70 transition hover:text-foreground group-hover:opacity-100',
                      ttsWarmState.status === 'ready' && 'text-emerald-300 opacity-100',
                      ttsWarmState.status === 'warming' && 'text-sky-200 opacity-100',
                      ttsWarmState.status === 'error' && 'text-amber-200 opacity-100',
                    )}
                    onClick={(event) => {
                      event.stopPropagation()
                      void preheatLessonSpeech()
                    }}
                    disabled={ttsWarmState.status === 'warming'}
                    title={ttsWarmTitle}
                    aria-label={ttsWarmTitle}
                  >
                    {ttsWarmState.status === 'warming' ? (
                      <LoaderCircle size={12} className="animate-spin" />
                    ) : ttsWarmState.status === 'ready' ? (
                      <CheckCircle2 size={12} />
                    ) : (
                      <AudioLines size={12} />
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {canPreheatSpeech && ttsWarmState.status === 'warming' ? (
        <div className="px-2 text-[10px] text-sky-100/70" style={{ marginLeft: `${node.depth * 8 + 28}px` }}>
          正在预热本节正文 · 约 {formatMiniMaxCharacters(ttsWarmState.characters || estimatedSpeechCharacters)} TTS 字符
        </div>
      ) : null}

      {hasChildren && expanded ? (
        <div className="ml-3 space-y-1 border-l border-white/[0.035] pl-2">
          {node.childIds.map((childId) => (
            <OutlineNodeItem key={childId} nodeId={childId} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

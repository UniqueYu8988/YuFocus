import { ArrowUp } from 'lucide-react'
import { FormEvent, KeyboardEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useLearningStore } from '@/store'

type CoachComposerProps = {
  progressText: string
  statusHint?: string
  statusTone?: 'neutral' | 'progress' | 'warning' | 'success'
  onGoToNext: () => void
  canGoToNext: boolean
  nextLabel: string
  onAnswerSubmitted?: () => Promise<void> | void
}

export function CoachComposer({
  progressText,
  statusHint,
  statusTone = 'neutral',
  onGoToNext,
  canGoToNext,
  nextLabel,
  onAnswerSubmitted,
}: CoachComposerProps) {
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const currentSession = useLearningStore((state) =>
    state.currentNodeId ? state.nodeSessions[state.currentNodeId] ?? null : null,
  )
  const currentNode = useLearningStore((state) =>
    state.currentNodeId ? state.nodeMap[state.currentNodeId] ?? null : null,
  )
  const currentNodeUnlocked = useLearningStore((state) =>
    state.currentNodeId ? state.isNodeUnlocked(state.currentNodeId) : false,
  )
  const submitUserAnswer = useLearningStore((state) => state.submitUserAnswer)
  const [draft, setDraft] = useState('')

  const learningStatus = currentSession?.learningStatus ?? 'teaching'
  const coachRequestState = currentSession?.requestState ?? 'idle'
  const canAnswer = Boolean(currentNodeId) && currentNodeUnlocked && learningStatus === 'quizzing' && coachRequestState !== 'loading'
  const canMarkLearned = canAnswer && draft.trim() === '已学习'

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (canMarkLearned) {
      await submitUserAnswer(draft)
      setDraft('')
      await onAnswerSubmitted?.()
      return
    }
    if (canGoToNext) onGoToNext()
  }

  const onKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (!canMarkLearned) return
    await submitUserAnswer(draft)
    setDraft('')
    await onAnswerSubmitted?.()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="pointer-events-none absolute inset-x-20 bottom-4 z-30"
    >
      <div className="pointer-events-auto rounded-[20px] border-0 bg-[#2b2b2b] p-2.5 shadow-[0_14px_42px_rgba(0,0,0,0.34)]">
        <div className="relative">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              canAnswer
                ? '精确输入“已学习”进入下一关'
                : currentNodeUnlocked
                  ? '先阅读这一关。'
                  : '这一关还未解锁，可以先浏览，按进度学到这里后再继续。'
            }
            disabled={!canAnswer}
            rows={2}
            className="min-h-[58px] resize-none border-0 bg-transparent pb-8 pl-1 pr-11 pt-0 text-[13px] font-semibold leading-[20px] tracking-tight text-[#d7dee8] shadow-none placeholder:text-[#aab2bd] focus-visible:ring-0"
          />

          <Button
            type="submit"
            size="icon"
            className="absolute bottom-0 right-0 size-8 shrink-0 rounded-full bg-white text-black shadow-none hover:bg-white/88"
            disabled={!canMarkLearned && !canGoToNext}
            aria-label={canMarkLearned ? '标记已学习' : nextLabel}
            title={canMarkLearned ? '标记已学习' : nextLabel}
          >
            <ArrowUp size={16} strokeWidth={2.4} />
          </Button>
        </div>
      </div>
    </form>
  )
}

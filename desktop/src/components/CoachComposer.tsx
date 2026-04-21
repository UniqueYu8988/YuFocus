import { ArrowRight, ArrowUp, Sparkles } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useLearningStore } from '@/store'

type CoachComposerProps = {
  progressText: string
  onStartQuiz: () => void
  onGoToNext: () => void
  canStartQuiz: boolean
  canGoToNext: boolean
  nextLabel: string
}

export function CoachComposer({
  progressText,
  onStartQuiz,
  onGoToNext,
  canStartQuiz,
  canGoToNext,
  nextLabel,
}: CoachComposerProps) {
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const currentSession = useLearningStore((state) =>
    state.currentNodeId ? state.nodeSessions[state.currentNodeId] ?? null : null,
  )
  const currentNode = useLearningStore((state) =>
    state.currentNodeId ? state.nodeMap[state.currentNodeId] ?? null : null,
  )
  const submitUserAnswer = useLearningStore((state) => state.submitUserAnswer)
  const [draft, setDraft] = useState('')

  const learningStatus = currentSession?.learningStatus ?? 'teaching'
  const coachRequestState = currentSession?.requestState ?? 'idle'
  const canAnswer =
    Boolean(currentNodeId) && (learningStatus === 'quizzing' || learningStatus === 'correcting') && coachRequestState !== 'loading'
  const latestStruggleAttempt =
    currentSession?.attemptHistory
      ?.slice()
      .reverse()
      .find((attempt) => attempt.verdict === 'incorrect' || attempt.verdict === 'partial') ?? null

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.trim() || !canAnswer) return
    void submitUserAnswer(draft)
    setDraft('')
  }

  return (
    <form onSubmit={onSubmit} className="relative shrink-0 border-t border-white/7 bg-[#181818]">
      <div className="space-y-2 px-4 pb-3 pt-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={canAnswer ? '在这里回答这道题…' : '先听讲，再点击“开始小测”。'}
          disabled={!canAnswer}
          rows={2}
          className="min-h-[64px] resize-none rounded-[20px] border-white/7 bg-[#121212] px-4 py-3 text-[14px] leading-6 shadow-none"
        />

        {latestStruggleAttempt && latestStruggleAttempt.missingKeywords.length > 0 ? (
          <div
            className={
              latestStruggleAttempt.verdict === 'partial'
                ? 'flex flex-wrap items-center gap-2 rounded-[16px] border border-sky-500/12 bg-sky-500/[0.05] px-3 py-2 text-[11px] text-sky-100/85'
                : 'flex flex-wrap items-center gap-2 rounded-[16px] border border-amber-500/12 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-100/85'
            }
          >
            <Badge variant={latestStruggleAttempt.verdict === 'partial' ? 'outline' : 'warning'} className="h-5 rounded-full px-2 text-[10px]">
              {latestStruggleAttempt.verdict === 'partial' ? '继续补半步' : '复盘提示'}
            </Badge>
            <span className={latestStruggleAttempt.verdict === 'partial' ? 'text-sky-100/92' : 'text-amber-100/92'}>
              {latestStruggleAttempt.verdict === 'partial' ? '你刚才已经答到一部分了，再补上：' : '上次这道题还漏掉了：'}
            </span>
            <span className={latestStruggleAttempt.verdict === 'partial' ? 'font-medium text-sky-50' : 'font-medium text-amber-50'}>
              {latestStruggleAttempt.missingKeywords.slice(0, 4).join('、')}
            </span>
            {latestStruggleAttempt.cautionNotes.length > 0 ? (
              <span className={latestStruggleAttempt.verdict === 'partial' ? 'text-sky-200/70' : 'text-amber-200/70'}>
                · {latestStruggleAttempt.cautionNotes[0]}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <Badge
              variant={learningStatus === 'correcting' ? 'warning' : learningStatus === 'quizzing' ? 'default' : 'outline'}
              className="h-6 rounded-full px-2.5 text-[10px]"
            >
              <Sparkles className="size-3" />
              {learningStatus === 'correcting' ? '纠错模式' : learningStatus === 'quizzing' ? '答题模式' : '等待出题'}
            </Badge>
            {currentNode ? <span className="truncate">{currentNode.title}</span> : null}
            <span>{progressText}</span>
            <span className="hidden sm:inline">{draft.trim() ? `${draft.trim().length} 字` : ''}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-9 rounded-xl px-3"
              onClick={onStartQuiz}
              disabled={!canStartQuiz}
            >
              <Sparkles size={14} />
              小测
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-xl px-3"
              onClick={onGoToNext}
              disabled={!canGoToNext}
            >
              <ArrowRight size={14} />
              {nextLabel}
            </Button>
            <Button
              type="submit"
              size="icon"
              className="size-9 rounded-xl shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
              disabled={!canAnswer || !draft.trim()}
              aria-label="提交回答"
            >
              <ArrowUp size={15} />
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

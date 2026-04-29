import { ArrowRight, ArrowUp, Sparkles } from 'lucide-react'
import { FormEvent, KeyboardEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'

type CoachComposerProps = {
  progressText: string
  statusHint?: string
  statusTone?: 'neutral' | 'progress' | 'warning' | 'success'
  onGoToNext: () => void
  canGoToNext: boolean
  nextLabel: string
}

export function CoachComposer({
  progressText,
  statusHint,
  statusTone = 'neutral',
  onGoToNext,
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
  const currentNodeUnlocked = useLearningStore((state) =>
    state.currentNodeId ? state.isNodeUnlocked(state.currentNodeId) : false,
  )
  const submitUserAnswer = useLearningStore((state) => state.submitUserAnswer)
  const [draft, setDraft] = useState('')

  const learningStatus = currentSession?.learningStatus ?? 'teaching'
  const coachRequestState = currentSession?.requestState ?? 'idle'
  const canAnswer = Boolean(currentNodeId) && currentNodeUnlocked && learningStatus === 'quizzing' && coachRequestState !== 'loading'

  const statusChipClass =
    statusTone === 'success'
      ? 'border-emerald-400/14 bg-emerald-400/[0.07] text-emerald-100/88'
      : statusTone === 'warning'
        ? 'border-amber-400/14 bg-amber-400/[0.07] text-amber-100/88'
        : statusTone === 'progress'
          ? 'border-sky-400/14 bg-sky-400/[0.07] text-sky-100/88'
          : 'border-white/[0.06] bg-white/[0.03] text-foreground/72'

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.trim() || !canAnswer) return
    void submitUserAnswer(draft)
    setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (!draft.trim() || !canAnswer) return
    void submitUserAnswer(draft)
    setDraft('')
  }

  return (
    <form onSubmit={onSubmit} className="relative shrink-0 border-t border-white/[0.06] bg-[#181818]">
      <div className="space-y-2 px-4 pb-2.5 pt-2.5">
        <div className="rounded-[22px] border border-white/[0.06] bg-[#141414] p-1.5 shadow-[0_-10px_30px_rgba(0,0,0,0.12)]">
          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 items-start rounded-[18px] border border-white/[0.05] bg-[#101010] px-3 py-2.5">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  canAnswer
                    ? '先写下你的回忆，再对照标准答案…'
                    : currentNodeUnlocked
                      ? '先阅读这一关，再写下你的回忆。'
                      : '这一关还未解锁，可以先浏览，按进度学到这里后再答题。'
                }
                disabled={!canAnswer}
                rows={1}
                className="min-h-[44px] resize-none border-0 bg-transparent px-0 py-0 text-[14px] leading-6 shadow-none focus-visible:ring-0"
              />
            </div>

            <Button
              type="submit"
              size="icon"
              className="size-10 shrink-0 rounded-[18px] shadow-[0_10px_24px_rgba(0,0,0,0.2)]"
              disabled={!canAnswer || !draft.trim()}
              aria-label="提交回答"
            >
              <ArrowUp size={16} />
            </Button>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <Badge
                variant={learningStatus === 'quizzing' ? 'default' : 'outline'}
                className="h-5 rounded-full px-2 text-[10px]"
              >
                <Sparkles className="size-3" />
                {coachRequestState === 'loading'
                  ? '整理中'
                  : !currentNodeUnlocked
                    ? '预览'
                  : learningStatus === 'quizzing'
                    ? '主动回忆'
                    : '阅读课程'}
              </Badge>
              <span className="truncate">{progressText}</span>
              {statusHint ? (
                <span
                  className={cn(
                    'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-all',
                    statusChipClass,
                  )}
                >
                  <span className={cn('size-1.5 rounded-full', statusTone === 'warning' ? 'bg-amber-300' : statusTone === 'success' ? 'bg-emerald-300' : 'bg-sky-300/90')} />
                  <span className="truncate">{statusHint}</span>
                </span>
              ) : null}
              <span className="hidden sm:inline">{draft.trim() ? `${draft.trim().length} 字` : 'Enter 发送 · Shift+Enter 换行'}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                className="h-7 rounded-xl px-2.5 text-[11px]"
                onClick={onGoToNext}
                disabled={!canGoToNext}
              >
                <ArrowRight size={13} />
                {nextLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}

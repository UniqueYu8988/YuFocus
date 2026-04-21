import { useEffect, useMemo, useRef } from 'react'
import { MessageSquareDashed } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

export function CoachChatTimeline() {
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const currentSession = useLearningStore((state) =>
    state.currentNodeId ? state.nodeSessions[state.currentNodeId] ?? null : null,
  )
  const containerRef = useRef<HTMLDivElement | null>(null)

  const visibleMessages = useMemo(
    () => (currentSession?.messages ?? []).filter((message) => message.role !== 'system'),
    [currentSession?.messages],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    })
  }, [currentNodeId, visibleMessages.length])

  return (
    <div ref={containerRef} className="subtle-scrollbar h-full min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
      <div className="flex w-full flex-col gap-2.5 pb-4">
        {visibleMessages.length ? (
          visibleMessages.map((message) => (
            <article
              key={message.id}
              className={cn('flex w-full', message.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'flex flex-col gap-1',
                  message.role === 'coach' ? 'max-w-[86%]' : 'max-w-[72%] items-end',
                )}
              >
                <Card
                  className={cn(
                    'rounded-[20px] border-white/7 shadow-none',
                    message.role === 'coach'
                      ? 'bg-[#1d1d1d]'
                      : 'border-white/8 bg-[#202020]',
                  )}
                >
                  <CardContent className="p-3.5">
                    <MarkdownRenderer content={message.content} />
                  </CardContent>
                </Card>
              </div>
            </article>
          ))
        ) : (
          <Card className="border-dashed border-white/8 bg-[#1a1a1a] shadow-none">
            <CardContent className="flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-white/7 bg-[#222222] text-muted-foreground">
                <MessageSquareDashed size={18} />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground">教练已经就位</div>
                <p className="text-sm leading-6 text-muted-foreground">选中一节小关后，这里会开始讲解、提问、纠错和推进。</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

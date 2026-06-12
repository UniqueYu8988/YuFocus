import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const WORKSPACE_CONTENT_PADDING_X = 'px-16'
const WORKSPACE_CONTENT_MAX_WIDTH = 'max-w-[1120px]'

type WorkspaceShellProps = {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  windowFocused: boolean
}

export function WorkspaceShell({
  eyebrow,
  title,
  description,
  actions,
  children,
  windowFocused,
}: WorkspaceShellProps) {
  return (
    <section className="flex min-h-0 flex-1">
      <Card className={cn('work-surface relative flex min-h-0 w-full flex-col overflow-hidden rounded-l-[18px] rounded-r-none border border-r-0 border-white/[0.065] bg-[#101010] shadow-none transition-colors duration-200', !windowFocused && 'bg-[#101010]')}>
        <div className={cn('relative mx-auto flex h-full w-full flex-col', WORKSPACE_CONTENT_MAX_WIDTH)}>
          <div className={cn('relative flex w-full items-start justify-between gap-4 pb-7 pt-14', WORKSPACE_CONTENT_PADDING_X)}>
            <div className="space-y-2">
              {eyebrow ? <div className="sr-only">{eyebrow}</div> : null}
              <h2 className="text-[26px] font-semibold tracking-tight text-foreground">{title}</h2>
              {description ? <p className="max-w-3xl text-[13px] leading-6 text-muted-foreground">{description}</p> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
          <div className={cn('subtle-scrollbar relative min-h-0 flex-1 overflow-y-auto pb-12', WORKSPACE_CONTENT_PADDING_X)}>{children}</div>
        </div>
      </Card>
    </section>
  )
}

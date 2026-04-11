import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'flex min-h-[120px] w-full rounded-2xl border border-border/70 bg-input/70 px-4 py-3 text-sm text-foreground shadow-[0_0_0_1px_hsl(var(--background)/0.32)_inset] backdrop-blur-xl transition-colors outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }

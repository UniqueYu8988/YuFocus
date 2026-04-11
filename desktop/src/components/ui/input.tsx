import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-xl border border-border/70 bg-input/70 px-4 py-2 text-[13px] text-foreground shadow-[0_0_0_1px_hsl(var(--background)/0.32)_inset] backdrop-blur-xl transition-colors outline-none placeholder:text-muted-foreground/78 focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
})
Input.displayName = 'Input'

export { Input }

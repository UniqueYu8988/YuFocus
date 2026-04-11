import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium tracking-[0.02em] backdrop-blur-xl transition-colors',
  {
    variants: {
      variant: {
        default: 'border-white/10 bg-white/[0.05] text-foreground',
        secondary: 'border-border/60 bg-white/[0.045] text-secondary-foreground',
        outline: 'border-border/60 bg-background/40 text-muted-foreground',
        success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
        warning: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }

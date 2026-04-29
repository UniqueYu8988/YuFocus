import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.01em] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-white/[0.07] bg-[#232323] text-foreground',
        secondary: 'border-border/60 bg-[#222222] text-secondary-foreground',
        outline: 'border-border/60 bg-[#1d1d1d] text-muted-foreground',
        success: 'border-emerald-500/22 bg-[#1d2721] text-emerald-300',
        warning: 'border-amber-500/22 bg-[#28211a] text-amber-300',
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

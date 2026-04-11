import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 ease-out outline-none ring-offset-background disabled:pointer-events-none disabled:opacity-45 enabled:hover:bg-white/[0.02] enabled:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:size-4 shrink-0 focus-visible:ring-2 focus-visible:ring-ring/40',
  {
    variants: {
      variant: {
        default:
          'bg-white/[0.09] text-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_10px_24px_rgba(0,0,0,0.16)] hover:bg-white/[0.12]',
        secondary:
          'border border-border/60 bg-white/[0.04] text-secondary-foreground backdrop-blur-xl hover:bg-white/[0.06]',
        outline:
          'border border-border/70 bg-background/45 text-foreground backdrop-blur-xl hover:bg-white/[0.04] hover:text-accent-foreground',
        ghost: 'text-muted-foreground hover:bg-accent/55 hover:text-accent-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-[11px]',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }

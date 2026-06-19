import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/ui/components/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 ease-out outline-none ring-offset-background disabled:pointer-events-none disabled:opacity-45 enabled:active:translate-y-0 [&_svg]:pointer-events-none [&_svg]:size-4 shrink-0 focus-visible:ring-2 focus-visible:ring-ring/40',
  {
    variants: {
      variant: {
        default:
          'bg-[#242424] text-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.045)_inset] hover:bg-[#292929]',
        secondary:
          'border border-border/60 bg-[#222222] text-secondary-foreground hover:bg-[#262626]',
        outline:
          'border border-border/70 bg-[#1a1a1a] text-foreground hover:bg-[#202020] hover:text-accent-foreground',
        ghost: 'text-muted-foreground hover:bg-white/[0.018] hover:text-accent-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-7 rounded-md px-2.5 text-[11px]',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-9 w-9',
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

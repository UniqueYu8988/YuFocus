import { Minus, Square, X, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import appIcon from '@/assets/app_icon.png'
import { cn } from '@/lib/utils'

type AppChromeProps = {
  windowFocused: boolean
  isMaximized: boolean
  sidebarWidth: number
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export function AppChrome({
  windowFocused,
  isMaximized,
  sidebarWidth,
  onMinimize,
  onToggleMaximize,
  onClose,
}: AppChromeProps) {
  return (
    <header
      className={cn(
        'app-drag flex h-10 shrink-0 items-stretch bg-transparent transition-opacity duration-200',
        windowFocused ? 'opacity-100' : 'opacity-95',
      )}
      onDoubleClick={onToggleMaximize}
    >
      <div className="flex items-center gap-2.5 px-3" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        <img src={appIcon} alt="视界专注" className="size-6 object-contain opacity-95" draggable={false} />
        <div className="text-[14px] font-semibold tracking-tight text-foreground/92">视界专注</div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-between pl-4 pr-2">
        <div className="min-w-0 flex-1" />

        <div className="app-no-drag flex items-center gap-0.5 pl-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-md text-muted-foreground hover:bg-white/[0.018] hover:text-foreground"
            onClick={onMinimize}
            aria-label="最小化"
          >
            <Minus size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-md text-muted-foreground hover:bg-white/[0.018] hover:text-foreground"
            onClick={onToggleMaximize}
            aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
          >
            {isMaximized ? <Copy size={12} /> : <Square size={12} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-md text-muted-foreground hover:bg-[#8d2f3b] hover:text-white"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={13} />
          </Button>
        </div>
      </div>
    </header>
  )
}

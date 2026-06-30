import type { ReactNode } from 'react'
import { cn } from '@/ui/components/utils'

export type SettingsStatusResult = Awaited<ReturnType<typeof window.desktopAPI.loadSettingsStatus>>
export type SettingsEnvironmentResult = Awaited<ReturnType<typeof window.desktopAPI.runEnvironmentCheck>>
export type AutomationStatusResult = Awaited<ReturnType<typeof window.desktopAPI.getAutomationStatus>>
export type RuntimeSettingsFallback = Awaited<ReturnType<typeof window.desktopAPI.loadSettings>> | null
export type MimoVoicePreset = {
  id: string
  previewUrl: string
}
export type SettingsDraftUpdater = (updater: (current: RuntimeSettings) => RuntimeSettings) => void

export function SettingsField({
  label,
  icon,
  className,
  children,
}: {
  label: string
  icon: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <label className={cn('grid gap-1.5', className)}>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/86">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}

export function SettingsBlock({
  title,
  icon,
  className,
  children,
}: {
  title: string
  icon?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
        {icon ? <img src={icon} alt="" className="size-4 opacity-90" /> : null}
        {title}
      </h3>
      <div className="grid gap-4 rounded-[10px] border border-white/[0.09] bg-[#1f1f1f] p-4">
        {children}
      </div>
    </section>
  )
}

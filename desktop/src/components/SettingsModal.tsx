import { type ReactNode, useEffect, useState } from 'react'
import { AudioLines, Bot, Cookie, FlaskConical, KeyRound, Save, Server } from 'lucide-react'
import {
  DEFAULT_COACH_MODEL,
  DEFAULT_DISTILLER_MODEL,
  DEFAULT_GROQ_TRANSCRIPTION_MODEL,
  DEFAULT_MINIMAX_BASE_URL,
} from '@/lib/coachPreferences'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type RuntimeSettingsFallback = Awaited<ReturnType<typeof window.desktopAPI.loadSettings>> | null

type SettingsModalProps = {
  open: boolean
  runtimeSettings: RuntimeSettingsFallback
  onSaved: (next: Awaited<ReturnType<typeof window.desktopAPI.loadSettings>>) => void
  onClose: () => void
}

function buildInitialDraft(runtimeSettings: RuntimeSettingsFallback) {
  return {
    sessdata: runtimeSettings?.sessdata || '',
    coach_api_base_url: runtimeSettings?.coach_api_base_url || DEFAULT_MINIMAX_BASE_URL,
    coach_api_key: runtimeSettings?.coach_api_key || '',
    coach_model: runtimeSettings?.coach_model || DEFAULT_COACH_MODEL,
    distiller_api_base_url: runtimeSettings?.distiller_api_base_url || DEFAULT_MINIMAX_BASE_URL,
    distiller_api_key: runtimeSettings?.distiller_api_key || '',
    distiller_model: runtimeSettings?.distiller_model || DEFAULT_DISTILLER_MODEL,
    groq_api_key: runtimeSettings?.groq_api_key || '',
    groq_transcription_model: runtimeSettings?.groq_transcription_model || DEFAULT_GROQ_TRANSCRIPTION_MODEL,
    output_dir: runtimeSettings?.output_dir || '',
  }
}

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card className="glass-panel border-white/8">
      <CardContent className="space-y-4 p-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="flex size-8 items-center justify-center rounded-xl border border-white/8 bg-black/10 text-foreground/78">
              {icon}
            </span>
            {title}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="grid gap-4">{children}</div>
      </CardContent>
    </Card>
  )
}

function SettingsField({
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
    <label className={cn('grid gap-2', className)}>
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}

export function SettingsModal({ open, runtimeSettings, onSaved, onClose }: SettingsModalProps) {
  const [draft, setDraft] = useState(() => buildInitialDraft(runtimeSettings))
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(buildInitialDraft(runtimeSettings))
    setSaveError('')
  }, [open, runtimeSettings])

  const updateField = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const onSave = async () => {
    try {
      const next = await window.desktopAPI.saveSettings({
        ...(runtimeSettings ?? {}),
        ...draft,
      })
      onSaved(next)
      onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存设置失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0">
          <DialogHeader className="border-b border-white/8 pb-5">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              <span className="inline-flex size-2 rounded-full bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.18)]" />
            设置中枢
            </div>
          <DialogTitle>引擎与凭据</DialogTitle>
          <DialogDescription>所有敏感配置均保存在本地 AppData，并只在运行时临时注入。</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[calc(88vh-168px)] gap-4 overflow-y-auto px-6 pb-2">
          <SettingsSection icon={<Bot size={14} />} title="伴学教练 API" description="控制右侧教练讲解、提问与纠错的模型接口。">
            <SettingsField label="API Base URL" icon={<Server size={14} />}>
              <Input value={draft.coach_api_base_url} onChange={(event) => updateField('coach_api_base_url', event.target.value)} placeholder="https://api.openai.com/v1" />
            </SettingsField>
            <div className="grid gap-4 md:grid-cols-2">
              <SettingsField label="API Key" icon={<KeyRound size={14} />}>
                <Input type="password" value={draft.coach_api_key} onChange={(event) => updateField('coach_api_key', event.target.value)} placeholder="sk-..." />
              </SettingsField>
              <SettingsField label="Model Name" icon={<Bot size={14} />}>
                <Input value={draft.coach_model} onChange={(event) => updateField('coach_model', event.target.value)} placeholder="gpt-4.1-mini / MiniMax-M2.7" />
              </SettingsField>
            </div>
          </SettingsSection>

          <SettingsSection icon={<FlaskConical size={14} />} title="生肉炼丹引擎" description="控制字幕蒸馏、课程结构生成与知识包输出。">
            <SettingsField label="Distiller Base URL" icon={<Server size={14} />}>
              <Input value={draft.distiller_api_base_url} onChange={(event) => updateField('distiller_api_base_url', event.target.value)} placeholder="https://api.openai.com/v1" />
            </SettingsField>
            <div className="grid gap-4 md:grid-cols-2">
              <SettingsField label="Distiller API Key" icon={<KeyRound size={14} />}>
                <Input type="password" value={draft.distiller_api_key} onChange={(event) => updateField('distiller_api_key', event.target.value)} placeholder="sk-..." />
              </SettingsField>
              <SettingsField label="Distiller Model" icon={<FlaskConical size={14} />}>
                <Input value={draft.distiller_model} onChange={(event) => updateField('distiller_model', event.target.value)} placeholder="MiniMax-M2.7 / gpt-4.1" />
              </SettingsField>
            </div>
          </SettingsSection>

          <div className="grid gap-4 lg:grid-cols-2">
            <SettingsSection icon={<AudioLines size={14} />} title="音频转写引擎" description="当视频没有字幕时，自动使用音频转写进行兜底。">
              <SettingsField label="Groq API Key" icon={<KeyRound size={14} />}>
                <Input type="password" value={draft.groq_api_key} onChange={(event) => updateField('groq_api_key', event.target.value)} placeholder="gsk_..." />
              </SettingsField>
              <SettingsField label="Transcription Model" icon={<AudioLines size={14} />}>
                <Input value={draft.groq_transcription_model} onChange={(event) => updateField('groq_transcription_model', event.target.value)} placeholder="whisper-large-v3-turbo" />
              </SettingsField>
            </SettingsSection>

            <SettingsSection icon={<Cookie size={14} />} title="B 站凭据" description="用于获取登录态字幕和更完整的视频元数据。">
              <SettingsField label="SESSDATA" icon={<Cookie size={14} />}>
                <Input type="password" value={draft.sessdata} onChange={(event) => updateField('sessdata', event.target.value)} placeholder="用于拉取登录态字幕" />
              </SettingsField>
            </SettingsSection>
          </div>

          {saveError ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground shadow-[0_0_0_1px_hsl(var(--destructive)/0.08)_inset]">
              {saveError}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-white/8 bg-black/10 pt-5">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void onSave()}>
            <Save size={14} />
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

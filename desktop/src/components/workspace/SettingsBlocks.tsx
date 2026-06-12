import {
  AudioLines,
  Bell,
  Cookie,
  FolderOpen,
  LoaderCircle,
  Mail,
  Play,
  RefreshCcw,
  Server,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  SettingsBlock,
  SettingsField,
  type AutomationStatusResult,
  type MimoVoicePreset,
  type SettingsDraftUpdater,
  type SettingsStatusResult,
} from '@/components/workspace/SettingsShared'

export function CurrentConfigSettingsBlock({
  runtimeModeLabel,
  outputDirLabel,
  materialRootDir,
  obsidianVaultPath,
  ttsLabel,
  transcriptionLabel,
  settingsStatus,
  settingsStatusLoading,
  settingsStatusError,
  onRefreshSettingsStatus,
}: {
  runtimeModeLabel: string
  outputDirLabel: string
  materialRootDir: string
  obsidianVaultPath: string
  ttsLabel: string
  transcriptionLabel: string
  settingsStatus: SettingsStatusResult | null
  settingsStatusLoading: boolean
  settingsStatusError: string
  onRefreshSettingsStatus: () => void
}) {
  return (
    <SettingsBlock title="当前配置" className="order-0">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[
          ['运行模式', runtimeModeLabel],
          ['输出目录', outputDirLabel],
          ['材料目录', materialRootDir],
          ['Obsidian Vault', obsidianVaultPath],
          ['TTS', ttsLabel],
          ['转写引擎', transcriptionLabel],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
            <div className="mt-1 break-all text-[12px] leading-5 text-foreground/92">{value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] leading-5 text-muted-foreground">
        <span>{settingsStatusLoading ? '正在读取 B 站状态' : settingsStatus?.bilibili.message || 'B 站状态尚未刷新'}</span>
        {settingsStatus?.bilibili ? (
          <Badge
            variant="outline"
            className={cn(
              'h-5 border-white/0 bg-black/18 px-2 text-[10px]',
              settingsStatus.bilibili.valid
                ? 'text-emerald-100'
                : settingsStatus.bilibili.configured
                  ? 'text-amber-100'
                  : 'text-foreground/70',
            )}
          >
            {settingsStatus.bilibili.valid ? '已验证' : settingsStatus.bilibili.configured ? '待验证' : '未配置'}
          </Badge>
        ) : null}
        {settingsStatus?.bilibili.accountName ? <span>账号：{settingsStatus.bilibili.accountName}</span> : null}
        {settingsStatus?.bilibili.accountId ? <span>ID：{settingsStatus.bilibili.accountId}</span> : null}
        <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={onRefreshSettingsStatus} disabled={settingsStatusLoading}>
          <RefreshCcw size={12} />
          刷新账号状态
        </Button>
      </div>

      {settingsStatusError ? (
        <div className="rounded-[10px] border border-amber-400/18 bg-amber-400/[0.08] px-3 py-2 text-[12px] leading-5 text-amber-100">
          {settingsStatusError}
        </div>
      ) : null}
    </SettingsBlock>
  )
}

export function AutomationEmailSettingsBlock({
  settingsDraft,
  automationStatus,
  automationStatusLabel,
  automationBusy,
  emailTestBusy,
  onSettingsDraftChange,
  onToggleAutomationPaused,
  onAutomationCheckNow,
  onTestEmailPush,
}: {
  settingsDraft: RuntimeSettings
  automationStatus: AutomationStatusResult | null
  automationStatusLabel: string
  automationBusy: boolean
  emailTestBusy: boolean
  onSettingsDraftChange: SettingsDraftUpdater
  onToggleAutomationPaused: () => void
  onAutomationCheckNow: () => void
  onTestEmailPush: () => void
}) {
  return (
    <SettingsBlock title="后台与邮件" className="order-2">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
            <span
              className={cn(
                'size-2 rounded-full',
                automationStatus?.running
                  ? 'bg-sky-300'
                  : automationStatus?.paused || !automationStatus?.enabled
                    ? 'bg-amber-300'
                    : 'bg-emerald-300',
              )}
            />
            <span className="font-semibold text-foreground/88">{automationStatusLabel}</span>
            <span>{automationStatus?.lastResult || '尚未检查'}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant={settingsDraft.background_automation_enabled ? 'default' : 'outline'}
              className="h-8 rounded-xl px-3 text-[12px]"
              onClick={() => onSettingsDraftChange((current) => ({ ...current, background_automation_enabled: !current.background_automation_enabled }))}
            >
              <Bell size={13} />
              {settingsDraft.background_automation_enabled ? '定时开启' : '定时关闭'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-xl px-3 text-[12px]"
              onClick={onToggleAutomationPaused}
              disabled={automationBusy || !settingsDraft.background_automation_enabled}
            >
              {automationStatus?.paused ? '恢复' : '暂停'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-xl px-3 text-[12px]"
              onClick={onAutomationCheckNow}
              disabled={automationBusy || !settingsDraft.background_automation_enabled || automationStatus?.running}
            >
              {automationBusy || automationStatus?.running ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCcw size={13} />}
              检查
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SettingsField label="检查节奏" icon={<Bell size={14} />}>
            <div className="flex h-12 items-center rounded-[14px] border border-white/7 bg-white/[0.035] px-4 text-[13px] font-semibold text-foreground">
              每 6 小时
            </div>
          </SettingsField>
          <SettingsField label="SMTP Host" icon={<Mail size={14} />} className="md:col-span-2">
            <Input
              value={settingsDraft.email_smtp_host}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_smtp_host: event.target.value }))}
              placeholder="smtp.example.com"
            />
          </SettingsField>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SettingsField label="SMTP Port" icon={<Mail size={14} />}>
            <Input
              type="number"
              min={1}
              max={65535}
              value={settingsDraft.email_smtp_port}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_smtp_port: Number(event.target.value) }))}
            />
          </SettingsField>
          <SettingsField label="SMTP User" icon={<Mail size={14} />}>
            <Input
              value={settingsDraft.email_smtp_user}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_smtp_user: event.target.value }))}
            />
          </SettingsField>
          <SettingsField label="SMTP Password" icon={<Mail size={14} />}>
            <Input
              type="password"
              value={settingsDraft.email_smtp_password}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_smtp_password: event.target.value }))}
            />
          </SettingsField>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <SettingsField label="发件人" icon={<Mail size={14} />}>
            <Input
              value={settingsDraft.email_from}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_from: event.target.value }))}
              placeholder="视界专注 <you@example.com>"
            />
          </SettingsField>
          <SettingsField label="收件人" icon={<Mail size={14} />}>
            <Input
              value={settingsDraft.email_to}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_to: event.target.value }))}
              placeholder="me@example.com"
            />
          </SettingsField>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={settingsDraft.email_push_enabled ? 'default' : 'outline'}
            className="h-8 rounded-xl px-3 text-[12px]"
            onClick={() => onSettingsDraftChange((current) => ({ ...current, email_push_enabled: !current.email_push_enabled }))}
          >
            <Mail size={13} />
            {settingsDraft.email_push_enabled ? '邮件开启' : '邮件关闭'}
          </Button>
          <Button
            type="button"
            variant={settingsDraft.email_smtp_secure ? 'default' : 'outline'}
            className="h-8 rounded-xl px-3 text-[12px]"
            onClick={() => onSettingsDraftChange((current) => ({ ...current, email_smtp_secure: !current.email_smtp_secure }))}
          >
            SSL
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-xl px-3 text-[12px]"
            onClick={onTestEmailPush}
            disabled={emailTestBusy}
          >
            {emailTestBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Mail size={13} />}
            测试
          </Button>
        </div>
      </div>
    </SettingsBlock>
  )
}

export function MimoTextSettingsBlock({
  settingsDraft,
  models,
  onSettingsDraftChange,
}: {
  settingsDraft: RuntimeSettings
  models: readonly string[]
  onSettingsDraftChange: SettingsDraftUpdater
}) {
  return (
    <SettingsBlock title="MiMo 文稿模型" className="order-3">
      <div className="grid gap-3 md:grid-cols-2">
        <SettingsField label="API Key" icon={<Server size={14} />} className="md:col-span-2">
          <Input
            type="password"
            value={settingsDraft.mimo_api_key}
            onChange={(event) => onSettingsDraftChange((current) => ({ ...current, mimo_api_key: event.target.value }))}
            placeholder="sk- 或 tp-"
          />
        </SettingsField>
        <div className="grid gap-1.5">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/86">
            <Sparkles size={14} />
            文稿模型
          </span>
          <div className="grid grid-cols-2 gap-2">
            {models.map((model) => (
              <Button
                key={model}
                type="button"
                variant={settingsDraft.mimo_text_model === model ? 'default' : 'outline'}
                className="h-9 rounded-xl px-3 text-[12px]"
                onClick={() => onSettingsDraftChange((current) => ({ ...current, mimo_text_model: model }))}
              >
                {model}
              </Button>
            ))}
          </div>
        </div>
        <SettingsField label="文本接口地址" icon={<Server size={14} />}>
          <Input
            value={settingsDraft.mimo_text_endpoint}
            onChange={(event) => onSettingsDraftChange((current) => ({ ...current, mimo_text_endpoint: event.target.value }))}
            placeholder="https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
          />
        </SettingsField>
      </div>
    </SettingsBlock>
  )
}

export function TtsSettingsBlock({
  icon,
  settingsDraft,
  voices,
  previewVoice,
  onPreviewVoice,
  onSettingsDraftChange,
}: {
  icon: string
  settingsDraft: RuntimeSettings
  voices: readonly MimoVoicePreset[]
  previewVoice: string | null
  onPreviewVoice: (voiceId: string, previewUrl: string) => void
  onSettingsDraftChange: SettingsDraftUpdater
}) {
  return (
    <SettingsBlock title="TTS 语音朗读" icon={icon} className="order-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-2 md:col-span-2">
          <div className="grid gap-2 md:grid-cols-2">
            <Button
              type="button"
              variant={settingsDraft.tts_provider !== 'minimax' ? 'default' : 'outline'}
              className="justify-start rounded-xl"
              onClick={() => onSettingsDraftChange((current) => ({ ...current, tts_provider: 'mimo' }))}
            >
              <AudioLines size={14} />
              MiMo 预置女声
            </Button>
            <Button
              type="button"
              variant={settingsDraft.tts_provider === 'minimax' ? 'default' : 'outline'}
              className="justify-start rounded-xl"
              onClick={() => onSettingsDraftChange((current) => ({ ...current, tts_provider: 'minimax' }))}
            >
              <AudioLines size={14} />
              备用云端朗读
            </Button>
          </div>
        </div>

        {settingsDraft.tts_provider !== 'minimax' ? (
          <>
            <div className="grid gap-5 md:col-span-2 md:grid-cols-[1.4fr_0.8fr]">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                  <AudioLines size={14} />
                  音色选择
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {voices.map((voice) => {
                    const selected = (settingsDraft.mimo_tts_voice_id || '茉莉') === voice.id
                    const previewing = previewVoice === voice.id
                    return (
                      <Button
                        key={voice.id}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        className={cn(
                          'h-8 rounded-xl px-3 text-[12px]',
                          selected && 'shadow-[0_0_18px_rgba(125,211,252,0.08)]',
                        )}
                        onClick={() => onPreviewVoice(voice.id, voice.previewUrl)}
                        title={`试听并选择 ${voice.id}`}
                      >
                        {previewing ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Play className="size-3.5" />
                        )}
                        {voice.id}
                      </Button>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                  <AudioLines size={14} />
                  模型
                </div>
                <div className="text-[14px] font-semibold text-foreground">mimo-v2.5-tts</div>
              </div>
            </div>
            <SettingsField label="MiMo 接口地址" icon={<Server size={14} />} className="md:col-span-2">
              <Input
                value={settingsDraft.mimo_tts_endpoint}
                onChange={(event) => onSettingsDraftChange((current) => ({ ...current, mimo_tts_endpoint: event.target.value }))}
                placeholder="https://api.xiaomimimo.com/v1/chat/completions"
              />
            </SettingsField>
          </>
        ) : (
          <>
            <SettingsField label="备用服务 API Key" icon={<Server size={14} />} className="md:col-span-2">
              <Input
                type="password"
                value={settingsDraft.minimax_api_key}
                onChange={(event) => onSettingsDraftChange((current) => ({ ...current, minimax_api_key: event.target.value }))}
                placeholder="填入后才会在点击朗读时调用"
              />
            </SettingsField>
            <SettingsField label="Voice ID" icon={<AudioLines size={14} />}>
              <Input
                value={settingsDraft.minimax_tts_voice_id}
                onChange={(event) => onSettingsDraftChange((current) => ({ ...current, minimax_tts_voice_id: event.target.value }))}
                placeholder="你选好的音色 voice_id"
              />
            </SettingsField>
            <SettingsField label="模型" icon={<AudioLines size={14} />}>
              <Input
                value={settingsDraft.minimax_tts_model}
                onChange={(event) => onSettingsDraftChange((current) => ({ ...current, minimax_tts_model: event.target.value }))}
                placeholder="speech-2.8-hd"
              />
            </SettingsField>
            <SettingsField label="接口地址" icon={<Server size={14} />} className="md:col-span-2">
              <Input
                value={settingsDraft.minimax_tts_endpoint}
                onChange={(event) => onSettingsDraftChange((current) => ({ ...current, minimax_tts_endpoint: event.target.value }))}
                placeholder="https://api.minimaxi.com/v1/t2a_v2"
              />
            </SettingsField>
            <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
              <SettingsField label="语速" icon={<AudioLines size={14} />}>
                <Input
                  type="number"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={settingsDraft.minimax_tts_speed}
                  onChange={(event) => onSettingsDraftChange((current) => ({ ...current, minimax_tts_speed: Number(event.target.value) }))}
                />
              </SettingsField>
              <SettingsField label="音量" icon={<AudioLines size={14} />}>
                <Input
                  type="number"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={settingsDraft.minimax_tts_volume}
                  onChange={(event) => onSettingsDraftChange((current) => ({ ...current, minimax_tts_volume: Number(event.target.value) }))}
                />
              </SettingsField>
              <SettingsField label="音高" icon={<AudioLines size={14} />}>
                <Input
                  type="number"
                  min="-12"
                  max="12"
                  step="1"
                  value={settingsDraft.minimax_tts_pitch}
                  onChange={(event) => onSettingsDraftChange((current) => ({ ...current, minimax_tts_pitch: Number(event.target.value) }))}
                />
              </SettingsField>
            </div>
          </>
        )}
      </div>
    </SettingsBlock>
  )
}

export function ObsidianSettingsBlock({
  icon,
  settingsDraft,
  onPickVault,
  onSettingsDraftChange,
}: {
  icon: string
  settingsDraft: RuntimeSettings
  onPickVault: () => void
  onSettingsDraftChange: SettingsDraftUpdater
}) {
  return (
    <SettingsBlock title="Obsidian 同步" icon={icon} className="order-5">
      <div className="grid gap-3">
        <SettingsField label="Vault 路径" icon={<FolderOpen size={14} />}>
          <div className="flex gap-2">
            <Input
              value={settingsDraft.obsidian_vault_path}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, obsidian_vault_path: event.target.value }))}
              placeholder="选择你的 Obsidian Vault 文件夹"
            />
            <Button type="button" variant="outline" className="shrink-0 rounded-xl" onClick={onPickVault}>
              选择
            </Button>
          </div>
        </SettingsField>
        <SettingsField label="导出目录" icon={<FolderOpen size={14} />}>
          <Input
            value={settingsDraft.obsidian_export_folder}
            onChange={(event) => onSettingsDraftChange((current) => ({ ...current, obsidian_export_folder: event.target.value }))}
            placeholder="视界专注"
          />
        </SettingsField>
        <Button
          type="button"
          variant={settingsDraft.obsidian_auto_sync ? 'default' : 'outline'}
          className="justify-start rounded-xl"
          onClick={() => onSettingsDraftChange((current) => ({ ...current, obsidian_auto_sync: !current.obsidian_auto_sync }))}
        >
          <FolderOpen size={14} />
          {settingsDraft.obsidian_auto_sync ? '保存进度时同步：已预留' : '保存进度时同步：关闭'}
        </Button>
      </div>
    </SettingsBlock>
  )
}

export function TranscriptionSettingsBlock({
  icon,
  settingsDraft,
  onSettingsDraftChange,
}: {
  icon: string
  settingsDraft: RuntimeSettings
  onSettingsDraftChange: SettingsDraftUpdater
}) {
  return (
    <SettingsBlock title="音频转写引擎" icon={icon} className="order-1">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Button
            variant={settingsDraft.transcription_provider === 'local_sensevoice' ? 'default' : 'outline'}
            className="justify-start rounded-xl"
            onClick={() => onSettingsDraftChange((current) => ({ ...current, transcription_provider: 'local_sensevoice' }))}
          >
            <AudioLines size={14} />
            本地 SenseVoice
          </Button>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {[
            { id: 'fast', title: '快速整理' },
            { id: 'balanced', title: '均衡模式' },
            { id: 'background', title: '后台慢速' },
          ].map((mode) => (
            <Button
              key={mode.id}
              type="button"
              variant={settingsDraft.resource_mode === mode.id ? 'default' : 'outline'}
              className="h-10 justify-start rounded-xl px-4 text-left"
              onClick={() => onSettingsDraftChange((current) => ({ ...current, resource_mode: mode.id }))}
            >
              {mode.title}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SettingsField label="本地引擎目录" icon={<FolderOpen size={14} />} className="md:col-span-2">
          <Input
            value={settingsDraft.local_transcription_root}
            onChange={(event) => onSettingsDraftChange((current) => ({ ...current, local_transcription_root: event.target.value }))}
            placeholder="例如 C:\\Users\\Yu\\AI\\Cuda"
          />
        </SettingsField>
        <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
          <SettingsField label="模型 ID" icon={<AudioLines size={14} />}>
            <Input
              value={settingsDraft.local_transcription_model_id}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, local_transcription_model_id: event.target.value }))}
              placeholder="iic/SenseVoiceSmall"
            />
          </SettingsField>
          <SettingsField label="Device" icon={<Server size={14} />}>
            <Input
              value={settingsDraft.local_transcription_device}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, local_transcription_device: event.target.value }))}
              placeholder="cuda:0"
            />
          </SettingsField>
          <SettingsField label="Language" icon={<AudioLines size={14} />}>
            <Input
              value={settingsDraft.local_transcription_language}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, local_transcription_language: event.target.value }))}
              placeholder="zh"
            />
          </SettingsField>
        </div>
      </div>
    </SettingsBlock>
  )
}

export function BilibiliCredentialsSettingsBlock({
  icon,
  settingsDraft,
  onSettingsDraftChange,
}: {
  icon: string
  settingsDraft: RuntimeSettings
  onSettingsDraftChange: SettingsDraftUpdater
}) {
  return (
    <SettingsBlock title="B 站凭据" icon={icon} className="order-6">
      <SettingsField label="SESSDATA" icon={<Cookie size={14} />}>
        <Input
          type="password"
          value={settingsDraft.sessdata}
          onChange={(event) => onSettingsDraftChange((current) => ({ ...current, sessdata: event.target.value }))}
        />
      </SettingsField>
    </SettingsBlock>
  )
}

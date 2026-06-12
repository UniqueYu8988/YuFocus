import {
  AutomationEmailSettingsBlock,
  BilibiliCredentialsSettingsBlock,
  CurrentConfigSettingsBlock,
  MimoTextSettingsBlock,
  ObsidianSettingsBlock,
  TranscriptionSettingsBlock,
  TtsSettingsBlock,
} from '@/components/workspace/SettingsBlocks'
import type {
  AutomationStatusResult,
  MimoVoicePreset,
  RuntimeSettingsFallback,
  SettingsDraftUpdater,
  SettingsStatusResult,
} from '@/components/workspace/SettingsShared'

export function SettingsPaneContent({
  runtimeModeLabel,
  runtimeSettings,
  materialRootDir,
  settingsDraft,
  settingsStatus,
  settingsStatusLoading,
  settingsStatusError,
  automationStatus,
  automationStatusLabel,
  automationBusy,
  emailTestBusy,
  mimoTextModels,
  ttsIcon,
  ttsVoices,
  ttsPreviewVoice,
  obsidianIcon,
  transcriptionIcon,
  bilibiliIcon,
  settingsError,
  onSettingsDraftChange,
  onRefreshSettingsStatus,
  onToggleAutomationPaused,
  onAutomationCheckNow,
  onTestEmailPush,
  onPreviewMimoVoice,
  onPickObsidianVault,
}: {
  runtimeModeLabel: string
  runtimeSettings: RuntimeSettingsFallback
  materialRootDir: string
  settingsDraft: RuntimeSettings
  settingsStatus: SettingsStatusResult | null
  settingsStatusLoading: boolean
  settingsStatusError: string
  automationStatus: AutomationStatusResult | null
  automationStatusLabel: string
  automationBusy: boolean
  emailTestBusy: boolean
  mimoTextModels: readonly string[]
  ttsIcon: string
  ttsVoices: readonly MimoVoicePreset[]
  ttsPreviewVoice: string | null
  obsidianIcon: string
  transcriptionIcon: string
  bilibiliIcon: string
  settingsError: string | null
  onSettingsDraftChange: SettingsDraftUpdater
  onRefreshSettingsStatus: () => void
  onToggleAutomationPaused: () => void
  onAutomationCheckNow: () => void
  onTestEmailPush: () => void
  onPreviewMimoVoice: (voiceId: string, previewUrl: string) => void
  onPickObsidianVault: () => void
}) {
  return (
    <div className="grid w-full gap-7">
      <CurrentConfigSettingsBlock
        runtimeModeLabel={runtimeModeLabel}
        outputDirLabel={settingsDraft.output_dir || runtimeSettings?.output_dir || '未设置'}
        materialRootDir={materialRootDir}
        obsidianVaultPath={settingsDraft.obsidian_vault_path || '未配置'}
        ttsLabel={settingsDraft.tts_provider === 'mimo' ? 'MiMo' : 'MiniMax'}
        transcriptionLabel={settingsDraft.transcription_provider === 'local_sensevoice' ? '本地 SenseVoice' : settingsDraft.transcription_provider}
        settingsStatus={settingsStatus}
        settingsStatusLoading={settingsStatusLoading}
        settingsStatusError={settingsStatusError}
        onRefreshSettingsStatus={onRefreshSettingsStatus}
      />

      <AutomationEmailSettingsBlock
        settingsDraft={settingsDraft}
        automationStatus={automationStatus}
        automationStatusLabel={automationStatusLabel}
        automationBusy={automationBusy}
        emailTestBusy={emailTestBusy}
        onSettingsDraftChange={onSettingsDraftChange}
        onToggleAutomationPaused={onToggleAutomationPaused}
        onAutomationCheckNow={onAutomationCheckNow}
        onTestEmailPush={onTestEmailPush}
      />

      <MimoTextSettingsBlock
        settingsDraft={settingsDraft}
        models={mimoTextModels}
        onSettingsDraftChange={onSettingsDraftChange}
      />

      <TtsSettingsBlock
        icon={ttsIcon}
        settingsDraft={settingsDraft}
        voices={ttsVoices}
        previewVoice={ttsPreviewVoice}
        onPreviewVoice={onPreviewMimoVoice}
        onSettingsDraftChange={onSettingsDraftChange}
      />

      <ObsidianSettingsBlock
        icon={obsidianIcon}
        settingsDraft={settingsDraft}
        onPickVault={onPickObsidianVault}
        onSettingsDraftChange={onSettingsDraftChange}
      />

      <TranscriptionSettingsBlock
        icon={transcriptionIcon}
        settingsDraft={settingsDraft}
        onSettingsDraftChange={onSettingsDraftChange}
      />

      <BilibiliCredentialsSettingsBlock
        icon={bilibiliIcon}
        settingsDraft={settingsDraft}
        onSettingsDraftChange={onSettingsDraftChange}
      />

      {settingsError ? (
        <div className="order-last rounded-[10px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
          {settingsError}
        </div>
      ) : null}
    </div>
  )
}

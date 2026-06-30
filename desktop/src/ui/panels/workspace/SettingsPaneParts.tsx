import {
  BilibiliCredentialsSettingsBlock,
  CurrentConfigSettingsBlock,
  FreshEmailSettingsBlock,
  MimoTextSettingsBlock,
  TranscriptionSettingsBlock,
} from '@/ui/panels/workspace/SettingsBlocks'
import type {
  RuntimeSettingsFallback,
  SettingsDraftUpdater,
  SettingsStatusResult,
} from '@/ui/panels/workspace/SettingsShared'

export function SettingsPaneContent({
  runtimeModeLabel,
  runtimeSettings,
  materialRootDir,
  settingsDraft,
  settingsStatus,
  settingsStatusLoading,
  settingsStatusError,
  mimoTextModels,
  transcriptionIcon,
  bilibiliIcon,
  settingsError,
  onSettingsDraftChange,
  onRefreshSettingsStatus,
}: {
  runtimeModeLabel: string
  runtimeSettings: RuntimeSettingsFallback
  materialRootDir: string
  settingsDraft: RuntimeSettings
  settingsStatus: SettingsStatusResult | null
  settingsStatusLoading: boolean
  settingsStatusError: string
  mimoTextModels: readonly string[]
  transcriptionIcon: string
  bilibiliIcon: string
  settingsError: string | null
  onSettingsDraftChange: SettingsDraftUpdater
  onRefreshSettingsStatus: () => void
}) {
  return (
    <div className="grid w-full gap-7">
      <CurrentConfigSettingsBlock
        runtimeModeLabel={runtimeModeLabel}
        outputDirLabel={settingsDraft.output_dir || runtimeSettings?.output_dir || '未设置'}
        materialRootDir={materialRootDir}
        transcriptionLabel={settingsDraft.transcription_provider === 'local_sensevoice' ? '本地 SenseVoice' : settingsDraft.transcription_provider}
        settingsStatus={settingsStatus}
        settingsStatusLoading={settingsStatusLoading}
        settingsStatusError={settingsStatusError}
        onRefreshSettingsStatus={onRefreshSettingsStatus}
      />

      <MimoTextSettingsBlock
        settingsDraft={settingsDraft}
        models={mimoTextModels}
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

      <FreshEmailSettingsBlock
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

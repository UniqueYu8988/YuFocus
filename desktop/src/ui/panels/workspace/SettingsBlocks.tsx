import {
  AudioLines,
  Cookie,
  FolderOpen,
  Mail,
  RefreshCcw,
  Server,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/ui/components/base/badge'
import { Button } from '@/ui/components/base/button'
import { Input } from '@/ui/components/base/input'
import { cn } from '@/ui/components/utils'
import {
  SettingsBlock,
  SettingsField,
  type SettingsDraftUpdater,
  type SettingsStatusResult,
} from '@/ui/panels/workspace/SettingsShared'

export function CurrentConfigSettingsBlock({
  runtimeModeLabel,
  outputDirLabel,
  materialRootDir,
  transcriptionLabel,
  settingsStatus,
  settingsStatusLoading,
  settingsStatusError,
  onRefreshSettingsStatus,
}: {
  runtimeModeLabel: string
  outputDirLabel: string
  materialRootDir: string
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
    <SettingsBlock title="MiMo 清洗模型" className="order-3">
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
            清洗模型
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

export function FreshEmailSettingsBlock({
  settingsDraft,
  onSettingsDraftChange,
}: {
  settingsDraft: RuntimeSettings
  onSettingsDraftChange: SettingsDraftUpdater
}) {
  return (
    <SettingsBlock title="最近更新邮件推送" className="order-5">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground/90">
              <Mail size={14} />
              只推送最近更新
            </div>
            <p className="max-w-2xl text-[12px] leading-5 text-muted-foreground">
              开启后，仅后台自动发现的 fresh 新视频会在 MiMo 清洗和本地总结完成后发送邮件；历史补全、手动加入和重试任务不会发送。
            </p>
          </div>
          <Button
            type="button"
            variant={settingsDraft.email_push_enabled ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => onSettingsDraftChange((current) => ({ ...current, email_push_enabled: !current.email_push_enabled }))}
          >
            {settingsDraft.email_push_enabled ? '已启用' : '未启用'}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <SettingsField label="SMTP 主机" icon={<Server size={14} />}>
            <Input
              value={settingsDraft.email_smtp_host}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_smtp_host: event.target.value }))}
              placeholder="例如 smtp.qq.com"
            />
          </SettingsField>
          <SettingsField label="SMTP 端口" icon={<Server size={14} />}>
            <Input
              type="number"
              value={settingsDraft.email_smtp_port}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_smtp_port: Number(event.target.value) || 465 }))}
              placeholder="465"
            />
          </SettingsField>
          <SettingsField label="发件邮箱" icon={<Mail size={14} />}>
            <Input
              value={settingsDraft.email_from}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_from: event.target.value }))}
              placeholder="sender@example.com"
            />
          </SettingsField>
          <SettingsField label="收件邮箱" icon={<Mail size={14} />}>
            <Input
              value={settingsDraft.email_to}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_to: event.target.value }))}
              placeholder="receiver@example.com"
            />
          </SettingsField>
          <SettingsField label="SMTP 用户" icon={<Mail size={14} />}>
            <Input
              value={settingsDraft.email_smtp_user}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_smtp_user: event.target.value }))}
              placeholder="通常与发件邮箱一致"
            />
          </SettingsField>
          <SettingsField label="SMTP 授权码" icon={<Server size={14} />}>
            <Input
              type="password"
              value={settingsDraft.email_smtp_password}
              onChange={(event) => onSettingsDraftChange((current) => ({ ...current, email_smtp_password: event.target.value }))}
              placeholder="邮箱服务商提供的授权码"
            />
          </SettingsField>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] leading-5 text-muted-foreground">
          <Button
            type="button"
            variant={settingsDraft.email_smtp_secure ? 'default' : 'outline'}
            size="sm"
            className="rounded-xl"
            onClick={() => onSettingsDraftChange((current) => ({ ...current, email_smtp_secure: !current.email_smtp_secure }))}
          >
            SSL/TLS：{settingsDraft.email_smtp_secure ? '开启' : '关闭'}
          </Button>
          <span>邮件正文来自本地模型生成的 brief/email；发送失败只记录状态，不会让资料生成失败。</span>
        </div>
      </div>
    </SettingsBlock>
  )
}

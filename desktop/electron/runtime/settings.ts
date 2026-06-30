import path from 'node:path'

export type RuntimeSettings = {
  sessdata: string
  output_dir: string
  obsidian_vault_path: string
  obsidian_export_folder: string
  obsidian_auto_sync: boolean
  tts_provider: string
  minimax_api_key: string
  minimax_tts_endpoint: string
  minimax_tts_model: string
  minimax_tts_voice_id: string
  minimax_tts_speed: number
  minimax_tts_volume: number
  minimax_tts_pitch: number
  mimo_api_key: string
  mimo_text_endpoint: string
  mimo_text_model: string
  mimo_tts_endpoint: string
  mimo_tts_model: string
  mimo_tts_voice_id: string
  mimo_tts_style_prompt: string
  transcription_provider: string
  local_transcription_root: string
  local_transcription_python: string
  local_transcription_model_id: string
  local_transcription_device: string
  local_transcription_language: string
  resource_mode: string
  background_automation_enabled: boolean
  background_check_interval_minutes: number
  email_push_enabled: boolean
  email_smtp_host: string
  email_smtp_port: number
  email_smtp_secure: boolean
  email_smtp_user: string
  email_smtp_password: string
  email_from: string
  email_to: string
  workbench_queue_concurrency: number
}

export type SettingsDefaultsContext = {
  outputRoot: string
  legacyOutputRoots?: string[]
  localTranscriptionRoot: string
  backgroundCheckIntervalMinutes: number
  workbenchQueueConcurrency: number
}

export function sanitizeSecret(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  if (normalized.includes('文件名、目录名或卷标语法不正确')) return ''
  if (/[^\x20-\x7E]/.test(normalized)) return ''
  return normalized
}

export function sanitizeBaseUrl(value: unknown, fallback: string) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return fallback
  if (/[^\x20-\x7E]/.test(normalized)) return fallback
  return normalized
}

export function sanitizeOptionalPath(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  return path.resolve(normalized)
}

export function sanitizeDisplayText(value: unknown, fallback = '') {
  const normalized = String(value ?? '').replace(/[\x00-\x1F]/g, '').trim()
  return normalized || fallback
}

function sanitizeTranscriptionProvider(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  void normalized
  return 'local_sensevoice'
}

export function sanitizeResourceMode(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'fast' || normalized === 'balanced' || normalized === 'background') {
    return normalized
  }
  return 'balanced'
}

function sanitizeTtsProvider(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'minimax') return normalized
  if (normalized === 'mimo') return normalized
  return 'mimo'
}

const MIMO_TTS_PRESET_VOICES = ['茉莉', '冰糖', '苏打', '白桦'] as const

function sanitizeMimoTtsVoiceId(value: unknown, fallback = '茉莉') {
  const normalized = sanitizeDisplayText(value ?? fallback, fallback)
  return MIMO_TTS_PRESET_VOICES.includes(normalized as (typeof MIMO_TTS_PRESET_VOICES)[number])
    ? normalized
    : fallback
}

function sanitizeMimoTextModel(value: unknown, fallback = 'mimo-v2.5') {
  const normalized = sanitizeSecret(value).trim()
  if (!normalized || normalized === 'mimo-v2.5-pro') return fallback
  if (normalized === 'mimo-v2.5') return normalized
  return fallback
}

export function sanitizeNumberInRange(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

function normalizeOutputRoot(value: unknown, context: SettingsDefaultsContext) {
  const rawPath = String(value ?? '').trim()
  if (!rawPath) return context.outputRoot

  const normalizedRawPath = path.resolve(rawPath).toLowerCase()
  const isLegacyPath = (context.legacyOutputRoots ?? [])
    .map((legacyPath) => path.resolve(legacyPath).toLowerCase())
    .includes(normalizedRawPath)

  return isLegacyPath ? context.outputRoot : path.resolve(rawPath)
}

function defaultSettings(context: SettingsDefaultsContext): RuntimeSettings {
  return {
    sessdata: '',
    output_dir: context.outputRoot,
    obsidian_vault_path: '',
    obsidian_export_folder: '视界专注',
    obsidian_auto_sync: true,
    tts_provider: 'mimo',
    minimax_api_key: '',
    minimax_tts_endpoint: 'https://api.minimaxi.com/v1/t2a_v2',
    minimax_tts_model: 'speech-2.8-hd',
    minimax_tts_voice_id: '',
    minimax_tts_speed: 1,
    minimax_tts_volume: 1,
    minimax_tts_pitch: 0,
    mimo_api_key: '',
    mimo_text_endpoint: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
    mimo_text_model: 'mimo-v2.5',
    mimo_tts_endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
    mimo_tts_model: 'mimo-v2.5-tts',
    mimo_tts_voice_id: '茉莉',
    mimo_tts_style_prompt: '自然 清晰 语速适中',
    transcription_provider: 'local_sensevoice',
    local_transcription_root: context.localTranscriptionRoot,
    local_transcription_python: '',
    local_transcription_model_id: 'iic/SenseVoiceSmall',
    local_transcription_device: 'cuda:0',
    local_transcription_language: 'zh',
    resource_mode: 'balanced',
    background_automation_enabled: true,
    background_check_interval_minutes: context.backgroundCheckIntervalMinutes,
    email_push_enabled: false,
    email_smtp_host: '',
    email_smtp_port: 465,
    email_smtp_secure: true,
    email_smtp_user: '',
    email_smtp_password: '',
    email_from: '',
    email_to: '',
    workbench_queue_concurrency: context.workbenchQueueConcurrency,
  }
}

function isEmailAddress(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(String(value ?? '').trim())
}

function getEmailDomain(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase()
  const marker = text.lastIndexOf('@')
  return marker >= 0 ? text.slice(marker + 1) : ''
}

function applyEmailProviderDefaults(settings: RuntimeSettings): RuntimeSettings {
  const emailIdentity = [
    settings.email_from,
    settings.email_smtp_user,
    settings.email_to,
  ].find((value) => getEmailDomain(value) === 'qq.com') ?? ''

  if (!emailIdentity) return settings

  const sender = isEmailAddress(settings.email_from)
    ? settings.email_from
    : isEmailAddress(settings.email_smtp_user)
      ? settings.email_smtp_user
      : ''

  return {
    ...settings,
    email_smtp_host: settings.email_smtp_host || 'smtp.qq.com',
    email_smtp_port: settings.email_smtp_port || 465,
    email_smtp_secure: true,
    email_smtp_user: isEmailAddress(settings.email_smtp_user) ? settings.email_smtp_user : sender,
    email_from: sender || settings.email_from,
  }
}

export function normalizeSettings(
  raw: Partial<RuntimeSettings> | null | undefined,
  context: SettingsDefaultsContext,
): RuntimeSettings {
  const defaults = defaultSettings(context)
  const normalized: RuntimeSettings = {
    sessdata: sanitizeSecret(raw?.sessdata ?? defaults.sessdata),
    output_dir: normalizeOutputRoot(raw?.output_dir ?? defaults.output_dir, context),
    obsidian_vault_path: sanitizeOptionalPath(raw?.obsidian_vault_path ?? defaults.obsidian_vault_path),
    obsidian_export_folder: sanitizeDisplayText(raw?.obsidian_export_folder ?? defaults.obsidian_export_folder, defaults.obsidian_export_folder),
    obsidian_auto_sync: raw?.obsidian_auto_sync === undefined ? defaults.obsidian_auto_sync : Boolean(raw?.obsidian_auto_sync),
    tts_provider: sanitizeTtsProvider(raw?.tts_provider ?? defaults.tts_provider),
    minimax_api_key: sanitizeSecret(raw?.minimax_api_key ?? defaults.minimax_api_key),
    minimax_tts_endpoint: sanitizeBaseUrl(raw?.minimax_tts_endpoint ?? defaults.minimax_tts_endpoint, defaults.minimax_tts_endpoint),
    minimax_tts_model:
      sanitizeSecret(raw?.minimax_tts_model ?? defaults.minimax_tts_model) || defaults.minimax_tts_model,
    minimax_tts_voice_id: sanitizeDisplayText(raw?.minimax_tts_voice_id ?? defaults.minimax_tts_voice_id),
    minimax_tts_speed: sanitizeNumberInRange(raw?.minimax_tts_speed, defaults.minimax_tts_speed, 0.5, 2),
    minimax_tts_volume: sanitizeNumberInRange(raw?.minimax_tts_volume, defaults.minimax_tts_volume, 0.1, 5),
    minimax_tts_pitch: sanitizeNumberInRange(raw?.minimax_tts_pitch, defaults.minimax_tts_pitch, -12, 12),
    mimo_api_key: sanitizeSecret(raw?.mimo_api_key ?? defaults.mimo_api_key),
    mimo_text_endpoint: sanitizeBaseUrl(raw?.mimo_text_endpoint ?? defaults.mimo_text_endpoint, defaults.mimo_text_endpoint),
    mimo_text_model: sanitizeMimoTextModel(raw?.mimo_text_model ?? defaults.mimo_text_model, defaults.mimo_text_model),
    mimo_tts_endpoint: sanitizeBaseUrl(raw?.mimo_tts_endpoint ?? defaults.mimo_tts_endpoint, defaults.mimo_tts_endpoint),
    mimo_tts_model: defaults.mimo_tts_model,
    mimo_tts_voice_id: sanitizeMimoTtsVoiceId(raw?.mimo_tts_voice_id ?? defaults.mimo_tts_voice_id, defaults.mimo_tts_voice_id),
    mimo_tts_style_prompt: defaults.mimo_tts_style_prompt,
    transcription_provider: sanitizeTranscriptionProvider(raw?.transcription_provider || defaults.transcription_provider),
    local_transcription_root: sanitizeOptionalPath(raw?.local_transcription_root || defaults.local_transcription_root),
    local_transcription_python: sanitizeOptionalPath(raw?.local_transcription_python || defaults.local_transcription_python),
    local_transcription_model_id:
      sanitizeSecret(raw?.local_transcription_model_id ?? defaults.local_transcription_model_id) || defaults.local_transcription_model_id,
    local_transcription_device:
      sanitizeSecret(raw?.local_transcription_device ?? defaults.local_transcription_device) || defaults.local_transcription_device,
    local_transcription_language:
      sanitizeSecret(raw?.local_transcription_language ?? defaults.local_transcription_language) || defaults.local_transcription_language,
    resource_mode: sanitizeResourceMode(raw?.resource_mode ?? defaults.resource_mode),
    background_automation_enabled:
      raw?.background_automation_enabled === undefined ? defaults.background_automation_enabled : Boolean(raw?.background_automation_enabled),
    background_check_interval_minutes: context.backgroundCheckIntervalMinutes,
    email_push_enabled: raw?.email_push_enabled === undefined ? defaults.email_push_enabled : Boolean(raw?.email_push_enabled),
    email_smtp_host: sanitizeBaseUrl(raw?.email_smtp_host ?? defaults.email_smtp_host, defaults.email_smtp_host),
    email_smtp_port: Math.round(sanitizeNumberInRange(raw?.email_smtp_port, defaults.email_smtp_port, 1, 65535)),
    email_smtp_secure: raw?.email_smtp_secure === undefined ? defaults.email_smtp_secure : Boolean(raw?.email_smtp_secure),
    email_smtp_user: sanitizeSecret(raw?.email_smtp_user ?? defaults.email_smtp_user),
    email_smtp_password: sanitizeSecret(raw?.email_smtp_password ?? defaults.email_smtp_password),
    email_from: sanitizeDisplayText(raw?.email_from ?? defaults.email_from),
    email_to: sanitizeDisplayText(raw?.email_to ?? defaults.email_to),
    workbench_queue_concurrency: context.workbenchQueueConcurrency,
  }
  return applyEmailProviderDefaults(normalized)
}

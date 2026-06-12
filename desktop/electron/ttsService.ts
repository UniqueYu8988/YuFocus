import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { RuntimeSettings } from './settings'

export type TtsServicePaths = {
  dataRoot: string
  userDataRoot: string
}

export type TtsSynthesizePayload = {
  text: string
  nodeId?: string | null
}

export type TtsSynthesizeResult = {
  provider: string
  model: string
  voiceId: string
  filePath: string
  filePaths: string[]
  dataUrl: string
  dataUrls: string[]
  cached: boolean
  characters: number
  usage: TtsUsageSnapshot
}

export type TtsCacheStatusResult = {
  cached: boolean
  characters: number
  filePath: string | null
  filePaths: string[]
  usage: TtsUsageSnapshot
}

export type TtsUsageSnapshot = {
  date: string
  usedCharacters: number
  dailyLimit: number
  remainingCharacters: number
  note: string
}

function stripMarkdownForSpeech(text: string) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<u>([^<]+)<\/u>/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[★☆◆◇■□●○◎※→←↑↓]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function estimateMiniMaxSpeechCharacters(text: string) {
  const speechText = stripMarkdownForSpeech(text)
  let total = 0
  for (const char of Array.from(speechText)) {
    total += /\p{Script=Han}/u.test(char) ? 2 : 1
  }
  return total
}

const MINIMAX_TTS_LOCAL_DAILY_LIMIT = 4000
const DEFAULT_TTS_CACHE_EXTENSION = 'mp3'

function resolveTtsCacheDir(paths: TtsServicePaths) {
  return path.join(paths.dataRoot, '.shijie-tts-cache')
}

function resolveTtsUsagePath(paths: TtsServicePaths) {
  return path.join(paths.userDataRoot, '.shijie-focus-tts-usage.json')
}

function getLocalDateKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeTtsUsage(raw: unknown): TtsUsageSnapshot {
  const currentDate = getLocalDateKey()
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const date = typeof record.date === 'string' ? record.date : currentDate
  const sameDay = date === currentDate
  const usedCharacters = sameDay ? Math.max(0, Math.round(Number(record.usedCharacters) || 0)) : 0
  const dailyLimit = Math.max(1, Math.round(Number(record.dailyLimit) || MINIMAX_TTS_LOCAL_DAILY_LIMIT))

  return {
    date: currentDate,
    usedCharacters,
    dailyLimit,
    remainingCharacters: Math.max(0, dailyLimit - usedCharacters),
    note: '本地估算：只统计本机今天新合成成功的字符，缓存命中不计入。',
  }
}

function readTtsUsage(paths: TtsServicePaths): TtsUsageSnapshot {
  try {
    const usagePath = resolveTtsUsagePath(paths)
    if (!fs.existsSync(usagePath)) return normalizeTtsUsage(null)
    return normalizeTtsUsage(JSON.parse(fs.readFileSync(usagePath, 'utf-8')))
  } catch {
    return normalizeTtsUsage(null)
  }
}

function writeTtsUsage(paths: TtsServicePaths, snapshot: TtsUsageSnapshot) {
  try {
    fs.mkdirSync(path.dirname(resolveTtsUsagePath(paths)), { recursive: true })
    fs.writeFileSync(resolveTtsUsagePath(paths), JSON.stringify(snapshot, null, 2), 'utf-8')
  } catch {
    // Usage tracking is helpful but should never block speech synthesis.
  }
}

function recordTtsUsage(paths: TtsServicePaths, characters: number) {
  const current = readTtsUsage(paths)
  const nextUsed = current.usedCharacters + Math.max(0, Math.round(characters))
  const next: TtsUsageSnapshot = {
    ...current,
    usedCharacters: nextUsed,
    remainingCharacters: Math.max(0, current.dailyLimit - nextUsed),
  }
  writeTtsUsage(paths, next)
  return next
}

function getTtsProviderLabel(settings: RuntimeSettings) {
  if (settings.tts_provider === 'mimo') return 'MiMo'
  if (settings.tts_provider === 'minimax') return 'MiniMax'
  return 'TTS'
}

function getTtsModel(settings: RuntimeSettings) {
  return settings.tts_provider === 'mimo' ? settings.mimo_tts_model : settings.minimax_tts_model
}

function getTtsVoiceId(settings: RuntimeSettings) {
  return settings.tts_provider === 'mimo' ? settings.mimo_tts_voice_id : settings.minimax_tts_voice_id
}

function getTtsAudioExtension(settings: RuntimeSettings) {
  return settings.tts_provider === 'mimo' ? 'wav' : DEFAULT_TTS_CACHE_EXTENSION
}

function getTtsAudioMime(settings: RuntimeSettings) {
  return settings.tts_provider === 'mimo' ? 'audio/wav' : 'audio/mpeg'
}

function toTtsDataUrl(buffer: Buffer, mime: string) {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

function buildTtsCacheEntries(settings: RuntimeSettings, text: string, paths: TtsServicePaths) {
  const chunks = splitSpeechText(text)
  const extension = getTtsAudioExtension(settings)
  const cacheDir = resolveTtsCacheDir(paths)

  if (chunks.length === 1) {
    const cacheKey = buildTtsCacheKey(settings, text)
    return [{
      text,
      filePath: path.join(cacheDir, `${cacheKey}.${extension}`),
    }]
  }

  return chunks.map((chunk, index) => {
    const chunkKey = buildTtsCacheKey(settings, [
      `chunk:${index + 1}/${chunks.length}`,
      chunk,
    ].join('\n'))
    return {
      text: chunk,
      filePath: path.join(cacheDir, `${chunkKey}.${extension}`),
    }
  })
}

function formatTtsUsageLine(settings: RuntimeSettings, usage: TtsUsageSnapshot, requestedCharacters: number) {
  if (settings.tts_provider === 'mimo') {
    return 'MiMo TTS 当前按官方说明为限时免费；本机只记录缓存状态，缓存命中不重复调用。'
  }
  return `本节预计 ${requestedCharacters} MiniMax 字符；今日本地已新合成 ${usage.usedCharacters}/${usage.dailyLimit}，估算剩余 ${usage.remainingCharacters}。缓存命中不消耗额度。`
}

function buildTtsCacheKey(settings: RuntimeSettings, text: string) {
  const providerSettings = settings.tts_provider === 'mimo'
    ? {
        provider: settings.tts_provider,
        requestVersion: 'mimo-direct-speech-v4',
        endpoint: settings.mimo_tts_endpoint,
        model: settings.mimo_tts_model,
        voiceId: settings.mimo_tts_voice_id,
        stylePrompt: settings.mimo_tts_style_prompt,
      }
    : {
        provider: settings.tts_provider,
        endpoint: settings.minimax_tts_endpoint,
        model: settings.minimax_tts_model,
        voiceId: settings.minimax_tts_voice_id,
        speed: settings.minimax_tts_speed,
        volume: settings.minimax_tts_volume,
        pitch: settings.minimax_tts_pitch,
      }
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      ...providerSettings,
      text,
    }))
    .digest('hex')
}

function splitSpeechText(text: string, limit = 9000) {
  if (estimateMiniMaxSpeechCharacters(text) <= limit) return [text]
  const chunks: string[] = []
  let buffer = ''
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const pushBuffer = () => {
    const value = buffer.trim()
    if (value) chunks.push(value)
    buffer = ''
  }

  for (const paragraph of paragraphs) {
    if (estimateMiniMaxSpeechCharacters(paragraph) > limit) {
      pushBuffer()
      const sentences = paragraph
        .split(/(?<=[。！？；;.!?])/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean)
      for (const sentence of sentences.length ? sentences : [paragraph]) {
        if (estimateMiniMaxSpeechCharacters((buffer + '\n' + sentence).trim()) > limit) pushBuffer()
        if (estimateMiniMaxSpeechCharacters(sentence) > limit) {
          let slice = ''
          for (const char of Array.from(sentence)) {
            if (estimateMiniMaxSpeechCharacters(slice + char) > limit) {
              if (slice.trim()) chunks.push(slice.trim())
              slice = ''
            }
            slice += char
          }
          if (slice.trim()) chunks.push(slice.trim())
        } else {
          buffer = buffer ? `${buffer}\n${sentence}` : sentence
        }
      }
      continue
    }

    if (estimateMiniMaxSpeechCharacters((buffer + '\n\n' + paragraph).trim()) > limit) pushBuffer()
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
  }

  pushBuffer()
  return chunks
}

async function requestMiniMaxSpeechAudio(settings: RuntimeSettings, text: string) {
  const response = await fetch(settings.minimax_tts_endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.minimax_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.minimax_tts_model,
      text,
      stream: false,
      language_boost: 'Chinese',
      output_format: 'hex',
      voice_setting: {
        voice_id: settings.minimax_tts_voice_id,
        speed: settings.minimax_tts_speed,
        vol: settings.minimax_tts_volume,
        pitch: settings.minimax_tts_pitch,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`MiniMax TTS 请求失败：${response.status} ${response.statusText}`)
  }

  const result = await response.json() as {
    data?: { audio?: string; status?: number } | null
    base_resp?: { status_code?: number; status_msg?: string }
  }
  if (result.base_resp?.status_code && result.base_resp.status_code !== 0) {
    throw new Error(formatMiniMaxTtsError(result.base_resp.status_code, result.base_resp.status_msg))
  }
  const audioHex = result.data?.audio
  if (!audioHex) {
    throw new Error('MiniMax TTS 未返回音频数据。')
  }
  return Buffer.from(audioHex, 'hex')
}

async function requestMiMoSpeechAudio(settings: RuntimeSettings, text: string) {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    {
      role: 'user',
      content: '请把 assistant 消息中的文本转换成中文口播音频，只朗读原文，不要朗读任何配置、标签、说明或额外内容。',
    },
    {
      role: 'assistant',
      content: text,
    },
  ]

  const response = await fetch(resolveMiMoTtsEndpoint(settings), {
    method: 'POST',
    headers: buildMiMoTtsHeaders(settings),
    body: JSON.stringify({
      model: settings.mimo_tts_model,
      messages,
      audio: {
        format: 'wav',
        voice: settings.mimo_tts_voice_id || '茉莉',
      },
    }),
  })

  const responseText = await response.text()
  let result: {
    error?: { message?: string; code?: string | number }
    choices?: Array<{
      message?: {
        audio?: {
          data?: string
        }
      }
    }>
  } = {}

  try {
    result = responseText ? JSON.parse(responseText) : {}
  } catch {
    result = {}
  }

  if (!response.ok) {
    const rawMessage = result.error?.message || responseText || `${response.status} ${response.statusText}`
    throw new Error(formatMiMoTtsError(`HTTP ${response.status}：${rawMessage}`))
  }

  if (result.error) {
    throw new Error(formatMiMoTtsError(result.error.message || `MiMo TTS 返回错误：${result.error.code ?? 'unknown'}`))
  }
  const audioBase64 = result.choices?.[0]?.message?.audio?.data
  if (!audioBase64) {
    throw new Error('MiMo TTS 未返回音频数据。')
  }
  return Buffer.from(audioBase64, 'base64')
}

export function resolveMiMoTtsEndpoint(settings: RuntimeSettings) {
  const apiKey = settings.mimo_api_key.trim()
  const isTokenPlan = apiKey.startsWith('tp-')
  const defaultPayAsYouGoEndpoint = 'https://api.xiaomimimo.com/v1/chat/completions'
  const defaultTokenPlanEndpoint = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
  let endpoint = settings.mimo_tts_endpoint.trim() || (isTokenPlan ? defaultTokenPlanEndpoint : defaultPayAsYouGoEndpoint)

  if (isTokenPlan && endpoint.includes('api.xiaomimimo.com')) {
    endpoint = defaultTokenPlanEndpoint
  }

  endpoint = endpoint.replace(/\/+$/, '')
  if (/\/anthropic$/i.test(endpoint)) {
    endpoint = endpoint.replace(/\/anthropic$/i, '/v1/chat/completions')
  }
  if (/\/v1$/i.test(endpoint)) {
    return `${endpoint}/chat/completions`
  }
  if (/\/v1\/chat\/completions$/i.test(endpoint)) {
    return endpoint
  }

  try {
    const parsed = new URL(endpoint)
    if (!parsed.pathname || parsed.pathname === '/') {
      return `${parsed.origin}/v1/chat/completions`
    }
  } catch {
    return endpoint
  }

  return endpoint
}

function buildMiMoTtsHeaders(settings: RuntimeSettings) {
  const apiKey = settings.mimo_api_key.trim()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'api-key': apiKey,
  }
}

function formatMiniMaxTtsError(statusCode: number, statusMsg?: string) {
  const message = statusMsg || `MiniMax TTS 返回错误：${statusCode}`
  const lowerMessage = message.toLowerCase()
  if (statusCode === 2049 || lowerMessage.includes('invalid api key')) {
    return 'MiniMax 鉴权失败：当前 API Key 没有被这个接口地址接受。请确认 Key 来自对应的 MiniMax 开放平台，并检查接口地址是国内站 api.minimaxi.com 还是国际站 api.minimax.io。'
  }
  if (statusCode === 2061 || lowerMessage.includes('not support model')) {
    return `MiniMax 当前套餐不支持所选语音模型。请在设置里更换模型，例如 speech-2.8-hd，原始返回：${message}`
  }
  if (
    lowerMessage.includes('quota') ||
    lowerMessage.includes('balance') ||
    lowerMessage.includes('insufficient') ||
    lowerMessage.includes('limit') ||
    message.includes('额度') ||
    message.includes('余额') ||
    message.includes('不足') ||
    message.includes('限制')
  ) {
    return `MiniMax 语音额度可能不足或触发平台限制。原始返回：${message}`
  }
  if (statusCode === 1004 || lowerMessage.includes('authorization')) {
    return 'MiniMax 鉴权失败：请求没有携带有效 API Key。请重新保存 API Key 后再试。'
  }
  return message
}

function formatMiMoTtsError(message: string) {
  const lowerMessage = message.toLowerCase()
  if (lowerMessage.includes('invalid') && lowerMessage.includes('key')) {
    return 'MiMo 鉴权失败：当前 API Key 没有被接口接受。请确认 Key 来自小米 MiMo 开放平台，并重新保存后再试。'
  }
  if (
    lowerMessage.includes('quota') ||
    lowerMessage.includes('balance') ||
    lowerMessage.includes('insufficient') ||
    lowerMessage.includes('limit') ||
    message.includes('额度') ||
    message.includes('余额') ||
    message.includes('不足') ||
    message.includes('限制')
  ) {
    return `MiMo 语音额度可能不足或触发平台限制。原始返回：${message}`
  }
  if (lowerMessage.includes('model')) {
    return `MiMo 当前账号可能不支持所选模型。建议先使用 mimo-v2.5-tts，原始返回：${message}`
  }
  return message
}

function formatTtsFailureMessage(settings: RuntimeSettings, error: unknown, characters: number, usage: TtsUsageSnapshot) {
  const baseMessage = error instanceof Error ? error.message : String(error)
  return `${baseMessage}\n${formatTtsUsageLine(settings, usage, characters)}`
}

export function getTtsCacheStatus(settings: RuntimeSettings, payload: TtsSynthesizePayload, paths: TtsServicePaths): TtsCacheStatusResult {
  const text = stripMarkdownForSpeech(payload.text)
  const usage = readTtsUsage(paths)
  if (!text) {
    return {
      cached: false,
      characters: 0,
      filePath: null,
      filePaths: [],
      usage,
    }
  }

  const entries = buildTtsCacheEntries(settings, text, paths)
  const filePaths = entries.map((entry) => entry.filePath)
  const cachedFilePaths = filePaths.filter((filePath) => fs.existsSync(filePath))
  const cached = entries.length > 0 && cachedFilePaths.length === entries.length
  return {
    cached,
    characters: estimateMiniMaxSpeechCharacters(text),
    filePath: cached ? filePaths[0] : null,
    filePaths: cached ? filePaths : cachedFilePaths,
    usage,
  }
}

export async function synthesizeSpeech(settings: RuntimeSettings, payload: TtsSynthesizePayload, paths: TtsServicePaths): Promise<TtsSynthesizeResult> {
  if (settings.tts_provider !== 'minimax' && settings.tts_provider !== 'mimo') {
    throw new Error('请先在设置中启用语音朗读。')
  }
  if (settings.tts_provider === 'minimax' && !settings.minimax_api_key) {
    throw new Error('请先在设置中填写 MiniMax API Key。')
  }
  if (settings.tts_provider === 'minimax' && !settings.minimax_tts_voice_id) {
    throw new Error('请先在设置中填写 MiniMax voice_id。')
  }
  if (settings.tts_provider === 'mimo' && !settings.mimo_api_key) {
    throw new Error('请先在设置中填写 MiMo API Key。')
  }

  const text = stripMarkdownForSpeech(payload.text)
  if (!text) {
    throw new Error('没有可朗读的文本。')
  }
  const characters = estimateMiniMaxSpeechCharacters(text)
  const usageBefore = readTtsUsage(paths)

  const cacheDir = resolveTtsCacheDir(paths)
  fs.mkdirSync(cacheDir, { recursive: true })
  const audioMime = getTtsAudioMime(settings)
  const entries = buildTtsCacheEntries(settings, text, paths)
  const cachedBuffers = entries.every((entry) => fs.existsSync(entry.filePath))
    ? entries.map((entry) => fs.readFileSync(entry.filePath))
    : []

  if (cachedBuffers.length === entries.length && entries.length > 0) {
    return {
      provider: settings.tts_provider,
      model: getTtsModel(settings),
      voiceId: getTtsVoiceId(settings),
      filePath: entries[0].filePath,
      filePaths: entries.map((entry) => entry.filePath),
      dataUrl: toTtsDataUrl(cachedBuffers[0], audioMime),
      dataUrls: cachedBuffers.map((buffer) => toTtsDataUrl(buffer, audioMime)),
      cached: true,
      characters,
      usage: usageBefore,
    }
  }

  const audioBuffers: Buffer[] = []
  let generatedCharacters = 0
  try {
    for (const entry of entries) {
      if (fs.existsSync(entry.filePath)) {
        audioBuffers.push(fs.readFileSync(entry.filePath))
        continue
      }
      const audioBuffer = settings.tts_provider === 'mimo'
        ? await requestMiMoSpeechAudio(settings, entry.text)
        : await requestMiniMaxSpeechAudio(settings, entry.text)
      fs.writeFileSync(entry.filePath, audioBuffer)
      generatedCharacters += estimateMiniMaxSpeechCharacters(entry.text)
      audioBuffers.push(audioBuffer)
    }
  } catch (error) {
    throw new Error(formatTtsFailureMessage(settings, error, characters, usageBefore))
  }

  const usageAfter = settings.tts_provider === 'minimax' && generatedCharacters > 0
    ? recordTtsUsage(paths, generatedCharacters)
    : usageBefore
  return {
    provider: settings.tts_provider,
    model: getTtsModel(settings),
    voiceId: getTtsVoiceId(settings),
    filePath: entries[0].filePath,
    filePaths: entries.map((entry) => entry.filePath),
    dataUrl: toTtsDataUrl(audioBuffers[0], audioMime),
    dataUrls: audioBuffers.map((buffer) => toTtsDataUrl(buffer, audioMime)),
    cached: false,
    characters,
    usage: usageAfter,
  }
}

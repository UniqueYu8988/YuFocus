import type {
  LocalConsumptionArtifactKind,
  LocalModelRequestFormat,
  LocalModelRequestPlan,
} from '../../src/domain/localConsumption.ts'

export const LOCAL_OLLAMA_ADAPTER_VERSION = 'shijie.local-ollama-adapter.v0.1'
export const DEFAULT_LOCAL_OLLAMA_MODEL = 'shijie-qwen3-8b-q4-chat'
export const DEFAULT_LOCAL_OLLAMA_NUM_CTX = 12288
export const DEFAULT_LOCAL_OLLAMA_MARKDOWN_NUM_PREDICT = 4096
export const DEFAULT_LOCAL_OLLAMA_JSON_NUM_PREDICT = 256
export const DEFAULT_LOCAL_OLLAMA_TEMPERATURE = 0.1
export const DEFAULT_LOCAL_OLLAMA_TOP_P = 0.8

export type LocalOllamaAdapterErrorCode =
  | 'unsupported_provider'
  | 'offline'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'invalid_json'
  | 'quality_guard_failed'

export type LocalOllamaGenerationOptions = {
  numCtx?: number
  numPredict?: number
  temperature?: number
  topP?: number
}

export type LocalOllamaAdapterOptions = LocalOllamaGenerationOptions & {
  model?: string
  timeoutMs?: number
  fetchImpl?: LocalOllamaFetch
  now?: () => number
}

export type LocalOllamaAdapterError = {
  code: LocalOllamaAdapterErrorCode
  message: string
  status?: number
  detail?: string
}

export type LocalOllamaOutputGuard = {
  ok: boolean
  hasThinkTags: boolean
  hasSecretPattern: boolean
  hasLocalPath: boolean
  outputChars: number
  issues: string[]
}

export type LocalOllamaAdapterResult = {
  ok: boolean
  adapterVersion: string
  artifact: LocalConsumptionArtifactKind
  responseFormat: LocalModelRequestFormat
  model: string
  endpoint: string
  elapsedMs: number
  params: Required<LocalOllamaGenerationOptions>
  cacheKey?: string
  content?: string
  json?: unknown
  guard?: LocalOllamaOutputGuard
  rawContent?: string
  error?: LocalOllamaAdapterError
}

type LocalOllamaFetchResponse = {
  ok: boolean
  status: number
  statusText?: string
  json: () => Promise<unknown>
}

export type LocalOllamaFetch = (url: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
  signal?: AbortSignal
}) => Promise<LocalOllamaFetchResponse>

type OllamaChatResponse = {
  message?: {
    content?: unknown
  }
  response?: unknown
  error?: unknown
}

export function resolveLocalOllamaParams(
  plan: Pick<LocalModelRequestPlan, 'responseFormat'>,
  options: LocalOllamaGenerationOptions = {},
): Required<LocalOllamaGenerationOptions> {
  return {
    numCtx: Math.max(1024, Math.floor(options.numCtx || DEFAULT_LOCAL_OLLAMA_NUM_CTX)),
    numPredict: Math.max(
      32,
      Math.floor(
        options.numPredict ||
          (plan.responseFormat === 'json'
            ? DEFAULT_LOCAL_OLLAMA_JSON_NUM_PREDICT
            : DEFAULT_LOCAL_OLLAMA_MARKDOWN_NUM_PREDICT),
      ),
    ),
    temperature: Number.isFinite(options.temperature) ? Number(options.temperature) : DEFAULT_LOCAL_OLLAMA_TEMPERATURE,
    topP: Number.isFinite(options.topP) ? Number(options.topP) : DEFAULT_LOCAL_OLLAMA_TOP_P,
  }
}

export function createOllamaRequestBody(plan: LocalModelRequestPlan, options: LocalOllamaAdapterOptions = {}) {
  const params = resolveLocalOllamaParams(plan, options)
  return {
    model: normalizeOllamaModelName(options.model || plan.model),
    messages: plan.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    stream: false,
    format: plan.responseFormat === 'json' ? 'json' : undefined,
    options: {
      num_ctx: params.numCtx,
      num_predict: params.numPredict,
      temperature: params.temperature,
      top_p: params.topP,
    },
  }
}

export function normalizeOllamaModelName(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized === 'local-model-unconfigured') return DEFAULT_LOCAL_OLLAMA_MODEL
  return normalized
}

export function stripLocalModelThinkTags(text: string) {
  return String(text || '')
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/giu, '')
    .replace(/<\/?think\b[^>]*>/giu, '')
    .trim()
}

export function parseLocalModelJson(text: string): {
  ok: boolean
  json?: unknown
  cleaned: string
  error?: string
} {
  const cleaned = stripLocalModelThinkTags(text)
  const firstParse = safeJsonParse(cleaned)
  if (firstParse.ok) return { ok: true, json: firstParse.json, cleaned }

  const extracted = extractFirstJsonObject(cleaned)
  if (extracted) {
    const extractedParse = safeJsonParse(extracted)
    if (extractedParse.ok) return { ok: true, json: extractedParse.json, cleaned: extracted }
  }

  return {
    ok: false,
    cleaned,
    error: firstParse.error || 'JSON 输出不可解析。',
  }
}

export function inspectLocalOllamaOutput(text: string): LocalOllamaOutputGuard {
  const value = String(text || '')
  const issues: string[] = []
  const hasThinkTags = /<\/?think\b/iu.test(value)
  const hasSecretPattern = /\b(?:cookie|api[\s_-]?key|smtp|authorization|bearer\s+[a-z0-9._-]+)\b/iu.test(value)
  const hasLocalPath = /[A-Z]:\\Users\\|\.ollama\\models|ollama-models|Qwen3-8B-GGUF/iu.test(value)

  if (hasThinkTags) issues.push('输出仍包含 think 标签')
  if (hasSecretPattern) issues.push('输出疑似包含密钥、授权或 Cookie 字样')
  if (hasLocalPath) issues.push('输出疑似包含本机路径')

  return {
    ok: issues.length === 0,
    hasThinkTags,
    hasSecretPattern,
    hasLocalPath,
    outputChars: value.length,
    issues,
  }
}

export async function executeLocalOllamaRequest(
  plan: LocalModelRequestPlan,
  options: LocalOllamaAdapterOptions = {},
): Promise<LocalOllamaAdapterResult> {
  const now = options.now || Date.now
  const startedAt = now()
  const model = normalizeOllamaModelName(options.model || plan.model)
  const timeoutMs = Math.max(1000, Math.floor(options.timeoutMs || plan.timeoutMs || 120000))
  const params = resolveLocalOllamaParams(plan, options)

  if (plan.provider !== 'ollama') {
    return createErrorResult(plan, model, params, startedAt, now, {
      code: 'unsupported_provider',
      message: `当前 adapter 只支持 Ollama，请求 provider 为 ${plan.provider}。`,
    })
  }

  const fetchImpl = options.fetchImpl || getGlobalFetch()
  if (!fetchImpl) {
    return createErrorResult(plan, model, params, startedAt, now, {
      code: 'offline',
      message: '当前运行环境没有可用 fetch，无法连接 Ollama。',
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const body = createOllamaRequestBody(plan, {
      ...options,
      model,
      numCtx: params.numCtx,
      numPredict: params.numPredict,
      temperature: params.temperature,
      topP: params.topP,
    })
    const response = await fetchImpl(plan.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return createErrorResult(plan, model, params, startedAt, now, {
        code: 'http_error',
        status: response.status,
        message: `Ollama 返回 HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}。`,
      })
    }

    const payload = await response.json()
    const rawContent = extractOllamaContent(payload)
    if (rawContent === null) {
      return createErrorResult(plan, model, params, startedAt, now, {
        code: 'invalid_response',
        message: 'Ollama 响应中没有可用文本内容。',
        detail: safeStringify(payload).slice(0, 600),
      })
    }

    if (plan.responseFormat === 'json') {
      const parsed = parseLocalModelJson(rawContent)
      if (!parsed.ok) {
        return createErrorResult(plan, model, params, startedAt, now, {
          code: 'invalid_json',
          message: parsed.error || 'JSON 输出不可解析。',
          detail: parsed.cleaned.slice(0, 1200),
        }, rawContent)
      }
      const guard = inspectLocalOllamaOutput(parsed.cleaned)
      return {
        ok: guard.ok,
        adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
        artifact: plan.artifact,
        responseFormat: plan.responseFormat,
        model,
        endpoint: plan.endpoint,
        elapsedMs: Math.max(0, Math.round(now() - startedAt)),
        params,
        cacheKey: plan.cacheKey,
        content: parsed.cleaned,
        json: parsed.json,
        rawContent,
        guard,
        error: guard.ok
          ? undefined
          : {
              code: 'quality_guard_failed',
              message: guard.issues.join('；'),
            },
      }
    }

    const content = stripLocalModelThinkTags(rawContent)
    const guard = inspectLocalOllamaOutput(content)
    return {
      ok: guard.ok,
      adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
      artifact: plan.artifact,
      responseFormat: plan.responseFormat,
      model,
      endpoint: plan.endpoint,
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
      params,
      cacheKey: plan.cacheKey,
      content,
      rawContent,
      guard,
      error: guard.ok
        ? undefined
        : {
            code: 'quality_guard_failed',
            message: guard.issues.join('；'),
          },
    }
  } catch (error) {
    clearTimeout(timeout)
    const normalized = normalizeOllamaError(error)
    return createErrorResult(plan, model, params, startedAt, now, normalized)
  }
}

function createErrorResult(
  plan: LocalModelRequestPlan,
  model: string,
  params: Required<LocalOllamaGenerationOptions>,
  startedAt: number,
  now: () => number,
  error: LocalOllamaAdapterError,
  rawContent?: string,
): LocalOllamaAdapterResult {
  return {
    ok: false,
    adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
    artifact: plan.artifact,
    responseFormat: plan.responseFormat,
    model,
    endpoint: plan.endpoint,
    elapsedMs: Math.max(0, Math.round(now() - startedAt)),
    params,
    cacheKey: plan.cacheKey,
    rawContent,
    error,
  }
}

function getGlobalFetch(): LocalOllamaFetch | null {
  const candidate = globalThis.fetch
  if (typeof candidate !== 'function') return null
  return candidate as unknown as LocalOllamaFetch
}

function normalizeOllamaError(error: unknown): LocalOllamaAdapterError {
  if (isAbortError(error)) {
    return {
      code: 'timeout',
      message: 'Ollama 请求超时，已中止本次本地模型调用。',
      detail: getErrorMessage(error),
    }
  }

  const message = getErrorMessage(error)
  if (/ECONNREFUSED|fetch failed|Failed to fetch|connect|network|socket|UND_ERR_CONNECT_TIMEOUT/iu.test(message)) {
    return {
      code: 'offline',
      message: '无法连接 Ollama，本地模型服务可能未启动。',
      detail: message,
    }
  }

  return {
    code: 'invalid_response',
    message: '调用 Ollama 时出现未归类错误。',
    detail: message,
  }
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'name' in error && String((error as { name?: unknown }).name) === 'AbortError')
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error || 'unknown error')
}

function extractOllamaContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const response = payload as OllamaChatResponse
  if (typeof response.message?.content === 'string') return response.message.content
  if (typeof response.response === 'string') return response.response
  if (typeof response.error === 'string') return response.error
  return null
}

function safeJsonParse(text: string): {
  ok: boolean
  json?: unknown
  error?: string
} {
  try {
    return { ok: true, json: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: getErrorMessage(error) }
  }
}

function extractFirstJsonObject(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return ''
  return text.slice(start, end + 1)
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import {
  buildLocalConsumptionCacheKey,
  buildLocalModelRequestPlan,
  createDefaultLocalConsumptionProfile,
  getPromptVersionForArtifact,
  LOCAL_CONSUMPTION_ARTIFACT_PLAN,
  LOCAL_CONSUMPTION_SCHEMA_VERSION,
  type LocalConsumptionArtifactKind,
  type LocalConsumptionProfile,
  type LocalModelRequestPlan,
} from '../../src/domain/localConsumption.ts'
import {
  executeLocalOllamaRequest,
  LOCAL_OLLAMA_ADAPTER_VERSION,
  DEFAULT_LOCAL_OLLAMA_MODEL,
  resolveLocalOllamaParams,
  stripLocalModelThinkTags,
  type LocalOllamaAdapterResult,
} from './localOllamaAdapter.ts'
import { isPathInsideRoot } from './pathSafety.ts'

export type LocalConsumptionRunnerOptions = {
  endpoint?: string
  model?: string
  force?: boolean
  appendRuntimeLog?: (message: string) => void
}

export type LocalConsumptionRunnerResult = {
  status: 'ok' | 'needs_review' | 'failed'
  materialPath: string
  runMetaPath: string
  elapsedMs: number
  model: string
  artifacts: Record<LocalConsumptionArtifactKind, {
    status: 'ok' | 'failed'
    elapsedMs: number
    outputPath?: string
    error?: unknown
  }>
  quality?: {
    ok?: boolean
    riskLevel?: string
    issues?: unknown[]
    missingCriticalTerms?: unknown[]
    reason?: string
  } | null
  error?: string
}

type MaterialContext = {
  materialPath: string
  manifestPath: string
  manifest: Record<string, unknown>
  title: string
  creator: string
  sourceId: string
  upId: string
  videoId: string
  notebooklmMarkdown: string
  rawTranscriptText: string
  notebooklmSha1: string
  rawTranscriptSha1: string
  profile: LocalConsumptionProfile
  criticalTerms: string[]
}

const DEFAULT_LOCAL_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/api/chat'

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function writeJson(filePath: string, payload: unknown, materialPath: string) {
  assertInsideMaterial(filePath, materialPath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

function writeText(filePath: string, text: string, materialPath: string) {
  assertInsideMaterial(filePath, materialPath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, String(text || '').trimEnd() + '\n', 'utf-8')
}

function assertInsideMaterial(filePath: string, materialPath: string) {
  if (!isPathInsideRoot(path.resolve(filePath), path.resolve(materialPath))) {
    throw new Error(`本地总结拒绝写入材料包之外的路径：${filePath}`)
  }
}

function sha1(text: string) {
  return createHash('sha1').update(String(text || '')).digest('hex')
}

function pickCriticalTerms(text: string) {
  return Array.from(new Set((String(text || '').match(/(?:19|20)\d{2}年?|\d+(?:\.\d+)?%|[A-Za-z][A-Za-z0-9.+-]{2,}|[\u4e00-\u9fa5]{2,}(?:模型|版本|芯片|框架|接口|按钮|命令|路径)/gu) || []).slice(0, 80)))
}

function loadMaterialContext(materialPathInput: string): MaterialContext {
  const materialPath = path.resolve(materialPathInput)
  const manifestPath = path.join(materialPath, 'manifest.json')
  const manifest = readJson(manifestPath)
  if (!manifest) throw new Error('本地总结失败：资料包缺少 manifest.json。')

  const normalizedNotebooklmPath = path.join(materialPath, 'exports', 'notebooklm.md')
  const rawPath = path.join(materialPath, 'raw_transcript.txt')
  if (!fs.existsSync(normalizedNotebooklmPath)) throw new Error('本地总结失败：资料包缺少 exports/notebooklm.md。')

  const source = manifest.source && typeof manifest.source === 'object'
    ? manifest.source as Record<string, unknown>
    : {}
  const title = String(source.title || path.basename(materialPath))
  const creator = String(source.creator || '未知 UP')
  const sourceId = String(source.source_id || path.basename(materialPath))
  const upId = path.basename(path.dirname(materialPath))
  const videoId = path.basename(materialPath)
  const notebooklmMarkdown = fs.readFileSync(normalizedNotebooklmPath, 'utf-8')
  const rawTranscriptText = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf-8') : ''
  const profile = createDefaultLocalConsumptionProfile({ upId, name: creator })

  return {
    materialPath,
    manifestPath,
    manifest,
    title,
    creator,
    sourceId,
    upId,
    videoId,
    notebooklmMarkdown,
    rawTranscriptText,
    notebooklmSha1: sha1(notebooklmMarkdown),
    rawTranscriptSha1: rawTranscriptText ? sha1(rawTranscriptText) : '',
    profile,
    criticalTerms: pickCriticalTerms(`${rawTranscriptText}\n${notebooklmMarkdown}`),
  }
}

function artifactOutputPath(materialPath: string, artifact: LocalConsumptionArtifactKind) {
  if (artifact === 'brief') return path.join(materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefPath)
  if (artifact === 'email') return path.join(materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailPath)
  if (artifact === 'decision') return path.join(materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.decisionPath)
  return path.join(materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.qualityCheckPath)
}

function artifactMetaPath(materialPath: string, artifact: LocalConsumptionArtifactKind) {
  if (artifact === 'brief') return path.join(materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefMetaPath)
  if (artifact === 'email') return path.join(materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailStatusPath)
  if (artifact === 'decision') return path.join(materialPath, 'delivery', 'decision.meta.json')
  return path.join(materialPath, 'work', 'quality', 'local_check.meta.json')
}

function localCacheKey(options: {
  artifact: LocalConsumptionArtifactKind
  notebooklmSha1: string
  rawTranscriptSha1: string
  briefSha1?: string
  profile: LocalConsumptionProfile
  model: string
}) {
  const base = buildLocalConsumptionCacheKey({
    artifact: options.artifact,
    notebooklmSha1: options.notebooklmSha1,
    rawTranscriptSha1: options.rawTranscriptSha1,
    briefSha1: options.briefSha1,
    profileHash: options.profile.profileHash,
    localModelName: options.model,
    promptVersion: getPromptVersionForArtifact(options.artifact),
  })
  const params = resolveLocalOllamaParams({
    responseFormat: options.artifact === 'brief' || options.artifact === 'email' ? 'markdown' : 'json',
  })
  return [
    base,
    LOCAL_OLLAMA_ADAPTER_VERSION,
    `ctx${params.numCtx}`,
    `predict${params.numPredict}`,
    `temp${params.temperature}`,
    `topP${params.topP}`,
  ].join('|')
}

function validateDecisionPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.worthEmail === 'boolean' &&
    typeof item.importance === 'number' &&
    item.importance >= 1 &&
    item.importance <= 5 &&
    typeof item.reason === 'string' &&
    Array.isArray(item.tags)
}

function validateQualityPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.ok === 'boolean' &&
    typeof item.riskLevel === 'string' &&
    ['low', 'medium', 'high'].includes(item.riskLevel) &&
    Array.isArray(item.issues) &&
    Array.isArray(item.missingCriticalTerms) &&
    typeof item.reason === 'string'
}

function validateArtifactPayload(artifact: LocalConsumptionArtifactKind, value: unknown) {
  if (artifact === 'decision') return validateDecisionPayload(value)
  if (artifact === 'quality_check') return validateQualityPayload(value)
  return true
}

function inspectMarkdownArtifact(options: {
  artifact: LocalConsumptionArtifactKind
  content: string
  notebooklmMarkdown: string
}) {
  const text = stripLocalModelThinkTags(options.content || '').trim()
  const issues: string[] = []
  const minChars = options.artifact === 'brief'
    ? Math.min(1200, Math.max(600, Math.floor(options.notebooklmMarkdown.length * 0.16)))
    : 500
  const selfTalkPattern = /(?:我现在需要|首先[,，]?我(?:会|要)|接下来[,，]?我|用户希望|用户要求|我会通读|我需要确保|需要注意的是|现在我来|下面我将|我要仔细阅读)/u
  const hasHeading = /^#{1,3}\s+\S+/mu.test(text)
  const lastNonSpace = text.trim().slice(-1)
  const endsCleanly = /[。！？.!?）)”》】\]`]$/u.test(lastNonSpace)

  if (selfTalkPattern.test(text.slice(0, 900))) issues.push('输出包含模型自我分析或执行计划')
  if (text.length < minChars) issues.push(`输出过短：${text.length}/${minChars} 字符`)
  if (!hasHeading) issues.push('输出缺少 Markdown 标题结构')
  if (!endsCleanly) issues.push('输出疑似在半句话处截断')

  return {
    ok: issues.length === 0,
    issues,
    outputChars: text.length,
    minChars,
  }
}

function createMarkdownValidationError(options: {
  artifact: LocalConsumptionArtifactKind
  content: string
  source: MaterialContext
}) {
  if (options.artifact !== 'brief' && options.artifact !== 'email') return null
  const guard = inspectMarkdownArtifact({
    artifact: options.artifact,
    content: options.content,
    notebooklmMarkdown: options.source.notebooklmMarkdown,
  })
  if (guard.ok) return null
  return {
    code: 'quality_guard_failed',
    message: `${options.artifact} Markdown 未通过成稿检查：${guard.issues.join('；')}`,
    guard,
  }
}

function artifactSchemaDescription(artifact: LocalConsumptionArtifactKind) {
  if (artifact === 'decision') {
    return '{"worthEmail":boolean,"importance":1|2|3|4|5,"reason":"60字以内中文原因","tags":["1到4个短标签"]}'
  }
  if (artifact === 'quality_check') {
    return '{"ok":boolean,"riskLevel":"low|medium|high","issues":["问题短句"],"missingCriticalTerms":["缺失术语"],"reason":"80字以内中文原因"}'
  }
  return ''
}

function createSchemaError(artifact: LocalConsumptionArtifactKind) {
  return {
    code: 'quality_guard_failed',
    message: artifact === 'decision'
      ? 'decision JSON 缺少 worthEmail / importance / reason / tags 必需字段。'
      : 'quality_check JSON 缺少 ok / riskLevel / issues / missingCriticalTerms / reason 必需字段。',
  }
}

function createJsonRepairPlan(options: {
  artifact: LocalConsumptionArtifactKind
  source: MaterialContext
  cacheKey: string
  rawContent: string
  validationError: unknown
  endpoint: string
  model: string
}): LocalModelRequestPlan {
  const schema = artifactSchemaDescription(options.artifact)
  return {
    schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
    artifact: options.artifact,
    promptVersion: `${getPromptVersionForArtifact(options.artifact)}.repair.v0.1`,
    provider: 'ollama',
    endpoint: options.endpoint,
    model: options.model,
    responseFormat: 'json',
    timeoutMs: 60000,
    cacheKey: `${options.cacheKey}|json-repair`,
    messages: [
      {
        role: 'system',
        content: '你是“视界专注”的 JSON 修复器。只输出一个符合 schema 的 JSON 对象，不解释，不补充事实。',
      },
      {
        role: 'user',
        content: [
          `目标产物：${options.artifact}`,
          `标题：${options.source.title}`,
          `UP 主：${options.source.creator}`,
          `来源编号：${options.source.sourceId}`,
          `失败原因：${JSON.stringify(options.validationError).slice(0, 400)}`,
          `目标 schema：${schema}`,
          '',
          '失败输出预览：',
          stripLocalModelThinkTags(options.rawContent || '').slice(0, 2200),
          '',
          `最终只输出 JSON：${schema}`,
        ].join('\n'),
      },
    ],
  }
}

function createMarkdownRepairPlan(options: {
  artifact: LocalConsumptionArtifactKind
  source: MaterialContext
  cacheKey: string
  briefMarkdown?: string
  rawContent: string
  validationError: unknown
  endpoint: string
  model: string
}): LocalModelRequestPlan {
  const isEmail = options.artifact === 'email'
  return {
    schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
    artifact: options.artifact,
    promptVersion: `${getPromptVersionForArtifact(options.artifact)}.repair.v0.1`,
    provider: 'ollama',
    endpoint: options.endpoint,
    model: options.model,
    responseFormat: 'markdown',
    timeoutMs: 300000,
    cacheKey: `${options.cacheKey}|markdown-repair`,
    messages: [
      {
        role: 'system',
        content: [
          '你是“视界专注”的正式成稿器，只输出最终 Markdown 成品。',
          '禁止输出思考过程、执行计划、任务复述、用户需求分析、提示词分析。',
          '不要使用“我现在需要”“首先我会”“用户希望”“接下来我将”等过程性表达。',
          '必须完整收尾，不能在半句话处结束。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `目标产物：${options.artifact}`,
          `标题：${options.source.title}`,
          `UP 主：${options.source.creator}`,
          `来源编号：${options.source.sourceId}`,
          `上次失败原因：${JSON.stringify(options.validationError).slice(0, 600)}`,
          '',
          isEmail
            ? '请根据下面的本地简报重新生成一封邮件草稿。'
            : '请根据下面的 NotebookLM 主资料重新生成本地简报。',
          isEmail
            ? '输出结构：# 视频更新；为什么值得看；核心要点；是否值得完整回看。至少 500 个中文字符。'
            : '输出结构：# 本地总结稿；一句话结论；主要议题；关键事实与案例；作者判断；可以沉淀到知识库的要点。至少 1200 个中文字符。',
          '只输出最终 Markdown 成品。',
          '',
          isEmail ? '本地简报：' : 'NotebookLM 主资料：',
          stripLocalModelThinkTags(isEmail ? options.briefMarkdown || '' : options.source.notebooklmMarkdown || '').slice(0, isEmail ? 7000 : 16000),
          '',
          '上次失败输出预览，仅用于避坑，不要续写它：',
          stripLocalModelThinkTags(options.rawContent || '').slice(0, 1200),
        ].join('\n'),
      },
    ],
  }
}

function summarizeAttempt(label: string, result: LocalOllamaAdapterResult, validationError: unknown) {
  return {
    label,
    status: result.ok && !validationError ? 'ok' : 'failed',
    elapsedMs: result.elapsedMs,
    error: validationError || result.error || null,
    outputChars: String(result.content || '').length,
  }
}

async function runArtifact(options: {
  artifact: LocalConsumptionArtifactKind
  context: MaterialContext
  endpoint: string
  model: string
  cacheKey: string
  briefMarkdown?: string
  briefSha1?: string
}) {
  const plan = buildLocalModelRequestPlan({
    artifact: options.artifact,
    title: options.context.title,
    creator: options.context.creator,
    sourceId: options.context.sourceId,
    notebooklmMarkdown: options.context.notebooklmMarkdown,
    briefMarkdown: options.briefMarkdown,
    rawTranscriptText: options.context.rawTranscriptText,
    criticalTerms: options.context.criticalTerms,
    profile: options.context.profile,
    cacheKey: options.cacheKey,
    contentBudgetChars: options.artifact === 'brief' ? 16000 : 7000,
  }, {
    provider: 'ollama',
    endpoint: options.endpoint,
    model: options.model,
    timeoutMs: options.artifact === 'brief' ? 300000 : 180000,
  })

  const attempts = []
  const markdownOptions = options.artifact === 'brief'
    ? { numCtx: 12288, numPredict: 4096, timeoutMs: 300000 }
    : options.artifact === 'email'
      ? { numCtx: 8192, numPredict: 2048, timeoutMs: 180000 }
      : {}
  let result = await executeLocalOllamaRequest(plan, markdownOptions)
  let validationError = result.ok
    ? (options.artifact === 'brief' || options.artifact === 'email'
        ? createMarkdownValidationError({
            artifact: options.artifact,
            content: result.content || '',
            source: options.context,
          })
        : !validateArtifactPayload(options.artifact, result.json)
          ? createSchemaError(options.artifact)
          : null)
    : null
  attempts.push(summarizeAttempt('initial', result, validationError))

  if ((options.artifact === 'brief' || options.artifact === 'email') && validationError) {
    const repairResult = await executeLocalOllamaRequest(createMarkdownRepairPlan({
      artifact: options.artifact,
      source: options.context,
      cacheKey: options.cacheKey,
      briefMarkdown: options.briefMarkdown,
      rawContent: result.rawContent || result.content || '',
      validationError,
      endpoint: options.endpoint,
      model: options.model,
    }), {
      numCtx: options.artifact === 'brief' ? 12288 : 8192,
      numPredict: options.artifact === 'brief' ? 4096 : 2048,
      timeoutMs: options.artifact === 'brief' ? 300000 : 180000,
    })
    const repairValidationError = repairResult.ok
      ? createMarkdownValidationError({
          artifact: options.artifact,
          content: repairResult.content || '',
          source: options.context,
        })
      : null
    attempts.push(summarizeAttempt('markdown_repair', repairResult, repairValidationError))
    result = repairResult
    validationError = repairValidationError
  }

  if ((options.artifact === 'decision' || options.artifact === 'quality_check') && (validationError || result.error?.code === 'invalid_json')) {
    const repairResult = await executeLocalOllamaRequest(createJsonRepairPlan({
      artifact: options.artifact,
      source: options.context,
      cacheKey: options.cacheKey,
      rawContent: result.rawContent || result.content || '',
      validationError,
      endpoint: options.endpoint,
      model: options.model,
    }), {
      numPredict: 256,
      timeoutMs: 60000,
    })
    const repairValidationError = repairResult.ok && !validateArtifactPayload(options.artifact, repairResult.json)
      ? createSchemaError(options.artifact)
      : null
    attempts.push(summarizeAttempt('json_repair', repairResult, repairValidationError))
    result = repairResult
    validationError = repairValidationError
  }

  const outputPath = artifactOutputPath(options.context.materialPath, options.artifact)
  const metaPath = artifactMetaPath(options.context.materialPath, options.artifact)
  const meta = {
    schemaVersion: LOCAL_CONSUMPTION_ARTIFACT_PLAN.schemaVersion,
    adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
    artifact: options.artifact,
    status: result.ok && !validationError ? 'ok' : 'failed',
    model: result.model,
    endpoint: result.endpoint,
    elapsedMs: result.elapsedMs,
    params: result.params,
    cacheKey: options.cacheKey,
    notebooklmSha1: options.context.notebooklmSha1,
    rawTranscriptSha1: options.context.rawTranscriptSha1,
    briefSha1: options.briefSha1,
    guard: result.guard,
    attempts,
    retryCount: Math.max(0, attempts.length - 1),
    error: validationError || result.error,
  }

  if (!result.ok || validationError) {
    writeJson(metaPath, {
      ...meta,
      outputPreview: stripLocalModelThinkTags(result.rawContent || '').slice(0, 2000),
    }, options.context.materialPath)
    return {
      status: 'failed' as const,
      cacheKey: options.cacheKey,
      elapsedMs: result.elapsedMs,
      attempts,
      retryCount: Math.max(0, attempts.length - 1),
      error: validationError || result.error,
    }
  }

  if (options.artifact === 'brief' || options.artifact === 'email') {
    writeText(outputPath, result.content || '', options.context.materialPath)
  } else {
    writeJson(outputPath, result.json, options.context.materialPath)
  }
  writeJson(metaPath, meta, options.context.materialPath)
  return {
    status: 'ok' as const,
    cacheKey: options.cacheKey,
    elapsedMs: result.elapsedMs,
    attempts,
    retryCount: Math.max(0, attempts.length - 1),
    outputChars: options.artifact === 'brief' || options.artifact === 'email'
      ? String(result.content || '').length
      : JSON.stringify(result.json || {}).length,
    outputPath: path.relative(options.context.materialPath, outputPath).replace(/\\/gu, '/'),
  }
}

function readCompletedRunMeta(context: MaterialContext, cacheKeys: Record<string, string>, model: string) {
  const metaPath = path.join(context.materialPath, 'work', 'local_consumption', 'run_meta.json')
  const meta = readJson(metaPath)
  if (!meta || meta.status === 'failed') return null
  if (meta.model !== model || meta.adapterVersion !== LOCAL_OLLAMA_ADAPTER_VERSION) return null
  const artifacts = meta.artifacts && typeof meta.artifacts === 'object'
    ? meta.artifacts as Record<string, Record<string, unknown>>
    : {}
  for (const [artifact, cacheKey] of Object.entries(cacheKeys)) {
    if (artifacts[artifact]?.cacheKey !== cacheKey || artifacts[artifact]?.status !== 'ok') return null
  }
  return meta
}

function updateManifest(context: MaterialContext, runMeta: Record<string, unknown>, quality: Record<string, unknown> | null) {
  const manifest = {
    ...context.manifest,
    files: {
      ...((context.manifest.files && typeof context.manifest.files === 'object') ? context.manifest.files as Record<string, unknown> : {}),
      local_brief: LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefPath,
      local_email: LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailPath,
      local_decision: LOCAL_CONSUMPTION_ARTIFACT_PLAN.decisionPath,
      local_email_status: LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailStatusPath,
      local_quality_check: LOCAL_CONSUMPTION_ARTIFACT_PLAN.qualityCheckPath,
      local_consumption_meta: 'work/local_consumption/run_meta.json',
    },
    local_consumption: {
      schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
      status: runMeta.status,
      model: runMeta.model,
      endpoint: runMeta.endpoint,
      profile: runMeta.profile,
      artifacts: runMeta.artifacts,
      quality,
      paths: {
        brief: LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefPath,
        email: LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailPath,
        decision: LOCAL_CONSUMPTION_ARTIFACT_PLAN.decisionPath,
        quality_check: LOCAL_CONSUMPTION_ARTIFACT_PLAN.qualityCheckPath,
        run_meta: 'work/local_consumption/run_meta.json',
      },
      generatedAt: runMeta.generatedAt,
    },
  }
  writeJson(context.manifestPath, manifest, context.materialPath)
}

function updateMetrics(context: MaterialContext, runMeta: Record<string, unknown>, quality: Record<string, unknown> | null) {
  const metricsPath = path.join(context.materialPath, 'metrics.json')
  const payload = readJson(metricsPath) || {}
  const stages = payload.stages && typeof payload.stages === 'object' ? payload.stages as Record<string, unknown> : {}
  const artifacts = runMeta.artifacts && typeof runMeta.artifacts === 'object'
    ? runMeta.artifacts as Record<string, { elapsedMs?: unknown; status?: unknown }>
    : {}
  const elapsedMs = Object.values(artifacts).reduce((sum, item) => sum + (Number(item.elapsedMs ?? 0) || 0), 0)
  const status = String(runMeta.status || 'failed')
  stages.local_consumption = {
    status,
    started_at: runMeta.startedAt,
    finished_at: runMeta.generatedAt,
    elapsed_seconds: Math.round(elapsedMs) / 1000,
    model: runMeta.model,
    artifact_elapsed_ms: Object.fromEntries(Object.entries(artifacts).map(([key, item]) => [key, Number(item.elapsedMs ?? 0) || 0])),
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, item]) => [key, String(item.status || 'missing')])),
    quality: quality
      ? {
          ok: Boolean(quality.ok),
          riskLevel: String(quality.riskLevel || ''),
          issueCount: Array.isArray(quality.issues) ? quality.issues.length : 0,
          missingCriticalTermCount: Array.isArray(quality.missingCriticalTerms) ? quality.missingCriticalTerms.length : 0,
        }
      : null,
  }
  writeJson(metricsPath, {
    ...payload,
    stages,
  }, context.materialPath)
}

function updateRunState(context: MaterialContext, runMeta: Record<string, unknown>, quality: Record<string, unknown> | null) {
  const runStatePath = path.join(context.materialPath, 'run_state.json')
  const existing = readJson(runStatePath) || {}
  const localStatus = String(runMeta.status || 'failed')
  const qualityRisk = String(quality?.riskLevel || '')
  const stage = localStatus === 'ok' && quality?.ok !== false
    ? 'local_consumption_ready'
    : localStatus === 'needs_review' || localStatus === 'ok'
      ? 'local_consumption_needs_review'
      : 'local_consumption_failed'
  const steps = Array.isArray(existing.steps) ? existing.steps.filter((step) => {
    return !(step && typeof step === 'object' && (step as Record<string, unknown>).id === 'local_consumption')
  }) : []
  steps.push({
    id: 'local_consumption',
    label: '本地总结',
    status: stage === 'local_consumption_failed' ? 'failed' : stage === 'local_consumption_needs_review' ? 'needs_review' : 'done',
    output: 'exports/brief.local.md, delivery/email.md, delivery/decision.json, work/quality/local_check.json',
  })
  const existingCompletedStages = Array.isArray(existing.completed_stages) ? existing.completed_stages : []
  const completedStages = stage === 'local_consumption_failed'
    ? existingCompletedStages.filter((item) => item !== 'local_consumption')
    : Array.from(new Set([...existingCompletedStages, 'local_consumption']))

  writeJson(runStatePath, {
    ...existing,
    stage,
    stage_label: stage === 'local_consumption_ready'
      ? '本地总结完成'
      : stage === 'local_consumption_needs_review'
        ? '本地总结需复核'
        : '本地总结失败',
    current_stage: stage,
    completed_stages: completedStages,
    next_action: stage === 'local_consumption_needs_review'
      ? `本地 quality_check 标记为 ${qualityRisk || '风险'}，建议人工复核 brief 和 NotebookLM 主资料。`
      : stage === 'local_consumption_failed'
        ? 'NotebookLM 主资料已保留；本地总结失败，可稍后重试。'
        : '本地 brief/email/decision/quality 已生成，可进入阅读或后续推送决策。',
    local_consumption_ready: stage === 'local_consumption_ready',
    local_consumption_status: stage,
    local_consumption_quality: quality,
    paths: {
      ...((existing.paths && typeof existing.paths === 'object') ? existing.paths as Record<string, unknown> : {}),
      local_brief: path.join(context.materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefPath),
      local_email: path.join(context.materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailPath),
      local_decision: path.join(context.materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.decisionPath),
      local_quality_check: path.join(context.materialPath, LOCAL_CONSUMPTION_ARTIFACT_PLAN.qualityCheckPath),
      local_consumption_meta: path.join(context.materialPath, 'work', 'local_consumption', 'run_meta.json'),
    },
    steps,
  }, context.materialPath)
}

export async function runLocalConsumptionForMaterial(
  materialPath: string,
  options: LocalConsumptionRunnerOptions = {},
): Promise<LocalConsumptionRunnerResult> {
  const startedAt = Date.now()
  const context = loadMaterialContext(materialPath)
  const endpoint = options.endpoint || process.env.LOCAL_OLLAMA_ENDPOINT || DEFAULT_LOCAL_OLLAMA_ENDPOINT
  const model = options.model || process.env.LOCAL_OLLAMA_MODEL || DEFAULT_LOCAL_OLLAMA_MODEL
  const runMetaPath = path.join(context.materialPath, 'work', 'local_consumption', 'run_meta.json')
  const briefCacheKey = localCacheKey({
    artifact: 'brief',
    notebooklmSha1: context.notebooklmSha1,
    rawTranscriptSha1: context.rawTranscriptSha1,
    profile: context.profile,
    model,
  })
  const decisionCacheKey = localCacheKey({
    artifact: 'decision',
    notebooklmSha1: context.notebooklmSha1,
    rawTranscriptSha1: context.rawTranscriptSha1,
    profile: context.profile,
    model,
  })
  const qualityCacheKey = localCacheKey({
    artifact: 'quality_check',
    notebooklmSha1: context.notebooklmSha1,
    rawTranscriptSha1: context.rawTranscriptSha1,
    profile: context.profile,
    model,
  })
  const completed = options.force ? null : readCompletedRunMeta(context, {
    brief: briefCacheKey,
    decision: decisionCacheKey,
    quality_check: qualityCacheKey,
  }, model)
  if (completed) {
    const quality = (completed.quality as LocalConsumptionRunnerResult['quality']) || null
    updateManifest(context, completed, quality as Record<string, unknown> | null)
    updateMetrics(context, completed, quality as Record<string, unknown> | null)
    updateRunState(context, completed, quality as Record<string, unknown> | null)
    return {
      status: completed.status === 'ok' ? 'ok' : completed.status === 'needs_review' ? 'needs_review' : 'failed',
      materialPath: context.materialPath,
      runMetaPath,
      elapsedMs: 0,
      model,
      artifacts: completed.artifacts as LocalConsumptionRunnerResult['artifacts'],
      quality,
    }
  }

  const artifacts: LocalConsumptionRunnerResult['artifacts'] = {
    brief: { status: 'failed', elapsedMs: 0 },
    email: { status: 'failed', elapsedMs: 0 },
    decision: { status: 'failed', elapsedMs: 0 },
    quality_check: { status: 'failed', elapsedMs: 0 },
  }

  try {
    artifacts.brief = await runArtifact({
      artifact: 'brief',
      context,
      endpoint,
      model,
      cacheKey: briefCacheKey,
    })

    const briefPath = artifactOutputPath(context.materialPath, 'brief')
    const briefMarkdown = artifacts.brief.status === 'ok' && fs.existsSync(briefPath)
      ? fs.readFileSync(briefPath, 'utf-8')
      : ''
    const briefSha1 = briefMarkdown ? sha1(briefMarkdown) : ''
    const emailCacheKey = localCacheKey({
      artifact: 'email',
      notebooklmSha1: context.notebooklmSha1,
      rawTranscriptSha1: context.rawTranscriptSha1,
      briefSha1,
      profile: context.profile,
      model,
    })

    artifacts.email = briefMarkdown
      ? await runArtifact({
          artifact: 'email',
          context,
          endpoint,
          model,
          cacheKey: emailCacheKey,
          briefMarkdown,
          briefSha1,
        })
      : {
          status: 'failed',
          elapsedMs: 0,
          error: { code: 'quality_guard_failed', message: 'brief 未生成，跳过 email。' },
        }

    artifacts.decision = await runArtifact({
      artifact: 'decision',
      context,
      endpoint,
      model,
      cacheKey: decisionCacheKey,
    })

    artifacts.quality_check = await runArtifact({
      artifact: 'quality_check',
      context,
      endpoint,
      model,
      cacheKey: qualityCacheKey,
    })

    const quality = readJson(artifactOutputPath(context.materialPath, 'quality_check'))
    const allArtifactsOk = Object.values(artifacts).every((artifact) => artifact.status === 'ok')
    const status: LocalConsumptionRunnerResult['status'] = !allArtifactsOk
      ? 'failed'
      : quality?.ok === false || String(quality?.riskLevel || '').toLowerCase() === 'high'
        ? 'needs_review'
        : 'ok'
    const runMeta = {
      schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
      adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
      status,
      model,
      endpoint,
      sourceMaterialDir: context.materialPath,
      materialPath: context.materialPath,
      title: context.title,
      creator: context.creator,
      sourceId: context.sourceId,
      profile: context.profile,
      notebooklmSha1: context.notebooklmSha1,
      rawTranscriptSha1: context.rawTranscriptSha1,
      artifacts,
      quality,
      startedAt: new Date(startedAt).toISOString(),
      generatedAt: new Date().toISOString(),
    }
    writeJson(runMetaPath, runMeta, context.materialPath)
    updateManifest(context, runMeta, quality)
    updateMetrics(context, runMeta, quality)
    updateRunState(context, runMeta, quality)
    options.appendRuntimeLog?.(`local consumption ${status} materialPath=${context.materialPath}`)
    return {
      status,
      materialPath: context.materialPath,
      runMetaPath,
      elapsedMs: Date.now() - startedAt,
      model,
      artifacts,
      quality,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const runMeta = {
      schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
      adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
      status: 'failed',
      model,
      endpoint,
      sourceMaterialDir: context.materialPath,
      materialPath: context.materialPath,
      title: context.title,
      creator: context.creator,
      sourceId: context.sourceId,
      profile: context.profile,
      notebooklmSha1: context.notebooklmSha1,
      rawTranscriptSha1: context.rawTranscriptSha1,
      artifacts,
      error: message,
      startedAt: new Date(startedAt).toISOString(),
      generatedAt: new Date().toISOString(),
    }
    writeJson(runMetaPath, runMeta, context.materialPath)
    updateManifest(context, runMeta, null)
    updateMetrics(context, runMeta, null)
    updateRunState(context, runMeta, null)
    options.appendRuntimeLog?.(`local consumption failed materialPath=${context.materialPath} message=${message}`)
    return {
      status: 'failed',
      materialPath: context.materialPath,
      runMetaPath,
      elapsedMs: Date.now() - startedAt,
      model,
      artifacts,
      error: message,
    }
  }
}

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
} from '../src/domain/localConsumption.ts'
import {
  DEFAULT_LOCAL_OLLAMA_MODEL,
  executeLocalOllamaRequest,
  LOCAL_OLLAMA_ADAPTER_VERSION,
  resolveLocalOllamaParams,
  stripLocalModelThinkTags,
} from '../electron/services/localOllamaAdapter.ts'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const sampleRoot = path.join(repoRoot, 'data', 'temp', 'local-ollama-samples')
const reportRoot = path.join(sampleRoot, '_reports')
const modelName = process.env.LOCAL_OLLAMA_MODEL || DEFAULT_LOCAL_OLLAMA_MODEL
const endpoint = process.env.LOCAL_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/api/chat'
const force = process.argv.includes('--force')
const samplesPerUp = Math.max(1, Number(process.env.LOCAL_OLLAMA_SAMPLES_PER_UP || 1))

const candidates = discoverCandidateMaterialDirs()

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function sha1(text) {
  return createHash('sha1').update(String(text || '')).digest('hex')
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function assertInsideSampleRoot(filePath) {
  const resolvedRoot = path.resolve(sampleRoot)
  const resolvedPath = path.resolve(filePath)
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`拒绝写入临时样本目录之外的路径：${resolvedPath}`)
  }
}

function writeText(filePath, text) {
  assertInsideSampleRoot(filePath)
  ensureDirFor(filePath)
  fs.writeFileSync(filePath, String(text || '').trimEnd() + '\n', 'utf-8')
}

function writeJson(filePath, payload) {
  assertInsideSampleRoot(filePath)
  ensureDirFor(filePath)
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

function discoverCandidateMaterialDirs() {
  const materialsRoot = path.join(repoRoot, 'data', 'materials')
  if (!fs.existsSync(materialsRoot)) return []

  const grouped = new Map()
  for (const upEntry of fs.readdirSync(materialsRoot, { withFileTypes: true })) {
    if (!upEntry.isDirectory()) continue
    const upDir = path.join(materialsRoot, upEntry.name)
    for (const videoEntry of fs.readdirSync(upDir, { withFileTypes: true })) {
      if (!videoEntry.isDirectory()) continue
      const materialDir = path.join(upDir, videoEntry.name)
      const notebookPath = path.join(materialDir, 'exports', 'notebooklm.md')
      const manifestPath = path.join(materialDir, 'manifest.json')
      if (!fs.existsSync(notebookPath) || !fs.existsSync(manifestPath)) continue
      const manifest = readJson(manifestPath) || {}
      const source = manifest.source || {}
      const stats = fs.statSync(notebookPath)
      const item = {
        materialDir,
        upId: upEntry.name,
        videoId: videoEntry.name,
        title: String(source.title || videoEntry.name),
        creator: String(source.creator || '未知 UP'),
        sourceId: String(source.source_id || videoEntry.name),
        updatedAt: Date.parse(source.ingested_at || stats.mtime.toISOString()) || stats.mtimeMs,
        textLength: Number(manifest.text_length || 0),
      }
      if (!grouped.has(item.upId)) grouped.set(item.upId, [])
      grouped.get(item.upId).push(item)
    }
  }

  return Array.from(grouped.values())
    .flatMap((items) => items
      .sort((a, b) => {
        const byTime = b.updatedAt - a.updatedAt
        if (byTime !== 0) return byTime
        return b.textLength - a.textLength
      })
      .slice(0, samplesPerUp))
    .sort((a, b) => a.creator.localeCompare(b.creator, 'zh-CN'))
    .map((item) => item.materialDir)
}

function pickCriticalTerms(text) {
  return Array.from(new Set((String(text || '').match(/(?:19|20)\d{2}年?|\d+(?:\.\d+)?%|[A-Za-z][A-Za-z0-9.+-]{2,}|[\u4e00-\u9fa5]{2,}(?:模型|版本|芯片|框架|接口|按钮|命令|路径)/gu) || []).slice(0, 80)))
}

function localCacheKey(options) {
  const base = buildLocalConsumptionCacheKey({
    artifact: options.artifact,
    notebooklmSha1: options.notebooklmSha1,
    rawTranscriptSha1: options.rawTranscriptSha1,
    briefSha1: options.briefSha1,
    profileHash: options.profile.profileHash,
    localModelName: modelName,
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

function validateDecisionPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value
  return typeof item.worthEmail === 'boolean' &&
    typeof item.importance === 'number' &&
    item.importance >= 1 &&
    item.importance <= 5 &&
    typeof item.reason === 'string' &&
    Array.isArray(item.tags)
}

function validateQualityPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value
  return typeof item.ok === 'boolean' &&
    typeof item.riskLevel === 'string' &&
    ['low', 'medium', 'high'].includes(item.riskLevel) &&
    Array.isArray(item.issues) &&
    Array.isArray(item.missingCriticalTerms) &&
    typeof item.reason === 'string'
}

function validateArtifactPayload(artifact, value) {
  if (artifact === 'decision') return validateDecisionPayload(value)
  if (artifact === 'quality_check') return validateQualityPayload(value)
  return true
}

function artifactSchemaDescription(artifact) {
  if (artifact === 'decision') {
    return '{"worthEmail":boolean,"importance":1|2|3|4|5,"reason":"60字以内中文原因","tags":["1到4个短标签"]}'
  }
  if (artifact === 'quality_check') {
    return '{"ok":boolean,"riskLevel":"low|medium|high","issues":["问题短句"],"missingCriticalTerms":["缺失术语"],"reason":"80字以内中文原因"}'
  }
  return ''
}

function createSchemaError(artifact) {
  if (artifact === 'decision') {
    return {
      code: 'quality_guard_failed',
      message: 'decision JSON 缺少 worthEmail / importance / reason / tags 必需字段。',
    }
  }
  return {
    code: 'quality_guard_failed',
    message: 'quality_check JSON 缺少 ok / riskLevel / issues / missingCriticalTerms / reason 必需字段。',
  }
}

function shouldRetryJsonArtifact(artifact, result, validationError) {
  if (artifact !== 'decision' && artifact !== 'quality_check') return false
  if (validationError) return true
  return result.error?.code === 'invalid_json'
}

function summarizeAttempt(label, result, validationError) {
  return {
    label,
    status: result.ok && !validationError ? 'ok' : 'failed',
    elapsedMs: result.elapsedMs,
    error: validationError || result.error || null,
    outputChars: String(result.content || '').length,
  }
}

function createJsonRepairPlan({ artifact, source, cacheKey, rawContent, validationError }) {
  const schema = artifactSchemaDescription(artifact)
  return {
    schemaVersion: LOCAL_CONSUMPTION_SCHEMA_VERSION,
    artifact,
    promptVersion: `${getPromptVersionForArtifact(artifact)}.repair.v0.1`,
    provider: 'ollama',
    endpoint,
    model: modelName,
    responseFormat: 'json',
    timeoutMs: 60000,
    cacheKey: `${cacheKey}|json-repair`,
    messages: [
      {
        role: 'system',
        content: [
          '你是“视界专注”的 JSON 修复器。',
          '你只负责把失败输出改成指定 JSON schema，不补充事实，不解释原因，不输出 Markdown。',
          '最终回复必须是单个 JSON 对象。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `目标产物：${artifact}`,
          `标题：${source.title}`,
          `UP 主：${source.creator}`,
          `来源编号：${source.sourceId}`,
          `失败原因：${validationError?.message || 'JSON 不可解析或结构不完整'}`,
          `目标 schema：${schema}`,
          '',
          '请基于下面的失败输出预览，修复成符合 schema 的最小 JSON；如果缺少信息，用保守判断，不要编造细节。',
          '',
          '失败输出预览：',
          stripLocalModelThinkTags(rawContent || '').slice(0, 2200),
          '',
          `最终只输出 JSON：${schema}`,
        ].join('\n'),
      },
    ],
  }
}

function artifactOutputPath(sampleDir, artifact) {
  if (artifact === 'brief') return path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefPath)
  if (artifact === 'email') return path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailPath)
  if (artifact === 'decision') return path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.decisionPath)
  return path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.qualityCheckPath)
}

function artifactMetaPath(sampleDir, artifact) {
  if (artifact === 'brief') return path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefMetaPath)
  if (artifact === 'email') return path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailStatusPath)
  if (artifact === 'decision') return path.join(sampleDir, 'delivery', 'decision.meta.json')
  return path.join(sampleDir, 'work', 'quality', 'local_check.meta.json')
}

function readCompletedRunMeta(sampleDir, cacheKeys) {
  const metaPath = path.join(sampleDir, 'work', 'run_meta.json')
  if (!fs.existsSync(metaPath)) return null
  const meta = readJson(metaPath)
  if (!meta || meta.model !== modelName || meta.adapterVersion !== LOCAL_OLLAMA_ADAPTER_VERSION) return null
  if (meta.status !== 'ok') return null
  if (meta.artifacts?.email?.status !== 'ok') return null
  for (const [artifact, cacheKey] of Object.entries(cacheKeys)) {
    if (meta.artifacts?.[artifact]?.cacheKey !== cacheKey || meta.artifacts?.[artifact]?.status !== 'ok') return null
  }
  return meta
}

async function runArtifact({ artifact, sampleDir, source, cacheKey, notebooklmSha1, rawTranscriptSha1, briefSha1 }) {
  const plan = buildLocalModelRequestPlan({
    artifact,
    title: source.title,
    creator: source.creator,
    sourceId: source.sourceId,
    notebooklmMarkdown: source.notebooklmMarkdown,
    briefMarkdown: source.briefMarkdown,
    rawTranscriptText: source.rawTranscriptText,
    criticalTerms: source.criticalTerms,
    profile: source.profile,
    cacheKey,
    contentBudgetChars: artifact === 'brief' ? 9000 : 7000,
  }, {
    provider: 'ollama',
    endpoint,
    model: modelName,
    timeoutMs: 120000,
  })
  const attempts = []
  let result = await executeLocalOllamaRequest(plan)
  let validationError = result.ok && !validateArtifactPayload(artifact, result.json) ? createSchemaError(artifact) : null
  attempts.push(summarizeAttempt('initial', result, validationError))

  if (shouldRetryJsonArtifact(artifact, result, validationError)) {
    const repairPlan = createJsonRepairPlan({
      artifact,
      source,
      cacheKey,
      rawContent: result.rawContent || result.content || '',
      validationError,
    })
    const repairResult = await executeLocalOllamaRequest(repairPlan, {
      numPredict: 256,
      timeoutMs: 60000,
    })
    const repairValidationError = repairResult.ok && !validateArtifactPayload(artifact, repairResult.json)
      ? createSchemaError(artifact)
      : null
    attempts.push(summarizeAttempt('json_repair', repairResult, repairValidationError))
    if (repairResult.ok && !repairValidationError) {
      result = repairResult
      validationError = null
    } else {
      result = repairResult
      validationError = repairValidationError
    }
  }

  const outputPath = artifactOutputPath(sampleDir, artifact)
  const metaPath = artifactMetaPath(sampleDir, artifact)
  const baseMeta = {
    schemaVersion: LOCAL_CONSUMPTION_ARTIFACT_PLAN.schemaVersion,
    adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
    artifact,
    status: result.ok ? 'ok' : 'failed',
    model: result.model,
    endpoint: result.endpoint,
    elapsedMs: result.elapsedMs,
    params: result.params,
    cacheKey,
    notebooklmSha1,
    rawTranscriptSha1,
    briefSha1,
    guard: result.guard,
    attempts,
    retryCount: Math.max(0, attempts.length - 1),
    error: validationError || result.error,
  }

  if (!result.ok || validationError) {
    writeJson(metaPath, {
      ...baseMeta,
      outputPreview: stripLocalModelThinkTags(result.rawContent || '').slice(0, 2000),
    })
    return {
      status: 'failed',
      cacheKey,
      elapsedMs: result.elapsedMs,
      attempts,
      retryCount: Math.max(0, attempts.length - 1),
      error: validationError || result.error,
    }
  }

  if (artifact === 'brief' || artifact === 'email') {
    writeText(outputPath, result.content || '')
  } else {
    writeJson(outputPath, result.json)
  }
  writeJson(metaPath, baseMeta)

  return {
    status: 'ok',
    cacheKey,
    elapsedMs: result.elapsedMs,
    attempts,
    retryCount: Math.max(0, attempts.length - 1),
    outputChars: artifact === 'brief' || artifact === 'email'
      ? String(result.content || '').length
      : JSON.stringify(result.json || {}).length,
    outputPath: path.relative(repoRoot, outputPath),
  }
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return ''
  return fs.readFileSync(filePath, 'utf-8')
}

function collectRunReportItem(runMeta) {
  const sampleDir = path.join(repoRoot, runMeta.sampleDir)
  const briefText = readTextIfExists(artifactOutputPath(sampleDir, 'brief'))
  const emailText = readTextIfExists(artifactOutputPath(sampleDir, 'email'))
  const decision = readJson(artifactOutputPath(sampleDir, 'decision'))
  const quality = readJson(artifactOutputPath(sampleDir, 'quality_check'))
  const artifacts = runMeta.artifacts || {}
  const retryCount = Object.values(artifacts).reduce((total, artifact) => total + Number(artifact.retryCount || 0), 0)
  const elapsedMs = Object.values(artifacts).reduce((total, artifact) => total + Number(artifact.elapsedMs || 0), 0)
  return {
    status: runMeta.status,
    upId: runMeta.profile?.upId || '',
    creator: runMeta.creator,
    title: runMeta.title,
    sourceId: runMeta.sourceId,
    sampleDir: runMeta.sampleDir,
    sourceMaterialDir: runMeta.sourceMaterialDir,
    profileHash: runMeta.profile?.profileHash,
    profileKind: runMeta.profile?.kind,
    artifacts: {
      brief: artifacts.brief?.status || 'missing',
      email: artifacts.email?.status || 'missing',
      decision: artifacts.decision?.status || 'missing',
      quality_check: artifacts.quality_check?.status || 'missing',
    },
    briefChars: briefText.trim().length,
    emailChars: emailText.trim().length,
    decision: decision
      ? {
          worthEmail: decision.worthEmail,
          importance: decision.importance,
          reason: decision.reason,
          tags: decision.tags,
        }
      : null,
    quality: quality
      ? {
          ok: quality.ok,
          riskLevel: quality.riskLevel,
          issues: quality.issues,
          missingCriticalTerms: quality.missingCriticalTerms,
          reason: quality.reason,
        }
      : null,
    retryCount,
    elapsedMs,
  }
}

function scanSampleRootForForbiddenText() {
  const patterns = [
    /<\/?think\b/iu,
    /[A-Z]:\\Users\\/u,
    /\bapi\s*key\b/iu,
    /\bcookie\b/iu,
    /\bsmtp\b/iu,
    /\bbearer\s+[a-z0-9._-]+/iu,
  ]
  const hits = []
  if (!fs.existsSync(sampleRoot)) return hits
  const stack = [sampleRoot]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (path.resolve(fullPath) === path.resolve(reportRoot)) continue
        stack.push(fullPath)
        continue
      }
      const text = fs.readFileSync(fullPath, 'utf-8')
      const matched = patterns.find((pattern) => pattern.test(text))
      if (matched) {
        hits.push({
          path: path.relative(repoRoot, fullPath),
          pattern: String(matched),
        })
      }
    }
  }
  return hits
}

function writeNightlyReport(runReports, summary) {
  const items = runReports.map(collectRunReportItem)
  const forbiddenHits = scanSampleRootForForbiddenText()
  const okItems = items.filter((item) => item.status === 'ok')
  const failedItems = items.filter((item) => item.status !== 'ok')
  const totalElapsedMs = items.reduce((total, item) => total + item.elapsedMs, 0)
  const reportJson = {
    schemaVersion: LOCAL_CONSUMPTION_ARTIFACT_PLAN.schemaVersion,
    adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
    model: modelName,
    endpoint,
    generatedAt: new Date().toISOString(),
    summary: {
      sampleCount: items.length,
      okCount: okItems.length,
      failedCount: failedItems.length,
      generatedCount: summary.generated.length,
      skippedCount: summary.skipped.length,
      totalRetryCount: items.reduce((total, item) => total + item.retryCount, 0),
      totalElapsedMs,
      forbiddenHitCount: forbiddenHits.length,
    },
    forbiddenHits,
    items,
  }

  const reportPath = path.join(reportRoot, 'nightly-autopilot-report.json')
  writeJson(reportPath, reportJson)

  const lines = [
    '# 本地消费层夜间自动闭环报告',
    '',
    `生成时间：${reportJson.generatedAt}`,
    `模型：${modelName}`,
    `样本数：${items.length}`,
    `成功：${okItems.length}`,
    `失败：${failedItems.length}`,
    `跳过：${summary.skipped.length}`,
    `JSON 修复重试次数：${reportJson.summary.totalRetryCount}`,
    `总耗时：${Math.round(totalElapsedMs / 1000)} 秒`,
    `安全扫描命中：${forbiddenHits.length}`,
    '',
    '## 样本结果',
    '',
    '| UP 主 | 视频 | 状态 | Brief 字数 | Email 字数 | Decision | Quality | 重试 | 路径 |',
    '|---|---|---|---:|---:|---|---|---:|---|',
    ...items.map((item) => [
      item.creator,
      item.title.replace(/\|/gu, '/'),
      item.status,
      item.briefChars,
      item.emailChars,
      item.decision
        ? `${item.decision.worthEmail ? '推送' : '不推送'} / ${item.decision.importance} / ${String(item.decision.reason || '').replace(/\|/gu, '/')}`
        : '无',
      item.quality
        ? `${item.quality.ok ? 'ok' : 'risk'} / ${item.quality.riskLevel} / ${String(item.quality.reason || '').replace(/\|/gu, '/')}`
        : '无',
      item.retryCount,
      item.sampleDir,
    ].join(' | ')),
    '',
    '## 失败项',
    '',
    failedItems.length
      ? failedItems.map((item) => `- ${item.creator} / ${item.sourceId} / ${item.title}`).join('\n')
      : '无。',
    '',
    '## 安全扫描',
    '',
    forbiddenHits.length
      ? forbiddenHits.map((hit) => `- ${hit.path}：${hit.pattern}`).join('\n')
      : '未发现推理标签、本机路径、密钥、浏览器会话、邮件服务或授权令牌字样。',
  ]
  const markdownPath = path.join(reportRoot, 'nightly-autopilot-report.md')
  writeText(markdownPath, lines.join('\n'))

  return {
    json: path.relative(repoRoot, reportPath),
    markdown: path.relative(repoRoot, markdownPath),
    report: reportJson,
  }
}

const generated = []
const skipped = []
const failed = []
const runReports = []

for (const materialDir of candidates) {
  const notebookPath = path.join(materialDir, 'exports', 'notebooklm.md')
  if (!fs.existsSync(notebookPath)) continue

  const manifest = readJson(path.join(materialDir, 'manifest.json')) || {}
  const sourceMeta = manifest.source || {}
  const notebooklmMarkdown = fs.readFileSync(notebookPath, 'utf-8')
  const rawPath = path.join(materialDir, 'raw_transcript.txt')
  const rawTranscriptText = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf-8') : ''
  const upId = path.basename(path.dirname(materialDir))
  const videoId = path.basename(materialDir)
  const sampleDir = path.join(sampleRoot, videoId)
  const profile = createDefaultLocalConsumptionProfile({
    upId,
    name: String(sourceMeta.creator || '未知 UP'),
  })
  const notebooklmSha1 = sha1(notebooklmMarkdown)
  const rawTranscriptSha1 = rawTranscriptText ? sha1(rawTranscriptText) : ''
  const sourceBase = {
    title: String(sourceMeta.title || videoId),
    creator: String(sourceMeta.creator || profile.name),
    sourceId: String(sourceMeta.source_id || videoId),
    notebooklmMarkdown,
    rawTranscriptText,
    criticalTerms: pickCriticalTerms(`${rawTranscriptText}\n${notebooklmMarkdown}`),
    profile,
  }
  const briefCacheKey = localCacheKey({
    artifact: 'brief',
    notebooklmSha1,
    rawTranscriptSha1,
    profile,
  })
  const decisionCacheKey = localCacheKey({
    artifact: 'decision',
    notebooklmSha1,
    rawTranscriptSha1,
    profile,
  })
  const qualityCacheKey = localCacheKey({
    artifact: 'quality_check',
    notebooklmSha1,
    rawTranscriptSha1,
    profile,
  })
  const completed = force ? null : readCompletedRunMeta(sampleDir, {
    brief: briefCacheKey,
    decision: decisionCacheKey,
    quality_check: qualityCacheKey,
  })
  if (completed) {
    skipped.push(path.relative(repoRoot, sampleDir))
    runReports.push(completed)
    continue
  }

  const artifacts = {}
  artifacts.brief = await runArtifact({
    artifact: 'brief',
    sampleDir,
    source: sourceBase,
    cacheKey: briefCacheKey,
    notebooklmSha1,
    rawTranscriptSha1,
  })

  const briefPath = artifactOutputPath(sampleDir, 'brief')
  const briefMarkdown = artifacts.brief.status === 'ok' && fs.existsSync(briefPath)
    ? fs.readFileSync(briefPath, 'utf-8')
    : ''
  const briefSha1 = briefMarkdown ? sha1(briefMarkdown) : ''
  const emailCacheKey = localCacheKey({
    artifact: 'email',
    notebooklmSha1,
    rawTranscriptSha1,
    briefSha1,
    profile,
  })

  if (briefMarkdown) {
    artifacts.email = await runArtifact({
      artifact: 'email',
      sampleDir,
      source: {
        ...sourceBase,
        briefMarkdown,
      },
      cacheKey: emailCacheKey,
      notebooklmSha1,
      rawTranscriptSha1,
      briefSha1,
    })
  } else {
    const error = {
      code: 'quality_guard_failed',
      message: 'brief 未生成，跳过 email。',
    }
    artifacts.email = {
      status: 'failed',
      cacheKey: emailCacheKey,
      elapsedMs: 0,
      error,
    }
    writeJson(artifactMetaPath(sampleDir, 'email'), {
      schemaVersion: LOCAL_CONSUMPTION_ARTIFACT_PLAN.schemaVersion,
      adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
      artifact: 'email',
      status: 'failed',
      model: modelName,
      endpoint,
      cacheKey: emailCacheKey,
      error,
    })
  }

  artifacts.decision = await runArtifact({
    artifact: 'decision',
    sampleDir,
    source: sourceBase,
    cacheKey: decisionCacheKey,
    notebooklmSha1,
    rawTranscriptSha1,
  })

  artifacts.quality_check = await runArtifact({
    artifact: 'quality_check',
    sampleDir,
    source: sourceBase,
    cacheKey: qualityCacheKey,
    notebooklmSha1,
    rawTranscriptSha1,
  })

  const ok = Object.values(artifacts).every((item) => item.status === 'ok')
  const runMeta = {
    schemaVersion: LOCAL_CONSUMPTION_ARTIFACT_PLAN.schemaVersion,
    adapterVersion: LOCAL_OLLAMA_ADAPTER_VERSION,
    status: ok ? 'ok' : 'partial_failed',
    model: modelName,
    endpoint,
    sourceMaterialDir: path.relative(repoRoot, materialDir),
    sampleDir: path.relative(repoRoot, sampleDir),
    title: sourceBase.title,
    creator: sourceBase.creator,
    sourceId: sourceBase.sourceId,
    profile,
    notebooklmSha1,
    rawTranscriptSha1,
    briefSha1,
    artifacts,
    generatedAt: new Date().toISOString(),
  }
  writeJson(path.join(sampleDir, 'work', 'run_meta.json'), runMeta)
  runReports.push(runMeta)

  generated.push(path.relative(repoRoot, sampleDir))
  if (!ok) failed.push(path.relative(repoRoot, sampleDir))
}

if (!generated.length && !skipped.length) {
  throw new Error('没有找到可用于生成 Ollama 样本的 NotebookLM 材料。')
}

const report = writeNightlyReport(runReports, { generated, skipped, failed })

console.log(JSON.stringify({
  model: modelName,
  endpoint,
  sampleCount: runReports.length,
  generated,
  skipped,
  failed,
  report: {
    markdown: report.markdown,
    json: report.json,
    okCount: report.report.summary.okCount,
    failedCount: report.report.summary.failedCount,
    totalRetryCount: report.report.summary.totalRetryCount,
    forbiddenHitCount: report.report.summary.forbiddenHitCount,
  },
}, null, 2))

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  createOllamaRequestBody,
  DEFAULT_LOCAL_OLLAMA_MODEL,
  executeLocalOllamaRequest,
  inspectLocalOllamaOutput,
  parseLocalModelJson,
  stripLocalModelThinkTags,
} from '../electron/services/localOllamaAdapter.ts'
import {
  buildLocalModelRequestPlan,
  createDefaultLocalConsumptionProfile,
} from '../src/domain/localConsumption.ts'

const adapterSource = await readFile(new URL('../electron/services/localOllamaAdapter.ts', import.meta.url), 'utf8')

const profile = createDefaultLocalConsumptionProfile({
  upId: '316183842',
  name: '技术爬爬虾',
})

const briefPlan = buildLocalModelRequestPlan({
  artifact: 'brief',
  title: '本地模型 adapter 检查',
  creator: '技术爬爬虾',
  sourceId: 'BV_LOCAL_ADAPTER_CHECK',
  notebooklmMarkdown: '# 样本\n\n## 正文\n\n需要保留 Python 命令、路径说明和错误处理，不要补充外部事实。',
  profile,
  cacheKey: 'check-brief-cache-key',
}, {
  provider: 'ollama',
  model: 'local-model-unconfigured',
  timeoutMs: 3000,
})

assert.equal(stripLocalModelThinkTags('<think>内部推理</think>\n# 可见内容'), '# 可见内容')
assert.equal(stripLocalModelThinkTags('<think>\n</think>\n{"ok":true}'), '{"ok":true}')

const parsedJson = parseLocalModelJson('<think>draft</think>\n```json\n{"worthEmail":true,"importance":4,"reason":"有用","tags":["技术"]}\n```')
assert.equal(parsedJson.ok, true)
assert.deepEqual(parsedJson.json, {
  worthEmail: true,
  importance: 4,
  reason: '有用',
  tags: ['技术'],
})

const invalidJson = parseLocalModelJson('不是 JSON')
assert.equal(invalidJson.ok, false)

const guarded = inspectLocalOllamaOutput('正常输出')
assert.equal(guarded.ok, true)
const suspicious = inspectLocalOllamaOutput('请使用 API Key 和 C:\\Users\\Yu\\AI\\Cuda')
assert.equal(suspicious.ok, false)
assert.equal(suspicious.hasSecretPattern, true)
assert.equal(suspicious.hasLocalPath, true)

const body = createOllamaRequestBody(briefPlan)
assert.equal(body.model, DEFAULT_LOCAL_OLLAMA_MODEL)
assert.equal(body.stream, false)
assert.equal(body.options.num_ctx, 12288)
assert.equal(body.options.num_predict, 4096)
assert.equal(body.options.temperature, 0.1)
assert.equal(body.format, undefined)

const markdownResult = await executeLocalOllamaRequest(briefPlan, {
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      message: {
        content: '<think>本段不应出现</think>\n# 本地简报\n\n- 只保留输入中的 Python 命令。',
      },
    }),
  }),
})
assert.equal(markdownResult.ok, true)
assert.equal(markdownResult.model, DEFAULT_LOCAL_OLLAMA_MODEL)
assert.match(markdownResult.content || '', /本地简报/)
assert.doesNotMatch(markdownResult.content || '', /think|本段不应出现/)
assert.equal(markdownResult.guard?.ok, true)

const decisionPlan = buildLocalModelRequestPlan({
  artifact: 'decision',
  title: '本地模型 adapter 检查',
  creator: '技术爬爬虾',
  sourceId: 'BV_LOCAL_ADAPTER_CHECK',
  notebooklmMarkdown: '# 样本\n\n## 正文\n\n技术教程内容。',
  profile,
}, {
  provider: 'ollama',
  model: 'shijie-qwen3-8b-q4-chat',
})
const jsonBody = createOllamaRequestBody(decisionPlan)
assert.equal(jsonBody.format, 'json')
assert.equal(jsonBody.options.num_predict, 256)

const jsonResult = await executeLocalOllamaRequest(decisionPlan, {
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      message: {
        content: '<think></think>{"worthEmail":true,"importance":4,"reason":"适合推送","tags":["教程"]}',
      },
    }),
  }),
})
assert.equal(jsonResult.ok, true)
assert.deepEqual(jsonResult.json, {
  worthEmail: true,
  importance: 4,
  reason: '适合推送',
  tags: ['教程'],
})

const badJsonResult = await executeLocalOllamaRequest(decisionPlan, {
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      message: {
        content: '不是 JSON',
      },
    }),
  }),
})
assert.equal(badJsonResult.ok, false)
assert.equal(badJsonResult.error?.code, 'invalid_json')

const httpResult = await executeLocalOllamaRequest(briefPlan, {
  fetchImpl: async () => ({
    ok: false,
    status: 404,
    statusText: 'model not found',
    json: async () => ({}),
  }),
})
assert.equal(httpResult.ok, false)
assert.equal(httpResult.error?.code, 'http_error')

const offlineResult = await executeLocalOllamaRequest(briefPlan, {
  fetchImpl: async () => {
    throw new Error('ECONNREFUSED 127.0.0.1:11434')
  },
})
assert.equal(offlineResult.ok, false)
assert.equal(offlineResult.error?.code, 'offline')

const timeoutResult = await executeLocalOllamaRequest(briefPlan, {
  fetchImpl: async () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    throw error
  },
})
assert.equal(timeoutResult.ok, false)
assert.equal(timeoutResult.error?.code, 'timeout')

const unsupportedPlan = buildLocalModelRequestPlan({
  artifact: 'brief',
  title: '非 Ollama',
  creator: '技术爬爬虾',
  sourceId: 'BV_LOCAL_ADAPTER_CHECK',
  notebooklmMarkdown: '# 样本',
  profile,
}, {
  provider: 'sample',
})
const unsupported = await executeLocalOllamaRequest(unsupportedPlan)
assert.equal(unsupported.ok, false)
assert.equal(unsupported.error?.code, 'unsupported_provider')

assert.doesNotMatch(adapterSource, /data[\\/]+materials/iu, 'adapter must not reference production materials')
assert.doesNotMatch(adapterSource, /\b(?:writeFile|appendFile|mkdir|rm|unlink|rename)\s*\(/iu, 'adapter must not write files')
assert.doesNotMatch(adapterSource, /child_process|spawn|execFile|exec\(/iu, 'adapter must not start subprocesses')
assert.doesNotMatch(adapterSource, /sendMail|mailTransport|nodemailer|smtpTransport/iu, 'adapter must not send email')
assert.doesNotMatch(adapterSource, /bilibiliSource|sourceDiscovery|loginCookie|cookieJar/iu, 'adapter must not call source discovery or handle cookies')
assert.doesNotMatch(adapterSource, /mimo|tts|summaryPipeline|runMaterialSummary/iu, 'adapter must not touch old consumption branches')

console.log('local ollama adapter check passed')

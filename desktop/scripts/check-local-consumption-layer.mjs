import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const mod = await import('../src/domain/localConsumption.ts')
const domainSource = await readFile(new URL('../src/domain/localConsumption.ts', import.meta.url), 'utf8')

assert.equal(mod.LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefPath, 'exports/brief.local.md')
assert.equal(mod.LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefMetaPath, 'work/brief/local_brief.meta.json')
assert.equal(mod.LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailPath, 'delivery/email.md')
assert.equal(mod.LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailStatusPath, 'delivery/email_status.json')
assert.equal(mod.LOCAL_CONSUMPTION_ARTIFACT_PLAN.decisionPath, 'delivery/decision.json')
assert.equal(mod.LOCAL_CONSUMPTION_ARTIFACT_PLAN.qualityCheckPath, 'work/quality/local_check.json')

const newsProfile = mod.createDefaultLocalConsumptionProfile({
  upId: '285286947',
  name: '橘鸦Juya',
})
assert.equal(newsProfile.kind, 'news_digest')
assert.ok(newsProfile.keep.includes('产品名'))
assert.ok(newsProfile.remove.includes('重复播报'))
assert.ok(newsProfile.cautions.some((item) => item.includes('不得合并不同新闻')))
assert.match(newsProfile.profileHash, /shijie\.up-profile\.v0\.1/)
assert.match(newsProfile.briefStyle, /AI 新闻条目/)

const techProfile = mod.createDefaultLocalConsumptionProfile({
  upId: '316183842',
  name: '技术爬爬虾',
})
assert.equal(techProfile.kind, 'technical_tutorial')
assert.ok(techProfile.keep.includes('操作步骤'))
assert.ok(techProfile.cautions.some((item) => item.includes('不得把步骤改写成概念总结')))
assert.match(techProfile.briefStyle, /可复现的操作笔记/)

const expectedProfilePresets = [
  ['1556651916', '小黛晨读', 'news_digest', /参考信息条目/],
  ['256724889', 'TED官方精选', 'speech', /演讲故事线/],
  ['280780745', '张小强商业访谈录', 'knowledge_talk', /访谈结构/],
  ['285286947', '橘鸦Juya', 'news_digest', /AI 新闻条目/],
  ['316183842', '技术爬爬虾', 'technical_tutorial', /操作笔记/],
  ['316568752', '马督工', 'knowledge_talk', /公共议题/],
  ['3546593938639500', '罗胖罗振宇', 'knowledge_talk', /论证链/],
  ['383382980', '杨彧鑫AI', 'knowledge_talk', /AI 商业判断/],
]
const profileHashes = new Set()
for (const [upId, name, kind, stylePattern] of expectedProfilePresets) {
  const profile = mod.createDefaultLocalConsumptionProfile({ upId, name })
  assert.equal(profile.kind, kind)
  assert.match(profile.briefStyle, stylePattern)
  assert.ok(profile.keep.length >= 7, `${name} should keep enough domain-specific details`)
  assert.ok(profile.remove.length >= 5, `${name} should define removable noise`)
  assert.ok(profile.cautions.length >= 3, `${name} should define cautions`)
  assert.match(profile.profileHash, /shijie\.up-profile\.v0\.1/)
  profileHashes.add(profile.profileHash)
}
assert.equal(profileHashes.size, expectedProfilePresets.length, 'each tracked UP should have a distinct profile hash')

const endpoint = mod.normalizeLocalModelEndpoint({
  provider: 'LM Studio',
  model: 'qwen3:8b',
  enabled: true,
})
assert.equal(endpoint.provider, 'lm_studio')
assert.equal(endpoint.endpoint, 'http://127.0.0.1:1234/v1/chat/completions')
assert.equal(endpoint.model, 'qwen3:8b')
assert.equal(endpoint.enabled, true)

const briefKey = mod.buildLocalConsumptionCacheKey({
  artifact: 'brief',
  notebooklmSha1: 'notebook-sha1',
  profileHash: 'profile-v1',
  localModelName: 'qwen3:8b',
  promptVersion: mod.getPromptVersionForArtifact('brief'),
})
const changedPromptKey = mod.buildLocalConsumptionCacheKey({
  artifact: 'brief',
  notebooklmSha1: 'notebook-sha1',
  profileHash: 'profile-v1',
  localModelName: 'qwen3:8b',
  promptVersion: 'different-prompt',
})
const changedNotebookKey = mod.buildLocalConsumptionCacheKey({
  artifact: 'brief',
  notebooklmSha1: 'other-notebook-sha1',
  profileHash: 'profile-v1',
  localModelName: 'qwen3:8b',
  promptVersion: mod.getPromptVersionForArtifact('brief'),
})
assert.notEqual(briefKey, changedPromptKey, 'prompt version changes must invalidate local brief cache')
assert.notEqual(briefKey, changedNotebookKey, 'NotebookLM content changes must invalidate local brief cache')

const emailKey = mod.buildLocalConsumptionCacheKey({
  artifact: 'email',
  notebooklmSha1: 'notebook-sha1',
  briefSha1: 'brief-sha1',
  profileHash: 'profile-v1',
  localModelName: 'qwen3:8b',
  promptVersion: mod.getPromptVersionForArtifact('email'),
})
assert.match(emailKey, /brief-sha1/, 'email cache key must depend on local brief output')

const briefRequest = mod.buildLocalModelRequestPlan({
  artifact: 'brief',
  title: '样本标题',
  creator: '技术爬爬虾',
  sourceId: 'BV_SAMPLE',
  notebooklmMarkdown: '# 样本\n\n## 正文\n\n第一段内容包含操作步骤和命令。',
  profile: techProfile,
  cacheKey: briefKey,
}, {
  provider: 'ollama',
  model: 'qwen3:8b',
})
assert.equal(briefRequest.artifact, 'brief')
assert.equal(briefRequest.provider, 'ollama')
assert.equal(briefRequest.responseFormat, 'markdown')
assert.equal(briefRequest.cacheKey, briefKey)
assert.equal(briefRequest.messages.length, 2)
assert.match(briefRequest.messages[0].content, /高信息密度/)
assert.match(briefRequest.messages[0].content, /事实纪律/)
assert.match(briefRequest.messages[1].content, /NotebookLM 主资料/)
assert.match(briefRequest.messages[1].content, /事实门控版/)
assert.doesNotMatch(briefRequest.messages.map((message) => message.content).join('\n'), /data\/materials|data\\materials/)

const emailRequest = mod.buildLocalModelRequestPlan({
  artifact: 'email',
  title: '样本标题',
  creator: '技术爬爬虾',
  sourceId: 'BV_SAMPLE',
  briefMarkdown: '1. 第一条本地简报。',
  profile: techProfile,
}, {
  provider: 'openai-compatible',
  model: 'local-qwen',
})
assert.equal(emailRequest.provider, 'openai_compatible')
assert.equal(emailRequest.responseFormat, 'markdown')
assert.match(emailRequest.messages[1].content, /本地简报/)
assert.doesNotMatch(emailRequest.messages[1].content, /NotebookLM 主资料：/)

const decisionRequest = mod.buildLocalModelRequestPlan({
  artifact: 'decision',
  title: '样本标题',
  creator: '橘鸦Juya',
  sourceId: 'BV_SAMPLE',
  notebooklmMarkdown: '# 样本\n\n## 正文\n\n新产品发布和价格信息。',
  profile: newsProfile,
}, {
  provider: 'sample',
})
assert.equal(decisionRequest.provider, 'sample_generator')
assert.equal(decisionRequest.responseFormat, 'json')
assert.match(decisionRequest.messages[1].content, /worthEmail/)

const qualityRequest = mod.buildLocalModelRequestPlan({
  artifact: 'quality_check',
  title: '样本标题',
  creator: '技术爬爬虾',
  sourceId: 'BV_SAMPLE',
  notebooklmMarkdown: '# 样本\n\n## 正文\n\n教程主资料。',
  rawTranscriptText: '原始字幕包含 Python 和路径。',
  criticalTerms: ['Python'],
  profile: techProfile,
})
assert.equal(qualityRequest.responseFormat, 'json')
assert.match(qualityRequest.messages[1].content, /关键术语候选：Python/)

assert.doesNotMatch(domainSource, /fetch\s*\(/u, 'domain layer must not call network directly')
assert.doesNotMatch(domainSource, /node:http|node:https|axios|child_process/u, 'domain layer must stay pure and adapter-free')

const decision = mod.createLocalDecisionDraft({
  profile: newsProfile,
  hasNotebooklm: true,
  textLength: 22000,
})
assert.equal(decision.worthEmail, true)
assert.equal(decision.contentType, 'news_digest')

assert.equal(mod.DEFAULT_LOCAL_QUALITY_GATE.minNotebookToRawRatio, 0.55)
assert.equal(mod.DEFAULT_LOCAL_QUALITY_GATE.maxMissingCriticalTerms, 0)
assert.equal(mod.DEFAULT_LOCAL_QUALITY_GATE.maxMissingStepMarkers, 0)

const sampleBrief = mod.renderLocalBriefSample({
  title: '样本标题',
  creator: '橘鸦Juya',
  sourceId: 'BV_SAMPLE',
  notebooklmMarkdown: '# 样本\n\n## 正文\n\n[00:00-00:10] 第一条新闻内容。\n\n[00:10-00:20] 第二条新闻内容。',
  profile: newsProfile,
})
assert.match(sampleBrief, /本地简报样本/)
assert.match(sampleBrief, /后续本地模型应重点保留/)

const sampleEmail = mod.renderLocalEmailSample({
  title: '样本标题',
  creator: '橘鸦Juya',
  sourceId: 'BV_SAMPLE',
  notebooklmMarkdown: '# 样本',
  profile: newsProfile,
}, sampleBrief)
assert.match(sampleEmail, /为什么值得看/)

const quality = mod.createLocalQualityCheckDraft({
  rawTextLength: 1000,
  notebookTextLength: 800,
  criticalTerms: ['2026年'],
})
assert.equal(quality.ok, true)

console.log('local consumption layer check passed')

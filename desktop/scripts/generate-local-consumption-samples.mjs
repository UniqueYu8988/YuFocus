import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import {
  buildLocalConsumptionCacheKey,
  createDefaultLocalConsumptionProfile,
  createLocalDecisionDraft,
  createLocalQualityCheckDraft,
  getPromptVersionForArtifact,
  LOCAL_CONSUMPTION_ARTIFACT_PLAN,
  renderLocalBriefSample,
  renderLocalEmailSample,
} from '../src/domain/localConsumption.ts'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const sampleRoot = path.join(repoRoot, 'data', 'temp', 'local-consumption-samples')

const candidates = [
  path.join(repoRoot, 'data/materials/285286947/bv11fga6ke9y'),
  path.join(repoRoot, 'data/materials/316183842/bv1kk9kbaejv'),
  path.join(repoRoot, 'data/materials/316183842/bv1yslc6qecb'),
  path.join(repoRoot, 'data/materials/3546593938639500/bv1tevn6aev8'),
]

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function sha1(text) {
  return createHash('sha1').update(text).digest('hex')
}

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function writeText(filePath, text) {
  ensureDirFor(filePath)
  fs.writeFileSync(filePath, text.trimEnd() + '\n', 'utf-8')
}

function writeJson(filePath, payload) {
  ensureDirFor(filePath)
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

const generated = []
for (const materialDir of candidates) {
  const notebookPath = path.join(materialDir, 'exports', 'notebooklm.md')
  if (!fs.existsSync(notebookPath)) continue

  const manifest = readJson(path.join(materialDir, 'manifest.json')) || {}
  const source = manifest.source || {}
  const notebooklmMarkdown = fs.readFileSync(notebookPath, 'utf-8')
  const rawPath = path.join(materialDir, 'raw_transcript.txt')
  const rawText = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf-8') : ''
  const videoId = path.basename(materialDir)
  const profile = createDefaultLocalConsumptionProfile({
    upId: path.basename(path.dirname(materialDir)),
    name: String(source.creator || '未知 UP'),
  })
  const sampleDir = path.join(sampleRoot, videoId)
  const sampleSource = {
    title: String(source.title || videoId),
    creator: String(source.creator || profile.name),
    sourceId: String(source.source_id || videoId),
    notebooklmMarkdown,
    profile,
  }
  const brief = renderLocalBriefSample(sampleSource)
  const email = renderLocalEmailSample(sampleSource, brief)
  const notebooklmSha1 = sha1(notebooklmMarkdown)
  const briefSha1 = sha1(brief)
  const rawTranscriptSha1 = rawText ? sha1(rawText) : ''
  const decision = createLocalDecisionDraft({
    profile,
    hasNotebooklm: true,
    textLength: notebooklmMarkdown.length,
  })
  const quality = createLocalQualityCheckDraft({
    rawTextLength: rawText.length,
    notebookTextLength: notebooklmMarkdown.length,
    criticalTerms: Array.from(new Set((rawText.match(/(?:19|20)\d{2}年?|\d+(?:\.\d+)?%|[A-Za-z][A-Za-z0-9.+-]{2,}/gu) || []).slice(0, 80))),
  })

  writeText(path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefPath), brief)
  writeText(path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailPath), email)
  writeJson(path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.decisionPath), {
    ...decision,
    cacheKey: buildLocalConsumptionCacheKey({
      artifact: 'decision',
      notebooklmSha1,
      profileHash: profile.profileHash,
      localModelName: 'sample-generator',
      promptVersion: getPromptVersionForArtifact('decision'),
    }),
  })
  writeJson(path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.qualityCheckPath), {
    ...quality,
    cacheKey: buildLocalConsumptionCacheKey({
      artifact: 'quality_check',
      notebooklmSha1,
      rawTranscriptSha1,
      profileHash: profile.profileHash,
      localModelName: 'sample-generator',
      promptVersion: getPromptVersionForArtifact('quality_check'),
    }),
  })
  writeJson(path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.briefMetaPath), {
    schemaVersion: LOCAL_CONSUMPTION_ARTIFACT_PLAN.schemaVersion,
    generator: 'sample-generator',
    sourceMaterialDir: path.relative(repoRoot, materialDir),
    profile,
    notebooklmSha1,
    briefSha1,
    cacheKey: buildLocalConsumptionCacheKey({
      artifact: 'brief',
      notebooklmSha1,
      profileHash: profile.profileHash,
      localModelName: 'sample-generator',
      promptVersion: getPromptVersionForArtifact('brief'),
    }),
  })
  writeJson(path.join(sampleDir, LOCAL_CONSUMPTION_ARTIFACT_PLAN.emailStatusPath), {
    schemaVersion: LOCAL_CONSUMPTION_ARTIFACT_PLAN.schemaVersion,
    status: 'sample_only_not_sent',
    cacheKey: buildLocalConsumptionCacheKey({
      artifact: 'email',
      notebooklmSha1,
      briefSha1,
      profileHash: profile.profileHash,
      localModelName: 'sample-generator',
      promptVersion: getPromptVersionForArtifact('email'),
    }),
  })

  generated.push(path.relative(repoRoot, sampleDir))
}

if (!generated.length) {
  throw new Error('没有找到可用于生成本地消费层样本的 NotebookLM 材料。')
}

console.log(JSON.stringify({ generated }, null, 2))

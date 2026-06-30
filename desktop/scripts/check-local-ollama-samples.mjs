import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const sampleRoot = path.join(repoRoot, 'data', 'temp', 'local-ollama-samples')
const reportPath = path.join(sampleRoot, '_reports', 'nightly-autopilot-report.json')
const scriptSource = fs.readFileSync(new URL('generate-local-ollama-samples.mjs', import.meta.url), 'utf-8')

assert.match(scriptSource, /discoverCandidateMaterialDirs/u, 'sample script should discover material samples by UP')
assert.match(scriptSource, /createJsonRepairPlan/u, 'sample script should support JSON repair retry')
assert.match(scriptSource, /writeNightlyReport/u, 'sample script should write a review report')
assert.match(scriptSource, /assertInsideSampleRoot/u, 'sample script must guard output paths')
assert.doesNotMatch(scriptSource, /sendMail|mailTransport|nodemailer|smtpTransport/iu, 'sample script must not send email')
assert.doesNotMatch(scriptSource, /queueExecutor|workbenchQueue|automationController/iu, 'sample script must not enqueue or run background tasks')
assert.doesNotMatch(scriptSource, /rmSync|unlinkSync|renameSync|rmdirSync/iu, 'sample script must not delete or move data')

if (!fs.existsSync(reportPath)) {
  throw new Error('缺少 data/temp/local-ollama-samples/_reports/nightly-autopilot-report.json，请先运行 generate-local-ollama-samples.mjs。')
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
assert.equal(report.summary.failedCount, 0, 'nightly local Ollama samples should have no failed item')
assert.ok(report.summary.sampleCount >= 7, 'nightly local Ollama samples should cover at least 7 UPs with materials')
assert.equal(report.summary.forbiddenHitCount, 0, 'sample safety scan should not hit forbidden text')
assert.ok(Array.isArray(report.items), 'report items must be an array')

const creators = new Set(report.items.map((item) => item.creator))
for (const creator of ['橘鸦Juya', '技术爬爬虾', '罗胖罗振宇', '马督工', '小黛晨读', '杨彧鑫AI', 'TED官方精选']) {
  assert.ok(creators.has(creator), `report should include ${creator}`)
}

for (const item of report.items) {
  assert.equal(item.status, 'ok', `${item.creator} should be ok`)
  assert.equal(item.artifacts.brief, 'ok', `${item.creator} brief should be ok`)
  assert.equal(item.artifacts.email, 'ok', `${item.creator} email should be ok`)
  assert.equal(item.artifacts.decision, 'ok', `${item.creator} decision should be ok`)
  assert.equal(item.artifacts.quality_check, 'ok', `${item.creator} quality_check should be ok`)
  assert.ok(item.briefChars > 80, `${item.creator} brief should not be empty`)
  assert.ok(item.emailChars > 80, `${item.creator} email should not be empty`)
  assert.ok(item.decision && typeof item.decision.worthEmail === 'boolean', `${item.creator} decision should be structured`)
  assert.ok(item.quality && typeof item.quality.riskLevel === 'string', `${item.creator} quality should be structured`)
  assert.match(item.sampleDir, /^data[\\/]temp[\\/]local-ollama-samples[\\/]/u, `${item.creator} sample must stay under temp root`)
}

const forbiddenPatterns = [
  /<\/?think\b/iu,
  /[A-Z]:\\Users\\/u,
  /\bapi\s*key\b/iu,
  /\bcookie\b/iu,
  /\bsmtp\b/iu,
  /\bbearer\s+[a-z0-9._-]+/iu,
]
const reportRoot = path.join(sampleRoot, '_reports')
const stack = [sampleRoot]
const hits = []
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
    const matched = forbiddenPatterns.find((pattern) => pattern.test(text))
    if (matched) hits.push(path.relative(repoRoot, fullPath))
  }
}
assert.deepEqual(hits, [], 'sample artifacts should not contain forbidden text')

console.log('local ollama samples check passed')

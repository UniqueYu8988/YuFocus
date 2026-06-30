import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const scriptPath = path.join(import.meta.dirname, 'generate_mimo_cleaning_prompt_lab.py')
const distillerPath = path.join(repoRoot, 'src', 'distiller.py')
const reportPath = path.join(repoRoot, 'data', 'temp', 'mimo-cleaning-prompt-lab', '_reports', 'mimo-cleaning-quality-report.json')

const script = fs.readFileSync(scriptPath, 'utf-8')
const distiller = fs.readFileSync(distillerPath, 'utf-8')

assert.match(distiller, /MIMO_CLEANING_PROFILE_VERSION = "shijie\.mimo-cleaning-profile\.v0\.1"/u)
assert.match(distiller, /class CleaningProfile/u)
assert.match(distiller, /MIMO_CLEANING_PROFILES/u)
assert.match(distiller, /def _resolve_cleaning_profile/u)
assert.match(distiller, /def _cleaning_profile_prompt/u)
assert.match(distiller, /cleaning_profile: CleaningProfile \| None = None/u)

for (const name of ['橘鸦', '技术爬爬虾', '罗胖罗振宇', '马督工', '小黛晨读', '杨彧鑫', 'ted官方精选']) {
  assert.match(distiller, new RegExp(name, 'iu'), `distiller profile should include ${name}`)
}

assert.match(script, /LAB_ROOT = REPO_ROOT \/ "data" \/ "temp" \/ "mimo-cleaning-prompt-lab"/u)
assert.match(script, /_assert_inside_lab/u)
assert.match(script, /baseline\.cleaned\.md/u)
assert.match(script, /profiled\.cleaned\.md/u)
assert.match(script, /iteration-2\.cleaned\.md/u)
assert.match(script, /missing_mimo_api_key/u)
assert.match(script, /_repair_notes_from_quality/u)
assert.match(script, /--reevaluate-existing/u)
assert.match(script, /_is_cross_language_cleaning/u)

assert.doesNotMatch(script, /data["']?\s*\/\s*["']?materials.*write_text|cleaned_transcript\.txt.*write_text|exports\/notebooklm\.md.*write_text/iu)
assert.doesNotMatch(script, /sendMail|mailTransport|nodemailer|smtpTransport/iu)
assert.doesNotMatch(script, /queueExecutor|workbenchQueue|automationController/iu)
assert.doesNotMatch(script, /ollama|localOllama/iu)
assert.doesNotMatch(script, /print\(.*api_key|json\.dumps\(.*api_key/iu)

if (fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
  assert.ok(report.summary, 'report should include summary')
  assert.ok(Array.isArray(report.items), 'report should include items')
  assert.ok(report.summary.sampleCount >= 1, 'report should include at least one sample')
  assert.equal(report.summary.failedCount >= 0, true)
  if (report.summary.authSource === 'missing') {
    assert.ok(report.summary.dryRunCount >= 1, 'missing key run should produce dry-run report')
  } else {
    assert.ok(report.summary.okCount + report.summary.needsReviewCount + report.summary.failedCount >= 1)
  }
  for (const item of report.items) {
    assert.match(item.sampleDir, /^data[\\/]temp[\\/]mimo-cleaning-prompt-lab[\\/]/u)
    assert.ok(item.profile || item.status === 'dry_run', 'each item should include matched profile or dry run status')
    assert.doesNotMatch(JSON.stringify(item), /api[_-]?key|cookie|smtp/iu)
  }
}

console.log('mimo cleaning prompt lab check passed')

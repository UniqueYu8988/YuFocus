import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf-8')
}

const distiller = read('src/distiller.py')
const queueExecutor = read('desktop/electron/queue/queueExecutor.ts')
const automationRuntime = read('desktop/electron/runtime/automationRuntime.ts')
const mainSource = read('desktop/electron/main.ts')
const runner = read('desktop/electron/services/localConsumptionRunner.ts')
const localDomain = read('desktop/src/domain/localConsumption.ts')

assert.match(distiller, /def save_material_package\([\s\S]*skip_editorial_summary: bool = False/u)
assert.match(distiller, /if skip_editorial_summary:[\s\S]*"status": "skipped"[\s\S]*"subtitle_only_material_package"/u)
assert.match(distiller, /skip_editorial_summary=material_only/u)
assert.doesNotMatch(
  distiller,
  /if skip_editorial_summary:[\s\S]{0,1200}build_editorial_summary_content/u,
  'material-only skip 分支不能调用旧 MiMo 精读稿。',
)

assert.match(localDomain, /briefPath:\s*'exports\/brief\.local\.md'/u)
assert.match(localDomain, /emailPath:\s*'delivery\/email\.md'/u)
assert.match(localDomain, /decisionPath:\s*'delivery\/decision\.json'/u)
assert.match(localDomain, /qualityCheckPath:\s*'work\/quality\/local_check\.json'/u)
assert.match(localDomain, /LOCAL_BRIEF_PROMPT_VERSION = 'shijie\.local-brief-prompt\.v0\.2'/u)
assert.match(localDomain, /LOCAL_EMAIL_PROMPT_VERSION = 'shijie\.local-email-prompt\.v0\.2'/u)
assert.match(localDomain, /只输出最终成稿/u)
assert.match(localDomain, /至少 600 个中文字符/u)

assert.match(runner, /export async function runLocalConsumptionForMaterial/u)
assert.match(runner, /LOCAL_CONSUMPTION_ARTIFACT_PLAN\.briefPath/u)
assert.match(runner, /work', 'local_consumption', 'run_meta\.json'/u)
assert.match(runner, /updateManifest/u)
assert.match(runner, /updateMetrics/u)
assert.match(runner, /updateRunState/u)
assert.match(runner, /local_consumption_needs_review/u)
assert.match(runner, /inspectMarkdownArtifact/u)
assert.match(runner, /输出包含模型自我分析或执行计划/u)
assert.match(runner, /输出疑似在半句话处截断/u)
assert.match(runner, /createMarkdownRepairPlan/u)
assert.match(runner, /numPredict:\s*1536/u)
assert.match(runner, /isPathInsideRoot/u)
assert.doesNotMatch(runner, /data[\\/]+temp[\\/]+local-ollama-samples/iu)
assert.doesNotMatch(runner, /sendMail|nodemailer|smtpTransport|tts|Obsidian/iu)
assert.doesNotMatch(runner, /api[_-]?key|SESSDATA|cookie/iu)

assert.match(queueExecutor, /runLocalConsumption\?: \(materialPath: string\)/u)
assert.match(queueExecutor, /tryRunLocalConsumption/u)
assert.match(queueExecutor, /isSubtitleOnly[\s\S]*tryRunLocalConsumption/u)
assert.match(queueExecutor, /本地总结需复核/u)
assert.match(queueExecutor, /本地总结失败/u)
assert.match(
  queueExecutor,
  /status:\s*'done'[\s\S]*lastError:\s*localConsumptionNote/u,
  '本地总结高风险或失败不能把字幕材料队列项改成 failed。',
)

assert.match(automationRuntime, /runLocalConsumption\?: \(materialPath: string\)/u)
assert.match(automationRuntime, /runLocalConsumption,/u)
assert.match(mainSource, /runLocalConsumptionForMaterial/u)
assert.match(mainSource, /runLocalConsumption:\s*\(materialPath\) => runLocalConsumptionForMaterial/u)

console.log('local consumption closure check passed')

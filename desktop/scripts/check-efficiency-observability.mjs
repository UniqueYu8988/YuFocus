import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const desktopRoot = join(import.meta.dirname, '..')
const inventory = readFileSync(join(desktopRoot, 'electron/services/materialInventory.ts'), 'utf8')
const stats = readFileSync(join(desktopRoot, 'electron/services/materialStats.ts'), 'utf8')
const utils = readFileSync(join(desktopRoot, 'src/ui/pages/WorkspacePaneUtils.ts'), 'utf8')
const archive = readFileSync(join(desktopRoot, 'src/ui/panels/workspace/ArchivePaneParts.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    console.error(message)
    process.exit(1)
  }
}

for (const field of [
  'metricsElapsedSeconds',
  'metricsInputTokens',
  'metricsOutputTokens',
  'metricsTotalTokens',
  'metricsMimoCredits',
]) {
  assert(inventory.includes(field), `material inventory must expose ${field}`)
}

assert(
  stats.includes('readMaterialMetricsSummary') &&
    stats.includes('elapsedSeconds') &&
    stats.includes('totalTokens') &&
    stats.includes('inputTokens') &&
    stats.includes('outputTokens') &&
    stats.includes('estimateMimoTokenPlanCredits') &&
    stats.includes('MIMO_TOKEN_PLAN_CREDIT_RATES'),
  'material stats must summarize timing and token metrics',
)

assert(
  utils.includes('formatElapsedSeconds') &&
    utils.includes('record.metricsElapsedSeconds') &&
    utils.includes('record.metricsMimoCredits') &&
    utils.includes('耗时 ${formatElapsedSeconds(record.metricsElapsedSeconds)}') &&
    utils.includes('MiMo Credits ${formatCompactNumber(record.metricsMimoCredits)}'),
  'queue record metadata must surface per-video elapsed time and MiMo Credits',
)

assert(
  archive.includes('totalElapsedSeconds') &&
    archive.includes('totalTokens') &&
    archive.includes('totalMimoCredits') &&
    archive.includes("label: '耗时'") &&
    archive.includes('value: formatElapsedSeconds(stats.totalElapsedSeconds)') &&
    archive.includes("label: 'MiMo Credits'") &&
    archive.includes('value: formatCompactNumber(stats.totalMimoCredits)'),
  'archive overview must keep aggregate elapsed time and MiMo Credits visible',
)

const queueMetaSection = utils.slice(
  utils.indexOf('export function getWorkbenchSourceMeta'),
  utils.indexOf('function createWorkbenchQueueId'),
)

for (const forbidden of [
  'sessdata',
  'SESSDATA',
  'api_key',
  'API Key',
  'smtp_password',
  'Cookie',
]) {
  assert(!queueMetaSection.includes(forbidden), `efficiency metadata must not expose secret-like field "${forbidden}"`)
}

console.log('efficiency observability check passed')

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const inventory = readFileSync(join(root, 'electron/services/materialInventory.ts'), 'utf8')
const stats = readFileSync(join(root, 'electron/services/materialStats.ts'), 'utf8')
const utils = readFileSync(join(root, 'src/ui/pages/WorkspacePaneUtils.ts'), 'utf8')
const archive = readFileSync(join(root, 'src/ui/panels/workspace/ArchivePaneParts.tsx'), 'utf8')

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
]) {
  assert(inventory.includes(field), `material inventory must expose ${field}`)
}

assert(
  stats.includes('readMaterialMetricsSummary') &&
    stats.includes('elapsedSeconds') &&
    stats.includes('totalTokens') &&
    stats.includes('inputTokens') &&
    stats.includes('outputTokens'),
  'material stats must summarize timing and token metrics',
)

assert(
  utils.includes('formatElapsedSeconds') &&
    utils.includes('record.metricsElapsedSeconds') &&
    utils.includes('record.metricsTotalTokens') &&
    utils.includes('耗时 ${formatElapsedSeconds(record.metricsElapsedSeconds)}') &&
    utils.includes('Token ${formatCompactNumber(record.metricsTotalTokens)}'),
  'queue record metadata must surface per-video elapsed time and token count',
)

assert(
  archive.includes('totalElapsedSeconds') &&
    archive.includes('totalTokens') &&
    archive.includes("label: '耗时'") &&
    archive.includes('value: formatElapsedSeconds(stats.totalElapsedSeconds)') &&
    archive.includes("label: 'Token'") &&
    archive.includes('value: formatCompactNumber(stats.totalTokens)'),
  'archive overview must keep aggregate elapsed time and token metrics visible',
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const queuePartsPath = join(root, 'src/ui/panels/workspace/WorkbenchQueueParts.tsx')
const workspacePath = join(root, 'src/ui/pages/WorkspacePane.tsx')
const utilsPath = join(root, 'src/ui/pages/WorkspacePaneUtils.ts')

const queueParts = readFileSync(queuePartsPath, 'utf8')
const workspace = readFileSync(workspacePath, 'utf8')
const utils = readFileSync(utilsPath, 'utf8')

function assert(condition, message) {
  if (!condition) {
    console.error(message)
    process.exit(1)
  }
}

assert(
  /WORKBENCH_RECORD_BATCH_SIZE\s*=\s*10/.test(utils),
  'queue record feed must start with at most 10 records',
)

assert(
  utils.includes('getVisibleWorkbenchRecordItems') && utils.includes('items.slice(0, Math.max(0, visibleCount))'),
  'queue record feed must slice by visible count instead of old fixed pagination',
)

assert(
  utils.includes("queue.status === 'done' ? 10 + records.length + index : queuePriority[queue.status]"),
  'completed queue-only records must not appear before real material records',
)

assert(
  utils.includes("item.queue?.status === 'skipped'") && utils.includes('skipped: 3'),
  'queue record feed must preserve skipped records with stable ordering',
)

assert(
  queueParts.includes('data-queue-record-feed="true"'),
  'queue panel must expose the lightweight record feed marker',
)

assert(
  queueParts.includes("queueItem?.status === 'skipped'"),
  'queue panel must show skipped reasons without offering automatic retry',
)

assert(
  queueParts.includes('overflow-y-auto') && queueParts.includes('onScroll={handleScroll}') && queueParts.includes('distanceToBottom <= 72'),
  'queue record feed must load more while scrolling near the bottom',
)

assert(
  queueParts.includes('继续加载') && queueParts.includes('onClick={onLoadMore}'),
  'queue record feed should keep a small manual load-more fallback',
)

for (const forbidden of [
  'FixedPageControls',
  'WorkbenchStatusLight',
  'CardContent',
  'Badge',
  'ArchiveRestore',
  'RefreshCcw',
  'Trash2',
  'onClear',
  'onDeleteMaterial',
  'onRemoveQueuedVideo',
]) {
  assert(!queueParts.includes(forbidden), `queue record feed should not bring back heavy control "${forbidden}"`)
}

assert(
  workspace.includes('visibleWorkbenchItems') &&
    workspace.includes('getVisibleWorkbenchRecordItems(workbenchSourceItems, workbenchRecordVisibleCount)') &&
    workspace.includes('Math.min(workbenchSourceItems.length, current + WORKBENCH_RECORD_BATCH_SIZE)'),
  'WorkspacePane must drive the queue panel with visible record count and load-more batches',
)

assert(
  !workspace.includes('clearWorkbenchQueue()') && !workspace.includes('onRemoveQueuedVideo={'),
  'queue page must not expose clear/remove operations in the lightweight record view',
)

console.log('queue record feed check passed')

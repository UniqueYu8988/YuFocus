import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
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
  /WORKBENCH_RECORD_BATCH_SIZE\s*=\s*5/.test(utils),
  'queue record feed must start with at most 5 records',
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
  queueParts.includes('IntersectionObserver') &&
    queueParts.includes('loadMoreRef') &&
    queueParts.includes('loadMoreArmedRef') &&
    queueParts.includes("rootMargin: '160px 0px'"),
  'queue record feed must load more through a bottom sentinel armed by downward scrolling',
)

assert(
  !queueParts.includes('max-h-[calc(100vh-210px)]') &&
    !queueParts.includes('overflow-y-auto') &&
    !queueParts.includes('onScroll={handleScroll}'),
  'queue record feed must not create a second scrollbar inside the page',
)

assert(
  queueParts.includes('继续加载') && queueParts.includes('onClick={onLoadMore}'),
  'queue record feed should keep a small manual load-more fallback',
)

assert(
  queueParts.includes('FileText') &&
    queueParts.includes('Mail') &&
    queueParts.includes('onOpenCleanFile') &&
    queueParts.includes('onOpenEmailFile') &&
    queueParts.includes('aria-label="打开清洗稿"') &&
    queueParts.includes('aria-label="打开 email 稿"') &&
    queueParts.includes('打开清洗稿（外部应用）') &&
    queueParts.includes('打开 email 稿（外部应用）'),
  'queue completed records must expose clean markdown and email markdown icon entries',
)

assert(
  !queueParts.includes('路径') &&
    !queueParts.includes('查看') &&
    !queueParts.includes('onCopyNotebookLmPath'),
  'queue completed record actions must not show old text buttons',
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
  'Copy',
  'GraduationCap',
]) {
  assert(!queueParts.includes(forbidden), `queue record feed should not bring back heavy control "${forbidden}"`)
}

assert(
  workspace.includes('visibleWorkbenchItems') &&
    workspace.includes('activeWorkbenchSourceItems') &&
    workspace.includes('getVisibleWorkbenchRecordItems(activeWorkbenchSourceItems, workbenchRecordVisibleCount)') &&
    workspace.includes('Math.min(activeWorkbenchSourceItems.length, current + WORKBENCH_RECORD_BATCH_SIZE)'),
  'WorkspacePane must drive the queue panel with visible active record count and load-more batches',
)

assert(
  workspace.includes('foldedWorkbenchIssueItems') &&
    workspace.includes('foldedIssueItems={foldedWorkbenchIssueItems}'),
  'failed and skipped queue-only records should be separated from the main record feed',
)

for (const statusLabel of ['排队中', '制作中', '已完成', '已跳过', '失败']) {
  assert(utils.includes(`label: '${statusLabel}'`) || queueParts.includes(`label: '${statusLabel}'`), `queue status should include concise label "${statusLabel}"`)
}

assert(
  queueParts.includes("status.tone === 'blue'") && queueParts.includes("status.tone === 'amber'"),
  'queue status badges must keep colorful blue and amber states',
)

assert(
  !workspace.includes('clearWorkbenchQueue()') && !workspace.includes('onRemoveQueuedVideo={'),
  'queue page must not expose clear/remove operations in the lightweight record view',
)

assert(
  !workspace.includes('description="查看已经加入队列的视频、处理状态和已生成资料。视频来源选择已前移到最近页和侧边栏。"'),
  'queue page title should not keep the explanatory subtitle under the heading',
)

console.log('queue record feed check passed')

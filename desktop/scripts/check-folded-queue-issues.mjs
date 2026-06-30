import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    console.error(message)
    process.exit(1)
  }
}

const utils = read('src/ui/pages/WorkspacePaneUtils.ts')
const workspace = read('src/ui/pages/WorkspacePane.tsx')
const queueParts = read('src/ui/panels/workspace/WorkbenchQueueParts.tsx')
const automationController = read('electron/runtime/automationController.ts')

assert(
  utils.includes('isFoldedWorkbenchQueueIssueItem') &&
    utils.includes("item.queue.status === 'failed' || item.queue.status === 'skipped'"),
  '必须集中定义 failed / skipped 队列问题项折叠规则。',
)

assert(
  workspace.includes('foldedWorkbenchIssueItems') &&
    workspace.includes('activeWorkbenchSourceItems') &&
    workspace.includes('!isFoldedWorkbenchQueueIssueItem(item)'),
  'WorkspacePane 必须把失败 / 跳过问题项从队列主列表分离出来。',
)

assert(
  workspace.includes('foldedIssueItems={foldedWorkbenchIssueItems}') &&
    workspace.includes('Math.min(activeWorkbenchSourceItems.length, current + WORKBENCH_RECORD_BATCH_SIZE)'),
  '队列滚动加载必须基于正常主列表，而不是被折叠问题项占用批次。',
)

assert(
  queueParts.includes('data-folded-queue-issues="true"') &&
    queueParts.includes('已折叠 {foldedIssueItems.length} 条无法获取的视频') &&
    queueParts.includes('不影响后续历史补全'),
  '队列页面必须提供默认折叠的失败 / 跳过视频汇总。',
)

assert(
  queueParts.includes('const queueItemCanRetry = Boolean(!folded') &&
    queueParts.includes('!folded && queueItem && (queueItem.status ===') &&
    queueParts.includes('folded ?'),
  '折叠问题项不能继续在默认区域提供重试入口。',
)

assert(
  automationController.includes('const foldedIssueCount = failedCount + skippedCount') &&
    automationController.includes("? `${foldedIssueCount} 项已折叠`") &&
    !automationController.includes('项需要重试'),
  '后台状态不能再把已失败视频描述为需要重试，避免影响正常流程判断。',
)

console.log('folded queue issue check passed')

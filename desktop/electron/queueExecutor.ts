import type { MaterialPackageSummary } from './materialInventory'
import { countProcessingWorkbenchItems, type EditorialSummaryMode, type WorkbenchQueueItem } from './workbenchQueue'

type DistillRequest = {
  video: string
  sourceKind: 'bilibili'
  editorialMode: EditorialSummaryMode
}

type DistillResultLike = {
  packagePath?: string
  materialPath?: string
}

type MaterialSummaryRequest = {
  materialPath: string
  editorialMode: EditorialSummaryMode
}

type MaterialSummaryResultLike = {
  editorialSummary?: Record<string, unknown>
}

export type QueueExecutorResult = {
  processed: number
  failed: number
  shouldContinue: boolean
}

export type QueueExecutorDeps<Settings, DistillResult extends DistillResultLike> = {
  reason: string
  concurrency: number
  loadQueue: () => WorkbenchQueueItem[]
  claimNextQueuedItem: () => WorkbenchQueueItem | null
  updateQueueItem: (queueId: string, patch: Partial<WorkbenchQueueItem>) => void
  loadSettings: () => Settings
  findMaterialRecordByBvid: (settings: Settings, bvid: string) => MaterialPackageSummary | null
  findMaterialRecordByPath: (settings: Settings, materialPath: string) => MaterialPackageSummary | null
  isMaterialRecordSummaryReady: (record: MaterialPackageSummary | null) => boolean
  isMaterialRecordCleaned: (record: MaterialPackageSummary | null) => boolean
  archiveMaterialRecord: (record: MaterialPackageSummary | null) => unknown
  pushMaterialEmail?: (record: MaterialPackageSummary | null) => Promise<unknown>
  runDistiller: (payload: DistillRequest) => Promise<DistillResult>
  runMaterialSummary: (payload: MaterialSummaryRequest) => Promise<MaterialSummaryResultLike>
  getMaterialPathFromDistillResult: (result: DistillResult) => string
  setAutomationStatus: (result: string, error: string | null) => void
  appendRuntimeLog: (message: string) => void
  broadcastStatus: () => void
}

function readSummaryStatus(result: MaterialSummaryResultLike) {
  const summaryPayload = result.editorialSummary && typeof result.editorialSummary === 'object'
    ? result.editorialSummary
    : {}
  const status = String(summaryPayload.status ?? '')
  if (!status || status === 'summary_ready') return ''
  return String(summaryPayload.error ?? summaryPayload.reason ?? '视频精读稿未完成。')
}

async function tryPushMaterialEmail<Settings, DistillResult extends DistillResultLike>(
  deps: QueueExecutorDeps<Settings, DistillResult>,
  record: MaterialPackageSummary | null,
) {
  if (!deps.pushMaterialEmail) return
  try {
    await deps.pushMaterialEmail(record)
  } catch (error) {
    deps.appendRuntimeLog(`workbench queue email push skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function runWorkbenchQueueExecutor<Settings, DistillResult extends DistillResultLike>(
  deps: QueueExecutorDeps<Settings, DistillResult>,
): Promise<QueueExecutorResult> {
  let processed = 0
  let failed = 0

  const queue = deps.loadQueue()
  const processingCount = countProcessingWorkbenchItems(queue)
  const queuedCount = queue.filter((item) => item.status === 'queued').length
  const workerCount = Math.max(0, Math.min(deps.concurrency - processingCount, queuedCount))
  if (workerCount <= 0) {
    return { processed, failed, shouldContinue: deps.loadQueue().some((item) => item.status === 'queued') }
  }

  const runWorker = async () => {
    while (true) {
      const target = deps.claimNextQueuedItem()
      if (!target) break

      deps.setAutomationStatus(`正在处理：${target.title}`, null)
      deps.appendRuntimeLog(`workbench queue processing reason=${deps.reason} queueId=${target.queueId} bvid=${target.bvid}`)
      deps.broadcastStatus()

      try {
        const settings = deps.loadSettings()
        const existingRecord = deps.findMaterialRecordByBvid(settings, target.bvid)
        let materialPath = existingRecord?.path || ''

        if (deps.isMaterialRecordSummaryReady(existingRecord)) {
          deps.archiveMaterialRecord(existingRecord)
          await tryPushMaterialEmail(deps, existingRecord)
          deps.updateQueueItem(target.queueId, {
            status: 'done',
            materialPath,
            lastError: '',
          })
          processed += 1
          deps.setAutomationStatus(`已复用：${target.title}`, null)
          continue
        }

        const editorialMode = target.editorialMode || 'force'
        if (!deps.isMaterialRecordCleaned(existingRecord)) {
          const distillResult = await deps.runDistiller({
            video: target.bvid,
            sourceKind: 'bilibili',
            editorialMode,
          })
          materialPath = deps.getMaterialPathFromDistillResult(distillResult)
          if (!materialPath) {
            throw new Error('字幕清洗完成但未返回资料目录。')
          }
        }

        if (editorialMode !== 'off') {
          const summaryResult = await deps.runMaterialSummary({
            materialPath,
            editorialMode,
          })
          const summaryError = readSummaryStatus(summaryResult)
          if (summaryError) throw new Error(summaryError)

          const summaryRecord = deps.findMaterialRecordByPath(deps.loadSettings(), materialPath)
          deps.archiveMaterialRecord(summaryRecord)
          await tryPushMaterialEmail(deps, summaryRecord)
        }

        deps.updateQueueItem(target.queueId, {
          status: 'done',
          materialPath,
          lastError: '',
        })
        processed += 1
        deps.setAutomationStatus(`已完成：${target.title}`, null)
      } catch (error) {
        failed += 1
        const message = error instanceof Error ? error.message : String(error)
        deps.updateQueueItem(target.queueId, {
          status: 'failed',
          lastError: message,
        })
        deps.setAutomationStatus(`处理失败：${target.title}`, message)
        deps.appendRuntimeLog(`workbench queue item failed queueId=${target.queueId} message=${message}`)
      }

      deps.broadcastStatus()
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return {
    processed,
    failed,
    shouldContinue: deps.loadQueue().some((item) => item.status === 'queued'),
  }
}

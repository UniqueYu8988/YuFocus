import type { MaterialPackageSummary } from '../services/materialInventory'
import {
  countProcessingWorkbenchItems,
  getNextWorkbenchQueueRetryAt,
  isWorkbenchQueueItemClaimable,
  sanitizePipelineMode,
  WORKBENCH_QUEUE_SINGLE_WORKER_LIMIT,
  type EditorialSummaryMode,
  type WorkbenchQueueItem,
} from './workbenchQueue'

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

type LocalConsumptionResultLike = {
  status?: 'ok' | 'needs_review' | 'failed' | string
  error?: string
}

export type QueueExecutorResult = {
  processed: number
  failed: number
  skipped: number
  shouldContinue: boolean
  nextRetryAt: number | null
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
  pushMaterialEmail?: (record: MaterialPackageSummary | null, context: { queueSource?: WorkbenchQueueItem['queueSource'] }) => Promise<unknown>
  runDistiller: (payload: DistillRequest) => Promise<DistillResult>
  runMaterialSummary: (payload: MaterialSummaryRequest) => Promise<MaterialSummaryResultLike>
  runLocalConsumption?: (materialPath: string) => Promise<LocalConsumptionResultLike>
  getMaterialPathFromDistillResult: (result: DistillResult) => string
  setAutomationStatus: (result: string, error: string | null) => void
  pauseAutomation?: (result: string, error: string | null) => void
  appendRuntimeLog: (message: string) => void
  broadcastStatus: () => void
}

const MAX_QUEUE_RETRY_COUNT = 3
const QUEUE_RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
]

function readSummaryStatus(result: MaterialSummaryResultLike) {
  const summaryPayload = result.editorialSummary && typeof result.editorialSummary === 'object'
    ? result.editorialSummary
    : {}
  const status = String(summaryPayload.status ?? '')
  if (!status || status === 'summary_ready') return ''
  return String(summaryPayload.error ?? summaryPayload.reason ?? '视频精读稿未完成。')
}

function isConfigurationQueueError(message: string) {
  return /SESSDATA|登录|配置|凭证|Cookie|cookie|unauthorized|forbidden|401|403|API Key|授权/i.test(message)
}

export function isNonRetryableMediaAccessError(message: string) {
  return /充电|付费|权限|无权限|不可访问|无法访问|会员|大会员|试看|付费专属|charge|paid|paywall|upower|HTTP Error 412|HTTP 412|Precondition Failed|playurl 未返回可用音频轨/i.test(message)
}

function getRetryDelayMs(retryCount: number) {
  return QUEUE_RETRY_DELAYS_MS[Math.min(retryCount, QUEUE_RETRY_DELAYS_MS.length - 1)]
}

async function tryPushMaterialEmail<Settings, DistillResult extends DistillResultLike>(
  deps: QueueExecutorDeps<Settings, DistillResult>,
  record: MaterialPackageSummary | null,
  queueSource?: WorkbenchQueueItem['queueSource'],
) {
  if (!deps.pushMaterialEmail) return
  if (queueSource !== 'fresh') return
  try {
    await deps.pushMaterialEmail(record, { queueSource })
  } catch (error) {
    deps.appendRuntimeLog(`workbench queue email push skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function tryRunLocalConsumption<Settings, DistillResult extends DistillResultLike>(
  deps: QueueExecutorDeps<Settings, DistillResult>,
  materialPath: string,
) {
  if (!deps.runLocalConsumption || !materialPath) return ''
  try {
    const result = await deps.runLocalConsumption(materialPath)
    if (result.status === 'needs_review') return '本地总结需复核。'
    if (result.status === 'failed') return `本地总结失败：${result.error || '请稍后重试。'}`
    return ''
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.appendRuntimeLog(`workbench queue local consumption skipped materialPath=${materialPath} message=${message}`)
    return `本地总结失败：${message}`
  }
}

export async function runWorkbenchQueueExecutor<Settings, DistillResult extends DistillResultLike>(
  deps: QueueExecutorDeps<Settings, DistillResult>,
): Promise<QueueExecutorResult> {
  let processed = 0
  let failed = 0
  let skipped = 0

  const queue = deps.loadQueue()
  const processingCount = countProcessingWorkbenchItems(queue)
  const queuedCount = queue.filter((item) => isWorkbenchQueueItemClaimable(item)).length
  const workerCount = Math.max(0, Math.min(
    WORKBENCH_QUEUE_SINGLE_WORKER_LIMIT - processingCount,
    queuedCount,
  ))
  if (workerCount <= 0) {
    const nextQueue = deps.loadQueue()
    return {
      processed,
      failed,
      skipped,
      shouldContinue: nextQueue.some((item) => isWorkbenchQueueItemClaimable(item)),
      nextRetryAt: getNextWorkbenchQueueRetryAt(nextQueue),
    }
  }

  const target = deps.claimNextQueuedItem()
  if (!target) {
    const nextQueue = deps.loadQueue()
    return {
      processed,
      failed,
      skipped,
      shouldContinue: nextQueue.some((item) => isWorkbenchQueueItemClaimable(item)),
      nextRetryAt: getNextWorkbenchQueueRetryAt(nextQueue),
    }
  }

  deps.setAutomationStatus(`正在处理：${target.title}`, null)
  deps.appendRuntimeLog(`workbench queue processing reason=${deps.reason} queueId=${target.queueId} bvid=${target.bvid}`)
  deps.broadcastStatus()

  try {
    const settings = deps.loadSettings()
    const existingRecord = deps.findMaterialRecordByBvid(settings, target.bvid)
    let materialPath = existingRecord?.path || ''
    const editorialMode = target.editorialMode || 'force'
    const pipelineMode = sanitizePipelineMode(target.pipelineMode, editorialMode)
    const isSubtitleOnly = pipelineMode === 'subtitle_only'
    const effectiveEditorialMode: EditorialSummaryMode = isSubtitleOnly ? 'off' : editorialMode

    if (isSubtitleOnly && deps.isMaterialRecordCleaned(existingRecord)) {
      const localConsumptionNote = await tryRunLocalConsumption(deps, materialPath)
      const refreshedRecord = deps.findMaterialRecordByPath(deps.loadSettings(), materialPath) || existingRecord
      if (!localConsumptionNote) {
        await tryPushMaterialEmail(deps, refreshedRecord, target.queueSource)
      }
      deps.updateQueueItem(target.queueId, {
          status: 'done',
          materialPath,
          lastError: localConsumptionNote,
          nextRetryAt: 0,
          failedAt: 0,
        })
      processed += 1
      deps.setAutomationStatus(`已复用：${target.title}`, null)
    } else if (!isSubtitleOnly && deps.isMaterialRecordSummaryReady(existingRecord)) {
      deps.archiveMaterialRecord(existingRecord)
      await tryPushMaterialEmail(deps, existingRecord, target.queueSource)
      deps.updateQueueItem(target.queueId, {
        status: 'done',
        materialPath,
        lastError: '',
        nextRetryAt: 0,
        failedAt: 0,
      })
      processed += 1
      deps.setAutomationStatus(`已复用：${target.title}`, null)
    } else {
      if (!deps.isMaterialRecordCleaned(existingRecord)) {
        const distillResult = await deps.runDistiller({
          video: target.bvid,
          sourceKind: 'bilibili',
          editorialMode: effectiveEditorialMode,
        })
        materialPath = deps.getMaterialPathFromDistillResult(distillResult)
        if (!materialPath) {
          throw new Error('字幕清洗完成但未返回资料目录。')
        }
      }

      if (!isSubtitleOnly && effectiveEditorialMode !== 'off') {
        const summaryResult = await deps.runMaterialSummary({
          materialPath,
          editorialMode: effectiveEditorialMode,
        })
        const summaryError = readSummaryStatus(summaryResult)
        if (summaryError) throw new Error(summaryError)

        const summaryRecord = deps.findMaterialRecordByPath(deps.loadSettings(), materialPath)
        deps.archiveMaterialRecord(summaryRecord)
        await tryPushMaterialEmail(deps, summaryRecord, target.queueSource)
      }

      const localConsumptionNote = isSubtitleOnly
        ? await tryRunLocalConsumption(deps, materialPath)
        : ''
      const refreshedRecord = deps.findMaterialRecordByPath(deps.loadSettings(), materialPath)
      if (isSubtitleOnly && !localConsumptionNote) {
        await tryPushMaterialEmail(deps, refreshedRecord, target.queueSource)
      }
      deps.updateQueueItem(target.queueId, {
        status: 'done',
        materialPath,
        lastError: localConsumptionNote,
        nextRetryAt: 0,
        failedAt: 0,
      })
      processed += 1
      deps.setAutomationStatus(`已完成：${target.title}`, null)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const retryCount = Math.max(0, Number(target.retryCount ?? 0) || 0)
    const failedAt = Date.now()
    if (isConfigurationQueueError(message)) {
      failed += 1
      deps.updateQueueItem(target.queueId, {
        status: 'failed',
        lastError: message,
        failedAt,
      })
      deps.pauseAutomation?.(`配置失败，已暂停自动化：${target.title}`, message)
      deps.setAutomationStatus(`配置失败：${target.title}`, message)
      deps.appendRuntimeLog(`workbench queue config failure paused automation queueId=${target.queueId} message=${message}`)
    } else if (isNonRetryableMediaAccessError(message)) {
      skipped += 1
      deps.updateQueueItem(target.queueId, {
        status: 'skipped',
        retryCount,
        nextRetryAt: 0,
        failedAt,
        lastError: `已跳过：疑似付费、充电或权限受限视频。${message}`,
      })
      deps.setAutomationStatus(`已跳过：${target.title}`, message)
      deps.appendRuntimeLog(`workbench queue item skipped queueId=${target.queueId} reason=non_retryable_media_access message=${message}`)
    } else if (retryCount < MAX_QUEUE_RETRY_COUNT) {
      failed += 1
      const nextRetryAt = failedAt + getRetryDelayMs(retryCount)
      deps.updateQueueItem(target.queueId, {
        status: 'queued',
        queueSource: 'retry',
        retryCount: retryCount + 1,
        nextRetryAt,
        failedAt,
        lastError: message,
      })
      deps.setAutomationStatus(`等待重试：${target.title}`, message)
      deps.appendRuntimeLog(`workbench queue item scheduled retry queueId=${target.queueId} retry=${retryCount + 1}/${MAX_QUEUE_RETRY_COUNT} nextRetryAt=${new Date(nextRetryAt).toISOString()} message=${message}`)
    } else {
      failed += 1
      deps.updateQueueItem(target.queueId, {
        status: 'failed',
        retryCount,
        nextRetryAt: 0,
        failedAt,
        lastError: message,
      })
      deps.setAutomationStatus(`处理失败：${target.title}`, message)
      deps.appendRuntimeLog(`workbench queue item failed queueId=${target.queueId} retry=${retryCount}/${MAX_QUEUE_RETRY_COUNT} message=${message}`)
    }
  }

  deps.broadcastStatus()
  const nextQueue = deps.loadQueue()
  return {
    processed,
    failed,
    skipped,
    shouldContinue: nextQueue.some((item) => isWorkbenchQueueItemClaimable(item)),
    nextRetryAt: getNextWorkbenchQueueRetryAt(nextQueue),
  }
}

import type { BrowserWindow } from 'electron'
import {
  createAutomationController,
  type BackgroundAutomationStatus,
} from './automationController'
import type {
  DistillPayload,
  DistillResult,
  MaterialSummaryPayload,
  MaterialSummaryResult,
} from './backendRuntime'
import { pushEditorialArticleEmail } from './emailPush'
import type { MaterialPackageSummary } from './materialInventory'
import { runWorkbenchQueueExecutor } from './queueExecutor'
import type { RuntimeSettings } from './settings'
import type { SourceDiscoveryResult } from './sourceDiscovery'
import type { WorkbenchQueueItem } from './workbenchQueue'

type AutomationRuntimeDeps = {
  appId: string
  checkIntervalMinutes: number
  queueConcurrency: number
  loadSettings: () => RuntimeSettings
  readPaused: () => boolean
  writePaused: (paused: boolean) => void
  loadPinnedSources: () => unknown[]
  discoverPinnedSourceVideos: (settings?: RuntimeSettings) => Promise<SourceDiscoveryResult>
  appendQueueItems: (items: WorkbenchQueueItem[]) => WorkbenchQueueItem[]
  loadQueue: () => WorkbenchQueueItem[]
  recoverQueue: (reason: string) => WorkbenchQueueItem[]
  claimNextQueuedItem: () => WorkbenchQueueItem | null
  updateQueueItem: (queueId: string, patch: Partial<WorkbenchQueueItem>) => void
  findMaterialRecordByBvid: (settings: RuntimeSettings, bvid: string) => MaterialPackageSummary | null
  findMaterialRecordByPath: (settings: RuntimeSettings, materialPath: string) => MaterialPackageSummary | null
  isMaterialRecordSummaryReady: (record: MaterialPackageSummary | null) => boolean
  isMaterialRecordCleaned: (record: MaterialPackageSummary | null) => boolean
  archiveMaterialRecord: (record: MaterialPackageSummary | null) => unknown
  runDistiller: (payload: DistillPayload) => Promise<DistillResult>
  runMaterialSummary: (payload: MaterialSummaryPayload) => Promise<MaterialSummaryResult>
  getMaterialPathFromDistillResult: (result: DistillResult) => string
  appendRuntimeLog: (message: string) => void
  getMainWindow: () => BrowserWindow | null
  updateTrayMenu: () => void
}

export function createAutomationRuntime({
  appId,
  checkIntervalMinutes,
  queueConcurrency,
  loadSettings,
  readPaused,
  writePaused,
  loadPinnedSources,
  discoverPinnedSourceVideos,
  appendQueueItems,
  loadQueue,
  recoverQueue,
  claimNextQueuedItem,
  updateQueueItem,
  findMaterialRecordByBvid,
  findMaterialRecordByPath,
  isMaterialRecordSummaryReady,
  isMaterialRecordCleaned,
  archiveMaterialRecord,
  runDistiller,
  runMaterialSummary,
  getMaterialPathFromDistillResult,
  appendRuntimeLog,
  getMainWindow,
  updateTrayMenu,
}: AutomationRuntimeDeps) {
  const controller = createAutomationController({
    checkIntervalMinutes,
    loadSettings,
    readPaused,
    writePaused,
    loadPinnedSources,
    discoverPinnedSourceVideos,
    appendQueueItems,
    loadQueue,
    recoverQueue,
    runQueue: (reason, controls) => runWorkbenchQueueExecutor({
      reason,
      concurrency: queueConcurrency,
      loadQueue,
      claimNextQueuedItem,
      updateQueueItem,
      loadSettings,
      findMaterialRecordByBvid,
      findMaterialRecordByPath,
      isMaterialRecordSummaryReady,
      isMaterialRecordCleaned,
      archiveMaterialRecord,
      pushMaterialEmail: (record) => pushEditorialArticleEmail({
        settings: loadSettings(),
        appId,
        record,
      }),
      runDistiller,
      runMaterialSummary,
      getMaterialPathFromDistillResult,
      setAutomationStatus: controls.setStatus,
      appendRuntimeLog,
      broadcastStatus: controls.broadcastStatus,
    }),
    appendRuntimeLog,
    emitStatus: (status) => {
      const targetWindow = getMainWindow()
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('automation:status', status)
      }
      updateTrayMenu()
    },
  })

  const getBackgroundAutomationStatus = (): BackgroundAutomationStatus => controller.getStatus()

  return {
    getBackgroundAutomationStatus,
    isQueueProcessing: () => controller.isQueueProcessing(),
    refreshBackgroundAutomationSchedule: (delayMs?: number) => controller.refreshSchedule(delayMs),
    runBackgroundAutomationCheck: (trigger: 'timer' | 'manual' | 'startup' = 'manual') => controller.runCheck(trigger),
    scheduleWorkbenchQueueProcessing: (reason: string) => controller.scheduleQueueProcessing(reason),
    setBackgroundAutomationPaused: (paused: boolean) => controller.setPaused(paused),
    shutdownAutomation: () => controller.shutdown(),
  }
}

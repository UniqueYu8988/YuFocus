import type { BrowserWindow } from 'electron'
import {
  createAutomationController,
  type BackgroundAutomationPauseState,
  type BackgroundAutomationStatus,
} from './automationController'
import type {
  DistillPayload,
  DistillResult,
  MaterialSummaryPayload,
  MaterialSummaryResult,
} from './backendRuntime'
import type { MaterialPackageSummary } from '../services/materialInventory'
import { runWorkbenchQueueExecutor } from '../queue/queueExecutor'
import type { RuntimeSettings } from './settings'
import type { SourceDiscoveryResult } from '../providers/sourceDiscovery'
import type { WorkbenchQueueItem } from '../queue/workbenchQueue'

type AutomationRuntimeDeps = {
  checkIntervalMinutes: number
  queueConcurrency: number
  loadSettings: () => RuntimeSettings
  readPauseState: () => BackgroundAutomationPauseState | boolean | undefined
  writePauseState: (state: BackgroundAutomationPauseState) => void
  loadPinnedSources: () => unknown[]
  discoverPinnedSourceVideos: (settings?: RuntimeSettings, trigger?: string) => Promise<SourceDiscoveryResult>
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
  pushMaterialEmail?: (record: MaterialPackageSummary | null, context: { queueSource?: WorkbenchQueueItem['queueSource'] }) => Promise<unknown>
  runDistiller: (payload: DistillPayload) => Promise<DistillResult>
  runMaterialSummary: (payload: MaterialSummaryPayload) => Promise<MaterialSummaryResult>
  runLocalConsumption?: (materialPath: string) => Promise<{ status?: string; error?: string }>
  getMaterialPathFromDistillResult: (result: DistillResult) => string
  appendRuntimeLog: (message: string) => void
  getMainWindow: () => BrowserWindow | null
  updateTrayMenu: () => void
}

export function createAutomationRuntime({
  checkIntervalMinutes,
  queueConcurrency,
  loadSettings,
  readPauseState,
  writePauseState,
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
  pushMaterialEmail,
  runDistiller,
  runMaterialSummary,
  runLocalConsumption,
  getMaterialPathFromDistillResult,
  appendRuntimeLog,
  getMainWindow,
  updateTrayMenu,
}: AutomationRuntimeDeps) {
  const normalizePauseState = (): BackgroundAutomationPauseState => {
    const raw = readPauseState()
    if (typeof raw === 'boolean') {
      return { paused: raw, pausedUntil: null, reason: raw ? 'manual' : '' }
    }
    const pausedUntil = Number(raw?.pausedUntil ?? 0) || null
    const paused = Boolean(raw?.paused)
    const reason = raw?.reason === 'duration' || raw?.reason === 'manual' ? raw.reason : paused ? 'manual' : ''
    if (paused && pausedUntil && pausedUntil <= Date.now()) {
      const next: BackgroundAutomationPauseState = { paused: false, pausedUntil: null, reason: '' }
      writePauseState(next)
      return next
    }
    return {
      paused,
      pausedUntil: paused ? pausedUntil : null,
      reason: paused ? reason : '',
    }
  }

  const controller = createAutomationController({
    checkIntervalMinutes,
    loadSettings,
    readPauseState: normalizePauseState,
    writePauseState,
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
      pushMaterialEmail,
      runDistiller,
      runMaterialSummary,
      runLocalConsumption,
      getMaterialPathFromDistillResult,
      setAutomationStatus: controls.setStatus,
      pauseAutomation: controls.pauseAutomation,
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
    setBackgroundAutomationPaused: (paused: boolean, durationMs?: number) => controller.setPaused(paused, durationMs),
    shutdownAutomation: () => controller.shutdown(),
  }
}

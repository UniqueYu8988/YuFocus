import { app } from 'electron'
import path from 'node:path'
import { registerAppLifecycle } from './runtime/appLifecycle'
import { createAutomationRuntime } from './runtime/automationRuntime'
import {
  createBackendRuntime,
  type DistillProgressPayload,
} from './runtime/backendRuntime'
import {
  registerDialogIpcHandlers,
} from './ipc/dialogHandlers'
import { createMaterialDeletion } from './services/materialDeletion'
import {
  listMaterialPackages as scanMaterialPackages,
} from './services/materialInventory'
import { createLearningLibraryRuntime } from './legacy/learningLibraryRuntime'
import { registerLearningLibraryIpcHandlers } from './ipc/learningLibraryIpcHandlers'
import {
  findKnowledgeRecordForMaterial,
  loadKnowledgeLibraryFile,
  resolveKnowledgeOutputDir,
  saveKnowledgeLibraryFile,
} from './services/knowledgeLibrary'
import { registerKnowledgeIpcHandlers } from './ipc/knowledgeIpcHandlers'
import { registerSettingsAutomationIpcHandlers } from './ipc/settingsAutomationIpcHandlers'
import { registerSystemIpcHandlers } from './ipc/systemIpcHandlers'
import { createPinnedSourcesStore } from './services/pinnedSourcesStore'
import { createTrackedSourcesStore } from './services/trackedSourcesStore'
import { createSourceDiscoveryRuntime } from './providers/sourceDiscoveryRuntime'
import { createMaterialRecordBridge } from './services/materialRecordBridge'
import { runLocalConsumptionForMaterial } from './services/localConsumptionRunner'
import { pushFreshMaterialEmail } from './services/emailDeliveryService'
import { resolveVideoRegistryRoot } from './services/videoRegistry'
import {
  createRuntimePaths,
  createSettingsDefaultsContext as createRuntimeSettingsDefaultsContext,
  resolveCanonicalOutputRoot,
  resolveCourseImportDefaultPath as resolveRuntimeCourseImportDefaultPath,
  resolveMaterialOutputDir as resolveMaterialOutputDirectory,
} from './runtime/runtimePaths'
import {
  createRuntimeStores,
  migrateLegacyRuntimeStoreIfNeeded,
} from './runtime/runtimeStores'
import { createRuntimeLogger } from './runtime/runtimeLogger'
import {
  type RuntimeSettings,
} from './runtime/settings'
import { createSettingsRuntime } from './runtime/settingsRuntime'
import { registerMaterialIpcHandlers } from './ipc/materialIpcHandlers'
import { registerBilibiliSourceIpcHandlers } from './ipc/sourceIpcHandlers'
import {
  createWindowController,
} from './runtime/windowController'
import { registerWindowIpcHandlers } from './ipc/windowIpcHandlers'
import { registerWorkbenchQueueIpcHandlers } from './ipc/workbenchQueueIpcHandlers'
import { createWorkbenchQueueStore } from './queue/workbenchQueueStore'
import { isWorkbenchQueueItemClaimable } from './queue/workbenchQueue'

const APP_NAME = '视界专注'
const APP_ID = 'ShijieFocus'
const APP_PROTOCOL = 'shijiefocus'

app.name = APP_NAME
app.setAppUserModelId(APP_ID)

const WINDOW_DEFAULT_WIDTH = 1280
const WINDOW_DEFAULT_HEIGHT = 800
const WINDOW_MIN_WIDTH = 1000
const WINDOW_MIN_HEIGHT = 700
const DISTILL_PROCESS_TIMEOUT_MS = Number(process.env.SHIJIE_DISTILL_PROCESS_TIMEOUT_MS || process.env.ONBOARD_DISTILL_PROCESS_TIMEOUT_MS || 1_800_000)
const BACKGROUND_DISCOVERY_WINDOW_MS = 24 * 60 * 60 * 1000
const BILIBILI_SOURCE_QUERY_BATCH_SIZE = 12
const BILIBILI_RECENT_VIDEO_PAGE_SIZE = 20
const BILIBILI_HISTORY_BACKFILL_PAGE_SIZE = 30
const BACKGROUND_CHECK_INTERVAL_MINUTES = 60
const WORKBENCH_QUEUE_CONCURRENCY = 1

const runtimePaths = createRuntimePaths({
  isPackaged: app.isPackaged,
  userDataRoot: app.getPath('userData'),
  resourcesPath: process.resourcesPath,
  execPath: process.execPath,
  cwd: process.cwd(),
  moduleDir: __dirname,
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
})

const {
  devProjectRoot,
  dataRoot,
  canonicalDataRoot,
  userDataRoot,
  settingsPath,
  windowStatePath,
  legacyWindowStatePath,
  runtimeLogPath,
  iconPath,
} = runtimePaths
const videoRegistryRoot = resolveVideoRegistryRoot(canonicalDataRoot)

const {
  appendRuntimeLog,
} = createRuntimeLogger(runtimeLogPath)

function createSettingsDefaultsContext() {
  return createRuntimeSettingsDefaultsContext({
    devProjectRoot,
    dataRoot,
    cwd: process.cwd(),
    backgroundCheckIntervalMinutes: BACKGROUND_CHECK_INTERVAL_MINUTES,
    workbenchQueueConcurrency: WORKBENCH_QUEUE_CONCURRENCY,
  })
}

const {
  secureStore,
  legacySecureStore,
} = createRuntimeStores()

const learningLibraryRuntime = createLearningLibraryRuntime({
  read: () => secureStore.get('learningLibrary'),
  write: (next) => secureStore.set('learningLibrary', next),
})

const {
  deleteLearningRecord,
  loadLearningLibraryPayload,
  loadLearningLibraryState,
  openLearningRecord,
  refreshLearningLibraryStructure,
  saveArchivedLearningRecord,
  saveLearningLibraryState,
  upsertLearningRecord,
} = learningLibraryRuntime

const settingsRuntime = createSettingsRuntime({
  readSettings: () => secureStore.get('runtimeSettings'),
  writeSettings: (settings) => secureStore.set('runtimeSettings', settings),
  createDefaultsContext: createSettingsDefaultsContext,
  afterSave: () => {
    refreshBackgroundAutomationSchedule()
    scheduleWorkbenchQueueProcessing('settings-save')
  },
})

const {
  loadSettings,
  normalizeRuntimeSettings,
  saveSettings,
} = settingsRuntime

migrateLegacyRuntimeStoreIfNeeded({
  secureStore,
  legacySecureStore,
  normalizeRuntimeSettings,
})

function broadcastWorkbenchQueueChanged(items = loadWorkbenchQueue()) {
  const targetWindow = windowController.getMainWindow()
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send('workbench:queue:changed', items)
  }
}

const workbenchQueueStore = createWorkbenchQueueStore({
  readQueue: () => secureStore.get('workbenchQueue'),
  writeQueue: (items) => secureStore.set('workbenchQueue', items),
  broadcastQueueChanged: broadcastWorkbenchQueueChanged,
  scheduleProcessing: (reason) => scheduleWorkbenchQueueProcessing(reason),
  isQueueProcessing: () => automationRuntime.isQueueProcessing(),
  appendRuntimeLog,
  concurrency: WORKBENCH_QUEUE_CONCURRENCY,
})

const {
  appendQueueItems: appendWorkbenchQueueItems,
  claimNextQueuedItem: claimNextQueuedWorkbenchItem,
  loadQueue: loadWorkbenchQueue,
  recoverInterruptedQueue: recoverInterruptedWorkbenchQueue,
  saveQueue: saveWorkbenchQueue,
  saveQueueDirect: saveWorkbenchQueueDirect,
  updateQueueItem: updateWorkbenchQueueItem,
} = workbenchQueueStore

const pinnedSourcesStore = createPinnedSourcesStore({
  readPinnedSources: () => secureStore.get('pinnedBilibiliSources'),
  writePinnedSources: (items) => secureStore.set('pinnedBilibiliSources', items),
})

const {
  loadPinnedSources: loadPinnedBilibiliSources,
  savePinnedSources: savePinnedBilibiliSourcesRaw,
} = pinnedSourcesStore

const trackedSourcesStore = createTrackedSourcesStore({
  readTrackedSources: () => secureStore.get('trackedBilibiliSources'),
  writeTrackedSources: (items) => secureStore.set('trackedBilibiliSources', items),
})

const {
  loadTrackedSources: loadTrackedBilibiliSources,
  saveTrackedSources: saveTrackedBilibiliSources,
  syncTrackedSourcesWithPinnedSources,
} = trackedSourcesStore

const savePinnedBilibiliSources = (items: unknown) => {
  const pinnedSources = savePinnedBilibiliSourcesRaw(items)
  syncTrackedSourcesWithPinnedSources(pinnedSources)
  return pinnedSources
}

syncTrackedSourcesWithPinnedSources(loadPinnedBilibiliSources())

const loadFreshTrackedBilibiliSources = () => loadTrackedBilibiliSources()
  .filter((source) => source.trackFresh)
  .sort((left, right) => left.priority - right.priority || right.pinnedAt - left.pinnedAt)

const loadHistoryTrackedBilibiliSources = () => loadTrackedBilibiliSources()
  .filter((source) => source.trackHistory)
  .sort((left, right) => left.priority - right.priority || right.pinnedAt - left.pinnedAt)

const hasClaimableWorkbenchItems = () => loadWorkbenchQueue().some((item) => isWorkbenchQueueItemClaimable(item))

const sourceDiscoveryRuntime = createSourceDiscoveryRuntime({
  loadSettings,
  loadPinnedSources: loadFreshTrackedBilibiliSources,
  loadHistorySources: loadHistoryTrackedBilibiliSources,
  loadQueue: loadWorkbenchQueue,
  listMaterialPackages,
  appendRuntimeLog,
  registryRoot: videoRegistryRoot,
  discoveryWindowMs: BACKGROUND_DISCOVERY_WINDOW_MS,
  sourceQueryBatchSize: BILIBILI_SOURCE_QUERY_BATCH_SIZE,
  recentVideoPageSize: BILIBILI_RECENT_VIDEO_PAGE_SIZE,
})

const {
  discoverHistoryBackfillVideoForWorkbench,
  fetchHistoryBackfillPageForWorkbench,
  discoverPinnedSourceVideosForWorkbench,
} = sourceDiscoveryRuntime

const discoverFreshTrackedSourceVideosForWorkbench = async (settings = loadSettings(), trigger = 'timer') => {
  const trackedSources = loadTrackedBilibiliSources()
  const freshTrackedSourceIds = new Set(trackedSources.filter((source) => source.trackFresh).map((source) => source.mid))
  const result = trigger === 'idle-backfill'
    ? { discovered: [], checkedSourceCount: 0, totalVideoCount: 0 }
    : await discoverPinnedSourceVideosForWorkbench(settings)
  if (result.checkedSourceCount > 0 && freshTrackedSourceIds.size > 0) {
    const now = Date.now()
    saveTrackedBilibiliSources(trackedSources.map((source) => (
      freshTrackedSourceIds.has(source.mid)
        ? { ...source, lastCheckedAt: now, updatedAt: now }
        : source
    )))
  }
  if (result.discovered.length || hasClaimableWorkbenchItems()) return result

  let historyItem = discoverHistoryBackfillVideoForWorkbench(settings)
  if (!historyItem) {
    const trackedSources = loadTrackedBilibiliSources()
    const targetSource = trackedSources
      .filter((source) => source.trackHistory && !source.historyReachedEnd && source.historyStatus !== 'completed')
      .sort((left, right) => left.priority - right.priority || right.pinnedAt - left.pinnedAt)[0]
    if (!targetSource) return result

    const nextPage = Math.max(1, (targetSource.historyPage || 0) + 1)
    try {
      const pageResult = await fetchHistoryBackfillPageForWorkbench(
        targetSource,
        nextPage,
        BILIBILI_HISTORY_BACKFILL_PAGE_SIZE,
        settings,
      )
      const now = Date.now()
      saveTrackedBilibiliSources(trackedSources.map((source) => (
        source.mid === targetSource.mid
          ? {
              ...source,
              historyPage: pageResult.page,
              historyReachedEnd: !pageResult.hasMore,
              historyStatus: pageResult.hasMore ? 'running' : 'completed',
              updatedAt: now,
            }
          : source
      )))
      historyItem = discoverHistoryBackfillVideoForWorkbench(settings)
    } catch (error) {
      const now = Date.now()
      saveTrackedBilibiliSources(trackedSources.map((source) => (
        source.mid === targetSource.mid
          ? {
              ...source,
              historyStatus: 'failed',
              updatedAt: now,
            }
          : source
      )))
      appendRuntimeLog(`history backfill page failed mid=${targetSource.mid} page=${nextPage}: ${error instanceof Error ? error.message : String(error)}`)
      return result
    }
  }
  if (!historyItem) return result

  return {
    ...result,
    discovered: [historyItem],
  }
}

const materialRecordBridge = createMaterialRecordBridge({
  listMaterialPackages,
  saveArchivedLearningRecord,
  appendRuntimeLog,
})

const {
  archiveMaterialByPath,
  archiveMaterialRecord,
  buildArchivedLearningRecord,
  findMaterialRecordByBvid,
  findMaterialRecordByPath,
  getMaterialPathFromDistillResult,
  isMaterialRecordCleaned,
  isMaterialRecordSummaryReady,
} = materialRecordBridge

async function pushMaterialEmail(
  record: ReturnType<typeof findMaterialRecordByPath> | null,
  context: { queueSource?: Parameters<typeof pushFreshMaterialEmail>[0]['queueSource'] },
) {
  if (!record?.path) {
    appendRuntimeLog('fresh email delivery skipped: missing material record')
    return
  }
  const result = await pushFreshMaterialEmail({
    materialPath: record.path,
    queueSource: context.queueSource,
    settings: loadSettings(),
    appendRuntimeLog,
  })
  appendRuntimeLog(`fresh email delivery ${result.status}: ${result.reason}`)
}

const backendRuntime = createBackendRuntime({
  devProjectRoot,
  dataRoot,
  userDataRoot,
  settingsPath,
  resourcesPath: process.resourcesPath,
  execPath: process.execPath,
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  distillProcessTimeoutMs: DISTILL_PROCESS_TIMEOUT_MS,
  loadSettings,
  resolveMaterialOutputDir,
  appendRuntimeLog,
  emitDistillProgress,
})

const {
  runPythonDistiller,
  runPythonMaterialSummary,
} = backendRuntime

const automationRuntime = createAutomationRuntime({
  checkIntervalMinutes: BACKGROUND_CHECK_INTERVAL_MINUTES,
  queueConcurrency: WORKBENCH_QUEUE_CONCURRENCY,
  loadSettings,
  readPauseState: () => secureStore.get('backgroundAutomationPause') ?? Boolean(secureStore.get('backgroundAutomationPaused')),
  writePauseState: (pauseState) => {
    secureStore.set('backgroundAutomationPause', pauseState)
    secureStore.set('backgroundAutomationPaused', pauseState.paused)
  },
  loadPinnedSources: loadFreshTrackedBilibiliSources,
  discoverPinnedSourceVideos: discoverFreshTrackedSourceVideosForWorkbench,
  appendQueueItems: appendWorkbenchQueueItems,
  loadQueue: loadWorkbenchQueue,
  recoverQueue: recoverInterruptedWorkbenchQueue,
  claimNextQueuedItem: claimNextQueuedWorkbenchItem,
  updateQueueItem: updateWorkbenchQueueItem,
  findMaterialRecordByBvid,
  findMaterialRecordByPath,
  isMaterialRecordSummaryReady,
  isMaterialRecordCleaned,
  archiveMaterialRecord,
  pushMaterialEmail,
  runDistiller: runPythonDistiller,
  runMaterialSummary: runPythonMaterialSummary,
  runLocalConsumption: (materialPath) => runLocalConsumptionForMaterial(materialPath, { appendRuntimeLog }),
  getMaterialPathFromDistillResult,
  appendRuntimeLog,
  getMainWindow: () => windowController.getMainWindow(),
  updateTrayMenu: () => windowController.updateTrayMenu(),
})

const {
  getBackgroundAutomationStatus,
  refreshBackgroundAutomationSchedule,
  runBackgroundAutomationCheck,
  scheduleWorkbenchQueueProcessing,
  setBackgroundAutomationPaused,
} = automationRuntime

const windowController = createWindowController({
  appName: APP_NAME,
  appProtocol: APP_PROTOCOL,
  iconPath,
  dataRoot,
  windowStatePath,
  legacyWindowStatePath,
  defaultWidth: WINDOW_DEFAULT_WIDTH,
  defaultHeight: WINDOW_DEFAULT_HEIGHT,
  minWidth: WINDOW_MIN_WIDTH,
  minHeight: WINDOW_MIN_HEIGHT,
  appendRuntimeLog,
  getBackgroundAutomationStatus,
  runBackgroundAutomationCheck,
  setBackgroundAutomationPaused,
  shutdownAutomation: () => automationRuntime.shutdownAutomation(),
})

function resolveCourseImportDefaultPath(settings: RuntimeSettings) {
  return resolveRuntimeCourseImportDefaultPath(settings.output_dir, devProjectRoot, dataRoot)
}

function resolveMaterialOutputDir(settings: RuntimeSettings) {
  return resolveMaterialOutputDirectory(settings.output_dir)
}

function listMaterialPackages(settings: RuntimeSettings) {
  return scanMaterialPackages(resolveMaterialOutputDir(settings))
}

const materialDeletion = createMaterialDeletion({
  loadSettings,
  resolveMaterialOutputDir,
  resolveKnowledgeOutputDir,
  resolveOutputRoot: (settings) => path.resolve(settings.output_dir || resolveCanonicalOutputRoot(devProjectRoot)),
  listMaterialPackages,
  loadKnowledgeLibraryFile,
  saveKnowledgeLibraryFile,
  loadLearningLibraryState,
  saveLearningLibraryState,
  loadWorkbenchQueue,
  saveWorkbenchQueueDirect,
  isQueueProcessing: () => automationRuntime.isQueueProcessing(),
  isMaterialRecordSummaryReady,
  buildArchivedLearningRecord,
  saveArchivedLearningRecord,
})

function clearWorkbenchQueue() {
  return materialDeletion.clearWorkbenchQueue()
}

function deleteMaterialPackage(settings: RuntimeSettings, materialPath: string) {
  return materialDeletion.deleteMaterialPackage(settings, materialPath)
}

function emitDistillProgress(payload: DistillProgressPayload) {
  appendRuntimeLog(`distill-progress ${payload.percent}% ${payload.message}`)
  windowController.getMainWindow()?.webContents.send('distill-progress', payload)
}

registerAppLifecycle({
  argv: process.argv,
  windowController,
  recoverInterruptedWorkbenchQueue,
  refreshBackgroundAutomationSchedule,
})

registerWindowIpcHandlers({
  minimizeWindow: () => windowController.minimizeWindow(),
  closeWindow: () => windowController.closeWindow(),
  toggleMaximizeWindow: () => windowController.toggleMaximizeWindow(),
})

registerSettingsAutomationIpcHandlers({
  loadSettings,
  saveSettings,
  getBackgroundAutomationStatus,
  runBackgroundAutomationCheck,
  setBackgroundAutomationPaused,
})

registerDialogIpcHandlers({
  loadSettings,
  resolveCourseImportDefaultPath,
})

registerMaterialIpcHandlers({
  loadSettings,
  runPythonDistiller,
  listMaterialPackages,
  deleteMaterialPackage,
  archiveMaterialByPath: (materialPath) => archiveMaterialByPath(loadSettings(), materialPath),
})

registerWorkbenchQueueIpcHandlers({
  loadWorkbenchQueue,
  saveWorkbenchQueue,
  clearWorkbenchQueue,
})

registerBilibiliSourceIpcHandlers({
  loadSettings,
  loadPinnedBilibiliSources,
  savePinnedBilibiliSources,
  loadTrackedBilibiliSources,
  saveTrackedBilibiliSources,
  registryRoot: videoRegistryRoot,
})

registerKnowledgeIpcHandlers({ loadSettings })

registerLearningLibraryIpcHandlers({
  loadLearningLibraryPayload,
  openLearningRecord,
  refreshLearningLibraryStructure,
  upsertLearningRecord,
  deleteLearningRecord,
})

registerSystemIpcHandlers({ resolveDevProjectRoot: () => devProjectRoot })

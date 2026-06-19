import type { WorkbenchQueueItem } from '../queue/workbenchQueue'

export type BackgroundAutomationTrigger = 'timer' | 'manual' | 'startup'

export type BackgroundAutomationStatus = {
  enabled: boolean
  paused: boolean
  running: boolean
  lastCheckAt: number | null
  nextCheckAt: number | null
  lastResult: string
  lastError: string | null
  checkIntervalMinutes: number
}

type AutomationRuntimeSettings = {
  background_automation_enabled: boolean
}

type DiscoveryResult = {
  discovered: WorkbenchQueueItem[]
  checkedSourceCount: number
}

type QueueRunResult = {
  processed: number
  failed: number
  shouldContinue?: boolean
}

type QueueRunControls = {
  setStatus: (result: string, error: string | null) => void
  broadcastStatus: () => BackgroundAutomationStatus
}

export type AutomationControllerDeps<Settings extends AutomationRuntimeSettings> = {
  checkIntervalMinutes: number
  loadSettings: () => Settings
  readPaused: () => boolean
  writePaused: (paused: boolean) => void
  loadPinnedSources: () => unknown[]
  discoverPinnedSourceVideos: (settings: Settings) => Promise<DiscoveryResult>
  appendQueueItems: (items: WorkbenchQueueItem[]) => void
  loadQueue: () => WorkbenchQueueItem[]
  recoverQueue: (reason: string) => void
  runQueue: (reason: string, controls: QueueRunControls) => Promise<QueueRunResult>
  appendRuntimeLog: (message: string) => void
  emitStatus: (status: BackgroundAutomationStatus) => void
}

export function createAutomationController<Settings extends AutomationRuntimeSettings>(
  deps: AutomationControllerDeps<Settings>,
) {
  let backgroundTimer: ReturnType<typeof setTimeout> | null = null
  let queueProcessTimer: ReturnType<typeof setTimeout> | null = null
  let backgroundRunning = false
  let queueProcessing = false
  let lastCheckAt: number | null = null
  let nextCheckAt: number | null = null
  let lastResult = '尚未检查'
  let lastError: string | null = null

  const getIntervalMs = () => deps.checkIntervalMinutes * 60 * 1000

  const getStatus = (): BackgroundAutomationStatus => {
    const settings = deps.loadSettings()
    return {
      enabled: Boolean(settings.background_automation_enabled),
      paused: deps.readPaused(),
      running: backgroundRunning || queueProcessing,
      lastCheckAt,
      nextCheckAt,
      lastResult,
      lastError,
      checkIntervalMinutes: deps.checkIntervalMinutes,
    }
  }

  const broadcastStatus = () => {
    const status = getStatus()
    deps.emitStatus(status)
    return status
  }

  const clearBackgroundTimer = () => {
    if (!backgroundTimer) return
    clearTimeout(backgroundTimer)
    backgroundTimer = null
  }

  const clearQueueTimer = () => {
    if (!queueProcessTimer) return
    clearTimeout(queueProcessTimer)
    queueProcessTimer = null
  }

  const setStatus = (result: string, error: string | null) => {
    lastResult = result
    lastError = error
  }

  const scheduleQueueProcessing = (reason: string) => {
    if (queueProcessing || queueProcessTimer) return
    queueProcessTimer = setTimeout(() => {
      queueProcessTimer = null
      void processQueue(reason)
    }, 300)
  }

  const refreshSchedule = (delayMs?: number) => {
    clearBackgroundTimer()
    const settings = deps.loadSettings()
    if (!settings.background_automation_enabled || deps.readPaused()) {
      nextCheckAt = null
      broadcastStatus()
      return
    }

    const intervalMs = delayMs ?? getIntervalMs()
    nextCheckAt = Date.now() + intervalMs
    backgroundTimer = setTimeout(() => {
      void runCheck('timer')
    }, intervalMs)
    broadcastStatus()
  }

  const setPaused = (paused: boolean) => {
    deps.writePaused(paused)
    refreshSchedule()
    return getStatus()
  }

  const processQueue = async (reason: string) => {
    if (queueProcessing) return
    deps.recoverQueue(reason)
    queueProcessing = true
    broadcastStatus()

    try {
      const result = await deps.runQueue(reason, {
        setStatus,
        broadcastStatus,
      })
      if (result.processed || result.failed) {
        lastResult = result.failed
          ? `队列处理完成：${result.processed} 项成功，${result.failed} 项失败`
          : `队列处理完成：${result.processed} 项成功`
        lastCheckAt = Date.now()
      }
    } finally {
      queueProcessing = false
      broadcastStatus()
      if (deps.loadQueue().some((item) => item.status === 'queued')) {
        scheduleQueueProcessing('queue-continued')
      }
    }
  }

  const runCheck = async (trigger: BackgroundAutomationTrigger = 'manual') => {
    if (backgroundRunning) return getStatus()
    const settings = deps.loadSettings()
    if (!settings.background_automation_enabled) {
      lastResult = '后台任务未启用'
      lastError = null
      lastCheckAt = Date.now()
      return broadcastStatus()
    }
    if (deps.readPaused()) {
      lastResult = '后台任务已暂停'
      lastError = null
      lastCheckAt = Date.now()
      return broadcastStatus()
    }

    backgroundRunning = true
    lastError = null
    nextCheckAt = null
    broadcastStatus()

    try {
      const pinnedSources = deps.loadPinnedSources()
      const discovery = await deps.discoverPinnedSourceVideos(settings)
      if (discovery.discovered.length) {
        deps.appendQueueItems(discovery.discovered)
      } else {
        scheduleQueueProcessing(`automation-${trigger}`)
      }
      const queue = deps.loadQueue()
      const queuedCount = queue.filter((item) => item.status === 'queued').length
      const failedCount = queue.filter((item) => item.status === 'failed').length
      const doneCount = queue.filter((item) => item.status === 'done').length
      const sourceHint = pinnedSources.length
        ? `检查 ${discovery.checkedSourceCount}/${pinnedSources.length} 个收藏来源`
        : '未收藏视频来源'
      const discoveryHint = discovery.discovered.length ? `新增 ${discovery.discovered.length} 条` : '没有新视频'
      const queueHint = queuedCount
        ? `${queuedCount} 项等待处理`
        : failedCount
          ? `${failedCount} 项需要重试`
          : doneCount
            ? `${doneCount} 项已完成`
            : '队列为空'
      lastResult = `${trigger === 'startup' ? '启动检查' : trigger === 'timer' ? '定时检查' : '手动检查'}完成：${sourceHint}，24小时内${discoveryHint}，${queueHint}`
      deps.appendRuntimeLog(`background automation check trigger=${trigger} result=${lastResult}`)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      lastResult = '后台检查失败'
      deps.appendRuntimeLog(`background automation check failed: ${lastError}`)
    } finally {
      backgroundRunning = false
      lastCheckAt = Date.now()
      refreshSchedule()
    }

    return getStatus()
  }

  return {
    getStatus,
    setPaused,
    refreshSchedule,
    scheduleQueueProcessing,
    processQueue,
    runCheck,
    recoverStartup: (reason: string) => deps.recoverQueue(reason),
    isQueueProcessing: () => queueProcessing,
    shutdown: () => {
      clearBackgroundTimer()
      clearQueueTimer()
    },
  }
}

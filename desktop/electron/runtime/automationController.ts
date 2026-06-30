import type { WorkbenchQueueItem } from '../queue/workbenchQueue'
import { getNextWorkbenchQueueRetryAt, isWorkbenchQueueItemClaimable } from '../queue/workbenchQueue'

export type BackgroundAutomationTrigger = 'timer' | 'manual' | 'startup' | 'idle-backfill'

const ONE_HOUR_MS = 60 * 60 * 1000

export function getNextHourlyCheckDelayMs(now = Date.now()) {
  const hourRemainder = now % ONE_HOUR_MS
  return hourRemainder === 0 ? ONE_HOUR_MS : ONE_HOUR_MS - hourRemainder
}

export type BackgroundAutomationStatus = {
  enabled: boolean
  paused: boolean
  pauseReason: 'manual' | 'duration' | ''
  pausedUntil: number | null
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

export type BackgroundAutomationPauseState = {
  paused: boolean
  pausedUntil: number | null
  reason: 'manual' | 'duration' | ''
}

type DiscoveryResult = {
  discovered: WorkbenchQueueItem[]
  checkedSourceCount: number
}

type QueueRunResult = {
  processed: number
  failed: number
  skipped: number
  shouldContinue?: boolean
  nextRetryAt?: number | null
}

type QueueRunControls = {
  setStatus: (result: string, error: string | null) => void
  pauseAutomation: (result: string, error: string | null) => void
  broadcastStatus: () => BackgroundAutomationStatus
}

export type AutomationControllerDeps<Settings extends AutomationRuntimeSettings> = {
  checkIntervalMinutes: number
  loadSettings: () => Settings
  readPauseState: () => BackgroundAutomationPauseState
  writePauseState: (state: BackgroundAutomationPauseState) => void
  loadPinnedSources: () => unknown[]
  discoverPinnedSourceVideos: (settings: Settings, trigger?: BackgroundAutomationTrigger) => Promise<DiscoveryResult>
  appendQueueItems: (items: WorkbenchQueueItem[]) => WorkbenchQueueItem[]
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
  let retryWakeTimer: ReturnType<typeof setTimeout> | null = null
  let idleBackfillTimer: ReturnType<typeof setTimeout> | null = null
  let backgroundRunning = false
  let queueProcessing = false
  let lastCheckAt: number | null = null
  let nextCheckAt: number | null = null
  let lastResult = '尚未检查'
  let lastError: string | null = null

  const getStatus = (): BackgroundAutomationStatus => {
    const settings = deps.loadSettings()
    const pauseState = deps.readPauseState()
    return {
      enabled: Boolean(settings.background_automation_enabled),
      paused: pauseState.paused,
      pauseReason: pauseState.paused ? pauseState.reason : '',
      pausedUntil: pauseState.paused ? pauseState.pausedUntil : null,
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

  const clearRetryWakeTimer = () => {
    if (!retryWakeTimer) return
    clearTimeout(retryWakeTimer)
    retryWakeTimer = null
  }

  const clearIdleBackfillTimer = () => {
    if (!idleBackfillTimer) return
    clearTimeout(idleBackfillTimer)
    idleBackfillTimer = null
  }

  const setStatus = (result: string, error: string | null) => {
    lastResult = result
    lastError = error
  }

  const pauseAutomation = (result: string, error: string | null) => {
    deps.writePauseState({
      paused: true,
      pausedUntil: null,
      reason: 'manual',
    })
    clearBackgroundTimer()
    nextCheckAt = null
    setStatus(result, error)
    broadcastStatus()
  }

  const scheduleQueueProcessing = (reason: string) => {
    if (queueProcessing || queueProcessTimer) return
    queueProcessTimer = setTimeout(() => {
      queueProcessTimer = null
      void processQueue(reason)
    }, 300)
  }

  const scheduleRetryWake = () => {
    clearRetryWakeTimer()
    if (deps.readPauseState().paused) return
    if (deps.loadQueue().some((item) => isWorkbenchQueueItemClaimable(item))) {
      scheduleQueueProcessing('retry-ready')
      return
    }
    const nextRetryAt = getNextWorkbenchQueueRetryAt(deps.loadQueue())
    if (!nextRetryAt) return
    retryWakeTimer = setTimeout(() => {
      retryWakeTimer = null
      scheduleQueueProcessing('retry-ready')
    }, Math.max(300, nextRetryAt - Date.now()))
  }

  const scheduleIdleBackfill = () => {
    if (idleBackfillTimer || backgroundRunning || queueProcessing || deps.readPauseState().paused) return
    if (deps.loadQueue().some((item) => isWorkbenchQueueItemClaimable(item))) return
    idleBackfillTimer = setTimeout(() => {
      idleBackfillTimer = null
      if (backgroundRunning || queueProcessing || deps.readPauseState().paused) return
      if (deps.loadQueue().some((item) => isWorkbenchQueueItemClaimable(item))) return
      void runCheck('idle-backfill')
    }, 600)
  }

  const refreshSchedule = (delayMs?: number) => {
    clearBackgroundTimer()
    const settings = deps.loadSettings()
    const pauseState = deps.readPauseState()
    if (!settings.background_automation_enabled || pauseState.paused) {
      nextCheckAt = null
      clearRetryWakeTimer()
      clearIdleBackfillTimer()
      broadcastStatus()
      return
    }

    const intervalMs = delayMs ?? getNextHourlyCheckDelayMs()
    nextCheckAt = Date.now() + intervalMs
    backgroundTimer = setTimeout(() => {
      void runCheck('timer')
    }, intervalMs)
    broadcastStatus()
  }

  const setPaused = (paused: boolean, durationMs?: number) => {
    const pausedUntil = paused && durationMs ? Date.now() + durationMs : null
    deps.writePauseState({
      paused,
      pausedUntil,
      reason: paused ? (durationMs ? 'duration' : 'manual') : '',
    })
    if (!paused) {
      refreshSchedule(300)
      scheduleRetryWake()
      scheduleIdleBackfill()
    } else {
      refreshSchedule()
    }
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
        pauseAutomation,
        broadcastStatus,
      })
      if (result.processed || result.failed || result.skipped) {
        const parts = [
          result.processed ? `${result.processed} 项成功` : '',
          result.skipped ? `${result.skipped} 项跳过` : '',
          result.failed ? `${result.failed} 项失败` : '',
        ].filter(Boolean)
        lastResult = `队列处理完成：${parts.join('，')}`
        lastCheckAt = Date.now()
      }
    } finally {
      queueProcessing = false
      broadcastStatus()
      if (!deps.readPauseState().paused && deps.loadQueue().some((item) => isWorkbenchQueueItemClaimable(item))) {
        scheduleQueueProcessing('queue-continued')
      } else if (!deps.readPauseState().paused) {
        scheduleRetryWake()
        scheduleIdleBackfill()
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
    if (deps.readPauseState().paused) {
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
      const discovery = await deps.discoverPinnedSourceVideos(settings, trigger)
      if (discovery.discovered.length) {
        const queueAfterAppend = deps.appendQueueItems(discovery.discovered)
        if (queueAfterAppend.some((item) => isWorkbenchQueueItemClaimable(item))) {
          scheduleQueueProcessing(`automation-${trigger}`)
        }
      } else if (deps.loadQueue().some((item) => isWorkbenchQueueItemClaimable(item))) {
        scheduleQueueProcessing(`automation-${trigger}`)
      }
      const queue = deps.loadQueue()
      const queuedCount = queue.filter((item) => item.status === 'queued').length
      const claimableCount = queue.filter((item) => isWorkbenchQueueItemClaimable(item)).length
      const failedCount = queue.filter((item) => item.status === 'failed').length
      const skippedCount = queue.filter((item) => item.status === 'skipped').length
      const doneCount = queue.filter((item) => item.status === 'done').length
      const foldedIssueCount = failedCount + skippedCount
      const sourceHint = pinnedSources.length
        ? `检查 ${discovery.checkedSourceCount}/${pinnedSources.length} 个收藏来源`
        : '未收藏视频来源'
      const discoveryHint = discovery.discovered.length ? `新增 ${discovery.discovered.length} 条` : '没有新视频'
      const queueHint = claimableCount
        ? `${claimableCount} 项可处理`
        : queuedCount
          ? `${queuedCount} 项等待重试`
        : foldedIssueCount
          ? `${foldedIssueCount} 项已折叠`
            : doneCount
              ? `${doneCount} 项已完成`
              : '队列为空'
      lastResult = `${trigger === 'startup' ? '启动检查' : trigger === 'timer' ? '定时检查' : trigger === 'idle-backfill' ? '空闲补足' : '手动检查'}完成：${sourceHint}，最近列表${discoveryHint}，${queueHint}`
      deps.appendRuntimeLog(`background automation check trigger=${trigger} result=${lastResult}`)
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      lastResult = '后台检查失败'
      deps.appendRuntimeLog(`background automation check failed: ${lastError}`)
    } finally {
      backgroundRunning = false
      lastCheckAt = Date.now()
      refreshSchedule()
      scheduleRetryWake()
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
      clearRetryWakeTimer()
      clearIdleBackfillTimer()
    },
  }
}

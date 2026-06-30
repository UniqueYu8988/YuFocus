import {
  appendWorkbenchQueueItemsToList,
  claimNextQueuedWorkbenchItemFromList,
  normalizeWorkbenchQueue,
  recoverInterruptedWorkbenchQueueItems,
  type WorkbenchQueueItem,
} from './workbenchQueue'

type WorkbenchQueueStoreDeps = {
  readQueue: () => WorkbenchQueueItem[] | undefined
  writeQueue: (items: WorkbenchQueueItem[]) => void
  broadcastQueueChanged: (items: WorkbenchQueueItem[]) => void
  scheduleProcessing: (reason: string) => void
  isQueueProcessing: () => boolean
  appendRuntimeLog: (message: string) => void
  concurrency: number
}

export function createWorkbenchQueueStore({
  readQueue,
  writeQueue,
  broadcastQueueChanged,
  scheduleProcessing,
  isQueueProcessing,
  appendRuntimeLog,
  concurrency,
}: WorkbenchQueueStoreDeps) {
  const loadQueue = () => normalizeWorkbenchQueue(readQueue())

  const saveQueueDirect = (items: WorkbenchQueueItem[]) => {
    const normalized = normalizeWorkbenchQueue(items)
    writeQueue(normalized)
    broadcastQueueChanged(normalized)
    return normalized
  }

  const saveQueue = (items: unknown) => {
    const normalized = saveQueueDirect(normalizeWorkbenchQueue(items))
    scheduleProcessing('queue-save')
    return normalized
  }

  const recoverInterruptedQueue = (reason: string) => {
    if (isQueueProcessing()) return loadQueue()
    const queue = loadQueue()
    const recovered = recoverInterruptedWorkbenchQueueItems(queue)
    if (!recovered.changed) return queue

    writeQueue(recovered.items)
    appendRuntimeLog(`workbench queue recovered interrupted processing items reason=${reason}`)
    broadcastQueueChanged(recovered.items)
    return recovered.items
  }

  const appendQueueItems = (items: WorkbenchQueueItem[]) => {
    if (!items.length) return loadQueue()
    const current = loadQueue()
    const next = appendWorkbenchQueueItemsToList(current, items)
    const unchanged = next.length === current.length && next.every((item, index) => (
      item.queueId === current[index]?.queueId && item.bvid === current[index]?.bvid
    ))
    if (unchanged) return current
    return saveQueue(next)
  }

  const updateQueueItem = (queueId: string, patch: Partial<WorkbenchQueueItem>) => {
    const next = loadQueue().map((item) => (
      item.queueId === queueId
        ? { ...item, ...patch, updatedAt: Date.now() }
        : item
    ))
    return saveQueue(next)
  }

  const claimNextQueuedItem = () => {
    const claimed = claimNextQueuedWorkbenchItemFromList(loadQueue(), concurrency)
    if (!claimed.item) return null
    saveQueue(claimed.items)
    return claimed.item
  }

  return {
    appendQueueItems,
    claimNextQueuedItem,
    loadQueue,
    recoverInterruptedQueue,
    saveQueue,
    saveQueueDirect,
    updateQueueItem,
  }
}

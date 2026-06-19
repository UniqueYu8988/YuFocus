import { ipcMain } from 'electron'
import type { WorkbenchQueueItem } from '../queue/workbenchQueue'

type WorkbenchQueueIpcDeps = {
  loadWorkbenchQueue: () => WorkbenchQueueItem[]
  saveWorkbenchQueue: (items: unknown) => WorkbenchQueueItem[]
  clearWorkbenchQueue: () => unknown
}

export function registerWorkbenchQueueIpcHandlers({
  loadWorkbenchQueue,
  saveWorkbenchQueue,
  clearWorkbenchQueue,
}: WorkbenchQueueIpcDeps) {
  ipcMain.handle('workbench:queue:load', async () => {
    return loadWorkbenchQueue()
  })

  ipcMain.handle('workbench:queue:save', async (_event, items: unknown) => {
    return saveWorkbenchQueue(items)
  })

  ipcMain.handle('workbench:queue:clear', async () => {
    return clearWorkbenchQueue()
  })
}

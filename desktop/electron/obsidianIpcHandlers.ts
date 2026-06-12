import { ipcMain } from 'electron'
import {
  exportCourseToObsidian,
  openObsidianTarget,
  type ObsidianExportPayload,
} from './obsidianExport'
import type { RuntimeSettings } from './settings'

type ObsidianIpcDeps = {
  loadSettings: () => RuntimeSettings
}

export function registerObsidianIpcHandlers({
  loadSettings,
}: ObsidianIpcDeps) {
  ipcMain.handle('obsidian:export', async (_event, payload: ObsidianExportPayload) => {
    return exportCourseToObsidian(loadSettings(), payload)
  })

  ipcMain.handle('obsidian:open', async (_event, payload: ObsidianExportPayload & { target?: 'current' | 'board' | 'index' }) => {
    return openObsidianTarget(loadSettings(), payload)
  })
}

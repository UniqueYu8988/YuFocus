import { ipcMain } from 'electron'
import { fetchSettingsStatus } from '../providers/bilibiliSourceApi'
import type { EnvironmentCheckPayload } from '../services/environmentCheckService'
import type { BackgroundAutomationStatus } from '../runtime/automationController'
import type { RuntimeSettings } from '../runtime/settings'

type SettingsAutomationIpcDeps = {
  loadSettings: () => RuntimeSettings
  saveSettings: (settings: RuntimeSettings) => RuntimeSettings
  runEnvironmentCheck: () => Promise<EnvironmentCheckPayload>
  getBackgroundAutomationStatus: () => BackgroundAutomationStatus
  runBackgroundAutomationCheck: (trigger: 'manual') => Promise<BackgroundAutomationStatus>
  setBackgroundAutomationPaused: (paused: boolean, durationMs?: number) => BackgroundAutomationStatus
}

export function registerSettingsAutomationIpcHandlers({
  loadSettings,
  saveSettings,
  runEnvironmentCheck,
  getBackgroundAutomationStatus,
  runBackgroundAutomationCheck,
  setBackgroundAutomationPaused,
}: SettingsAutomationIpcDeps) {
  ipcMain.handle('settings:load', () => loadSettings())

  ipcMain.handle('settings:save', (_event, payload: RuntimeSettings) => saveSettings(payload))

  ipcMain.handle('settings:status', async () => fetchSettingsStatus(loadSettings()))

  ipcMain.handle('settings:environment-check', async () => runEnvironmentCheck())

  ipcMain.handle('automation:status', () => getBackgroundAutomationStatus())

  ipcMain.handle('automation:check-now', async () => runBackgroundAutomationCheck('manual'))

  ipcMain.handle('automation:set-paused', (_event, payload: boolean | { paused?: boolean; durationMs?: number }) => {
    const paused = typeof payload === 'boolean' ? payload : Boolean(payload?.paused)
    const durationMs = typeof payload === 'object' ? Number(payload.durationMs ?? 0) || undefined : undefined
    return setBackgroundAutomationPaused(paused, durationMs)
  })

}

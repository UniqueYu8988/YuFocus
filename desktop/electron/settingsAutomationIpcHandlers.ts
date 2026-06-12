import { ipcMain } from 'electron'
import { fetchSettingsStatus } from './bilibiliSourceApi'
import { sendSmtpTestEmail } from './smtpEmail'
import type { BackgroundAutomationStatus } from './automationController'
import type { RuntimeSettings } from './settings'

type SettingsAutomationIpcDeps = {
  appId: string
  loadSettings: () => RuntimeSettings
  saveSettings: (settings: RuntimeSettings) => RuntimeSettings
  getBackgroundAutomationStatus: () => BackgroundAutomationStatus
  runBackgroundAutomationCheck: (trigger: 'manual') => Promise<BackgroundAutomationStatus>
  setBackgroundAutomationPaused: (paused: boolean) => BackgroundAutomationStatus
}

export function registerSettingsAutomationIpcHandlers({
  appId,
  loadSettings,
  saveSettings,
  getBackgroundAutomationStatus,
  runBackgroundAutomationCheck,
  setBackgroundAutomationPaused,
}: SettingsAutomationIpcDeps) {
  ipcMain.handle('settings:load', () => loadSettings())

  ipcMain.handle('settings:save', (_event, payload: RuntimeSettings) => saveSettings(payload))

  ipcMain.handle('settings:status', async () => fetchSettingsStatus(loadSettings()))

  ipcMain.handle('automation:status', () => getBackgroundAutomationStatus())

  ipcMain.handle('automation:check-now', async () => runBackgroundAutomationCheck('manual'))

  ipcMain.handle('automation:set-paused', (_event, paused: boolean) => setBackgroundAutomationPaused(Boolean(paused)))

  ipcMain.handle('email:test', async () => sendSmtpTestEmail(loadSettings(), appId))
}

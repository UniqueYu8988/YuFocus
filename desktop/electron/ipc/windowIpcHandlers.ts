import { ipcMain } from 'electron'

type WindowIpcDeps = {
  minimizeWindow: () => void
  closeWindow: () => void
  toggleMaximizeWindow: () => void
}

export function registerWindowIpcHandlers({
  minimizeWindow,
  closeWindow,
  toggleMaximizeWindow,
}: WindowIpcDeps) {
  ipcMain.handle('window:minimize', () => {
    minimizeWindow()
  })

  ipcMain.handle('window:close', () => {
    closeWindow()
  })

  ipcMain.handle('window:toggle-maximize', () => {
    toggleMaximizeWindow()
  })
}

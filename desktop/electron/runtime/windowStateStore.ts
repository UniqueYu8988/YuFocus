import type { BrowserWindow } from 'electron'
import fs from 'node:fs'

type WindowStateOptions = {
  windowStatePath: string
  legacyWindowStatePath: string
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
}

export function loadWindowState(options: WindowStateOptions) {
  try {
    const sourcePath = fs.existsSync(options.windowStatePath)
      ? options.windowStatePath
      : options.legacyWindowStatePath
    if (fs.existsSync(sourcePath)) {
      const state = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'))
      return {
        width: Math.max(Number(state.width) || options.defaultWidth, options.minWidth),
        height: Math.max(Number(state.height) || options.defaultHeight, options.minHeight),
        x: typeof state.x === 'number' ? state.x : undefined,
        y: typeof state.y === 'number' ? state.y : undefined,
      }
    }
  } catch {
    // ignore corrupt window state files
  }
  return { width: options.defaultWidth, height: options.defaultHeight }
}

export function saveWindowState(mainWindow: BrowserWindow | null, windowStatePath: string) {
  if (!mainWindow) return
  try {
    const bounds = mainWindow.getBounds()
    fs.writeFileSync(windowStatePath, JSON.stringify(bounds, null, 2))
  } catch {
    // ignore window state write failures
  }
}

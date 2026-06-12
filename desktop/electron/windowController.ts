import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  loadWindowState as loadPersistedWindowState,
  saveWindowState as savePersistedWindowState,
} from './windowStateStore'

export type DeepLinkPayload = {
  packageId: string
  nodeId: string | null
}

export type BackgroundStatusSnapshot = {
  enabled: boolean
  paused: boolean
  running: boolean
}

export type WindowControllerOptions = {
  appName: string
  appProtocol: string
  iconPath: string
  dataRoot: string
  windowStatePath: string
  legacyWindowStatePath: string
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
  appendRuntimeLog: (message: string) => void
  getBackgroundAutomationStatus: () => BackgroundStatusSnapshot
  runBackgroundAutomationCheck: (trigger: 'manual') => unknown
  setBackgroundAutomationPaused: (paused: boolean) => unknown
  shutdownAutomation: () => void
}

function parseDeepLinkUrl(rawUrl: string, appProtocol: string): DeepLinkPayload | null {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== `${appProtocol}:`) return null
    const packageId = parsed.searchParams.get('packageId')?.trim() || ''
    const nodeId = parsed.searchParams.get('nodeId')?.trim() || null
    if (!packageId) return null
    return { packageId, nodeId }
  } catch {
    return null
  }
}

export function createWindowController(options: WindowControllerOptions) {
  let mainWindow: BrowserWindow | null = null
  let pendingDeepLink: DeepLinkPayload | null = null
  let tray: Tray | null = null
  let isQuitting = false

  const getMainWindow = () => mainWindow
  const getIsQuitting = () => isQuitting
  const markQuitting = () => {
    isQuitting = true
  }

  const registerAppProtocol = () => {
    try {
      if (process.defaultApp && process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(options.appProtocol, process.execPath, [path.resolve(process.argv[1])])
        return
      }
      app.setAsDefaultProtocolClient(options.appProtocol)
    } catch (error) {
      options.appendRuntimeLog(`protocol register failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const parseDeepLink = (rawUrl: string) => parseDeepLinkUrl(rawUrl, options.appProtocol)

  const extractDeepLinkFromArgv = (argv: string[]) => {
    for (const arg of argv) {
      if (!arg || typeof arg !== 'string') continue
      if (!arg.toLowerCase().startsWith(`${options.appProtocol}://`)) continue
      const parsed = parseDeepLink(arg)
      if (parsed) return parsed
    }
    return null
  }

  const dispatchDeepLink = (payload: DeepLinkPayload) => {
    pendingDeepLink = payload
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deeplink:open', payload)
    }
  }

  const createWindow = () => {
    const state = loadPersistedWindowState({
      windowStatePath: options.windowStatePath,
      legacyWindowStatePath: options.legacyWindowStatePath,
      defaultWidth: options.defaultWidth,
      defaultHeight: options.defaultHeight,
      minWidth: options.minWidth,
      minHeight: options.minHeight,
    })
    options.appendRuntimeLog(`createWindow dataRoot=${options.dataRoot}`)

    mainWindow = new BrowserWindow({
      width: state.width ?? options.defaultWidth,
      height: state.height ?? options.defaultHeight,
      x: state.x,
      y: state.y,
      minWidth: options.minWidth,
      minHeight: options.minHeight,
      frame: false,
      backgroundColor: '#1d2430',
      autoHideMenuBar: true,
      show: false,
      icon: fs.existsSync(options.iconPath) ? options.iconPath : undefined,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    }

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
      mainWindow?.webContents.send('window:maximized-changed', { maximized: Boolean(mainWindow?.isMaximized()) })
      if (pendingDeepLink) {
        mainWindow?.webContents.send('deeplink:open', pendingDeepLink)
      }
    })

    mainWindow.on('focus', () => {
      mainWindow?.setBackgroundColor('#1d2430')
      mainWindow?.webContents.send('window:focus-changed', { focused: true })
    })

    mainWindow.on('blur', () => {
      mainWindow?.setBackgroundColor('#181e28')
      mainWindow?.webContents.send('window:focus-changed', { focused: false })
    })

    mainWindow.on('maximize', () => {
      mainWindow?.webContents.send('window:maximized-changed', { maximized: true })
    })

    mainWindow.on('unmaximize', () => {
      mainWindow?.webContents.send('window:maximized-changed', { maximized: false })
    })

    mainWindow.on('resize', () => savePersistedWindowState(mainWindow, options.windowStatePath))
    mainWindow.on('move', () => savePersistedWindowState(mainWindow, options.windowStatePath))
    mainWindow.on('close', (event) => {
      if (isQuitting) return
      event.preventDefault()
      mainWindow?.hide()
    })
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  }

  const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    }
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  const quitApplication = () => {
    isQuitting = true
    options.shutdownAutomation()
    app.quit()
  }

  const updateTrayMenu = () => {
    if (!tray) return
    const status = options.getBackgroundAutomationStatus()
    const statusLabel = status.running
      ? '后台：检查中'
      : status.paused
        ? '后台：已暂停'
        : status.enabled
          ? '后台：运行中'
          : '后台：未启用'

    tray.setContextMenu(Menu.buildFromTemplate([
      { label: options.appName, enabled: false },
      { label: statusLabel, enabled: false },
      { type: 'separator' },
      { label: '打开视界专注', click: showMainWindow },
      {
        label: '立即检查',
        enabled: status.enabled && !status.paused && !status.running,
        click: () => void options.runBackgroundAutomationCheck('manual'),
      },
      {
        label: status.paused ? '恢复后台任务' : '暂停后台任务',
        enabled: status.enabled,
        click: () => options.setBackgroundAutomationPaused(!status.paused),
      },
      { type: 'separator' },
      { label: '退出', click: quitApplication },
    ]))
  }

  const createTray = () => {
    if (tray) return
    const icon = nativeImage.createFromPath(options.iconPath)
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    tray.setToolTip(options.appName)
    tray.on('click', showMainWindow)
    updateTrayMenu()
  }

  const setPendingDeepLink = (payload: DeepLinkPayload | null) => {
    pendingDeepLink = payload
  }

  const minimizeWindow = () => {
    mainWindow?.minimize()
  }

  const closeWindow = () => {
    mainWindow?.close()
  }

  const toggleMaximizeWindow = () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
      return false
    }
    mainWindow.maximize()
    return true
  }

  return {
    closeWindow,
    createTray,
    createWindow,
    dispatchDeepLink,
    extractDeepLinkFromArgv,
    getIsQuitting,
    getMainWindow,
    markQuitting,
    minimizeWindow,
    parseDeepLink,
    registerAppProtocol,
    setPendingDeepLink,
    showMainWindow,
    toggleMaximizeWindow,
    updateTrayMenu,
  }
}

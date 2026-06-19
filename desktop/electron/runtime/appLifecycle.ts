import { app } from 'electron'
import type { createWindowController } from './windowController'

type WindowController = ReturnType<typeof createWindowController>

type AppLifecycleDeps = {
  argv: string[]
  windowController: WindowController
  recoverInterruptedWorkbenchQueue: (reason: string) => unknown
  refreshBackgroundAutomationSchedule: () => unknown
}

export function registerAppLifecycle({
  argv,
  windowController,
  recoverInterruptedWorkbenchQueue,
  refreshBackgroundAutomationSchedule,
}: AppLifecycleDeps) {
  const singleInstanceLock = app.requestSingleInstanceLock()
  if (!singleInstanceLock) {
    app.quit()
  } else {
    app.on('second-instance', (_event, nextArgv) => {
      const deepLink = windowController.extractDeepLinkFromArgv(nextArgv)
      if (deepLink) {
        windowController.dispatchDeepLink(deepLink)
      }
      windowController.showMainWindow()
    })

    app.on('open-url', (event, rawUrl) => {
      event.preventDefault()
      const deepLink = windowController.parseDeepLink(rawUrl)
      if (deepLink) {
        windowController.dispatchDeepLink(deepLink)
      }
    })

    app.whenReady().then(() => {
      windowController.registerAppProtocol()
      const initialDeepLink = windowController.extractDeepLinkFromArgv(argv)
      if (initialDeepLink) {
        windowController.setPendingDeepLink(initialDeepLink)
      }
      windowController.createWindow()
      windowController.createTray()
      recoverInterruptedWorkbenchQueue('startup')
      refreshBackgroundAutomationSchedule()
    })
  }

  app.on('before-quit', () => {
    windowController.markQuitting()
  })

  app.on('activate', () => {
    windowController.showMainWindow()
  })

  app.on('window-all-closed', () => {
    if (windowController.getIsQuitting()) app.quit()
  })
}

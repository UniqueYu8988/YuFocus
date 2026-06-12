import { ipcMain } from 'electron'
import {
  getBilibiliVideoMetadata,
  listBilibiliFollowSources,
  listBilibiliSourceVideos,
} from './bilibiliSourceApi'
import type { RuntimeSettings } from './settings'
import type { PinnedBilibiliSource } from './sourceDiscovery'

type BilibiliSourceIpcDeps = {
  loadSettings: () => RuntimeSettings
  loadPinnedBilibiliSources: () => PinnedBilibiliSource[]
  savePinnedBilibiliSources: (items: unknown) => PinnedBilibiliSource[]
}

export function registerBilibiliSourceIpcHandlers({
  loadSettings,
  loadPinnedBilibiliSources,
  savePinnedBilibiliSources,
}: BilibiliSourceIpcDeps) {
  ipcMain.handle('sources:bilibili:pinned:load', async () => {
    return loadPinnedBilibiliSources()
  })

  ipcMain.handle('sources:bilibili:pinned:save', async (_event, items: unknown) => {
    return savePinnedBilibiliSources(items)
  })

  ipcMain.handle('sources:bilibili:followings', async () => {
    return listBilibiliFollowSources(loadSettings())
  })

  ipcMain.handle('sources:bilibili:videos', async (_event, payload: { sources?: Array<{ mid: string; name?: string }>; pageSize?: number }) => {
    return listBilibiliSourceVideos(loadSettings(), payload?.sources ?? [], payload?.pageSize)
  })

  ipcMain.handle('sources:bilibili:video', async (_event, payload: { video?: string }) => {
    return getBilibiliVideoMetadata(loadSettings(), payload?.video ?? '')
  })
}

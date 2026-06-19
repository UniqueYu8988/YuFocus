import { ipcMain } from 'electron'
import {
  getBilibiliVideoMetadata,
  listBilibiliFollowSources,
} from '../providers/bilibiliSourceApi'
import type { RuntimeSettings } from '../runtime/settings'
import {
  listRegisteredBilibiliSourceVideos,
  type PinnedBilibiliSource,
} from '../providers/sourceDiscovery'

type BilibiliSourceIpcDeps = {
  loadSettings: () => RuntimeSettings
  loadPinnedBilibiliSources: () => PinnedBilibiliSource[]
  savePinnedBilibiliSources: (items: unknown) => PinnedBilibiliSource[]
  registryRoot: string
}

export function registerBilibiliSourceIpcHandlers({
  loadSettings,
  loadPinnedBilibiliSources,
  savePinnedBilibiliSources,
  registryRoot,
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
    return listRegisteredBilibiliSourceVideos({
      settings: loadSettings(),
      sources: payload?.sources ?? [],
      pageSize: payload?.pageSize,
      registryRoot,
    })
  })

  ipcMain.handle('sources:bilibili:video', async (_event, payload: { video?: string }) => {
    return getBilibiliVideoMetadata(loadSettings(), payload?.video ?? '')
  })
}

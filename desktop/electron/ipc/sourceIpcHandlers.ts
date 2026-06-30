import { ipcMain } from 'electron'
import {
  getBilibiliVideoMetadata,
  listBilibiliFollowSources,
} from '../providers/bilibiliSourceApi'
import type { RuntimeSettings } from '../runtime/settings'
import type { TrackedBilibiliSource } from '../services/trackedSourcesStore'
import {
  listRegisteredBilibiliSourceVideos,
  readRegisteredBilibiliSourceVideos,
  type PinnedBilibiliSource,
} from '../providers/sourceDiscovery'

type BilibiliSourceIpcDeps = {
  loadSettings: () => RuntimeSettings
  loadPinnedBilibiliSources: () => PinnedBilibiliSource[]
  savePinnedBilibiliSources: (items: unknown) => PinnedBilibiliSource[]
  loadTrackedBilibiliSources: () => TrackedBilibiliSource[]
  saveTrackedBilibiliSources: (items: unknown) => TrackedBilibiliSource[]
  registryRoot: string
}

export function registerBilibiliSourceIpcHandlers({
  loadSettings,
  loadPinnedBilibiliSources,
  savePinnedBilibiliSources,
  loadTrackedBilibiliSources,
  saveTrackedBilibiliSources,
  registryRoot,
}: BilibiliSourceIpcDeps) {
  ipcMain.handle('sources:bilibili:pinned:load', async () => {
    return loadPinnedBilibiliSources()
  })

  ipcMain.handle('sources:bilibili:pinned:save', async (_event, items: unknown) => {
    return savePinnedBilibiliSources(items)
  })

  ipcMain.handle('sources:bilibili:tracked:load', async () => {
    return loadTrackedBilibiliSources()
  })

  ipcMain.handle('sources:bilibili:tracked:save', async (_event, items: unknown) => {
    return saveTrackedBilibiliSources(items)
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

  ipcMain.handle('sources:bilibili:registered-videos', async (_event, payload: { sources?: Array<{ mid: string; name?: string }> }) => {
    return readRegisteredBilibiliSourceVideos({
      sources: payload?.sources ?? [],
      registryRoot,
    })
  })

  ipcMain.handle('sources:bilibili:video', async (_event, payload: { video?: string }) => {
    return getBilibiliVideoMetadata(loadSettings(), payload?.video ?? '')
  })
}

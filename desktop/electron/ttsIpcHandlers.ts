import { ipcMain } from 'electron'
import {
  getTtsCacheStatus,
  synthesizeSpeech,
  type TtsSynthesizePayload,
} from './ttsService'
import type { RuntimeSettings } from './settings'

type TtsServicePaths = {
  dataRoot: string
  userDataRoot: string
}

type TtsIpcDeps = {
  loadSettings: () => RuntimeSettings
  getTtsServicePaths: () => TtsServicePaths
}

export function registerTtsIpcHandlers({
  loadSettings,
  getTtsServicePaths,
}: TtsIpcDeps) {
  ipcMain.handle('tts:synthesize', async (_event, payload: TtsSynthesizePayload) => {
    return synthesizeSpeech(loadSettings(), payload, getTtsServicePaths())
  })

  ipcMain.handle('tts:status', async (_event, payload: TtsSynthesizePayload) => {
    return getTtsCacheStatus(loadSettings(), payload, getTtsServicePaths())
  })
}

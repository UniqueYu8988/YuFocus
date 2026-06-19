import { ipcMain } from 'electron'
import { listKnowledgeLibrary } from '../services/knowledgeLibrary'
import type { RuntimeSettings } from '../runtime/settings'

type KnowledgeIpcDeps = {
  loadSettings: () => RuntimeSettings
}

export function registerKnowledgeIpcHandlers({
  loadSettings,
}: KnowledgeIpcDeps) {
  ipcMain.handle('knowledge:list', async () => {
    return listKnowledgeLibrary(loadSettings())
  })
}

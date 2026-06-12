import { ipcMain } from 'electron'
import { listKnowledgeLibrary } from './knowledgeLibrary'
import type { RuntimeSettings } from './settings'

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

import { ipcMain } from 'electron'
import type { LearningLibraryPayload, LearningLibraryRefreshResult, LearningRecord } from './learningLibraryStore'

type LearningLibraryIpcDeps = {
  loadLearningLibraryPayload: () => LearningLibraryPayload
  openLearningRecord: (recordId: string) => unknown
  refreshLearningLibraryStructure: () => LearningLibraryRefreshResult
  upsertLearningRecord: (record: LearningRecord) => unknown
  deleteLearningRecord: (recordId: string) => unknown
}

export function registerLearningLibraryIpcHandlers({
  loadLearningLibraryPayload,
  openLearningRecord,
  refreshLearningLibraryStructure,
  upsertLearningRecord,
  deleteLearningRecord,
}: LearningLibraryIpcDeps) {
  ipcMain.handle('learning:library:load', async () => loadLearningLibraryPayload())

  ipcMain.handle('learning:library:open', async (_event, recordId: string) => {
    if (!recordId) {
      throw new Error('未提供资料记录 ID。')
    }
    return openLearningRecord(recordId)
  })

  ipcMain.handle('learning:library:refresh-structure', async () => {
    return refreshLearningLibraryStructure()
  })

  ipcMain.handle('learning:library:save', async (_event, record: LearningRecord) => {
    if (!record?.id && !record?.packageId) {
      throw new Error('资料记录缺少标识。')
    }
    return upsertLearningRecord(record)
  })

  ipcMain.handle('learning:library:delete', async (_event, recordId: string) => {
    if (!recordId) {
      throw new Error('未提供资料记录 ID。')
    }
    return deleteLearningRecord(recordId)
  })
}

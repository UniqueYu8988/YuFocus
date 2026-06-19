import path from 'node:path'
import {
  assertPathInside,
  deletePathIfExists,
  deletePathIfInsideAnyRoot,
  getComparablePath,
} from './pathSafety'
import { sanitizeDisplayText } from '../runtime/settings'
import type { KnowledgeLibraryFile } from './knowledgeLibrary'
import type { LearningLibraryState, LearningRecord } from '../legacy/learningLibraryStore'
import type { MaterialPackageSummary } from './materialInventory'
import type { WorkbenchQueueItem } from '../queue/workbenchQueue'

export type MaterialDeleteResult = {
  deletedPaths: string[]
  skippedPaths?: string[]
}

export type WorkbenchQueueClearResult = {
  clearedCount: number
  archivedCount: number
  deletedMaterialCount: number
  deletedPaths: string[]
  skippedPaths: string[]
}

export type MaterialDeletionDeps<Settings> = {
  loadSettings: () => Settings
  resolveMaterialOutputDir: (settings: Settings) => string
  resolveKnowledgeOutputDir: (settings: Settings) => string
  resolveOutputRoot: (settings: Settings) => string
  listMaterialPackages: (settings: Settings) => { records: MaterialPackageSummary[] }
  loadKnowledgeLibraryFile: (settings: Settings) => KnowledgeLibraryFile
  saveKnowledgeLibraryFile: (settings: Settings, library: KnowledgeLibraryFile) => void
  loadLearningLibraryState: () => LearningLibraryState
  saveLearningLibraryState: (state: LearningLibraryState) => void
  loadWorkbenchQueue: () => WorkbenchQueueItem[]
  saveWorkbenchQueueDirect: (items: WorkbenchQueueItem[]) => void
  isQueueProcessing: () => boolean
  isMaterialRecordSummaryReady: (record: MaterialPackageSummary | null) => boolean
  buildArchivedLearningRecord: (record: MaterialPackageSummary) => LearningRecord
  saveArchivedLearningRecord: (record: LearningRecord) => void
}

export function createMaterialDeletion<Settings>(deps: MaterialDeletionDeps<Settings>) {
  const deleteMaterialPackage = (settings: Settings, materialPath: string): MaterialDeleteResult => {
    const rootDir = deps.resolveMaterialOutputDir(settings)
    const knowledgeRootDir = deps.resolveKnowledgeOutputDir(settings)
    const outputRootDir = deps.resolveOutputRoot(settings)
    const safeMaterialPath = assertPathInside(materialPath, rootDir, '资料包')
    const inventory = deps.listMaterialPackages(settings)
    const record = inventory.records.find((item) => getComparablePath(item.path) === getComparablePath(safeMaterialPath))
    const deletedPaths: string[] = []
    const skippedPaths: string[] = []
    deletePathIfExists(safeMaterialPath, deletedPaths)

    const sourceId = sanitizeDisplayText(record?.sourceId ?? '')

    const knowledgeLibrary = deps.loadKnowledgeLibraryFile(settings)
    const nextKnowledgeRecords = knowledgeLibrary.records.filter((item) => {
      const materialMatches = getComparablePath(item.materialPath) === getComparablePath(safeMaterialPath)
      const sourceMatches = Boolean(sourceId && item.sourceId === sourceId)
      if (!materialMatches && !sourceMatches) return true
      if (item.libraryPath) {
        deletePathIfInsideAnyRoot(item.libraryPath, [knowledgeRootDir, outputRootDir], deletedPaths, skippedPaths)
      }
      return false
    })
    if (nextKnowledgeRecords.length !== knowledgeLibrary.records.length) {
      deps.saveKnowledgeLibraryFile(settings, {
        schema_version: 'shijie.knowledge-library.v0.1',
        records: nextKnowledgeRecords,
      })
    }

    const learningLibrary = deps.loadLearningLibraryState()
    const nextLearningRecords = Object.fromEntries(
      Object.entries(learningLibrary.records).filter(([, item]) => {
        const importedPath = sanitizeDisplayText(item.importedCoursePath ?? item.packagePath ?? '')
        const resolvedImportedPath = importedPath ? path.resolve(importedPath) : ''
        const comparableImportedPath = resolvedImportedPath ? getComparablePath(resolvedImportedPath) : ''
        const comparableMaterialPath = getComparablePath(safeMaterialPath)
        const pathMatches = Boolean(
          comparableImportedPath &&
          (comparableImportedPath === comparableMaterialPath || comparableImportedPath.startsWith(`${comparableMaterialPath}${path.sep}`)),
        )
        const sourceMatches = Boolean(sourceId && item.sourceId === sourceId)
        return !(pathMatches || sourceMatches)
      }),
    )
    if (Object.keys(nextLearningRecords).length !== Object.keys(learningLibrary.records).length) {
      const currentStillExists = Boolean(
        learningLibrary.currentRecordId && nextLearningRecords[learningLibrary.currentRecordId],
      )
      deps.saveLearningLibraryState({
        currentRecordId: currentStillExists ? learningLibrary.currentRecordId : null,
        records: nextLearningRecords,
      })
    }

    return skippedPaths.length > 0 ? { deletedPaths, skippedPaths } : { deletedPaths }
  }

  const clearWorkbenchQueue = (): WorkbenchQueueClearResult => {
    const currentQueue = deps.loadWorkbenchQueue()
    const nextQueue = currentQueue.filter((item) => deps.isQueueProcessing() && item.status === 'processing')
    deps.saveWorkbenchQueueDirect(nextQueue)

    return {
      clearedCount: currentQueue.length - nextQueue.length,
      archivedCount: 0,
      deletedMaterialCount: 0,
      deletedPaths: [],
      skippedPaths: [],
    }
  }

  return {
    clearWorkbenchQueue,
    deleteMaterialPackage,
  }
}

import path from 'node:path'
import {
  assertPathInside,
  deletePathIfExists,
  deletePathIfInsideAnyRoot,
  getComparablePath,
} from './pathSafety'
import { sanitizeDisplayText } from './settings'
import type { KnowledgeLibraryFile } from './knowledgeLibrary'
import type { LearningLibraryState, LearningRecord } from './learningLibraryStore'
import type { MaterialPackageSummary } from './materialInventory'
import type { WorkbenchQueueItem } from './workbenchQueue'

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
    const settings = deps.loadSettings()
    const currentQueue = deps.loadWorkbenchQueue()
    const activeProcessingBvids = new Set(
      (deps.isQueueProcessing() ? currentQueue : [])
        .filter((item) => item.status === 'processing')
        .map((item) => item.bvid.toLocaleLowerCase('zh-CN')),
    )
    const archivedRecords: LearningRecord[] = []
    const deletedPaths: string[] = []
    const skippedPaths: string[] = []
    let deletedMaterialCount = 0

    for (const record of deps.listMaterialPackages(settings).records) {
      if (record.sourceId && activeProcessingBvids.has(record.sourceId.toLocaleLowerCase('zh-CN'))) {
        skippedPaths.push(record.path)
        continue
      }

      if (deps.isMaterialRecordSummaryReady(record)) {
        try {
          archivedRecords.push(deps.buildArchivedLearningRecord(record))
        } catch (error) {
          skippedPaths.push(`${record.path}：${error instanceof Error ? error.message : String(error)}`)
          continue
        }
      }

      const deleteResult = deleteMaterialPackage(settings, record.path)
      deletedPaths.push(...deleteResult.deletedPaths)
      skippedPaths.push(...(deleteResult.skippedPaths ?? []))
      if (deleteResult.deletedPaths.length > 0) deletedMaterialCount += 1
    }

    for (const record of archivedRecords) {
      deps.saveArchivedLearningRecord(record)
    }

    const nextQueue = currentQueue.filter((item) => deps.isQueueProcessing() && item.status === 'processing')
    deps.saveWorkbenchQueueDirect(nextQueue)

    return {
      clearedCount: currentQueue.length - nextQueue.length,
      archivedCount: archivedRecords.length,
      deletedMaterialCount,
      deletedPaths,
      skippedPaths,
    }
  }

  return {
    clearWorkbenchQueue,
    deleteMaterialPackage,
  }
}

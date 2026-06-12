import path from 'node:path'
import {
  buildArchivedLearningRecordFromMaterialRecord,
  isMaterialRecordCleaned,
  isMaterialRecordSummaryReady,
} from './learningArchive'
import type { LearningRecord } from './learningLibraryStore'
import type { MaterialPackageSummary } from './materialInventory'
import { getComparablePath } from './pathSafety'
import type { RuntimeSettings } from './settings'
import { materialRecordMatchesBvid } from './sourceDiscovery'

type DistillResultLike = {
  materialPath?: string
  packagePath?: string
}

type MaterialRecordBridgeDeps = {
  listMaterialPackages: (settings: RuntimeSettings) => { records: MaterialPackageSummary[] }
  saveArchivedLearningRecord: (record: LearningRecord) => unknown
  appendRuntimeLog: (message: string) => void
}

export function createMaterialRecordBridge({
  listMaterialPackages,
  saveArchivedLearningRecord,
  appendRuntimeLog,
}: MaterialRecordBridgeDeps) {
  const findMaterialRecordByBvid = (settings: RuntimeSettings, bvid: string) => {
    if (!bvid) return null
    try {
      return listMaterialPackages(settings).records.find((record) => materialRecordMatchesBvid(record, bvid)) ?? null
    } catch (error) {
      appendRuntimeLog(`material lookup failed bvid=${bvid}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  const findMaterialRecordByPath = (settings: RuntimeSettings, materialPath: string) => {
    const normalizedPath = String(materialPath || '').trim()
    if (!normalizedPath) return null
    const comparablePath = getComparablePath(path.resolve(normalizedPath))
    if (!comparablePath) return null
    return listMaterialPackages(settings).records.find((record) => getComparablePath(record.path) === comparablePath) ?? null
  }

  const archiveMaterialRecord = (record: MaterialPackageSummary | null) => {
    if (!isMaterialRecordSummaryReady(record)) return null
    const archiveRecord = buildArchivedLearningRecordFromMaterialRecord(record)
    return saveArchivedLearningRecord(archiveRecord)
  }

  const archiveMaterialByPath = (settings: RuntimeSettings, materialPath: string) => {
    return archiveMaterialRecord(findMaterialRecordByPath(settings, materialPath))
  }

  const getMaterialPathFromDistillResult = (result: DistillResultLike) => {
    return String(result.materialPath || result.packagePath || '').trim()
  }

  return {
    archiveMaterialByPath,
    archiveMaterialRecord,
    buildArchivedLearningRecord: buildArchivedLearningRecordFromMaterialRecord,
    findMaterialRecordByBvid,
    findMaterialRecordByPath,
    getMaterialPathFromDistillResult,
    isMaterialRecordCleaned,
    isMaterialRecordSummaryReady,
  }
}

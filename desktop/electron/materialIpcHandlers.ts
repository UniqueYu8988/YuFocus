import { ipcMain } from 'electron'
import {
  type DistillPayload,
  type DistillResult,
  type MaterialSummaryPayload,
  type MaterialSummaryResult,
} from './backendRuntime'
import type { MaterialPackageSummary } from './materialInventory'
import { sanitizeOptionalPath, type RuntimeSettings } from './settings'

type MaterialIpcDeps = {
  loadSettings: () => RuntimeSettings
  runPythonDistiller: (payload: DistillPayload) => Promise<DistillResult>
  runPythonMaterialSummary: (payload: MaterialSummaryPayload) => Promise<MaterialSummaryResult>
  listMaterialPackages: (settings: RuntimeSettings) => { records: MaterialPackageSummary[] }
  deleteMaterialPackage: (settings: RuntimeSettings, materialPath: string) => unknown
  archiveMaterialByPath: (materialPath: string) => unknown
}

export function registerMaterialIpcHandlers({
  loadSettings,
  runPythonDistiller,
  runPythonMaterialSummary,
  listMaterialPackages,
  deleteMaterialPackage,
  archiveMaterialByPath,
}: MaterialIpcDeps) {
  ipcMain.handle('distill:run', async (_event, payload: DistillPayload) => {
    return runPythonDistiller(payload)
  })

  ipcMain.handle('materials:list', async () => {
    return listMaterialPackages(loadSettings())
  })

  ipcMain.handle('materials:delete', async (_event, materialPath: string) => {
    return deleteMaterialPackage(loadSettings(), materialPath)
  })

  ipcMain.handle('materials:summarize', async (_event, payload: MaterialSummaryPayload) => {
    const result = await runPythonMaterialSummary(payload)
    const materialPath = sanitizeOptionalPath(payload?.materialPath || result.materialPath || '')
    if (materialPath) {
      archiveMaterialByPath(materialPath)
    }
    return result
  })
}

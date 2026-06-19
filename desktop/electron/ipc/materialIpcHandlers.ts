import { ipcMain } from 'electron'
import {
  type DistillPayload,
  type DistillResult,
} from '../runtime/backendRuntime'
import type { MaterialPackageSummary } from '../services/materialInventory'
import type { RuntimeSettings } from '../runtime/settings'

type MaterialIpcDeps = {
  loadSettings: () => RuntimeSettings
  runPythonDistiller: (payload: DistillPayload) => Promise<DistillResult>
  listMaterialPackages: (settings: RuntimeSettings) => { records: MaterialPackageSummary[] }
  deleteMaterialPackage: (settings: RuntimeSettings, materialPath: string) => unknown
  archiveMaterialByPath: (materialPath: string) => unknown
}

export function registerMaterialIpcHandlers({
  loadSettings,
  runPythonDistiller,
  listMaterialPackages,
  deleteMaterialPackage,
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

}

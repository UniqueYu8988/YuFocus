import type { MaterialPackageSummary } from '../services/materialInventory'
import type { RuntimeSettings } from '../runtime/settings'
import {
  collectKnownWorkbenchBvids,
  discoverPinnedSourceVideos,
  type PinnedBilibiliSource,
} from './sourceDiscovery'
import type { WorkbenchQueueItem } from '../queue/workbenchQueue'

type SourceDiscoveryRuntimeDeps = {
  loadSettings: () => RuntimeSettings
  loadPinnedSources: () => PinnedBilibiliSource[]
  loadQueue: () => WorkbenchQueueItem[]
  listMaterialPackages: (settings: RuntimeSettings) => { records: MaterialPackageSummary[] }
  appendRuntimeLog: (message: string) => void
  registryRoot: string
  discoveryWindowMs: number
  sourceQueryBatchSize: number
  recentVideoPageSize: number
}

export function createSourceDiscoveryRuntime({
  loadSettings,
  loadPinnedSources,
  loadQueue,
  listMaterialPackages,
  appendRuntimeLog,
  registryRoot,
  discoveryWindowMs,
  sourceQueryBatchSize,
  recentVideoPageSize,
}: SourceDiscoveryRuntimeDeps) {
  const collectKnownBvidsForDiscovery = (settings = loadSettings()) => {
    try {
      return collectKnownWorkbenchBvids(loadQueue(), listMaterialPackages(settings).records)
    } catch (error) {
      appendRuntimeLog(`known bvid material scan failed: ${error instanceof Error ? error.message : String(error)}`)
      return collectKnownWorkbenchBvids(loadQueue(), [])
    }
  }

  const discoverPinnedSourceVideosForWorkbench = async (settings = loadSettings()) => {
    return discoverPinnedSourceVideos({
      settings,
      pinnedSources: loadPinnedSources(),
      knownBvids: collectKnownBvidsForDiscovery(settings),
      registryRoot,
      discoveryWindowMs,
      sourceQueryBatchSize,
      recentVideoPageSize,
    })
  }

  return {
    collectKnownBvidsForDiscovery,
    discoverPinnedSourceVideosForWorkbench,
  }
}

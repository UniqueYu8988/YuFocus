import type { MaterialPackageSummary } from './materialInventory'
import type { RuntimeSettings } from './settings'
import {
  collectKnownWorkbenchBvids,
  discoverPinnedSourceVideos,
  type PinnedBilibiliSource,
} from './sourceDiscovery'
import type { WorkbenchQueueItem } from './workbenchQueue'

type SourceDiscoveryRuntimeDeps = {
  loadSettings: () => RuntimeSettings
  loadPinnedSources: () => PinnedBilibiliSource[]
  loadQueue: () => WorkbenchQueueItem[]
  listMaterialPackages: (settings: RuntimeSettings) => { records: MaterialPackageSummary[] }
  appendRuntimeLog: (message: string) => void
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

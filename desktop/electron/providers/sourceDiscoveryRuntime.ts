import type { MaterialPackageSummary } from '../services/materialInventory'
import type { RuntimeSettings } from '../runtime/settings'
import {
  collectKnownWorkbenchBvids,
  discoverHistoryBackfillVideo,
  discoverPinnedSourceVideos,
  fetchAndMergeHistoryBackfillPage,
  type PinnedBilibiliSource,
} from './sourceDiscovery'
import type { WorkbenchQueueItem } from '../queue/workbenchQueue'

type SourceDiscoveryRuntimeDeps = {
  loadSettings: () => RuntimeSettings
  loadPinnedSources: () => PinnedBilibiliSource[]
  loadHistorySources?: () => PinnedBilibiliSource[]
  loadQueue: () => WorkbenchQueueItem[]
  listMaterialPackages: (settings: RuntimeSettings) => { records: MaterialPackageSummary[] }
  listLibraryItems?: () => Array<{ bvid?: string; sourceId?: string }>
  appendRuntimeLog: (message: string) => void
  registryRoot: string
  sourceQueryBatchSize: number
  recentVideoPageSize: number
  recentFeedLimit: number
}

export function createSourceDiscoveryRuntime({
  loadSettings,
  loadPinnedSources,
  loadHistorySources,
  loadQueue,
  listMaterialPackages,
  listLibraryItems,
  appendRuntimeLog,
  registryRoot,
  sourceQueryBatchSize,
  recentVideoPageSize,
  recentFeedLimit,
}: SourceDiscoveryRuntimeDeps) {
  const collectKnownBvidsForDiscovery = (settings = loadSettings()) => {
    try {
      return collectKnownWorkbenchBvids(loadQueue(), listMaterialPackages(settings).records, listLibraryItems?.() ?? [])
    } catch (error) {
      appendRuntimeLog(`known bvid material scan failed: ${error instanceof Error ? error.message : String(error)}`)
      return collectKnownWorkbenchBvids(loadQueue(), [], listLibraryItems?.() ?? [])
    }
  }

  const discoverPinnedSourceVideosForWorkbench = async (settings = loadSettings()) => {
    return discoverPinnedSourceVideos({
      settings,
      pinnedSources: loadPinnedSources(),
      knownBvids: collectKnownBvidsForDiscovery(settings),
      registryRoot,
      sourceQueryBatchSize,
      recentVideoPageSize,
      recentFeedLimit,
    })
  }

  const discoverHistoryBackfillVideoForWorkbench = (settings = loadSettings()) => {
    return discoverHistoryBackfillVideo({
      registryRoot,
      sources: loadHistorySources ? loadHistorySources() : loadPinnedSources(),
      knownBvids: collectKnownBvidsForDiscovery(settings),
    })
  }

  const fetchHistoryBackfillPageForWorkbench = async (
    source: PinnedBilibiliSource,
    page: number,
    pageSize: number,
    settings = loadSettings(),
  ) => {
    return fetchAndMergeHistoryBackfillPage({
      settings,
      registryRoot,
      source,
      page,
      pageSize,
    })
  }

  return {
    collectKnownBvidsForDiscovery,
    discoverHistoryBackfillVideoForWorkbench,
    discoverPinnedSourceVideosForWorkbench,
    fetchHistoryBackfillPageForWorkbench,
  }
}

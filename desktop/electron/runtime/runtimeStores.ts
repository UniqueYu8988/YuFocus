import Store from 'electron-store'
import type { LearningLibraryState } from '../legacy/learningLibraryStore'
import type { RuntimeSettings } from './settings'
import type { PinnedBilibiliSource } from '../providers/sourceDiscovery'
import type { WorkbenchQueueItem } from '../queue/workbenchQueue'

type RuntimeStoreSchema = {
  runtimeSettings: RuntimeSettings
  learningLibrary: LearningLibraryState
  workbenchQueue: WorkbenchQueueItem[]
  pinnedBilibiliSources: PinnedBilibiliSource[]
  backgroundAutomationPaused: boolean
}

type LegacyRuntimeStoreSchema = {
  runtimeSettings?: RuntimeSettings
  learningLibrary?: LearningLibraryState
}

export function createRuntimeStores() {
  const secureStore = new Store<RuntimeStoreSchema>({
    name: 'shijie-focus-secure',
  })

  const legacySecureStore = new Store<LegacyRuntimeStoreSchema>({
    name: 'onboard-anything-secure',
  })

  return {
    secureStore,
    legacySecureStore,
  }
}

export function migrateLegacyRuntimeStoreIfNeeded(options: {
  secureStore: Store<RuntimeStoreSchema>
  legacySecureStore: Store<LegacyRuntimeStoreSchema>
  normalizeRuntimeSettings: (settings: RuntimeSettings) => RuntimeSettings
}) {
  const { secureStore, legacySecureStore, normalizeRuntimeSettings } = options
  const hasRuntimeSettings = Boolean(secureStore.get('runtimeSettings'))
  const hasLearningLibrary = Boolean(secureStore.get('learningLibrary'))
  if (!hasRuntimeSettings) {
    const legacyRuntimeSettings = legacySecureStore.get('runtimeSettings')
    if (legacyRuntimeSettings) secureStore.set('runtimeSettings', normalizeRuntimeSettings(legacyRuntimeSettings))
  }
  if (!hasLearningLibrary) {
    const legacyLearningLibrary = legacySecureStore.get('learningLibrary')
    if (legacyLearningLibrary) secureStore.set('learningLibrary', legacyLearningLibrary)
  }
}

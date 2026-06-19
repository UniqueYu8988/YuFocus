import {
  createLearningLibraryStore,
  type LearningLibraryState,
} from './learningLibraryStore'

type LearningLibraryRuntimeDeps = {
  read: () => Partial<LearningLibraryState> | null | undefined
  write: (next: LearningLibraryState) => void
}

export function createLearningLibraryRuntime({ read, write }: LearningLibraryRuntimeDeps) {
  const store = createLearningLibraryStore({ read, write })

  return {
    deleteLearningRecord: store.deleteRecord,
    loadLearningLibraryPayload: store.loadPayload,
    loadLearningLibraryState: store.loadState,
    openLearningRecord: store.openRecord,
    refreshLearningLibraryStructure: store.refreshStructure,
    saveArchivedLearningRecord: store.saveArchivedRecord,
    saveLearningLibraryState: store.saveState,
    upsertLearningRecord: store.upsert,
  }
}

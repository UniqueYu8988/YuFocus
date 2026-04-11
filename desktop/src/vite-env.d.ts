/// <reference types="vite/client" />

type RuntimeSettings = {
  sessdata: string
  output_dir: string
  coach_api_base_url: string
  coach_api_key: string
  coach_model: string
  distiller_api_base_url: string
  distiller_api_key: string
  distiller_model: string
  groq_api_key: string
  groq_transcription_model: string
}

type ArchiveRunResult = {
  videoTitle: string
  publishDate: string
  outputDir: string
  markdownPath: string
  fileGenerated: boolean
  hasSubtitles: boolean
  subtitleGroupCount: number
  subtitleEntryCount: number
  textSourceType: string
  textSourceNote: string
  pageCount: number
  pagesWithSubtitles: number
  missingSubtitlePages: string[]
  aiSkippedReason: string
  resultNote: string
}

type SettingsStatus = {
  bilibili: {
    configured: boolean
    valid: boolean
    accountName: string
    accountId: string
    message: string
  }
  coach: {
    configured: boolean
    valid: boolean
    baseUrl: string
    model: string
    message: string
  }
  distiller: {
    configured: boolean
    valid: boolean
    baseUrl: string
    model: string
    message: string
  }
  groq: {
    configured: boolean
    valid: boolean
    model: string
    message: string
  }
}

type PersistedNodeLearningSession = {
  nodeId: string
  learningStatus: 'teaching' | 'quizzing' | 'correcting' | 'completed'
  messages: Array<{
    id: string
    role: 'system' | 'coach' | 'user'
    content: string
    nodeId?: string
    createdAt: number
  }>
  activeQuestion: string | null
  lastUserAnswer: string
  lastEvaluation: 'correct' | 'incorrect' | null
  hydrated: boolean
  preloaded: boolean
  updatedAt: number
}

type LearningRecord = {
  id: string
  packageId: string
  title: string
  sourceTitle: string
  sourceId: string
  sourceUrl?: string
  importedCoursePath: string | null
  packagePath: string | null
  courseText: string
  currentNodeId: string | null
  completedNodeIds: string[]
  failedNodeIds: string[]
  nodeSessions: Record<string, PersistedNodeLearningSession>
  progressPercent: number
  isArchived: boolean
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

type LearningRecordSummary = Omit<LearningRecord, 'courseText' | 'nodeSessions' | 'completedNodeIds' | 'failedNodeIds' | 'currentNodeId'> & {
  currentNodeId: string | null
  currentNodeTitle: string | null
  completedCount: number
  sessionCount: number
}

type LearningLibraryPayload = {
  currentRecordId: string | null
  records: LearningRecordSummary[]
}

interface Window {
  desktopAPI: {
    minimize: () => Promise<void>
    close: () => Promise<void>
    loadSettings: () => Promise<RuntimeSettings>
    saveSettings: (payload: RuntimeSettings) => Promise<RuntimeSettings>
    loadSettingsStatus: () => Promise<SettingsStatus>
    pickDirectory: () => Promise<string | null>
    importCoursePackage: () => Promise<{ path: string; text: string } | null>
    readCoursePackage: (targetPath: string) => Promise<{ path: string; text: string }>
    runDistillation: (payload: { video: string }) => Promise<{
      packagePath: string
      packageId: string
      title: string
      bvid: string
      textSourceType: string
      textSourceNote: string
      chunkCount: number
      warningCount: number
      warnings: string[]
      text: string
    }>
    loadLearningLibrary: () => Promise<LearningLibraryPayload>
    openLearningRecord: (recordId: string) => Promise<LearningRecord>
    saveLearningRecord: (payload: LearningRecord) => Promise<LearningRecord>
    deleteLearningRecord: (recordId: string) => Promise<LearningLibraryPayload>
    runArchive: (payload: { video: string; generateAi: boolean }) => Promise<ArchiveRunResult>
    openPath: (targetPath: string) => Promise<void>
    showItem: (targetPath: string) => Promise<void>
    openExternal: (targetUrl: string) => Promise<void>
    onArchiveLog: (callback: (message: string) => void) => () => void
    onArchiveProgress: (callback: (payload: { message: string; percent: number }) => void) => () => void
    onDistillProgress: (callback: (payload: { message: string; percent: number }) => void) => () => void
    onWindowFocusChanged: (callback: (payload: { focused: boolean }) => void) => () => void
  }
}

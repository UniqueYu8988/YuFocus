/// <reference types="vite/client" />

type RuntimeSettings = {
  sessdata: string
  output_dir: string
  obsidian_vault_path: string
  obsidian_export_folder: string
  obsidian_auto_sync: boolean
  coach_api_base_url: string
  coach_api_key: string
  coach_model: string
  distiller_api_base_url: string
  distiller_api_key: string
  distiller_model: string
  transcription_provider: string
  groq_api_key: string
  groq_transcription_model: string
  local_transcription_root: string
  local_transcription_python: string
  local_transcription_model_id: string
  local_transcription_device: string
  local_transcription_language: string
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
  attemptHistory: Array<{
    id: string
    nodeTitle: string
    question: string | null
    answer: string
    verdict: 'correct' | 'partial' | 'incorrect'
    matchedKeywords: string[]
    missingKeywords: string[]
    cautionNotes: string[]
    createdAt: number
  }>
  lastUserAnswer: string
  lastEvaluation: 'correct' | 'partial' | 'incorrect' | null
  hydrated: boolean
  preloaded: boolean
  updatedAt: number
}

type StageReplayInsight = {
  recentMistakeCount: number
  focusNodeTitles: string[]
  focusQuestions: string[]
  focusKeywords: string[]
  cautionNotes: string[]
  followupQuestions: string[]
}

type TeachingIntent = 'default' | 'reframe' | 'deepen'

type LearningMilestoneKind =
  | 'node_complete'
  | 'stage_complete'
  | 'correction_recovery'
  | 'course_complete'

type LearningMilestoneEvent = {
  id: string
  kind: LearningMilestoneKind
  title: string
  detail: string
  createdAt: number
  nodeId?: string | null
  stageId?: string | null
  progressPercent?: number
}

type AchievementBadgeCode =
  | 'first_step'
  | 'steady_stride'
  | 'stage_breaker'
  | 'comeback'
  | 'midway'
  | 'course_finisher'

type AchievementBadge = {
  code: AchievementBadgeCode
  label: string
  description: string
  tone: 'neutral' | 'info' | 'success' | 'accent'
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
  milestoneEvents: LearningMilestoneEvent[]
  progressPercent: number
  isArchived: boolean
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

type LearningRecordSummary = Omit<LearningRecord, 'courseText' | 'nodeSessions' | 'completedNodeIds' | 'failedNodeIds' | 'currentNodeId' | 'milestoneEvents'> & {
  currentNodeId: string | null
  currentNodeTitle: string | null
  completedCount: number
  sessionCount: number
  partialCount: number
  incorrectCount: number
  hotspotNodeTitle: string | null
  dominantChallenge: 'stable' | 'partial-heavy' | 'incorrect-heavy'
  stageCompletedCount: number
  totalStageCount: number
  recentMilestones: LearningMilestoneEvent[]
  achievementBadges: AchievementBadge[]
}

type LearningLibraryPayload = {
  currentRecordId: string | null
  records: LearningRecordSummary[]
}

type LearningLibraryRefreshResult = {
  library: LearningLibraryPayload
  recordUpdates: number
  packageUpdates: number
  scannedPackages: number
}

type DistillOutlinePreview = {
  packageId: string
  title: string
  sourceId: string
  pageCount: number
  durationMinutes: number
  note: string
  chapters: Array<{
    id: string
    title: string
    lessonCount: number
    lessonTitles: string[]
  }>
}

type DistillProgressPayload = {
  message: string
  percent: number
  stage?: string
  cacheHint?: string
  audioCompleted?: number
  audioTotal?: number
  chunkCompleted?: number
  chunkTotal?: number
  batchCompleted?: number
  batchTotal?: number
  resumed?: boolean
  prefetchReuseChunkRatio?: number
  prefetchReuseBatchRatio?: number
  outlinePreview?: DistillOutlinePreview
}

type ObsidianExportResult = {
  vaultPath: string
  rootDir: string
  indexPath: string
  progressPath: string
  currentNodePath: string | null
  fileCount: number
}

type ObsidianOpenResult = ObsidianExportResult & {
  openedPath: string
  openedUri: string | null
  openedVia: 'obsidian-uri' | 'file-path'
}

interface Window {
  desktopAPI: {
    minimize: () => Promise<void>
    close: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
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
      stageTimings?: {
        metadata_seconds?: number
        subtitle_fetch_seconds?: number
        audio_backfill_seconds?: number
        distill_seconds?: number
        total_seconds?: number
        cache_total_seconds?: number
        historical_total_seconds?: number
        historical_distill_seconds?: number
        historical_audio_backfill_seconds?: number
        prefetch_chunk_warm_seconds?: number
        prefetch_chunk_count?: number
        prefetch_reuse_chunk_count?: number
        prefetch_reuse_chunk_total?: number
        prefetch_reuse_chunk_ratio?: number
        prefetch_batch_warm_seconds?: number
        prefetch_batch_count?: number
        prefetch_reuse_batch_count?: number
        prefetch_reuse_batch_total?: number
        prefetch_reuse_batch_ratio?: number
        cache_hit?: string
        pipeline?: Record<string, unknown>
      }
      text: string
    }>
    exportCourseToObsidian: (payload: {
      course: Record<string, unknown>
      currentNodeId: string | null
      completedNodeIds: string[]
      failedNodeIds?: string[]
    }) => Promise<ObsidianExportResult>
    openObsidianTarget: (payload: {
      course: Record<string, unknown>
      currentNodeId: string | null
      completedNodeIds: string[]
      failedNodeIds?: string[]
      target?: 'current' | 'board' | 'index'
    }) => Promise<ObsidianOpenResult>
    loadLearningLibrary: () => Promise<LearningLibraryPayload>
    openLearningRecord: (recordId: string) => Promise<LearningRecord>
    refreshLearningLibraryStructure: () => Promise<LearningLibraryRefreshResult>
    saveLearningRecord: (payload: LearningRecord) => Promise<LearningRecord>
    deleteLearningRecord: (recordId: string) => Promise<LearningLibraryPayload>
    runArchive: (payload: { video: string; generateAi: boolean }) => Promise<ArchiveRunResult>
    openPath: (targetPath: string) => Promise<void>
    showItem: (targetPath: string) => Promise<void>
    openExternal: (targetUrl: string) => Promise<void>
    onArchiveLog: (callback: (message: string) => void) => () => void
    onArchiveProgress: (callback: (payload: { message: string; percent: number }) => void) => () => void
    onDistillProgress: (callback: (payload: DistillProgressPayload) => void) => () => void
    onWindowFocusChanged: (callback: (payload: { focused: boolean }) => void) => () => void
    onWindowMaximizedChanged: (callback: (payload: { maximized: boolean }) => void) => () => void
    onDeepLinkOpen: (callback: (payload: { packageId: string; nodeId: string | null }) => void) => () => void
  }
}

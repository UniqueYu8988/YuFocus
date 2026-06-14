/// <reference types="vite/client" />
import type { LearningLibraryPayload, LearningRecord } from './types/course'

declare global {
type RuntimeSettings = {
  sessdata: string
  output_dir: string
  obsidian_vault_path: string
  obsidian_export_folder: string
  obsidian_auto_sync: boolean
  tts_provider: string
  minimax_api_key: string
  minimax_tts_endpoint: string
  minimax_tts_model: string
  minimax_tts_voice_id: string
  minimax_tts_speed: number
  minimax_tts_volume: number
  minimax_tts_pitch: number
  mimo_api_key: string
  mimo_text_endpoint: string
  mimo_text_model: string
  mimo_tts_endpoint: string
  mimo_tts_model: string
  mimo_tts_voice_id: string
  mimo_tts_style_prompt: string
  transcription_provider: string
  local_transcription_root: string
  local_transcription_python: string
  local_transcription_model_id: string
  local_transcription_device: string
  local_transcription_language: string
  resource_mode: string
  background_automation_enabled: boolean
  background_check_interval_minutes: number
  email_push_enabled: boolean
  email_smtp_host: string
  email_smtp_port: number
  email_smtp_secure: boolean
  email_smtp_user: string
  email_smtp_password: string
  email_from: string
  email_to: string
  workbench_queue_concurrency: number
}

type SettingsStatus = {
  bilibili: {
    configured: boolean
    valid: boolean
    accountName: string
    accountId: string
    message: string
  }
}

type LearningLibraryRefreshResult = {
  library: LearningLibraryPayload
  recordUpdates: number
  packageUpdates: number
  scannedPackages: number
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

type TtsSynthesizeResult = {
  provider: string
  model: string
  voiceId: string
  filePath: string
  filePaths: string[]
  dataUrl: string
  dataUrls: string[]
  cached: boolean
  characters: number
  usage: TtsUsageSnapshot
}

type TtsCacheStatusResult = {
  cached: boolean
  characters: number
  filePath: string | null
  filePaths: string[]
  usage: TtsUsageSnapshot
}

type TtsUsageSnapshot = {
  date: string
  usedCharacters: number
  dailyLimit: number
  remainingCharacters: number
  note: string
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
  resumed?: boolean
  outlinePreview?: DistillOutlinePreview
}

type BackgroundAutomationStatus = {
  enabled: boolean
  paused: boolean
  running: boolean
  lastCheckAt: number | null
  nextCheckAt: number | null
  lastResult: string
  lastError: string | null
  checkIntervalMinutes: number
}

type EmailSendResult = {
  ok: boolean
  mode: 'smtp'
  message: string
  configured: boolean
  recipientCount: number
}

type WorkbenchQueueClearResult = {
  clearedCount: number
  archivedCount: number
  deletedMaterialCount: number
  deletedPaths: string[]
  skippedPaths: string[]
}

type MaterialPackageSummary = {
  name: string
  path: string
  title: string
  sourceId: string
  sourceType: string
  sourceUrl: string
  creator: string
  textSourceType: string
  blockCount: number
  textLength: number
  byteSize: number
  rawTranscriptTextLength: number
  notebooklmTextLength: number
  editorialSummaryTextLength: number
  editorialSummaryHtmlBytes: number
  metricsPath: string
  metricsExists: boolean
  metricsElapsedSeconds: number
  metricsInputTokens: number
  metricsOutputTokens: number
  metricsTotalTokens: number
  emailPushedAt: number
  updatedAt: number
  notebooklmPath: string
  notebooklmExists: boolean
  editorialSummaryStatus: string
  editorialSummaryPath: string
  editorialSummaryExists: boolean
  editorialSummaryHtmlPath: string
  editorialSummaryHtmlExists: boolean
  editorialCardsPath: string
  editorialCardsExists: boolean
  editorialReviewPath: string
  editorialReviewExists: boolean
  rawTranscriptPath: string
  rawTranscriptExists: boolean
  sourceIndexPath: string
  sourceIndexExists: boolean
  handoffPath: string
  handoffExists: boolean
  runStatePath: string
  runStateExists: boolean
  handoffStatusPath: string
  handoffStatusExists: boolean
  workflowStage: string
  workflowStageLabel: string
  nextActionLabel: string
  pipelineReady: boolean
}

type BilibiliFollowSourcesPayload = {
  provider: 'bilibili'
  configured: boolean
  authenticated: boolean
  accountName: string
  accountId: string
  message: string
  nextAction: string
  items: Array<{
    mid: string
    name: string
    face: string
    sign: string
    mtime: number
    officialTitle: string
    latestCount?: number
  }>
}

type BilibiliSourceVideosPayload = {
  provider: 'bilibili'
  fetchedAt: number
  totalVideos: number
  sources: Array<{
    mid: string
    name: string
    error: string
    videos: Array<{
      bvid: string
      aid: string
      title: string
      authorMid: string
      authorName: string
      pic: string
      description: string
      durationText: string
      durationSeconds: number
      pubdate: number
      statView: number
      url: string
    }>
  }>
}

type WorkbenchQueueItem = BilibiliSourceVideosPayload['sources'][number]['videos'][number] & {
  queueId: string
  sourceName?: string
  queueSource?: 'manual' | 'follow_source'
  editorialMode?: 'auto' | 'force' | 'off'
  status: 'queued' | 'processing' | 'done' | 'failed'
  materialPath?: string
  lastError?: string
  queuedAt?: number
  updatedAt?: number
}

type BilibiliVideoMetadata = BilibiliSourceVideosPayload['sources'][number]['videos'][number]

type PinnedBilibiliSource = {
  mid: string
  name: string
  face: string
  sign: string
  officialTitle: string
  pinnedAt: number
}

type KnowledgeImportResult = {
  id: string
  title: string
  sourceTitle: string
  sourceId: string
  sourceUrl: string
  materialPath: string
  knowledgeBriefPath: string
  libraryPath: string
  textLength: number
  importedAt: number
  updatedAt: number
}

type KnowledgeLibrarySummary = KnowledgeImportResult & {
  fileExists: boolean
  preview: string
  searchText: string
}

type KnowledgeLibraryPayload = {
  rootDir: string
  libraryPath: string
  records: KnowledgeLibrarySummary[]
}

type WorkflowDocumentKey = 'agents' | 'product' | 'architecture' | 'current_state' | 'baseline_acceptance' | 'stabilization_plan'

type WorkflowDocumentPayload = {
  key: WorkflowDocumentKey
  title: string
  relativePath: string
  path: string
  updatedAt: number
  content: string
}

  interface Window {
    desktopAPI: {
      isElectron: boolean
      minimize: () => Promise<void>
      close: () => Promise<void>
      toggleMaximize: () => Promise<boolean>
      loadSettings: () => Promise<RuntimeSettings>
      saveSettings: (payload: RuntimeSettings) => Promise<RuntimeSettings>
      loadSettingsStatus: () => Promise<SettingsStatus>
      getAutomationStatus: () => Promise<BackgroundAutomationStatus>
      runAutomationCheckNow: () => Promise<BackgroundAutomationStatus>
      setAutomationPaused: (paused: boolean) => Promise<BackgroundAutomationStatus>
      testEmailPush: () => Promise<EmailSendResult>
      copyText: (text: string) => Promise<void>
      pickDirectory: () => Promise<string | null>
      pickMediaFile: () => Promise<{ path: string; name: string } | null>
      pickImageFile: () => Promise<{ path: string; name: string } | null>
      importCoursePackage: () => Promise<{ path: string; text: string } | null>
      readCoursePackage: (targetPath: string) => Promise<{ path: string; text: string }>
      copyTextFile: (targetPath: string) => Promise<{ path: string; length: number }>
      runDistillation: (payload: { video?: string; sourceKind?: 'bilibili' | 'local_media'; mediaPath?: string; editorialMode?: 'auto' | 'force' | 'off' }) => Promise<{
        packagePath: string
        packageId: string
        title: string
        bvid: string
        textSourceType: string
        textSourceNote: string
        materialPath?: string
        coveragePath?: string
        chunkCount: number
        warningCount: number
        warnings: string[]
        stageTimings?: {
          metadata_seconds?: number
          subtitle_fetch_seconds?: number
          audio_backfill_seconds?: number
          total_seconds?: number
          pipeline?: Record<string, unknown>
        }
        text: string
      }>
      listMaterialPackages: () => Promise<{
        rootDir: string
        records: MaterialPackageSummary[]
      }>
      deleteMaterialPackage: (materialPath: string) => Promise<{ deletedPaths: string[]; skippedPaths?: string[] }>
      summarizeMaterialPackage: (payload: { materialPath: string; editorialMode?: 'auto' | 'force' | 'off' }) => Promise<{
        materialPath: string
        editorialArticlePath: string
        editorialHtmlPath?: string
        editorialCardsPath?: string
        editorialReviewPath?: string
        editorialSummary?: Record<string, unknown>
      }>
      loadWorkbenchQueue: () => Promise<WorkbenchQueueItem[]>
      saveWorkbenchQueue: (items: WorkbenchQueueItem[]) => Promise<WorkbenchQueueItem[]>
      clearWorkbenchQueue: () => Promise<WorkbenchQueueClearResult>
      loadPinnedBilibiliSources: () => Promise<PinnedBilibiliSource[]>
      savePinnedBilibiliSources: (items: PinnedBilibiliSource[]) => Promise<PinnedBilibiliSource[]>
      listBilibiliFollowSources: () => Promise<BilibiliFollowSourcesPayload>
      listBilibiliSourceVideos: (payload: { sources: Array<{ mid: string; name?: string }>; pageSize?: number }) => Promise<BilibiliSourceVideosPayload>
      getBilibiliVideoMetadata: (payload: { video: string }) => Promise<BilibiliVideoMetadata>
      listKnowledgeLibrary: () => Promise<KnowledgeLibraryPayload>
      loadLearningLibrary: () => Promise<LearningLibraryPayload>
      openLearningRecord: (recordId: string) => Promise<LearningRecord>
      refreshLearningLibraryStructure: () => Promise<LearningLibraryRefreshResult>
      saveLearningRecord: (payload: LearningRecord) => Promise<LearningRecord>
      deleteLearningRecord: (recordId: string) => Promise<LearningLibraryPayload>
      exportObsidianCourse: (payload: { course: Record<string, unknown>; currentNodeId: string | null; completedNodeIds: string[] }) => Promise<ObsidianExportResult>
      openObsidianCourse: (payload: { course: Record<string, unknown>; currentNodeId: string | null; completedNodeIds: string[]; target?: 'current' | 'board' | 'index' }) => Promise<ObsidianOpenResult>
      synthesizeSpeech: (payload: { text: string; nodeId?: string | null }) => Promise<TtsSynthesizeResult>
      checkSpeechCache: (payload: { text: string; nodeId?: string | null }) => Promise<TtsCacheStatusResult>
      readTextFile: (targetPath: string) => Promise<string>
      readWorkflowDocument: (documentKey: WorkflowDocumentKey) => Promise<WorkflowDocumentPayload>
      openPath: (targetPath: string) => Promise<void>
      showItem: (targetPath: string) => Promise<void>
      openExternal: (targetUrl: string) => Promise<void>
      onDistillProgress: (callback: (payload: DistillProgressPayload) => void) => () => void
      onAutomationStatus: (callback: (payload: BackgroundAutomationStatus) => void) => () => void
      onWorkbenchQueueChanged: (callback: (items: WorkbenchQueueItem[]) => void) => () => void
      onWindowFocusChanged: (callback: (payload: { focused: boolean }) => void) => () => void
      onWindowMaximizedChanged: (callback: (payload: { maximized: boolean }) => void) => () => void
      onDeepLinkOpen: (callback: (payload: { packageId: string; nodeId: string | null }) => void) => () => void
    }
  }
}

export {}

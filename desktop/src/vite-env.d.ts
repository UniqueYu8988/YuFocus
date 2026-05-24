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

type MaterialPackageSummary = {
  name: string
  path: string
  title: string
  sourceId: string
  blockCount: number
  textLength: number
  updatedAt: number
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
  auditReady: boolean
  releaseReady: boolean
  validationReportPath: string
  validationReportExists: boolean
  validationErrorCount: number
  validationWarningCount: number
  qualityAuditReportPath: string
  qualityAuditReportExists: boolean
  qualityAuditResult: string
  authoringDir: string
  codexCoursePlanPath: string
  codexCoursePlanExists: boolean
  synthesisPlanPath: string
  synthesisPlanExists: boolean
  knowledgeBriefPath: string
  knowledgeBriefExists: boolean
  chapterMapPath: string
  chapterMapExists: boolean
  knowledgeRecordPath: string
  knowledgeImported: boolean
  codexGoalPromptPath: string
  readonlyAuditPromptPath: string
  finalCoursePath: string
  finalCourseExists: boolean
  publishedCoursePath: string
  publishedCourseExists: boolean
  importReadyCoursePath: string
  importReadyCourseExists: boolean
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

  interface Window {
    desktopAPI: {
      isElectron: boolean
      minimize: () => Promise<void>
      close: () => Promise<void>
      toggleMaximize: () => Promise<boolean>
      loadSettings: () => Promise<RuntimeSettings>
      saveSettings: (payload: RuntimeSettings) => Promise<RuntimeSettings>
      loadSettingsStatus: () => Promise<SettingsStatus>
      copyText: (text: string) => Promise<void>
      pickDirectory: () => Promise<string | null>
      pickMediaFile: () => Promise<{ path: string; name: string } | null>
      pickImageFile: () => Promise<{ path: string; name: string } | null>
      importCoursePackage: () => Promise<{ path: string; text: string } | null>
      readCoursePackage: (targetPath: string) => Promise<{ path: string; text: string }>
      copyTextFile: (targetPath: string) => Promise<{ path: string; length: number }>
      attachCourseVisualMap: (payload: { targetPath: string; imagePath: string }) => Promise<{ path: string; text: string; assetPath: string; syncedRecordCount: number }>
      runDistillation: (payload: { video?: string; sourceKind?: 'bilibili' | 'local_media'; mediaPath?: string }) => Promise<{
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
        coursePackageRootDir: string
        records: MaterialPackageSummary[]
      }>
      deleteMaterialPackage: (materialPath: string) => Promise<{ deletedPaths: string[]; skippedPaths?: string[] }>
      importKnowledgeBrief: (materialPath: string) => Promise<KnowledgeImportResult>
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
      openPath: (targetPath: string) => Promise<void>
      showItem: (targetPath: string) => Promise<void>
      openExternal: (targetUrl: string) => Promise<void>
      onDistillProgress: (callback: (payload: DistillProgressPayload) => void) => () => void
      onWindowFocusChanged: (callback: (payload: { focused: boolean }) => void) => () => void
      onWindowMaximizedChanged: (callback: (payload: { maximized: boolean }) => void) => () => void
      onDeepLinkOpen: (callback: (payload: { packageId: string; nodeId: string | null }) => void) => () => void
    }
  }
}

export {}

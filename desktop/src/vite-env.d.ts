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
  dataUrl: string
  cached: boolean
  characters: number
  usage: TtsUsageSnapshot
}

type TtsCacheStatusResult = {
  cached: boolean
  characters: number
  filePath: string | null
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
  batchCompleted?: number
  batchTotal?: number
  resumed?: boolean
  prefetchReuseChunkRatio?: number
  prefetchReuseBatchRatio?: number
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
  startHerePath: string
  codexPromptPath: string
  finalCoursePath: string
  finalCourseExists: boolean
  publishedCoursePath: string
  publishedCourseExists: boolean
  importReadyCoursePath: string
  importReadyCourseExists: boolean
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
      pickMediaFile: () => Promise<{ path: string; name: string } | null>
      importCoursePackage: () => Promise<{ path: string; text: string } | null>
      readCoursePackage: (targetPath: string) => Promise<{ path: string; text: string }>
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
      listMaterialPackages: () => Promise<{
        rootDir: string
        coursePackageRootDir: string
        records: MaterialPackageSummary[]
      }>
      loadLearningLibrary: () => Promise<LearningLibraryPayload>
      openLearningRecord: (recordId: string) => Promise<LearningRecord>
      refreshLearningLibraryStructure: () => Promise<LearningLibraryRefreshResult>
      saveLearningRecord: (payload: LearningRecord) => Promise<LearningRecord>
      deleteLearningRecord: (recordId: string) => Promise<LearningLibraryPayload>
      exportObsidianCourse: (payload: { course: Record<string, unknown>; currentNodeId: string | null; completedNodeIds: string[] }) => Promise<ObsidianExportResult>
      openObsidianCourse: (payload: { course: Record<string, unknown>; currentNodeId: string | null; completedNodeIds: string[]; target?: 'current' | 'board' | 'index' }) => Promise<ObsidianOpenResult>
      synthesizeSpeech: (payload: { text: string; nodeId?: string | null }) => Promise<TtsSynthesizeResult>
      checkSpeechCache: (payload: { text: string; nodeId?: string | null }) => Promise<TtsCacheStatusResult>
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

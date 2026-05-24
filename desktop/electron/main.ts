import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'

const APP_NAME = '视界专注'
const APP_ID = 'ShijieFocus'
const APP_PROTOCOL = 'shijiefocus'

app.name = APP_NAME
app.setAppUserModelId(APP_ID)

let mainWindow: BrowserWindow | null = null
let pendingDeepLink: { packageId: string; nodeId: string | null } | null = null

function registerAppProtocol() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
      return
    }
    app.setAsDefaultProtocolClient(APP_PROTOCOL)
  } catch (error) {
    appendRuntimeLog(`protocol register failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseDeepLinkUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== `${APP_PROTOCOL}:`) return null
    const packageId = parsed.searchParams.get('packageId')?.trim() || ''
    const nodeId = parsed.searchParams.get('nodeId')?.trim() || null
    if (!packageId) return null
    return { packageId, nodeId }
  } catch {
    return null
  }
}

function extractDeepLinkFromArgv(argv: string[]) {
  for (const arg of argv) {
    if (!arg || typeof arg !== 'string') continue
    if (!arg.toLowerCase().startsWith(`${APP_PROTOCOL}://`)) continue
    const parsed = parseDeepLinkUrl(arg)
    if (parsed) return parsed
  }
  return null
}

function dispatchDeepLink(payload: { packageId: string; nodeId: string | null }) {
  pendingDeepLink = payload
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deeplink:open', payload)
  }
}

function resolveDevProjectRoot() {
  const searchRoots = [
    path.dirname(process.execPath),
    process.cwd(),
    __dirname,
  ].filter(Boolean)

  for (const root of searchRoots) {
    for (let depth = 0; depth <= 6; depth += 1) {
      const candidate = path.resolve(root, ...Array(depth).fill('..'))
      if (fs.existsSync(path.join(candidate, 'src', 'main.py'))) {
        return candidate
      }
    }
  }

  const desktopRootFallback = path.resolve(__dirname, '..')
  return path.resolve(desktopRootFallback, '..')
}

function resolvePortableExecutableDir() {
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)
}

function findExistingDataRoot() {
  const searchRoots = [
    resolvePortableExecutableDir(),
    path.dirname(process.execPath),
    process.cwd(),
  ].filter(Boolean)

  for (const root of searchRoots) {
    for (let depth = 0; depth <= 6; depth += 1) {
      const candidate = path.resolve(root, ...Array(depth).fill('..'))
      if (
        fs.existsSync(path.join(candidate, '.shijie-focus.local.json')) ||
        fs.existsSync(path.join(candidate, '.biliarchive.local.json'))
      ) {
        return candidate
      }
    }
  }

  return null
}

const devProjectRoot = resolveDevProjectRoot()
const dataRoot = app.isPackaged ? (findExistingDataRoot() || resolvePortableExecutableDir()) : devProjectRoot
const userDataRoot = app.getPath('userData')
const settingsPath = path.join(userDataRoot, '.shijie-focus.local.json')
const windowStatePath = path.join(userDataRoot, '.shijie-focus.window.json')
const legacyWindowStatePath = path.join(dataRoot, '.biliarchive.window.json')
const runtimeLogPath = path.join(userDataRoot, '.shijie-focus-runtime.log')
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'assets', 'app_icon.ico')
  : path.join(devProjectRoot, 'assets', 'app_icon.ico')

const WINDOW_DEFAULT_WIDTH = 1280
const WINDOW_DEFAULT_HEIGHT = 800
const WINDOW_MIN_WIDTH = 1000
const WINDOW_MIN_HEIGHT = 700
const DISTILL_PROCESS_TIMEOUT_MS = Number(process.env.ONBOARD_DISTILL_PROCESS_TIMEOUT_MS || 1_800_000)

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

type DistillResult = {
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
    cache_hit?: string
    pipeline?: Record<string, unknown>
  }
  text: string
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
  authoringDir: string
  gptMaterialPromptPath: string
  gptMaterialWorkspaceZipPath: string
  gptMaterialWorkspaceZipExists: boolean
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

type MaterialValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

type MaterialValidationReport = {
  schema_version: 'shijie.material-validation.v0.1'
  generated_at: string
  material_id: string
  material_path: string
  stage: string
  pipeline_ready: boolean
  audit_ready: boolean
  release_ready: boolean
  summary: {
    error_count: number
    warning_count: number
    learning_notes_chars: number
    learning_notes_plain_chars: number
    chapter_count: number
    section_count: number
    shortest_section_chars: number
    median_section_chars: number
    long_material: boolean
  }
  issues: MaterialValidationIssue[]
}

type KnowledgeRecord = {
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

type KnowledgeLibraryFile = {
  schema_version: 'shijie.knowledge-library.v0.1'
  records: KnowledgeRecord[]
}

type KnowledgeLibrarySummary = KnowledgeRecord & {
  fileExists: boolean
  preview: string
  searchText: string
}

type KnowledgeLibraryPayload = {
  rootDir: string
  libraryPath: string
  records: KnowledgeLibrarySummary[]
}

type CourseVisualMapAttachmentPayload = {
  targetPath: string
  imagePath: string
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
  outlinePreview?: DistillOutlinePreview
  stage?: string
  cacheHint?: string
  audioCompleted?: number
  audioTotal?: number
  chunkCompleted?: number
  chunkTotal?: number
  resumed?: boolean
}

type DistillPayload = {
  video?: string
  sourceKind?: 'bilibili' | 'local_media'
  mediaPath?: string
}

type DeleteResult = {
  deletedPaths: string[]
  skippedPaths?: string[]
}

type ObsidianExportPayload = {
  course: Record<string, unknown>
  currentNodeId: string | null
  completedNodeIds: string[]
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

type TtsSynthesizePayload = {
  text: string
  nodeId?: string | null
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

type PersistedNodeLearningSession = {
  nodeId: string
  learningStatus: 'teaching' | 'quizzing' | 'completed'
  messages: Array<{
    id: string
    role: 'system' | 'coach' | 'user'
    content: string
    nodeId?: string
    createdAt: number
  }>
  activeQuestion: string | null
  lastUserAnswer: string
  lastEvaluation: 'correct' | 'partial' | 'incorrect' | null
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
  nodeSessions: Record<string, PersistedNodeLearningSession>
  milestoneEvents: Array<{
    id: string
    kind: 'node_complete' | 'stage_complete' | 'course_complete'
    title: string
    detail: string
    createdAt: number
    nodeId?: string | null
    stageId?: string | null
    progressPercent?: number
  }>
  progressPercent: number
  isArchived: boolean
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

type LearningRecordSummary = Omit<LearningRecord, 'courseText' | 'nodeSessions' | 'completedNodeIds' | 'currentNodeId' | 'milestoneEvents'> & {
  currentNodeId: string | null
  currentNodeTitle: string | null
  completedCount: number
  sessionCount: number
  stageCompletedCount: number
  totalStageCount: number
  recentMilestones: LearningRecord['milestoneEvents']
  achievementBadges: Array<{
    code: 'first_step' | 'steady_stride' | 'stage_breaker' | 'midway' | 'course_finisher'
    label: string
    description: string
    tone: 'neutral' | 'info' | 'success' | 'accent'
  }>
}

type LearningLibraryState = {
  currentRecordId: string | null
  records: Record<string, LearningRecord>
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

const COURSE_MAX_ROOT_CHAPTERS = 24
const COURSE_MICRO_ROOT_LESSON_THRESHOLD = 2
const COURSE_TARGET_GROUP_LEAF_LESSONS = 8
const COURSE_STAGE_THEME_HINTS: Array<{ label: string; keywords: string[] }> = [
  { label: '正则表达式与文本匹配', keywords: ['正则', 'regex', '匹配', '量词', '分组', '贪婪', '非贪婪', '字符类'] },
  { label: '综合练习与项目演练', keywords: ['练习', '项目', '综合应用', '案例', '实训', '题目', '巩固'] },
  { label: '网络请求与爬虫基础', keywords: ['爬虫', 'http', 'https', 'url', 'robots', 'requests', '请求', '响应', '网页'] },
  { label: '数据解析与存储实践', keywords: ['json', 'xpath', 'jsonpath', 'excel', 'csv', '数据库', 'pymongo', '存储', '解析'] },
  { label: '并发异步与采集实战', keywords: ['协程', '并发', '异步', 'aio', '采集', '壁纸', '音乐爬虫', '批量'] },
  { label: '逆向分析与调试实战', keywords: ['逆向', '加密', '断点', '调用栈', '翻译', '网易云', 'js', '调试'] },
  { label: '图形界面与工具模块', keywords: ['tkinter', '图形界面', 'random', '随机数', '界面开发'] },
  { label: '基础入门与语法起步', keywords: ['环境', '安装', '配置', '入门', '基础', '起步', '认识', '准备', '变量', '赋值', '输入', '输出'] },
  { label: '语法规则与流程控制', keywords: ['条件', '判断', 'if', 'else', '循环', 'for', 'while', 'break', 'continue', '运算符', '比较', '逻辑'] },
  { label: '字符串与常用数据结构', keywords: ['字符串', '列表', '元组', '字典', '集合', '切片', '序列', '编码'] },
  { label: '函数设计与作用域', keywords: ['函数', '参数', '返回值', 'lambda', '闭包', '递归', '作用域', '匿名'] },
  { label: '模块化与面向对象', keywords: ['模块', '包', '类', '对象', '封装', '继承', '多态', '魔术方法', '异常'] },
  { label: '文件处理与工程实践', keywords: ['文件', '路径', '读写', 'io', '目录', '项目', '实战', '综合', '案例'] },
  { label: '诊疗规范与基本操作', keywords: ['无菌', '消毒', '洗手', '戴手套', '操作', '检查', '口腔', '诊疗', '护理'] },
  { label: '病例判断与临床思路', keywords: ['病例', '病因', '症状', '诊断', '鉴别', '治疗', '并发症', '临床', '病变'] },
]
const COURSE_TEACHING_FLOW_BUCKET_HINTS: Array<{ bucket: number; keywords: string[] }> = [
  { bucket: 0, keywords: ['导学', '导论', '入门', '起步', '概览', '总览', '先导', '认识', '基础'] },
  { bucket: 1, keywords: ['概念', '定义', '原理', '本质', '规则', '特点', '核心', '理解'] },
  { bucket: 2, keywords: ['例子', '示例', '案例', '演示', '场景', '体验'] },
  { bucket: 3, keywords: ['操作', '实战', '练习', '使用', '流程', '步骤', '方法', '配置', '上手', '技巧'] },
  { bucket: 4, keywords: ['易错', '错误', '误区', '陷阱', '注意', '禁忌', '风险'] },
  { bucket: 5, keywords: ['复盘', '回顾', '总结', '练习', '测验', '自检', '检查'] },
]

function sanitizeSecret(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  if (normalized.includes('文件名、目录名或卷标语法不正确')) return ''
  if (/[^\x20-\x7E]/.test(normalized)) return ''
  return normalized
}

function sanitizeBaseUrl(value: unknown, fallback: string) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return fallback
  if (/[^\x20-\x7E]/.test(normalized)) return fallback
  return normalized
}

function sanitizeOptionalPath(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  return path.resolve(normalized)
}

function sanitizeDisplayText(value: unknown, fallback = '') {
  const normalized = String(value ?? '').replace(/[\x00-\x1F]/g, '').trim()
  return normalized || fallback
}

function sanitizeTranscriptionProvider(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  void normalized
  return 'local_sensevoice'
}

function sanitizeResourceMode(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'fast' || normalized === 'balanced' || normalized === 'background') {
    return normalized
  }
  return 'balanced'
}

function sanitizeTtsProvider(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'minimax') return normalized
  if (normalized === 'mimo') return normalized
  return 'mimo'
}

const MIMO_TTS_PRESET_VOICES = ['茉莉', '冰糖', '苏打', '白桦'] as const

function sanitizeMimoTtsVoiceId(value: unknown, fallback = '茉莉') {
  const normalized = sanitizeDisplayText(value ?? fallback, fallback)
  return MIMO_TTS_PRESET_VOICES.includes(normalized as (typeof MIMO_TTS_PRESET_VOICES)[number])
    ? normalized
    : fallback
}

function sanitizeNumberInRange(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

function loadWindowState() {
  try {
    const sourcePath = fs.existsSync(windowStatePath) ? windowStatePath : legacyWindowStatePath
    if (fs.existsSync(sourcePath)) {
      const state = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'))
      return {
        width: Math.max(Number(state.width) || WINDOW_DEFAULT_WIDTH, WINDOW_MIN_WIDTH),
        height: Math.max(Number(state.height) || WINDOW_DEFAULT_HEIGHT, WINDOW_MIN_HEIGHT),
        x: typeof state.x === 'number' ? state.x : undefined,
        y: typeof state.y === 'number' ? state.y : undefined,
      }
    }
  } catch {
    // ignore
  }
  return { width: WINDOW_DEFAULT_WIDTH, height: WINDOW_DEFAULT_HEIGHT }
}

function saveWindowState() {
  if (!mainWindow) return
  try {
    const bounds = mainWindow.getBounds()
    fs.writeFileSync(windowStatePath, JSON.stringify(bounds, null, 2))
  } catch {
    // ignore
  }
}

function detectLikelyLocalTranscriptionRoot() {
  const candidates = [
    path.resolve(devProjectRoot, '..', 'Cuda'),
    path.resolve(devProjectRoot, '..', '..', 'Cuda'),
    path.resolve(dataRoot, '..', 'Cuda'),
    path.resolve(dataRoot, '..', '..', 'Cuda'),
    path.resolve(process.cwd(), '..', 'Cuda'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'local_audio_distiller.py'))) {
      return candidate
    }
  }

  return ''
}

function defaultSettings(): RuntimeSettings {
  const guessedLocalRoot = detectLikelyLocalTranscriptionRoot()
  return {
    sessdata: '',
    output_dir: resolveCanonicalOutputRoot(),
    obsidian_vault_path: '',
    obsidian_export_folder: '视界专注',
    obsidian_auto_sync: true,
    tts_provider: 'mimo',
    minimax_api_key: '',
    minimax_tts_endpoint: 'https://api.minimaxi.com/v1/t2a_v2',
    minimax_tts_model: 'speech-2.8-hd',
    minimax_tts_voice_id: '',
    minimax_tts_speed: 1,
    minimax_tts_volume: 1,
    minimax_tts_pitch: 0,
    mimo_api_key: '',
    mimo_tts_endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
    mimo_tts_model: 'mimo-v2.5-tts',
    mimo_tts_voice_id: '茉莉',
    mimo_tts_style_prompt: '自然 清晰 语速适中',
    transcription_provider: 'local_sensevoice',
    local_transcription_root: guessedLocalRoot,
    local_transcription_python: '',
    local_transcription_model_id: 'iic/SenseVoiceSmall',
    local_transcription_device: 'cuda:0',
    local_transcription_language: 'zh',
    resource_mode: 'balanced',
  }
}

const secureStore = new Store<{
  runtimeSettings: RuntimeSettings
  learningLibrary: LearningLibraryState
}>({
  name: 'shijie-focus-secure',
})

const legacySecureStore = new Store<{
  runtimeSettings?: RuntimeSettings
  learningLibrary?: LearningLibraryState
}>({
  name: 'onboard-anything-secure',
})

function migrateLegacyStoreIfNeeded() {
  const hasRuntimeSettings = Boolean(secureStore.get('runtimeSettings'))
  const hasLearningLibrary = Boolean(secureStore.get('learningLibrary'))
  if (!hasRuntimeSettings) {
    const legacyRuntimeSettings = legacySecureStore.get('runtimeSettings')
    if (legacyRuntimeSettings) secureStore.set('runtimeSettings', normalizeSettings(legacyRuntimeSettings))
  }
  if (!hasLearningLibrary) {
    const legacyLearningLibrary = legacySecureStore.get('learningLibrary')
    if (legacyLearningLibrary) secureStore.set('learningLibrary', legacyLearningLibrary)
  }
}

function normalizeSettings(raw: Partial<RuntimeSettings> | null | undefined): RuntimeSettings {
  const defaults = defaultSettings()
  return {
    sessdata: sanitizeSecret(raw?.sessdata ?? defaults.sessdata),
    output_dir: normalizeOutputRoot(raw?.output_dir ?? defaults.output_dir),
    obsidian_vault_path: sanitizeOptionalPath(raw?.obsidian_vault_path ?? defaults.obsidian_vault_path),
    obsidian_export_folder: sanitizeDisplayText(raw?.obsidian_export_folder ?? defaults.obsidian_export_folder, defaults.obsidian_export_folder),
    obsidian_auto_sync: raw?.obsidian_auto_sync === undefined ? defaults.obsidian_auto_sync : Boolean(raw?.obsidian_auto_sync),
    tts_provider: sanitizeTtsProvider(raw?.tts_provider ?? defaults.tts_provider),
    minimax_api_key: sanitizeSecret(raw?.minimax_api_key ?? defaults.minimax_api_key),
    minimax_tts_endpoint: sanitizeBaseUrl(raw?.minimax_tts_endpoint ?? defaults.minimax_tts_endpoint, defaults.minimax_tts_endpoint),
    minimax_tts_model:
      sanitizeSecret(raw?.minimax_tts_model ?? defaults.minimax_tts_model) || defaults.minimax_tts_model,
    minimax_tts_voice_id: sanitizeDisplayText(raw?.minimax_tts_voice_id ?? defaults.minimax_tts_voice_id),
    minimax_tts_speed: sanitizeNumberInRange(raw?.minimax_tts_speed, defaults.minimax_tts_speed, 0.5, 2),
    minimax_tts_volume: sanitizeNumberInRange(raw?.minimax_tts_volume, defaults.minimax_tts_volume, 0.1, 5),
    minimax_tts_pitch: sanitizeNumberInRange(raw?.minimax_tts_pitch, defaults.minimax_tts_pitch, -12, 12),
    mimo_api_key: sanitizeSecret(raw?.mimo_api_key ?? defaults.mimo_api_key),
    mimo_tts_endpoint: sanitizeBaseUrl(raw?.mimo_tts_endpoint ?? defaults.mimo_tts_endpoint, defaults.mimo_tts_endpoint),
    mimo_tts_model: defaults.mimo_tts_model,
    mimo_tts_voice_id: sanitizeMimoTtsVoiceId(raw?.mimo_tts_voice_id ?? defaults.mimo_tts_voice_id, defaults.mimo_tts_voice_id),
    mimo_tts_style_prompt: defaults.mimo_tts_style_prompt,
    transcription_provider: sanitizeTranscriptionProvider(raw?.transcription_provider || defaults.transcription_provider),
    local_transcription_root: sanitizeOptionalPath(raw?.local_transcription_root || defaults.local_transcription_root),
    local_transcription_python: sanitizeOptionalPath(raw?.local_transcription_python || defaults.local_transcription_python),
    local_transcription_model_id:
      sanitizeSecret(raw?.local_transcription_model_id ?? defaults.local_transcription_model_id) || defaults.local_transcription_model_id,
    local_transcription_device:
      sanitizeSecret(raw?.local_transcription_device ?? defaults.local_transcription_device) || defaults.local_transcription_device,
    local_transcription_language:
      sanitizeSecret(raw?.local_transcription_language ?? defaults.local_transcription_language) || defaults.local_transcription_language,
    resource_mode: sanitizeResourceMode(raw?.resource_mode ?? defaults.resource_mode),
  }
}

function loadSettings(): RuntimeSettings {
  return normalizeSettings(secureStore.get('runtimeSettings'))
}

function saveSettings(next: RuntimeSettings) {
  const normalized = normalizeSettings(next)
  secureStore.set('runtimeSettings', normalized)
  return normalized
}

migrateLegacyStoreIfNeeded()

function isExistingDirectory(targetPath: string) {
  try {
    return Boolean(targetPath && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory())
  } catch {
    return false
  }
}

function resolveCanonicalOutputRoot() {
  return path.join(devProjectRoot, 'output')
}

function isLegacyOutputRoot(targetPath: string) {
  if (!targetPath) return false
  const normalized = path.resolve(targetPath).toLowerCase()
  return [
    path.resolve(devProjectRoot, 'desktop', 'release', 'output').toLowerCase(),
    path.resolve(devProjectRoot, 'desktop', 'output').toLowerCase(),
  ].includes(normalized)
}

function normalizeOutputRoot(value: unknown) {
  const canonical = resolveCanonicalOutputRoot()
  const rawPath = String(value ?? '').trim()
  if (!rawPath || isLegacyOutputRoot(rawPath)) return canonical
  return path.resolve(rawPath)
}

function resolveCourseImportDefaultPath(settings: RuntimeSettings) {
  const candidates = [
    resolveCoursePackageOutputDir(settings),
    settings.output_dir,
    path.join(devProjectRoot, 'output'),
  ]

  return candidates.find(isExistingDirectory) || dataRoot
}

function resolveMaterialOutputDir(settings: RuntimeSettings) {
  return path.join(settings.output_dir, 'materials')
}

function resolveCoursePackageOutputDir(settings: RuntimeSettings) {
  return path.join(settings.output_dir, 'courses')
}

function resolveKnowledgeOutputDir(settings: RuntimeSettings) {
  return path.join(settings.output_dir, 'knowledge')
}

function resolveKnowledgeLibraryPath(settings: RuntimeSettings) {
  return path.join(resolveKnowledgeOutputDir(settings), 'knowledge_library.json')
}

function isUsableCodexCoursePlan(planPath: string) {
  if (!fs.existsSync(planPath)) return false
  try {
    const payload = JSON.parse(fs.readFileSync(planPath, 'utf-8')) as Record<string, unknown>
    if (payload.status === 'pending_codex_goal') return false
    return (
      payload.schema_version === 'shijie.codex-course-plan.v0.1' &&
      typeof payload.plan_id === 'string' &&
      Array.isArray(payload.chapters) &&
      payload.chapters.length > 0
    )
  } catch {
    return false
  }
}

function isUsableSynthesisPlan(planPath: string) {
  if (!fs.existsSync(planPath)) return false
  try {
    const payload = JSON.parse(fs.readFileSync(planPath, 'utf-8')) as Record<string, unknown>
    if (payload.status === 'pending_codex_synthesis') return false
    const schemaVersion = String(payload.schema_version ?? '')
    return (
      [
        'shijie.content-synthesis-plan.v0.1',
        'shijie.content-synthesis-plan.v0.2',
        'shijie.content-synthesis-plan.v0.3',
      ].includes(schemaVersion) &&
      typeof payload.plan_id === 'string' &&
      Array.isArray(payload.sections) &&
      payload.sections.length > 0
    )
  } catch {
    return false
  }
}

function isUsableKnowledgeBrief(briefPath: string) {
  return isUsableMarkdownDocument(briefPath)
}

function isUsableMarkdownDocument(documentPath: string) {
  if (!fs.existsSync(documentPath)) return false
  try {
    const content = fs.readFileSync(documentPath, 'utf-8').trim()
    if (content.length < 240) return false
    if (content.includes('状态：待 Codex Goal')) return false
    return /[\p{L}\p{N}]/u.test(content)
  } catch {
    return false
  }
}

function isUsableJsonDocument(documentPath: string) {
  if (!fs.existsSync(documentPath)) return false
  try {
    const content = fs.readFileSync(documentPath, 'utf-8').trim()
    if (!content) return false
    JSON.parse(content)
    return true
  } catch {
    return false
  }
}

function directoryHasMeaningfulEntries(directoryPath: string) {
  if (!fs.existsSync(directoryPath)) return false
  try {
    if (!fs.statSync(directoryPath).isDirectory()) return false
    return fs.readdirSync(directoryPath, { withFileTypes: true }).some((entry) => {
      if (entry.name === 'README.md') return false
      return entry.isFile() || entry.isDirectory()
    })
  } catch {
    return false
  }
}

function readJsonDocument(documentPath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(documentPath)) return null
    const parsed = JSON.parse(fs.readFileSync(documentPath, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function writeJsonIfChanged(documentPath: string, payload: unknown) {
  const nextText = `${JSON.stringify(payload, null, 2)}\n`
  try {
    if (fs.existsSync(documentPath) && fs.readFileSync(documentPath, 'utf-8') === nextText) return
  } catch {
    // Fall through and rewrite the file.
  }
  fs.mkdirSync(path.dirname(documentPath), { recursive: true })
  fs.writeFileSync(documentPath, nextText, 'utf-8')
}

function stripMarkdownForValidation(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/gu, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/[|*_>#-]/gu, ' ')
    .replace(/\s+/gu, '')
}

function collectMarkdownHeadings(markdown: string) {
  return Array.from(markdown.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gmu)).map((match) => ({
    level: match[1].length,
    title: match[2].trim(),
    index: match.index ?? 0,
  }))
}

function collectHeadingBodyLengths(markdown: string, headingLevel: number) {
  const headingPattern = new RegExp(`^#{${headingLevel}}\\s+(.+?)\\s*#*\\s*$`, 'gmu')
  const headings = Array.from(markdown.matchAll(headingPattern)).map((match) => ({
    title: match[1].trim(),
    index: match.index ?? 0,
  }))
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? markdown.length
    const body = markdown.slice(heading.index, end)
    return {
      title: heading.title,
      chars: stripMarkdownForValidation(body).length,
    }
  })
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function validateMaterialPackageArtifacts(materialPath: string, manifest: Record<string, unknown>, runState: Record<string, unknown>): MaterialValidationReport {
  const issues: MaterialValidationIssue[] = []
  const addIssue = (severity: MaterialValidationIssue['severity'], code: string, message: string, relativePath?: string) => {
    issues.push({ severity, code, message, ...(relativePath ? { path: relativePath } : {}) })
  }

  const source = manifest.source && typeof manifest.source === 'object' ? manifest.source as Record<string, unknown> : {}
  const title = sanitizeDisplayText(source.title ?? path.basename(materialPath), '')
  const materialId = sanitizeDisplayText(manifest.material_id ?? (runState.material && typeof runState.material === 'object' ? (runState.material as Record<string, unknown>).material_id : ''), path.basename(materialPath))
  const stage = sanitizeDisplayText(runState.stage ?? runState.current_stage ?? '')
  const rawTranscriptPath = path.join(materialPath, 'raw_transcript.txt')
  const runStatePath = path.join(materialPath, 'run_state.json')
  const contentDraftDir = path.join(materialPath, 'content_draft')
  const reviewExportsDir = path.join(contentDraftDir, 'review_exports')
  const workDir = path.join(contentDraftDir, 'work')
  const learningNotesPath = path.join(contentDraftDir, 'learning_notes.md')
  const chapterMindmapPath = path.join(contentDraftDir, 'chapter_mindmap.md')
  const validationReportPath = path.join(reviewExportsDir, 'validation_report.json')
  const coverageMatrixPath = path.join(workDir, 'coverage_matrix.json')

  if (!Object.keys(manifest).length) addIssue('error', 'manifest_missing_or_invalid', 'manifest.json 缺失或不是合法 JSON。', 'manifest.json')
  if (!fs.existsSync(rawTranscriptPath)) addIssue('error', 'raw_transcript_missing', 'raw_transcript.txt 缺失。', 'raw_transcript.txt')
  if (!Object.keys(runState).length || !fs.existsSync(runStatePath)) addIssue('error', 'run_state_missing_or_invalid', 'run_state.json 缺失或不是合法 JSON。', 'run_state.json')

  const blockCount = Number(manifest.block_count ?? 0) || 0
  const rawLength = Number(manifest.raw_transcript_length ?? manifest.text_length ?? 0) || (fs.existsSync(rawTranscriptPath) ? fs.statSync(rawTranscriptPath).size : 0)
  const longMaterial = rawLength > 100_000 || blockCount > 8 || /考试|医学|医师|执业|基础精讲|教程|训练/u.test(title)

  let learningNotes = ''
  let learningNotesPlainLength = 0
  let h2Count = 0
  let h3Count = 0
  let shortestSectionChars = 0
  let medianSectionChars = 0

  if (fs.existsSync(learningNotesPath)) {
    learningNotes = fs.readFileSync(learningNotesPath, 'utf-8')
    const trimmed = learningNotes.trim()
    learningNotesPlainLength = stripMarkdownForValidation(trimmed).length
    const headings = collectMarkdownHeadings(trimmed)
    const h1Count = headings.filter((heading) => heading.level === 1).length
    h2Count = headings.filter((heading) => heading.level === 2).length
    h3Count = headings.filter((heading) => heading.level === 3).length
    const h4PlusCount = headings.filter((heading) => heading.level >= 4).length
    if (h1Count !== 1) addIssue('error', 'learning_notes_h1_invalid', `learning_notes.md 应只有 1 个一级标题，当前为 ${h1Count} 个。`, 'content_draft/learning_notes.md')
    if (h2Count === 0) addIssue('error', 'learning_notes_no_chapters', 'learning_notes.md 没有二级章节。', 'content_draft/learning_notes.md')
    if (h4PlusCount > 0) addIssue('warning', 'learning_notes_too_deep', `learning_notes.md 存在 ${h4PlusCount} 个四级或更深标题，学习台可能不适合展示。`, 'content_draft/learning_notes.md')

    const h3Lengths = collectHeadingBodyLengths(trimmed, 3).map((section) => section.chars).filter((chars) => chars > 0)
    shortestSectionChars = h3Lengths.length ? Math.min(...h3Lengths) : 0
    medianSectionChars = median(h3Lengths)

    if (/source_refs?|block_\d{3,}|raw offset|raw_offset|debug|字幕证据|制作过程/iu.test(trimmed)) {
      addIssue('error', 'learning_notes_has_debug_refs', 'learning_notes.md 含有 source_ref、block_id 或后台制作词，学生正文不干净。', 'content_draft/learning_notes.md')
    }
    if (/TODO|待补充|此处省略|placeholder|TBD/iu.test(trimmed)) {
      addIssue('error', 'learning_notes_has_placeholder', 'learning_notes.md 含有 TODO、待补充或占位符。', 'content_draft/learning_notes.md')
    }

    if (longMaterial) {
      const minimumPlainLength = Math.max(24_000, Math.min(Math.round(rawLength * 0.08), 60_000))
      if (learningNotesPlainLength < minimumPlainLength) {
        addIssue(
          'error',
          'learning_notes_too_thin_for_long_material',
          `长材料正文偏薄：正文约 ${learningNotesPlainLength} 字符，当前材料建议至少达到约 ${minimumPlainLength} 字符的工程 sanity check。`,
          'content_draft/learning_notes.md',
        )
      }
      if (h3Count >= 8 && medianSectionChars > 0 && medianSectionChars < 650) {
        addIssue(
          'error',
          'learning_units_too_short',
          `可打开小节偏短：${h3Count} 个三级小节的中位长度约 ${medianSectionChars} 字符，不像完整学习单位。`,
          'content_draft/learning_notes.md',
        )
      }
    }
  } else if (stage === 'learning_notes_ready') {
    addIssue('error', 'learning_notes_missing', 'run_state 已标记 learning_notes_ready，但 learning_notes.md 缺失。', 'content_draft/learning_notes.md')
  }

  if (fs.existsSync(chapterMindmapPath)) {
    const mindmap = fs.readFileSync(chapterMindmapPath, 'utf-8').trim()
    if (mindmap.length < 240) addIssue('error', 'chapter_mindmap_too_short', 'chapter_mindmap.md 过短，不像有效章节思维导图。', 'content_draft/chapter_mindmap.md')
    if (/source_refs?|block_\d{3,}|raw offset|raw_offset|debug|字幕证据|制作过程/iu.test(mindmap)) {
      addIssue('error', 'chapter_mindmap_has_debug_refs', 'chapter_mindmap.md 含有 source_ref、block_id 或后台制作词。', 'content_draft/chapter_mindmap.md')
    }
    if (/TODO|待补充|此处省略|placeholder|TBD/iu.test(mindmap)) {
      addIssue('error', 'chapter_mindmap_has_placeholder', 'chapter_mindmap.md 含有 TODO、待补充或占位符。', 'content_draft/chapter_mindmap.md')
    }
  } else if (stage === 'learning_notes_ready') {
    addIssue('error', 'chapter_mindmap_missing', 'run_state 已标记 learning_notes_ready，但 chapter_mindmap.md 缺失。', 'content_draft/chapter_mindmap.md')
  }

  for (const [relativePath, code, message] of [
    ['content_draft/work/knowledge_tree.json', 'knowledge_tree_missing', 'knowledge_tree.json 缺失。'],
    ['content_draft/work/coverage_matrix.json', 'coverage_matrix_missing', 'coverage_matrix.json 缺失。'],
    ['content_draft/work/block_reread_ledger.jsonl', 'block_reread_ledger_missing', 'block_reread_ledger.jsonl 缺失。'],
    ['content_draft/work/self_check.md', 'self_check_missing', 'self_check.md 缺失。'],
  ] as const) {
    if (stage === 'learning_notes_ready' && !fs.existsSync(path.join(materialPath, relativePath))) {
      addIssue('error', code, message, relativePath)
    }
  }

  const coverageMatrix = readJsonDocument(coverageMatrixPath)
  if (coverageMatrix && longMaterial) {
    const branches = Array.isArray(coverageMatrix.branches) ? coverageMatrix.branches as Array<Record<string, unknown>> : []
    const examReviewBranch = branches.find((branch) => /考试|复盘|题干|易混/u.test(sanitizeDisplayText(branch.title ?? '')))
    if (examReviewBranch) {
      const draftStatus = sanitizeDisplayText(examReviewBranch.draft_status ?? '')
      const coverageStatus = sanitizeDisplayText(examReviewBranch.coverage_status ?? '')
      if (!/published/i.test(draftStatus) && !/published/i.test(coverageStatus)) {
        addIssue(
          'error',
          'exam_review_branch_not_published',
          '考试/复盘分支没有进入 learning_notes.md。对医学考试材料，这通常意味着复习价值被压缩到导图或索引层。',
          'content_draft/work/coverage_matrix.json',
        )
      }
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const finalArtifactsExist = fs.existsSync(learningNotesPath) && fs.existsSync(chapterMindmapPath)
  const pipelineReady = stage === 'learning_notes_ready' && finalArtifactsExist && errorCount === 0
  const auditReady = runState.audit_ready === true
  const releaseReady = runState.release_ready === true
  const summary = {
    error_count: errorCount,
    warning_count: warningCount,
    learning_notes_chars: learningNotes.length,
    learning_notes_plain_chars: learningNotesPlainLength,
    chapter_count: h2Count,
    section_count: h3Count,
    shortest_section_chars: shortestSectionChars,
    median_section_chars: medianSectionChars,
    long_material: longMaterial,
  }
  const comparableReportPayload = {
    stage,
    pipeline_ready: pipelineReady,
    audit_ready: auditReady,
    release_ready: releaseReady,
    summary,
    issues,
  }
  const previousReport = readJsonDocument(validationReportPath)
  const previousComparablePayload = previousReport
    ? {
        stage: previousReport.stage,
        pipeline_ready: previousReport.pipeline_ready,
        audit_ready: previousReport.audit_ready,
        release_ready: previousReport.release_ready,
        summary: previousReport.summary,
        issues: previousReport.issues,
      }
    : null
  const generatedAt = previousReport &&
    typeof previousReport.generated_at === 'string' &&
    JSON.stringify(previousComparablePayload) === JSON.stringify(comparableReportPayload)
    ? previousReport.generated_at
    : new Date().toISOString()

  const report: MaterialValidationReport = {
    schema_version: 'shijie.material-validation.v0.1',
    generated_at: generatedAt,
    material_id: materialId,
    material_path: materialPath,
    stage,
    pipeline_ready: pipelineReady,
    audit_ready: auditReady,
    release_ready: releaseReady,
    summary,
    issues,
  }

  writeJsonIfChanged(validationReportPath, report)

  if (fs.existsSync(runStatePath)) {
    const nextRunState = {
      ...runState,
      pipeline_ready: pipelineReady,
      audit_ready: auditReady,
      release_ready: releaseReady,
      validation_report: 'content_draft/review_exports/validation_report.json',
      importable: pipelineReady,
    }
    writeJsonIfChanged(runStatePath, nextRunState)
  }

  return report
}

function deriveMaterialWorkflowStageFromArtifacts(options: {
  knowledgeImported: boolean
  readonlyAuditExists: boolean
  synthesisPlanExists: boolean
  knowledgeTreeExists: boolean
  treeOutlineExists: boolean
  structureReviewExists: boolean
  coverageMatrixExists: boolean
  blockRereadLedgerExists: boolean
  sectionDossiersExists: boolean
  learningNotesExists: boolean
  chapterMindmapExists: boolean
  conceptGraphExists: boolean
  selfCheckExists: boolean
}) {
  const {
    knowledgeImported,
    readonlyAuditExists,
    synthesisPlanExists,
    knowledgeTreeExists,
    treeOutlineExists,
    structureReviewExists,
    coverageMatrixExists,
    blockRereadLedgerExists,
    sectionDossiersExists,
    learningNotesExists,
    chapterMindmapExists,
    conceptGraphExists,
    selfCheckExists,
  } = options

  const hasLearningNotesReadyArtifacts =
    learningNotesExists &&
    chapterMindmapExists &&
    conceptGraphExists &&
    selfCheckExists

  if (hasLearningNotesReadyArtifacts) return 'learning_notes_ready'
  if (learningNotesExists || chapterMindmapExists || conceptGraphExists || selfCheckExists) {
    return 'partial_learning_notes'
  }
  if (sectionDossiersExists || blockRereadLedgerExists) return 'dossier_ready'
  if (coverageMatrixExists) return 'coverage_ready'
  if (knowledgeTreeExists || treeOutlineExists || structureReviewExists) return 'knowledge_tree_ready'
  if (synthesisPlanExists) return 'codex_plan_ready'
  if (knowledgeImported) return 'knowledge_ready'
  if (readonlyAuditExists) return 'audit_ready'
  return 'material_ready'
}

function createKnowledgeRecordId(materialPath: string, sourceId: string) {
  const identity = `${sourceId || ''}\n${path.resolve(materialPath)}`
  return `knowledge-${crypto.createHash('sha1').update(identity).digest('hex').slice(0, 12)}`
}

function normalizeKnowledgeRecord(raw: Partial<KnowledgeRecord> | null | undefined): KnowledgeRecord | null {
  const materialPath = String(raw?.materialPath ?? '').trim()
  const knowledgeBriefPath = String(raw?.knowledgeBriefPath ?? '').trim()
  const libraryPath = String(raw?.libraryPath ?? '').trim()
  if (!materialPath || !knowledgeBriefPath || !libraryPath) return null

  const sourceId = sanitizeDisplayText(raw?.sourceId ?? '')
  const id = sanitizeDisplayText(raw?.id ?? createKnowledgeRecordId(materialPath, sourceId))
  const title = sanitizeDisplayText(raw?.title ?? raw?.sourceTitle ?? '未命名学习笔记', '未命名学习笔记')
  const now = Date.now()

  return {
    id,
    title,
    sourceTitle: sanitizeDisplayText(raw?.sourceTitle ?? title, title),
    sourceId,
    sourceUrl: sanitizeDisplayText(raw?.sourceUrl ?? ''),
    materialPath: path.resolve(materialPath),
    knowledgeBriefPath: path.resolve(knowledgeBriefPath),
    libraryPath: path.resolve(libraryPath),
    textLength: Math.max(0, Number(raw?.textLength ?? 0) || 0),
    importedAt: Number(raw?.importedAt ?? now),
    updatedAt: Number(raw?.updatedAt ?? now),
  }
}

function loadKnowledgeLibraryFile(settings: RuntimeSettings): KnowledgeLibraryFile {
  const libraryPath = resolveKnowledgeLibraryPath(settings)
  try {
    if (!fs.existsSync(libraryPath)) {
      return {
        schema_version: 'shijie.knowledge-library.v0.1',
        records: [],
      }
    }

    const raw = JSON.parse(fs.readFileSync(libraryPath, 'utf-8')) as Partial<KnowledgeLibraryFile>
    const records = Array.isArray(raw.records)
      ? raw.records
          .map((record) => normalizeKnowledgeRecord(record))
          .filter((record): record is KnowledgeRecord => Boolean(record))
      : []

    return {
      schema_version: 'shijie.knowledge-library.v0.1',
      records,
    }
  } catch {
    return {
      schema_version: 'shijie.knowledge-library.v0.1',
      records: [],
    }
  }
}

function saveKnowledgeLibraryFile(settings: RuntimeSettings, library: KnowledgeLibraryFile) {
  const knowledgeDir = resolveKnowledgeOutputDir(settings)
  fs.mkdirSync(knowledgeDir, { recursive: true })
  const libraryPath = resolveKnowledgeLibraryPath(settings)
  const normalized: KnowledgeLibraryFile = {
    schema_version: 'shijie.knowledge-library.v0.1',
    records: library.records
      .map((record) => normalizeKnowledgeRecord(record))
      .filter((record): record is KnowledgeRecord => Boolean(record))
      .sort((left, right) => right.updatedAt - left.updatedAt),
  }
  fs.writeFileSync(libraryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8')
  return normalized
}

function stripKnowledgeBriefMetadata(content: string) {
  return String(content ?? '')
    .replace(/^<!--\s*shijie:learning-notes[\s\S]*?-->\s*/u, '')
    .replace(/^<!--\s*shijie:knowledge-brief[\s\S]*?-->\s*/u, '')
    .trim()
}

function buildKnowledgePreview(content: string) {
  const normalized = stripKnowledgeBriefMetadata(content)
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/[#>*_`~\[\]()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized
}

function listKnowledgeLibrary(settings: RuntimeSettings): KnowledgeLibraryPayload {
  const rootDir = resolveKnowledgeOutputDir(settings)
  const libraryPath = resolveKnowledgeLibraryPath(settings)
  fs.mkdirSync(rootDir, { recursive: true })
  const library = saveKnowledgeLibraryFile(settings, loadKnowledgeLibraryFile(settings))

  const records = library.records.map<KnowledgeLibrarySummary>((record) => {
    const fileExists = Boolean(record.libraryPath && fs.existsSync(record.libraryPath))
    let content = ''
    try {
      content = fileExists ? fs.readFileSync(record.libraryPath, 'utf-8') : ''
    } catch {
      content = ''
    }
    const body = stripKnowledgeBriefMetadata(content)
    return {
      ...record,
      fileExists,
      preview: buildKnowledgePreview(content),
      searchText: [
        record.title,
        record.sourceTitle,
        record.sourceId,
        record.sourceUrl,
        body.slice(0, 80_000),
      ].join(' ').toLowerCase(),
    }
  })

  return {
    rootDir,
    libraryPath,
    records,
  }
}

function findKnowledgeRecordForMaterial(library: KnowledgeLibraryFile, materialPath: string, sourceId: string) {
  const resolvedMaterialPath = path.resolve(materialPath)
  const normalizedSourceId = sanitizeDisplayText(sourceId)
  return library.records.find((record) => {
    const materialMatches = path.resolve(record.materialPath) === resolvedMaterialPath
    const sourceMatches = Boolean(normalizedSourceId && record.sourceId && record.sourceId === normalizedSourceId)
    const targetExists = Boolean(record.libraryPath && fs.existsSync(record.libraryPath))
    return targetExists && (materialMatches || sourceMatches)
  }) ?? null
}

function readMaterialManifest(materialPath: string) {
  const manifestPath = path.join(materialPath, 'manifest.json')
  try {
    if (!fs.existsSync(manifestPath)) return {}
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function importKnowledgeBriefFromMaterial(settings: RuntimeSettings, materialPath: string): KnowledgeRecord {
  const materialRoot = resolveMaterialOutputDir(settings)
  const resolvedMaterialPath = assertPathInside(materialPath, materialRoot, '材料包')
  if (!fs.existsSync(resolvedMaterialPath) || !fs.statSync(resolvedMaterialPath).isDirectory()) {
    throw new Error(`材料包不存在：${resolvedMaterialPath}`)
  }

  const learningNotesPath = path.join(resolvedMaterialPath, 'content_draft', 'learning_notes.md')
  const knowledgeBriefPath = learningNotesPath
  if (!isUsableKnowledgeBrief(knowledgeBriefPath)) {
    throw new Error('还没有可学习的学习笔记。请先生成有效的 content_draft/learning_notes.md。')
  }

  const manifest = readMaterialManifest(resolvedMaterialPath)
  const runState = readJsonDocument(path.join(resolvedMaterialPath, 'run_state.json')) ?? {}
  const validationReport = validateMaterialPackageArtifacts(resolvedMaterialPath, manifest, runState)
  if (!validationReport.pipeline_ready) {
    const firstIssue = validationReport.issues.find((issue) => issue.severity === 'error') ?? validationReport.issues[0]
    throw new Error(
      firstIssue
        ? `学习笔记还未通过机器验证：${firstIssue.message}`
        : '学习笔记还未通过机器验证，请先查看 content_draft/review_exports/validation_report.json。',
    )
  }
  const source = manifest.source && typeof manifest.source === 'object' ? manifest.source as Record<string, unknown> : {}
  const title = sanitizeDisplayText(source.title ?? path.basename(resolvedMaterialPath).replace(/\.course_material$/u, ''), '未命名学习笔记')
  const sourceId = sanitizeDisplayText(source.source_id ?? '')
  const sourceUrl = sanitizeDisplayText(source.url ?? '')
  const knowledgeDir = resolveKnowledgeOutputDir(settings)
  fs.mkdirSync(knowledgeDir, { recursive: true })

  const id = createKnowledgeRecordId(resolvedMaterialPath, sourceId)
  const library = loadKnowledgeLibraryFile(settings)
  const existing = library.records.find((record) => record.id === id) ?? null
  const libraryPath = existing?.libraryPath && path.resolve(path.dirname(existing.libraryPath)) === path.resolve(knowledgeDir)
    ? existing.libraryPath
    : path.join(knowledgeDir, `${sanitizeFileNameSegment(title, id)}.knowledge.md`)
  const content = fs.readFileSync(knowledgeBriefPath, 'utf-8').trim()
  const importedAt = existing?.importedAt ?? Date.now()
  const updatedAt = Date.now()
  const frontMatter = [
    '<!-- shijie:learning-notes',
    'schema_version: shijie.learning-notes.v0.1',
    `title: ${title}`,
    `source_id: ${sourceId}`,
    `material_path: ${resolvedMaterialPath}`,
    `source_notes_path: ${knowledgeBriefPath}`,
    `imported_at: ${new Date(importedAt).toISOString()}`,
    `updated_at: ${new Date(updatedAt).toISOString()}`,
    '-->',
    '',
  ].join('\n')

  fs.writeFileSync(libraryPath, `${frontMatter}${content}\n`, 'utf-8')

  const nextRecord = normalizeKnowledgeRecord({
    id,
    title,
    sourceTitle: title,
    sourceId,
    sourceUrl,
    materialPath: resolvedMaterialPath,
    knowledgeBriefPath,
    libraryPath,
    textLength: content.length,
    importedAt,
    updatedAt,
  })

  if (!nextRecord) {
    throw new Error('学习笔记入库失败：无法生成有效的知识记录。')
  }

  saveKnowledgeLibraryFile(settings, {
    schema_version: 'shijie.knowledge-library.v0.1',
    records: [
      nextRecord,
      ...library.records.filter((record) => record.id !== id),
    ],
  })

  return nextRecord
}

function listMaterialPackages(settings: RuntimeSettings) {
  const rootDir = resolveMaterialOutputDir(settings)
  const coursePackageRootDir = resolveCoursePackageOutputDir(settings)
  fs.mkdirSync(rootDir, { recursive: true })
  fs.mkdirSync(coursePackageRootDir, { recursive: true })
  const publishedBySourceId = new Map<string, string>()
  const publishedByTitle = new Map<string, string>()
  const knowledgeLibrary = loadKnowledgeLibraryFile(settings)

  for (const entry of fs.readdirSync(coursePackageRootDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.course-package.json')) continue
    const coursePath = path.join(coursePackageRootDir, entry.name)
    try {
      const payload = JSON.parse(fs.readFileSync(coursePath, 'utf-8')) as Record<string, unknown>
      const source = payload.source && typeof payload.source === 'object' ? payload.source as Record<string, unknown> : {}
      const course = payload.course && typeof payload.course === 'object' ? payload.course as Record<string, unknown> : {}
      const sourceId = sanitizeDisplayText(source.source_id ?? '')
      const title = sanitizeDisplayText(course.title ?? source.title ?? '')
      if (sourceId) publishedBySourceId.set(sourceId, coursePath)
      if (title) publishedByTitle.set(title, coursePath)
    } catch {
      // Ignore unrelated JSON files in the import directory.
    }
  }

  const records: MaterialPackageSummary[] = []
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.course_material')) continue
    const materialPath = path.join(rootDir, entry.name)
    const manifestPath = path.join(materialPath, 'manifest.json')
    let manifest: Record<string, unknown> = {}
    try {
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
      }
    } catch {
      manifest = {}
    }
    const source = manifest.source && typeof manifest.source === 'object' ? manifest.source as Record<string, unknown> : {}
    const stat = fs.statSync(materialPath)
    const title = sanitizeDisplayText(source.title ?? entry.name.replace(/\.course_material$/u, ''), entry.name)
    const sourceId = sanitizeDisplayText(source.source_id ?? '')
    const handoffPath = path.join(materialPath, 'HANDOFF.md')
    const runStatePath = path.join(materialPath, 'run_state.json')
    const handoffStatusPath = path.join(materialPath, 'handoff_status.json')
    let runState: Record<string, unknown> = {}
    try {
      if (fs.existsSync(runStatePath)) {
        runState = JSON.parse(fs.readFileSync(runStatePath, 'utf-8')) as Record<string, unknown>
      } else if (fs.existsSync(handoffStatusPath)) {
        runState = JSON.parse(fs.readFileSync(handoffStatusPath, 'utf-8')) as Record<string, unknown>
      }
    } catch {
      runState = {}
    }
    const authoringDir = path.join(materialPath, 'authoring')
    const contentDraftDir = path.join(materialPath, 'content_draft')
    const workDir = path.join(contentDraftDir, 'work')
    const reviewExportsDir = path.join(contentDraftDir, 'review_exports')
    const gptMaterialWorkspaceZipPath = ''
    const gptMaterialPromptPath = ''
    const codexSynthesisPromptPath = path.join(authoringDir, '02_start_codex_synthesis.md')
    const codexGoalPromptPath = codexSynthesisPromptPath
    const readonlySynthesisAuditPromptPath = path.join(authoringDir, '03_readonly_synthesis_audit.md')
    const readonlyAuditPromptPath = readonlySynthesisAuditPromptPath
    const synthesisPlanPath = path.join(materialPath, 'content_draft', 'synthesis_plan.json')
    const codexCoursePlanPath = synthesisPlanPath
    const learningNotesPath = path.join(materialPath, 'content_draft', 'learning_notes.md')
    const knowledgeBriefPath = learningNotesPath
    const chapterMindmapPath = path.join(materialPath, 'content_draft', 'chapter_mindmap.md')
    const chapterMapPath = chapterMindmapPath
    const finalCoursePath = ''
    const publishedCoursePath = ''
    const finalCourseExists = false
    const publishedCourseExists = false
    const importReadyCoursePath = ''
    const gptMaterialWorkspaceZipExists = false
    const synthesisPlanExists = isUsableSynthesisPlan(synthesisPlanPath)
    const knowledgeBriefExists = isUsableKnowledgeBrief(knowledgeBriefPath)
    const chapterMapExists = isUsableMarkdownDocument(chapterMapPath)
    const knowledgeRecord = findKnowledgeRecordForMaterial(knowledgeLibrary, materialPath, sourceId)
    const knowledgeRecordPath = knowledgeRecord?.libraryPath ?? ''
    const knowledgeImported = Boolean(knowledgeRecordPath)
    const codexCoursePlanExists = synthesisPlanExists
    const importReadyCourseExists = false
    const readonlyAuditExists =
      fs.existsSync(path.join(materialPath, 'content_draft', 'review_exports', 'latest-readonly-audit.md'))
    const authoringExists = fs.existsSync(authoringDir)
    const canonicalMaterial = authoringExists && fs.existsSync(runStatePath)
    if (!canonicalMaterial) continue
    const validationReport = validateMaterialPackageArtifacts(materialPath, manifest, runState)
    const explicitRunStage = sanitizeDisplayText(runState.stage ?? '')
    const knowledgeTreePath = path.join(workDir, 'knowledge_tree.json')
    const treeOutlinePath = path.join(workDir, 'tree_outline.md')
    const structureReviewPath = path.join(workDir, 'structure_review.md')
    const coverageMatrixPath = path.join(workDir, 'coverage_matrix.json')
    const blockRereadLedgerPath = path.join(workDir, 'block_reread_ledger.jsonl')
    const sectionDossiersDir = path.join(workDir, 'section_dossiers')
    const learningNotesReadyArtifacts =
      isUsableMarkdownDocument(learningNotesPath) &&
      isUsableMarkdownDocument(chapterMindmapPath) &&
      isUsableJsonDocument(path.join(workDir, 'concept_graph.json')) &&
      isUsableMarkdownDocument(path.join(workDir, 'self_check.md'))
    const hasAnyLearningDraftArtifacts =
      fs.existsSync(learningNotesPath) ||
      fs.existsSync(chapterMindmapPath) ||
      fs.existsSync(path.join(workDir, 'concept_graph.json')) ||
      fs.existsSync(path.join(workDir, 'self_check.md'))
    const hasAnyDossierArtifacts =
      fs.existsSync(blockRereadLedgerPath) ||
      directoryHasMeaningfulEntries(sectionDossiersDir) ||
      fs.existsSync(path.join(workDir, 'thinness_review.md'))
    const hasAnyCoverageArtifacts =
      fs.existsSync(coverageMatrixPath) ||
      fs.existsSync(path.join(workDir, 'topic_inventory.json')) ||
      directoryHasMeaningfulEntries(path.join(workDir, 'block_digest'))
    const hasAnyTreeArtifacts =
      fs.existsSync(knowledgeTreePath) ||
      fs.existsSync(treeOutlinePath) ||
      fs.existsSync(structureReviewPath)
    const hasAnyIntermediateOutputs =
      fs.existsSync(synthesisPlanPath) ||
      hasAnyTreeArtifacts ||
      hasAnyCoverageArtifacts ||
      hasAnyDossierArtifacts ||
      hasAnyLearningDraftArtifacts ||
      directoryHasMeaningfulEntries(reviewExportsDir)
    const derivedWorkflowStage = deriveMaterialWorkflowStageFromArtifacts({
      knowledgeImported,
      readonlyAuditExists,
      synthesisPlanExists,
      knowledgeTreeExists: fs.existsSync(knowledgeTreePath),
      treeOutlineExists: fs.existsSync(treeOutlinePath),
      structureReviewExists: fs.existsSync(structureReviewPath),
      coverageMatrixExists: fs.existsSync(coverageMatrixPath),
      blockRereadLedgerExists: fs.existsSync(blockRereadLedgerPath),
      sectionDossiersExists: fs.existsSync(sectionDossiersDir),
      learningNotesExists: fs.existsSync(learningNotesPath),
      chapterMindmapExists: fs.existsSync(chapterMindmapPath),
      conceptGraphExists: fs.existsSync(path.join(workDir, 'concept_graph.json')),
      selfCheckExists: fs.existsSync(path.join(workDir, 'self_check.md')),
    })
    if (explicitRunStage === 'learning_notes_ready' && derivedWorkflowStage !== 'learning_notes_ready' && !hasAnyIntermediateOutputs) {
      resetMaterialGeneratedDrafts(materialPath, [])
    }
    const workflowStage =
      derivedWorkflowStage === 'learning_notes_ready' && !validationReport.pipeline_ready
        ? 'needs_deepening'
        : derivedWorkflowStage || explicitRunStage
    const workflowStageLabels: Record<string, string> = {
      knowledge_ready: '学习笔记已可学习',
      learning_notes_ready: '学习笔记可导入',
      partial_learning_notes: '部分章节已深写',
      needs_restructure: '需调整结构',
      needs_deepening: validationReport.summary.error_count > 0 ? '验证未通过' : '需要加厚',
      dossier_incomplete: '章节材料不足',
      dossier_ready: '章节材料已就绪',
      coverage_ready: '覆盖层已就绪',
      knowledge_tree_ready: '知识树已就绪',
      summary_ready: '笔记与思维导图已就绪',
      brief_ready: '学习笔记可阅读',
      map_ready: '章节思维导图已就绪',
      audit_ready: '审计可查看',
      codex_plan_ready: synthesisPlanExists ? '笔记计划已就绪' : '待 Codex 整理',
      material_ready: '待 Codex 整理',
    }
    const workflowStageLabel = workflowStageLabels[workflowStage] ?? '待 Codex 整理'
    const nextActionLabels: Record<string, string> = {
      knowledge_ready: '进入学习',
      learning_notes_ready: '开始学习',
      partial_learning_notes: '继续深写后续章节',
      needs_restructure: '调整知识树',
      needs_deepening: validationReport.summary.error_count > 0 ? '查看验证报告并返工' : '按薄度复查返工',
      dossier_incomplete: '补章节材料包',
      dossier_ready: '开始分章深写',
      coverage_ready: '生成章节材料包',
      knowledge_tree_ready: '映射材料覆盖',
      summary_ready: '阅读笔记、思维导图并开始学习',
      brief_ready: '继续补章节思维导图或审计',
      map_ready: '继续补学习笔记或审计',
      audit_ready: '查看审计报告或继续修复',
      codex_plan_ready: '复制 Codex 学习笔记提示，继续整理',
      material_ready: '复制 Codex 学习笔记提示，开始整理',
    }
    const nextActionLabel = nextActionLabels[workflowStage] ?? '复制 Codex 学习笔记提示，开始整理'
    records.push({
      name: entry.name,
      path: materialPath,
      title,
      sourceId,
      blockCount: Number(manifest.block_count ?? 0) || 0,
      textLength: Number(manifest.text_length ?? manifest.raw_transcript_length ?? 0) || 0,
      updatedAt: stat.mtimeMs,
      handoffPath,
      handoffExists: fs.existsSync(handoffPath),
      runStatePath,
      runStateExists: fs.existsSync(runStatePath),
      handoffStatusPath,
      handoffStatusExists: fs.existsSync(handoffStatusPath),
      workflowStage,
      workflowStageLabel,
      nextActionLabel,
      pipelineReady: validationReport.pipeline_ready,
      auditReady: validationReport.audit_ready,
      releaseReady: validationReport.release_ready,
      validationReportPath: path.join(reviewExportsDir, 'validation_report.json'),
      validationReportExists: fs.existsSync(path.join(reviewExportsDir, 'validation_report.json')),
      validationErrorCount: validationReport.summary.error_count,
      validationWarningCount: validationReport.summary.warning_count,
      authoringDir,
      gptMaterialPromptPath: fs.existsSync(gptMaterialPromptPath) ? gptMaterialPromptPath : '',
      gptMaterialWorkspaceZipPath: gptMaterialWorkspaceZipPath,
      gptMaterialWorkspaceZipExists,
      codexCoursePlanPath,
      codexCoursePlanExists,
      synthesisPlanPath,
      synthesisPlanExists,
      knowledgeBriefPath,
      knowledgeBriefExists,
      chapterMapPath,
      chapterMapExists,
      knowledgeRecordPath,
      knowledgeImported,
      codexGoalPromptPath: fs.existsSync(codexGoalPromptPath) ? codexGoalPromptPath : '',
      readonlyAuditPromptPath: fs.existsSync(readonlyAuditPromptPath) ? readonlyAuditPromptPath : '',
      finalCoursePath,
      finalCourseExists,
      publishedCoursePath,
      publishedCourseExists,
      importReadyCoursePath,
      importReadyCourseExists,
    })
  }

  return {
    rootDir,
    coursePackageRootDir,
    records: records.sort((left, right) => right.updatedAt - left.updatedAt),
  }
}

function getComparablePath(targetPath: string) {
  const resolved = path.resolve(targetPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isPathInsideRoot(targetPath: string, allowedRoot: string) {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(allowedRoot)
  const comparableTarget = getComparablePath(resolvedTarget)
  const comparableRoot = getComparablePath(resolvedRoot)
  return comparableTarget === comparableRoot || comparableTarget.startsWith(`${comparableRoot}${path.sep}`)
}

function assertPathInside(targetPath: string, allowedRoot: string, label: string, options: { allowRoot?: boolean } = {}) {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(allowedRoot)
  const comparableTarget = getComparablePath(resolvedTarget)
  const comparableRoot = getComparablePath(resolvedRoot)
  if (!isPathInsideRoot(resolvedTarget, resolvedRoot)) {
    throw new Error(`${label} 不在允许的目录内，已取消删除。`)
  }
  if (!options.allowRoot && comparableTarget === comparableRoot) {
    throw new Error(`${label} 指向输出根目录，已取消删除。`)
  }
  return resolvedTarget
}

function deletePathIfExists(targetPath: string, deletedPaths: string[]) {
  if (!targetPath || !fs.existsSync(targetPath)) return
  fs.rmSync(targetPath, { recursive: true, force: true })
  deletedPaths.push(targetPath)
}

function deletePathIfInsideAnyRoot(
  targetPath: string | undefined,
  allowedRoots: string[],
  deletedPaths: string[],
  skippedPaths: string[],
) {
  if (!targetPath) return
  const resolvedTarget = path.resolve(targetPath)
  const safeRoot = allowedRoots.find((root) => isPathInsideRoot(resolvedTarget, root))
  if (!safeRoot || getComparablePath(resolvedTarget) === getComparablePath(safeRoot)) {
    skippedPaths.push(resolvedTarget)
    return
  }
  deletePathIfExists(resolvedTarget, deletedPaths)
}

function writeInitialContentDraftReadmes(materialPath: string) {
  const workDir = path.join(materialPath, 'content_draft', 'work')
  const reviewExportsDir = path.join(materialPath, 'content_draft', 'review_exports')
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(reviewExportsDir, { recursive: true })
  fs.writeFileSync(
    path.join(workDir, 'README.md'),
    [
      '# Content Draft Work',
      '',
      '这里保存 Codex Goal v8 的中间工作文件。工作台清理整理结果后，会保留字幕、转写、blocks、indexes 和 authoring，只重置这里的生成稿。',
      '',
    ].join('\n'),
    'utf-8',
  )
  fs.writeFileSync(
    path.join(reviewExportsDir, 'README.md'),
    [
      '# Review Exports',
      '',
      '第二个只读审计窗口只允许把学习笔记审计报告写到这里。',
      '',
      '推荐固定输出：`latest-readonly-audit.md`。',
      '',
    ].join('\n'),
    'utf-8',
  )
}

function resetMaterialRunState(materialPath: string) {
  const runStatePath = path.join(materialPath, 'run_state.json')
  if (!fs.existsSync(runStatePath)) return

  try {
    const current = JSON.parse(fs.readFileSync(runStatePath, 'utf-8')) as Record<string, unknown>
    const baseState = { ...current }
    for (const staleKey of [
      'coverage_ready',
      'dossier_ready',
      'importable',
      'knowledge_tree_ready',
      'learning_notes_ready',
      'partial_learning_notes',
      'steps',
      'validation_report',
    ]) {
      delete baseState[staleKey]
    }
    const reset = {
      ...baseState,
      stage: 'material_ready',
      stage_label: '待知识树整理',
      current_stage: 'material_ready',
      completed_stages: ['material_package'],
      dirty_outputs: [],
      importable: false,
      pipeline_ready: false,
      audit_ready: false,
      release_ready: false,
      stage_outputs: {},
      steps: [
        {
          id: 'material_package',
          label: '原材料包',
          status: 'done',
          output: 'manifest.json, raw_transcript.txt, blocks/, indexes/, authoring/',
        },
        {
          id: 'codex_synthesis',
          label: 'Codex v8 学习笔记',
          status: 'next',
          output: 'knowledge_tree_ready -> coverage_ready -> dossier_ready -> partial_learning_notes -> learning_notes_ready',
        },
        {
          id: 'readonly_audit',
          label: '只读审计',
          status: 'optional',
          output: 'content_draft/review_exports/latest-readonly-audit.md',
        },
        {
          id: 'import_content',
          label: '开始学习',
          status: 'pending',
          output: 'content_draft/learning_notes.md',
        },
      ],
      updated_at: new Date().toISOString(),
      resume_instruction: '复制 authoring/02_start_codex_synthesis.md 到 Codex；v8 会在同一个 Goal 中自动多轮推进，每轮只过一个阶段闸门。',
      next_action: '复制 authoring/02_start_codex_synthesis.md 到 Codex；从知识树整理重新开始。',
    }
    fs.writeFileSync(runStatePath, `${JSON.stringify(reset, null, 2)}\n`, 'utf-8')
  } catch {
    // A broken run_state should not prevent cleaning generated drafts.
  }
}

function resetMaterialGeneratedDrafts(materialPath: string, deletedPaths: string[]) {
  const contentDraftDir = path.join(materialPath, 'content_draft')
  fs.mkdirSync(contentDraftDir, { recursive: true })

  for (const relativePath of [
    'synthesis_plan.json',
    'learning_notes.md',
    'chapter_mindmap.md',
    path.join('work'),
    path.join('review_exports'),
  ]) {
    deletePathIfExists(path.join(contentDraftDir, relativePath), deletedPaths)
  }

  writeInitialContentDraftReadmes(materialPath)
  resetMaterialRunState(materialPath)
}

function deleteCoursePackageFile(packagePath: string, deletedPaths: string[], skippedPaths: string[]) {
  const settings = loadSettings()
  const coursePackageRootDir = resolveCoursePackageOutputDir(settings)
  const outputRootDir = normalizeOutputRoot(settings.output_dir)
  const resolvedPath = path.resolve(packagePath)
  deletePathIfInsideAnyRoot(resolvedPath, [coursePackageRootDir, outputRootDir], deletedPaths, skippedPaths)

  if (resolvedPath.endsWith('.course-package.json')) {
    const assetDir = path.join(
      path.dirname(resolvedPath),
      `${path.basename(resolvedPath).replace(/\.course-package\.json$/iu, '')}.assets`,
    )
    deletePathIfInsideAnyRoot(assetDir, [coursePackageRootDir, outputRootDir], deletedPaths, skippedPaths)
  }
}

function deleteLearningRecordArtifacts(record: LearningRecord, deletedPaths: string[], skippedPaths: string[]) {
  const candidatePaths = [
    record.packagePath,
    record.importedCoursePath,
  ]

  for (const candidatePath of candidatePaths) {
    if (!isWritableCoursePackagePath(candidatePath)) continue
    deleteCoursePackageFile(String(candidatePath), deletedPaths, skippedPaths)
  }
}

function deleteCoursePackagesBySource(
  settings: RuntimeSettings,
  sourceId: string,
  title: string,
  deletedPaths: string[],
  skippedPaths: string[],
) {
  const coursePackageRootDir = resolveCoursePackageOutputDir(settings)
  if (!fs.existsSync(coursePackageRootDir)) return
  const normalizedSourceId = sanitizeDisplayText(sourceId)
  const normalizedTitle = sanitizeDisplayText(title)

  for (const entry of fs.readdirSync(coursePackageRootDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.course-package.json')) continue
    const packagePath = path.join(coursePackageRootDir, entry.name)
    try {
      const payload = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as Record<string, unknown>
      const source = payload.source && typeof payload.source === 'object' ? payload.source as Record<string, unknown> : {}
      const course = payload.course && typeof payload.course === 'object' ? payload.course as Record<string, unknown> : {}
      const packageSourceId = sanitizeDisplayText(source.source_id ?? '')
      const packageTitle = sanitizeDisplayText(course.title ?? source.title ?? '')
      const matchesSource = Boolean(normalizedSourceId && packageSourceId === normalizedSourceId)
      const matchesTitle = Boolean(normalizedTitle && packageTitle === normalizedTitle)
      if (matchesSource || matchesTitle) {
        deleteCoursePackageFile(packagePath, deletedPaths, skippedPaths)
      }
    } catch {
      // Ignore unrelated or broken package JSON.
    }
  }
}

function shouldDeleteMaterialPackageFile(record: MaterialPackageSummary | undefined) {
  if (!record) return false
  return (
    record.workflowStage === 'material_ready' &&
    !record.synthesisPlanExists &&
    !record.knowledgeBriefExists &&
    !record.chapterMapExists &&
    !record.knowledgeImported &&
    !record.finalCourseExists &&
    !record.publishedCourseExists &&
    !record.importReadyCourseExists
  )
}

function deleteMaterialPackage(settings: RuntimeSettings, materialPath: string): DeleteResult {
  const rootDir = resolveMaterialOutputDir(settings)
  const knowledgeRootDir = resolveKnowledgeOutputDir(settings)
  const outputRootDir = normalizeOutputRoot(settings.output_dir)
  const safeMaterialPath = assertPathInside(materialPath, rootDir, '原材料包')
  const inventory = listMaterialPackages(settings)
  const record = inventory.records.find((item) => getComparablePath(item.path) === getComparablePath(safeMaterialPath))
  const deletedPaths: string[] = []
  const skippedPaths: string[] = []
  const deleteMaterialPackageFile = shouldDeleteMaterialPackageFile(record)

  if (deleteMaterialPackageFile) {
    deletePathIfExists(safeMaterialPath, deletedPaths)
  } else {
    resetMaterialGeneratedDrafts(safeMaterialPath, deletedPaths)
  }

  const sourceId = sanitizeDisplayText(record?.sourceId ?? '')
  const title = sanitizeDisplayText(record?.title ?? '')
  deleteCoursePackagesBySource(settings, sourceId, title, deletedPaths, skippedPaths)

  const knowledgeLibrary = loadKnowledgeLibraryFile(settings)
  const nextKnowledgeRecords = knowledgeLibrary.records.filter((item) => {
    const materialMatches = getComparablePath(item.materialPath) === getComparablePath(safeMaterialPath)
    const sourceMatches = Boolean(sourceId && item.sourceId === sourceId)
    if (!materialMatches && !sourceMatches) return true
    if (item.libraryPath) {
      deletePathIfInsideAnyRoot(item.libraryPath, [knowledgeRootDir, outputRootDir], deletedPaths, skippedPaths)
    }
    return false
  })
  if (nextKnowledgeRecords.length !== knowledgeLibrary.records.length) {
    saveKnowledgeLibraryFile(settings, {
      schema_version: 'shijie.knowledge-library.v0.1',
      records: nextKnowledgeRecords,
    })
  }

  const learningLibrary = loadLearningLibraryState()
  const nextLearningRecords = Object.fromEntries(
    Object.entries(learningLibrary.records).filter(([, item]) => {
      const importedPath = sanitizeDisplayText(item.importedCoursePath ?? item.packagePath ?? '')
      const resolvedImportedPath = importedPath ? path.resolve(importedPath) : ''
      const comparableImportedPath = resolvedImportedPath ? getComparablePath(resolvedImportedPath) : ''
      const comparableMaterialPath = getComparablePath(safeMaterialPath)
      const pathMatches = Boolean(
        comparableImportedPath &&
        (comparableImportedPath === comparableMaterialPath || comparableImportedPath.startsWith(`${comparableMaterialPath}${path.sep}`)),
      )
      const sourceMatches = Boolean(sourceId && item.sourceId === sourceId)
      const shouldDelete = pathMatches || sourceMatches
      if (shouldDelete) {
        deleteLearningRecordArtifacts(item, deletedPaths, skippedPaths)
      }
      return !shouldDelete
    }),
  )
  if (Object.keys(nextLearningRecords).length !== Object.keys(learningLibrary.records).length) {
    const currentStillExists = Boolean(
      learningLibrary.currentRecordId && nextLearningRecords[learningLibrary.currentRecordId],
    )
    saveLearningLibraryState({
      currentRecordId: currentStillExists ? learningLibrary.currentRecordId : null,
      records: nextLearningRecords,
    })
  }

  return skippedPaths.length > 0 ? { deletedPaths, skippedPaths } : { deletedPaths }
}

function normalizeCourseTextValue(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function takeUniqueCourseTexts(values: unknown[], limit = 4) {
  const items: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const text = normalizeCourseTextValue(value)
    if (!text) continue
    const marker = text.toLocaleLowerCase('zh-CN')
    if (seen.has(marker)) continue
    seen.add(marker)
    items.push(text)
    if (items.length >= limit) break
  }
  return items
}

function countLeafLessons(node: Record<string, unknown>): number {
  const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : []
  if (!children.length) {
    return node.node_type === 'lesson' ? 1 : 0
  }
  const total: number = children.reduce((sum, child) => sum + countLeafLessons(child), 0)
  return total || (node.node_type === 'lesson' ? 1 : 0)
}

function deriveGroupTheme(nodes: Array<Record<string, unknown>>, groupIndex: number) {
  const titles = nodes
    .map((node) => normalizeCourseTextValue(node.title))
    .filter(Boolean)
  if (!titles.length) return `学习阶段 ${String(groupIndex).padStart(2, '0')}`
  const commonPrefix = titles.reduce((prefix, title) => {
    if (!prefix) return title
    let length = 0
    while (length < prefix.length && length < title.length && prefix[length] === title[length]) {
      length += 1
    }
    return prefix.slice(0, length)
  }, titles[0]).trim().replace(/[ ·|:：,，、-]+$/g, '')
  if (commonPrefix.length >= 4) return commonPrefix.slice(0, 24)
  return titles[0].slice(0, 20)
}

function deriveGroupThemeFromHints(nodes: Array<Record<string, unknown>>) {
  const labels: Array<{ weight: number; text: string }> = []
  for (const node of nodes) {
    const title = normalizeCourseTextValue(node.title)
    const summary = normalizeCourseTextValue(node.summary)
    if (title) labels.push({ weight: 3, text: title })
    if (summary) labels.push({ weight: 1, text: summary })
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && typeof child === 'object') {
          const childTitle = normalizeCourseTextValue((child as Record<string, unknown>).title)
          if (childTitle) labels.push({ weight: 2, text: childTitle })
        }
      }
    }
  }

  if (!labels.length) return ''

  const scored = COURSE_STAGE_THEME_HINTS
    .map((hint) => ({
      label: hint.label,
      score: labels.reduce((count, item) => {
        const lowered = item.text.toLocaleLowerCase('zh-CN')
        return count + hint.keywords.reduce((sum, keyword) => sum + (lowered.includes(keyword.toLocaleLowerCase('zh-CN')) ? item.weight : 0), 0)
      }, 0),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => (right.score - left.score) || left.label.localeCompare(right.label, 'zh-CN'))

  return scored[0]?.label || ''
}

function buildStageTitle(nodes: Array<Record<string, unknown>>, groupIndex: number) {
  const hintedTheme = deriveGroupThemeFromHints(nodes)
  if (hintedTheme) {
    return `阶段 ${String(groupIndex).padStart(2, '0')} · ${hintedTheme}`
  }

  let theme = deriveGroupTheme(nodes, groupIndex)
  const uniqueTitles = takeUniqueCourseTexts(nodes.map((node) => node.title), 3)
  if (uniqueTitles.length >= 2 && theme.length < 5) {
    theme = uniqueTitles.slice(0, 2).join('、')
  }
  return `阶段 ${String(groupIndex).padStart(2, '0')} · ${theme}`
}

function refreshExistingStageTitles(chapters: Array<Record<string, unknown>>) {
  let changed = false
  const refreshed = chapters.map((chapter, index) => {
    const title = normalizeCourseTextValue(chapter.title)
    const children = Array.isArray(chapter.children) ? (chapter.children as Array<Record<string, unknown>>) : []
    if (!children.length || !(title.startsWith('学习阶段 ') || title.startsWith('阶段 '))) {
      return chapter
    }

    const nextTitle = buildStageTitle(children, index + 1)
    const nextSummary = buildStageSummary(children).slice(0, 240)
    const nextObjectives = buildStageLearningObjectives(children, nextTitle)
    const nextChapter = {
      ...JSON.parse(JSON.stringify(chapter)),
      title: nextTitle.slice(0, 120),
      summary: nextSummary,
      learning_objectives: nextObjectives,
      knowledge: buildStageKnowledge(String(chapter.id || nextTitle), nextTitle, nextSummary),
    }
    changed = changed || nextTitle !== title || nextSummary !== normalizeCourseTextValue(chapter.summary)
    return nextChapter
  })

  return { chapters: refreshed, changed }
}

function dedupeStageTitles(chapters: Array<Record<string, unknown>>) {
  const suffixes = ['进阶', '实战', '综合', '拓展']
  const seen = new Map<string, number>()
  let changed = false

  const refreshed = chapters.map((chapter) => {
    const title = normalizeCourseTextValue(chapter.title)
    const themePart = title.includes(' · ') ? title.split(' · ').slice(1).join(' · ') : title
    const titleKey = themePart || title
    const count = seen.get(titleKey) ?? 0
    seen.set(titleKey, count + 1)
    if (!title || count === 0) {
      return chapter
    }

    const suffix = suffixes[Math.min(count - 1, suffixes.length - 1)]
    const nextTitle = `${title} · ${suffix}`
    const children = Array.isArray(chapter.children) ? (chapter.children as Array<Record<string, unknown>>) : []
    const nextChapter = {
      ...JSON.parse(JSON.stringify(chapter)),
      title: nextTitle.slice(0, 120),
    }
    if (children.length) {
      nextChapter.learning_objectives = buildStageLearningObjectives(children, nextTitle)
      nextChapter.knowledge = buildStageKnowledge(String(chapter.id || nextTitle), nextTitle, normalizeCourseTextValue(chapter.summary))
    }
    changed = true
    return nextChapter
  })

  return { chapters: refreshed, changed }
}

function buildStageSummary(nodes: Array<Record<string, unknown>>) {
  const titles = takeUniqueCourseTexts(nodes.map((node) => node.title), 4)
  if (!titles.length) return '把相邻的小节整理为一个更清晰的学习阶段。'
  if (titles.length === 1) return `围绕 ${titles[0]} 展开这一阶段的核心学习主线。`
  return `这一阶段集中学习 ${titles.slice(0, 3).join('、')}${titles.length > 3 ? ' 等内容' : ''}，减少碎片化切换。`
}

function buildStageLearningObjectives(nodes: Array<Record<string, unknown>>, stageTitle: string) {
  const labels: unknown[] = [`建立 ${stageTitle} 的整体主线`]
  for (const node of nodes) {
    labels.push(node.title)
    if (Array.isArray(node.children)) {
      for (const child of node.children.slice(0, 2)) {
        if (child && typeof child === 'object') {
          labels.push((child as Record<string, unknown>).title)
        }
      }
    }
  }
  return takeUniqueCourseTexts(labels, 4)
}

function collectNodeTextFragments(node: Record<string, unknown>) {
  const knowledge = node.knowledge && typeof node.knowledge === 'object' ? (node.knowledge as Record<string, unknown>) : {}
  return [
    normalizeCourseTextValue(node.title),
    normalizeCourseTextValue(node.summary),
    ...((Array.isArray(knowledge.checkpoints) ? knowledge.checkpoints : []).map((item) => normalizeCourseTextValue(item))),
    ...((Array.isArray(knowledge.common_mistakes) ? knowledge.common_mistakes : []).map((item) => normalizeCourseTextValue(item))),
  ].filter(Boolean)
}

function inferTeachingFlowBucket(node: Record<string, unknown>) {
  const haystack = collectNodeTextFragments(node).join(' ').toLocaleLowerCase('zh-CN')
  if (!haystack) return 3
  for (const hint of COURSE_TEACHING_FLOW_BUCKET_HINTS) {
    if (hint.keywords.some((keyword) => haystack.includes(keyword.toLocaleLowerCase('zh-CN')))) {
      return hint.bucket
    }
  }
  return 3
}

function resequenceChildren(children: Array<Record<string, unknown>>) {
  const siblingIds = new Set(
    children.map((child) => normalizeCourseTextValue(child.id)).filter(Boolean),
  )
  let previousId = ''
  return children.map((child, index) => {
    const childId = normalizeCourseTextValue(child.id)
    const dependencies = Array.isArray(child.dependencies) ? child.dependencies : []
    const externalDependencies = dependencies
      .map((item) => normalizeCourseTextValue(item))
      .filter((item) => item && item !== childId && !siblingIds.has(item))
    if (previousId) externalDependencies.push(previousId)
    const nextChild = {
      ...JSON.parse(JSON.stringify(child)),
      order: index + 1,
      dependencies: takeUniqueCourseTexts(externalDependencies, 8),
    }
    if (childId) previousId = childId
    return nextChild
  })
}

function isStageRecapNode(node: Record<string, unknown>) {
  const title = normalizeCourseTextValue(node.title).toLocaleLowerCase('zh-CN')
  return Boolean(title) && (title.includes('阶段复盘') || title.includes('阶段练习') || ['复盘', '练习', '回顾'].includes(title))
}

function restructureNodeForTeachingFlow(node: Record<string, unknown>, isRootStage = false): { node: Record<string, unknown>; changed: boolean } {
  const children = Array.isArray(node.children) ? (node.children as Array<Record<string, unknown>>) : []
  if (!children.length) {
    return { node: JSON.parse(JSON.stringify(node)), changed: false }
  }

  let changed = false
  const nextNode = JSON.parse(JSON.stringify(node)) as Record<string, unknown>
  let processedChildren = children.map((child) => {
    const result = restructureNodeForTeachingFlow(child, false)
    changed = changed || result.changed
    return result.node
  })

  const lessonOnlyChildren = processedChildren.length > 0 && processedChildren.every((child) => child.node_type === 'lesson')
  if (lessonOnlyChildren) {
    const sortedChildren = [...processedChildren].sort((left, right) => {
      const bucketDiff = inferTeachingFlowBucket(left) - inferTeachingFlowBucket(right)
      if (bucketDiff !== 0) return bucketDiff
      return Number(left.order || 0) - Number(right.order || 0)
    })
    const originalIds = processedChildren.map((child) => normalizeCourseTextValue(child.id)).join('|')
    const nextIds = sortedChildren.map((child) => normalizeCourseTextValue(child.id)).join('|')
    if (originalIds !== nextIds) {
      processedChildren = sortedChildren
      changed = true
    }
  }

  if (isRootStage) {
    const baseChildren = processedChildren.filter((child) => !isStageRecapNode(child))
    if (baseChildren.length !== processedChildren.length) {
      processedChildren = baseChildren
      changed = true
    }
  }

  const resequenced = resequenceChildren(processedChildren)
  if (JSON.stringify(processedChildren.map((child) => [child.order, child.dependencies])) !== JSON.stringify(resequenced.map((child) => [child.order, child.dependencies]))) {
    changed = true
  }

  nextNode.children = resequenced
  return { node: nextNode, changed }
}

function restructureCourseRootsForTeachingFlow(chapters: Array<Record<string, unknown>>) {
  let changed = false
  const nextRoots = chapters.map((chapter) => {
    const result = restructureNodeForTeachingFlow(chapter, true)
    changed = changed || result.changed
    return result.node
  })
  return { chapters: nextRoots, changed }
}

function collectCourseNodeIds(chapters: Array<Record<string, unknown>>) {
  const ids = new Set<string>()
  const visit = (node: Record<string, unknown>) => {
    const id = normalizeCourseTextValue(node.id)
    if (id) ids.add(id)
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => {
        if (child && typeof child === 'object') visit(child as Record<string, unknown>)
      })
    }
  }
  chapters.forEach(visit)
  return ids
}

function filterDependencyGraphByNodeIds(dependencyGraph: unknown, nodeIds: Set<string>) {
  if (!Array.isArray(dependencyGraph)) return []
  return dependencyGraph.filter((edge) => {
    if (!edge || typeof edge !== 'object') return false
    const record = edge as Record<string, unknown>
    const from = normalizeCourseTextValue(record.from)
    const to = normalizeCourseTextValue(record.to)
    return Boolean(from && to && nodeIds.has(from) && nodeIds.has(to))
  })
}

function makeCourseNodeId(kind: 'chapter' | 'section' | 'lesson', index: number, title: string, parentId = '') {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 18) || `${kind}_${index}`
  return parentId ? `${parentId}.${kind[0]}${String(index).padStart(2, '0')}_${slug}`.slice(0, 64) : `${kind.slice(0, 2)}${String(index).padStart(2, '0')}_${slug}`.slice(0, 64)
}

function buildStageKnowledge(stageId: string, title: string, summary: string): {
  concepts: Array<Record<string, unknown>>
  examples: Array<Record<string, unknown>>
  checkpoints: string[]
  common_mistakes: string[]
} {
  return {
    concepts: [
      {
        id: `concept_${stageId.slice(0, 20)}_01`.slice(0, 64),
        name: title.slice(0, 64),
        explanation: summary.slice(0, 240) || `围绕 ${title} 展开的阶段主线。`,
        evidence: [],
      },
    ],
    examples: [
      {
        id: `example_${stageId.slice(0, 20)}_01`.slice(0, 64),
        title: title.slice(0, 64),
        scenario: summary.slice(0, 180) || `这一阶段会覆盖 ${title} 的关键内容。`,
        takeaway: takeUniqueCourseTexts([title, summary], 1)[0] || title,
      },
    ],
    checkpoints: takeUniqueCourseTexts([`能说清 ${title} 这一阶段的主线。`, summary], 3),
    common_mistakes: [],
  }
}

function groupRootChapters(chapters: Array<Record<string, unknown>>) {
  if (chapters.length <= COURSE_MAX_ROOT_CHAPTERS) {
    return chapters.map((chapter) => [chapter])
  }

  const groups: Array<Array<Record<string, unknown>>> = []
  let buffer: Array<Record<string, unknown>> = []
  let bufferLessons = 0

  for (const chapter of chapters) {
    const leafLessons = Math.max(1, countLeafLessons(chapter))
    const isMicro = leafLessons <= COURSE_MICRO_ROOT_LESSON_THRESHOLD

    if (isMicro) {
      buffer.push(chapter)
      bufferLessons += leafLessons
      if (buffer.length >= 2 && bufferLessons >= COURSE_TARGET_GROUP_LEAF_LESSONS) {
        groups.push(buffer)
        buffer = []
        bufferLessons = 0
      }
      continue
    }

    if (buffer.length) {
      if (bufferLessons + leafLessons <= COURSE_TARGET_GROUP_LEAF_LESSONS || buffer.length === 1) {
        buffer.push(chapter)
        groups.push(buffer)
        buffer = []
        bufferLessons = 0
      } else {
        groups.push(buffer)
        buffer = []
        bufferLessons = 0
        groups.push([chapter])
      }
    } else {
      groups.push([chapter])
    }
  }

  if (buffer.length) groups.push(buffer)
  if (groups.length <= COURSE_MAX_ROOT_CHAPTERS) return groups

  const merged: Array<Array<Record<string, unknown>>> = []
  const mergeSpan = Math.max(2, Math.ceil(groups.length / COURSE_MAX_ROOT_CHAPTERS))
  for (let index = 0; index < groups.length; index += mergeSpan) {
    merged.push(groups.slice(index, index + mergeSpan).flat())
  }
  return merged
}

function compactCoursePackagePayload(payload: Record<string, unknown>): {
  payload: Record<string, unknown>
  changed: boolean
} {
  const chapters = Array.isArray(payload.chapters) ? (payload.chapters as Record<string, unknown>[]) : []
  if (chapters.length <= COURSE_MAX_ROOT_CHAPTERS) {
    const refreshed = refreshExistingStageTitles(chapters)
    const deduped = dedupeStageTitles(refreshed.chapters)
    const restructured = restructureCourseRootsForTeachingFlow(deduped.chapters)
    const nextChapters = restructured.chapters
    if (!refreshed.changed) {
      if (!deduped.changed && !restructured.changed) {
        return { payload, changed: false }
      }
    }

    const nextCourse = { ...((payload.course as Record<string, unknown>) || {}) }
    const validNodeIds = collectCourseNodeIds(nextChapters)
    nextCourse.learning_outcomes = takeUniqueCourseTexts(
      [
        ...nextChapters.slice(0, 4).map((item) => item.title),
        ...nextChapters.flatMap((item) =>
          Array.isArray(item.children)
            ? item.children.slice(0, 1).map((child: unknown) => (child as Record<string, unknown>).title)
            : [],
        ),
      ],
      6,
    )

    return {
      payload: {
        ...payload,
        course: nextCourse,
        chapters: nextChapters,
        dependency_graph: filterDependencyGraphByNodeIds(payload.dependency_graph, validNodeIds),
      },
      changed: true,
    }
  }

  const grouped = groupRootChapters(chapters)
  if (grouped.length >= chapters.length) {
    return { payload, changed: false }
  }

  const compactedRoots: Array<Record<string, unknown>> = []
  for (let rootIndex = 0; rootIndex < grouped.length; rootIndex += 1) {
    const chapterGroup = grouped[rootIndex]
    if (chapterGroup.length === 1 && grouped.length <= COURSE_MAX_ROOT_CHAPTERS) {
      compactedRoots.push({
        ...JSON.parse(JSON.stringify(chapterGroup[0])),
        order: rootIndex + 1,
      })
      continue
    }

    const stageTitle = buildStageTitle(chapterGroup, rootIndex + 1)
    const stageId = makeCourseNodeId('chapter', rootIndex + 1, stageTitle)
    const summary = buildStageSummary(chapterGroup)
    compactedRoots.push({
      id: stageId,
      node_type: 'chapter',
      title: stageTitle.slice(0, 120),
      summary: summary.slice(0, 240),
      order: rootIndex + 1,
      learning_objectives: buildStageLearningObjectives(chapterGroup, stageTitle),
      dependencies: compactedRoots.length ? [String(compactedRoots[compactedRoots.length - 1].id)] : [],
      knowledge: buildStageKnowledge(stageId, stageTitle, summary),
      children: chapterGroup.map((chapter, sectionIndex) => ({
        ...JSON.parse(JSON.stringify(chapter)),
        node_type: 'section',
        order: sectionIndex + 1,
      })),
      assets: [],
      gaps: [],
    })
  }

  const dedupedRoots = dedupeStageTitles(compactedRoots)
  compactedRoots.length = 0
  compactedRoots.push(...restructureCourseRootsForTeachingFlow(dedupedRoots.chapters).chapters)

  const validNodeIds = collectCourseNodeIds(compactedRoots)
  const dependencyGraph = filterDependencyGraphByNodeIds(payload.dependency_graph, validNodeIds)
  const markers = new Set(
    dependencyGraph
      .filter((item: unknown) => item && typeof item === 'object')
      .map((item: unknown) => JSON.stringify(item)),
  )
  for (let index = 1; index < compactedRoots.length; index += 1) {
    const edge = {
      from: compactedRoots[index - 1].id,
      to: compactedRoots[index].id,
      kind: 'recommended',
      reason: '压缩顶层主线后，按阶段顺序推进更容易建立整体框架。',
    }
    const marker = JSON.stringify(edge)
    if (!markers.has(marker)) {
      dependencyGraph.push(edge)
      markers.add(marker)
    }
  }

  const nextCourse = { ...((payload.course as Record<string, unknown>) || {}) }
  nextCourse.learning_outcomes = takeUniqueCourseTexts(
    [
      ...compactedRoots.slice(0, 4).map((item) => item.title),
      ...compactedRoots.flatMap((item) =>
        Array.isArray(item.children) ? item.children.slice(0, 1).map((child) => (child as Record<string, unknown>).title) : [],
      ),
    ],
    6,
  )

  return {
    changed: true,
    payload: {
      ...payload,
      course: nextCourse,
      chapters: compactedRoots,
      dependency_graph: dependencyGraph,
    },
  }
}

function normalizeCoursePackageText(courseText: string, targetPath?: string | null) {
  if (!courseText.trim()) return { text: courseText, changed: false }
  try {
    const parsed = JSON.parse(courseText) as Record<string, unknown>
    const compacted = compactCoursePackagePayload(parsed)
    if (!compacted.changed) {
      return { text: courseText, changed: false }
    }
    const nextText = JSON.stringify(compacted.payload, null, 2)
    const writableTargetPath = isWritableCoursePackagePath(targetPath) ? String(targetPath).trim() : ''
    if (writableTargetPath) {
      try {
        fs.writeFileSync(writableTargetPath, nextText, 'utf-8')
      } catch {
        // ignore package write-back failures and still return upgraded text
      }
    }
    return { text: nextText, changed: true }
  } catch {
    return { text: courseText, changed: false }
  }
}

function isWritableCoursePackagePath(targetPath?: string | null) {
  const normalized = String(targetPath ?? '').trim()
  if (!normalized) return false
  if (path.basename(normalized).toLowerCase() === 'learning_notes.md') return false
  return path.extname(normalized).toLowerCase() === '.json'
}

function buildCourseVisualMapAssetPaths(packagePath: string, imagePath: string) {
  const packageDir = path.dirname(packagePath)
  const packageBaseName = path.basename(packagePath).replace(/\.course-package\.json$/iu, '')
  const extension = path.extname(imagePath) || '.png'
  const assetDirName = `${packageBaseName}.assets`
  const relativeAssetPath = path.join(assetDirName, 'maps', `global-course-map${extension}`).replace(/\\/g, '/')
  const absoluteAssetPath = path.join(packageDir, relativeAssetPath)
  return { relativeAssetPath, absoluteAssetPath }
}

function attachCourseVisualMap(payload: CourseVisualMapAttachmentPayload) {
  const targetPath = path.resolve(String(payload?.targetPath || ''))
  const imagePath = path.resolve(String(payload?.imagePath || ''))
  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error('没有找到要更新的学习包。')
  }
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error('没有找到要导入的地图图片。')
  }

  const rawText = fs.readFileSync(targetPath, 'utf-8')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawText) as Record<string, unknown>
  } catch {
    throw new Error('学习包 JSON 解析失败，无法写入地图图片。')
  }

  const course = parsed.course && typeof parsed.course === 'object' ? (parsed.course as Record<string, unknown>) : {}
  const source = parsed.source && typeof parsed.source === 'object' ? (parsed.source as Record<string, unknown>) : {}
  const currentMap =
    parsed.course_visual_map && typeof parsed.course_visual_map === 'object'
      ? ({ ...(parsed.course_visual_map as Record<string, unknown>) } as Record<string, unknown>)
      : {}

  const { relativeAssetPath, absoluteAssetPath } = buildCourseVisualMapAssetPaths(targetPath, imagePath)
  fs.mkdirSync(path.dirname(absoluteAssetPath), { recursive: true })
  fs.copyFileSync(imagePath, absoluteAssetPath)

  const title = String(course.title ?? source.title ?? '学习笔记').trim() || '学习笔记'
  const nextMap: Record<string, unknown> = {
    ...currentMap,
    kind: 'image',
    status: 'attached',
    uri: relativeAssetPath,
    alt: String(currentMap.alt ?? '').trim() || `${title} 全局学习地图`,
    prompt: String(currentMap.prompt ?? '').trim() || `请生成《${title}》的 16:9 全局学习地图，展示章节主线、能力成长和关键转折，少文字、强结构，适合作为学习导览图。`,
  }

  const nextPayload = {
    ...parsed,
    course_visual_map: nextMap,
  }

  const serialized = JSON.stringify(nextPayload, null, 2)
  fs.writeFileSync(targetPath, serialized, 'utf-8')
  const normalized = normalizeCoursePackageText(serialized, targetPath)
  const syncedRecordCount = syncLearningRecordsForCoursePackage(targetPath, normalized.text)
  return {
    path: targetPath,
    text: normalized.text,
    assetPath: absoluteAssetPath,
    syncedRecordCount,
  }
}

function defaultLearningLibraryState(): LearningLibraryState {
  return {
    currentRecordId: null,
    records: {},
  }
}

function normalizeNodeSession(raw: Partial<PersistedNodeLearningSession> | null | undefined, fallbackNodeId: string): PersistedNodeLearningSession {
  const messages = Array.isArray(raw?.messages) ? raw.messages : []
  const rawLearningStatus = String(raw?.learningStatus ?? '')
  return {
    nodeId: String(raw?.nodeId ?? fallbackNodeId),
    learningStatus:
      rawLearningStatus === 'correcting'
        ? 'completed'
        : rawLearningStatus === 'quizzing' || rawLearningStatus === 'completed'
          ? rawLearningStatus
          : 'teaching',
    messages: messages
      .filter((message) => message && typeof message === 'object')
      .map((message, index) => ({
        id: String(message.id ?? `${fallbackNodeId}-${index}`),
        role: message.role === 'system' || message.role === 'user' ? message.role : 'coach',
        content: String(message.content ?? ''),
        nodeId: typeof message.nodeId === 'string' ? message.nodeId : fallbackNodeId,
        createdAt: Number(message.createdAt ?? Date.now()),
      })),
    activeQuestion: raw?.activeQuestion ? String(raw.activeQuestion) : null,
    lastUserAnswer: String(raw?.lastUserAnswer ?? ''),
    lastEvaluation:
      raw?.lastEvaluation === 'correct' || raw?.lastEvaluation === 'partial' || raw?.lastEvaluation === 'incorrect'
        ? raw.lastEvaluation
        : null,
    hydrated: Boolean(raw?.hydrated),
    preloaded: Boolean(raw?.preloaded),
    updatedAt: Number(raw?.updatedAt ?? Date.now()),
  }
}

function readPackageTextWithLightMapUpgrade(courseText: string, packagePath: string | null) {
  if (!isWritableCoursePackagePath(packagePath)) return courseText
  const resolvedPath = packagePath ? path.resolve(packagePath) : ''
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return courseText

  try {
    const freshText = fs.readFileSync(resolvedPath, 'utf-8')
    const currentPayload = JSON.parse(courseText || '{}') as Record<string, unknown>
    const freshPayload = JSON.parse(freshText) as Record<string, unknown>
    const currentPackageId = String(currentPayload.package_id ?? '').trim()
    const freshPackageId = String(freshPayload.package_id ?? '').trim()
    if (currentPackageId && freshPackageId && currentPackageId !== freshPackageId) return courseText
    if (!freshPayload.light_learning_map || currentPayload.light_learning_map) return courseText
    return freshText
  } catch {
    return courseText
  }
}

function normalizeLearningRecord(raw: Partial<LearningRecord> | null | undefined, existing?: LearningRecord): LearningRecord {
  const recordId = String(raw?.id ?? existing?.id ?? raw?.packageId ?? `record-${Date.now()}`)
  const nodeSessions = Object.entries(raw?.nodeSessions ?? existing?.nodeSessions ?? {}).reduce<Record<string, PersistedNodeLearningSession>>(
    (accumulator, [nodeId, session]) => {
      accumulator[nodeId] = normalizeNodeSession(session, nodeId)
      return accumulator
    },
    {},
  )
  const rawImportedCoursePath =
    raw?.importedCoursePath === null
      ? null
      : String(raw?.importedCoursePath ?? existing?.importedCoursePath ?? '') || null
  const rawPackagePath =
    raw?.packagePath === null
      ? null
      : String(raw?.packagePath ?? existing?.packagePath ?? '') || null
  const importedCoursePath = isWritableCoursePackagePath(rawImportedCoursePath) ? rawImportedCoursePath : null
  const packagePath = isWritableCoursePackagePath(rawPackagePath) ? rawPackagePath : null
  const preferredPackagePath = packagePath ?? importedCoursePath
  const rawCourseText = readPackageTextWithLightMapUpgrade(
    String(raw?.courseText ?? existing?.courseText ?? ''),
    preferredPackagePath,
  )
  const normalizedCourseText = normalizeCoursePackageText(
    rawCourseText,
    preferredPackagePath,
  )

  return {
    id: recordId,
    packageId: String(raw?.packageId ?? existing?.packageId ?? recordId),
    title: String(raw?.title ?? existing?.title ?? '未命名学习笔记'),
    sourceTitle: String(raw?.sourceTitle ?? existing?.sourceTitle ?? raw?.title ?? '未命名来源'),
    sourceId: String(raw?.sourceId ?? existing?.sourceId ?? ''),
    sourceUrl: raw?.sourceUrl ?? existing?.sourceUrl ?? '',
    importedCoursePath,
    packagePath,
    courseText: normalizedCourseText.text,
    currentNodeId:
      raw?.currentNodeId === null
        ? null
        : String(raw?.currentNodeId ?? existing?.currentNodeId ?? '') || null,
    completedNodeIds: Array.isArray(raw?.completedNodeIds)
      ? raw!.completedNodeIds.map((value) => String(value))
      : existing?.completedNodeIds ?? [],
    nodeSessions,
    milestoneEvents: Array.isArray(raw?.milestoneEvents)
      ? raw!.milestoneEvents
          .map((event) => ({
            id: String(event?.id ?? `milestone-${Date.now()}-${Math.random()}`),
            kind:
              event?.kind === 'node_complete' ||
              event?.kind === 'stage_complete' ||
              event?.kind === 'course_complete'
                ? event.kind
                : 'node_complete',
            title: String(event?.title ?? '学习里程碑'),
            detail: String(event?.detail ?? ''),
            createdAt: Number(event?.createdAt ?? Date.now()),
            nodeId: event?.nodeId == null ? null : String(event.nodeId),
            stageId: event?.stageId == null ? null : String(event.stageId),
            progressPercent:
              event?.progressPercent == null ? undefined : Math.max(0, Math.min(100, Number(event.progressPercent))),
          }))
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, 60)
      : existing?.milestoneEvents ?? [],
    progressPercent: Math.max(0, Math.min(100, Number(raw?.progressPercent ?? existing?.progressPercent ?? 0))),
    isArchived: Boolean(raw?.isArchived ?? existing?.isArchived ?? false),
    createdAt: Number(raw?.createdAt ?? existing?.createdAt ?? Date.now()),
    updatedAt: Number(raw?.updatedAt ?? existing?.updatedAt ?? Date.now()),
    lastOpenedAt: Number(raw?.lastOpenedAt ?? existing?.lastOpenedAt ?? Date.now()),
  }
}

function loadLearningLibraryState(): LearningLibraryState {
  const raw = secureStore.get('learningLibrary')
  const fallback = defaultLearningLibraryState()
  let shouldPersistNormalizedRecords = false
  const records = Object.entries(raw?.records ?? {}).reduce<Record<string, LearningRecord>>((accumulator, [recordId, record]) => {
    const normalized = normalizeLearningRecord(record, undefined)
    const previous = record as Partial<LearningRecord> | undefined
    if (
      normalized.courseText !== String(previous?.courseText ?? '') ||
      normalized.importedCoursePath !== (previous?.importedCoursePath ?? null) ||
      normalized.packagePath !== (previous?.packagePath ?? null)
    ) {
      shouldPersistNormalizedRecords = true
    }
    accumulator[recordId] = normalized
    return accumulator
  }, {})

  const currentRecordId =
    typeof raw?.currentRecordId === 'string' && records[raw.currentRecordId]
      ? raw.currentRecordId
      : null

  const nextState = {
    currentRecordId,
    records,
  }

  if (shouldPersistNormalizedRecords) {
    saveLearningLibraryState(nextState)
  }

  return nextState
}

function saveLearningLibraryState(next: LearningLibraryState) {
  secureStore.set('learningLibrary', next)
  return next
}

function syncLearningRecordsForCoursePackage(packagePath: string, courseText: string) {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(courseText) as Record<string, unknown>
  } catch {
    return 0
  }

  const resolvedPackagePath = path.resolve(packagePath)
  const packageId = String(parsed.package_id ?? '').trim()
  const course = parsed.course && typeof parsed.course === 'object' ? (parsed.course as Record<string, unknown>) : {}
  const source = parsed.source && typeof parsed.source === 'object' ? (parsed.source as Record<string, unknown>) : {}
  const library = loadLearningLibraryState()
  const now = Date.now()
  let updateCount = 0

  const nextRecords = Object.entries(library.records).reduce<Record<string, LearningRecord>>((accumulator, [recordId, record]) => {
    const recordPackagePath = record.packagePath ?? record.importedCoursePath
    const pathMatches = recordPackagePath ? path.resolve(recordPackagePath) === resolvedPackagePath : false
    const packageMatches = Boolean(packageId && record.packageId === packageId)

    if (!pathMatches && !packageMatches) {
      accumulator[recordId] = record
      return accumulator
    }

    updateCount += 1
    accumulator[recordId] = normalizeLearningRecord(
      {
        ...record,
        packageId: packageId || record.packageId,
        title: String(course.title ?? record.title),
        sourceTitle: String(source.title ?? record.sourceTitle),
        sourceId: String(source.source_id ?? record.sourceId),
        sourceUrl: String(source.url ?? record.sourceUrl ?? ''),
        importedCoursePath: record.importedCoursePath ?? resolvedPackagePath,
        packagePath: record.packagePath ?? resolvedPackagePath,
        courseText,
        updatedAt: now,
      },
      record,
    )
    return accumulator
  }, {})

  if (updateCount > 0) {
    saveLearningLibraryState({
      currentRecordId: library.currentRecordId,
      records: nextRecords,
    })
  }

  return updateCount
}

function sortLearningRecords(records: LearningRecord[]) {
  return [...records].sort((left, right) => {
    if (left.isArchived !== right.isArchived) {
      return Number(left.isArchived) - Number(right.isArchived)
    }
    return right.updatedAt - left.updatedAt
  })
}

function findNodeTitleFromCourseText(courseText: string, nodeId: string | null) {
  if (!courseText || !nodeId) return null
  try {
    const payload = JSON.parse(courseText)
    const chapters = Array.isArray(payload?.chapters) ? payload.chapters : []
    const stack = [...chapters]
    while (stack.length > 0) {
      const node = stack.shift()
      if (!node || typeof node !== 'object') continue
      if (String((node as { id?: string }).id ?? '') === nodeId) {
        return String((node as { title?: string }).title ?? '') || null
      }
      const children = Array.isArray((node as { children?: unknown[] }).children)
        ? ((node as { children?: unknown[] }).children as Record<string, unknown>[])
        : []
      stack.push(...children)
    }
  } catch {
    return null
  }
  return null
}

function countRootStagesFromCourseText(courseText: string) {
  if (!courseText) return 0
  try {
    const payload = JSON.parse(courseText)
    return Array.isArray(payload?.chapters) ? payload.chapters.length : 0
  } catch {
    return 0
  }
}

function buildAchievementBadges(record: LearningRecord) {
  const stageCompleteCount = new Set(
    (record.milestoneEvents ?? [])
      .filter((event) => event.kind === 'stage_complete' && event.stageId)
      .map((event) => event.stageId as string),
  ).size
  const badges: LearningRecordSummary['achievementBadges'] = []

  if (record.completedNodeIds.length >= 1) {
    badges.push({
      code: 'first_step',
      label: '起步完成',
      description: '已经顺利拿下第一个小关，进入稳定学习节奏。',
      tone: 'neutral',
    })
  }

  if (record.completedNodeIds.length >= 5) {
    badges.push({
      code: 'steady_stride',
      label: '稳定推进',
      description: '已经连续推进多个小关，不再只是试试看。',
      tone: 'info',
    })
  }

  if (stageCompleteCount >= 1) {
    badges.push({
      code: 'stage_breaker',
      label: '阶段突破',
      description: '已经完整打通至少一个主线阶段。',
      tone: 'accent',
    })
  }

  if (record.progressPercent >= 50) {
    badges.push({
      code: 'midway',
      label: '半程已过',
      description: '这门课已经不再是开始阶段，正在进入真正的中段推进。',
      tone: 'success',
    })
  }

  if (record.progressPercent >= 100 || record.isArchived) {
    badges.push({
      code: 'course_finisher',
      label: '学习归档',
      description: '这份学习档案已经完成，可以永久收录到知识资产里。',
      tone: 'success',
    })
  }

  return badges
}

function summarizeLearningRecord(record: LearningRecord): LearningRecordSummary {
  const stageCompletedCount = new Set(
    (record.milestoneEvents ?? [])
      .filter((event) => event.kind === 'stage_complete' && event.stageId)
      .map((event) => event.stageId as string),
  ).size
  const totalStageCount = countRootStagesFromCourseText(record.courseText)
  const recentMilestones = [...(record.milestoneEvents ?? [])].sort((left, right) => right.createdAt - left.createdAt).slice(0, 6)
  const achievementBadges = buildAchievementBadges(record)

  return {
    id: record.id,
    packageId: record.packageId,
    title: record.title,
    sourceTitle: record.sourceTitle,
    sourceId: record.sourceId,
    sourceUrl: record.sourceUrl,
    importedCoursePath: record.importedCoursePath,
    packagePath: record.packagePath,
    progressPercent: record.progressPercent,
    isArchived: record.isArchived,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastOpenedAt: record.lastOpenedAt,
    currentNodeId: record.currentNodeId,
    currentNodeTitle: findNodeTitleFromCourseText(record.courseText, record.currentNodeId),
    completedCount: record.completedNodeIds.length,
    sessionCount: Object.keys(record.nodeSessions).length,
    stageCompletedCount,
    totalStageCount,
    recentMilestones,
    achievementBadges,
  }
}

function loadLearningLibraryPayload(): LearningLibraryPayload {
  const library = loadLearningLibraryState()
  return {
    currentRecordId: library.currentRecordId,
    records: sortLearningRecords(Object.values(library.records)).map(summarizeLearningRecord),
  }
}

function collectCoursePackagePaths(rootDir: string) {
  const normalizedRoot = String(rootDir || '').trim()
  if (!normalizedRoot || !fs.existsSync(normalizedRoot)) return []

  const results: string[] = []
  const stack = [normalizedRoot]

  while (stack.length) {
    const currentDir = stack.pop()
    if (!currentDir) continue

    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const nextPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        stack.push(nextPath)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.course-package.json')) {
        results.push(nextPath)
      }
    }
  }

  return results
}

function refreshLearningLibraryStructure(): LearningLibraryRefreshResult {
  const library = loadLearningLibraryState()
  const nextRecords: Record<string, LearningRecord> = {}
  const refreshedPackagePaths = new Set<string>()
  const knownPackagePaths = new Set<string>()
  let recordUpdates = 0

  for (const [recordId, record] of Object.entries(library.records)) {
    const packagePath = record.packagePath ?? record.importedCoursePath
    if (packagePath) {
      knownPackagePaths.add(path.resolve(packagePath))
    }

    const normalized = normalizeLearningRecord(record, record)
    if (
      normalized.courseText !== record.courseText ||
      normalized.importedCoursePath !== record.importedCoursePath ||
      normalized.packagePath !== record.packagePath
    ) {
      recordUpdates += 1
      if (packagePath) {
        refreshedPackagePaths.add(path.resolve(packagePath))
      }
    }
    nextRecords[recordId] = normalized
  }

  if (recordUpdates > 0) {
    saveLearningLibraryState({
      currentRecordId: library.currentRecordId,
      records: nextRecords,
    })
  }

  const settings = loadSettings()
  const packagePaths = collectCoursePackagePaths(settings.output_dir)
  let scannedPackages = 0

  for (const packagePath of packagePaths) {
    const resolvedPath = path.resolve(packagePath)
    if (knownPackagePaths.has(resolvedPath)) continue
    scannedPackages += 1

    try {
      const originalText = fs.readFileSync(resolvedPath, 'utf-8')
      const normalized = normalizeCoursePackageText(originalText, resolvedPath)
      if (normalized.changed) {
        refreshedPackagePaths.add(resolvedPath)
      }
    } catch {
      continue
    }
  }

  return {
    library: loadLearningLibraryPayload(),
    recordUpdates,
    packageUpdates: refreshedPackagePaths.size,
    scannedPackages,
  }
}

function upsertLearningRecord(nextRecord: LearningRecord) {
  const library = loadLearningLibraryState()
  const existing = library.records[nextRecord.id]
  const normalized = normalizeLearningRecord(nextRecord, existing)
  const nextLibrary: LearningLibraryState = {
    currentRecordId: normalized.id,
    records: {
      ...library.records,
      [normalized.id]: normalized,
    },
  }
  saveLearningLibraryState(nextLibrary)
  return normalized
}

function deleteLearningRecord(recordId: string) {
  const library = loadLearningLibraryState()
  const record = library.records[recordId]
  const deletedPaths: string[] = []
  const skippedPaths: string[] = []
  if (record) {
    deleteLearningRecordArtifacts(record, deletedPaths, skippedPaths)
  }
  const nextRecords = { ...library.records }
  delete nextRecords[recordId]
  const nextCurrentRecordId =
    library.currentRecordId === recordId
      ? null
      : library.currentRecordId
  saveLearningLibraryState({
    currentRecordId: nextCurrentRecordId,
    records: nextRecords,
  })
  return loadLearningLibraryPayload()
}

function openLearningRecord(recordId: string) {
  const library = loadLearningLibraryState()
  const record = library.records[recordId]
  if (!record) {
    throw new Error('未找到指定的学习记录。')
  }
  const normalized = normalizeLearningRecord(
    {
      ...record,
      lastOpenedAt: Date.now(),
      updatedAt: Date.now(),
    },
    record,
  )
  saveLearningLibraryState({
    currentRecordId: normalized.id,
    records: {
      ...library.records,
      [normalized.id]: normalized,
    },
  })
  return normalized
}

function appendRuntimeLog(message: string) {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`
    fs.appendFileSync(runtimeLogPath, line, 'utf-8')
  } catch {
    // ignore
  }
}

function emitDistillProgress(payload: DistillProgressPayload) {
  appendRuntimeLog(`distill-progress ${payload.percent}% ${payload.message}`)
  mainWindow?.webContents.send('distill-progress', payload)
}

function copyDirectoryRecursive(sourceDir: string, targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true })

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath)
      continue
    }

    fs.copyFileSync(sourcePath, targetPath)
  }
}

function resolvePackagedBackendResourceRoot() {
  const candidates = [
    path.join(process.resourcesPath, 'backend'),
    path.join(path.dirname(process.execPath), 'resources', 'backend'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'distiller.py')) && fs.existsSync(path.join(candidate, 'main.py'))) {
      return candidate
    }
  }

  throw new Error(`未找到打包后的 backend 资源目录。已检查：${candidates.join('；')}`)
}

function ensureBackendRuntimeRoot() {
  if (!app.isPackaged) {
    return path.join(devProjectRoot, 'src')
  }

  const packagedBackendRoot = resolvePackagedBackendResourceRoot()
  const runtimeBackendRoot = path.join(app.getPath('userData'), 'backend-runtime')
  const markerPath = path.join(runtimeBackendRoot, '.runtime-version.json')
  const expectedMarker = JSON.stringify(
    {
      appVersion: app.getVersion(),
      packagedBackendRoot,
    },
    null,
    2,
  )

  let shouldSync = true
  try {
    shouldSync = fs.readFileSync(markerPath, 'utf-8') !== expectedMarker
  } catch {
    shouldSync = true
  }

  if (shouldSync) {
    fs.rmSync(runtimeBackendRoot, { recursive: true, force: true })
    copyDirectoryRecursive(packagedBackendRoot, runtimeBackendRoot)
    fs.writeFileSync(markerPath, expectedMarker, 'utf-8')
    appendRuntimeLog(`backend runtime synced from ${packagedBackendRoot} -> ${runtimeBackendRoot}`)
  }

  return runtimeBackendRoot
}

function resolveBackendScriptPath(scriptName: 'main.py' | 'distiller.py') {
  const backendRoot = ensureBackendRuntimeRoot()
  const scriptPath = path.join(backendRoot, scriptName)

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`后端脚本不存在：${scriptPath}`)
  }

  return scriptPath
}

function findExecutableOnPath(names: string[]) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const pathExts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : ['']

  for (const entry of pathEntries) {
    for (const name of names) {
      const direct = path.join(entry, name)
      if (fs.existsSync(direct)) return direct
      for (const ext of pathExts) {
        const candidate = path.join(entry, name.endsWith(ext.toLowerCase()) ? name : `${name}${ext.toLowerCase()}`)
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }

  return null
}

function resolvePythonCommand() {
  if (process.platform !== 'win32') {
    return { command: findExecutableOnPath(['python3', 'python']) || 'python3', prefixArgs: [] as string[] }
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
  const commonCandidates = [
    findExecutableOnPath(['python.exe', 'python']),
    path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python310', 'python.exe'),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
   .filter((value) => fs.existsSync(value))

  if (commonCandidates[0]) {
    return { command: commonCandidates[0], prefixArgs: [] as string[] }
  }

  const pyLauncher = findExecutableOnPath(['py.exe', 'py'])
  if (pyLauncher) {
    return { command: pyLauncher, prefixArgs: ['-3'] }
  }

  return { command: 'python', prefixArgs: [] as string[] }
}

async function fetchSettingsStatus(settings: RuntimeSettings = loadSettings()): Promise<SettingsStatus> {
  const bilibili = {
    configured: Boolean(settings.sessdata.trim()),
    valid: false,
    accountName: '',
    accountId: '',
    message: '未配置 SESSDATA',
  }

  if (bilibili.configured) {
    try {
      const cookieValue = sanitizeSecret(settings.sessdata)
      if (!cookieValue) {
        bilibili.message = 'SESSDATA 格式无效'
      } else {
        const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          headers: {
            Cookie: `SESSDATA=${cookieValue}`,
            Referer: 'https://www.bilibili.com',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        })
        const payload = await response.json()
        const data = payload?.data ?? {}
        if (payload?.code === 0 && data?.isLogin) {
          bilibili.valid = true
          bilibili.accountName = String(data.uname ?? '')
          bilibili.accountId = String(data.mid ?? '')
          bilibili.message = bilibili.accountName
            ? `已登录 ${bilibili.accountName}`
            : '已登录'
        } else {
          bilibili.message = '登录状态无效'
        }
      }
    } catch {
      bilibili.message = '登录状态检测失败'
    }
  }

  return { bilibili }
}

function buildPythonEnv(settings: RuntimeSettings, extraEnv: NodeJS.ProcessEnv = {}) {
  const resourceMode = sanitizeResourceMode(settings.resource_mode)
  const configuredLocalDevice = settings.local_transcription_device || 'cuda:0'
  const localTranscriptionDevice =
    resourceMode === 'background' && configuredLocalDevice.toLowerCase().startsWith('cuda')
      ? 'cpu'
      : configuredLocalDevice
  const resourceProfile: Record<string, string> =
    resourceMode === 'background'
      ? {
          ONBOARD_RESOURCE_MODE: 'background',
          ONBOARD_BACKGROUND_MODE: '1',
          ONBOARD_AUDIO_PREPARE_WORKERS: '1',
          ONBOARD_AUDIO_TRANSCRIBE_WORKERS: '1',
          ONBOARD_AUDIO_CHUNK_WORKERS: '1',
          ONBOARD_LOCAL_AUDIO_TRANSCRIBE_WORKERS: '1',
          ONBOARD_LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS: '120',
          ONBOARD_AUDIO_MAX_CHUNK_SECONDS: '300',
        }
      : resourceMode === 'fast'
        ? {
            ONBOARD_RESOURCE_MODE: 'fast',
            ONBOARD_BACKGROUND_MODE: '0',
            ONBOARD_AUDIO_PREPARE_WORKERS: '3',
            ONBOARD_AUDIO_TRANSCRIBE_WORKERS: '4',
            ONBOARD_AUDIO_CHUNK_WORKERS: '4',
            ONBOARD_LOCAL_AUDIO_TRANSCRIBE_WORKERS: '1',
            ONBOARD_LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS: '300',
            ONBOARD_AUDIO_MAX_CHUNK_SECONDS: '480',
          }
        : {
            ONBOARD_RESOURCE_MODE: 'balanced',
            ONBOARD_BACKGROUND_MODE: '0',
            ONBOARD_AUDIO_PREPARE_WORKERS: '2',
            ONBOARD_AUDIO_TRANSCRIBE_WORKERS: '3',
            ONBOARD_AUDIO_CHUNK_WORKERS: '3',
            ONBOARD_LOCAL_AUDIO_TRANSCRIBE_WORKERS: '1',
            ONBOARD_LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS: '240',
            ONBOARD_AUDIO_MAX_CHUNK_SECONDS: '480',
          }

  return {
    ...process.env,
    ...resourceProfile,
    ...extraEnv,
    SHIJIE_FOCUS_HOME: dataRoot,
    SHIJIE_FOCUS_SETTINGS_PATH: settingsPath,
    SHIJIE_FOCUS_OUTPUT_DIR: settings.output_dir,
    BILIBILI_SESSDATA: settings.sessdata,
    ONBOARD_TRANSCRIPTION_PROVIDER: settings.transcription_provider,
    ONBOARD_LOCAL_TRANSCRIPTION_ROOT: settings.local_transcription_root,
    ONBOARD_LOCAL_TRANSCRIPTION_PYTHON: settings.local_transcription_python,
    ONBOARD_LOCAL_TRANSCRIPTION_MODEL_ID: settings.local_transcription_model_id,
    ONBOARD_LOCAL_TRANSCRIPTION_DEVICE: localTranscriptionDevice,
    ONBOARD_LOCAL_TRANSCRIPTION_LANGUAGE: settings.local_transcription_language,
    ONBOARD_RESOURCE_MODE: resourceMode,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
  }
}

function sanitizeFileNameSegment(value: string, fallback = '未命名') {
  const normalized = String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function sanitizeWikiSegment(value: string, fallback = '未命名') {
  const normalized = String(value ?? '')
    .replace(/[\[\]\|#^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function stripStagePrefix(title: string) {
  return title
    .replace(/^(?:学习)?阶段\s*\d+\s*[·\-:：]\s*/u, '')
    .replace(/^阶段\s*\d+\s*/u, '')
    .trim()
}

function stripObsidianTitleNoise(title: string) {
  return title
    .replace(/^[0０]*\d{1,3}\s*[._\-、:：]+\s*/u, '')
    .replace(/^[0０]*\d{1,3}\s+/u, '')
    .replace(/^第\s*[一二三四五六七八九十百千万\d]+\s*(?:站|章|节|课|讲)\s*[·\-:：]?\s*/u, '')
    .replace(/^[（(]?[一二三四五六七八九十百千万\d]+[）)]?[、.．]\s*/u, '')
    .replace(/\s*[（(]\s*\d+\s*分\s*[）)]\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildObsidianNodeTitle(rawTitle: string, parentTitle: string | null) {
  const cleanedRawTitle = sanitizeDisplayText(rawTitle, '未命名节点')
  const normalizedTitle = stripObsidianTitleNoise(stripStagePrefix(cleanedRawTitle) || cleanedRawTitle) || cleanedRawTitle
  const normalizedParent = parentTitle
    ? stripObsidianTitleNoise(stripStagePrefix(sanitizeDisplayText(parentTitle, '未命名主线')))
    : null

  const genericLeafTitles = new Set([
    '定义',
    '概念',
    '示例',
    '例子',
    '流程',
    '方法',
    '用法',
    '作用',
    '总结',
    '特点',
    '检查',
    '判断',
    '操作',
  ])

  if (normalizedParent && (genericLeafTitles.has(normalizedTitle) || normalizedTitle.length <= 3)) {
    return `${normalizedParent} · ${normalizedTitle}`
  }

  return normalizedTitle
}

function escapeYamlString(value: string) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function renderYamlList(items: string[], indent = 0) {
  const prefix = ' '.repeat(indent)
  if (!items.length) return `${prefix}[]`
  return items.map((item) => `${prefix}- ${escapeYamlString(item)}`).join('\n')
}

function renderBulletList(items: string[]) {
  if (!items.length) return '- 暂无'
  return items.map((item) => `- ${item}`).join('\n')
}

function renderWikiList(items: Array<{ target: string; label: string }>) {
  if (!items.length) return '- 暂无'
  return items.map((item) => `- [[${item.target}|${item.label}]]`).join('\n')
}


function normalizeMarkdownNewlines(value: string) {
  return value.replace(/\r\n/g, '\n')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractMarkdownSection(markdown: string, heading: string) {
  const normalized = normalizeMarkdownNewlines(markdown)
  const pattern = new RegExp(`(^## ${escapeRegExp(heading)}\\n)([\\s\\S]*?)(?=^## |\\Z)`, 'm')
  const match = normalized.match(pattern)
  if (!match) return ''
  return match[2].replace(/^\n+/, '').replace(/\n+$/, '').trim()
}

function renderMarkdownSection(title: string, fallbackContent: string, existingMarkdown = '') {
  const preserved = existingMarkdown ? extractMarkdownSection(existingMarkdown, title) : ''
  const content = preserved || fallbackContent
  return [`## ${title}`, '', content, '']
}

function indentCalloutBody(content: string) {
  const normalized = normalizeMarkdownNewlines(content).trim()
  if (!normalized) return '> 暂无'
  return normalized.split('\n').map((line) => `> ${line}`).join('\n')
}

function renderObsidianCallout(type: string, title: string, content: string, options: { folded?: boolean } = {}) {
  const marker = options.folded ? `[!${type}]-` : `[!${type}]`
  return [`> ${marker} ${title}`, indentCalloutBody(content)].join('\n')
}

function renderObsidianCalloutList(type: string, title: string, items: string[]) {
  return renderObsidianCallout(type, title, items.length ? renderBulletList(items) : '- 暂无')
}

function normalizeCalloutHeading(value: string) {
  return value
    .replace(/^[\p{Extended_Pictographic}\u2600-\u27BF]\s*/u, '')
    .replace(/[：:]\s*$/, '')
    .trim()
}

function resolveTeachingSectionCallout(heading: string): { type: string; folded?: boolean } | null {
  const normalized = normalizeCalloutHeading(heading)
  if (/这一关要学会什么|学习目标|目标|要学会什么/u.test(normalized)) return { type: 'abstract' }
  if (/核心概念|基础概念|概念|定义|是什么/u.test(normalized)) return { type: 'abstract' }
  if (/前置条件|准备|依赖|环境|基础要求/u.test(normalized)) return { type: 'info' }
  if (/配置步骤|标准操作步骤|操作步骤|步骤|流程|怎么做|如何做/u.test(normalized)) return { type: 'todo' }
  if (/验证|排错|检查|自查|评分点|验收/u.test(normalized)) return { type: 'example' }
  if (/为什么|原理|机制|逻辑|重要性|每一步为什么重要/u.test(normalized)) return { type: 'info' }
  if (/例子|示例|案例|场景|演示/u.test(normalized)) return { type: 'example' }
  if (/注意|错误|误区|陷阱|红线|风险/u.test(normalized)) return { type: 'warning' }
  if (/一句话记忆|记忆|口诀|总结/u.test(normalized)) return { type: 'quote' }
  return null
}

function enhanceTeachingMarkdownForObsidian(markdown: string) {
  const normalized = normalizeMarkdownNewlines(markdown).trim()
  if (!normalized) return ''

  const lines = normalized.split('\n')
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const headingMatch = lines[index].match(/^(#{2,4})\s+(.+?)\s*$/)
    if (!headingMatch) {
      output.push(lines[index])
      index += 1
      continue
    }

    const level = headingMatch[1].length
    const heading = headingMatch[2].trim()
    const callout = resolveTeachingSectionCallout(heading)
    if (!callout) {
      output.push(lines[index])
      index += 1
      continue
    }

    index += 1
    const sectionLines: string[] = []
    while (index < lines.length) {
      const nextHeading = lines[index].match(/^(#{2,4})\s+(.+?)\s*$/)
      if (nextHeading && nextHeading[1].length <= level) break
      sectionLines.push(lines[index])
      index += 1
    }

    const sectionBody = sectionLines.join('\n').trim()
    if (!sectionBody) {
      output.push(`${headingMatch[1]} ${heading}`)
      continue
    }

    output.push('', renderObsidianCallout(callout.type, normalizeCalloutHeading(heading), sectionBody, { folded: callout.folded }), '')
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function ensureObsidianCourseSnippet(vaultPath: string) {
  const snippetsDir = path.join(vaultPath, '.obsidian', 'snippets')
  fs.mkdirSync(snippetsDir, { recursive: true })
  const snippetPath = path.join(snippetsDir, 'shijie-focus-course.css')
  const css = [
    '/* 视界专注学习档案：启用位置 Obsidian 设置 -> 外观 -> CSS snippets -> shijie-focus-course */',
    '.markdown-preview-view.shijie-course-note,',
    '.markdown-preview-view.shijie-course-home,',
    '.markdown-preview-view.shijie-course-board,',
    '.markdown-reading-view .markdown-preview-view.shijie-course-note,',
    '.markdown-reading-view .markdown-preview-view.shijie-course-home,',
    '.markdown-reading-view .markdown-preview-view.shijie-course-board {',
    '  --shijie-accent: 125, 211, 252;',
    '  --shijie-soft-border: rgba(255, 255, 255, 0.10);',
    '}',
    '',
    '.callout[data-callout="goal"] {',
    '  --callout-color: 125, 211, 252;',
    '  --callout-icon: lucide-crosshair;',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note .callout,',
    '.markdown-preview-view.shijie-course-home .callout,',
    '.markdown-preview-view.shijie-course-board .callout {',
    '  border-radius: 14px;',
    '  border: 1px solid var(--shijie-soft-border);',
    '  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.10);',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note .callout-title,',
    '.markdown-preview-view.shijie-course-home .callout-title,',
    '.markdown-preview-view.shijie-course-board .callout-title {',
    '  font-weight: 700;',
    '  letter-spacing: 0.01em;',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note h1,',
    '.markdown-preview-view.shijie-course-home h1,',
    '.markdown-preview-view.shijie-course-board h1 {',
    '  letter-spacing: 0;',
    '  border-bottom: 1px solid rgba(255, 255, 255, 0.08);',
    '  padding-bottom: 0.35em;',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note h2,',
    '.markdown-preview-view.shijie-course-home h2,',
    '.markdown-preview-view.shijie-course-board h2 {',
    '  margin-top: 1.35em;',
    '  letter-spacing: 0;',
    '}',
    '',
    '.markdown-preview-view.shijie-course-note p,',
    '.markdown-preview-view.shijie-course-note li {',
    '  line-height: 1.85;',
    '}',
    '',
  ].join('\n')
  fs.writeFileSync(snippetPath, css, 'utf-8')
  return snippetPath
}

function buildAppDeepLink(packageId: string, nodeId?: string | null) {
  const params = new URLSearchParams()
  params.set('packageId', packageId)
  if (nodeId) params.set('nodeId', nodeId)
  return `${APP_PROTOCOL}://open?${params.toString()}`
}

function flattenCourseNodes(nodes: Record<string, unknown>[], parentId: string | null = null, depth = 0) {
  const result: Array<{
    node: Record<string, unknown>
    parentId: string | null
    depth: number
  }> = []

  for (const node of nodes) {
    result.push({ node, parentId, depth })
    const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : []
    result.push(...flattenCourseNodes(children, String(node.id ?? ''), depth + 1))
  }

  return result
}

type ObsidianReadableLessonMeta = {
  id: string
  title: string
  noteTitle: string
  wikiTarget: string
  filePath: string
  parentId: string | null
  rootTitle: string
  node: Record<string, unknown>
}

function exportCourseToObsidian(settings: RuntimeSettings, payload: ObsidianExportPayload): ObsidianExportResult {
  const vaultPath = settings.obsidian_vault_path
  if (!vaultPath) {
    throw new Error('请先在设置中配置 Obsidian Vault 路径。')
  }
  if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    throw new Error('Obsidian Vault 路径不存在，或不是文件夹。')
  }

  const asText = (value: unknown, fallback = '') => sanitizeDisplayText(String(value ?? ''), fallback)
  const asStringList = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => sanitizeDisplayText(String(item ?? ''))).filter(Boolean)
      : []
  const asRecordList = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      : []
  const getRecord = (value: unknown) => (value && typeof value === 'object' ? value as Record<string, unknown> : {})
  const renderOptionalBullets = (items: string[]) => (items.length ? renderBulletList(items) : '- 暂无')
  const uniqueStrings = (items: string[]) => Array.from(new Set(items.filter(Boolean)))
  const normalizeLessonMarkdown = (markdown: string) => markdown.replace(/^##\s+/gm, '### ')
  const renderReadableAnswer = (markdown: string) => {
    const normalized = normalizeMarkdownNewlines(markdown).trim()
    if (!normalized) return '- 暂无参考回看'
    return normalized
      .split(/(?<=[。！？；;])/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .join('\n\n')
  }
  const getTeacher = (node: Record<string, unknown>) => getRecord(node.teacher_ready_content)
  const getKnowledge = (node: Record<string, unknown>) => getRecord(node.knowledge)

  const course = compactCoursePackagePayload((payload.course ?? {}) as Record<string, unknown>).payload
  const courseMeta = getRecord(course.course)
  const sourceMeta = getRecord(course.source)
  const chapters = asRecordList(course.chapters)
  const packageId = String(course.package_id ?? 'unknown-package')
  const courseTitle = asText(courseMeta.title ?? sourceMeta.title ?? packageId, '未命名学习笔记')
  const exportedAt = new Date().toISOString()
  const exportFolder = sanitizeFileNameSegment(settings.obsidian_export_folder || '视界专注', '视界专注')
  const courseFolder = sanitizeFileNameSegment(courseTitle, packageId)
  const exportWikiFolder = sanitizeWikiSegment(exportFolder, '视界专注')
  const courseWikiFolder = sanitizeWikiSegment(courseFolder, packageId)
  const courseWikiRoot = `${exportWikiFolder}/${courseWikiFolder}`
  const overviewNoteTitle = '学习总览'
  const progressNoteTitle = '学习看板'
  const conceptNoteTitle = '关键概念'
  const mistakeNoteTitle = '常见误区'
  const practiceNoteTitle = '练习与操作'
  const overviewWikiTarget = `${courseWikiRoot}/${overviewNoteTitle}`
  const progressWikiTarget = `${courseWikiRoot}/${progressNoteTitle}`
  const rootDir = path.join(vaultPath, exportFolder, courseFolder)
  const lessonFolderName = '学习笔记'
  const lessonDir = path.join(rootDir, lessonFolderName)
  const snippetPath = ensureObsidianCourseSnippet(vaultPath)
  void snippetPath

  fs.mkdirSync(rootDir, { recursive: true })
  for (const oldFolderName of ['节点', 'Lessons', 'Concepts', 'Mistakes', 'Practices']) {
    fs.rmSync(path.join(rootDir, oldFolderName), { recursive: true, force: true })
  }
  fs.mkdirSync(lessonDir, { recursive: true })

  const flattened = flattenCourseNodes(chapters)
  const parentById = new Map<string, string | null>()
  const rawTitleById = new Map<string, string>()
  flattened.forEach(({ node, parentId }, index) => {
    const nodeId = String(node.id ?? `node-${index + 1}`)
    parentById.set(nodeId, parentId)
    rawTitleById.set(nodeId, asText(node.title ?? nodeId, nodeId))
  })

  const getRootTitle = (nodeId: string) => {
    let cursor: string | null = nodeId
    let rootTitle = rawTitleById.get(nodeId) ?? nodeId
    while (cursor) {
      rootTitle = rawTitleById.get(cursor) ?? rootTitle
      cursor = parentById.get(cursor) ?? null
    }
    return rootTitle
  }

  const leafLessons = flattened.filter(({ node }) => {
    const children = asRecordList(node.children)
    return String(node.node_type ?? '').toLowerCase() === 'lesson' || children.length === 0
  })
  const exportedLessons = leafLessons.length ? leafLessons : flattened
  const usedLessonTitles = new Map<string, number>()
  const lessonMetaById = new Map<string, ObsidianReadableLessonMeta>()
  const lessonOrder: string[] = []

  exportedLessons.forEach(({ node, parentId }, index) => {
    const nodeId = String(node.id ?? `lesson-${index + 1}`)
    const parentTitle = parentId ? rawTitleById.get(parentId) ?? null : null
    const displayTitle = buildObsidianNodeTitle(String(node.title ?? nodeId), parentTitle)
    const baseTitle = sanitizeWikiSegment(displayTitle, nodeId)
    const duplicateCount = (usedLessonTitles.get(baseTitle) ?? 0) + 1
    usedLessonTitles.set(baseTitle, duplicateCount)
    const stableTitle = duplicateCount > 1 ? `${baseTitle}（${duplicateCount}）` : baseTitle
    const noteTitle = `${String(index + 1).padStart(2, '0')} ${stableTitle}`
    const filePath = path.join(lessonDir, `${sanitizeFileNameSegment(noteTitle, nodeId)}.md`)
    lessonOrder.push(nodeId)
    lessonMetaById.set(nodeId, {
      id: nodeId,
      title: stableTitle,
      noteTitle,
      wikiTarget: `${courseWikiRoot}/${lessonFolderName}/${noteTitle}`,
      filePath,
      parentId,
      rootTitle: getRootTitle(nodeId),
      node,
    })
  })

  const conceptEntries: Array<{ lesson: ObsidianReadableLessonMeta; title: string; content: string }> = []
  const mistakeEntries: Array<{ lesson: ObsidianReadableLessonMeta; content: string }> = []
  const practiceEntries: Array<{ lesson: ObsidianReadableLessonMeta; title: string; items: string[] }> = []

  for (const [nodeId, meta] of lessonMetaById.entries()) {
    const node = meta.node
    const teacher = getTeacher(node)
    const knowledge = getKnowledge(node)
    const objectives = asStringList(node.learning_objectives)
    const concepts = asRecordList(knowledge.concepts)
    const checkpoints = asStringList(knowledge.checkpoints)
    const practicalSteps = asStringList(knowledge.practical_steps)
    const practiceTasks = asStringList(knowledge.practice_tasks)
    const teacherKeyPoints = asStringList(teacher.key_points)
    const knowledgeMistakes = asStringList(knowledge.common_mistakes)
    const teacherMistakes = asStringList(teacher.common_mistakes)
    const allMistakes = uniqueStrings([...teacherMistakes, ...knowledgeMistakes])
    const teachingMarkdown = normalizeMarkdownNewlines(String(teacher.teaching_markdown ?? '')).trim()
    const quizQuestion = asText(teacher.quiz_question, '')
    const standardAnswer = normalizeMarkdownNewlines(String(teacher.standard_answer ?? '')).trim()
    const progressState =
      payload.currentNodeId === nodeId
        ? 'current'
        : payload.completedNodeIds.includes(nodeId)
          ? 'completed'
          : 'pending'
    const currentIndex = lessonOrder.indexOf(nodeId)
    const previousMeta = currentIndex > 0 ? lessonMetaById.get(lessonOrder[currentIndex - 1]) ?? null : null
    const nextMeta = currentIndex >= 0 && currentIndex < lessonOrder.length - 1 ? lessonMetaById.get(lessonOrder[currentIndex + 1]) ?? null : null
    const existingMarkdown = fs.existsSync(meta.filePath) ? fs.readFileSync(meta.filePath, 'utf-8') : ''
    const lessonBody = enhanceTeachingMarkdownForObsidian(
      normalizeLessonMarkdown(teachingMarkdown || String(node.summary ?? '暂无学习笔记正文。')),
    )

    for (const concept of concepts) {
      const title = asText(concept.name, '')
      const content = asText(concept.explanation, '')
      if (title || content) {
        conceptEntries.push({ lesson: meta, title: title || meta.title, content: content || String(node.summary ?? '') })
      }
    }
    for (const mistake of allMistakes) {
      mistakeEntries.push({ lesson: meta, content: mistake })
    }
    if (practicalSteps.length) {
      practiceEntries.push({ lesson: meta, title: '操作步骤', items: practicalSteps })
    }
    if (practiceTasks.length) {
      practiceEntries.push({ lesson: meta, title: '练习任务', items: practiceTasks })
    }
    if (checkpoints.length) {
      practiceEntries.push({ lesson: meta, title: '过关检查', items: checkpoints })
    }

    const markdown = [
      '---',
      `title: ${escapeYamlString(meta.title)}`,
      'aliases:',
      renderYamlList(uniqueStrings([meta.title, String(node.title ?? meta.title)]), 2),
      `package_id: ${escapeYamlString(packageId)}`,
      `course_title: ${escapeYamlString(courseTitle)}`,
      `node_id: ${escapeYamlString(nodeId)}`,
      `progress_state: ${escapeYamlString(progressState)}`,
      `chapter: ${escapeYamlString(meta.rootTitle)}`,
      `exported_at: ${escapeYamlString(exportedAt)}`,
      'cssclasses:',
      renderYamlList(['shijie-course-note'], 2),
      'tags:',
      renderYamlList(['视界专注', '学习笔记'], 2),
      '---',
      '',
      `# ${meta.title}`,
      '',
      `> [回到视界专注](${buildAppDeepLink(packageId, nodeId)}) · [[${overviewWikiTarget}|学习总览]] · [[${progressWikiTarget}|学习看板]]`,
      ...(previousMeta ? [`> 上一节：[[${previousMeta.wikiTarget}|${previousMeta.title}]]`] : []),
      ...(nextMeta ? [`> 下一节：[[${nextMeta.wikiTarget}|${nextMeta.title}]]`] : []),
      '',
      renderObsidianCallout('info', '学习导航', [
        `- 章节：${meta.rootTitle}`,
        `- 状态：${progressState === 'current' ? '正在学习' : progressState === 'completed' ? '已完成' : '待学习'}`,
        previousMeta ? `- 上一节：[[${previousMeta.wikiTarget}|${previousMeta.title}]]` : '',
        nextMeta ? `- 下一节：[[${nextMeta.wikiTarget}|${nextMeta.title}]]` : '',
      ].filter(Boolean).join('\n')),
      '',
      '## 学习笔记',
      '',
      lessonBody,
      '',
      renderObsidianCallout('question', '主动回忆', quizQuestion || '用自己的话复述这一节的主线。先别看参考回看。'),
      '',
      renderObsidianCallout('success', '参考回看', renderReadableAnswer(standardAnswer), { folded: true }),
      '',
      renderObsidianCalloutList('tip', '关键点', teacherKeyPoints.length ? teacherKeyPoints : objectives),
      '',
      renderObsidianCalloutList('warning', '常见误区', allMistakes),
      '',
      '## 我的笔记',
      '',
      extractMarkdownSection(existingMarkdown, '我的笔记') || '- ',
      '',
    ]
      .join('\n')

    fs.writeFileSync(meta.filePath, markdown, 'utf-8')
  }

  const lessonsByChapter = new Map<string, ObsidianReadableLessonMeta[]>()
  for (const nodeId of lessonOrder) {
    const meta = lessonMetaById.get(nodeId)
    if (!meta) continue
    const current = lessonsByChapter.get(meta.rootTitle) ?? []
    current.push(meta)
    lessonsByChapter.set(meta.rootTitle, current)
  }

  const renderLessonMap = () => Array.from(lessonsByChapter.entries())
    .map(([chapterTitle, lessons]) => [
      `## ${chapterTitle}`,
      '',
      ...lessons.map((lesson) => `- [[${lesson.wikiTarget}|${lesson.title}]]`),
      '',
    ].join('\n'))
    .join('\n')

  const writeAggregateNote = (fileName: string, title: string, body: string) => {
    const filePath = path.join(rootDir, `${fileName}.md`)
    const markdown = [
      '---',
      `title: ${escapeYamlString(title)}`,
      `package_id: ${escapeYamlString(packageId)}`,
      `course_title: ${escapeYamlString(courseTitle)}`,
      `exported_at: ${escapeYamlString(exportedAt)}`,
      'cssclasses:',
      renderYamlList(['shijie-course-note'], 2),
      'tags:',
      renderYamlList(['视界专注', '学习索引'], 2),
      '---',
      '',
      `# ${title}`,
      '',
      `> [[${overviewWikiTarget}|学习总览]]`,
      '',
      body || '- 暂无',
      '',
    ].join('\n')
    fs.writeFileSync(filePath, markdown, 'utf-8')
    return filePath
  }

  const conceptBody = conceptEntries.length
    ? conceptEntries.map((entry) => [
        `## ${entry.title}`,
        '',
        `来源：[[${entry.lesson.wikiTarget}|${entry.lesson.title}]]`,
        '',
        entry.content || '- 暂无说明',
      ].join('\n')).join('\n\n')
    : '- 暂无关键概念'
  const mistakeBody = mistakeEntries.length
    ? Array.from(lessonsByChapter.values()).flat()
        .map((lesson) => {
          const items = mistakeEntries.filter((entry) => entry.lesson.id === lesson.id)
          if (!items.length) return ''
          return [`## [[${lesson.wikiTarget}|${lesson.title}]]`, '', ...items.map((item) => `- ${item.content}`)].join('\n')
        })
        .filter(Boolean)
        .join('\n\n')
    : '- 暂无常见误区'
  const practiceBody = practiceEntries.length
    ? practiceEntries.map((entry) => [
        `## [[${entry.lesson.wikiTarget}|${entry.lesson.title}]] · ${entry.title}`,
        '',
        renderBulletList(entry.items),
      ].join('\n')).join('\n\n')
    : '- 暂无练习或操作整理'

  const conceptPath = writeAggregateNote(conceptNoteTitle, `${courseTitle} · 关键概念`, conceptBody)
  const mistakePath = writeAggregateNote(mistakeNoteTitle, `${courseTitle} · 常见误区`, mistakeBody)
  const practicePath = writeAggregateNote(practiceNoteTitle, `${courseTitle} · 练习与操作`, practiceBody)
  void conceptPath
  void mistakePath
  void practicePath

  const currentMeta = payload.currentNodeId ? lessonMetaById.get(payload.currentNodeId) ?? null : null
  const completedLinks = payload.completedNodeIds
    .map((nodeId) => lessonMetaById.get(nodeId))
    .filter(Boolean)
    .map((item) => `- [[${item!.wikiTarget}|${item!.title}]]`)
  const pendingLinks = lessonOrder
    .filter((nodeId) => !payload.completedNodeIds.includes(nodeId))
    .slice(0, 10)
    .map((nodeId) => lessonMetaById.get(nodeId))
    .filter(Boolean)
    .map((item) => `- [[${item!.wikiTarget}|${item!.title}]]`)

  const overviewContent = [
    '---',
    `title: ${escapeYamlString(courseTitle)}`,
    'aliases:',
    renderYamlList([courseTitle, `${courseTitle} 学习总览`], 2),
    `package_id: ${escapeYamlString(packageId)}`,
    `source_id: ${escapeYamlString(String(sourceMeta.source_id ?? ''))}`,
    `source_url: ${escapeYamlString(String(sourceMeta.url ?? ''))}`,
    `exported_at: ${escapeYamlString(exportedAt)}`,
    'cssclasses:',
    renderYamlList(['shijie-course-home'], 2),
    'tags:',
    renderYamlList(['视界专注', '学习总览'], 2),
    '---',
    '',
    `# ${courseTitle}`,
    '',
    `> [回到视界专注](${buildAppDeepLink(packageId)}) · [[${progressWikiTarget}|学习看板]]`,
    '',
    renderObsidianCallout('abstract', '学习定位', String(courseMeta.subtitle ?? '') || '暂无学习简介'),
    '',
    renderObsidianCallout('goal', '学习目标', String(courseMeta.overall_goal ?? '暂无总目标')),
    '',
    '## 学习索引',
    '',
    `- [[${courseWikiRoot}/${conceptNoteTitle}|关键概念]]`,
    `- [[${courseWikiRoot}/${mistakeNoteTitle}|常见误区]]`,
    `- [[${courseWikiRoot}/${practiceNoteTitle}|练习与操作]]`,
    '',
    renderObsidianCalloutList('tip', '学习结果', asStringList(courseMeta.learning_outcomes)),
    '',
    '## 学习目录',
    '',
    renderLessonMap() || '- 暂无学习目录',
  ]
    .join('\n')

  const indexPath = path.join(rootDir, `${overviewNoteTitle}.md`)
  fs.writeFileSync(indexPath, overviewContent, 'utf-8')

  const progressPath = path.join(rootDir, `${progressNoteTitle}.md`)
  const existingProgressBoard = fs.existsSync(progressPath) ? fs.readFileSync(progressPath, 'utf-8') : ''
  const progressBoardContent = [
    '---',
    `title: ${escapeYamlString(`${courseTitle} 学习看板`)}`,
    `package_id: ${escapeYamlString(packageId)}`,
    `course_title: ${escapeYamlString(courseTitle)}`,
    `exported_at: ${escapeYamlString(exportedAt)}`,
    'cssclasses:',
    renderYamlList(['shijie-course-board'], 2),
    'tags:',
    renderYamlList(['视界专注', '学习看板'], 2),
    '---',
    '',
    `# ${courseTitle} 学习看板`,
    '',
    `> [回到视界专注](${buildAppDeepLink(packageId)}) · [[${overviewWikiTarget}|学习总览]]`,
    '',
    renderObsidianCallout('info', '当前状态', [
      `- 当前小节：${currentMeta ? `[[${currentMeta.wikiTarget}|${currentMeta.title}]]` : '暂无'}`,
      `- 已完成：${payload.completedNodeIds.length} / ${lessonMetaById.size}`,
    ].join('\n')),
    '',
    '## 已完成',
    '',
    completedLinks.length ? completedLinks.join('\n') : '- 还没有完成的小节',
    '',
    '## 接下来可以学',
    '',
    pendingLinks.length ? pendingLinks.join('\n') : '- 所有小节都已经完成',
    '',
    '## 今日学习记录',
    '',
    extractMarkdownSection(existingProgressBoard, '今日学习记录') || ['- 今天我最清楚的一点：', '- 今天我最模糊的一点：', '- 下一次打开时，我想先继续哪一节：'].join('\n'),
    '',
  ]
    .join('\n')

  fs.writeFileSync(progressPath, progressBoardContent, 'utf-8')

  const legacyOverviewPath = path.join(rootDir, '00 学习总览.md')
  const legacyProgressPath = path.join(rootDir, '01 学习看板.md')
  if (fs.existsSync(legacyOverviewPath)) fs.unlinkSync(legacyOverviewPath)
  if (fs.existsSync(legacyProgressPath)) fs.unlinkSync(legacyProgressPath)

  return {
    vaultPath,
    rootDir,
    indexPath,
    progressPath,
    currentNodePath: currentMeta?.filePath ?? null,
    fileCount: lessonMetaById.size + 5,
  }
}

async function openObsidianTarget(
  settings: RuntimeSettings,
  payload: ObsidianExportPayload & { target?: 'current' | 'board' | 'index' },
): Promise<ObsidianOpenResult> {
  const exportResult = exportCourseToObsidian(settings, payload)
  const targetPath =
    payload.target === 'index'
      ? exportResult.indexPath
      : payload.target === 'board'
        ? exportResult.progressPath
        : exportResult.currentNodePath || exportResult.progressPath

  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error('未能定位需要打开的 Obsidian 笔记。')
  }

  const relativePath = path.relative(exportResult.vaultPath, targetPath).replace(/\\/g, '/')
  const vaultName = path.basename(exportResult.vaultPath)
  const openedUri =
    vaultName && relativePath
      ? `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relativePath)}`
      : null

  if (openedUri) {
    try {
      await shell.openExternal(openedUri)
      return {
        ...exportResult,
        openedPath: targetPath,
        openedUri,
        openedVia: 'obsidian-uri',
      }
    } catch {
      // Fall through to local file open below.
    }
  }

  const openPathError = await shell.openPath(targetPath)
  if (openPathError) {
    throw new Error(openPathError)
  }
  return {
    ...exportResult,
    openedPath: targetPath,
    openedUri,
    openedVia: 'file-path',
  }
}

function stripMarkdownForSpeech(text: string) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<u>([^<]+)<\/u>/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[★☆◆◇■□●○◎※→←↑↓]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function estimateMiniMaxSpeechCharacters(text: string) {
  const speechText = stripMarkdownForSpeech(text)
  let total = 0
  for (const char of Array.from(speechText)) {
    total += /\p{Script=Han}/u.test(char) ? 2 : 1
  }
  return total
}

const MINIMAX_TTS_LOCAL_DAILY_LIMIT = 4000
const DEFAULT_TTS_CACHE_EXTENSION = 'mp3'

function resolveTtsCacheDir() {
  return path.join(dataRoot, '.onboard-tts-cache')
}

function resolveTtsUsagePath() {
  return path.join(userDataRoot, '.shijie-focus-tts-usage.json')
}

function getLocalDateKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeTtsUsage(raw: unknown): TtsUsageSnapshot {
  const currentDate = getLocalDateKey()
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const date = typeof record.date === 'string' ? record.date : currentDate
  const sameDay = date === currentDate
  const usedCharacters = sameDay ? Math.max(0, Math.round(Number(record.usedCharacters) || 0)) : 0
  const dailyLimit = Math.max(1, Math.round(Number(record.dailyLimit) || MINIMAX_TTS_LOCAL_DAILY_LIMIT))

  return {
    date: currentDate,
    usedCharacters,
    dailyLimit,
    remainingCharacters: Math.max(0, dailyLimit - usedCharacters),
    note: '本地估算：只统计本机今天新合成成功的字符，缓存命中不计入。',
  }
}

function readTtsUsage(): TtsUsageSnapshot {
  try {
    const usagePath = resolveTtsUsagePath()
    if (!fs.existsSync(usagePath)) return normalizeTtsUsage(null)
    return normalizeTtsUsage(JSON.parse(fs.readFileSync(usagePath, 'utf-8')))
  } catch {
    return normalizeTtsUsage(null)
  }
}

function writeTtsUsage(snapshot: TtsUsageSnapshot) {
  try {
    fs.mkdirSync(path.dirname(resolveTtsUsagePath()), { recursive: true })
    fs.writeFileSync(resolveTtsUsagePath(), JSON.stringify(snapshot, null, 2), 'utf-8')
  } catch {
    // Usage tracking is helpful but should never block speech synthesis.
  }
}

function recordTtsUsage(characters: number) {
  const current = readTtsUsage()
  const nextUsed = current.usedCharacters + Math.max(0, Math.round(characters))
  const next: TtsUsageSnapshot = {
    ...current,
    usedCharacters: nextUsed,
    remainingCharacters: Math.max(0, current.dailyLimit - nextUsed),
  }
  writeTtsUsage(next)
  return next
}

function getTtsProviderLabel(settings: RuntimeSettings) {
  if (settings.tts_provider === 'mimo') return 'MiMo'
  if (settings.tts_provider === 'minimax') return 'MiniMax'
  return 'TTS'
}

function getTtsModel(settings: RuntimeSettings) {
  return settings.tts_provider === 'mimo' ? settings.mimo_tts_model : settings.minimax_tts_model
}

function getTtsVoiceId(settings: RuntimeSettings) {
  return settings.tts_provider === 'mimo' ? settings.mimo_tts_voice_id : settings.minimax_tts_voice_id
}

function getTtsAudioExtension(settings: RuntimeSettings) {
  return settings.tts_provider === 'mimo' ? 'wav' : DEFAULT_TTS_CACHE_EXTENSION
}

function getTtsAudioMime(settings: RuntimeSettings) {
  return settings.tts_provider === 'mimo' ? 'audio/wav' : 'audio/mpeg'
}

function toTtsDataUrl(buffer: Buffer, mime: string) {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

function buildTtsCacheEntries(settings: RuntimeSettings, text: string) {
  const chunks = splitSpeechText(text)
  const extension = getTtsAudioExtension(settings)
  const cacheDir = resolveTtsCacheDir()

  if (chunks.length === 1) {
    const cacheKey = buildTtsCacheKey(settings, text)
    return [{
      text,
      filePath: path.join(cacheDir, `${cacheKey}.${extension}`),
    }]
  }

  return chunks.map((chunk, index) => {
    const chunkKey = buildTtsCacheKey(settings, [
      `chunk:${index + 1}/${chunks.length}`,
      chunk,
    ].join('\n'))
    return {
      text: chunk,
      filePath: path.join(cacheDir, `${chunkKey}.${extension}`),
    }
  })
}

function formatTtsUsageLine(settings: RuntimeSettings, usage: TtsUsageSnapshot, requestedCharacters: number) {
  if (settings.tts_provider === 'mimo') {
    return 'MiMo TTS 当前按官方说明为限时免费；本机只记录缓存状态，缓存命中不重复调用。'
  }
  return `本节预计 ${requestedCharacters} MiniMax 字符；今日本地已新合成 ${usage.usedCharacters}/${usage.dailyLimit}，估算剩余 ${usage.remainingCharacters}。缓存命中不消耗额度。`
}

function buildTtsCacheKey(settings: RuntimeSettings, text: string) {
  const providerSettings = settings.tts_provider === 'mimo'
    ? {
        provider: settings.tts_provider,
        requestVersion: 'mimo-direct-speech-v4',
        endpoint: settings.mimo_tts_endpoint,
        model: settings.mimo_tts_model,
        voiceId: settings.mimo_tts_voice_id,
        stylePrompt: settings.mimo_tts_style_prompt,
      }
    : {
        provider: settings.tts_provider,
        endpoint: settings.minimax_tts_endpoint,
        model: settings.minimax_tts_model,
        voiceId: settings.minimax_tts_voice_id,
        speed: settings.minimax_tts_speed,
        volume: settings.minimax_tts_volume,
        pitch: settings.minimax_tts_pitch,
      }
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      ...providerSettings,
      text,
    }))
    .digest('hex')
}

function splitSpeechText(text: string, limit = 9000) {
  if (estimateMiniMaxSpeechCharacters(text) <= limit) return [text]
  const chunks: string[] = []
  let buffer = ''
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const pushBuffer = () => {
    const value = buffer.trim()
    if (value) chunks.push(value)
    buffer = ''
  }

  for (const paragraph of paragraphs) {
    if (estimateMiniMaxSpeechCharacters(paragraph) > limit) {
      pushBuffer()
      const sentences = paragraph
        .split(/(?<=[。！？；;.!?])/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean)
      for (const sentence of sentences.length ? sentences : [paragraph]) {
        if (estimateMiniMaxSpeechCharacters((buffer + '\n' + sentence).trim()) > limit) pushBuffer()
        if (estimateMiniMaxSpeechCharacters(sentence) > limit) {
          let slice = ''
          for (const char of Array.from(sentence)) {
            if (estimateMiniMaxSpeechCharacters(slice + char) > limit) {
              if (slice.trim()) chunks.push(slice.trim())
              slice = ''
            }
            slice += char
          }
          if (slice.trim()) chunks.push(slice.trim())
        } else {
          buffer = buffer ? `${buffer}\n${sentence}` : sentence
        }
      }
      continue
    }

    if (estimateMiniMaxSpeechCharacters((buffer + '\n\n' + paragraph).trim()) > limit) pushBuffer()
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
  }

  pushBuffer()
  return chunks
}

async function requestMiniMaxSpeechAudio(settings: RuntimeSettings, text: string) {
  const response = await fetch(settings.minimax_tts_endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.minimax_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.minimax_tts_model,
      text,
      stream: false,
      language_boost: 'Chinese',
      output_format: 'hex',
      voice_setting: {
        voice_id: settings.minimax_tts_voice_id,
        speed: settings.minimax_tts_speed,
        vol: settings.minimax_tts_volume,
        pitch: settings.minimax_tts_pitch,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`MiniMax TTS 请求失败：${response.status} ${response.statusText}`)
  }

  const result = await response.json() as {
    data?: { audio?: string; status?: number } | null
    base_resp?: { status_code?: number; status_msg?: string }
  }
  if (result.base_resp?.status_code && result.base_resp.status_code !== 0) {
    throw new Error(formatMiniMaxTtsError(result.base_resp.status_code, result.base_resp.status_msg))
  }
  const audioHex = result.data?.audio
  if (!audioHex) {
    throw new Error('MiniMax TTS 未返回音频数据。')
  }
  return Buffer.from(audioHex, 'hex')
}

async function requestMiMoSpeechAudio(settings: RuntimeSettings, text: string) {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    {
      role: 'user',
      content: '请把 assistant 消息中的文本转换成中文口播音频，只朗读原文，不要朗读任何配置、标签、说明或额外内容。',
    },
    {
      role: 'assistant',
      content: text,
    },
  ]

  const response = await fetch(resolveMiMoTtsEndpoint(settings), {
    method: 'POST',
    headers: buildMiMoTtsHeaders(settings),
    body: JSON.stringify({
      model: settings.mimo_tts_model,
      messages,
      audio: {
        format: 'wav',
        voice: settings.mimo_tts_voice_id || '茉莉',
      },
    }),
  })

  const responseText = await response.text()
  let result: {
    error?: { message?: string; code?: string | number }
    choices?: Array<{
      message?: {
        audio?: {
          data?: string
        }
      }
    }>
  } = {}

  try {
    result = responseText ? JSON.parse(responseText) : {}
  } catch {
    result = {}
  }

  if (!response.ok) {
    const rawMessage = result.error?.message || responseText || `${response.status} ${response.statusText}`
    throw new Error(formatMiMoTtsError(`HTTP ${response.status}：${rawMessage}`))
  }

  if (result.error) {
    throw new Error(formatMiMoTtsError(result.error.message || `MiMo TTS 返回错误：${result.error.code ?? 'unknown'}`))
  }
  const audioBase64 = result.choices?.[0]?.message?.audio?.data
  if (!audioBase64) {
    throw new Error('MiMo TTS 未返回音频数据。')
  }
  return Buffer.from(audioBase64, 'base64')
}

function resolveMiMoTtsEndpoint(settings: RuntimeSettings) {
  const apiKey = settings.mimo_api_key.trim()
  const isTokenPlan = apiKey.startsWith('tp-')
  const defaultPayAsYouGoEndpoint = 'https://api.xiaomimimo.com/v1/chat/completions'
  const defaultTokenPlanEndpoint = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
  let endpoint = settings.mimo_tts_endpoint.trim() || (isTokenPlan ? defaultTokenPlanEndpoint : defaultPayAsYouGoEndpoint)

  if (isTokenPlan && endpoint.includes('api.xiaomimimo.com')) {
    endpoint = defaultTokenPlanEndpoint
  }

  endpoint = endpoint.replace(/\/+$/, '')
  if (/\/anthropic$/i.test(endpoint)) {
    endpoint = endpoint.replace(/\/anthropic$/i, '/v1/chat/completions')
  }
  if (/\/v1$/i.test(endpoint)) {
    return `${endpoint}/chat/completions`
  }
  if (/\/v1\/chat\/completions$/i.test(endpoint)) {
    return endpoint
  }

  try {
    const parsed = new URL(endpoint)
    if (!parsed.pathname || parsed.pathname === '/') {
      return `${parsed.origin}/v1/chat/completions`
    }
  } catch {
    return endpoint
  }

  return endpoint
}

function buildMiMoTtsHeaders(settings: RuntimeSettings) {
  const apiKey = settings.mimo_api_key.trim()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'api-key': apiKey,
  }
}

function formatMiniMaxTtsError(statusCode: number, statusMsg?: string) {
  const message = statusMsg || `MiniMax TTS 返回错误：${statusCode}`
  const lowerMessage = message.toLowerCase()
  if (statusCode === 2049 || lowerMessage.includes('invalid api key')) {
    return 'MiniMax 鉴权失败：当前 API Key 没有被这个接口地址接受。请确认 Key 来自对应的 MiniMax 开放平台，并检查接口地址是国内站 api.minimaxi.com 还是国际站 api.minimax.io。'
  }
  if (statusCode === 2061 || lowerMessage.includes('not support model')) {
    return `MiniMax 当前套餐不支持所选语音模型。请在设置里更换模型，例如 speech-2.8-hd，原始返回：${message}`
  }
  if (
    lowerMessage.includes('quota') ||
    lowerMessage.includes('balance') ||
    lowerMessage.includes('insufficient') ||
    lowerMessage.includes('limit') ||
    message.includes('额度') ||
    message.includes('余额') ||
    message.includes('不足') ||
    message.includes('限制')
  ) {
    return `MiniMax 语音额度可能不足或触发平台限制。原始返回：${message}`
  }
  if (statusCode === 1004 || lowerMessage.includes('authorization')) {
    return 'MiniMax 鉴权失败：请求没有携带有效 API Key。请重新保存 API Key 后再试。'
  }
  return message
}

function formatMiMoTtsError(message: string) {
  const lowerMessage = message.toLowerCase()
  if (lowerMessage.includes('invalid') && lowerMessage.includes('key')) {
    return 'MiMo 鉴权失败：当前 API Key 没有被接口接受。请确认 Key 来自小米 MiMo 开放平台，并重新保存后再试。'
  }
  if (
    lowerMessage.includes('quota') ||
    lowerMessage.includes('balance') ||
    lowerMessage.includes('insufficient') ||
    lowerMessage.includes('limit') ||
    message.includes('额度') ||
    message.includes('余额') ||
    message.includes('不足') ||
    message.includes('限制')
  ) {
    return `MiMo 语音额度可能不足或触发平台限制。原始返回：${message}`
  }
  if (lowerMessage.includes('model')) {
    return `MiMo 当前账号可能不支持所选模型。建议先使用 mimo-v2.5-tts，原始返回：${message}`
  }
  return message
}

function formatTtsFailureMessage(settings: RuntimeSettings, error: unknown, characters: number, usage: TtsUsageSnapshot) {
  const baseMessage = error instanceof Error ? error.message : String(error)
  return `${baseMessage}\n${formatTtsUsageLine(settings, usage, characters)}`
}

function getTtsCacheStatus(settings: RuntimeSettings, payload: TtsSynthesizePayload): TtsCacheStatusResult {
  const text = stripMarkdownForSpeech(payload.text)
  const usage = readTtsUsage()
  if (!text) {
    return {
      cached: false,
      characters: 0,
      filePath: null,
      filePaths: [],
      usage,
    }
  }

  const entries = buildTtsCacheEntries(settings, text)
  const filePaths = entries.map((entry) => entry.filePath)
  const cachedFilePaths = filePaths.filter((filePath) => fs.existsSync(filePath))
  const cached = entries.length > 0 && cachedFilePaths.length === entries.length
  return {
    cached,
    characters: estimateMiniMaxSpeechCharacters(text),
    filePath: cached ? filePaths[0] : null,
    filePaths: cached ? filePaths : cachedFilePaths,
    usage,
  }
}

async function synthesizeSpeech(settings: RuntimeSettings, payload: TtsSynthesizePayload): Promise<TtsSynthesizeResult> {
  if (settings.tts_provider !== 'minimax' && settings.tts_provider !== 'mimo') {
    throw new Error('请先在设置中启用语音朗读。')
  }
  if (settings.tts_provider === 'minimax' && !settings.minimax_api_key) {
    throw new Error('请先在设置中填写 MiniMax API Key。')
  }
  if (settings.tts_provider === 'minimax' && !settings.minimax_tts_voice_id) {
    throw new Error('请先在设置中填写 MiniMax voice_id。')
  }
  if (settings.tts_provider === 'mimo' && !settings.mimo_api_key) {
    throw new Error('请先在设置中填写 MiMo API Key。')
  }

  const text = stripMarkdownForSpeech(payload.text)
  if (!text) {
    throw new Error('没有可朗读的文本。')
  }
  const characters = estimateMiniMaxSpeechCharacters(text)
  const usageBefore = readTtsUsage()

  const cacheDir = resolveTtsCacheDir()
  fs.mkdirSync(cacheDir, { recursive: true })
  const audioMime = getTtsAudioMime(settings)
  const entries = buildTtsCacheEntries(settings, text)
  const cachedBuffers = entries.every((entry) => fs.existsSync(entry.filePath))
    ? entries.map((entry) => fs.readFileSync(entry.filePath))
    : []

  if (cachedBuffers.length === entries.length && entries.length > 0) {
    return {
      provider: settings.tts_provider,
      model: getTtsModel(settings),
      voiceId: getTtsVoiceId(settings),
      filePath: entries[0].filePath,
      filePaths: entries.map((entry) => entry.filePath),
      dataUrl: toTtsDataUrl(cachedBuffers[0], audioMime),
      dataUrls: cachedBuffers.map((buffer) => toTtsDataUrl(buffer, audioMime)),
      cached: true,
      characters,
      usage: usageBefore,
    }
  }

  const audioBuffers: Buffer[] = []
  let generatedCharacters = 0
  try {
    for (const entry of entries) {
      if (fs.existsSync(entry.filePath)) {
        audioBuffers.push(fs.readFileSync(entry.filePath))
        continue
      }
      const audioBuffer = settings.tts_provider === 'mimo'
        ? await requestMiMoSpeechAudio(settings, entry.text)
        : await requestMiniMaxSpeechAudio(settings, entry.text)
      fs.writeFileSync(entry.filePath, audioBuffer)
      generatedCharacters += estimateMiniMaxSpeechCharacters(entry.text)
      audioBuffers.push(audioBuffer)
    }
  } catch (error) {
    throw new Error(formatTtsFailureMessage(settings, error, characters, usageBefore))
  }

  const usageAfter = settings.tts_provider === 'minimax' && generatedCharacters > 0
    ? recordTtsUsage(generatedCharacters)
    : usageBefore
  return {
    provider: settings.tts_provider,
    model: getTtsModel(settings),
    voiceId: getTtsVoiceId(settings),
    filePath: entries[0].filePath,
    filePaths: entries.map((entry) => entry.filePath),
    dataUrl: toTtsDataUrl(audioBuffers[0], audioMime),
    dataUrls: audioBuffers.map((buffer) => toTtsDataUrl(buffer, audioMime)),
    cached: false,
    characters,
    usage: usageAfter,
  }
}

function createWindow() {
  const state = loadWindowState()
  appendRuntimeLog(`createWindow dataRoot=${dataRoot}`)

  mainWindow = new BrowserWindow({
    width: state.width ?? WINDOW_DEFAULT_WIDTH,
    height: state.height ?? WINDOW_DEFAULT_HEIGHT,
    x: state.x,
    y: state.y,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    frame: false,
    backgroundColor: '#1d2430',
    autoHideMenuBar: true,
    show: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.webContents.send('window:maximized-changed', { maximized: Boolean(mainWindow?.isMaximized()) })
    if (pendingDeepLink) {
      mainWindow?.webContents.send('deeplink:open', pendingDeepLink)
    }
  })

  mainWindow.on('focus', () => {
    mainWindow?.setBackgroundColor('#1d2430')
    mainWindow?.webContents.send('window:focus-changed', { focused: true })
  })

  mainWindow.on('blur', () => {
    mainWindow?.setBackgroundColor('#181e28')
    mainWindow?.webContents.send('window:focus-changed', { focused: false })
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', { maximized: true })
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', { maximized: false })
  })

  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function runPythonDistiller(payload: DistillPayload): Promise<DistillResult> {
  return new Promise((resolve, reject) => {
    const sourceKind = payload.sourceKind === 'local_media' ? 'local_media' : 'bilibili'
    const inputValue = sourceKind === 'local_media'
      ? String(payload.mediaPath ?? payload.video ?? '').trim()
      : String(payload.video ?? '').trim()
    if (!inputValue) {
      reject(new Error(sourceKind === 'local_media' ? '请先选择本地音视频文件。' : '请先填写 B 站视频链接或 BV 号。'))
      return
    }
    const runtimeSettings = loadSettings()
    const pythonCommand = resolvePythonCommand()
    const distillerEntryPath = resolveBackendScriptPath('distiller.py')
    const args = [
      ...pythonCommand.prefixArgs,
      distillerEntryPath,
      inputValue,
      '--result-json',
      '--material-only',
      ...(sourceKind === 'local_media' ? ['--local-media'] : []),
    ]
    const materialOutputDir = resolveMaterialOutputDir(runtimeSettings)
    fs.mkdirSync(materialOutputDir, { recursive: true })
    fs.mkdirSync(resolveCoursePackageOutputDir(runtimeSettings), { recursive: true })
    appendRuntimeLog(`spawn material builder command=${pythonCommand.command} args=${JSON.stringify(args)} cwd=${dataRoot}`)
  emitDistillProgress({ message: '正在整理 Codex 原材料包，请稍候…', percent: 3 })

    const child = spawn(pythonCommand.command, args, {
      cwd: dataRoot,
      windowsHide: true,
      env: {
        ...buildPythonEnv(runtimeSettings),
        SHIJIE_FOCUS_OUTPUT_DIR: materialOutputDir,
      },
    })

    let stdout = ''
    let stderr = ''
    let stdoutBuffer = ''
    let settled = false

    const finalizeReject = (error: Error) => {
      if (settled) return
      settled = true
      appendRuntimeLog(`distiller rejected: ${error.message}`)
      reject(error)
    }

    const finalizeResolve = (result: DistillResult) => {
      if (settled) return
      settled = true
      appendRuntimeLog(`material builder resolved packagePath=${result.packagePath} materialPath=${result.materialPath ?? ''}`)
      resolve(result)
    }

    const timeoutHandle = setTimeout(() => {
      appendRuntimeLog(`distiller timeout after ${DISTILL_PROCESS_TIMEOUT_MS}ms; killing child pid=${child.pid ?? 'unknown'}`)
    emitDistillProgress({ message: '整理阶段超时，正在终止后台任务…', percent: 96 })
      try {
        child.kill()
      } catch {
        // ignore kill failure
      }
    finalizeReject(new Error(`整理阶段超时（>${Math.floor(DISTILL_PROCESS_TIMEOUT_MS / 1000)} 秒）。`))
    }, DISTILL_PROCESS_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      stdoutBuffer += text
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        const match = line.match(/^__ONBOARD_DISTILL_PROGRESS__=(\{.*\})$/)
        if (match) {
          try {
            const payload = JSON.parse(match[1])
            emitDistillProgress({
            message: String(payload?.message ?? '正在整理学习原材料…'),
              percent: Number(payload?.percent ?? 0),
              outlinePreview: payload?.outlinePreview,
              stage: typeof payload?.stage === 'string' ? payload.stage : undefined,
              cacheHint: typeof payload?.cacheHint === 'string' ? payload.cacheHint : undefined,
              audioCompleted: Number.isFinite(Number(payload?.audioCompleted))
                ? Number(payload.audioCompleted)
                : undefined,
              audioTotal: Number.isFinite(Number(payload?.audioTotal))
                ? Number(payload.audioTotal)
                : undefined,
              chunkCompleted: Number.isFinite(Number(payload?.chunkCompleted)) ? Number(payload.chunkCompleted) : undefined,
              chunkTotal: Number.isFinite(Number(payload?.chunkTotal)) ? Number(payload.chunkTotal) : undefined,
              resumed: typeof payload?.resumed === 'boolean' ? payload.resumed : undefined,
            })
          } catch {
            // ignore malformed payload
          }
        }
      }
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      appendRuntimeLog(`distiller stderr ${text.trim()}`)
    })

    child.on('error', (error) => {
      clearTimeout(timeoutHandle)
      appendRuntimeLog(`distiller process error: ${error.message}`)
    finalizeReject(new Error(`整理进程启动失败：${error.message}`))
    })

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle)
      if (stdoutBuffer.trim()) {
        stdout += `\n${stdoutBuffer.trim()}`
        stdoutBuffer = ''
      }

      appendRuntimeLog(
        `distiller close code=${String(code)} signal=${String(signal)} stdoutLength=${stdout.length} stderrLength=${stderr.length}`,
      )

      if (settled) {
        appendRuntimeLog('distiller close ignored because promise already settled.')
        return
      }

      if (code !== 0) {
        const message = (stderr || stdout || `Python process exited with code ${code}`).trim()
        finalizeReject(new Error(message))
        return
      }

      const match = stdout.match(/__ONBOARD_DISTILL_RESULT__=(\{.*\})/s)
      if (!match) {
        appendRuntimeLog(`distiller stdout tail=${stdout.slice(-800)}`)
        finalizeReject(new Error('未能从整理进程输出中解析结果。'))
        return
      }

      try {
        const parsed = JSON.parse(match[1]) as Omit<DistillResult, 'text'>
        if (!parsed.materialPath || !fs.existsSync(parsed.materialPath)) {
        throw new Error('整理完成，但未找到生成的 Codex 原材料包。')
        }
        const courseText =
          parsed.packagePath && fs.existsSync(parsed.packagePath)
            ? normalizeCoursePackageText(fs.readFileSync(parsed.packagePath, 'utf-8'), parsed.packagePath).text
            : ''
        emitDistillProgress({ message: 'Codex 原材料包已生成。', percent: 100, stage: 'complete' })
        finalizeResolve({
          ...parsed,
          text: courseText,
        })
      } catch (error) {
        finalizeReject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

function getCliArgValue(flag: string) {
  const index = process.argv.indexOf(flag)
  if (index < 0) return ''
  return String(process.argv[index + 1] ?? '').trim()
}

function clearObsidianExportFolder(settings: RuntimeSettings) {
  const vaultPath = settings.obsidian_vault_path
  if (!vaultPath || !fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    throw new Error('Obsidian Vault 路径不存在，无法清理导出目录。')
  }

  const exportFolder = sanitizeFileNameSegment(settings.obsidian_export_folder || '视界专注', '视界专注')
  const targetDir = path.resolve(vaultPath, exportFolder)
  const resolvedVault = path.resolve(vaultPath)
  if (!targetDir.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new Error('导出目录不在 Obsidian Vault 内，已取消清理。')
  }
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
}

async function runObsidianExportCliIfRequested() {
  const coursePath = getCliArgValue('--export-obsidian-course')
  if (!coursePath) return false

  await app.whenReady()
  try {
    const settings = loadSettings()
    if (process.argv.includes('--clean-obsidian-export')) {
      clearObsidianExportFolder(settings)
    }
    const course = JSON.parse(fs.readFileSync(coursePath, 'utf-8'))
    const result = exportCourseToObsidian(settings, {
      course,
      currentNodeId: null,
      completedNodeIds: [],
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    app.exit(0)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    app.exit(1)
  }
  return true
}

if (!process.argv.includes('--export-obsidian-course')) {
  const singleInstanceLock = app.requestSingleInstanceLock()
  if (!singleInstanceLock) {
    app.quit()
  } else {
  app.on('second-instance', (_event, argv) => {
    const deepLink = extractDeepLinkFromArgv(argv)
    if (deepLink) {
      dispatchDeepLink(deepLink)
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('open-url', (event, rawUrl) => {
    event.preventDefault()
    const deepLink = parseDeepLinkUrl(rawUrl)
    if (deepLink) {
      dispatchDeepLink(deepLink)
    }
  })

  app.whenReady().then(() => {
    registerAppProtocol()
    const initialDeepLink = extractDeepLinkFromArgv(process.argv)
    if (initialDeepLink) {
      pendingDeepLink = initialDeepLink
    }
    createWindow()
  })
  }
} else {
  void runObsidianExportCliIfRequested()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return false
  }
  mainWindow.maximize()
  return true
})

ipcMain.handle('settings:load', () => loadSettings())

ipcMain.handle('settings:save', (_event, payload: RuntimeSettings) => saveSettings(payload))

ipcMain.handle('settings:status', async () => fetchSettingsStatus())

ipcMain.handle('dialog:pickDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:pickMediaFile', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择本地视频或音频',
    buttonLabel: '使用这个文件',
    properties: ['openFile'],
    filters: [
      { name: '视频或音频文件', extensions: ['mp4', 'mkv', 'mov', 'webm', 'flv', 'avi', 'mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const targetPath = result.filePaths[0]
  return {
    path: targetPath,
    name: path.basename(targetPath),
  }
})

ipcMain.handle('dialog:pickImageFile', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择全局学习地图图片',
    buttonLabel: '使用这张图片',
    properties: ['openFile'],
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const targetPath = result.filePaths[0]
  return {
    path: targetPath,
    name: path.basename(targetPath),
  }
})

ipcMain.handle('course:import', async () => {
  const runtimeSettings = loadSettings()
  const result = await dialog.showOpenDialog({
    title: '选择学习包 JSON',
    defaultPath: resolveCourseImportDefaultPath(runtimeSettings),
    buttonLabel: '导入学习包',
    properties: ['openFile'],
    filters: [
      { name: 'Study Package JSON (*.json)', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const targetPath = result.filePaths[0]
  const text = normalizeCoursePackageText(fs.readFileSync(targetPath, 'utf-8'), targetPath).text
  return {
    path: targetPath,
    text,
  }
})

ipcMain.handle('course:read', async (_event, targetPath: string) => {
  if (!targetPath) {
    throw new Error('未提供学习包路径。')
  }
  const text = normalizeCoursePackageText(fs.readFileSync(targetPath, 'utf-8'), targetPath).text
  return {
    path: targetPath,
    text,
  }
})

ipcMain.handle('course:attach-visual-map', async (_event, payload: CourseVisualMapAttachmentPayload) => {
  return attachCourseVisualMap(payload)
})

ipcMain.handle('distill:run', async (_event, payload: DistillPayload) => {
  return runPythonDistiller(payload)
})

ipcMain.handle('materials:list', async () => {
  return listMaterialPackages(loadSettings())
})

ipcMain.handle('materials:delete', async (_event, materialPath: string) => {
  return deleteMaterialPackage(loadSettings(), materialPath)
})

ipcMain.handle('knowledge:importBrief', async (_event, materialPath: string) => {
  if (!materialPath) {
    throw new Error('未提供材料包路径。')
  }
  return importKnowledgeBriefFromMaterial(loadSettings(), materialPath)
})

ipcMain.handle('knowledge:list', async () => {
  return listKnowledgeLibrary(loadSettings())
})

ipcMain.handle('learning:library:load', async () => loadLearningLibraryPayload())

ipcMain.handle('learning:library:open', async (_event, recordId: string) => {
  if (!recordId) {
    throw new Error('未提供学习记录 ID。')
  }
  return openLearningRecord(recordId)
})

ipcMain.handle('learning:library:refresh-structure', async () => {
  return refreshLearningLibraryStructure()
})

ipcMain.handle('learning:library:save', async (_event, record: LearningRecord) => {
  if (!record?.id && !record?.packageId) {
    throw new Error('学习记录缺少标识。')
  }
  return upsertLearningRecord(record)
})

ipcMain.handle('learning:library:delete', async (_event, recordId: string) => {
  if (!recordId) {
    throw new Error('未提供学习记录 ID。')
  }
  return deleteLearningRecord(recordId)
})

ipcMain.handle('obsidian:export', async (_event, payload: ObsidianExportPayload) => {
  return exportCourseToObsidian(loadSettings(), payload)
})

ipcMain.handle('obsidian:open', async (_event, payload: ObsidianExportPayload & { target?: 'current' | 'board' | 'index' }) => {
  return openObsidianTarget(loadSettings(), payload)
})

ipcMain.handle('tts:synthesize', async (_event, payload: TtsSynthesizePayload) => {
  return synthesizeSpeech(loadSettings(), payload)
})

ipcMain.handle('tts:status', async (_event, payload: TtsSynthesizePayload) => {
  return getTtsCacheStatus(loadSettings(), payload)
})

ipcMain.handle('file:readText', async (_event, targetPath: string) => {
  const resolvedPath = path.resolve(String(targetPath || ''))
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`文件不存在：${resolvedPath}`)
  }
  return fs.readFileSync(resolvedPath, 'utf-8')
})

ipcMain.handle('file:copyText', async (_event, targetPath: string) => {
  const resolvedPath = path.resolve(String(targetPath || ''))
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`文件不存在：${resolvedPath}`)
  }
  const text = fs.readFileSync(resolvedPath, 'utf-8')
  clipboard.writeText(text)
  return {
    path: resolvedPath,
    length: text.length,
  }
})

ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
  if (!targetPath) return
  if (!fs.existsSync(targetPath) && !path.extname(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true })
  }
  const openPathError = await shell.openPath(targetPath)
  if (openPathError) {
    throw new Error(openPathError)
  }
})

ipcMain.handle('shell:showItem', async (_event, targetPath: string) => {
  if (!targetPath) return
  shell.showItemInFolder(targetPath)
})

ipcMain.handle('shell:openExternal', async (_event, targetUrl: string) => {
  if (!targetUrl) return
  await shell.openExternal(targetUrl)
})

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

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
      if (fs.existsSync(path.join(candidate, '.biliarchive.local.json'))) {
        return candidate
      }
    }
  }

  return null
}

const devProjectRoot = resolveDevProjectRoot()
const dataRoot = app.isPackaged ? (findExistingDataRoot() || resolvePortableExecutableDir()) : devProjectRoot
const settingsPath = path.join(dataRoot, '.biliarchive.local.json')
const windowStatePath = path.join(dataRoot, '.biliarchive.window.json')
const runtimeLogPath = path.join(dataRoot, '.zhiyuli-runtime.log')
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

type RunResult = {
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

type DistillResult = {
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
    cache_hit?: string
    pipeline?: Record<string, unknown>
  }
  text: string
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
  batchCompleted?: number
  batchTotal?: number
  resumed?: boolean
  prefetchReuseChunkRatio?: number
  prefetchReuseBatchRatio?: number
}

type DistillPayload = {
  video: string
}

type ObsidianExportPayload = {
  course: Record<string, unknown>
  currentNodeId: string | null
  completedNodeIds: string[]
  failedNodeIds?: string[]
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
  milestoneEvents: Array<{
    id: string
    kind: 'node_complete' | 'stage_complete' | 'correction_recovery' | 'course_complete'
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
  recentMilestones: LearningRecord['milestoneEvents']
  achievementBadges: Array<{
    code: 'first_step' | 'steady_stride' | 'stage_breaker' | 'comeback' | 'midway' | 'course_finisher'
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
  { bucket: 5, keywords: ['复盘', '回顾', '总结', '小测', '测验', '自检', '检查'] },
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
  if (normalized === 'local' || normalized === 'sensevoice' || normalized === 'cuda' || normalized === 'local_sensevoice') {
    return 'local_sensevoice'
  }
  return 'groq'
}

function loadWindowState() {
  try {
    if (fs.existsSync(windowStatePath)) {
      const state = JSON.parse(fs.readFileSync(windowStatePath, 'utf-8'))
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
    path.resolve(devProjectRoot, '..', '..', 'Cuda'),
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
    output_dir: path.join(dataRoot, 'output'),
    obsidian_vault_path: '',
    obsidian_export_folder: '视界专注',
    obsidian_auto_sync: true,
    coach_api_base_url: 'https://api.minimaxi.com/v1',
    coach_api_key: '',
    coach_model: 'MiniMax-M2.7',
    distiller_api_base_url: 'https://api.minimaxi.com/v1',
    distiller_api_key: '',
    distiller_model: 'MiniMax-M2.7',
    transcription_provider: guessedLocalRoot ? 'local_sensevoice' : 'groq',
    groq_api_key: '',
    groq_transcription_model: 'whisper-large-v3-turbo',
    local_transcription_root: guessedLocalRoot,
    local_transcription_python: '',
    local_transcription_model_id: 'iic/SenseVoiceSmall',
    local_transcription_device: 'cuda:0',
    local_transcription_language: 'zh',
  }
}

const secureStore = new Store<{
  runtimeSettings: RuntimeSettings
  learningLibrary: LearningLibraryState
}>({
  name: 'onboard-anything-secure',
})

function normalizeSettings(raw: Partial<RuntimeSettings> | null | undefined): RuntimeSettings {
  const defaults = defaultSettings()
  return {
    sessdata: sanitizeSecret(raw?.sessdata ?? defaults.sessdata),
    output_dir: path.resolve(String(raw?.output_dir ?? defaults.output_dir).trim() || defaults.output_dir),
    obsidian_vault_path: sanitizeOptionalPath(raw?.obsidian_vault_path ?? defaults.obsidian_vault_path),
    obsidian_export_folder: sanitizeDisplayText(raw?.obsidian_export_folder ?? defaults.obsidian_export_folder, defaults.obsidian_export_folder),
    obsidian_auto_sync: raw?.obsidian_auto_sync === undefined ? defaults.obsidian_auto_sync : Boolean(raw?.obsidian_auto_sync),
    coach_api_base_url: sanitizeBaseUrl(raw?.coach_api_base_url ?? defaults.coach_api_base_url, defaults.coach_api_base_url),
    coach_api_key: sanitizeSecret(raw?.coach_api_key ?? defaults.coach_api_key),
    coach_model: sanitizeSecret(raw?.coach_model ?? defaults.coach_model) || defaults.coach_model,
    distiller_api_base_url: sanitizeBaseUrl(raw?.distiller_api_base_url ?? defaults.distiller_api_base_url, defaults.distiller_api_base_url),
    distiller_api_key: sanitizeSecret(raw?.distiller_api_key ?? defaults.distiller_api_key),
    distiller_model: sanitizeSecret(raw?.distiller_model ?? defaults.distiller_model) || defaults.distiller_model,
    transcription_provider: sanitizeTranscriptionProvider(raw?.transcription_provider ?? defaults.transcription_provider),
    groq_api_key: sanitizeSecret(raw?.groq_api_key ?? defaults.groq_api_key),
    groq_transcription_model:
      sanitizeSecret(raw?.groq_transcription_model ?? defaults.groq_transcription_model) || defaults.groq_transcription_model,
    local_transcription_root: sanitizeOptionalPath(raw?.local_transcription_root ?? defaults.local_transcription_root),
    local_transcription_python: sanitizeOptionalPath(raw?.local_transcription_python ?? defaults.local_transcription_python),
    local_transcription_model_id:
      sanitizeSecret(raw?.local_transcription_model_id ?? defaults.local_transcription_model_id) || defaults.local_transcription_model_id,
    local_transcription_device:
      sanitizeSecret(raw?.local_transcription_device ?? defaults.local_transcription_device) || defaults.local_transcription_device,
    local_transcription_language:
      sanitizeSecret(raw?.local_transcription_language ?? defaults.local_transcription_language) || defaults.local_transcription_language,
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

function collectStageCommonMistakes(children: Array<Record<string, unknown>>) {
  return takeUniqueCourseTexts(
    children.flatMap((child) => {
      const knowledge = child.knowledge && typeof child.knowledge === 'object' ? (child.knowledge as Record<string, unknown>) : {}
      return Array.isArray(knowledge.common_mistakes) ? knowledge.common_mistakes : []
    }),
    4,
  )
}

function buildStageQuizQuestions(parentTitle: string, children: Array<Record<string, unknown>>, commonMistakes: string[]) {
  const previewTitles = takeUniqueCourseTexts(children.map((child) => child.title), 3)
  const questions: string[] = []
  if (previewTitles.length) {
    questions.push(`如果要你用自己的话说明“${previewTitles[0]}”在 ${parentTitle} 里的作用，你会怎么讲？`)
  }
  if (previewTitles.length >= 2) {
    questions.push(`学完“${previewTitles[0]}”以后，为什么还要继续掌握“${previewTitles[1]}”？请说出它们之间的衔接。`)
  }
  if (commonMistakes.length) {
    questions.push(`有人在这一阶段常犯“${commonMistakes[0]}”这样的错误，你会怎么提醒他纠正？`)
  } else if (previewTitles.length) {
    questions.push(`如果把 ${parentTitle} 真正用起来，你觉得最容易忽略的细节会是什么？为什么？`)
  }
  return takeUniqueCourseTexts(questions, 3)
}

function buildStageQuizExamples(recapId: string, questions: string[]) {
  return questions.map((question, index) => ({
    id: `example_${recapId.slice(0, 20)}_${String(index + 1).padStart(2, '0')}`.slice(0, 64),
    title: `阶段小测 ${index + 1}`,
    scenario: question.slice(0, 240),
    takeaway: '先试着用自己的话回答，再回头检查复盘要点。',
  }))
}

function isStageRecapNode(node: Record<string, unknown>) {
  const title = normalizeCourseTextValue(node.title).toLocaleLowerCase('zh-CN')
  return Boolean(title) && (title.includes('复盘') || title.includes('小测') || title.includes('回顾'))
}

function buildStageRecapNode(parentNode: Record<string, unknown>, children: Array<Record<string, unknown>>) {
  const baseChildren = children.filter((child) => !isStageRecapNode(child))
  if (baseChildren.length < 2) return null

  const parentId = normalizeCourseTextValue(parentNode.id)
  const parentTitle = normalizeCourseTextValue(parentNode.title) || '本阶段'
  const previewTitles = takeUniqueCourseTexts(baseChildren.map((child) => child.title), 3)
  const previewText = previewTitles.slice(0, 3).join('、') || parentTitle
  const recapTitle = '阶段复盘与小测'
  const recapSummary = `回顾 ${previewText} 的关键概念、操作顺序与常见易错点，检查自己是否已经把 ${parentTitle} 的主线真正串起来。`.slice(0, 240)
  const recapId = makeCourseNodeId('lesson', baseChildren.length + 1, recapTitle, parentId)
  const knowledge = buildStageKnowledge(recapId, recapTitle, recapSummary)
  const commonMistakes = collectStageCommonMistakes(baseChildren)
  const quizQuestions = buildStageQuizQuestions(parentTitle, baseChildren, commonMistakes)
  knowledge.checkpoints = takeUniqueCourseTexts(
    [
      `能用自己的话串起 ${parentTitle} 的整体主线。`,
      ...previewTitles.slice(0, 2).map((title) => `能解释 ${title} 在这一阶段中的作用。`),
      ...quizQuestions.map((question, index) => `小测 ${index + 1}：${question}`),
      '开始阶段复盘，检查自己是否真的掌握了关键知识点。',
    ],
    6,
  )
  knowledge.common_mistakes = commonMistakes
  knowledge.examples = buildStageQuizExamples(recapId, quizQuestions)

  return {
    id: recapId,
    node_type: 'lesson',
    title: recapTitle,
    summary: recapSummary,
    order: baseChildren.length + 1,
    learning_objectives: takeUniqueCourseTexts(
      [`完成 ${parentTitle} 的阶段复盘`, ...previewTitles, '通过本阶段的小测自检'],
      4,
    ),
    dependencies: normalizeCourseTextValue(baseChildren[baseChildren.length - 1]?.id)
      ? [normalizeCourseTextValue(baseChildren[baseChildren.length - 1]?.id)]
      : [],
    knowledge,
    children: [],
    assets: [],
    gaps: [],
  }
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
    const recapNode = buildStageRecapNode(nextNode, processedChildren)
    const baseChildren = processedChildren.filter((child) => !isStageRecapNode(child))
    const existingRecap = processedChildren.find((child) => isStageRecapNode(child))
    if (recapNode) {
      processedChildren = [...baseChildren, recapNode]
      if (!existingRecap || normalizeCourseTextValue(existingRecap.id) !== normalizeCourseTextValue(recapNode.id) || normalizeCourseTextValue(existingRecap.summary) !== normalizeCourseTextValue(recapNode.summary)) {
        changed = true
      }
    } else if (existingRecap) {
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

  const dependencyGraph = Array.isArray(payload.dependency_graph)
    ? JSON.parse(JSON.stringify(payload.dependency_graph))
    : []
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
    if (targetPath) {
      try {
        fs.writeFileSync(targetPath, nextText, 'utf-8')
      } catch {
        // ignore package write-back failures and still return upgraded text
      }
    }
    return { text: nextText, changed: true }
  } catch {
    return { text: courseText, changed: false }
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
  const attemptHistory = Array.isArray(raw?.attemptHistory) ? raw.attemptHistory : []
  return {
    nodeId: String(raw?.nodeId ?? fallbackNodeId),
    learningStatus:
      raw?.learningStatus === 'quizzing' ||
      raw?.learningStatus === 'correcting' ||
      raw?.learningStatus === 'completed'
        ? raw.learningStatus
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
    attemptHistory: attemptHistory
      .filter((attempt) => attempt && typeof attempt === 'object')
      .map((attempt, index) => ({
        id: String(attempt.id ?? `${fallbackNodeId}-attempt-${index}`),
        nodeTitle: String(attempt.nodeTitle ?? fallbackNodeId),
        question: typeof attempt.question === 'string' ? attempt.question : null,
        answer: String(attempt.answer ?? ''),
        verdict:
          attempt.verdict === 'correct' || attempt.verdict === 'partial' || attempt.verdict === 'incorrect'
            ? attempt.verdict
            : 'incorrect',
        matchedKeywords: Array.isArray(attempt.matchedKeywords)
          ? attempt.matchedKeywords.map((keyword) => String(keyword))
          : [],
        missingKeywords: Array.isArray(attempt.missingKeywords)
          ? attempt.missingKeywords.map((keyword) => String(keyword))
          : [],
        cautionNotes: Array.isArray(attempt.cautionNotes)
          ? attempt.cautionNotes.map((note) => String(note))
          : [],
        createdAt: Number(attempt.createdAt ?? Date.now()),
      })),
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

function normalizeLearningRecord(raw: Partial<LearningRecord> | null | undefined, existing?: LearningRecord): LearningRecord {
  const recordId = String(raw?.id ?? existing?.id ?? raw?.packageId ?? `record-${Date.now()}`)
  const nodeSessions = Object.entries(raw?.nodeSessions ?? existing?.nodeSessions ?? {}).reduce<Record<string, PersistedNodeLearningSession>>(
    (accumulator, [nodeId, session]) => {
      accumulator[nodeId] = normalizeNodeSession(session, nodeId)
      return accumulator
    },
    {},
  )
  const importedCoursePath =
    raw?.importedCoursePath === null
      ? null
      : String(raw?.importedCoursePath ?? existing?.importedCoursePath ?? '') || null
  const packagePath =
    raw?.packagePath === null
      ? null
      : String(raw?.packagePath ?? existing?.packagePath ?? '') || null
  const normalizedCourseText = normalizeCoursePackageText(
    String(raw?.courseText ?? existing?.courseText ?? ''),
    packagePath ?? importedCoursePath,
  )

  return {
    id: recordId,
    packageId: String(raw?.packageId ?? existing?.packageId ?? recordId),
    title: String(raw?.title ?? existing?.title ?? '未命名课程'),
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
    failedNodeIds: Array.isArray(raw?.failedNodeIds)
      ? raw!.failedNodeIds.map((value) => String(value))
      : existing?.failedNodeIds ?? [],
    nodeSessions,
    milestoneEvents: Array.isArray(raw?.milestoneEvents)
      ? raw!.milestoneEvents
          .map((event) => ({
            id: String(event?.id ?? `milestone-${Date.now()}-${Math.random()}`),
            kind:
              event?.kind === 'node_complete' ||
              event?.kind === 'stage_complete' ||
              event?.kind === 'correction_recovery' ||
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
    if (normalized.courseText !== String((record as Partial<LearningRecord> | undefined)?.courseText ?? '')) {
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
  const hasComeback = (record.milestoneEvents ?? []).some((event) => event.kind === 'correction_recovery')
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

  if (hasComeback) {
    badges.push({
      code: 'comeback',
      label: '越错越稳',
      description: '出现过卡点，但最终靠纠错把知识拿下了。',
      tone: 'info',
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
      label: '结课归档',
      description: '整门课程已经完成，可以永久收录到知识资产里。',
      tone: 'success',
    })
  }

  return badges
}

function summarizeLearningRecord(record: LearningRecord): LearningRecordSummary {
  const allAttempts = Object.values(record.nodeSessions).flatMap((session) => session.attemptHistory || [])
  const partialAttempts = allAttempts.filter((attempt) => attempt.verdict === 'partial')
  const incorrectAttempts = allAttempts.filter((attempt) => attempt.verdict === 'incorrect')
  const hotspotScores = new Map<string, number>()
  ;[...incorrectAttempts, ...partialAttempts].forEach((attempt) => {
    const weight = attempt.verdict === 'incorrect' ? 2 : 1
    hotspotScores.set(attempt.nodeTitle, (hotspotScores.get(attempt.nodeTitle) ?? 0) + weight)
  })
  const hotspotNodeTitle =
    [...hotspotScores.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
  const dominantChallenge: LearningRecordSummary['dominantChallenge'] =
    incorrectAttempts.length >= Math.max(2, partialAttempts.length)
      ? 'incorrect-heavy'
      : partialAttempts.length > 0
        ? 'partial-heavy'
        : 'stable'
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
    partialCount: partialAttempts.length,
    incorrectCount: incorrectAttempts.length,
    hotspotNodeTitle,
    dominantChallenge,
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
    if (normalized.courseText !== record.courseText) {
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
  const nextRecords = { ...library.records }
  delete nextRecords[recordId]
  const nextCurrentRecordId =
    library.currentRecordId === recordId
      ? sortLearningRecords(Object.values(nextRecords))[0]?.id ?? null
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

function emitArchiveLog(message: string) {
  appendRuntimeLog(message)
  mainWindow?.webContents.send('archive-log', message.endsWith('\n') ? message : `${message}\n`)
}

function emitArchiveProgress(payload: { message: string; percent: number }) {
  mainWindow?.webContents.send('archive-progress', payload)
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

  const validateOpenAICompatible = async (config: { apiKey: string; baseUrl: string; model: string }) => {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: '请回复：ok' }],
        temperature: 0.1,
        max_tokens: 8,
      }),
    })
    return response
  }

  const coach = {
    configured: Boolean(settings.coach_api_key.trim()),
    valid: false,
    baseUrl: settings.coach_api_base_url || 'https://api.minimaxi.com/v1',
    model: settings.coach_model || 'MiniMax-M2.7',
    message: '未配置 API Key',
  }

  if (coach.configured) {
    try {
      const response = await validateOpenAICompatible({
        apiKey: settings.coach_api_key,
        baseUrl: coach.baseUrl,
        model: coach.model,
      })
      if (response.ok) {
        const payload = await response.json()
        coach.valid = Boolean(payload?.choices?.length)
        coach.message = coach.valid ? `已配置 ${coach.model}` : '返回结果异常'
      } else if (response.status === 401) {
        coach.message = 'API Key 无效'
      } else if (response.status === 403) {
        coach.message = 'API Key 无权限'
      } else {
        coach.message = `校验失败 · HTTP ${response.status}`
      }
    } catch {
      coach.message = 'API 检测失败'
    }
  }

  const distiller = {
    configured: Boolean(settings.distiller_api_key.trim()),
    valid: false,
    baseUrl: settings.distiller_api_base_url || 'https://api.minimaxi.com/v1',
    model: settings.distiller_model || 'MiniMax-M2.7',
    message: '未配置 Distiller API Key',
  }

  if (distiller.configured) {
    try {
      const response = await validateOpenAICompatible({
        apiKey: settings.distiller_api_key,
        baseUrl: distiller.baseUrl,
        model: distiller.model,
      })

      if (response.ok) {
        const payload = await response.json()
        distiller.valid = Boolean(payload?.choices?.length)
        distiller.message = distiller.valid ? `已配置 ${distiller.model}` : '返回结果异常'
      } else if (response.status === 401) {
        distiller.message = 'API Key 无效'
      } else if (response.status === 403) {
        distiller.message = 'API Key 无权限'
      } else {
        distiller.message = `校验失败 · HTTP ${response.status}`
      }
    } catch {
      distiller.message = 'API 检测失败'
    }
  }

  const groq = {
    configured: Boolean(settings.groq_api_key.trim()),
    valid: false,
    model: settings.groq_transcription_model || 'whisper-large-v3-turbo',
    message: '未配置 Groq API Key',
  }

  if (groq.configured) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          Authorization: `Bearer ${settings.groq_api_key.trim()}`,
        },
      })

      if (response.ok) {
        const payload = await response.json()
        const models = Array.isArray(payload?.data) ? payload.data : []
        const modelIds = new Set(models.map((item: { id?: string }) => String(item?.id ?? '')))
        groq.valid = modelIds.size === 0 || modelIds.has(groq.model)
        groq.message = groq.valid ? `已配置 ${groq.model}` : `模型不可用：${groq.model}`
      } else if (response.status === 401) {
        groq.message = 'API Key 无效'
      } else if (response.status === 403) {
        groq.message = 'API Key 无权限'
      } else {
        groq.message = `校验失败 · HTTP ${response.status}`
      }
    } catch {
      groq.message = 'API 检测失败'
    }
  }

  return { bilibili, coach, distiller, groq }
}

function buildPythonEnv(settings: RuntimeSettings, extraEnv: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    ...extraEnv,
    BILIARCHIVE_HOME: dataRoot,
    BILIARCHIVE_SETTINGS_PATH: settingsPath,
    BILIARCHIVE_OUTPUT_DIR: settings.output_dir,
    BILIBILI_SESSDATA: settings.sessdata,
    ONBOARD_COACH_BASE_URL: settings.coach_api_base_url,
    ONBOARD_COACH_API_KEY: settings.coach_api_key,
    ONBOARD_COACH_MODEL: settings.coach_model,
    ONBOARD_DISTILLER_BASE_URL: settings.distiller_api_base_url,
    ONBOARD_DISTILLER_API_KEY: settings.distiller_api_key,
    ONBOARD_DISTILLER_MODEL: settings.distiller_model,
    MINIMAX_BASE_URL: settings.distiller_api_base_url,
    MINIMAX_API_KEY: settings.distiller_api_key,
    MINIMAX_MODEL: settings.distiller_model,
    ONBOARD_TRANSCRIPTION_PROVIDER: settings.transcription_provider,
    GROQ_API_KEY: settings.groq_api_key,
    GROQ_TRANSCRIPTION_MODEL: settings.groq_transcription_model,
    ONBOARD_LOCAL_TRANSCRIPTION_ROOT: settings.local_transcription_root,
    ONBOARD_LOCAL_TRANSCRIPTION_PYTHON: settings.local_transcription_python,
    ONBOARD_LOCAL_TRANSCRIPTION_MODEL_ID: settings.local_transcription_model_id,
    ONBOARD_LOCAL_TRANSCRIPTION_DEVICE: settings.local_transcription_device,
    ONBOARD_LOCAL_TRANSCRIPTION_LANGUAGE: settings.local_transcription_language,
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

  if (cleanedRawTitle === '阶段复盘与小测') {
    return normalizedParent ? `${normalizedParent} · 复盘与小测` : cleanedRawTitle
  }

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

function exportCourseToObsidian(settings: RuntimeSettings, payload: ObsidianExportPayload): ObsidianExportResult {
  const vaultPath = settings.obsidian_vault_path
  if (!vaultPath) {
    throw new Error('请先在设置中配置 Obsidian Vault 路径。')
  }
  if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    throw new Error('Obsidian Vault 路径不存在，或不是文件夹。')
  }

  const course = payload.course ?? {}
  const courseMeta = ((course.course as Record<string, unknown> | undefined) ?? {})
  const sourceMeta = ((course.source as Record<string, unknown> | undefined) ?? {})
  const chapters = Array.isArray(course.chapters) ? (course.chapters as Record<string, unknown>[]) : []
  const packageId = String(course.package_id ?? 'unknown-package')
  const courseTitle = sanitizeDisplayText(courseMeta.title ?? sourceMeta.title ?? packageId, '未命名课程')
  const exportedAt = new Date().toISOString()
  const exportFolder = sanitizeFileNameSegment(settings.obsidian_export_folder || '视界专注', '视界专注')
  const courseFolder = sanitizeFileNameSegment(courseTitle, packageId)
  const exportWikiFolder = sanitizeWikiSegment(exportFolder, '视界专注')
  const courseWikiFolder = sanitizeWikiSegment(courseFolder, packageId)
  const courseWikiRoot = `${exportWikiFolder}/${courseWikiFolder}`
  const overviewNoteTitle = '课程总览'
  const progressNoteTitle = '学习看板'
  const overviewWikiTarget = `${courseWikiRoot}/${overviewNoteTitle}`
  const progressWikiTarget = `${courseWikiRoot}/${progressNoteTitle}`
  const rootDir = path.join(vaultPath, exportFolder, courseFolder)
  const nodeDir = path.join(rootDir, '节点')
  fs.mkdirSync(nodeDir, { recursive: true })
  const legacyOverviewPath = path.join(rootDir, '00 课程总览.md')
  const legacyProgressPath = path.join(rootDir, '01 学习看板.md')
  const existingNodePathById = new Map<string, string>()

  if (fs.existsSync(nodeDir)) {
    for (const fileName of fs.readdirSync(nodeDir)) {
      if (!fileName.toLowerCase().endsWith('.md')) continue
      const filePath = path.join(nodeDir, fileName)
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const nodeIdMatch = content.match(/^node_id:\s*"([^"]+)"/m)
        if (nodeIdMatch?.[1]) {
          existingNodePathById.set(nodeIdMatch[1], filePath)
        }
      } catch {
        // ignore unreadable legacy note files
      }
    }
  }

  const flattened = flattenCourseNodes(chapters)
  const orderedNodeIds: string[] = []
  const rawTitleById = new Map<string, string>()
  const usedNoteTitles = new Map<string, number>()
  const noteMetaById = new Map<string, {
    title: string
    wikiTarget: string
    filePath: string
    parentId: string | null
    depth: number
    node: Record<string, unknown>
  }>()

  flattened.forEach(({ node }, index) => {
    const nodeId = String(node.id ?? `node-${index + 1}`)
    rawTitleById.set(nodeId, sanitizeDisplayText(String(node.title ?? nodeId), nodeId))
  })

  flattened.forEach(({ node, parentId, depth }, index) => {
    const nodeId = String(node.id ?? `node-${index + 1}`)
    const parentTitle = parentId ? rawTitleById.get(parentId) ?? null : null
    const baseTitle = sanitizeWikiSegment(buildObsidianNodeTitle(String(node.title ?? nodeId), parentTitle), nodeId)
    const duplicateCount = (usedNoteTitles.get(baseTitle) ?? 0) + 1
    usedNoteTitles.set(baseTitle, duplicateCount)
    const noteTitle = duplicateCount > 1 ? `${baseTitle}（${duplicateCount}）` : baseTitle
    const fileName = `${sanitizeFileNameSegment(noteTitle, nodeId)}.md`
    orderedNodeIds.push(nodeId)
    noteMetaById.set(nodeId, {
      title: noteTitle,
      wikiTarget: `${courseWikiRoot}/节点/${noteTitle}`,
      filePath: path.join(nodeDir, fileName),
      parentId,
      depth,
      node,
    })
  })

  const dependentsById = new Map<string, string[]>()
  const rootChapterById = new Map<string, string>()

  for (const nodeId of orderedNodeIds) {
    const meta = noteMetaById.get(nodeId)
    if (!meta) continue
    const dependencies = Array.isArray(meta.node.dependencies) ? meta.node.dependencies.map((item) => String(item)) : []
    for (const dependencyId of dependencies) {
      const current = dependentsById.get(dependencyId) ?? []
      current.push(nodeId)
      dependentsById.set(dependencyId, current)
    }

    let cursor: string | null = nodeId
    let rootTitle = String(meta.node.title ?? meta.title)
    while (cursor) {
      const currentMeta = noteMetaById.get(cursor)
      if (!currentMeta) break
      rootTitle = String(currentMeta.node.title ?? currentMeta.title)
      cursor = currentMeta.parentId
    }
    rootChapterById.set(nodeId, rootTitle)
  }

  for (const [nodeId, meta] of noteMetaById.entries()) {
    const node = meta.node
    const dependencies = Array.isArray(node.dependencies) ? node.dependencies.map((item) => String(item)) : []
    const objectives = Array.isArray(node.learning_objectives) ? node.learning_objectives.map((item) => String(item)) : []
    const concepts = Array.isArray((node.knowledge as Record<string, unknown> | undefined)?.concepts)
      ? (((node.knowledge as Record<string, unknown>).concepts) as Record<string, unknown>[])
      : []
    const examples = Array.isArray((node.knowledge as Record<string, unknown> | undefined)?.examples)
      ? (((node.knowledge as Record<string, unknown>).examples) as Record<string, unknown>[])
      : []
    const stageQuizExamples = examples.filter((example) => String(example.title ?? '').includes('阶段小测'))
    const regularExamples = examples.filter((example) => !String(example.title ?? '').includes('阶段小测'))
    const checkpoints = Array.isArray((node.knowledge as Record<string, unknown> | undefined)?.checkpoints)
      ? (((node.knowledge as Record<string, unknown>).checkpoints) as unknown[]).map((item) => String(item))
      : []
    const mistakes = Array.isArray((node.knowledge as Record<string, unknown> | undefined)?.common_mistakes)
      ? (((node.knowledge as Record<string, unknown>).common_mistakes) as unknown[]).map((item) => String(item))
      : []
    const children = Array.isArray(node.children) ? (node.children as Record<string, unknown>[]) : []
    const assets = Array.isArray(node.assets) ? (node.assets as Record<string, unknown>[]) : []
    const gaps = Array.isArray(node.gaps) ? (node.gaps as Record<string, unknown>[]) : []
    const parentMeta = meta.parentId ? noteMetaById.get(meta.parentId) ?? null : null
    const dependencyLinks = dependencies
      .map((dependencyId) => noteMetaById.get(dependencyId))
      .filter(Boolean)
      .map((item) => ({ target: item!.wikiTarget, label: item!.title }))
    const childLinks = children
      .map((child) => noteMetaById.get(String(child.id ?? '')))
      .filter(Boolean)
      .map((item) => ({ target: item!.wikiTarget, label: item!.title }))
    const dependentLinks = (dependentsById.get(nodeId) ?? [])
      .map((dependentId) => noteMetaById.get(dependentId))
      .filter(Boolean)
      .map((item) => ({ target: item!.wikiTarget, label: item!.title }))
    const currentIndex = orderedNodeIds.indexOf(nodeId)
    const previousMeta = currentIndex > 0 ? noteMetaById.get(orderedNodeIds[currentIndex - 1]) ?? null : null
    const nextMeta = currentIndex >= 0 && currentIndex < orderedNodeIds.length - 1 ? noteMetaById.get(orderedNodeIds[currentIndex + 1]) ?? null : null
    const rawNodeTitle = String(node.title ?? meta.title)
    const aliases = Array.from(new Set([rawNodeTitle, meta.title, sanitizeWikiSegment(rawNodeTitle, rawNodeTitle)]))

    const progressState =
      payload.currentNodeId === nodeId
        ? 'current'
        : payload.completedNodeIds.includes(nodeId)
          ? 'completed'
          : 'pending'
    const appDeepLink = buildAppDeepLink(packageId, nodeId)
    const existingNodePath = existingNodePathById.get(nodeId)
    const readableSourcePath =
      existingNodePath && fs.existsSync(existingNodePath)
        ? existingNodePath
        : fs.existsSync(meta.filePath)
          ? meta.filePath
          : ''
    const existingMarkdown = readableSourcePath ? fs.readFileSync(readableSourcePath, 'utf-8') : ''

    const tags = [
      '视界专注',
      `课程/${courseTitle}`,
      `状态/${progressState}`,
      `类型/${String(node.node_type ?? 'lesson')}`,
      `主线/${rootChapterById.get(nodeId) ?? rawNodeTitle}`,
    ]

    const markdown = [
      '---',
      `title: ${escapeYamlString(meta.title)}`,
      'aliases:',
      renderYamlList(aliases, 2),
      `package_id: ${escapeYamlString(packageId)}`,
      `course_title: ${escapeYamlString(courseTitle)}`,
      `node_id: ${escapeYamlString(nodeId)}`,
      `node_type: ${escapeYamlString(String(node.node_type ?? 'lesson'))}`,
      `depth: ${meta.depth}`,
      `progress_state: ${escapeYamlString(progressState)}`,
      `root_chapter: ${escapeYamlString(rootChapterById.get(nodeId) ?? rawNodeTitle)}`,
      `parent_id: ${escapeYamlString(meta.parentId ?? '')}`,
      `source_id: ${escapeYamlString(String(sourceMeta.source_id ?? ''))}`,
      `source_url: ${escapeYamlString(String(sourceMeta.url ?? ''))}`,
      `exported_at: ${escapeYamlString(exportedAt)}`,
      'tags:',
      renderYamlList(tags, 2),
      '---',
      '',
      `# ${meta.title}`,
      '',
      `> 回到视界专注：[继续这节](${appDeepLink})`,
      `> 课程总览：[[${overviewWikiTarget}|${courseTitle}]]`,
      parentMeta ? `> 上级主线：[[${parentMeta.wikiTarget}|${parentMeta.title}]]` : '',
      progressState === 'current' ? '> 当前这节正是你在软件里推进到的位置。' : '',
      '',
      ...renderMarkdownSection(
        '导航',
        [
          previousMeta ? `- 上一节：[[${previousMeta.wikiTarget}|${previousMeta.title}]]` : '- 上一节：暂无',
          nextMeta ? `- 下一节：[[${nextMeta.wikiTarget}|${nextMeta.title}]]` : '- 下一节：暂无',
          parentMeta ? `- 上级节点：[[${parentMeta.wikiTarget}|${parentMeta.title}]]` : '- 上级节点：暂无',
          childLinks.length ? `- 下级入口：${childLinks.map((item) => `[[${item.target}|${item.label}]]`).join(' · ')}` : '- 下级入口：暂无',
        ].join('\n'),
      ),
      ...renderMarkdownSection('一句话理解', String(node.summary ?? '暂无摘要')),
      ...renderMarkdownSection('学习目标', renderBulletList(objectives.map((item) => String(item)))),
      ...renderMarkdownSection('前置依赖', renderWikiList(dependencyLinks)),
      ...renderMarkdownSection('谁会用到这节', renderWikiList(dependentLinks)),
      ...renderMarkdownSection(
        '核心概念',
        concepts.length
          ? concepts
              .map((concept) => `### ${String(concept.name ?? '概念')}\n\n${String(concept.explanation ?? '暂无说明')}`)
              .join('\n\n')
          : '- 暂无概念整理',
      ),
      ...renderMarkdownSection(
        '例子与场景',
        regularExamples.length
          ? regularExamples
              .map(
                (example) =>
                  `### ${String(example.title ?? '示例')}\n\n**场景**：${String(example.scenario ?? '暂无')}\n\n**结论**：${String(example.takeaway ?? '暂无')}`,
              )
              .join('\n\n')
          : '- 暂无示例',
      ),
      ...renderMarkdownSection(
        '阶段小测',
        stageQuizExamples.length
          ? stageQuizExamples
              .map(
                (example) =>
                  `### ${String(example.title ?? '阶段小测')}\n\n**题目**：${String(example.scenario ?? '暂无题目')}\n\n**提示**：${String(example.takeaway ?? '先试着自己回答。')}`,
              )
              .join('\n\n')
          : '',
      ),
      ...renderMarkdownSection('过关检查', renderBulletList(checkpoints)),
      ...renderMarkdownSection('常见误区', renderBulletList(mistakes)),
      ...renderMarkdownSection('继续延伸', renderWikiList(childLinks)),
      ...renderMarkdownSection(
        '资源与缺口',
        [
          assets.length
            ? assets.map((asset) => `- ${String(asset.title ?? asset.id ?? '资源')}（${String(asset.status ?? 'unknown')}）`).join('\n')
            : '- 暂无额外资源',
          gaps.length
            ? `\n### 待补信息\n\n${gaps.map((gap) => `- ${String(gap.description ?? gap.id ?? '信息缺口')}`).join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
      ...renderMarkdownSection(
        '来源',
        [`- 来源标题：${String(sourceMeta.title ?? courseTitle)}`, sourceMeta.url ? `- 原始链接：${String(sourceMeta.url)}` : '']
          .filter(Boolean)
          .join('\n'),
      ),
      ...renderMarkdownSection(
        '我的理解',
        [
          '> 在这里写下你自己的转述。尽量用自己的话，而不是照抄课程内容。',
          '',
          '- 我现在会怎么解释这个知识点？',
          '- 它和我以前学过的什么概念有关？',
        ].join('\n'),
        existingMarkdown,
      ),
      ...renderMarkdownSection(
        '我的例子',
        [
          '> 把课程里的例子换成你自己的场景，记忆会稳很多。',
          '',
          '- 我能举一个自己的例子吗？',
          '- 如果把它放进真实项目，我会怎么用？',
        ].join('\n'),
        existingMarkdown,
      ),
      ...renderMarkdownSection(
        '复习提醒',
        ['- 以后回看时，我最容易忘掉哪一步？', '- 下次复习时，我想重点检查什么？'].join('\n'),
        existingMarkdown,
      ),
    ]
      .filter(Boolean)
      .join('\n')

    fs.writeFileSync(meta.filePath, markdown, 'utf-8')

    if (existingNodePath && existingNodePath !== meta.filePath && fs.existsSync(existingNodePath)) {
      fs.unlinkSync(existingNodePath)
    }
  }

  const rootLinks = chapters
    .map((chapter) => noteMetaById.get(String(chapter.id ?? '')))
    .filter(Boolean)
    .map((item) => `- [[${item!.wikiTarget}|${item!.title}]]`)
  const completedLinks = payload.completedNodeIds
    .map((nodeId) => noteMetaById.get(nodeId))
    .filter(Boolean)
    .map((item) => `- [[${item!.wikiTarget}|${item!.title}]]`)
  const failedLinks = (Array.isArray(payload.failedNodeIds) ? payload.failedNodeIds : [])
    .map((nodeId) => noteMetaById.get(nodeId))
    .filter(Boolean)
    .map((item) => `- [[${item!.wikiTarget}|${item!.title}]]`)
  const pendingLinks = orderedNodeIds
    .filter((nodeId) => !payload.completedNodeIds.includes(nodeId))
    .slice(0, 15)
    .map((nodeId) => noteMetaById.get(nodeId))
    .filter(Boolean)
    .map((item) => `- [[${item!.wikiTarget}|${item!.title}]]`)

  const overviewContent = [
    '---',
    `title: ${escapeYamlString(courseTitle)}`,
    'aliases:',
    renderYamlList([courseTitle, `${courseTitle} 课程总览`, '00 课程总览'], 2),
    `package_id: ${escapeYamlString(packageId)}`,
    `source_id: ${escapeYamlString(String(sourceMeta.source_id ?? ''))}`,
    `source_url: ${escapeYamlString(String(sourceMeta.url ?? ''))}`,
    `exported_at: ${escapeYamlString(exportedAt)}`,
    'tags:',
    renderYamlList(['视界专注', '课程总览', `课程/${courseTitle}`], 2),
    '---',
    '',
    `# ${courseTitle}`,
    '',
    `> 回到视界专注：[继续当前进度](${buildAppDeepLink(packageId)})`,
    '',
    String(courseMeta.subtitle ?? ''),
    '',
    '## 课程目标',
    '',
    String(courseMeta.overall_goal ?? '暂无总目标'),
    '',
    '## 当前学习进度',
    '',
    `- 当前节点：${payload.currentNodeId && noteMetaById.get(payload.currentNodeId) ? `[[${noteMetaById.get(payload.currentNodeId)!.wikiTarget}|${noteMetaById.get(payload.currentNodeId)!.title}]]` : '暂无'}`,
    `- 已完成节点：${payload.completedNodeIds.length}`,
    `- 未通过节点：${Array.isArray(payload.failedNodeIds) ? payload.failedNodeIds.length : 0}`,
    `- 总节点数：${noteMetaById.size}`,
    '',
    '## 学习结果',
    '',
    renderBulletList(Array.isArray(courseMeta.learning_outcomes) ? courseMeta.learning_outcomes.map((item) => String(item)) : []),
    '',
    '## 推荐下一步',
    '',
    payload.currentNodeId && noteMetaById.get(payload.currentNodeId)
      ? `- 从 [[${noteMetaById.get(payload.currentNodeId)!.wikiTarget}|${noteMetaById.get(payload.currentNodeId)!.title}]] 继续，最贴近你当前的软件进度。`
      : '- 先从下方主线地图的第一条开始。',
    '',
    '## 主线地图',
    '',
    rootLinks.length ? rootLinks.join('\n') : '- 暂无主线',
    '',
    '## 使用建议',
    '',
    '- 在 Obsidian 中优先从这份总览进入，再沿着双链继续学习。',
    '- 学习完成后，可以直接在各节点笔记中追加你自己的例子和理解。',
    '',
    '## 笔记建议',
    '',
    '- 每学完一节，至少补一句“我的理解”，把知识转成自己的话。',
    '- 如果遇到卡点，可以在对应节点的“复习提醒”里写下下次回来看什么。',
  ]
    .filter(Boolean)
    .join('\n')

  const indexPath = path.join(rootDir, `${overviewNoteTitle}.md`)
  fs.writeFileSync(indexPath, overviewContent, 'utf-8')

  const progressPath = path.join(rootDir, `${progressNoteTitle}.md`)
  const existingProgressBoard = fs.existsSync(progressPath)
    ? fs.readFileSync(progressPath, 'utf-8')
    : fs.existsSync(legacyProgressPath)
      ? fs.readFileSync(legacyProgressPath, 'utf-8')
    : ''

  const progressBoardContent = [
    '---',
    `title: ${escapeYamlString(`${courseTitle} 学习看板`)}`,
    'aliases:',
    renderYamlList([`${courseTitle} 学习看板`, `${courseTitle} Progress Board`, '01 学习看板'], 2),
    `package_id: ${escapeYamlString(packageId)}`,
    `course_title: ${escapeYamlString(courseTitle)}`,
    `source_id: ${escapeYamlString(String(sourceMeta.source_id ?? ''))}`,
    `source_url: ${escapeYamlString(String(sourceMeta.url ?? ''))}`,
    `exported_at: ${escapeYamlString(exportedAt)}`,
    'tags:',
    renderYamlList(['视界专注', '学习看板', `课程/${courseTitle}`], 2),
    '---',
    '',
    `# ${courseTitle} 学习看板`,
    '',
    `> 回到视界专注：[继续当前进度](${buildAppDeepLink(packageId)})`,
    `> 返回课程总览：[[${overviewWikiTarget}|${courseTitle}]]`,
    '',
    ...renderMarkdownSection(
      '当前状态',
      [
        `- 当前节点：${payload.currentNodeId && noteMetaById.get(payload.currentNodeId) ? `[[${noteMetaById.get(payload.currentNodeId)!.wikiTarget}|${noteMetaById.get(payload.currentNodeId)!.title}]]` : '暂无'}`,
        `- 已完成：${payload.completedNodeIds.length} / ${noteMetaById.size}`,
        `- 待复盘：${failedLinks.length}`,
      ].join('\n'),
    ),
    ...renderMarkdownSection('已完成', completedLinks.length ? completedLinks.join('\n') : '- 还没有完成的节点'),
    ...renderMarkdownSection('需要回看', failedLinks.length ? failedLinks.join('\n') : '- 目前没有待复盘节点'),
    ...renderMarkdownSection('接下来可以学', pendingLinks.length ? pendingLinks.join('\n') : '- 所有节点都已经完成'),
    ...renderMarkdownSection(
      '今日学习记录',
      ['- 今天我最清楚的一点：', '- 今天我最模糊的一点：', '- 下一次打开时，我想先继续哪一节：'].join('\n'),
      existingProgressBoard,
    ),
  ]
    .filter(Boolean)
    .join('\n')

  fs.writeFileSync(progressPath, progressBoardContent, 'utf-8')

  if (legacyOverviewPath !== indexPath && fs.existsSync(legacyOverviewPath)) {
    fs.unlinkSync(legacyOverviewPath)
  }
  if (legacyProgressPath !== progressPath && fs.existsSync(legacyProgressPath)) {
    fs.unlinkSync(legacyProgressPath)
  }
  const currentNodePath =
    payload.currentNodeId && noteMetaById.get(payload.currentNodeId)
      ? noteMetaById.get(payload.currentNodeId)!.filePath
      : null

  return {
    vaultPath,
    rootDir,
    indexPath,
    progressPath,
    currentNodePath,
    fileCount: noteMetaById.size + 2,
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

function runPythonArchive(video: string, generateAi: boolean): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const runtimeSettings = loadSettings()
    const pythonCommand = resolvePythonCommand()
    const pythonEntryPath = resolveBackendScriptPath('main.py')
    const args = [...pythonCommand.prefixArgs, pythonEntryPath, video, '--result-json']
    if (!generateAi) args.push('--no-ai')
    emitArchiveLog(`启动归档任务：${video}`)
    appendRuntimeLog(`spawn command=${pythonCommand.command} args=${JSON.stringify(args)} cwd=${dataRoot}`)

    const child = spawn(pythonCommand.command, args, {
      cwd: dataRoot,
      windowsHide: true,
      env: buildPythonEnv(runtimeSettings),
    })

    let stdout = ''
    let stderr = ''
    let stdoutBuffer = ''

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      stdoutBuffer += text
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      const visibleLines: string[] = []
      for (const line of lines) {
        if (!line.trim()) continue
        const match = line.match(/^__BILIARCHIVE_PROGRESS__=(\{.*\})$/)
        if (match) {
          try {
            const payload = JSON.parse(match[1])
            emitArchiveProgress({
              message: String(payload?.message ?? ''),
              percent: Number(payload?.percent ?? 0),
            })
          } catch {
            // ignore malformed progress payload
          }
          continue
        }
        visibleLines.push(line)
      }
      if (visibleLines.length) {
        mainWindow?.webContents.send('archive-log', `${visibleLines.join('\n')}\n`)
      }
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      mainWindow?.webContents.send('archive-log', text)
    })

    child.on('error', (error) => {
      emitArchiveLog(`归档启动失败：${error.message}`)
      reject(error)
    })

    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        mainWindow?.webContents.send('archive-log', `${stdoutBuffer.trim()}\n`)
        stdoutBuffer = ''
      }
      if (code !== 0) {
        const message = stderr || stdout || `Python process exited with code ${code}`
        emitArchiveLog(`归档失败：${message}`)
        reject(new Error(message))
        return
      }

      const match = stdout.match(/__BILIARCHIVE_RESULT__=(\{.*\})/s)
      if (!match) {
        emitArchiveLog('归档失败：未能从 Python 输出中解析结果。')
        reject(new Error('未能从 Python 输出中解析结果。'))
        return
      }

      try {
        const parsed = JSON.parse(match[1])
        emitArchiveLog(`归档完成：${parsed.markdownPath}`)
        resolve(parsed)
      } catch (error) {
        emitArchiveLog(`归档失败：${error instanceof Error ? error.message : String(error)}`)
        reject(error as Error)
      }
    })
  })
}

function runPythonDistiller(payload: DistillPayload): Promise<DistillResult> {
  return new Promise((resolve, reject) => {
    const video = payload.video
    const runtimeSettings = loadSettings()
    const pythonCommand = resolvePythonCommand()
    const distillerEntryPath = resolveBackendScriptPath('distiller.py')
    const args = [...pythonCommand.prefixArgs, distillerEntryPath, video, '--result-json']
    appendRuntimeLog(`spawn distiller command=${pythonCommand.command} args=${JSON.stringify(args)} cwd=${dataRoot}`)
    emitDistillProgress({ message: '正在呼叫 AI 蒸馏课程，请稍候…', percent: 3 })

    const child = spawn(pythonCommand.command, args, {
      cwd: dataRoot,
      windowsHide: true,
      env: buildPythonEnv(runtimeSettings),
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
      appendRuntimeLog(`distiller resolved packagePath=${result.packagePath}`)
      resolve(result)
    }

    const timeoutHandle = setTimeout(() => {
      appendRuntimeLog(`distiller timeout after ${DISTILL_PROCESS_TIMEOUT_MS}ms; killing child pid=${child.pid ?? 'unknown'}`)
      emitDistillProgress({ message: '蒸馏阶段超时，正在终止后台任务…', percent: 96 })
      try {
        child.kill()
      } catch {
        // ignore kill failure
      }
      finalizeReject(new Error(`蒸馏阶段超时（>${Math.floor(DISTILL_PROCESS_TIMEOUT_MS / 1000)} 秒）。`))
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
              message: String(payload?.message ?? '正在蒸馏课程…'),
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
              batchCompleted: Number.isFinite(Number(payload?.batchCompleted)) ? Number(payload.batchCompleted) : undefined,
              batchTotal: Number.isFinite(Number(payload?.batchTotal)) ? Number(payload.batchTotal) : undefined,
              resumed: typeof payload?.resumed === 'boolean' ? payload.resumed : undefined,
              prefetchReuseChunkRatio: Number.isFinite(Number(payload?.prefetchReuseChunkRatio))
                ? Number(payload.prefetchReuseChunkRatio)
                : undefined,
              prefetchReuseBatchRatio: Number.isFinite(Number(payload?.prefetchReuseBatchRatio))
                ? Number(payload.prefetchReuseBatchRatio)
                : undefined,
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
      finalizeReject(new Error(`蒸馏进程启动失败：${error.message}`))
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
        finalizeReject(new Error('未能从蒸馏进程输出中解析结果。'))
        return
      }

      try {
        const parsed = JSON.parse(match[1]) as Omit<DistillResult, 'text'>
        if (!parsed.packagePath || !fs.existsSync(parsed.packagePath)) {
          throw new Error('蒸馏完成，但未找到生成的课程包文件。')
        }
        const courseText = normalizeCoursePackageText(fs.readFileSync(parsed.packagePath, 'utf-8'), parsed.packagePath).text
        emitDistillProgress({ message: '课程包已生成，正在注入伴学界面…', percent: 100, stage: 'injecting' })
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

ipcMain.handle('course:import', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Course Package JSON', extensions: ['json'] },
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
    throw new Error('未提供课程包路径。')
  }
  const text = normalizeCoursePackageText(fs.readFileSync(targetPath, 'utf-8'), targetPath).text
  return {
    path: targetPath,
    text,
  }
})

ipcMain.handle('distill:run', async (_event, payload: DistillPayload) => {
  return runPythonDistiller(payload)
})

ipcMain.handle('obsidian:export-course', async (_event, payload: ObsidianExportPayload) => {
  return exportCourseToObsidian(loadSettings(), payload)
})

ipcMain.handle(
  'obsidian:open-target',
  async (_event, payload: ObsidianExportPayload & { target?: 'current' | 'board' | 'index' }) => {
    return openObsidianTarget(loadSettings(), payload)
  },
)

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

ipcMain.handle('archive:run', async (_event, payload: { video: string; generateAi: boolean }) => {
  return runPythonArchive(payload.video, payload.generateAi)
})

ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
  if (!targetPath) return
  await shell.openPath(targetPath)
})

ipcMain.handle('shell:showItem', async (_event, targetPath: string) => {
  if (!targetPath) return
  shell.showItemInFolder(targetPath)
})

ipcMain.handle('shell:openExternal', async (_event, targetUrl: string) => {
  if (!targetUrl) return
  await shell.openExternal(targetUrl)
})

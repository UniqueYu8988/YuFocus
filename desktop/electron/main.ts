import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import Store from 'electron-store'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const APP_NAME = '视界专注'
const APP_ID = 'ShijieFocus'

app.name = APP_NAME
app.setAppUserModelId(APP_ID)

let mainWindow: BrowserWindow | null = null

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
const DISTILL_PROCESS_TIMEOUT_MS = 210_000

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
  text: string
}

type DistillPayload = {
  video: string
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

type LearningLibraryState = {
  currentRecordId: string | null
  records: Record<string, LearningRecord>
}

type LearningLibraryPayload = {
  currentRecordId: string | null
  records: LearningRecordSummary[]
}

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

function defaultSettings(): RuntimeSettings {
  return {
    sessdata: '',
    output_dir: path.join(dataRoot, 'output'),
    coach_api_base_url: 'https://api.minimaxi.com/v1',
    coach_api_key: '',
    coach_model: 'MiniMax-M2.7',
    distiller_api_base_url: 'https://api.minimaxi.com/v1',
    distiller_api_key: '',
    distiller_model: 'MiniMax-M2.7',
    groq_api_key: '',
    groq_transcription_model: 'whisper-large-v3-turbo',
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
    coach_api_base_url: sanitizeBaseUrl(raw?.coach_api_base_url ?? defaults.coach_api_base_url, defaults.coach_api_base_url),
    coach_api_key: sanitizeSecret(raw?.coach_api_key ?? defaults.coach_api_key),
    coach_model: sanitizeSecret(raw?.coach_model ?? defaults.coach_model) || defaults.coach_model,
    distiller_api_base_url: sanitizeBaseUrl(raw?.distiller_api_base_url ?? defaults.distiller_api_base_url, defaults.distiller_api_base_url),
    distiller_api_key: sanitizeSecret(raw?.distiller_api_key ?? defaults.distiller_api_key),
    distiller_model: sanitizeSecret(raw?.distiller_model ?? defaults.distiller_model) || defaults.distiller_model,
    groq_api_key: sanitizeSecret(raw?.groq_api_key ?? defaults.groq_api_key),
    groq_transcription_model:
      sanitizeSecret(raw?.groq_transcription_model ?? defaults.groq_transcription_model) || defaults.groq_transcription_model,
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

function defaultLearningLibraryState(): LearningLibraryState {
  return {
    currentRecordId: null,
    records: {},
  }
}

function normalizeNodeSession(raw: Partial<PersistedNodeLearningSession> | null | undefined, fallbackNodeId: string): PersistedNodeLearningSession {
  const messages = Array.isArray(raw?.messages) ? raw.messages : []
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
    lastUserAnswer: String(raw?.lastUserAnswer ?? ''),
    lastEvaluation: raw?.lastEvaluation === 'correct' || raw?.lastEvaluation === 'incorrect' ? raw.lastEvaluation : null,
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

  return {
    id: recordId,
    packageId: String(raw?.packageId ?? existing?.packageId ?? recordId),
    title: String(raw?.title ?? existing?.title ?? '未命名课程'),
    sourceTitle: String(raw?.sourceTitle ?? existing?.sourceTitle ?? raw?.title ?? '未命名来源'),
    sourceId: String(raw?.sourceId ?? existing?.sourceId ?? ''),
    sourceUrl: raw?.sourceUrl ?? existing?.sourceUrl ?? '',
    importedCoursePath:
      raw?.importedCoursePath === null
        ? null
        : String(raw?.importedCoursePath ?? existing?.importedCoursePath ?? '') || null,
    packagePath:
      raw?.packagePath === null
        ? null
        : String(raw?.packagePath ?? existing?.packagePath ?? '') || null,
    courseText: String(raw?.courseText ?? existing?.courseText ?? ''),
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
  const records = Object.entries(raw?.records ?? {}).reduce<Record<string, LearningRecord>>((accumulator, [recordId, record]) => {
    accumulator[recordId] = normalizeLearningRecord(record, undefined)
    return accumulator
  }, {})

  const currentRecordId =
    typeof raw?.currentRecordId === 'string' && records[raw.currentRecordId]
      ? raw.currentRecordId
      : null

  return {
    currentRecordId,
    records,
  }
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

function summarizeLearningRecord(record: LearningRecord): LearningRecordSummary {
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
  }
}

function loadLearningLibraryPayload(): LearningLibraryPayload {
  const library = loadLearningLibraryState()
  return {
    currentRecordId: library.currentRecordId,
    records: sortLearningRecords(Object.values(library.records)).map(summarizeLearningRecord),
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

function emitDistillProgress(payload: { message: string; percent: number }) {
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
    GROQ_API_KEY: settings.groq_api_key,
    GROQ_TRANSCRIPTION_MODEL: settings.groq_transcription_model,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
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
    frame: true,
    backgroundColor: '#202020',
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
  })

  mainWindow.on('focus', () => {
    mainWindow?.setBackgroundColor('#202020')
    mainWindow?.webContents.send('window:focus-changed', { focused: true })
  })

  mainWindow.on('blur', () => {
    mainWindow?.setBackgroundColor('#1b1b1b')
    mainWindow?.webContents.send('window:focus-changed', { focused: false })
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
        const courseText = fs.readFileSync(parsed.packagePath, 'utf-8')
        emitDistillProgress({ message: '课程包已生成，正在注入伴学界面…', percent: 100 })
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

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
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
  const text = fs.readFileSync(targetPath, 'utf-8')
  return {
    path: targetPath,
    text,
  }
})

ipcMain.handle('course:read', async (_event, targetPath: string) => {
  if (!targetPath) {
    throw new Error('未提供课程包路径。')
  }
  const text = fs.readFileSync(targetPath, 'utf-8')
  return {
    path: targetPath,
    text,
  }
})

ipcMain.handle('distill:run', async (_event, payload: DistillPayload) => {
  return runPythonDistiller(payload)
})

ipcMain.handle('learning:library:load', async () => loadLearningLibraryPayload())

ipcMain.handle('learning:library:open', async (_event, recordId: string) => {
  if (!recordId) {
    throw new Error('未提供学习记录 ID。')
  }
  return openLearningRecord(recordId)
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

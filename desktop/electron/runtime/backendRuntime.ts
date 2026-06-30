import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { getComparablePath, isPathInsideRoot } from '../services/pathSafety'
import { sanitizeResourceMode, type RuntimeSettings } from './settings'
import { normalizeStudyPackageText } from '../legacy/studyPackageCompat'
import { sanitizeEditorialSummaryMode, type EditorialSummaryMode } from '../queue/workbenchQueue'

export type BackendRuntimeContext = {
  devProjectRoot: string
  dataRoot: string
  userDataRoot: string
  settingsPath: string
  resourcesPath: string
  execPath: string
  appVersion: string
  isPackaged: boolean
  distillProcessTimeoutMs: number
  loadSettings: () => RuntimeSettings
  resolveMaterialOutputDir: (settings: RuntimeSettings) => string
  appendRuntimeLog: (message: string) => void
  emitDistillProgress: (payload: DistillProgressPayload) => void
}

export type DistillResult = {
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

export type MaterialSummaryResult = {
  materialPath: string
  editorialArticlePath: string
  editorialHtmlPath?: string
  editorialCardsPath?: string
  editorialReviewPath?: string
  editorialSummary?: Record<string, unknown>
}

export type DistillOutlinePreview = {
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

export type DistillProgressPayload = {
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

export type DistillPayload = {
  video?: string
  sourceKind?: 'bilibili' | 'local_media'
  mediaPath?: string
  editorialMode?: EditorialSummaryMode
}

export type MaterialSummaryPayload = {
  materialPath?: string
  editorialMode?: EditorialSummaryMode
}

let backendRuntimeContext: BackendRuntimeContext | null = null

function getBackendRuntimeContext() {
  if (!backendRuntimeContext) {
    throw new Error('Backend runtime has not been initialized.')
  }
  return backendRuntimeContext
}

export function createBackendRuntime(context: BackendRuntimeContext) {
  backendRuntimeContext = context
  return {
    runPythonDistiller,
    runPythonMaterialSummary,
  }
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
  const context = getBackendRuntimeContext()
  const candidates = [
    path.join(context.resourcesPath, 'backend'),
    path.join(path.dirname(context.execPath), 'resources', 'backend'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'distiller.py')) && fs.existsSync(path.join(candidate, 'main.py'))) {
      return candidate
    }
  }

  throw new Error(`未找到打包后的 backend 资源目录。已检查：${candidates.join('；')}`)
}

function ensureBackendRuntimeRoot() {
  const context = getBackendRuntimeContext()
  if (!context.isPackaged) {
    return path.join(context.devProjectRoot, 'src')
  }

  const packagedBackendRoot = resolvePackagedBackendResourceRoot()
  const runtimeBackendRoot = path.join(context.userDataRoot, 'backend-runtime')
  const markerPath = path.join(runtimeBackendRoot, '.runtime-version.json')
  const expectedMarker = JSON.stringify(
    {
      appVersion: context.appVersion,
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
    context.appendRuntimeLog(`backend runtime synced from ${packagedBackendRoot} -> ${runtimeBackendRoot}`)
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

function resolveMiMoTextEndpoint(settings: RuntimeSettings) {
  const apiKey = settings.mimo_api_key.trim()
  const isTokenPlan = apiKey.startsWith('tp-')
  const defaultPayAsYouGoEndpoint = 'https://api.xiaomimimo.com/v1/chat/completions'
  const defaultTokenPlanEndpoint = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
  let endpoint =
    settings.mimo_text_endpoint.trim() ||
    process.env.SHIJIE_MIMO_CLEANING_ENDPOINT ||
    process.env.SHIJIE_MIMO_ENDPOINT ||
    (isTokenPlan ? defaultTokenPlanEndpoint : defaultPayAsYouGoEndpoint)

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

function resolveMiMoTtsEndpoint(settings: RuntimeSettings) {
  const endpoint = settings.mimo_tts_endpoint.trim() || 'https://api.xiaomimimo.com/v1/chat/completions'
  return endpoint.replace(/\/+$/, '')
}

function buildPythonEnv(settings: RuntimeSettings, extraEnv: NodeJS.ProcessEnv = {}) {
  const context = getBackendRuntimeContext()
  const resourceMode = sanitizeResourceMode(settings.resource_mode)
  const configuredLocalDevice = settings.local_transcription_device || 'cuda:0'
  const localTranscriptionDevice =
    resourceMode === 'background' && configuredLocalDevice.toLowerCase().startsWith('cuda')
      ? 'cpu'
      : configuredLocalDevice
  const mimoApiKey = settings.mimo_api_key.trim() || process.env.SHIJIE_MIMO_API_KEY || ''
  const mimoTextEndpoint = resolveMiMoTextEndpoint(settings)
  const configuredMimoTextModel = settings.mimo_text_model.trim()
  const mimoTextModel =
    (configuredMimoTextModel === 'mimo-v2.5-pro' ? 'mimo-v2.5' : configuredMimoTextModel) ||
    process.env.SHIJIE_MIMO_EDITORIAL_MODEL ||
    process.env.SHIJIE_MIMO_CLEANING_MODEL ||
    process.env.SHIJIE_MIMO_MODEL ||
    'mimo-v2.5'
  const mimoTtsEndpoint = resolveMiMoTtsEndpoint(settings)
  const mimoTtsModel = settings.mimo_tts_model.trim() || 'mimo-v2.5-tts'
  const contentCleaningWorkers = resourceMode === 'background' ? '1' : resourceMode === 'fast' ? '3' : '2'
  const contentCleaningChunkChars = resourceMode === 'background' ? '6000' : '7000'
  const resourceProfile: Record<string, string> =
    resourceMode === 'background'
      ? {
          SHIJIE_RESOURCE_MODE: 'background',
          SHIJIE_BACKGROUND_MODE: '1',
          SHIJIE_AUDIO_PREPARE_WORKERS: '1',
          SHIJIE_AUDIO_TRANSCRIBE_WORKERS: '1',
          SHIJIE_AUDIO_CHUNK_WORKERS: '1',
          SHIJIE_LOCAL_AUDIO_TRANSCRIBE_WORKERS: '1',
          SHIJIE_LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS: '120',
          SHIJIE_AUDIO_MAX_CHUNK_SECONDS: '300',
        }
      : resourceMode === 'fast'
        ? {
            SHIJIE_RESOURCE_MODE: 'fast',
            SHIJIE_BACKGROUND_MODE: '0',
            SHIJIE_AUDIO_PREPARE_WORKERS: '3',
            SHIJIE_AUDIO_TRANSCRIBE_WORKERS: '4',
            SHIJIE_AUDIO_CHUNK_WORKERS: '4',
            SHIJIE_LOCAL_AUDIO_TRANSCRIBE_WORKERS: '1',
            SHIJIE_LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS: '300',
            SHIJIE_AUDIO_MAX_CHUNK_SECONDS: '480',
          }
        : {
            SHIJIE_RESOURCE_MODE: 'balanced',
            SHIJIE_BACKGROUND_MODE: '0',
            SHIJIE_AUDIO_PREPARE_WORKERS: '2',
            SHIJIE_AUDIO_TRANSCRIBE_WORKERS: '3',
            SHIJIE_AUDIO_CHUNK_WORKERS: '3',
            SHIJIE_LOCAL_AUDIO_TRANSCRIBE_WORKERS: '1',
            SHIJIE_LOCAL_SENSEVOICE_MAX_CHUNK_SECONDS: '240',
            SHIJIE_AUDIO_MAX_CHUNK_SECONDS: '480',
          }

  return {
    ...process.env,
    ...resourceProfile,
    ...extraEnv,
    SHIJIE_FOCUS_HOME: context.dataRoot,
    SHIJIE_FOCUS_SETTINGS_PATH: context.settingsPath,
    SHIJIE_FOCUS_OUTPUT_DIR: settings.output_dir,
    BILIBILI_SESSDATA: settings.sessdata,
    SHIJIE_TRANSCRIPTION_PROVIDER: settings.transcription_provider,
    SHIJIE_LOCAL_TRANSCRIPTION_ROOT: settings.local_transcription_root,
    SHIJIE_LOCAL_TRANSCRIPTION_PYTHON: settings.local_transcription_python,
    SHIJIE_LOCAL_TRANSCRIPTION_MODEL_ID: settings.local_transcription_model_id,
    SHIJIE_LOCAL_TRANSCRIPTION_DEVICE: localTranscriptionDevice,
    SHIJIE_LOCAL_TRANSCRIPTION_LANGUAGE: settings.local_transcription_language,
    SHIJIE_RESOURCE_MODE: resourceMode,
    SHIJIE_MIMO_API_KEY: mimoApiKey,
    SHIJIE_MIMO_ENDPOINT: mimoTextEndpoint,
    SHIJIE_MIMO_CLEANING_ENDPOINT: mimoTextEndpoint,
    SHIJIE_MIMO_TTS_ENDPOINT: mimoTtsEndpoint,
    SHIJIE_MIMO_MODEL: mimoTextModel,
    SHIJIE_MIMO_TTS_MODEL: mimoTtsModel,
    SHIJIE_MIMO_CLEANING_MODEL: mimoTextModel,
    SHIJIE_MIMO_EDITORIAL_MODEL: mimoTextModel,
    SHIJIE_CONTENT_CLEANING_MODE: mimoApiKey ? 'auto' : 'rule',
    SHIJIE_CONTENT_CLEANING_WORKERS: contentCleaningWorkers,
    SHIJIE_CONTENT_CLEANING_CHUNK_CHARS: contentCleaningChunkChars,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
  }
}

function runPythonDistiller(payload: DistillPayload): Promise<DistillResult> {
  return new Promise((resolve, reject) => {
    const context = getBackendRuntimeContext()
    const sourceKind = payload.sourceKind === 'local_media' ? 'local_media' : 'bilibili'
    const inputValue = sourceKind === 'local_media'
      ? String(payload.mediaPath ?? payload.video ?? '').trim()
      : String(payload.video ?? '').trim()
    if (!inputValue) {
      reject(new Error(sourceKind === 'local_media' ? '请先选择本地音视频文件。' : '请先填写 B 站视频链接或 BV 号。'))
      return
    }
    const runtimeSettings = context.loadSettings()
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
    const materialOutputDir = context.resolveMaterialOutputDir(runtimeSettings)
    fs.mkdirSync(materialOutputDir, { recursive: true })
    context.appendRuntimeLog(`spawn material builder command=${pythonCommand.command} args=${JSON.stringify(args)} cwd=${context.dataRoot}`)
    context.emitDistillProgress({ message: '正在整理资料包，请稍候…', percent: 3 })

    const child = spawn(pythonCommand.command, args, {
      cwd: context.dataRoot,
      windowsHide: true,
      env: {
        ...buildPythonEnv(runtimeSettings, {
          SHIJIE_EDITORIAL_SUMMARY_MODE: sanitizeEditorialSummaryMode(payload.editorialMode),
        }),
      },
    })

    let stdout = ''
    let stderr = ''
    let stdoutBuffer = ''
    let settled = false

    const finalizeReject = (error: Error) => {
      if (settled) return
      settled = true
      context.appendRuntimeLog(`distiller rejected: ${error.message}`)
      reject(error)
    }

    const finalizeResolve = (result: DistillResult) => {
      if (settled) return
      settled = true
      context.appendRuntimeLog(`material builder resolved packagePath=${result.packagePath} materialPath=${result.materialPath ?? ''}`)
      resolve(result)
    }

    const timeoutHandle = setTimeout(() => {
      context.appendRuntimeLog(`distiller timeout after ${context.distillProcessTimeoutMs}ms; killing child pid=${child.pid ?? 'unknown'}`)
      context.emitDistillProgress({ message: '整理阶段超时，正在终止后台任务…', percent: 96 })
      try {
        child.kill()
      } catch {
        // ignore kill failure
      }
      finalizeReject(new Error(`整理阶段超时（>${Math.floor(context.distillProcessTimeoutMs / 1000)} 秒）。`))
    }, context.distillProcessTimeoutMs)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      stdoutBuffer += text
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        const match = line.match(/^__(?:SHIJIE|ONBOARD)_DISTILL_PROGRESS__=(\{.*\})$/)
        if (match) {
          try {
            const payload = JSON.parse(match[1])
            context.emitDistillProgress({
              message: String(payload?.message ?? '正在整理资料包…'),
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
      context.appendRuntimeLog(`distiller stderr ${text.trim()}`)
    })

    child.on('error', (error) => {
      clearTimeout(timeoutHandle)
      context.appendRuntimeLog(`distiller process error: ${error.message}`)
      finalizeReject(new Error(`整理进程启动失败：${error.message}`))
    })

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle)
      if (stdoutBuffer.trim()) {
        stdout += `\n${stdoutBuffer.trim()}`
        stdoutBuffer = ''
      }

      context.appendRuntimeLog(
        `distiller close code=${String(code)} signal=${String(signal)} stdoutLength=${stdout.length} stderrLength=${stderr.length}`,
      )

      if (settled) {
        context.appendRuntimeLog('distiller close ignored because promise already settled.')
        return
      }

      if (code !== 0) {
        const message = (stderr || stdout || `Python process exited with code ${code}`).trim()
        finalizeReject(new Error(message))
        return
      }

      const match = stdout.match(/__(?:SHIJIE|ONBOARD)_DISTILL_RESULT__=(\{.*\})/s)
      if (!match) {
        context.appendRuntimeLog(`distiller stdout tail=${stdout.slice(-800)}`)
        finalizeReject(new Error('未能从整理进程输出中解析结果。'))
        return
      }

      try {
        const parsed = JSON.parse(match[1]) as Omit<DistillResult, 'text'>
        if (!parsed.materialPath || !fs.existsSync(parsed.materialPath)) {
        throw new Error('整理完成，但未找到生成的资料包。')
        }
        const courseText =
          parsed.packagePath && fs.existsSync(parsed.packagePath)
            ? normalizeStudyPackageText(fs.readFileSync(parsed.packagePath, 'utf-8'), parsed.packagePath).text
            : ''
        context.emitDistillProgress({ message: '资料包已生成。', percent: 100, stage: 'complete' })
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

function runPythonMaterialSummary(payload: MaterialSummaryPayload): Promise<MaterialSummaryResult> {
  return new Promise((resolve, reject) => {
    const context = getBackendRuntimeContext()
    const runtimeSettings = context.loadSettings()
    const materialOutputDir = context.resolveMaterialOutputDir(runtimeSettings)
    const requestedPath = String(payload.materialPath ?? '').trim()
    if (!requestedPath) {
      reject(new Error('请先选择要制作文稿的资料包。'))
      return
    }
    const materialPath = path.resolve(requestedPath)
    if (!isPathInsideRoot(materialPath, materialOutputDir) || getComparablePath(materialPath) === getComparablePath(materialOutputDir)) {
      reject(new Error('资料包不在当前项目输出目录内。'))
      return
    }
    if (!fs.existsSync(materialPath) || !fs.statSync(materialPath).isDirectory()) {
      reject(new Error('资料包目录不存在。'))
      return
    }

    const pythonCommand = resolvePythonCommand()
    const distillerEntryPath = resolveBackendScriptPath('distiller.py')
    const args = [
      ...pythonCommand.prefixArgs,
      distillerEntryPath,
      '--summarize-material',
      materialPath,
      '--result-json',
    ]
    context.appendRuntimeLog(`spawn material summary command=${pythonCommand.command} args=${JSON.stringify(args)} cwd=${context.dataRoot}`)
    context.emitDistillProgress({ message: '正在制作视频精读稿…', percent: 5, stage: 'editorial_summary' })

    const child = spawn(pythonCommand.command, args, {
      cwd: context.dataRoot,
      windowsHide: true,
      env: {
        ...buildPythonEnv(runtimeSettings, {
          SHIJIE_EDITORIAL_SUMMARY_MODE: sanitizeEditorialSummaryMode(payload.editorialMode ?? 'force'),
        }),
      },
    })

    let stdout = ''
    let stderr = ''
    let stdoutBuffer = ''
    let settled = false

    const finalizeReject = (error: Error) => {
      if (settled) return
      settled = true
      context.appendRuntimeLog(`material summary rejected: ${error.message}`)
      reject(error)
    }

    const finalizeResolve = (result: MaterialSummaryResult) => {
      if (settled) return
      settled = true
      context.appendRuntimeLog(`material summary resolved materialPath=${result.materialPath}`)
      resolve(result)
    }

    const timeoutHandle = setTimeout(() => {
      context.appendRuntimeLog(`material summary timeout after ${context.distillProcessTimeoutMs}ms; killing child pid=${child.pid ?? 'unknown'}`)
      context.emitDistillProgress({ message: '视频编稿超时，正在终止后台任务…', percent: 96, stage: 'editorial_summary' })
      try {
        child.kill()
      } catch {
        // ignore kill failure
      }
      finalizeReject(new Error(`视频编稿超时（>${Math.floor(context.distillProcessTimeoutMs / 1000)} 秒）。`))
    }, context.distillProcessTimeoutMs)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      stdoutBuffer += text
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        const match = line.match(/^__(?:SHIJIE|ONBOARD)_DISTILL_PROGRESS__=(\{.*\})$/)
        if (!match) continue
        try {
          const progressPayload = JSON.parse(match[1])
          context.emitDistillProgress({
            message: String(progressPayload?.message ?? '正在制作视频精读稿…'),
            percent: Number(progressPayload?.percent ?? 0),
            stage: typeof progressPayload?.stage === 'string' ? progressPayload.stage : undefined,
          })
        } catch {
          // ignore malformed progress payload
        }
      }
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      context.appendRuntimeLog(`material summary stderr ${text.trim()}`)
    })

    child.on('error', (error) => {
      clearTimeout(timeoutHandle)
      finalizeReject(new Error(`视频编稿进程启动失败：${error.message}`))
    })

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle)
      if (stdoutBuffer.trim()) {
        stdout += `\n${stdoutBuffer.trim()}`
        stdoutBuffer = ''
      }
      context.appendRuntimeLog(
        `material summary close code=${String(code)} signal=${String(signal)} stdoutLength=${stdout.length} stderrLength=${stderr.length}`,
      )

      if (settled) return
      if (code !== 0) {
        const message = (stderr || stdout || `Python process exited with code ${code}`).trim()
        finalizeReject(new Error(message))
        return
      }

      const match = stdout.match(/__(?:SHIJIE|ONBOARD)_DISTILL_RESULT__=(\{.*\})/s)
      if (!match) {
        context.appendRuntimeLog(`material summary stdout tail=${stdout.slice(-800)}`)
        finalizeReject(new Error('未能从视频编稿进程输出中解析结果。'))
        return
      }

      try {
        const parsed = JSON.parse(match[1]) as MaterialSummaryResult
        if (!parsed.materialPath || !fs.existsSync(parsed.materialPath)) {
          throw new Error('视频编稿完成，但未找到资料包。')
        }
        context.emitDistillProgress({ message: '视频精读稿已生成。', percent: 100, stage: 'complete' })
        finalizeResolve(parsed)
      } catch (error) {
        finalizeReject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

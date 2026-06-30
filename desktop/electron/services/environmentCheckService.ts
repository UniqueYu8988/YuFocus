import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { RuntimeSettings } from '../runtime/settings'

export type EnvironmentCheckStatus = 'ok' | 'warning' | 'missing' | 'error'

export type EnvironmentCheckItem = {
  id: string
  label: string
  status: EnvironmentCheckStatus
  message: string
  detail?: string
  nextAction?: string
}

export type EnvironmentCheckPayload = {
  checkedAt: number
  runtime: {
    isPackaged: boolean
    dataRoot: string
    canonicalDataRoot: string
    userDataRoot: string
    backendRoot: string
  }
  items: EnvironmentCheckItem[]
}

type EnvironmentCheckOptions = {
  devProjectRoot: string
  dataRoot: string
  canonicalDataRoot: string
  userDataRoot: string
  resourcesPath: string
  execPath: string
  isPackaged: boolean
  loadSettings: () => RuntimeSettings
}

type PythonProbe = {
  command: string
  prefixArgs: string[]
  version?: string
  error?: string
}

const REQUIRED_PYTHON_MODULES = [
  { importName: 'requests', label: 'requests' },
  { importName: 'yt_dlp', label: 'yt-dlp' },
  { importName: 'jsonschema', label: 'jsonschema' },
  { importName: 'PySide6', label: 'PySide6' },
  { importName: 'imageio_ffmpeg', label: 'imageio-ffmpeg' },
]

const DEFAULT_ENVIRONMENT_CHECK_OLLAMA_MODEL = 'shijie-qwen3-8b-q4-chat'

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

function resolvePythonCommand(): PythonProbe {
  if (process.platform !== 'win32') {
    return { command: findExecutableOnPath(['python3', 'python']) || 'python3', prefixArgs: [] }
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
  const candidates = [
    findExecutableOnPath(['python.exe', 'python']),
    path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python310', 'python.exe'),
  ].filter((value): value is string => Boolean(value && fs.existsSync(value)))

  if (candidates[0]) return { command: candidates[0], prefixArgs: [] }

  const pyLauncher = findExecutableOnPath(['py.exe', 'py'])
  if (pyLauncher) return { command: pyLauncher, prefixArgs: ['-3'] }

  return { command: 'python', prefixArgs: [] }
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        PYTHONUNBUFFERED: '1',
      },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      reject(new Error('检查超时'))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

async function checkPythonRuntime(): Promise<{ item: EnvironmentCheckItem; probe: PythonProbe | null }> {
  const probe = resolvePythonCommand()
  try {
    const result = await runProcess(
      probe.command,
      [
        ...probe.prefixArgs,
        '-c',
        'import json, sys; print(json.dumps({"version": sys.version.split()[0], "executable": sys.executable}, ensure_ascii=False))',
      ],
      5000,
    )
    if (result.code !== 0) {
      return {
        probe: null,
        item: {
          id: 'python',
          label: 'Python',
          status: 'error',
          message: 'Python 可执行文件存在，但无法正常启动。',
          detail: (result.stderr || result.stdout).trim().slice(0, 300),
          nextAction: '检查 Python 安装或 PATH。',
        },
      }
    }
    const payload = JSON.parse(result.stdout.trim()) as { version?: string; executable?: string }
    return {
      probe: { ...probe, version: payload.version },
      item: {
        id: 'python',
        label: 'Python',
        status: 'ok',
        message: `Python ${payload.version || ''} 可用。`.trim(),
        detail: payload.executable,
      },
    }
  } catch (error) {
    return {
      probe: null,
      item: {
        id: 'python',
        label: 'Python',
        status: 'missing',
        message: '未找到可用 Python。',
        detail: error instanceof Error ? error.message : String(error),
        nextAction: '安装 Python 3.10+，或把 python 加入 PATH。',
      },
    }
  }
}

async function checkPythonDependencies(probe: PythonProbe | null): Promise<EnvironmentCheckItem> {
  if (!probe) {
    return {
      id: 'python_dependencies',
      label: 'Python 依赖',
      status: 'missing',
      message: 'Python 不可用，暂不能检查依赖。',
      nextAction: '先修复 Python。',
    }
  }

  const script = [
    'import importlib.util, json',
    `mods = ${JSON.stringify(REQUIRED_PYTHON_MODULES.map((item) => item.importName))}`,
    'missing = [name for name in mods if importlib.util.find_spec(name) is None]',
    'print(json.dumps({"missing": missing}, ensure_ascii=False))',
  ].join('; ')

  try {
    const result = await runProcess(probe.command, [...probe.prefixArgs, '-c', script], 8000)
    if (result.code !== 0) {
      return {
        id: 'python_dependencies',
        label: 'Python 依赖',
        status: 'error',
        message: '依赖检查无法完成。',
        detail: (result.stderr || result.stdout).trim().slice(0, 300),
      }
    }
    const payload = JSON.parse(result.stdout.trim()) as { missing?: string[] }
    const missing = payload.missing ?? []
    if (missing.length) {
      const labels = REQUIRED_PYTHON_MODULES
        .filter((item) => missing.includes(item.importName))
        .map((item) => item.label)
      return {
        id: 'python_dependencies',
        label: 'Python 依赖',
        status: 'missing',
        message: `缺少 ${labels.join('、')}。`,
        nextAction: '在项目环境中安装 requirements.txt。',
      }
    }
    return {
      id: 'python_dependencies',
      label: 'Python 依赖',
      status: 'ok',
      message: '字幕主线所需 Python 依赖已可解析。',
    }
  } catch (error) {
    return {
      id: 'python_dependencies',
      label: 'Python 依赖',
      status: 'error',
      message: '依赖检查失败。',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

function resolveBackendRoot(options: EnvironmentCheckOptions) {
  if (!options.isPackaged) return path.join(options.devProjectRoot, 'src')

  const runtimeBackendRoot = path.join(options.userDataRoot, 'backend-runtime')
  if (fs.existsSync(path.join(runtimeBackendRoot, 'distiller.py'))) return runtimeBackendRoot

  const candidates = [
    path.join(options.resourcesPath, 'backend'),
    path.join(path.dirname(options.execPath), 'resources', 'backend'),
  ]
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'distiller.py'))) || candidates[0]
}

function checkBackendScripts(backendRoot: string): EnvironmentCheckItem {
  const missing = ['distiller.py', 'config.py', 'bilibili_api.py', 'local_audio_client.py']
    .filter((fileName) => !fs.existsSync(path.join(backendRoot, fileName)))

  if (missing.length) {
    return {
      id: 'backend_scripts',
      label: '内置后端脚本',
      status: 'error',
      message: `缺少 ${missing.join('、')}。`,
      detail: backendRoot,
      nextAction: '重新构建便携版，确认 resources/backend 被打包。',
    }
  }

  return {
    id: 'backend_scripts',
    label: '内置后端脚本',
    status: 'ok',
    message: 'Python 后端脚本可用。',
    detail: backendRoot,
  }
}

function checkLocalTranscription(settings: RuntimeSettings): EnvironmentCheckItem {
  const root = settings.local_transcription_root.trim()
  if (!root) {
    return {
      id: 'sensevoice',
      label: '本地 SenseVoice',
      status: 'missing',
      message: '未配置本地转写目录。',
      nextAction: '在设置中填写包含 local_audio_distiller.py 的目录。',
    }
  }

  const resolvedRoot = path.resolve(root)
  const entryPath = path.join(resolvedRoot, 'local_audio_distiller.py')
  const configuredPython = settings.local_transcription_python.trim()
  const pythonCandidates = [
    configuredPython ? path.resolve(configuredPython) : '',
    path.join(resolvedRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(resolvedRoot, '.venv', 'bin', 'python'),
    path.join(resolvedRoot, 'python.exe'),
  ].filter(Boolean)
  const pythonPath = pythonCandidates.find((candidate) => fs.existsSync(candidate))

  if (!fs.existsSync(resolvedRoot)) {
    return {
      id: 'sensevoice',
      label: '本地 SenseVoice',
      status: 'missing',
      message: '本地转写目录不存在。',
      detail: resolvedRoot,
      nextAction: '检查目录位置，或重新选择本地转写环境。',
    }
  }
  if (!fs.existsSync(entryPath)) {
    return {
      id: 'sensevoice',
      label: '本地 SenseVoice',
      status: 'missing',
      message: '未找到 local_audio_distiller.py。',
      detail: resolvedRoot,
      nextAction: '确认本地 SenseVoice 环境目录是否正确。',
    }
  }
  if (!pythonPath) {
    return {
      id: 'sensevoice',
      label: '本地 SenseVoice',
      status: 'missing',
      message: '未找到本地转写 Python。',
      detail: resolvedRoot,
      nextAction: '填写本地转写 Python，或确认 .venv 已创建。',
    }
  }

  return {
    id: 'sensevoice',
    label: '本地 SenseVoice',
    status: 'ok',
    message: '本地转写目录结构可用，模型会在需要转写时加载。',
    detail: pythonPath,
  }
}

async function checkOllama(): Promise<EnvironmentCheckItem> {
  const endpoint = process.env.LOCAL_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434/api/chat'
  const model = process.env.LOCAL_OLLAMA_MODEL || DEFAULT_ENVIRONMENT_CHECK_OLLAMA_MODEL
  const tagsEndpoint = endpoint.replace(/\/api\/chat\/?$/i, '/api/tags')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1800)
  try {
    const response = await fetch(tagsEndpoint, { signal: controller.signal })
    if (!response.ok) {
      return {
        id: 'ollama',
        label: '本地 Ollama',
        status: 'error',
        message: `Ollama 响应异常：HTTP ${response.status}。`,
        detail: tagsEndpoint,
      }
    }
    const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> }
    const names = (payload.models ?? []).flatMap((item) => [item.name, item.model]).filter((value): value is string => Boolean(value))
    const found = names.some((name) => name === model || name.startsWith(`${model}:`))
    if (!found) {
      return {
        id: 'ollama',
        label: '本地 Ollama',
        status: 'missing',
        message: `Ollama 可连接，但未找到模型 ${model}。`,
        detail: names.slice(0, 8).join('、') || '未返回模型列表',
        nextAction: '确认本地模型已导入 Ollama。',
      }
    }
    return {
      id: 'ollama',
      label: '本地 Ollama',
      status: 'ok',
      message: `Ollama 可用，模型 ${model} 已存在。`,
    }
  } catch (error) {
    return {
      id: 'ollama',
      label: '本地 Ollama',
      status: 'missing',
      message: '未连接到 Ollama。',
      detail: error instanceof Error ? error.message : String(error),
      nextAction: '启动 Ollama 后再生成本地 brief；浏览和 NotebookLM 主资料不受影响。',
    }
  } finally {
    clearTimeout(timer)
  }
}

function checkConfiguredServices(settings: RuntimeSettings): EnvironmentCheckItem[] {
  const smtpReady = Boolean(
    settings.email_push_enabled &&
    settings.email_smtp_host.trim() &&
    settings.email_smtp_user.trim() &&
    settings.email_smtp_password.trim() &&
    settings.email_from.trim() &&
    settings.email_to.trim(),
  )

  return [
    {
      id: 'mimo',
      label: 'MiMo 清洗',
      status: settings.mimo_api_key.trim() ? 'ok' : 'missing',
      message: settings.mimo_api_key.trim() ? 'MiMo API Key 已配置，清洗时按需调用。' : 'MiMo API Key 未配置；需要时会使用规则清洗或提示配置。',
    },
    {
      id: 'bilibili_cookie',
      label: 'B 站凭据',
      status: settings.sessdata.trim() ? 'ok' : 'missing',
      message: settings.sessdata.trim() ? 'B 站 SESSDATA 已配置。' : 'B 站 SESSDATA 未配置。',
      nextAction: settings.sessdata.trim() ? undefined : '配置后才能读取账号相关来源和部分字幕。',
    },
    {
      id: 'smtp',
      label: 'SMTP 邮件',
      status: smtpReady ? 'ok' : settings.email_push_enabled ? 'missing' : 'warning',
      message: smtpReady
        ? '最近更新邮件配置完整，fresh 视频完成后才会按需发送。'
        : settings.email_push_enabled
          ? '邮件推送已启用，但 SMTP 配置不完整。'
          : '邮件推送未启用；不会自动发送邮件。',
      nextAction: smtpReady || !settings.email_push_enabled ? undefined : '补齐 SMTP 主机、用户、授权码、发件人和收件人。',
    },
  ]
}

export async function runEnvironmentCheck(options: EnvironmentCheckOptions): Promise<EnvironmentCheckPayload> {
  const settings = options.loadSettings()
  const backendRoot = resolveBackendRoot(options)
  const python = await checkPythonRuntime()
  const items: EnvironmentCheckItem[] = [
    checkBackendScripts(backendRoot),
    python.item,
    await checkPythonDependencies(python.probe),
    checkLocalTranscription(settings),
    await checkOllama(),
    ...checkConfiguredServices(settings),
  ]

  return {
    checkedAt: Date.now(),
    runtime: {
      isPackaged: options.isPackaged,
      dataRoot: options.dataRoot,
      canonicalDataRoot: options.canonicalDataRoot,
      userDataRoot: options.userDataRoot,
      backendRoot,
    },
    items,
  }
}

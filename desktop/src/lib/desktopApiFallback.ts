import { estimateMiniMaxSpeechCharacters } from './tts'

const STORAGE_KEY = 'shijie-focus-browser-settings'

type RuntimeSettingsShape = Awaited<ReturnType<Window['desktopAPI']['loadSettings']>>

const defaultRuntimeSettings: RuntimeSettingsShape = {
  sessdata: '',
  output_dir: '',
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
  mimo_text_endpoint: 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
  mimo_text_model: 'mimo-v2.5-pro',
  mimo_tts_endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
  mimo_tts_model: 'mimo-v2.5-tts',
  mimo_tts_voice_id: '茉莉',
  mimo_tts_style_prompt: '自然 清晰 语速适中',
  transcription_provider: 'local_sensevoice',
  local_transcription_root: '',
  local_transcription_python: '',
  local_transcription_model_id: '',
  local_transcription_device: '',
  local_transcription_language: '',
  resource_mode: 'balanced',
  background_automation_enabled: true,
  background_check_interval_minutes: 360,
  email_push_enabled: false,
  email_smtp_host: '',
  email_smtp_port: 465,
  email_smtp_secure: true,
  email_smtp_user: '',
  email_smtp_password: '',
  email_from: '',
  email_to: '',
  workbench_queue_concurrency: 3,
}

const defaultAutomationStatus = {
  enabled: true,
  paused: false,
  running: false,
  lastCheckAt: null,
  nextCheckAt: null,
  lastResult: '浏览器预览模式不运行后台任务。',
  lastError: null,
  checkIntervalMinutes: 360,
}

function loadBrowserSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    return raw ? { ...defaultRuntimeSettings, ...JSON.parse(raw) } : defaultRuntimeSettings
  } catch {
    return defaultRuntimeSettings
  }
}

function saveBrowserSettings(settings: RuntimeSettingsShape) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Browser preview can run with storage disabled; settings simply become session-only.
  }
  return settings
}

function unavailable(action: string) {
  return new Error(`${action} 需要在 Electron 桌面端中使用。`)
}

function toViteFileUrl(targetPath: string) {
  const normalizedPath = targetPath.replace(/^\/([A-Za-z]:)/, '$1').replace(/\\/g, '/')
  return encodeURI(`/@fs/${normalizedPath}`)
}

function unsubscribe() {
  return () => undefined
}

export function ensureDesktopApiFallback() {
  if (window.desktopAPI) {
    window.desktopAPI.isElectron ??= false
    window.desktopAPI.copyTextFile ??= async () => {
      throw unavailable('复制文件文本')
    }
    window.desktopAPI.copyText ??= async (text: string) => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(text ?? ''))
        return
      }

      const textarea = document.createElement('textarea')
      textarea.value = String(text ?? '')
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '-9999px'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()

      const copied = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (!copied) {
        throw unavailable('复制文本')
      }
    }
    window.desktopAPI.pickMediaFile ??= async () => null
    window.desktopAPI.pickImageFile ??= async () => null
    window.desktopAPI.getAutomationStatus ??= async () => defaultAutomationStatus
    window.desktopAPI.runAutomationCheckNow ??= async () => defaultAutomationStatus
    window.desktopAPI.setAutomationPaused ??= async (paused) => ({ ...defaultAutomationStatus, paused })
    window.desktopAPI.testEmailPush ??= async () => ({
      ok: false,
      mode: 'smtp',
      configured: false,
      recipientCount: 0,
      message: '浏览器预览模式不测试邮件推送。',
    })
    window.desktopAPI.listMaterialPackages ??= async () => ({
      rootDir: '',
      records: [],
    })
    window.desktopAPI.deleteMaterialPackage ??= async () => ({
      deletedPaths: [],
    })
    window.desktopAPI.loadWorkbenchQueue ??= async () => []
    window.desktopAPI.saveWorkbenchQueue ??= async (items) => items
    window.desktopAPI.clearWorkbenchQueue ??= async () => ({
      clearedCount: 0,
      archivedCount: 0,
      deletedMaterialCount: 0,
      deletedPaths: [],
      skippedPaths: [],
    })
    window.desktopAPI.loadPinnedBilibiliSources ??= async () => []
    window.desktopAPI.savePinnedBilibiliSources ??= async (items) => items
    window.desktopAPI.listBilibiliFollowSources ??= async () => ({
      provider: 'bilibili',
      configured: false,
      authenticated: false,
      accountName: '',
      accountId: '',
      message: '浏览器预览模式暂不读取关注源。',
      nextAction: '请在桌面端使用关注源',
      items: [],
    })
    window.desktopAPI.listBilibiliSourceVideos ??= async () => ({
      provider: 'bilibili',
      fetchedAt: Date.now(),
      totalVideos: 0,
      sources: [],
    })
    window.desktopAPI.getBilibiliVideoMetadata ??= async () => {
      throw unavailable('读取视频信息')
    }
    window.desktopAPI.readWorkflowDocument ??= async (documentKey) => ({
      key: documentKey,
      title: '浏览器预览',
      relativePath: '',
      path: '',
      updatedAt: Date.now(),
      content: '浏览器预览模式不能读取桌面端白名单文件。请在 Electron 桌面端查看真实流程文件。',
    })
    window.desktopAPI.listKnowledgeLibrary ??= async () => ({
      rootDir: '',
      libraryPath: '',
      records: [],
    })
    window.desktopAPI.onAutomationStatus ??= unsubscribe
    window.desktopAPI.onWorkbenchQueueChanged ??= unsubscribe
    return
  }

  window.desktopAPI = {
    isElectron: false,
    minimize: async () => undefined,
    close: async () => undefined,
    toggleMaximize: async () => false,
    loadSettings: async () => loadBrowserSettings(),
    saveSettings: async (payload) => saveBrowserSettings(payload),
    loadSettingsStatus: async () => ({
      bilibili: {
        configured: false,
        valid: false,
        accountName: '',
        accountId: '',
        message: '浏览器预览模式暂不连接 B 站账号。',
      },
    }),
    getAutomationStatus: async () => defaultAutomationStatus,
    runAutomationCheckNow: async () => defaultAutomationStatus,
    setAutomationPaused: async (paused) => ({ ...defaultAutomationStatus, paused }),
    testEmailPush: async () => ({
      ok: false,
      mode: 'smtp',
      configured: false,
      recipientCount: 0,
      message: '浏览器预览模式不测试邮件推送。',
    }),
    copyTextFile: async () => {
      throw unavailable('复制文件文本')
    },
    copyText: async (text: string) => {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(text ?? ''))
        return
      }

      const textarea = document.createElement('textarea')
      textarea.value = String(text ?? '')
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.top = '-9999px'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()

      const copied = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (!copied) {
        throw unavailable('复制文本')
      }
    },
    pickDirectory: async () => null,
    pickMediaFile: async () => null,
    pickImageFile: async () => null,
    importCoursePackage: async () => null,
    readCoursePackage: async (targetPath) => {
      const response = await fetch(toViteFileUrl(targetPath), { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`读取资料包失败：${response.status} ${response.statusText}`)
      }
      return {
        path: targetPath,
        text: await response.text(),
      }
    },
    runDistillation: async () => {
      throw unavailable('资料整理')
    },
    listMaterialPackages: async () => ({
      rootDir: '',
      records: [],
    }),
    deleteMaterialPackage: async () => ({
      deletedPaths: [],
    }),
    summarizeMaterialPackage: async () => {
      throw unavailable('视频编稿')
    },
    loadWorkbenchQueue: async () => [],
    saveWorkbenchQueue: async (items) => items,
    clearWorkbenchQueue: async () => ({
      clearedCount: 0,
      archivedCount: 0,
      deletedMaterialCount: 0,
      deletedPaths: [],
      skippedPaths: [],
    }),
    loadPinnedBilibiliSources: async () => [],
    savePinnedBilibiliSources: async (items) => items,
    listBilibiliFollowSources: async () => ({
      provider: 'bilibili',
      configured: false,
      authenticated: false,
      accountName: '',
      accountId: '',
      message: '浏览器预览模式暂不读取关注源。',
      nextAction: '请在桌面端使用关注源',
      items: [],
    }),
    listBilibiliSourceVideos: async () => ({
      provider: 'bilibili',
      fetchedAt: Date.now(),
      totalVideos: 0,
      sources: [],
    }),
    getBilibiliVideoMetadata: async () => {
      throw unavailable('读取视频信息')
    },
    listKnowledgeLibrary: async () => ({
      rootDir: '',
      libraryPath: '',
      records: [],
    }),
    loadLearningLibrary: async () => ({
      currentRecordId: null,
      records: [],
    }),
    openLearningRecord: async () => {
      throw unavailable('打开资料记录')
    },
    refreshLearningLibraryStructure: async () => ({
      library: {
        currentRecordId: null,
        records: [],
      },
      recordUpdates: 0,
      packageUpdates: 0,
      scannedPackages: 0,
    }),
    saveLearningRecord: async (payload) => payload,
    deleteLearningRecord: async () => ({
      currentRecordId: null,
      records: [],
    }),
    exportObsidianCourse: async () => {
      throw unavailable('Obsidian 同步')
    },
    openObsidianCourse: async () => {
      throw unavailable('Obsidian 打开')
    },
    synthesizeSpeech: async () => {
      throw unavailable('语音朗读')
    },
    checkSpeechCache: async (payload: { text?: string }) => ({
      cached: false,
      characters: estimateMiniMaxSpeechCharacters(payload?.text || ''),
      filePath: null,
      filePaths: [],
      usage: {
      date: new Date().toISOString().slice(0, 10),
      usedCharacters: 0,
      dailyLimit: 4000,
      remainingCharacters: 4000,
      note: '浏览器预览模式下不记录真实 TTS 用量。',
    },
  }),
    readTextFile: async () => {
      throw unavailable('读取本地文本文件')
    },
    readWorkflowDocument: async (documentKey) => ({
      key: documentKey,
      title: '浏览器预览',
      relativePath: '',
      path: '',
      updatedAt: Date.now(),
      content: '浏览器预览模式不能读取桌面端白名单文件。请在 Electron 桌面端查看真实流程文件。',
    }),
    openPath: async () => undefined,
    showItem: async () => undefined,
    openExternal: async (targetUrl) => {
      globalThis.open(targetUrl, '_blank', 'noopener,noreferrer')
    },
    onDistillProgress: unsubscribe,
    onAutomationStatus: unsubscribe,
    onWorkbenchQueueChanged: unsubscribe,
    onWindowFocusChanged: unsubscribe,
    onWindowMaximizedChanged: unsubscribe,
    onDeepLinkOpen: unsubscribe,
  }
}

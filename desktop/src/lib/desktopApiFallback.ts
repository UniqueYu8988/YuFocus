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
    window.desktopAPI.pickMediaFile ??= async () => null
    window.desktopAPI.pickImageFile ??= async () => null
    window.desktopAPI.listMaterialPackages ??= async () => ({
      rootDir: '',
      coursePackageRootDir: '',
      records: [],
    })
    window.desktopAPI.deleteMaterialPackage ??= async () => ({
      deletedPaths: [],
    })
    window.desktopAPI.importKnowledgeBrief ??= async () => {
      throw unavailable('学习笔记入库')
    }
    window.desktopAPI.listKnowledgeLibrary ??= async () => ({
      rootDir: '',
      libraryPath: '',
      records: [],
    })
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
    pickDirectory: async () => null,
    pickMediaFile: async () => null,
    pickImageFile: async () => null,
    importCoursePackage: async () => null,
    readCoursePackage: async (targetPath) => {
      const response = await fetch(toViteFileUrl(targetPath), { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`读取课程包失败：${response.status} ${response.statusText}`)
      }
      return {
        path: targetPath,
        text: await response.text(),
      }
    },
    attachCourseVisualMap: async () => {
      throw unavailable('导入全局学习地图')
    },
    runDistillation: async () => {
      throw unavailable('原材料整理')
    },
    listMaterialPackages: async () => ({
      rootDir: '',
      coursePackageRootDir: '',
      records: [],
    }),
    deleteMaterialPackage: async () => ({
      deletedPaths: [],
    }),
    importKnowledgeBrief: async () => {
      throw unavailable('学习笔记入库')
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
      throw unavailable('打开学习记录')
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
    openPath: async () => undefined,
    showItem: async () => undefined,
    openExternal: async (targetUrl) => {
      globalThis.open(targetUrl, '_blank', 'noopener,noreferrer')
    },
    onDistillProgress: unsubscribe,
    onWindowFocusChanged: unsubscribe,
    onWindowMaximizedChanged: unsubscribe,
    onDeepLinkOpen: unsubscribe,
  }
}

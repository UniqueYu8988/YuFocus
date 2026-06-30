import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktopAPI', {
  isElectron: true,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (payload: unknown) => ipcRenderer.invoke('settings:save', payload),
  loadSettingsStatus: () => ipcRenderer.invoke('settings:status'),
  runEnvironmentCheck: () => ipcRenderer.invoke('settings:environment-check'),
  getAutomationStatus: () => ipcRenderer.invoke('automation:status'),
  runAutomationCheckNow: () => ipcRenderer.invoke('automation:check-now'),
  setAutomationPaused: (payload: boolean | { paused: boolean; durationMs?: number }) => ipcRenderer.invoke('automation:set-paused', payload),
  copyText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  pickMediaFile: () => ipcRenderer.invoke('dialog:pickMediaFile'),
  pickImageFile: () => ipcRenderer.invoke('dialog:pickImageFile'),
  importCoursePackage: () => ipcRenderer.invoke('course:import'),
  readCoursePackage: (targetPath: string) => ipcRenderer.invoke('course:read', targetPath),
  copyTextFile: (targetPath: string) => ipcRenderer.invoke('file:copyText', targetPath),
  runDistillation: (payload: { video?: string; sourceKind?: 'bilibili' | 'local_media'; mediaPath?: string; editorialMode?: 'auto' | 'force' | 'off' }) => ipcRenderer.invoke('distill:run', payload),
  listMaterialPackages: () => ipcRenderer.invoke('materials:list'),
  deleteMaterialPackage: (materialPath: string) => ipcRenderer.invoke('materials:delete', materialPath),
  loadWorkbenchQueue: () => ipcRenderer.invoke('workbench:queue:load'),
  saveWorkbenchQueue: (items: unknown[]) => ipcRenderer.invoke('workbench:queue:save', items),
  clearWorkbenchQueue: () => ipcRenderer.invoke('workbench:queue:clear'),
  loadPinnedBilibiliSources: () => ipcRenderer.invoke('sources:bilibili:pinned:load'),
  savePinnedBilibiliSources: (items: unknown[]) => ipcRenderer.invoke('sources:bilibili:pinned:save', items),
  loadTrackedBilibiliSources: () => ipcRenderer.invoke('sources:bilibili:tracked:load'),
  saveTrackedBilibiliSources: (items: unknown[]) => ipcRenderer.invoke('sources:bilibili:tracked:save', items),
  listBilibiliFollowSources: () => ipcRenderer.invoke('sources:bilibili:followings'),
  listRegisteredBilibiliSourceVideos: (payload: { sources: Array<{ mid: string; name?: string }> }) => ipcRenderer.invoke('sources:bilibili:registered-videos', payload),
  listBilibiliSourceVideos: (payload: { sources: Array<{ mid: string; name?: string }>; pageSize?: number }) => ipcRenderer.invoke('sources:bilibili:videos', payload),
  getBilibiliVideoMetadata: (payload: { video: string }) => ipcRenderer.invoke('sources:bilibili:video', payload),
  listKnowledgeLibrary: () => ipcRenderer.invoke('knowledge:list'),
  loadLearningLibrary: () => ipcRenderer.invoke('learning:library:load'),
  openLearningRecord: (recordId: string) => ipcRenderer.invoke('learning:library:open', recordId),
  refreshLearningLibraryStructure: () => ipcRenderer.invoke('learning:library:refresh-structure'),
  saveLearningRecord: (payload: unknown) => ipcRenderer.invoke('learning:library:save', payload),
  deleteLearningRecord: (recordId: string) => ipcRenderer.invoke('learning:library:delete', recordId),
  readTextFile: (targetPath: string) => ipcRenderer.invoke('file:readText', targetPath),
  readWorkflowDocument: (documentKey: string) => ipcRenderer.invoke('workflow:document', documentKey),
  openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),
  showItem: (targetPath: string) => ipcRenderer.invoke('shell:showItem', targetPath),
  openExternal: (targetUrl: string) => ipcRenderer.invoke('shell:openExternal', targetUrl),
  onDistillProgress: (
    callback: (payload: {
      message: string
      percent: number
      stage?: string
      cacheHint?: string
      audioCompleted?: number
      audioTotal?: number
      chunkCompleted?: number
      chunkTotal?: number
      resumed?: boolean
      outlinePreview?: {
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
    }) => void,
  ) => {
    const handler = (
      _event: unknown,
      payload: {
        message: string
        percent: number
        stage?: string
        cacheHint?: string
        audioCompleted?: number
        audioTotal?: number
        chunkCompleted?: number
        chunkTotal?: number
        resumed?: boolean
        outlinePreview?: {
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
      },
    ) => callback(payload)
    ipcRenderer.on('distill-progress', handler)
    return () => ipcRenderer.removeListener('distill-progress', handler)
  },
  onAutomationStatus: (callback: (payload: {
    enabled: boolean
    paused: boolean
    pauseReason: 'manual' | 'duration' | ''
    pausedUntil: number | null
    running: boolean
    lastCheckAt: number | null
    nextCheckAt: number | null
    lastResult: string
    lastError: string | null
    checkIntervalMinutes: number
  }) => void) => {
    const handler = (
      _event: unknown,
      payload: {
        enabled: boolean
        paused: boolean
        pauseReason: 'manual' | 'duration' | ''
        pausedUntil: number | null
        running: boolean
        lastCheckAt: number | null
        nextCheckAt: number | null
        lastResult: string
        lastError: string | null
        checkIntervalMinutes: number
      },
    ) => callback(payload)
    ipcRenderer.on('automation:status', handler)
    return () => ipcRenderer.removeListener('automation:status', handler)
  },
  onWorkbenchQueueChanged: (callback: (items: unknown[]) => void) => {
    const handler = (_event: unknown, items: unknown[]) => callback(items)
    ipcRenderer.on('workbench:queue:changed', handler)
    return () => ipcRenderer.removeListener('workbench:queue:changed', handler)
  },
  onWindowFocusChanged: (callback: (payload: { focused: boolean }) => void) => {
    const handler = (_event: unknown, payload: { focused: boolean }) => callback(payload)
    ipcRenderer.on('window:focus-changed', handler)
    return () => ipcRenderer.removeListener('window:focus-changed', handler)
  },
  onWindowMaximizedChanged: (callback: (payload: { maximized: boolean }) => void) => {
    const handler = (_event: unknown, payload: { maximized: boolean }) => callback(payload)
    ipcRenderer.on('window:maximized-changed', handler)
    return () => ipcRenderer.removeListener('window:maximized-changed', handler)
  },
  onDeepLinkOpen: (callback: (payload: { packageId: string; nodeId: string | null }) => void) => {
    const handler = (_event: unknown, payload: { packageId: string; nodeId: string | null }) => callback(payload)
    ipcRenderer.on('deeplink:open', handler)
    return () => ipcRenderer.removeListener('deeplink:open', handler)
  },
})

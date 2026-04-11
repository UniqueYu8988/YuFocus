import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktopAPI', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (payload: unknown) => ipcRenderer.invoke('settings:save', payload),
  loadSettingsStatus: () => ipcRenderer.invoke('settings:status'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  importCoursePackage: () => ipcRenderer.invoke('course:import'),
  readCoursePackage: (targetPath: string) => ipcRenderer.invoke('course:read', targetPath),
  runDistillation: (payload: { video: string }) => ipcRenderer.invoke('distill:run', payload),
  loadLearningLibrary: () => ipcRenderer.invoke('learning:library:load'),
  openLearningRecord: (recordId: string) => ipcRenderer.invoke('learning:library:open', recordId),
  saveLearningRecord: (payload: unknown) => ipcRenderer.invoke('learning:library:save', payload),
  deleteLearningRecord: (recordId: string) => ipcRenderer.invoke('learning:library:delete', recordId),
  runArchive: (payload: { video: string; generateAi: boolean }) => ipcRenderer.invoke('archive:run', payload),
  openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),
  showItem: (targetPath: string) => ipcRenderer.invoke('shell:showItem', targetPath),
  openExternal: (targetUrl: string) => ipcRenderer.invoke('shell:openExternal', targetUrl),
  onArchiveLog: (callback: (message: string) => void) => {
    const handler = (_event: unknown, message: string) => callback(message)
    ipcRenderer.on('archive-log', handler)
    return () => ipcRenderer.removeListener('archive-log', handler)
  },
  onArchiveProgress: (callback: (payload: { message: string; percent: number }) => void) => {
    const handler = (_event: unknown, payload: { message: string; percent: number }) => callback(payload)
    ipcRenderer.on('archive-progress', handler)
    return () => ipcRenderer.removeListener('archive-progress', handler)
  },
  onDistillProgress: (callback: (payload: { message: string; percent: number }) => void) => {
    const handler = (_event: unknown, payload: { message: string; percent: number }) => callback(payload)
    ipcRenderer.on('distill-progress', handler)
    return () => ipcRenderer.removeListener('distill-progress', handler)
  },
  onWindowFocusChanged: (callback: (payload: { focused: boolean }) => void) => {
    const handler = (_event: unknown, payload: { focused: boolean }) => callback(payload)
    ipcRenderer.on('window:focus-changed', handler)
    return () => ipcRenderer.removeListener('window:focus-changed', handler)
  },
})

import { dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { RuntimeSettings } from './settings'
import { normalizeStudyPackageText } from './studyPackageCompat'

export async function pickDirectory() {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
}

export async function pickMediaFile() {
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
}

export async function pickImageFile() {
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
}

export async function importStudyPackageFile(
  runtimeSettings: RuntimeSettings,
  resolveDefaultPath: (settings: RuntimeSettings) => string,
) {
  const result = await dialog.showOpenDialog({
    title: '选择资料包 JSON',
    defaultPath: resolveDefaultPath(runtimeSettings),
    buttonLabel: '导入资料包',
    properties: ['openFile'],
    filters: [
      { name: 'Study Package JSON (*.json)', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return readStudyPackageFile(result.filePaths[0])
}

export async function readStudyPackageFile(targetPath: string) {
  if (!targetPath) {
    throw new Error('未提供资料包路径。')
  }
  const text = normalizeStudyPackageText(fs.readFileSync(targetPath, 'utf-8'), targetPath).text
  return {
    path: targetPath,
    text,
  }
}

type DialogIpcDeps = {
  loadSettings: () => RuntimeSettings
  resolveCourseImportDefaultPath: (settings: RuntimeSettings) => string
}

export function registerDialogIpcHandlers({
  loadSettings,
  resolveCourseImportDefaultPath,
}: DialogIpcDeps) {
  ipcMain.handle('dialog:pickDirectory', async () => pickDirectory())

  ipcMain.handle('dialog:pickMediaFile', async () => pickMediaFile())

  ipcMain.handle('dialog:pickImageFile', async () => pickImageFile())

  ipcMain.handle('course:import', async () => {
    return importStudyPackageFile(loadSettings(), resolveCourseImportDefaultPath)
  })

  ipcMain.handle('course:read', async (_event, targetPath: string) => {
    return readStudyPackageFile(targetPath)
  })
}

import { clipboard, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { readWorkflowDocument } from './workflowDocuments'

type SystemIpcHandlersDeps = {
  resolveDevProjectRoot: () => string
}

export function registerSystemIpcHandlers({ resolveDevProjectRoot }: SystemIpcHandlersDeps) {
  ipcMain.handle('file:readText', async (_event, targetPath: string) => {
    const resolvedPath = path.resolve(String(targetPath || ''))
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`文件不存在：${resolvedPath}`)
    }
    return fs.readFileSync(resolvedPath, 'utf-8')
  })

  ipcMain.handle('workflow:document', async (_event, documentKey: unknown) => {
    return readWorkflowDocument(resolveDevProjectRoot(), documentKey)
  })

  ipcMain.handle('clipboard:writeText', async (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
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
}

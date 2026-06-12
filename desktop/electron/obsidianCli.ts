import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  exportCourseToObsidian,
  sanitizeFileNameSegment,
} from './obsidianExport'
import type { RuntimeSettings } from './settings'

function getCliArgValue(argv: string[], flag: string) {
  const index = argv.indexOf(flag)
  if (index < 0) return ''
  return String(argv[index + 1] ?? '').trim()
}

function clearObsidianExportFolder(settings: RuntimeSettings) {
  const vaultPath = settings.obsidian_vault_path
  if (!vaultPath || !fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    throw new Error('Obsidian Vault 路径不存在，无法清理导出目录。')
  }

  const exportFolder = sanitizeFileNameSegment(settings.obsidian_export_folder || '视界专注', '视界专注')
  const targetDir = path.resolve(vaultPath, exportFolder)
  const resolvedVault = path.resolve(vaultPath)
  if (!targetDir.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new Error('导出目录不在 Obsidian Vault 内，已取消清理。')
  }
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
}

export async function runObsidianExportCliIfRequested(argv: string[], loadSettings: () => RuntimeSettings) {
  const coursePath = getCliArgValue(argv, '--export-obsidian-course')
  if (!coursePath) return false

  await app.whenReady()
  try {
    const settings = loadSettings()
    if (argv.includes('--clean-obsidian-export')) {
      clearObsidianExportFolder(settings)
    }
    const course = JSON.parse(fs.readFileSync(coursePath, 'utf-8'))
    const result = exportCourseToObsidian(settings, {
      course,
      currentNodeId: null,
      completedNodeIds: [],
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    app.exit(0)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    app.exit(1)
  }
  return true
}

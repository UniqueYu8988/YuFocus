import fs from 'node:fs'
import path from 'node:path'
import type { SettingsDefaultsContext } from './settings'

type RuntimePathOptions = {
  isPackaged: boolean
  userDataRoot: string
  resourcesPath: string
  execPath: string
  cwd: string
  moduleDir: string
  portableExecutableDir?: string
}

export type RuntimePaths = {
  devProjectRoot: string
  dataRoot: string
  canonicalDataRoot: string
  userDataRoot: string
  settingsPath: string
  windowStatePath: string
  legacyWindowStatePath: string
  runtimeLogPath: string
  iconPath: string
}

function resolvePortableExecutableDir(execPath: string, portableExecutableDir?: string) {
  return portableExecutableDir || path.dirname(execPath)
}

function looksLikeDevProjectRoot(candidate: string) {
  const requiredFiles = [
    'AGENTS.md',
    'PRODUCT.md',
    'ARCHITECTURE.md',
    path.join('src', 'distiller.py'),
    path.join('desktop', 'package.json'),
  ]
  return requiredFiles.every((relativePath) => fs.existsSync(path.join(candidate, relativePath)))
}

function resolveDevProjectRoot(execPath: string, cwd: string, moduleDir: string) {
  const searchRoots = [
    path.dirname(execPath),
    cwd,
    moduleDir,
  ].filter(Boolean)

  for (const root of searchRoots) {
    for (let depth = 0; depth <= 6; depth += 1) {
      const candidate = path.resolve(root, ...Array(depth).fill('..'))
      if (looksLikeDevProjectRoot(candidate)) {
        return candidate
      }
    }
  }

  const desktopRootFallback = path.resolve(moduleDir, '..')
  return path.resolve(desktopRootFallback, '..')
}

function findExistingDataRoot(execPath: string, cwd: string, portableExecutableDir: string) {
  const searchRoots = [
    portableExecutableDir,
    path.dirname(execPath),
    cwd,
  ].filter(Boolean)

  for (const root of searchRoots) {
    for (let depth = 0; depth <= 6; depth += 1) {
      const candidate = path.resolve(root, ...Array(depth).fill('..'))
      if (
        fs.existsSync(path.join(candidate, '.shijie-focus.local.json')) ||
        fs.existsSync(path.join(candidate, '.biliarchive.local.json'))
      ) {
        return candidate
      }
    }
  }

  return null
}

export function createRuntimePaths(options: RuntimePathOptions): RuntimePaths {
  const portableExecutableDir = resolvePortableExecutableDir(options.execPath, options.portableExecutableDir)
  const devProjectRoot = resolveDevProjectRoot(options.execPath, options.cwd, options.moduleDir)
  const dataRoot = options.isPackaged
    ? (findExistingDataRoot(options.execPath, options.cwd, portableExecutableDir) || portableExecutableDir)
    : devProjectRoot
  const canonicalDataRoot = options.isPackaged
    ? path.join(dataRoot, 'data')
    : resolveCanonicalOutputRoot(devProjectRoot)

  return {
    devProjectRoot,
    dataRoot,
    canonicalDataRoot,
    userDataRoot: options.userDataRoot,
    settingsPath: path.join(options.userDataRoot, '.shijie-focus.local.json'),
    windowStatePath: path.join(options.userDataRoot, '.shijie-focus.window.json'),
    legacyWindowStatePath: path.join(dataRoot, '.biliarchive.window.json'),
    runtimeLogPath: path.join(canonicalDataRoot, 'logs', 'runtime.log'),
    iconPath: options.isPackaged
      ? path.join(options.resourcesPath, 'assets', 'app_icon.ico')
      : path.join(devProjectRoot, 'assets', 'app_icon.ico'),
  }
}

export function resolveCanonicalOutputRoot(devProjectRoot: string) {
  return path.join(devProjectRoot, 'data')
}

export function resolveMaterialOutputDir(settingsOutputDir: string) {
  return path.join(settingsOutputDir, 'materials')
}

function isExistingDirectory(targetPath: string) {
  try {
    return Boolean(targetPath && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory())
  } catch {
    return false
  }
}

export function resolveCourseImportDefaultPath(settingsOutputDir: string, devProjectRoot: string, dataRoot: string) {
  const candidates = [
    settingsOutputDir,
    path.join(devProjectRoot, 'data', 'materials'),
  ]

  return candidates.find(isExistingDirectory) || dataRoot
}

export function detectLikelyLocalTranscriptionRoot(devProjectRoot: string, dataRoot: string, cwd: string) {
  const candidates = [
    path.resolve(devProjectRoot, '..', 'Cuda'),
    path.resolve(devProjectRoot, '..', '..', 'Cuda'),
    path.resolve(dataRoot, '..', 'Cuda'),
    path.resolve(dataRoot, '..', '..', 'Cuda'),
    path.resolve(cwd, '..', 'Cuda'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'local_audio_distiller.py'))) {
      return candidate
    }
  }

  return ''
}

export function createSettingsDefaultsContext(options: {
  devProjectRoot: string
  dataRoot: string
  cwd: string
  backgroundCheckIntervalMinutes: number
  workbenchQueueConcurrency: number
}): SettingsDefaultsContext {
  return {
    outputRoot: resolveCanonicalOutputRoot(options.devProjectRoot),
    legacyOutputRoots: [path.join(options.devProjectRoot, 'output')],
    localTranscriptionRoot: detectLikelyLocalTranscriptionRoot(options.devProjectRoot, options.dataRoot, options.cwd),
    backgroundCheckIntervalMinutes: options.backgroundCheckIntervalMinutes,
    workbenchQueueConcurrency: options.workbenchQueueConcurrency,
  }
}

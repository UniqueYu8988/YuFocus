import fs from 'node:fs'
import path from 'node:path'

export function getComparablePath(targetPath: string) {
  const resolved = path.resolve(targetPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isPathInsideRoot(targetPath: string, allowedRoot: string) {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(allowedRoot)
  const comparableTarget = getComparablePath(resolvedTarget)
  const comparableRoot = getComparablePath(resolvedRoot)
  return comparableTarget === comparableRoot || comparableTarget.startsWith(`${comparableRoot}${path.sep}`)
}

export function assertPathInside(
  targetPath: string,
  allowedRoot: string,
  label: string,
  options: { allowRoot?: boolean } = {},
) {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(allowedRoot)
  const comparableTarget = getComparablePath(resolvedTarget)
  const comparableRoot = getComparablePath(resolvedRoot)
  if (!isPathInsideRoot(resolvedTarget, resolvedRoot)) {
    throw new Error(`${label} 不在允许的目录内，已取消删除。`)
  }
  if (!options.allowRoot && comparableTarget === comparableRoot) {
    throw new Error(`${label} 指向输出根目录，已取消删除。`)
  }
  return resolvedTarget
}

export function deletePathIfExists(targetPath: string, deletedPaths: string[]) {
  if (!targetPath || !fs.existsSync(targetPath)) return
  fs.rmSync(targetPath, { recursive: true, force: true })
  deletedPaths.push(targetPath)
}

export function deletePathIfInsideAnyRoot(
  targetPath: string | undefined,
  allowedRoots: string[],
  deletedPaths: string[],
  skippedPaths: string[],
) {
  if (!targetPath) return
  const resolvedTarget = path.resolve(targetPath)
  const safeRoot = allowedRoots.find((root) => isPathInsideRoot(resolvedTarget, root))
  if (!safeRoot || getComparablePath(resolvedTarget) === getComparablePath(safeRoot)) {
    skippedPaths.push(resolvedTarget)
    return
  }
  deletePathIfExists(resolvedTarget, deletedPaths)
}

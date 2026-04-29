import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = path.resolve(desktopRoot, '..')
const canonicalOutputRoot = path.join(projectRoot, 'output')
const canonicalMaterialsRoot = path.join(canonicalOutputRoot, 'materials')
const canonicalCoursePackagesRoot = path.join(canonicalOutputRoot, 'courses')
const legacyRoot = path.join(canonicalOutputRoot, '99_legacy')
const legacyMaterialRoot = path.join(legacyRoot, 'duplicate_materials')
const legacyCoursePackageRoot = path.join(legacyRoot, 'old_course_packages')
const legacyLooseArtifactRoot = path.join(legacyRoot, 'loose_artifacts')
const legacyTestRunRoot = path.join(legacyRoot, 'test_runs')
const legacyOldLayoutRoot = path.join(legacyRoot, 'old_numbered_layout')
const legacyOutputRoot = path.join(legacyRoot, 'legacy_output_roots')

const args = new Set(process.argv.slice(2))
const apply = args.has('--apply')
const deleteOldCoursePackages = args.has('--delete-old-course-packages')
const archiveOldCoursePackages = args.has('--archive-old-course-packages')
const includeCaches = args.has('--include-caches')

function normalizeFsPath(value) {
  return path.resolve(value).replace(/^\\([A-Z]:\\)/i, '$1')
}

function isInside(parent, child) {
  const relative = path.relative(normalizeFsPath(parent), normalizeFsPath(child))
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function ensureWorkspacePath(targetPath) {
  const resolved = normalizeFsPath(targetPath)
  if (resolved !== projectRoot && !isInside(projectRoot, resolved)) {
    throw new Error(`Refusing to touch path outside project root: ${resolved}`)
  }
  return resolved
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function listDirectories(rootDir) {
  if (!fs.existsSync(rootDir)) return []
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name))
}

function walk(rootDir, visit) {
  if (!fs.existsSync(rootDir)) return
  const stack = [rootDir]
  while (stack.length) {
    const current = stack.pop()
    if (!current) continue
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      visit(entryPath, entry)
      if (entry.isDirectory()) stack.push(entryPath)
    }
  }
}

function getDirectorySize(rootDir) {
  let total = 0
  walk(rootDir, (entryPath, entry) => {
    if (!entry.isFile()) return
    try {
      total += fs.statSync(entryPath).size
    } catch {
      // Ignore files that disappear while scanning.
    }
  })
  return total
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units.shift()
  while (value >= 1024 && units.length) {
    value /= 1024
    unit = units.shift()
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
}

function safeName(value, fallback) {
  const normalized = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (normalized || fallback).slice(0, 80)
}

function uniqueDestination(basePath) {
  if (!fs.existsSync(basePath)) return basePath
  const parsed = path.parse(basePath)
  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  throw new Error(`Unable to find unique destination for ${basePath}`)
}

function summarizeMaterial(materialPath) {
  const manifestPath = path.join(materialPath, 'manifest.json')
  const manifest = readJson(manifestPath) || {}
  const source = manifest.source && typeof manifest.source === 'object' ? manifest.source : {}
  const stat = fs.statSync(materialPath)
  const materialId = String(manifest.material_id || source.source_id || path.basename(materialPath, '.course_material')).trim()
  const title = String(source.title || path.basename(materialPath, '.course_material')).trim()
  const sourceId = String(source.source_id || '').trim()
  return {
    path: materialPath,
    name: path.basename(materialPath),
    materialId,
    title,
    sourceId,
    blockCount: Number(manifest.block_count || 0),
    textLength: Number(manifest.text_length || manifest.raw_transcript_length || 0),
    updatedAt: stat.mtimeMs,
    updatedAtIso: stat.mtime.toISOString(),
    sizeBytes: getDirectorySize(materialPath),
    hasStartHere: fs.existsSync(path.join(materialPath, 'START_HERE.md')),
    hasTaskContract: fs.existsSync(path.join(materialPath, 'codex_tasks', '04_course_package_contract.md')),
    hasSchemas: fs.existsSync(path.join(materialPath, 'schemas')),
    hasBlocks: fs.existsSync(path.join(materialPath, 'blocks')),
    isInsideCanonicalMaterials: normalizeFsPath(materialPath).startsWith(`${normalizeFsPath(canonicalMaterialsRoot)}${path.sep}`),
  }
}

function findMaterialPackages() {
  const roots = [
    canonicalOutputRoot,
    path.join(desktopRoot, 'release', 'output'),
    path.join(desktopRoot, 'output'),
  ]
  const materials = []
  const seen = new Set()
  for (const root of roots) {
    walk(root, (entryPath, entry) => {
      if (!entry.isDirectory() || !entry.name.endsWith('.course_material')) return
      const resolved = normalizeFsPath(entryPath)
      if (resolved.startsWith(`${normalizeFsPath(legacyRoot)}${path.sep}`)) return
      if (seen.has(resolved)) return
      seen.add(resolved)
      if (fs.existsSync(path.join(resolved, 'manifest.json'))) {
        materials.push(summarizeMaterial(resolved))
      }
    })
  }
  return materials
}

function findCoursePackages() {
  const roots = [
    canonicalOutputRoot,
    path.join(desktopRoot, 'release', 'output'),
    path.join(desktopRoot, 'output'),
  ]
  const packages = []
  const seen = new Set()
  for (const root of roots) {
    walk(root, (entryPath, entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.course-package.json')) return
      const resolved = normalizeFsPath(entryPath)
      if (resolved.startsWith(`${normalizeFsPath(legacyRoot)}${path.sep}`)) return
      if (seen.has(resolved)) return
      seen.add(resolved)
      const insideMaterialDraft = resolved.includes(`${path.sep}course_draft${path.sep}`)
      const insideCanonicalPackages = isInside(canonicalCoursePackagesRoot, resolved)
      const stat = fs.statSync(resolved)
      packages.push({
        path: resolved,
        name: entry.name,
        insideMaterialDraft,
        insideCanonicalPackages,
        updatedAtIso: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      })
    })
  }
  return packages
}

function findCacheDirectories() {
  const candidates = [
    path.join(canonicalOutputRoot, 'cache'),
  ]
  return candidates
    .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory())
    .map((candidate) => ({
      path: normalizeFsPath(candidate),
      sizeBytes: getDirectorySize(candidate),
      fileCount: countFiles(candidate),
    }))
}

function findRootCleanupCandidates() {
  if (!fs.existsSync(canonicalOutputRoot)) return { looseArtifacts: [], testRuns: [], oldLayoutDirs: [] }
  const ignoredNames = new Set([
    'materials',
    'courses',
    'cache',
    '99_legacy',
  ])
  const loosePatterns = [
    /\.course-package\.mvp\.json$/i,
    /\.course-package\.quality-report\.json$/i,
    /\.coverage-report\.json$/i,
    /\.log$/i,
    /\.pid$/i,
    /\.bak$/i,
  ]
  const testDirPatterns = [
    /^mvp_pressure_test/i,
    /^debug_long_video$/i,
    /^playwright$/i,
  ]
  const oldLayoutNames = new Set(['01_materials', '02_course_packages'])
  const looseArtifacts = []
  const testRuns = []
  const oldLayoutDirs = []

  for (const entry of fs.readdirSync(canonicalOutputRoot, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) continue
    const entryPath = path.join(canonicalOutputRoot, entry.name)
    if (entry.isDirectory() && oldLayoutNames.has(entry.name)) {
      oldLayoutDirs.push({
        path: entryPath,
        name: entry.name,
        sizeBytes: getDirectorySize(entryPath),
      })
      continue
    }
    if (entry.isDirectory() && testDirPatterns.some((pattern) => pattern.test(entry.name))) {
      testRuns.push({
        path: entryPath,
        name: entry.name,
        sizeBytes: getDirectorySize(entryPath),
      })
      continue
    }
    if (entry.isFile() && loosePatterns.some((pattern) => pattern.test(entry.name))) {
      const stat = fs.statSync(entryPath)
      looseArtifacts.push({
        path: entryPath,
        name: entry.name,
        sizeBytes: stat.size,
      })
    }
  }
  return { looseArtifacts, testRuns, oldLayoutDirs }
}

function findLegacyOutputRoots() {
  return [
    { path: path.join(desktopRoot, 'release', 'output'), name: 'desktop_release_output' },
    { path: path.join(desktopRoot, 'output'), name: 'desktop_output' },
  ]
    .filter((item) => fs.existsSync(item.path) && fs.statSync(item.path).isDirectory())
    .map((item) => ({
      ...item,
      sizeBytes: getDirectorySize(item.path),
    }))
}

function countFiles(rootDir) {
  let count = 0
  walk(rootDir, (_entryPath, entry) => {
    if (entry.isFile()) count += 1
  })
  return count
}

function buildMaterialPlan(materials) {
  const byId = new Map()
  for (const material of materials) {
    const key = material.materialId.toLowerCase()
    if (!byId.has(key)) byId.set(key, [])
    byId.get(key).push(material)
  }

  const keep = []
  const duplicateArchives = []
  for (const group of byId.values()) {
    const sorted = [...group].sort((left, right) => {
      const rightQuality =
        Number(right.hasStartHere) * 1000 +
        Number(right.hasTaskContract) * 500 +
        Number(right.hasSchemas) * 200 +
        Number(right.hasBlocks) * 100 +
        Number(right.isInsideCanonicalMaterials) * 50
      const leftQuality =
        Number(left.hasStartHere) * 1000 +
        Number(left.hasTaskContract) * 500 +
        Number(left.hasSchemas) * 200 +
        Number(left.hasBlocks) * 100 +
        Number(left.isInsideCanonicalMaterials) * 50
      if (rightQuality !== leftQuality) return rightQuality - leftQuality
      if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt
      if (right.textLength !== left.textLength) return right.textLength - left.textLength
      return right.updatedAt - left.updatedAt
    })
    const winner = sorted[0]
    const destinationName = `${safeName(winner.title, winner.materialId)}.course_material`
    const destination = path.join(canonicalMaterialsRoot, destinationName)
    keep.push({
      ...winner,
      destination,
      action: normalizeFsPath(winner.path) === normalizeFsPath(destination) ? 'keep' : 'move-to-materials',
    })

    for (const duplicate of sorted.slice(1)) {
      duplicateArchives.push({
        ...duplicate,
        destination: path.join(legacyMaterialRoot, `${safeName(duplicate.title, duplicate.materialId)}__${safeName(duplicate.materialId, 'material')}.course_material`),
      action: 'archive-duplicate-material',
      })
    }
  }
  return { keep, duplicateArchives }
}

function moveDirectory(source, destination) {
  ensureWorkspacePath(source)
  ensureWorkspacePath(destination)
  const finalDestination = uniqueDestination(destination)
  fs.mkdirSync(path.dirname(finalDestination), { recursive: true })
  try {
    fs.renameSync(source, finalDestination)
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES'].includes(error?.code)) throw error
    copyDirectoryRecursive(source, finalDestination)
    try {
      fs.rmSync(source, { recursive: true, force: true })
    } catch {
      // Some release folders can be held by Windows. The copied destination is still usable.
    }
  }
  return finalDestination
}

function copyDirectoryRecursive(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destinationPath)
      continue
    }
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(sourcePath)
      fs.symlinkSync(target, destinationPath)
      continue
    }
    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL)
    }
  }
}

function moveFile(source, destination) {
  ensureWorkspacePath(source)
  ensureWorkspacePath(destination)
  const finalDestination = uniqueDestination(destination)
  fs.mkdirSync(path.dirname(finalDestination), { recursive: true })
  try {
    fs.renameSync(source, finalDestination)
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES'].includes(error?.code)) throw error
    fs.copyFileSync(source, finalDestination, fs.constants.COPYFILE_EXCL)
    try {
      fs.rmSync(source, { force: true })
    } catch {
      // The copied destination is still usable if Windows keeps the source locked.
    }
  }
  return finalDestination
}

function deleteFile(source) {
  ensureWorkspacePath(source)
  fs.rmSync(source, { force: true })
}

function main() {
  fs.mkdirSync(canonicalMaterialsRoot, { recursive: true })
  fs.mkdirSync(canonicalCoursePackagesRoot, { recursive: true })

  const materials = findMaterialPackages()
  const coursePackages = findCoursePackages()
  const caches = findCacheDirectories()
  const materialPlan = buildMaterialPlan(materials)
  const oldCoursePackages = coursePackages.filter(
    (item) => !item.insideMaterialDraft && !item.insideCanonicalPackages,
  )
  const rootCleanup = findRootCleanupCandidates()
  const legacyOutputRoots = findLegacyOutputRoots()

  const actions = {
    materialMoves: materialPlan.keep.filter((item) => item.action === 'move-to-materials'),
    duplicateMaterialArchives: materialPlan.duplicateArchives,
    oldCoursePackages,
    caches,
    looseArtifacts: rootCleanup.looseArtifacts,
    testRuns: rootCleanup.testRuns,
    oldLayoutDirs: rootCleanup.oldLayoutDirs,
    legacyOutputRoots,
  }

  if (apply) {
    for (const item of actions.materialMoves) {
      item.appliedDestination = moveDirectory(item.path, item.destination)
    }
    for (const item of actions.duplicateMaterialArchives) {
      if (!fs.existsSync(item.path)) continue
      item.appliedDestination = moveDirectory(item.path, item.destination)
    }
    if (deleteOldCoursePackages || archiveOldCoursePackages) {
      for (const item of actions.oldCoursePackages) {
        if (!fs.existsSync(item.path)) continue
        if (deleteOldCoursePackages) {
          deleteFile(item.path)
          item.appliedAction = 'deleted'
        } else {
          item.appliedDestination = moveFile(item.path, path.join(legacyCoursePackageRoot, item.name))
          item.appliedAction = 'archived'
        }
      }
    }
    for (const item of actions.looseArtifacts) {
      if (!fs.existsSync(item.path)) continue
      item.appliedDestination = moveFile(item.path, path.join(legacyLooseArtifactRoot, item.name))
    }
    for (const item of actions.testRuns) {
      if (!fs.existsSync(item.path)) continue
      item.appliedDestination = moveDirectory(item.path, path.join(legacyTestRunRoot, item.name))
    }
    for (const item of actions.oldLayoutDirs) {
      if (!fs.existsSync(item.path)) continue
      item.appliedDestination = moveDirectory(item.path, path.join(legacyOldLayoutRoot, item.name))
    }
    for (const item of actions.legacyOutputRoots) {
      if (!fs.existsSync(item.path)) continue
      item.appliedDestination = moveDirectory(item.path, path.join(legacyOutputRoot, item.name))
    }
  }

  const result = {
    mode: apply ? 'apply' : 'dry-run',
    canonicalOutputRoot,
    canonicalMaterialsRoot,
    canonicalCoursePackagesRoot,
    totals: {
      materialPackagesFound: materials.length,
      uniqueMaterials: materialPlan.keep.length,
      materialMoves: actions.materialMoves.length,
      duplicateMaterialArchives: actions.duplicateMaterialArchives.length,
      coursePackagesFound: coursePackages.length,
      oldCoursePackages: oldCoursePackages.length,
      looseArtifacts: actions.looseArtifacts.length,
      testRuns: actions.testRuns.length,
      oldLayoutDirs: actions.oldLayoutDirs.length,
      legacyOutputRoots: actions.legacyOutputRoots.length,
      cacheDirectories: caches.length,
      cacheBytes: caches.reduce((sum, item) => sum + item.sizeBytes, 0),
    },
    reusableMaterials: materialPlan.keep.map((item) => ({
      title: item.title,
      materialId: item.materialId,
      sourceId: item.sourceId,
      blockCount: item.blockCount,
      textLength: item.textLength,
      size: formatBytes(item.sizeBytes),
      action: item.action,
      from: item.path,
      to: item.destination,
      appliedDestination: item.appliedDestination,
    })),
    duplicateMaterials: actions.duplicateMaterialArchives.map((item) => ({
      title: item.title,
      materialId: item.materialId,
      textLength: item.textLength,
      size: formatBytes(item.sizeBytes),
      from: item.path,
      to: item.destination,
      appliedDestination: item.appliedDestination,
    })),
    oldCoursePackages: actions.oldCoursePackages.map((item) => ({
      name: item.name,
      size: formatBytes(item.sizeBytes),
      updatedAt: item.updatedAtIso,
      path: item.path,
      action: apply && deleteOldCoursePackages ? 'delete' : apply && archiveOldCoursePackages ? 'archive' : 'candidate',
      appliedAction: item.appliedAction,
      appliedDestination: item.appliedDestination,
    })),
    looseArtifacts: actions.looseArtifacts.map((item) => ({
      name: item.name,
      size: formatBytes(item.sizeBytes),
      path: item.path,
      action: apply ? 'archive' : 'candidate',
      appliedDestination: item.appliedDestination,
    })),
    testRuns: actions.testRuns.map((item) => ({
      name: item.name,
      size: formatBytes(item.sizeBytes),
      path: item.path,
      action: apply ? 'archive' : 'candidate',
      appliedDestination: item.appliedDestination,
    })),
    oldLayoutDirs: actions.oldLayoutDirs.map((item) => ({
      name: item.name,
      size: formatBytes(item.sizeBytes),
      path: item.path,
      action: apply ? 'archive' : 'candidate',
      appliedDestination: item.appliedDestination,
    })),
    legacyOutputRoots: actions.legacyOutputRoots.map((item) => ({
      name: item.name,
      size: formatBytes(item.sizeBytes),
      path: item.path,
      action: apply ? 'archive' : 'candidate',
      appliedDestination: item.appliedDestination,
    })),
    caches: includeCaches
      ? caches.map((item) => ({
          path: item.path,
          size: formatBytes(item.sizeBytes),
          fileCount: item.fileCount,
          note: '缓存默认保留；确认不需要复用转写/字幕缓存后再清理。',
        }))
      : [],
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? `${error.stack || error.message}` : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

import fs from 'node:fs'
import path from 'node:path'
import { isWritableStudyPackagePath, normalizeStudyPackageText } from './studyPackageCompat'

export type PersistedNodeLearningSession = {
  nodeId: string
  learningStatus: 'teaching' | 'quizzing' | 'completed'
  messages: Array<{
    id: string
    role: 'system' | 'coach' | 'user'
    content: string
    nodeId?: string
    createdAt: number
  }>
  activeQuestion: string | null
  lastUserAnswer: string
  lastEvaluation: 'correct' | 'partial' | 'incorrect' | null
  hydrated: boolean
  preloaded: boolean
  updatedAt: number
}

export type LearningRecord = {
  id: string
  packageId: string
  title: string
  sourceTitle: string
  sourceId: string
  sourceUrl?: string
  importedCoursePath: string | null
  packagePath: string | null
  courseText: string
  currentNodeId: string | null
  completedNodeIds: string[]
  nodeSessions: Record<string, PersistedNodeLearningSession>
  milestoneEvents: Array<{
    id: string
    kind: 'node_complete' | 'stage_complete' | 'course_complete'
    title: string
    detail: string
    createdAt: number
    nodeId?: string | null
    stageId?: string | null
    progressPercent?: number
  }>
  progressPercent: number
  isArchived: boolean
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
}

export type LearningRecordSummary = Omit<LearningRecord, 'courseText' | 'nodeSessions' | 'completedNodeIds' | 'currentNodeId' | 'milestoneEvents'> & {
  currentNodeId: string | null
  currentNodeTitle: string | null
  completedCount: number
  sessionCount: number
  stageCompletedCount: number
  totalStageCount: number
  recentMilestones: LearningRecord['milestoneEvents']
  achievementBadges: Array<{
    code: 'first_step' | 'steady_stride' | 'stage_breaker' | 'midway' | 'course_finisher'
    label: string
    description: string
    tone: 'neutral' | 'info' | 'success' | 'accent'
  }>
}

export type LearningLibraryState = {
  currentRecordId: string | null
  records: Record<string, LearningRecord>
}

export type LearningLibraryPayload = {
  currentRecordId: string | null
  records: LearningRecordSummary[]
}

export type LearningLibraryRefreshResult = {
  library: LearningLibraryPayload
  recordUpdates: number
  packageUpdates: number
  scannedPackages: number
}

export type LearningLibraryStoreBacking = {
  read: () => Partial<LearningLibraryState> | null | undefined
  write: (next: LearningLibraryState) => void
}

let storeBacking: LearningLibraryStoreBacking | null = null

function requireStoreBacking() {
  if (!storeBacking) {
    throw new Error('Learning library store has not been initialized.')
  }
  return storeBacking
}

function defaultLearningLibraryState(): LearningLibraryState {
  return {
    currentRecordId: null,
    records: {},
  }
}

function normalizeNodeSession(raw: Partial<PersistedNodeLearningSession> | null | undefined, fallbackNodeId: string): PersistedNodeLearningSession {
  const messages = Array.isArray(raw?.messages) ? raw.messages : []
  const rawLearningStatus = String(raw?.learningStatus ?? '')
  return {
    nodeId: String(raw?.nodeId ?? fallbackNodeId),
    learningStatus:
      rawLearningStatus === 'correcting'
        ? 'completed'
        : rawLearningStatus === 'quizzing' || rawLearningStatus === 'completed'
          ? rawLearningStatus
          : 'teaching',
    messages: messages
      .filter((message) => message && typeof message === 'object')
      .map((message, index) => ({
        id: String(message.id ?? `${fallbackNodeId}-${index}`),
        role: message.role === 'system' || message.role === 'user' ? message.role : 'coach',
        content: String(message.content ?? ''),
        nodeId: typeof message.nodeId === 'string' ? message.nodeId : fallbackNodeId,
        createdAt: Number(message.createdAt ?? Date.now()),
      })),
    activeQuestion: raw?.activeQuestion ? String(raw.activeQuestion) : null,
    lastUserAnswer: String(raw?.lastUserAnswer ?? ''),
    lastEvaluation:
      raw?.lastEvaluation === 'correct' || raw?.lastEvaluation === 'partial' || raw?.lastEvaluation === 'incorrect'
        ? raw.lastEvaluation
        : null,
    hydrated: Boolean(raw?.hydrated),
    preloaded: Boolean(raw?.preloaded),
    updatedAt: Number(raw?.updatedAt ?? Date.now()),
  }
}

function readPackageTextWithLightMapUpgrade(courseText: string, packagePath: string | null) {
  if (!isWritableStudyPackagePath(packagePath)) return courseText
  const resolvedPath = packagePath ? path.resolve(packagePath) : ''
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return courseText

  try {
    const freshText = fs.readFileSync(resolvedPath, 'utf-8')
    const currentPayload = JSON.parse(courseText || '{}') as Record<string, unknown>
    const freshPayload = JSON.parse(freshText) as Record<string, unknown>
    const currentPackageId = String(currentPayload.package_id ?? '').trim()
    const freshPackageId = String(freshPayload.package_id ?? '').trim()
    if (currentPackageId && freshPackageId && currentPackageId !== freshPackageId) return courseText
    if (!freshPayload.light_learning_map || currentPayload.light_learning_map) return courseText
    return freshText
  } catch {
    return courseText
  }
}

function normalizeLearningRecord(raw: Partial<LearningRecord> | null | undefined, existing?: LearningRecord): LearningRecord {
  const recordId = String(raw?.id ?? existing?.id ?? raw?.packageId ?? `record-${Date.now()}`)
  const nodeSessions = Object.entries(raw?.nodeSessions ?? existing?.nodeSessions ?? {}).reduce<Record<string, PersistedNodeLearningSession>>(
    (accumulator, [nodeId, session]) => {
      accumulator[nodeId] = normalizeNodeSession(session, nodeId)
      return accumulator
    },
    {},
  )
  const rawImportedCoursePath =
    raw?.importedCoursePath === null
      ? null
      : String(raw?.importedCoursePath ?? existing?.importedCoursePath ?? '') || null
  const rawPackagePath =
    raw?.packagePath === null
      ? null
      : String(raw?.packagePath ?? existing?.packagePath ?? '') || null
  const importedCoursePath = isWritableStudyPackagePath(rawImportedCoursePath) ? rawImportedCoursePath : null
  const packagePath = isWritableStudyPackagePath(rawPackagePath) ? rawPackagePath : null
  const preferredPackagePath = packagePath ?? importedCoursePath
  const rawCourseText = readPackageTextWithLightMapUpgrade(
    String(raw?.courseText ?? existing?.courseText ?? ''),
    preferredPackagePath,
  )
  const normalizedCourseText = normalizeStudyPackageText(
    rawCourseText,
    preferredPackagePath,
  )

  return {
    id: recordId,
    packageId: String(raw?.packageId ?? existing?.packageId ?? recordId),
    title: String(raw?.title ?? existing?.title ?? '未命名学习笔记'),
    sourceTitle: String(raw?.sourceTitle ?? existing?.sourceTitle ?? raw?.title ?? '未命名来源'),
    sourceId: String(raw?.sourceId ?? existing?.sourceId ?? ''),
    sourceUrl: raw?.sourceUrl ?? existing?.sourceUrl ?? '',
    importedCoursePath,
    packagePath,
    courseText: normalizedCourseText.text,
    currentNodeId:
      raw?.currentNodeId === null
        ? null
        : String(raw?.currentNodeId ?? existing?.currentNodeId ?? '') || null,
    completedNodeIds: Array.isArray(raw?.completedNodeIds)
      ? raw!.completedNodeIds.map((value) => String(value))
      : existing?.completedNodeIds ?? [],
    nodeSessions,
    milestoneEvents: Array.isArray(raw?.milestoneEvents)
      ? raw!.milestoneEvents
          .map((event) => ({
            id: String(event?.id ?? `milestone-${Date.now()}-${Math.random()}`),
            kind:
              event?.kind === 'node_complete' ||
              event?.kind === 'stage_complete' ||
              event?.kind === 'course_complete'
                ? event.kind
                : 'node_complete',
            title: String(event?.title ?? '学习里程碑'),
            detail: String(event?.detail ?? ''),
            createdAt: Number(event?.createdAt ?? Date.now()),
            nodeId: event?.nodeId == null ? null : String(event.nodeId),
            stageId: event?.stageId == null ? null : String(event.stageId),
            progressPercent:
              event?.progressPercent == null ? undefined : Math.max(0, Math.min(100, Number(event.progressPercent))),
          }))
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, 60)
      : existing?.milestoneEvents ?? [],
    progressPercent: Math.max(0, Math.min(100, Number(raw?.progressPercent ?? existing?.progressPercent ?? 0))),
    isArchived: Boolean(raw?.isArchived ?? existing?.isArchived ?? false),
    createdAt: Number(raw?.createdAt ?? existing?.createdAt ?? Date.now()),
    updatedAt: Number(raw?.updatedAt ?? existing?.updatedAt ?? Date.now()),
    lastOpenedAt: Number(raw?.lastOpenedAt ?? existing?.lastOpenedAt ?? Date.now()),
  }
}

function loadLearningLibraryState(): LearningLibraryState {
  const raw = requireStoreBacking().read()
  const fallback = defaultLearningLibraryState()
  let shouldPersistNormalizedRecords = false
  const records = Object.entries(raw?.records ?? {}).reduce<Record<string, LearningRecord>>((accumulator, [recordId, record]) => {
    const normalized = normalizeLearningRecord(record, undefined)
    const previous = record as Partial<LearningRecord> | undefined
    if (
      normalized.courseText !== String(previous?.courseText ?? '') ||
      normalized.importedCoursePath !== (previous?.importedCoursePath ?? null) ||
      normalized.packagePath !== (previous?.packagePath ?? null)
    ) {
      shouldPersistNormalizedRecords = true
    }
    accumulator[recordId] = normalized
    return accumulator
  }, {})

  const currentRecordId =
    typeof raw?.currentRecordId === 'string' && records[raw.currentRecordId]
      ? raw.currentRecordId
      : null

  const nextState = {
    currentRecordId,
    records,
  }

  if (shouldPersistNormalizedRecords) {
    saveLearningLibraryState(nextState)
  }

  return nextState
}

function saveLearningLibraryState(next: LearningLibraryState) {
  requireStoreBacking().write(next)
  return next
}

function syncLearningRecordsForStudyPackage(packagePath: string, courseText: string) {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(courseText) as Record<string, unknown>
  } catch {
    return 0
  }

  const resolvedPackagePath = path.resolve(packagePath)
  const packageId = String(parsed.package_id ?? '').trim()
  const course = parsed.course && typeof parsed.course === 'object' ? (parsed.course as Record<string, unknown>) : {}
  const source = parsed.source && typeof parsed.source === 'object' ? (parsed.source as Record<string, unknown>) : {}
  const library = loadLearningLibraryState()
  const now = Date.now()
  let updateCount = 0

  const nextRecords = Object.entries(library.records).reduce<Record<string, LearningRecord>>((accumulator, [recordId, record]) => {
    const recordPackagePath = record.packagePath ?? record.importedCoursePath
    const pathMatches = recordPackagePath ? path.resolve(recordPackagePath) === resolvedPackagePath : false
    const packageMatches = Boolean(packageId && record.packageId === packageId)

    if (!pathMatches && !packageMatches) {
      accumulator[recordId] = record
      return accumulator
    }

    updateCount += 1
    accumulator[recordId] = normalizeLearningRecord(
      {
        ...record,
        packageId: packageId || record.packageId,
        title: String(course.title ?? record.title),
        sourceTitle: String(source.title ?? record.sourceTitle),
        sourceId: String(source.source_id ?? record.sourceId),
        sourceUrl: String(source.url ?? record.sourceUrl ?? ''),
        importedCoursePath: record.importedCoursePath ?? resolvedPackagePath,
        packagePath: record.packagePath ?? resolvedPackagePath,
        courseText,
        updatedAt: now,
      },
      record,
    )
    return accumulator
  }, {})

  if (updateCount > 0) {
    saveLearningLibraryState({
      currentRecordId: library.currentRecordId,
      records: nextRecords,
    })
  }

  return updateCount
}

function sortLearningRecords(records: LearningRecord[]) {
  return [...records].sort((left, right) => {
    if (left.isArchived !== right.isArchived) {
      return Number(left.isArchived) - Number(right.isArchived)
    }
    return right.updatedAt - left.updatedAt
  })
}

function findNodeTitleFromCourseText(courseText: string, nodeId: string | null) {
  if (!courseText || !nodeId) return null
  try {
    const payload = JSON.parse(courseText)
    const chapters = Array.isArray(payload?.chapters) ? payload.chapters : []
    const stack = [...chapters]
    while (stack.length > 0) {
      const node = stack.shift()
      if (!node || typeof node !== 'object') continue
      if (String((node as { id?: string }).id ?? '') === nodeId) {
        return String((node as { title?: string }).title ?? '') || null
      }
      const children = Array.isArray((node as { children?: unknown[] }).children)
        ? ((node as { children?: unknown[] }).children as Record<string, unknown>[])
        : []
      stack.push(...children)
    }
  } catch {
    return null
  }
  return null
}

function countRootStagesFromCourseText(courseText: string) {
  if (!courseText) return 0
  try {
    const payload = JSON.parse(courseText)
    return Array.isArray(payload?.chapters) ? payload.chapters.length : 0
  } catch {
    return 0
  }
}

function buildAchievementBadges(record: LearningRecord) {
  const stageCompleteCount = new Set(
    (record.milestoneEvents ?? [])
      .filter((event) => event.kind === 'stage_complete' && event.stageId)
      .map((event) => event.stageId as string),
  ).size
  const badges: LearningRecordSummary['achievementBadges'] = []

  if (record.completedNodeIds.length >= 1) {
    badges.push({
      code: 'first_step',
      label: '起步完成',
      description: '已经读完第一个小节，进入稳定阅读节奏。',
      tone: 'neutral',
    })
  }

  if (record.completedNodeIds.length >= 5) {
    badges.push({
      code: 'steady_stride',
      label: '稳定推进',
      description: '已经连续推进多个小节，不再只是试试看。',
      tone: 'info',
    })
  }

  if (stageCompleteCount >= 1) {
    badges.push({
      code: 'stage_breaker',
      label: '阶段突破',
      description: '已经完整打通至少一个主线阶段。',
      tone: 'accent',
    })
  }

  if (record.progressPercent >= 50) {
    badges.push({
      code: 'midway',
      label: '半程已过',
      description: '这份资料已经不再是开始阶段，正在进入中段推进。',
      tone: 'success',
    })
  }

  if (record.progressPercent >= 100 || record.isArchived) {
    badges.push({
      code: 'course_finisher',
      label: '资料归档',
      description: '这份资料已经完成，可以永久收录到资料资产里。',
      tone: 'success',
    })
  }

  return badges
}

function summarizeLearningRecord(record: LearningRecord): LearningRecordSummary {
  const stageCompletedCount = new Set(
    (record.milestoneEvents ?? [])
      .filter((event) => event.kind === 'stage_complete' && event.stageId)
      .map((event) => event.stageId as string),
  ).size
  const totalStageCount = countRootStagesFromCourseText(record.courseText)
  const recentMilestones = [...(record.milestoneEvents ?? [])].sort((left, right) => right.createdAt - left.createdAt).slice(0, 6)
  const achievementBadges = buildAchievementBadges(record)

  return {
    id: record.id,
    packageId: record.packageId,
    title: record.title,
    sourceTitle: record.sourceTitle,
    sourceId: record.sourceId,
    sourceUrl: record.sourceUrl,
    importedCoursePath: record.importedCoursePath,
    packagePath: record.packagePath,
    progressPercent: record.progressPercent,
    isArchived: record.isArchived,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastOpenedAt: record.lastOpenedAt,
    currentNodeId: record.currentNodeId,
    currentNodeTitle: findNodeTitleFromCourseText(record.courseText, record.currentNodeId),
    completedCount: record.completedNodeIds.length,
    sessionCount: Object.keys(record.nodeSessions).length,
    stageCompletedCount,
    totalStageCount,
    recentMilestones,
    achievementBadges,
  }
}

function loadLearningLibraryPayload(): LearningLibraryPayload {
  const library = loadLearningLibraryState()
  return {
    currentRecordId: library.currentRecordId,
    records: sortLearningRecords(Object.values(library.records)).map(summarizeLearningRecord),
  }
}

function refreshLearningLibraryStructure(): LearningLibraryRefreshResult {
  const library = loadLearningLibraryState()
  const nextRecords: Record<string, LearningRecord> = {}
  const refreshedPackagePaths = new Set<string>()
  const knownPackagePaths = new Set<string>()
  let recordUpdates = 0

  for (const [recordId, record] of Object.entries(library.records)) {
    const packagePath = record.packagePath ?? record.importedCoursePath
    if (packagePath) {
      knownPackagePaths.add(path.resolve(packagePath))
    }

    const normalized = normalizeLearningRecord(record, record)
    if (
      normalized.courseText !== record.courseText ||
      normalized.importedCoursePath !== record.importedCoursePath ||
      normalized.packagePath !== record.packagePath
    ) {
      recordUpdates += 1
      if (packagePath) {
        refreshedPackagePaths.add(path.resolve(packagePath))
      }
    }
    nextRecords[recordId] = normalized
  }

  if (recordUpdates > 0) {
    saveLearningLibraryState({
      currentRecordId: library.currentRecordId,
      records: nextRecords,
    })
  }

  return {
    library: loadLearningLibraryPayload(),
    recordUpdates,
    packageUpdates: refreshedPackagePaths.size,
    scannedPackages: knownPackagePaths.size,
  }
}

function upsertLearningRecord(nextRecord: LearningRecord) {
  const library = loadLearningLibraryState()
  const existing = library.records[nextRecord.id]
  const normalized = normalizeLearningRecord(nextRecord, existing)
  const nextLibrary: LearningLibraryState = {
    currentRecordId: normalized.id,
    records: {
      ...library.records,
      [normalized.id]: normalized,
    },
  }
  saveLearningLibraryState(nextLibrary)
  return normalized
}

function deleteLearningRecord(recordId: string) {
  const library = loadLearningLibraryState()
  const nextRecords = { ...library.records }
  delete nextRecords[recordId]
  const nextCurrentRecordId =
    library.currentRecordId === recordId
      ? null
      : library.currentRecordId
  saveLearningLibraryState({
    currentRecordId: nextCurrentRecordId,
    records: nextRecords,
  })
  return loadLearningLibraryPayload()
}

function openLearningRecord(recordId: string) {
  const library = loadLearningLibraryState()
  const record = library.records[recordId]
  if (!record) {
    throw new Error('未找到指定的资料记录。')
  }
  const normalized = normalizeLearningRecord(
    {
      ...record,
      lastOpenedAt: Date.now(),
      updatedAt: Date.now(),
    },
    record,
  )
  saveLearningLibraryState({
    currentRecordId: normalized.id,
    records: {
      ...library.records,
      [normalized.id]: normalized,
    },
  })
  return normalized
}

function saveArchivedLearningRecord(nextRecord: LearningRecord) {
  const library = loadLearningLibraryState()
  const existing = library.records[nextRecord.id]
  const normalized = normalizeLearningRecord(nextRecord, existing)
  saveLearningLibraryState({
    currentRecordId: library.currentRecordId,
    records: {
      ...library.records,
      [normalized.id]: normalized,
    },
  })
  return normalized
}

export function createLearningLibraryStore(backing: LearningLibraryStoreBacking) {
  storeBacking = backing
  return {
    loadState: loadLearningLibraryState,
    saveState: saveLearningLibraryState,
    syncStudyPackage: syncLearningRecordsForStudyPackage,
    loadPayload: loadLearningLibraryPayload,
    refreshStructure: refreshLearningLibraryStructure,
    upsert: upsertLearningRecord,
    deleteRecord: deleteLearningRecord,
    openRecord: openLearningRecord,
    saveArchivedRecord: saveArchivedLearningRecord,
  }
}

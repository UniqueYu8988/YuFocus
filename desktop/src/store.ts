import { create } from 'zustand'
import { makeCoachMessages, makeMessage } from './lib/coachMessages'
import { getNextNodeId, getNextSequentialNodeId, getUnlockedNodeIds, isStudyNode } from './lib/studyTree'
import {
  buildAchievementBadgesSummary,
  buildCourseState,
  buildEffectiveCompletedNodeIds,
  computeNodeCompletionStreak,
  createEmptySession,
  isEffectivelyCompletedSession,
  mergeRecordIntoCourseState,
  persistSession,
} from './lib/learningState'
import { buildCompletionCelebrationPayload } from './lib/learningProgression'
import {
  buildDistillProgressSnapshot,
  type DistillProgressSnapshot,
} from './lib/distillProgress'
import { buildFallbackCoachTurn, resolveTrackedQuestion } from './lib/learningTurn'
import type {
  AchievementBadge,
  CoachMessage,
  CoursePackage,
  FlatCourseNode,
  LearningMilestoneEvent,
  LearningLibraryPayload,
  LearningRecord,
  LearningRecordSummary,
  NodeLearningSession,
  PersistedNodeLearningSession,
} from './types/course'

type RuntimeSettings = Awaited<ReturnType<typeof window.desktopAPI.loadSettings>>
type DistillRequestState = 'idle' | 'loading' | 'error'
type BootState = 'booting' | 'ready'
type ToastTone = 'info' | 'success' | 'error'
type MaterialSourceKind = 'bilibili' | 'local_media'
type MaterialPackageResult = Awaited<ReturnType<typeof window.desktopAPI.runDistillation>>
type AppToast = {
  id: string
  title: string
  description?: string
  tone: ToastTone
}
type LearningMomentumSnapshot = {
  todayCompletedCount: number
  todayStageCount: number
  recentMilestoneCount: number
  latestMilestoneAt: number | null
  currentStreak: number
  momentumLabel: string
}

const DISTILL_UI_TIMEOUT_MS = 1_860_000
const TOAST_LIFETIME_MS = 3200
let toastTimer: ReturnType<typeof globalThis.setTimeout> | null = null

function makeInitialCoachMessages(node: FlatCourseNode, content: string) {
  const displayHints = node.teacher_ready_content?.display_hints ?? []
  if (displayHints.includes('article_reading')) {
    return [makeMessage('coach', content, node.id)]
  }
  return makeCoachMessages(content, node.id)
}

type LearningStore = {
  bootState: BootState
  runtimeSettings: RuntimeSettings | null
  distillRequestState: DistillRequestState
  distillProgressPercent: number
  distillStatusMessage: string
  distillError: string | null
  distillOutlinePreview: DistillOutlinePreview | null
  distillProgressSnapshot: DistillProgressSnapshot | null
  lastMaterialResult: MaterialPackageResult | null
  videoInput: string
  toast: AppToast | null
  milestoneEvents: LearningMilestoneEvent[]

  libraryRecords: LearningRecordSummary[]
  activeRecordId: string | null
  activeRecordCreatedAt: number | null

  courseData: CoursePackage | null
  importedCoursePath: string | null
  nodeMap: Record<string, FlatCourseNode>
  rootNodeIds: string[]
  orderedNodeIds: string[]
  orderedStudyNodeIds: string[]

  currentNodeId: string | null
  unlockedNodeIds: string[]
  completedNodeIds: string[]
  nodeSessions: Record<string, NodeLearningSession>

  hydrateApp: () => Promise<void>
  loadRuntimeSettings: () => Promise<void>
  setRuntimeSettings: (runtimeSettings: RuntimeSettings) => void
  refreshLibrary: () => Promise<LearningLibraryPayload>
  loadCourse: (course: CoursePackage, importedPath?: string | null) => Promise<void>
  loadCourseFromText: (text: string, importedPath?: string | null) => Promise<void>
  restoreLearningRecord: (record: LearningRecord) => Promise<void>
  openSavedRecord: (recordId: string) => Promise<void>
  openDeepLinkedNode: (packageId: string, nodeId?: string | null) => Promise<void>
  deleteSavedRecord: (recordId: string) => Promise<void>
  clearActiveCourse: () => void
  importCoursePackage: () => Promise<void>
  setVideoInput: (value: string) => void
  distillCourseFromVideo: (payload?: { sourceKind?: MaterialSourceKind; video?: string; mediaPath?: string; editorialMode?: 'auto' | 'force' | 'off' }) => Promise<void>
  setCurrentNode: (nodeId: string) => void
  openNodeSession: (nodeId: string, options?: { forceRestart?: boolean }) => Promise<void>
  submitUserAnswer: (answer: string) => Promise<void>
  appendCoachMessage: (message: CoachMessage) => void
  recomputeUnlockedNodes: () => void
  goToNextNode: () => Promise<void>
  saveCurrentProgress: () => Promise<void>
  preloadNextNode: (nodeId: string | null) => Promise<void>
  pushToast: (title: string, description?: string, tone?: ToastTone) => void
  dismissToast: () => void

  isNodeUnlocked: (nodeId: string) => boolean
  isNodeCompleted: (nodeId: string) => boolean
  isStudyNode: (nodeId: string) => boolean
  getCurrentAchievementBadges: () => AchievementBadge[]
  getRecentMilestones: (limit?: number) => LearningMilestoneEvent[]
  getMomentumSnapshot: () => LearningMomentumSnapshot
  getCurrentNode: () => FlatCourseNode | null
  getCurrentSession: () => NodeLearningSession | null
}

type LearningStoreSetter = (
  partial:
    | Partial<LearningStore>
    | ((state: LearningStore) => Partial<LearningStore>),
  replace?: false,
) => void

function emitToast(set: LearningStoreSetter, toast: Omit<AppToast, 'id'>) {
  if (toastTimer) {
    globalThis.clearTimeout(toastTimer)
    toastTimer = null
  }

  const nextToast: AppToast = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    ...toast,
  }

  set({ toast: nextToast })

  toastTimer = globalThis.setTimeout(() => {
    set((state) => (state.toast?.id === nextToast.id ? { toast: null } : {}))
    toastTimer = null
  }, TOAST_LIFETIME_MS)
}

function isSameCoursePackage(recordText: string, course: CoursePackage) {
  try {
    return JSON.stringify(JSON.parse(recordText)) === JSON.stringify(course)
  } catch {
    return false
  }
}

function normalizeWritableStudyPackagePath(importedPath?: string | null) {
  const normalized = String(importedPath ?? '').trim()
  if (!normalized) return null
  if (!/\.json$/iu.test(normalized)) return null
  return normalized
}

function clearCourseState() {
  return {
    courseData: null,
    importedCoursePath: null,
    nodeMap: {},
    rootNodeIds: [],
    orderedNodeIds: [],
    orderedStudyNodeIds: [],
    currentNodeId: null,
    unlockedNodeIds: [],
    completedNodeIds: [],
    nodeSessions: {},
    activeRecordId: null,
    activeRecordCreatedAt: null,
    milestoneEvents: [],
  }
}

export const useLearningStore = create<LearningStore>((set, get) => ({
  bootState: 'booting',
  runtimeSettings: null,
  distillRequestState: 'idle',
  distillProgressPercent: 0,
  distillStatusMessage: '',
  distillError: null,
  distillOutlinePreview: null,
  distillProgressSnapshot: null,
  lastMaterialResult: null,
  videoInput: '',
  toast: null,
  milestoneEvents: [],

  libraryRecords: [],
  activeRecordId: null,
  activeRecordCreatedAt: null,

  courseData: null,
  importedCoursePath: null,
  nodeMap: {},
  rootNodeIds: [],
  orderedNodeIds: [],
  orderedStudyNodeIds: [],

  currentNodeId: null,
  unlockedNodeIds: [],
  completedNodeIds: [],
  nodeSessions: {},

  hydrateApp: async () => {
    await get().loadRuntimeSettings()
    await get().refreshLibrary()

    set({
      bootState: 'ready',
      courseData: null,
      importedCoursePath: null,
      nodeMap: {},
      rootNodeIds: [],
      orderedNodeIds: [],
      orderedStudyNodeIds: [],
      currentNodeId: null,
      unlockedNodeIds: [],
      completedNodeIds: [],
      nodeSessions: {},
      activeRecordCreatedAt: null,
      milestoneEvents: [],
    })
  },

  loadRuntimeSettings: async () => {
    const runtimeSettings = await window.desktopAPI.loadSettings()
    set({ runtimeSettings })
  },

  setRuntimeSettings: (runtimeSettings) => {
    set({
      runtimeSettings,
      distillError: null,
    })
  },

  refreshLibrary: async () => {
    const payload = await window.desktopAPI.loadLearningLibrary()
    const activePackageId = get().courseData?.package_id ?? ''
    const activeRecord = activePackageId
      ? payload.records.find((record) => record.packageId === activePackageId) ?? null
      : null
    set({
      libraryRecords: payload.records,
      activeRecordId: activeRecord?.id ?? null,
    })
    if (activePackageId && !activeRecord) {
      set(clearCourseState())
      set({
        libraryRecords: payload.records,
        activeRecordId: null,
      })
    }
    return payload
  },

  loadCourse: async (course, importedPath = null) => {
    const writableImportedPath = normalizeWritableStudyPackagePath(importedPath)
    const existingSummary = get().libraryRecords.find((record) => record.packageId === course.package_id)
    let nextState = buildCourseState(course, writableImportedPath, [], null)
    let activeRecordId = course.package_id
    let activeRecordCreatedAt: number | null = null
    let milestoneEvents: LearningMilestoneEvent[] = []

    if (existingSummary) {
      try {
        const existingRecord = await window.desktopAPI.openLearningRecord(existingSummary.id)
        if (isSameCoursePackage(existingRecord.courseText, course) || existingRecord.packageId === course.package_id) {
          nextState = mergeRecordIntoCourseState(course, writableImportedPath, existingRecord)
          activeRecordId = existingRecord.id
          activeRecordCreatedAt = existingRecord.createdAt
          milestoneEvents = existingRecord.milestoneEvents ?? []
        }
      } catch {
        // fall back to a fresh course state if the stored record is unavailable
      }
    }

    set({
      ...nextState,
      activeRecordId,
      activeRecordCreatedAt,
      distillError: null,
      distillProgressSnapshot: null,
      milestoneEvents,
    })
    await get().saveCurrentProgress()
    if (nextState.currentNodeId) {
      await get().openNodeSession(nextState.currentNodeId)
    }
  },

  loadCourseFromText: async (text, importedPath = null) => {
    const parsed = JSON.parse(text) as CoursePackage
    await get().loadCourse(parsed, importedPath)
  },

  restoreLearningRecord: async (record) => {
    const parsed = JSON.parse(record.courseText) as CoursePackage
    const writableImportedPath = normalizeWritableStudyPackagePath(record.packagePath ?? record.importedCoursePath)
    const nextState = buildCourseState(
      parsed,
      writableImportedPath,
      record.completedNodeIds ?? [],
      record.currentNodeId ?? null,
      record.nodeSessions ?? {},
    )

    set({
      ...nextState,
      activeRecordId: record.id,
      activeRecordCreatedAt: record.createdAt,
      distillError: null,
      distillProgressSnapshot: null,
      milestoneEvents: record.milestoneEvents ?? [],
    })

    const currentSession = nextState.currentNodeId ? nextState.nodeSessions[nextState.currentNodeId] : null
    if (nextState.currentNodeId && (!currentSession || !currentSession.hydrated)) {
      await get().openNodeSession(nextState.currentNodeId)
    } else {
      await get().saveCurrentProgress()
      await get().preloadNextNode(nextState.currentNodeId)
    }
  },

  openSavedRecord: async (recordId) => {
    const record = await window.desktopAPI.openLearningRecord(recordId)
    await get().restoreLearningRecord(record)
    await get().refreshLibrary()
    get().pushToast('已恢复学习', `回到《${record.title}》`, 'success')
  },

  openDeepLinkedNode: async (packageId, nodeId = null) => {
    if (!packageId) return

    let targetRecord =
      get().libraryRecords.find((record) => record.packageId === packageId || record.id === packageId) ?? null

    if (!targetRecord) {
      const library = await get().refreshLibrary()
      targetRecord = library.records.find((record) => record.packageId === packageId || record.id === packageId) ?? null
    }

    if (!targetRecord) {
      get().pushToast('找不到这份资料', '这条回跳链接对应的资料还没有出现在本地档案里。', 'error')
      return
    }

    if (get().activeRecordId !== targetRecord.id || get().courseData?.package_id !== targetRecord.packageId) {
      const record = await window.desktopAPI.openLearningRecord(targetRecord.id)
      await get().restoreLearningRecord(record)
      await get().refreshLibrary()
    }

    const state = get()
    if (!nodeId) {
      get().pushToast('已恢复资料', `已打开《${targetRecord.title}》`, 'success')
      return
    }

    const node = state.nodeMap[nodeId]
    if (!node) {
      get().pushToast('已恢复资料', `已打开《${targetRecord.title}》，但没有找到对应小节。`, 'info')
      return
    }

    if (!state.isStudyNode(nodeId)) {
      get().pushToast('已恢复资料', `已打开《${targetRecord.title}》，该链接对应的是目录节点。`, 'info')
      return
    }

    if (!state.isNodeUnlocked(nodeId)) {
      get().pushToast('节点暂未解锁', `已回到《${targetRecord.title}》，但《${node.title}》还不能直接进入。`, 'info')
      return
    }

    await get().openNodeSession(nodeId)
    get().pushToast('已跳回当前小节', `继续学习《${node.title}》`, 'success')
  },

  deleteSavedRecord: async (recordId) => {
    const currentRecordId = get().activeRecordId
    const record = get().libraryRecords.find((item) => item.id === recordId) ?? null
    const activePackageId = get().courseData?.package_id ?? ''
    const payload = await window.desktopAPI.deleteLearningRecord(recordId)
    set({
      libraryRecords: payload.records,
      activeRecordId: currentRecordId === recordId ? null : get().activeRecordId,
    })

    const deletedActiveRecord =
      currentRecordId === recordId ||
      Boolean(record?.packageId && activePackageId && record.packageId === activePackageId) ||
      (payload.records.length === 0 && Boolean(activePackageId))

    if (deletedActiveRecord) {
      set(clearCourseState())
      set({
        libraryRecords: payload.records,
        activeRecordId: null,
      })
    }
    get().pushToast('资料记录已删除', record ? `《${record.title}》已从本地档案移除` : '本地记录已移除', 'success')
  },

  clearActiveCourse: () => {
    set(clearCourseState())
  },

  importCoursePackage: async () => {
    const result = await window.desktopAPI.importCoursePackage()
    if (!result) return
    await get().loadCourseFromText(result.text, result.path)
    await get().refreshLibrary()
    try {
      const parsed = JSON.parse(result.text) as CoursePackage
      get().pushToast('资料包已导入', `已载入《${parsed.course.title}》`, 'success')
    } catch {
      get().pushToast('资料包已导入', result.path, 'success')
    }
  },

  setVideoInput: (value) => {
    set({
      videoInput: value,
      distillError: null,
      distillRequestState: 'idle',
      distillProgressPercent: 0,
      distillOutlinePreview: null,
      distillProgressSnapshot: null,
    })
  },

  distillCourseFromVideo: async (payload = {}) => {
    const sourceKind = payload.sourceKind === 'local_media' ? 'local_media' : 'bilibili'
    const videoInput = (sourceKind === 'local_media' ? payload.mediaPath || get().videoInput : payload.video || get().videoInput).trim()
    if (!videoInput) {
      set({
        distillRequestState: 'error',
        distillError: sourceKind === 'local_media' ? '请先选择本地视频或音频文件。' : '请先粘贴 B 站视频链接或 BV 号。',
      })
      return
    }

    set({
      distillRequestState: 'loading',
      distillProgressPercent: 3,
      distillStatusMessage: '正在整理资料包，请稍候…',
      distillError: null,
      distillOutlinePreview: null,
      lastMaterialResult: null,
      distillProgressSnapshot: {
        stage: 'unknown',
        stageLabel: '准备启动',
        message: '正在整理资料包，请稍候…',
        cacheHint: null,
        audioCompleted: 0,
        audioTotal: 0,
        chunkCompleted: 0,
        chunkTotal: 0,
        resumed: false,
      },
    })

    const unsubscribe = window.desktopAPI.onDistillProgress((payload) => {
      const snapshot = buildDistillProgressSnapshot(payload)
      set({
        distillProgressPercent: Number(payload.percent || 0),
        distillStatusMessage: payload.message || '正在整理资料包，请稍候…',
        distillOutlinePreview: payload.outlinePreview ?? get().distillOutlinePreview,
        distillProgressSnapshot: snapshot,
      })
    })

    try {
      const result = await Promise.race([
        window.desktopAPI.runDistillation({
          video: sourceKind === 'bilibili' ? videoInput : undefined,
          mediaPath: sourceKind === 'local_media' ? videoInput : undefined,
          sourceKind,
          editorialMode: payload.editorialMode,
        }),
        new Promise<never>((_, reject) => {
          globalThis.setTimeout(() => {
            reject(new Error(`资料整理等待超时（>${Math.floor(DISTILL_UI_TIMEOUT_MS / 1000)} 秒）。`))
          }, DISTILL_UI_TIMEOUT_MS)
        }),
      ])
      set({
        distillRequestState: 'idle',
        distillProgressPercent: 100,
        distillStatusMessage: '',
        distillError: null,
        distillOutlinePreview: null,
        distillProgressSnapshot: null,
        lastMaterialResult: result,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '资料整理失败'
      set({
        distillRequestState: 'error',
        distillProgressPercent: 0,
        distillStatusMessage: '',
        distillError: message,
        distillOutlinePreview: get().distillOutlinePreview,
        distillProgressSnapshot: get().distillProgressSnapshot,
      })
      get().pushToast('整理失败', message, 'error')
    } finally {
      unsubscribe()
    }
  },

  setCurrentNode: (nodeId) => {
    if (!get().isStudyNode(nodeId)) return
    void get().openNodeSession(nodeId)
  },

  openNodeSession: async (nodeId, options: { forceRestart?: boolean } = {}) => {
    const state = get()
    const node = state.nodeMap[nodeId]
    if (!node || !state.courseData || !state.isStudyNode(nodeId)) return

    const existingSession = state.nodeSessions[nodeId] ?? createEmptySession(nodeId)

    set((latestState) => ({
      currentNodeId: nodeId,
      nodeSessions: {
        ...latestState.nodeSessions,
        [nodeId]: {
          ...existingSession,
          preloaded: false,
          error: null,
        },
      },
    }))

    if (existingSession.hydrated && !options.forceRestart) {
      if (state.isNodeUnlocked(nodeId)) {
        await get().saveCurrentProgress()
      }
      await get().preloadNextNode(nodeId)
      return
    }

    const nextMessages = [makeMessage('system', `本地专注页：${node.title}`, nodeId)]
    const nextNodeId = getNextSequentialNodeId(state.orderedStudyNodeIds, nodeId)
    const nextNode = nextNodeId ? state.nodeMap[nextNodeId] ?? null : null
    const localTurn = buildFallbackCoachTurn({
      node,
      learningStatus: 'teaching',
      activeQuestion: existingSession.activeQuestion,
      nextNode,
    })
    const trackedQuestion = resolveTrackedQuestion(
      node,
      localTurn.learningStatus,
      existingSession.activeQuestion || localTurn.reply,
    )

    set((latestState) => ({
      currentNodeId: nodeId,
      nodeSessions: {
        ...latestState.nodeSessions,
        [nodeId]: {
          ...createEmptySession(nodeId),
          messages: [...nextMessages, ...makeInitialCoachMessages(node, localTurn.reply)],
          learningStatus: localTurn.learningStatus,
          activeQuestion: localTurn.learningStatus === 'quizzing' ? trackedQuestion : null,
          requestState: 'idle',
          error: null,
          hydrated: true,
          updatedAt: Date.now(),
        },
      },
    }))
    if (state.isNodeUnlocked(nodeId)) {
      await get().saveCurrentProgress()
    }
  },

  submitUserAnswer: async (answer) => {
    const state = get()
    const node = state.getCurrentNode()
    const session = state.getCurrentSession()
    if (!node || !state.courseData || !session) return
    if (!state.isNodeUnlocked(node.id)) return

    const userMessage = makeMessage('user', answer, node.id)
    const pendingMessages = [...session.messages, userMessage]
    const currentQuestion = session.activeQuestion
    const nextSequentialNodeId = getNextSequentialNodeId(state.orderedStudyNodeIds, node.id)
    const nextSequentialNode = nextSequentialNodeId ? state.nodeMap[nextSequentialNodeId] ?? null : null

    const localTurn = buildFallbackCoachTurn({
      node,
      learningStatus: session.learningStatus === 'teaching' ? 'teaching' : 'quizzing',
      activeQuestion: currentQuestion,
      answer,
      nextNode: nextSequentialNode,
    })

    if (!localTurn.markCurrentNodeCompleted) {
      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [node.id]: {
            ...latestState.nodeSessions[node.id],
            messages: [
              ...pendingMessages,
              ...makeCoachMessages(localTurn.reply, node.id),
            ],
            learningStatus: localTurn.learningStatus,
            activeQuestion: localTurn.learningStatus === 'quizzing' ? currentQuestion : null,
            requestState: 'idle',
            error: null,
            hydrated: true,
            lastUserAnswer: answer,
            lastEvaluation: null,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
      return
    }

    const completionPayload = buildCompletionCelebrationPayload({
      courseTitle: state.courseData.course.title,
      node,
      nodeMap: state.nodeMap,
      orderedStudyNodeIds: state.orderedStudyNodeIds,
      previousCompletedNodeIds: state.completedNodeIds,
      milestoneEvents: state.milestoneEvents,
    })
    set((latestState) => ({
      completedNodeIds: completionPayload.completedNodeIds,
      unlockedNodeIds: completionPayload.unlockedNodeIds,
      milestoneEvents: completionPayload.milestoneEvents,
      nodeSessions: {
        ...latestState.nodeSessions,
        [node.id]: {
          ...latestState.nodeSessions[node.id],
          messages: [
            ...pendingMessages,
            ...makeCoachMessages(localTurn.reply, node.id),
          ],
          learningStatus: 'completed',
          activeQuestion: null,
          requestState: 'idle',
          error: null,
          hydrated: true,
          lastUserAnswer: answer,
          lastEvaluation: 'partial',
          updatedAt: Date.now(),
        },
      },
    }))
    if (completionPayload.toast) {
      get().pushToast(
        completionPayload.toast.title,
        completionPayload.toast.description,
        completionPayload.toast.tone,
      )
    }
    await get().saveCurrentProgress()
  },

  appendCoachMessage: (message) => {
    const nodeId = message.nodeId ?? get().currentNodeId
    if (!nodeId) return
    const nextMessages =
      message.role === 'coach' ? makeCoachMessages(message.content, nodeId) : [message]
    set((state) => ({
      nodeSessions: {
        ...state.nodeSessions,
        [nodeId]: {
          ...(state.nodeSessions[nodeId] ?? createEmptySession(nodeId)),
          messages: [...(state.nodeSessions[nodeId]?.messages ?? []), ...nextMessages],
          updatedAt: Date.now(),
        },
      },
    }))
  },

  recomputeUnlockedNodes: () => {
    const state = get()
    set({ unlockedNodeIds: getUnlockedNodeIds(state.nodeMap, state.completedNodeIds) })
  },

  goToNextNode: async () => {
    const state = get()
    const currentSession = state.getCurrentSession()
    const currentNodeCompleted =
      Boolean(state.currentNodeId && state.completedNodeIds.includes(state.currentNodeId)) ||
      isEffectivelyCompletedSession(currentSession)
    if (!currentNodeCompleted) return
    const nextNodeId =
      getNextSequentialNodeId(state.orderedStudyNodeIds, state.currentNodeId) ??
      getNextNodeId(
        state.orderedStudyNodeIds,
        state.nodeMap,
        buildEffectiveCompletedNodeIds(state.currentNodeId, state.completedNodeIds, state.nodeSessions),
      )
    if (!nextNodeId) return
    await get().openNodeSession(nextNodeId)
  },

  saveCurrentProgress: async () => {
    const state = get()
    if (!state.courseData) return

    const now = Date.now()
    const recordId = state.activeRecordId || state.courseData.package_id
    const previousSummary = state.libraryRecords.find((record) => record.id === recordId) ?? null
    const wasArchived = Boolean(previousSummary?.isArchived)
    const totalStudyNodeCount = state.orderedStudyNodeIds.length || 1
    const progressPercent = Math.round((state.completedNodeIds.length / totalStudyNodeCount) * 100)
    const nodeSessions = Object.entries(state.nodeSessions).reduce<Record<string, PersistedNodeLearningSession>>(
      (accumulator, [nodeId, session]) => {
        if (!session.hydrated && session.messages.length === 0) return accumulator
        accumulator[nodeId] = persistSession({
          ...session,
          requestState: 'idle',
          error: null,
        })
        return accumulator
      },
      {},
    )

    const record = await window.desktopAPI.saveLearningRecord({
      id: recordId,
      packageId: state.courseData.package_id,
      title: state.courseData.course.title,
      sourceTitle: state.courseData.source.title,
      sourceId: state.courseData.source.source_id,
      sourceUrl: state.courseData.source.url,
      importedCoursePath: state.importedCoursePath,
      packagePath: state.importedCoursePath,
      courseText: JSON.stringify(state.courseData, null, 2),
      currentNodeId: state.currentNodeId,
      completedNodeIds: state.completedNodeIds,
      nodeSessions,
      milestoneEvents: state.milestoneEvents,
      progressPercent,
      isArchived: progressPercent >= 100,
      createdAt: state.activeRecordCreatedAt ?? now,
      updatedAt: now,
      lastOpenedAt: now,
    })

    set({
      activeRecordId: record.id,
      activeRecordCreatedAt: record.createdAt,
    })
    await get().refreshLibrary()
    if (!wasArchived && progressPercent >= 100) {
      get().pushToast('资料已归档', `《${state.courseData.course.title}》已完成并收录到归档区`, 'success')
    }
  },

  preloadNextNode: async (nodeId) => {
    void nodeId
  },

  pushToast: (title, description, tone = 'info') => {
    emitToast(set, { title, description, tone })
  },

  dismissToast: () => {
    if (toastTimer) {
      globalThis.clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toast: null })
  },

  isNodeUnlocked: (nodeId) => get().unlockedNodeIds.includes(nodeId),
  isNodeCompleted: (nodeId) => get().completedNodeIds.includes(nodeId),
  isStudyNode: (nodeId) => {
    const node = get().nodeMap[nodeId]
    return Boolean(node && isStudyNode(node))
  },
  getCurrentAchievementBadges: () => {
    const state = get()
    const totalStudyNodeCount = state.orderedStudyNodeIds.length || 1
    const progressPercent = Math.round((state.completedNodeIds.length / totalStudyNodeCount) * 100)
    return buildAchievementBadgesSummary(state.completedNodeIds.length, progressPercent, state.milestoneEvents)
  },
  getRecentMilestones: (limit = 4) => get().milestoneEvents.slice(0, limit),
  getMomentumSnapshot: () => {
    const now = Date.now()
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayTs = startOfToday.getTime()
    const recentThreshold = now - 24 * 60 * 60 * 1000
    const events = get().milestoneEvents
    const todayCompletedCount = events.filter(
      (event) => event.kind === 'node_complete' && event.createdAt >= todayTs,
    ).length
    const todayStageCount = events.filter(
      (event) => event.kind === 'stage_complete' && event.createdAt >= todayTs,
    ).length
    const recentMilestoneCount = events.filter((event) => event.createdAt >= recentThreshold).length
    const latestMilestoneAt = events[0]?.createdAt ?? null
    const currentStreak = computeNodeCompletionStreak(events)
    const momentumLabel =
      todayStageCount > 0
        ? `今天已经打通 ${todayStageCount} 个阶段`
        : currentStreak >= 5
          ? `当前已经连过 ${currentStreak} 关`
          : currentStreak >= 3
            ? `当前正处在连过 ${currentStreak} 关的节奏里`
        : todayCompletedCount >= 4
          ? `今天已经连续读完 ${todayCompletedCount} 个小节`
          : todayCompletedCount > 0
            ? '今天正在稳定推进'
            : recentMilestoneCount > 0
              ? '最近 24 小时还在持续推进'
              : '这份资料还在起步阶段'

    return {
      todayCompletedCount,
      todayStageCount,
      recentMilestoneCount,
      latestMilestoneAt,
      currentStreak,
      momentumLabel,
    }
  },
  getCurrentNode: () => {
    const state = get()
    return state.currentNodeId ? state.nodeMap[state.currentNodeId] ?? null : null
  },
  getCurrentSession: () => {
    const state = get()
    return state.currentNodeId ? state.nodeSessions[state.currentNodeId] ?? null : null
  },
}))

import { create } from 'zustand'
import { requestCoachTurn, resolveCoachApiConfig } from './lib/coachApi'
import { buildCoachSystemPrompt, buildCurrentNodeMeta } from './lib/coachPrompt'
import { flattenCourse, getNextNodeId, getNextSequentialNodeId, getUnlockedNodeIds, isStudyNode } from './lib/courseTree'
import type {
  CoachMessage,
  CoursePackage,
  FlatCourseNode,
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
type AppToast = {
  id: string
  title: string
  description?: string
  tone: ToastTone
}

const DISTILL_UI_TIMEOUT_MS = 240_000
const TOAST_LIFETIME_MS = 3200
let toastTimer: ReturnType<typeof globalThis.setTimeout> | null = null

function makeMessage(role: CoachMessage['role'], content: string, nodeId?: string): CoachMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    role,
    content,
    nodeId,
    createdAt: Date.now(),
  }
}

function createEmptySession(nodeId: string): NodeLearningSession {
  return {
    nodeId,
    learningStatus: 'teaching',
    messages: [],
    activeQuestion: null,
    lastUserAnswer: '',
    lastEvaluation: null,
    requestState: 'idle',
    error: null,
    hydrated: false,
    preloaded: false,
    updatedAt: Date.now(),
  }
}

function restoreSession(nodeId: string, persisted?: PersistedNodeLearningSession | null): NodeLearningSession {
  if (!persisted) {
    return createEmptySession(nodeId)
  }

  return {
    nodeId,
    learningStatus: persisted.learningStatus,
    messages: Array.isArray(persisted.messages) ? persisted.messages : [],
    activeQuestion: persisted.activeQuestion ?? null,
    lastUserAnswer: persisted.lastUserAnswer ?? '',
    lastEvaluation: persisted.lastEvaluation ?? null,
    requestState: 'idle',
    error: null,
    hydrated: Boolean(persisted.hydrated),
    preloaded: Boolean(persisted.preloaded),
    updatedAt: persisted.updatedAt ?? Date.now(),
  }
}

function persistSession(session: NodeLearningSession): PersistedNodeLearningSession {
  return {
    nodeId: session.nodeId,
    learningStatus: session.learningStatus,
    messages: session.messages,
    activeQuestion: session.activeQuestion,
    lastUserAnswer: session.lastUserAnswer,
    lastEvaluation: session.lastEvaluation,
    hydrated: session.hydrated,
    preloaded: session.preloaded,
    updatedAt: session.updatedAt,
  }
}

function buildCourseState(
  course: CoursePackage,
  importedPath: string | null,
  completedNodeIds: string[],
  failedNodeIds: string[],
  preferredCurrentNodeId: string | null,
  persistedSessions: Record<string, PersistedNodeLearningSession> = {},
) {
  const flattened = flattenCourse(course)
  const unlockedNodeIds = getUnlockedNodeIds(flattened.nodeMap, completedNodeIds)
  const orderedStudyNodeIds = flattened.orderedStudyNodeIds
  const fallbackCurrentNodeId = getNextNodeId(orderedStudyNodeIds, flattened.nodeMap, completedNodeIds)
  const currentNodeId =
    preferredCurrentNodeId && orderedStudyNodeIds.includes(preferredCurrentNodeId) && unlockedNodeIds.includes(preferredCurrentNodeId)
      ? preferredCurrentNodeId
      : fallbackCurrentNodeId

  const nodeSessions = orderedStudyNodeIds.reduce<Record<string, NodeLearningSession>>((accumulator, nodeId) => {
    accumulator[nodeId] = restoreSession(nodeId, persistedSessions[nodeId])
    return accumulator
  }, {})

  return {
    courseData: course,
    importedCoursePath: importedPath,
    nodeMap: flattened.nodeMap,
    rootNodeIds: flattened.rootNodeIds,
    orderedNodeIds: flattened.orderedNodeIds,
    orderedStudyNodeIds,
    currentNodeId,
    unlockedNodeIds,
    completedNodeIds,
    failedNodeIds,
    nodeSessions,
  }
}

function mergeRecordIntoCourseState(
  course: CoursePackage,
  importedPath: string | null,
  record: LearningRecord,
) {
  const flattened = flattenCourse(course)
  const completedNodeIds = (record.completedNodeIds ?? []).filter((nodeId) =>
    flattened.nodeMap[nodeId],
  )
  const failedNodeIds = (record.failedNodeIds ?? []).filter((nodeId) =>
    flattened.nodeMap[nodeId],
  )
  const persistedSessions = Object.entries(record.nodeSessions ?? {}).reduce<Record<string, PersistedNodeLearningSession>>(
    (accumulator, [nodeId, session]) => {
      if (flattened.nodeMap[nodeId]) {
        accumulator[nodeId] = session
      }
      return accumulator
    },
    {},
  )

  return buildCourseState(
    course,
    importedPath,
    completedNodeIds,
    failedNodeIds,
    record.currentNodeId ?? null,
    persistedSessions,
  )
}

type LearningStore = {
  bootState: BootState
  runtimeSettings: RuntimeSettings | null
  distillRequestState: DistillRequestState
  distillProgressPercent: number
  distillStatusMessage: string
  distillError: string | null
  videoInput: string
  toast: AppToast | null

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
  failedNodeIds: string[]
  nodeSessions: Record<string, NodeLearningSession>

  hydrateApp: () => Promise<void>
  loadRuntimeSettings: () => Promise<void>
  setRuntimeSettings: (runtimeSettings: RuntimeSettings) => void
  refreshLibrary: () => Promise<LearningLibraryPayload>
  loadCourse: (course: CoursePackage, importedPath?: string | null) => Promise<void>
  loadCourseFromText: (text: string, importedPath?: string | null) => Promise<void>
  restoreLearningRecord: (record: LearningRecord) => Promise<void>
  openSavedRecord: (recordId: string) => Promise<void>
  deleteSavedRecord: (recordId: string) => Promise<void>
  importCoursePackage: () => Promise<void>
  setVideoInput: (value: string) => void
  distillCourseFromVideo: () => Promise<void>
  setCurrentNode: (nodeId: string) => void
  openNodeSession: (nodeId: string, options?: { forceRestart?: boolean }) => Promise<void>
  startQuizForCurrentNode: () => Promise<void>
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
  getCurrentNode: () => FlatCourseNode | null
  getCurrentSession: () => NodeLearningSession | null
  getCurrentNodeMeta: () => ReturnType<typeof buildCurrentNodeMeta>
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

export const useLearningStore = create<LearningStore>((set, get) => ({
  bootState: 'booting',
  runtimeSettings: null,
  distillRequestState: 'idle',
  distillProgressPercent: 0,
  distillStatusMessage: '',
  distillError: null,
  videoInput: '',
  toast: null,

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
  failedNodeIds: [],
  nodeSessions: {},

  hydrateApp: async () => {
    await get().loadRuntimeSettings()
    const library = await get().refreshLibrary()

    if (library.currentRecordId) {
      try {
        const record = await window.desktopAPI.openLearningRecord(library.currentRecordId)
        await get().restoreLearningRecord(record)
      } finally {
        set({ bootState: 'ready' })
      }
      return
    }

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
      failedNodeIds: [],
      nodeSessions: {},
      activeRecordId: null,
      activeRecordCreatedAt: null,
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
    set({
      libraryRecords: payload.records,
      activeRecordId: payload.currentRecordId,
    })
    return payload
  },

  loadCourse: async (course, importedPath = null) => {
    const existingSummary = get().libraryRecords.find((record) => record.packageId === course.package_id)
    let nextState = buildCourseState(course, importedPath, [], [], null)
    let activeRecordId = course.package_id
    let activeRecordCreatedAt: number | null = null

    if (existingSummary) {
      try {
        const existingRecord = await window.desktopAPI.openLearningRecord(existingSummary.id)
        nextState = mergeRecordIntoCourseState(course, importedPath, existingRecord)
        activeRecordId = existingRecord.id
        activeRecordCreatedAt = existingRecord.createdAt
      } catch {
        // fall back to a fresh course state if the stored record is unavailable
      }
    }

    set({
      ...nextState,
      activeRecordId,
      activeRecordCreatedAt,
      distillError: null,
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
    const nextState = buildCourseState(
      parsed,
      record.packagePath ?? record.importedCoursePath ?? null,
      record.completedNodeIds ?? [],
      record.failedNodeIds ?? [],
      record.currentNodeId ?? null,
      record.nodeSessions ?? {},
    )

    set({
      ...nextState,
      activeRecordId: record.id,
      activeRecordCreatedAt: record.createdAt,
      distillError: null,
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

  deleteSavedRecord: async (recordId) => {
    const currentRecordId = get().activeRecordId
    const record = get().libraryRecords.find((item) => item.id === recordId) ?? null
    const payload = await window.desktopAPI.deleteLearningRecord(recordId)
    set({
      libraryRecords: payload.records,
      activeRecordId: payload.currentRecordId,
    })

    if (currentRecordId === recordId) {
      if (payload.currentRecordId) {
        const record = await window.desktopAPI.openLearningRecord(payload.currentRecordId)
        await get().restoreLearningRecord(record)
      } else {
        set({
          courseData: null,
          importedCoursePath: null,
          nodeMap: {},
          rootNodeIds: [],
          orderedNodeIds: [],
          orderedStudyNodeIds: [],
          currentNodeId: null,
          unlockedNodeIds: [],
          completedNodeIds: [],
          failedNodeIds: [],
          nodeSessions: {},
          activeRecordId: null,
          activeRecordCreatedAt: null,
        })
      }
    }
    get().pushToast('学习记录已删除', record ? `《${record.title}》已从本地档案柜移除` : '本地记录已移除', 'success')
  },

  importCoursePackage: async () => {
    const result = await window.desktopAPI.importCoursePackage()
    if (!result) return
    await get().loadCourseFromText(result.text, result.path)
    await get().refreshLibrary()
    try {
      const parsed = JSON.parse(result.text) as CoursePackage
      get().pushToast('课程包已导入', `已载入《${parsed.course.title}》`, 'success')
    } catch {
      get().pushToast('课程包已导入', result.path, 'success')
    }
  },

  setVideoInput: (value) => {
    set({
      videoInput: value,
      distillError: null,
      distillRequestState: 'idle',
      distillProgressPercent: 0,
    })
  },

  distillCourseFromVideo: async () => {
    const videoInput = get().videoInput.trim()
    if (!videoInput) {
      set({
        distillRequestState: 'error',
        distillError: '请先粘贴 B 站视频链接或 BV 号。',
      })
      return
    }

    set({
      distillRequestState: 'loading',
      distillProgressPercent: 3,
      distillStatusMessage: '正在呼叫 AI 蒸馏课程，请稍候…',
      distillError: null,
    })

    const unsubscribe = window.desktopAPI.onDistillProgress((payload) => {
      set({
        distillProgressPercent: Number(payload.percent || 0),
        distillStatusMessage: payload.message || '正在呼叫 AI 蒸馏课程，请稍候…',
      })
    })

    try {
      const result = await Promise.race([
        window.desktopAPI.runDistillation({ video: videoInput }),
        new Promise<never>((_, reject) => {
          globalThis.setTimeout(() => {
            reject(new Error(`蒸馏流程等待超时（>${Math.floor(DISTILL_UI_TIMEOUT_MS / 1000)} 秒）。`))
          }, DISTILL_UI_TIMEOUT_MS)
        }),
      ])
      await get().loadCourseFromText(result.text, result.packagePath)
      await get().refreshLibrary()
      set({
        distillRequestState: 'idle',
        distillProgressPercent: 100,
        distillStatusMessage: '',
        distillError: null,
        videoInput: '',
      })
      get().pushToast('课程提炼完成', `《${result.title}》已注入伴学界面`, 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '课程蒸馏失败'
      set({
        distillRequestState: 'error',
        distillProgressPercent: 0,
        distillStatusMessage: '',
        distillError: message,
      })
      get().pushToast('提炼失败', message, 'error')
    } finally {
      unsubscribe()
    }
  },

  setCurrentNode: (nodeId) => {
    if (!get().isNodeUnlocked(nodeId) || !get().isStudyNode(nodeId)) return
    void get().openNodeSession(nodeId)
  },

  openNodeSession: async (nodeId, options = {}) => {
    const state = get()
    const node = state.nodeMap[nodeId]
    if (!node || !state.courseData || !state.isNodeUnlocked(nodeId) || !state.isStudyNode(nodeId)) return

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
      await get().saveCurrentProgress()
      await get().preloadNextNode(nodeId)
      return
    }

    await state.loadRuntimeSettings()
    const runtimeSettings = get().runtimeSettings
    if (!runtimeSettings) return

    const dependencyTitles = node.dependencies.map((dependencyId) => state.nodeMap[dependencyId]?.title).filter(Boolean) as string[]
    const systemPrompt = buildCoachSystemPrompt(state.courseData, node, 'teaching', dependencyTitles)
    const nextMessages = [makeMessage('system', systemPrompt, nodeId)]

    set((latestState) => ({
      currentNodeId: nodeId,
      nodeSessions: {
        ...latestState.nodeSessions,
        [nodeId]: {
          ...createEmptySession(nodeId),
          messages: nextMessages,
          requestState: 'loading',
          updatedAt: Date.now(),
        },
      },
    }))

    try {
      const turn = await requestCoachTurn({
        config: resolveCoachApiConfig(runtimeSettings),
        courseData: state.courseData,
        currentNode: node,
        dependencyTitles,
        learningStatus: 'teaching',
        messages: nextMessages,
        unlockedNodeIds: get().unlockedNodeIds,
        completedNodeIds: get().completedNodeIds,
      })

      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [nodeId]: {
            ...latestState.nodeSessions[nodeId],
            messages: [...nextMessages, makeMessage('coach', turn.reply, nodeId)],
            learningStatus: turn.learningStatus,
            activeQuestion: turn.learningStatus === 'quizzing' ? turn.reply : null,
            requestState: 'idle',
            error: null,
            hydrated: true,
            preloaded: false,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
      await get().preloadNextNode(nodeId)
    } catch (error) {
      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [nodeId]: {
            ...latestState.nodeSessions[nodeId],
            messages: [
              ...latestState.nodeSessions[nodeId].messages,
              makeMessage('coach', `### 教练暂时失联\n\n${error instanceof Error ? error.message : '教练请求失败'}`, nodeId),
            ],
            requestState: 'error',
            error: error instanceof Error ? error.message : '教练请求失败',
            hydrated: true,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
    }
  },

  startQuizForCurrentNode: async () => {
    await get().loadRuntimeSettings()
    const state = get()
    const node = state.getCurrentNode()
    const session = state.getCurrentSession()
    if (!node || !state.courseData || !state.runtimeSettings || !session) return

    const dependencyTitles = node.dependencies.map((dependencyId) => state.nodeMap[dependencyId]?.title).filter(Boolean) as string[]

    set((latestState) => ({
      nodeSessions: {
        ...latestState.nodeSessions,
        [node.id]: {
          ...latestState.nodeSessions[node.id],
          requestState: 'loading',
          error: null,
          updatedAt: Date.now(),
        },
      },
    }))

    try {
      const turn = await requestCoachTurn({
        config: resolveCoachApiConfig(state.runtimeSettings),
        courseData: state.courseData,
        currentNode: node,
        dependencyTitles,
        learningStatus: 'quizzing',
        messages: session.messages,
        unlockedNodeIds: state.unlockedNodeIds,
        completedNodeIds: state.completedNodeIds,
      })

      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [node.id]: {
            ...latestState.nodeSessions[node.id],
            messages: [...latestState.nodeSessions[node.id].messages, makeMessage('coach', turn.reply, node.id)],
            learningStatus: turn.learningStatus,
            activeQuestion: turn.learningStatus === 'quizzing' ? turn.reply : latestState.nodeSessions[node.id].activeQuestion,
            requestState: 'idle',
            error: null,
            hydrated: true,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
    } catch (error) {
      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [node.id]: {
            ...latestState.nodeSessions[node.id],
            requestState: 'error',
            error: error instanceof Error ? error.message : '教练请求失败',
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
    }
  },

  submitUserAnswer: async (answer) => {
    await get().loadRuntimeSettings()
    const state = get()
    const node = state.getCurrentNode()
    const session = state.getCurrentSession()
    if (!node || !state.courseData || !state.runtimeSettings || !session) return

    const userMessage = makeMessage('user', answer, node.id)
    const dependencyTitles = node.dependencies.map((dependencyId) => state.nodeMap[dependencyId]?.title).filter(Boolean) as string[]
    const pendingMessages = [...session.messages, userMessage]

    set((latestState) => ({
      nodeSessions: {
        ...latestState.nodeSessions,
        [node.id]: {
          ...latestState.nodeSessions[node.id],
          messages: pendingMessages,
          requestState: 'loading',
          error: null,
          lastUserAnswer: answer,
          updatedAt: Date.now(),
        },
      },
    }))

    try {
      const turn = await requestCoachTurn({
        config: resolveCoachApiConfig(state.runtimeSettings),
        courseData: state.courseData,
        currentNode: node,
        dependencyTitles,
        learningStatus: session.learningStatus === 'completed' ? 'quizzing' : session.learningStatus,
        messages: pendingMessages,
        userAnswer: answer,
        unlockedNodeIds: state.unlockedNodeIds,
        completedNodeIds: state.completedNodeIds,
      })

      const alreadyCompleted = state.completedNodeIds.includes(node.id)
      const completedNodeIds = turn.markCurrentNodeCompleted && !alreadyCompleted
        ? [...state.completedNodeIds, node.id]
        : state.completedNodeIds
      const unlockedNodeIds = getUnlockedNodeIds(state.nodeMap, completedNodeIds)

      set((latestState) => ({
        completedNodeIds,
        unlockedNodeIds,
        failedNodeIds:
          turn.markCurrentNodeCompleted
            ? latestState.failedNodeIds.filter((id) => id !== node.id)
            : latestState.failedNodeIds.includes(node.id)
              ? latestState.failedNodeIds
              : [...latestState.failedNodeIds, node.id],
        nodeSessions: {
          ...latestState.nodeSessions,
          [node.id]: {
            ...latestState.nodeSessions[node.id],
            messages: [...pendingMessages, makeMessage('coach', turn.reply, node.id)],
            learningStatus: turn.learningStatus,
            activeQuestion:
              turn.learningStatus === 'quizzing' || turn.learningStatus === 'correcting'
                ? turn.reply
                : latestState.nodeSessions[node.id].activeQuestion,
            requestState: 'idle',
            error: null,
            hydrated: true,
            lastEvaluation: turn.markCurrentNodeCompleted ? 'correct' : 'incorrect',
            updatedAt: Date.now(),
          },
        },
      }))

      await get().saveCurrentProgress()
      await get().preloadNextNode(node.id)
    } catch (error) {
      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [node.id]: {
            ...latestState.nodeSessions[node.id],
            messages: [
              ...latestState.nodeSessions[node.id].messages,
              makeMessage('coach', `### 判题失败\n\n${error instanceof Error ? error.message : '教练请求失败'}`, node.id),
            ],
            requestState: 'error',
            error: error instanceof Error ? error.message : '教练请求失败',
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
    }
  },

  appendCoachMessage: (message) => {
    const nodeId = message.nodeId ?? get().currentNodeId
    if (!nodeId) return
    set((state) => ({
      nodeSessions: {
        ...state.nodeSessions,
        [nodeId]: {
          ...(state.nodeSessions[nodeId] ?? createEmptySession(nodeId)),
          messages: [...(state.nodeSessions[nodeId]?.messages ?? []), message],
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
    if (!currentSession || currentSession.learningStatus !== 'completed') return
    const nextNodeId = getNextNodeId(state.orderedStudyNodeIds, state.nodeMap, state.completedNodeIds)
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
      failedNodeIds: state.failedNodeIds,
      nodeSessions,
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
      get().pushToast('课程已归档', `《${state.courseData.course.title}》已完成并收录到归档区`, 'success')
    }
  },

  preloadNextNode: async (nodeId) => {
    const state = get()
    if (!state.courseData) return
    const nextNodeId = getNextSequentialNodeId(state.orderedStudyNodeIds, nodeId)
    if (!nextNodeId) return

    const nextNode = state.nodeMap[nextNodeId]
    const existingSession = state.nodeSessions[nextNodeId]
    if (!nextNode || !state.isStudyNode(nextNodeId) || existingSession?.hydrated || existingSession?.requestState === 'loading') {
      return
    }

    await state.loadRuntimeSettings()
    const runtimeSettings = get().runtimeSettings
    if (!runtimeSettings) return

    const dependencyTitles = nextNode.dependencies
      .map((dependencyId) => state.nodeMap[dependencyId]?.title)
      .filter(Boolean) as string[]
    const systemPrompt = buildCoachSystemPrompt(state.courseData, nextNode, 'teaching', dependencyTitles)
    const nextMessages = [makeMessage('system', systemPrompt, nextNodeId)]

    set((latestState) => ({
      nodeSessions: {
        ...latestState.nodeSessions,
        [nextNodeId]: {
          ...createEmptySession(nextNodeId),
          messages: nextMessages,
          requestState: 'loading',
          preloaded: true,
          updatedAt: Date.now(),
        },
      },
    }))

    try {
      const turn = await requestCoachTurn({
        config: resolveCoachApiConfig(runtimeSettings),
        courseData: state.courseData,
        currentNode: nextNode,
        dependencyTitles,
        learningStatus: 'teaching',
        messages: nextMessages,
        unlockedNodeIds: state.unlockedNodeIds,
        completedNodeIds: state.completedNodeIds,
      })

      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [nextNodeId]: {
            ...latestState.nodeSessions[nextNodeId],
            messages: [...nextMessages, makeMessage('coach', turn.reply, nextNodeId)],
            learningStatus: turn.learningStatus,
            activeQuestion: turn.learningStatus === 'quizzing' ? turn.reply : null,
            requestState: 'idle',
            error: null,
            hydrated: true,
            preloaded: true,
            updatedAt: Date.now(),
          },
        },
      }))
      await get().saveCurrentProgress()
    } catch {
      set((latestState) => ({
        nodeSessions: {
          ...latestState.nodeSessions,
          [nextNodeId]: {
            ...latestState.nodeSessions[nextNodeId],
            requestState: 'idle',
            error: null,
            hydrated: false,
            preloaded: false,
            updatedAt: Date.now(),
          },
        },
      }))
    }
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
  getCurrentNode: () => {
    const state = get()
    return state.currentNodeId ? state.nodeMap[state.currentNodeId] ?? null : null
  },
  getCurrentSession: () => {
    const state = get()
    return state.currentNodeId ? state.nodeSessions[state.currentNodeId] ?? null : null
  },
  getCurrentNodeMeta: () => {
    const state = get()
    const node = state.getCurrentNode()
    if (!node) {
      return {
        concepts: '- 暂无概念清单',
        checkpoints: '- 暂无检查点',
        mistakes: '- 暂无常见误区',
        dependencies: '无',
      }
    }
    const dependencyTitles = node.dependencies.map((dependencyId) => state.nodeMap[dependencyId]?.title).filter(Boolean) as string[]
    return buildCurrentNodeMeta(node, dependencyTitles)
  },
}))

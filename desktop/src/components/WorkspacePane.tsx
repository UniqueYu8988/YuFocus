import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderOpen,
} from 'lucide-react'
import { CoachPane } from '@/components/CoachPane'
import { WorkflowPane } from '@/components/WorkflowPane'
import { Button } from '@/components/ui/button'
import {
  ArchivePaneContent,
  getMaterialLibraryReadHtmlPath,
  getMaterialLibraryReadPath,
  type ArchiveShelfFilter,
} from '@/components/workspace/ArchivePaneParts'
import {
  KnowledgePaneContent,
  type KnowledgeSourceFilter,
} from '@/components/workspace/KnowledgePaneParts'
import {
  SettingsPaneContent,
} from '@/components/workspace/SettingsPaneParts'
import {
  WorkbenchPaneContent,
} from '@/components/workspace/WorkbenchPaneParts'
import {
  getPageSlice,
  type MaterialInventory,
  type MaterialInventoryRecord,
  type MaterialSourceMode,
  type RuntimeSettingsFallback,
  type WorkbenchQueueItem,
} from '@/components/workspace/WorkbenchShared'
import {
  WorkspaceDialogs,
  type MarkdownDocumentKind,
} from '@/components/workspace/WorkspaceDialogs'
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell'
import {
  FOLLOW_SOURCE_WINDOW_SIZE,
  MIMO_TEXT_MODELS,
  MIMO_TTS_PRESET_VOICES,
  SOURCE_VIDEO_WINDOW_SIZE,
  WORKBENCH_LIST_PAGE_SIZE,
  buildArchiveFilters,
  buildArchiveStats,
  buildInitialDraft,
  buildRecordSearchText,
  buildWorkbenchSourceItems,
  canOpenMaterialBrief,
  createWorkbenchQueueItem,
  filterArchiveMaterialRecords,
  filterFollowSources,
  filterKnowledgeMaterialRecords,
  flattenBilibiliSourceVideos,
  formatCompactNumber,
  formatRelativeTime,
  getDurationBarPercent,
  getArchiveMaterialRecords,
  getMaterialSourceKey,
  getNotebookLmImportPath,
  getNotebookLmPathTitle,
  getQueueSourceKey,
  getWorkbenchSourceMeta,
  getWorkbenchSourceStatus,
  getWorkbenchSourceTitle,
  isRejectedModelDocument,
  notifyMaterialPackagesChanged,
  normalizeWorkbenchSourceKey,
  stripKnowledgeBriefMetadata,
} from '@/components/workspace/WorkspacePaneUtils'
import { buildLearningNotesStudyPackage } from '@/lib/learningNotesStudyPackage'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useLearningStore } from '@/store'
import archiveCurrentRecordIcon from '@/assets/archive-current-record.svg'
import archiveOtherRecordsIcon from '@/assets/archive-other-records.svg'
import settingsBilibiliIcon from '@/assets/settings-bilibili.svg'
import settingsObsidianIcon from '@/assets/settings-obsidian.svg'
import settingsTranscriptionIcon from '@/assets/settings-transcription.svg'
import settingsTtsIcon from '@/assets/settings-tts.svg'
import videoIcon from '@/assets/video-icon.svg'

export type WorkspaceView = 'learn' | 'workbench' | 'knowledge' | 'archive' | 'workflow' | 'settings'

type WorkspacePaneProps = {
  view: WorkspaceView
  runtimeSettings: RuntimeSettingsFallback
  onRuntimeSettingsSaved: (next: Awaited<ReturnType<typeof window.desktopAPI.loadSettings>>) => void
  showLearningHome: boolean
  onRequestLearn: () => void
  onRequestWorkbench: () => void
  onRequestArchive: () => void
  windowFocused: boolean
}

type LibrarySortMode = 'recent' | 'progress' | 'title'
type BilibiliFollowSources = Awaited<ReturnType<typeof window.desktopAPI.listBilibiliFollowSources>>
type BilibiliSourceVideos = Awaited<ReturnType<typeof window.desktopAPI.listBilibiliSourceVideos>>
type PinnedBilibiliSource = Awaited<ReturnType<typeof window.desktopAPI.loadPinnedBilibiliSources>>[number]
type KnowledgeInventory = Awaited<ReturnType<typeof window.desktopAPI.listKnowledgeLibrary>>

export function WorkspacePane({
  view,
  runtimeSettings,
  onRuntimeSettingsSaved,
  showLearningHome,
  onRequestLearn,
  onRequestWorkbench,
  onRequestArchive,
  windowFocused,
}: WorkspacePaneProps) {
  const [settingsDraft, setSettingsDraft] = useState(() => buildInitialDraft(runtimeSettings))
  const [settingsError, setSettingsError] = useState('')
  const [ttsPreviewVoice, setTtsPreviewVoice] = useState<string | null>(null)
  const ttsTestAudioRef = useRef<HTMLAudioElement | null>(null)
  const settingsSaveTimerRef = useRef<number | null>(null)
  const settingsLastSavedJsonRef = useRef('')
  const workbenchQueueLoadedRef = useRef(false)
  const workbenchQueueRemoteUpdateRef = useRef(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySortMode, setLibrarySortMode] = useState<LibrarySortMode>('recent')
  const [archiveShelfFilter, setArchiveShelfFilter] = useState<ArchiveShelfFilter>('all')
  const [libraryStructureRefreshing, setLibraryStructureRefreshing] = useState(false)
  const [materialSourceMode, setMaterialSourceMode] = useState<MaterialSourceMode>('bilibili')
  const [materialInventory, setMaterialInventory] = useState<MaterialInventory | null>(null)
  const [bilibiliFollowSources, setBilibiliFollowSources] = useState<BilibiliFollowSources | null>(null)
  const [bilibiliFollowSourcesLoading, setBilibiliFollowSourcesLoading] = useState(false)
  const [bilibiliFollowSourcesError, setBilibiliFollowSourcesError] = useState('')
  const [followSourceQuery, setFollowSourceQuery] = useState('')
  const [followSourcePinnedOnly, setFollowSourcePinnedOnly] = useState(false)
  const [activeFollowSourceId, setActiveFollowSourceId] = useState<string | null>(null)
  const [pinnedBilibiliSources, setPinnedBilibiliSources] = useState<PinnedBilibiliSource[]>([])
  const [selectedFollowSourceIds, setSelectedFollowSourceIds] = useState<string[]>([])
  const [bilibiliSourceVideos, setBilibiliSourceVideos] = useState<BilibiliSourceVideos | null>(null)
  const [bilibiliSourceVideosLoading, setBilibiliSourceVideosLoading] = useState(false)
  const [bilibiliSourceVideosError, setBilibiliSourceVideosError] = useState('')
  const [selectedSourceVideoIds, setSelectedSourceVideoIds] = useState<string[]>([])
  const [workbenchQueue, setWorkbenchQueue] = useState<WorkbenchQueueItem[]>([])
  const [manualSourceLoading, setManualSourceLoading] = useState(false)
  const [editorialSummaryBuildingPath, setEditorialSummaryBuildingPath] = useState<string | null>(null)
  const [followSourcePage, setFollowSourcePage] = useState(1)
  const [sourceVideoPage, setSourceVideoPage] = useState(1)
  const [workbenchListPage, setWorkbenchListPage] = useState(1)
  const [knowledgeInventory, setKnowledgeInventory] = useState<KnowledgeInventory | null>(null)
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [knowledgeSourceFilter, setKnowledgeSourceFilter] = useState<KnowledgeSourceFilter>({ kind: 'all', title: '全部资料' })
  const [knowledgeLoading, setKnowledgeLoading] = useState(false)
  const [knowledgeError, setKnowledgeError] = useState('')
  const [knowledgeBriefOpen, setKnowledgeBriefOpen] = useState(false)
  const [knowledgeBriefTitle, setKnowledgeBriefTitle] = useState('')
  const [knowledgeBriefPath, setKnowledgeBriefPath] = useState('')
  const [knowledgeBriefContent, setKnowledgeBriefContent] = useState('')
  const [knowledgeBriefLoading, setKnowledgeBriefLoading] = useState(false)
  const [knowledgeBriefError, setKnowledgeBriefError] = useState('')
  const [knowledgeBriefKind, setKnowledgeBriefKind] = useState<MarkdownDocumentKind>('brief')
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus | null>(null)
  const [settingsStatusLoading, setSettingsStatusLoading] = useState(false)
  const [settingsStatusError, setSettingsStatusError] = useState('')
  const [automationStatus, setAutomationStatus] = useState<BackgroundAutomationStatus | null>(null)
  const [automationBusy, setAutomationBusy] = useState(false)
  const [emailTestBusy, setEmailTestBusy] = useState(false)

  const courseData = useLearningStore((state) => state.courseData)
  const videoInput = useLearningStore((state) => state.videoInput)
  const setVideoInput = useLearningStore((state) => state.setVideoInput)
  const distillCourseFromVideo = useLearningStore((state) => state.distillCourseFromVideo)
  const distillRequestState = useLearningStore((state) => state.distillRequestState)
  const distillProgressPercent = useLearningStore((state) => state.distillProgressPercent)
  const distillError = useLearningStore((state) => state.distillError)
  const lastMaterialResult = useLearningStore((state) => state.lastMaterialResult)
  const loadCourseFromText = useLearningStore((state) => state.loadCourseFromText)
  const libraryRecords = useLearningStore((state) => state.libraryRecords)
  const activeRecordId = useLearningStore((state) => state.activeRecordId)
  const openSavedRecord = useLearningStore((state) => state.openSavedRecord)
  const deleteSavedRecord = useLearningStore((state) => state.deleteSavedRecord)
  const clearActiveCourse = useLearningStore((state) => state.clearActiveCourse)
  const refreshLibrary = useLearningStore((state) => state.refreshLibrary)
  const restoreLearningRecord = useLearningStore((state) => state.restoreLearningRecord)
  const setRuntimeSettings = useLearningStore((state) => state.setRuntimeSettings)
  const pushToast = useLearningStore((state) => state.pushToast)

  const refreshSettingsStatus = useCallback(async () => {
    setSettingsStatusLoading(true)
    setSettingsStatusError('')
    try {
      const result = await window.desktopAPI.loadSettingsStatus()
      setSettingsStatus(result)
    } catch (error) {
      setSettingsStatusError(error instanceof Error ? error.message : '无法读取账号状态。')
      setSettingsStatus(null)
    } finally {
      setSettingsStatusLoading(false)
    }
  }, [])

  const refreshBilibiliFollowSources = useCallback(async () => {
    setBilibiliFollowSourcesLoading(true)
    setBilibiliFollowSourcesError('')
    try {
      const result = await window.desktopAPI.listBilibiliFollowSources()
      setBilibiliFollowSources(result)
      if (!result.authenticated && result.configured) {
        setBilibiliFollowSourcesError(result.message)
      }
    } catch (error) {
      setBilibiliFollowSources(null)
      setBilibiliFollowSourcesError(error instanceof Error ? error.message : '无法读取视频来源。')
    } finally {
      setBilibiliFollowSourcesLoading(false)
    }
  }, [])

  const refreshBilibiliSourceVideos = useCallback(async (sourceIds = selectedFollowSourceIds) => {
    const selectedSources = (bilibiliFollowSources?.items ?? [])
      .filter((source) => sourceIds.includes(source.mid))
      .map((source) => ({ mid: source.mid, name: source.name }))
    if (!selectedSources.length) {
      setBilibiliSourceVideosError('请先选择视频来源。')
      return
    }

    setBilibiliSourceVideosLoading(true)
    setBilibiliSourceVideosError('')
    try {
      const result = await window.desktopAPI.listBilibiliSourceVideos({
        sources: selectedSources,
        pageSize: 48,
      })
      setBilibiliSourceVideos(result)
      setSelectedSourceVideoIds([])
      const failed = result.sources.filter((source) => source.error)
      if (failed.length > 0 && result.totalVideos === 0) {
        setBilibiliSourceVideosError(failed[0]?.error || '没有读取到最近视频。')
      }
    } catch (error) {
      setBilibiliSourceVideos(null)
      setBilibiliSourceVideosError(error instanceof Error ? error.message : '无法读取最近视频。')
    } finally {
      setBilibiliSourceVideosLoading(false)
    }
  }, [bilibiliFollowSources?.items, selectedFollowSourceIds])

  useEffect(() => {
    const nextDraft = buildInitialDraft(runtimeSettings)
    if (view === 'settings') {
      const currentDraft = JSON.stringify(settingsDraft)
      if (currentDraft !== settingsLastSavedJsonRef.current && currentDraft !== JSON.stringify(nextDraft)) {
        return
      }
    }
    setSettingsDraft(nextDraft)
    settingsLastSavedJsonRef.current = JSON.stringify(nextDraft)
    setSettingsError('')
  }, [runtimeSettings, view])

  useEffect(() => {
    let active = true
    void window.desktopAPI.getAutomationStatus()
      .then((status) => {
        if (active) setAutomationStatus(status)
      })
      .catch(() => {
        if (active) setAutomationStatus(null)
      })
    const unsubscribe = window.desktopAPI.onAutomationStatus((status) => {
      setAutomationStatus(status)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (view !== 'settings') return
    const serializedDraft = JSON.stringify(settingsDraft)
    if (serializedDraft === settingsLastSavedJsonRef.current) return

    if (settingsSaveTimerRef.current) {
      window.clearTimeout(settingsSaveTimerRef.current)
    }

    settingsSaveTimerRef.current = window.setTimeout(() => {
      void window.desktopAPI.saveSettings(settingsDraft)
        .then((next) => {
          const normalizedDraft = buildInitialDraft(next)
          settingsLastSavedJsonRef.current = JSON.stringify(normalizedDraft)
          setSettingsDraft(normalizedDraft)
          setRuntimeSettings(next)
          onRuntimeSettingsSaved(next)
          setSettingsError('')
          void refreshSettingsStatus()
        })
        .catch((error) => {
          setSettingsError(error instanceof Error ? error.message : '自动保存设置失败')
        })
    }, 650)

    return () => {
      if (settingsSaveTimerRef.current) {
        window.clearTimeout(settingsSaveTimerRef.current)
        settingsSaveTimerRef.current = null
      }
    }
  }, [onRuntimeSettingsSaved, refreshSettingsStatus, setRuntimeSettings, settingsDraft, view])

  useEffect(() => {
    return () => {
      ttsTestAudioRef.current?.pause()
      ttsTestAudioRef.current?.removeAttribute('src')
      ttsTestAudioRef.current?.load()
      ttsTestAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    if (view !== 'workbench' && view !== 'settings' && view !== 'knowledge') return
    let alive = true
    window.desktopAPI.listMaterialPackages()
      .then((result) => {
        if (alive) setMaterialInventory(result)
      })
      .catch(() => {
        if (alive) setMaterialInventory(null)
      })
    return () => {
      alive = false
    }
  }, [runtimeSettings?.output_dir, view, lastMaterialResult?.materialPath])

  useEffect(() => {
    const handleKnowledgeSourceFilter = (event: Event) => {
      const detail = (event as CustomEvent<Partial<KnowledgeSourceFilter>>).detail
      if (!detail || typeof detail !== 'object') return
      if (detail.kind === 'creator' && typeof detail.creator === 'string') {
        setKnowledgeSourceFilter({
          kind: 'creator',
          title: typeof detail.title === 'string' && detail.title.trim() ? detail.title : detail.creator,
          creator: detail.creator,
        })
        setKnowledgeQuery('')
        return
      }
      if (detail.kind === 'misc') {
        setKnowledgeSourceFilter({
          kind: 'misc',
          title: typeof detail.title === 'string' && detail.title.trim() ? detail.title : '拾遗',
          pinnedCreatorNames: Array.isArray(detail.pinnedCreatorNames) ? detail.pinnedCreatorNames.filter((name): name is string => typeof name === 'string') : [],
        })
        setKnowledgeQuery('')
      }
    }

    window.addEventListener('shijie:knowledge-source-filter', handleKnowledgeSourceFilter)
    return () => window.removeEventListener('shijie:knowledge-source-filter', handleKnowledgeSourceFilter)
  }, [])

  useEffect(() => {
    if (view !== 'workbench') return
    void refreshBilibiliFollowSources()
  }, [refreshBilibiliFollowSources, runtimeSettings?.sessdata, view])

  useEffect(() => {
    if (view !== 'workbench') return
    let alive = true
    window.desktopAPI.loadPinnedBilibiliSources()
      .then((items) => {
        if (alive) setPinnedBilibiliSources(items)
      })
      .catch(() => {
        if (alive) setPinnedBilibiliSources([])
      })
    return () => {
      alive = false
    }
  }, [view])

  useEffect(() => {
    if (workbenchQueueLoadedRef.current) return
    let alive = true
    window.desktopAPI.loadWorkbenchQueue()
      .then((items) => {
        if (!alive) return
        setWorkbenchQueue(items)
        workbenchQueueLoadedRef.current = true
      })
      .catch(() => {
        if (!alive) return
        workbenchQueueLoadedRef.current = true
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.desktopAPI.onWorkbenchQueueChanged((items) => {
      workbenchQueueRemoteUpdateRef.current = true
      workbenchQueueLoadedRef.current = true
      setWorkbenchQueue(items)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!workbenchQueueLoadedRef.current) return
    if (workbenchQueueRemoteUpdateRef.current) {
      workbenchQueueRemoteUpdateRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      void window.desktopAPI.saveWorkbenchQueue(workbenchQueue)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [workbenchQueue])

  useEffect(() => {
    if (!bilibiliFollowSources?.items.length) {
      setSelectedFollowSourceIds([])
      setActiveFollowSourceId(null)
      return
    }
    const validIds = new Set(bilibiliFollowSources.items.map((item) => item.mid))
    setSelectedFollowSourceIds((current) => current.filter((id) => validIds.has(id)))
    setActiveFollowSourceId((current) => current && validIds.has(current) ? current : null)
  }, [bilibiliFollowSources?.items])

  useEffect(() => {
    setBilibiliSourceVideos(null)
    setSelectedSourceVideoIds([])
    setBilibiliSourceVideosError('')
    setSourceVideoPage(1)
  }, [selectedFollowSourceIds])

  useEffect(() => {
    setFollowSourcePage(1)
  }, [followSourcePinnedOnly, followSourceQuery])

  useEffect(() => {
    setSourceVideoPage(1)
  }, [bilibiliSourceVideos?.fetchedAt])

  useEffect(() => {
    setWorkbenchListPage(1)
  }, [materialInventory?.records.length, workbenchQueue.length])

  useEffect(() => {
    if (view !== 'settings') return
    void refreshSettingsStatus()
  }, [refreshSettingsStatus, view])

  useEffect(() => {
    if (view !== 'knowledge') return
    let alive = true
    setKnowledgeLoading(true)
    setKnowledgeError('')
    window.desktopAPI.listKnowledgeLibrary()
      .then((result) => {
        if (!alive) return
        setKnowledgeInventory(result)
      })
      .catch((error) => {
        if (!alive) return
        setKnowledgeInventory(null)
        setKnowledgeError(error instanceof Error ? error.message : '无法读取灵犀。')
      })
      .finally(() => {
        if (alive) setKnowledgeLoading(false)
      })
    return () => {
      alive = false
    }
  }, [runtimeSettings?.output_dir, view])

  const filteredKnowledgeRecords = useMemo(() => {
    const normalizedQuery = knowledgeQuery.trim().toLowerCase()
    const records = knowledgeInventory?.records ?? []
    const filtered = normalizedQuery
      ? records.filter((record) => record.searchText.includes(normalizedQuery))
      : records

    return [...filtered].sort((left, right) => right.updatedAt - left.updatedAt)
  }, [knowledgeInventory?.records, knowledgeQuery])
  const knowledgeTotalTextLength = useMemo(
    () => (knowledgeInventory?.records ?? []).reduce((sum, record) => sum + record.textLength, 0),
    [knowledgeInventory?.records],
  )
  const knowledgeRootDir = useMemo(
    () => knowledgeInventory?.rootDir || (runtimeSettings?.output_dir ? `${runtimeSettings.output_dir}\\knowledge` : '请先在设置中配置输出目录'),
    [knowledgeInventory?.rootDir, runtimeSettings?.output_dir],
  )
  const materialRootDir = useMemo(
    () => materialInventory?.rootDir || (runtimeSettings?.output_dir ? `${runtimeSettings.output_dir}\\materials` : '请先在设置中配置输出目录'),
    [materialInventory?.rootDir, runtimeSettings?.output_dir],
  )
  const sortedMaterialRecords = useMemo<MaterialInventoryRecord[]>(() => {
    return [...(materialInventory?.records ?? [])].sort((left, right) => right.updatedAt - left.updatedAt)
  }, [materialInventory?.records])
  const archiveMaterialRecords = useMemo(
    () => getArchiveMaterialRecords(sortedMaterialRecords),
    [sortedMaterialRecords],
  )
  const archiveFilteredRecords = useMemo(
    () => filterArchiveMaterialRecords({
      records: archiveMaterialRecords,
      shelfFilter: archiveShelfFilter,
      query: libraryQuery,
      pinnedSources: pinnedBilibiliSources,
    }),
    [archiveMaterialRecords, archiveShelfFilter, libraryQuery, pinnedBilibiliSources],
  )
  const archiveStats = useMemo(
    () => buildArchiveStats(archiveMaterialRecords),
    [archiveMaterialRecords],
  )
  const archiveFilters = useMemo(
    () => buildArchiveFilters(archiveMaterialRecords, pinnedBilibiliSources),
    [archiveMaterialRecords, pinnedBilibiliSources],
  )
  const filteredKnowledgeMaterialRecords = useMemo(
    () => filterKnowledgeMaterialRecords({
      records: sortedMaterialRecords,
      query: knowledgeQuery,
      sourceFilter: knowledgeSourceFilter,
    }),
    [knowledgeQuery, knowledgeSourceFilter, sortedMaterialRecords],
  )
  const filteredFollowSources = useMemo(
    () => filterFollowSources({
      items: bilibiliFollowSources?.items ?? [],
      pinnedOnly: followSourcePinnedOnly,
      pinnedSources: pinnedBilibiliSources,
      query: followSourceQuery,
    }),
    [bilibiliFollowSources?.items, followSourcePinnedOnly, followSourceQuery, pinnedBilibiliSources],
  )
  const pinnedBilibiliSourceIds = useMemo(
    () => new Set(pinnedBilibiliSources.map((source) => source.mid)),
    [pinnedBilibiliSources],
  )
  const activeFollowSource = useMemo(
    () => (bilibiliFollowSources?.items ?? []).find((source) => source.mid === activeFollowSourceId) ?? null,
    [activeFollowSourceId, bilibiliFollowSources?.items],
  )
  const flatSourceVideos = useMemo(
    () => flattenBilibiliSourceVideos(bilibiliSourceVideos),
    [bilibiliSourceVideos],
  )
  const pagedFollowSources = useMemo(
    () => getPageSlice(filteredFollowSources, followSourcePage, FOLLOW_SOURCE_WINDOW_SIZE),
    [filteredFollowSources, followSourcePage],
  )
  const pagedSourceVideos = useMemo(
    () => getPageSlice(flatSourceVideos, sourceVideoPage, SOURCE_VIDEO_WINDOW_SIZE),
    [flatSourceVideos, sourceVideoPage],
  )
  const sourceVideoMaxDurationSeconds = useMemo(
    () => Math.max(1, ...flatSourceVideos.map((video) => Number(video.durationSeconds) || 0)),
    [flatSourceVideos],
  )
  const workbenchSourceItems = useMemo(
    () => buildWorkbenchSourceItems(sortedMaterialRecords, workbenchQueue),
    [sortedMaterialRecords, workbenchQueue],
  )
  const pagedWorkbenchItems = useMemo(
    () => getPageSlice(workbenchSourceItems, workbenchListPage, WORKBENCH_LIST_PAGE_SIZE),
    [workbenchListPage, workbenchSourceItems],
  )
  const canClearWorkbenchQueue = workbenchSourceItems.length > 0 || workbenchQueue.length > 0
  const runtimeModeLabel = window.desktopAPI.isElectron ? '原生桌面端' : '浏览器预览'
  const automationStatusLabel = automationStatus?.running
    ? '后台检查中'
    : automationStatus?.paused
      ? '后台已暂停'
      : automationStatus?.enabled
        ? '后台运行'
        : '后台关闭'
  const automationLastCheckLabel = automationStatus?.lastCheckAt ? formatRelativeTime(automationStatus.lastCheckAt) : '尚未检查'

  const handleDeleteRecord = async (recordId: string, title: string) => {
    const shouldDelete = globalThis.confirm(`确定从档案删除《${title}》吗？这会移除本地进度、对话缓存和关联导入包。`)
    if (!shouldDelete) return
    await deleteSavedRecord(recordId)
    try {
      setMaterialInventory(await window.desktopAPI.listMaterialPackages())
      notifyMaterialPackagesChanged()
    } catch {
      // The archive deletion itself has already completed.
    }
  }

  const handleOpenRecord = async (recordId: string) => {
    await openSavedRecord(recordId)
    onRequestLearn()
  }

  const handleRefreshLibraryStructure = async () => {
    try {
      setLibraryStructureRefreshing(true)
      const result = await window.desktopAPI.refreshLearningLibraryStructure()
      await refreshLibrary()

      if (activeRecordId) {
        try {
          const refreshedRecord = await window.desktopAPI.openLearningRecord(activeRecordId)
          await restoreLearningRecord(refreshedRecord)
        } catch {
          // ignore active record refresh failures and still surface library refresh result
        }
      }

      if (result.recordUpdates || result.packageUpdates) {
        pushToast(
          '档案结构已刷新',
          `已更新 ${result.recordUpdates} 份档案，触达 ${result.packageUpdates} 个导入包文件。`,
          'success',
        )
      } else {
        pushToast(
          '结构已是最新',
          result.scannedPackages > 0 ? `已检查 ${result.scannedPackages} 个现成导入包，没有发现需要升级的旧结构。` : '当前档案和导入包已经是新的结构。',
          'info',
        )
      }
    } catch (error) {
      pushToast('刷新失败', error instanceof Error ? error.message : '批量刷新档案结构失败。', 'error')
    } finally {
      setLibraryStructureRefreshing(false)
    }
  }

  const handleQueueManualBilibiliVideo = async () => {
    const input = videoInput.trim()
    if (!input) {
      pushToast('还没有视频来源', '请输入 BV 号或 B 站链接。', 'info')
      return
    }

    setManualSourceLoading(true)
    try {
      const video = await window.desktopAPI.getBilibiliVideoMetadata({ video: input })
      const sourceKey = normalizeWorkbenchSourceKey(video.bvid)
      const alreadyQueued = workbenchQueue.some((item) => getQueueSourceKey(item) === sourceKey)
      const alreadyBuilt = sortedMaterialRecords.some((record) => getMaterialSourceKey(record) === sourceKey)

      setMaterialSourceMode('bilibili')
      setVideoInput(video.bvid)

      if (alreadyQueued || alreadyBuilt) {
        pushToast(alreadyBuilt ? '资料已存在' : '已在任务队列', video.title, 'info')
        return
      }

      setWorkbenchQueue((current) => {
        if (current.some((item) => getQueueSourceKey(item) === sourceKey)) return current
        return [...current, createWorkbenchQueueItem(video)]
      })
      pushToast('已加入任务队列', video.title, 'success')
    } catch (error) {
      pushToast('读取视频信息失败', error instanceof Error ? error.message : '无法读取这条 B 站视频。', 'error')
    } finally {
      setManualSourceLoading(false)
    }
  }

  const handleDistillCourse = async () => {
    if (materialSourceMode === 'bilibili') {
      await handleQueueManualBilibiliVideo()
      return
    }

    await distillCourseFromVideo({
      sourceKind: materialSourceMode,
      mediaPath: videoInput,
    })
    try {
      setMaterialInventory(await window.desktopAPI.listMaterialPackages())
      notifyMaterialPackagesChanged()
    } catch {
      // The main task already reports failures through the progress state.
    }
  }

  const handleDeleteMaterialPackage = async (record: MaterialInventory['records'][number]) => {
    const shouldDelete = globalThis.confirm(
      `确定删除《${record.title}》的资料包吗？这会移除字幕、转写、清洗稿、索引和精读稿。`,
    )
    if (!shouldDelete) return
    try {
      await window.desktopAPI.deleteMaterialPackage(record.path)
      const activeSourceId = courseData?.source.source_id ?? ''
      if (activeSourceId && record.sourceId && activeSourceId === record.sourceId) {
        clearActiveCourse()
      }
      await refreshLibrary()
      setMaterialInventory(await window.desktopAPI.listMaterialPackages())
      notifyMaterialPackagesChanged()
      pushToast('资料包已删除', record.title, 'success')
    } catch (error) {
      pushToast('删除失败', error instanceof Error ? error.message : '无法删除这条资料记录。', 'error')
    }
  }

  const handlePickLocalMedia = async () => {
    const result = await window.desktopAPI.pickMediaFile()
    if (!result) return
    setMaterialSourceMode('local_media')
    setVideoInput(result.path)
    pushToast('已选择本地文件', result.name, 'success')
  }

  const handleOpenFollowSource = (source: BilibiliFollowSources['items'][number]) => {
    setActiveFollowSourceId(source.mid)
    setSelectedFollowSourceIds([source.mid])
    setSelectedSourceVideoIds([])
    setBilibiliSourceVideos(null)
    setBilibiliSourceVideosError('')
    setSourceVideoPage(1)
    void refreshBilibiliSourceVideos([source.mid])
  }

  const handleTogglePinnedFollowSource = async (source: BilibiliFollowSources['items'][number]) => {
    const nextPinned = pinnedBilibiliSourceIds.has(source.mid)
      ? pinnedBilibiliSources.filter((item) => item.mid !== source.mid)
      : [
          {
            mid: source.mid,
            name: source.name,
            face: source.face,
            sign: source.sign,
            officialTitle: source.officialTitle,
            pinnedAt: Date.now(),
          },
          ...pinnedBilibiliSources.filter((item) => item.mid !== source.mid),
        ].slice(0, 24)

    try {
      const saved = await window.desktopAPI.savePinnedBilibiliSources(nextPinned)
      setPinnedBilibiliSources(saved)
      window.dispatchEvent(new CustomEvent('shijie:pinned-bilibili-sources-changed', { detail: saved }))
      pushToast(pinnedBilibiliSourceIds.has(source.mid) ? '已取消固定' : '已固定信息源', source.name, 'success')
    } catch (error) {
      pushToast('固定失败', error instanceof Error ? error.message : '无法保存固定信息源。', 'error')
    }
  }

  const handleToggleSourceVideo = (bvid: string) => {
    setSelectedSourceVideoIds((current) =>
      current.includes(bvid) ? current.filter((id) => id !== bvid) : [...current, bvid],
    )
  }

  const handleAddSelectedVideosToQueue = () => {
    const selectedVideos = flatSourceVideos.filter((video) => selectedSourceVideoIds.includes(video.bvid))
    if (!selectedVideos.length) {
      pushToast('还没有选择视频', '请先从最近视频里勾选要处理的条目。', 'info')
      return
    }
    const existingBvids = new Set(workbenchQueue.map((item) => item.bvid))
    const nextItems = selectedVideos
      .filter((video) => !existingBvids.has(video.bvid))
      .map((video) => createWorkbenchQueueItem(video, 'queued', { queueSource: 'follow_source', editorialMode: 'force' }))
    if (!nextItems.length) {
      pushToast('队列已包含这些视频', '可以直接从处理队列逐条开始。', 'info')
      return
    }
    setWorkbenchQueue((current) => [...current, ...nextItems])
    setSelectedSourceVideoIds([])
    pushToast('已加入处理队列', `${nextItems.length} 条视频等待处理。`, 'success')
  }

  const handleRemoveQueuedVideo = (queueId: string) => {
    setWorkbenchQueue((current) => current.filter((item) => item.queueId !== queueId))
  }

  const handleStartQueuedVideo = async (queueId: string) => {
    const target = workbenchQueue.find((item) => item.queueId === queueId)
    if (!target || target.status === 'processing') return
    setWorkbenchQueue((current) =>
      current.map((item) => item.queueId === queueId ? { ...item, status: 'queued', lastError: '', updatedAt: Date.now() } : item),
    )
    pushToast(target.status === 'failed' ? '已重新加入队列' : '已加入队列', target.title, 'success')
  }

  const handleClearWorkbenchQueue = async () => {
    const shouldClear = globalThis.confirm('确定清空任务队列吗？绿灯会收进档案，黄灯和待处理资料会删除源文件；正在处理的任务会等本轮结束。')
    if (!shouldClear) return
    try {
      const result = await window.desktopAPI.clearWorkbenchQueue()
      const [queue, materials] = await Promise.all([
        window.desktopAPI.loadWorkbenchQueue(),
        window.desktopAPI.listMaterialPackages(),
      ])
      setWorkbenchQueue(queue)
      setMaterialInventory(materials)
      await refreshLibrary()
      notifyMaterialPackagesChanged()
      const summary = [
        result.archivedCount ? `归档 ${result.archivedCount} 条` : '',
        result.deletedMaterialCount ? `删除 ${result.deletedMaterialCount} 个资料包` : '',
        result.skippedPaths.length ? `跳过 ${result.skippedPaths.length} 项` : '',
      ].filter(Boolean).join('，') || '队列已清理'
      pushToast('队列已清空', summary, result.skippedPaths.length ? 'info' : 'success')
    } catch (error) {
      pushToast('清空失败', error instanceof Error ? error.message : '无法清空任务队列。', 'error')
    }
  }

  const handleOpenMarkdownDocument = async (title: string, targetPath: string, kind: MarkdownDocumentKind = 'brief') => {
    if (!targetPath) return
    setKnowledgeBriefOpen(true)
    setKnowledgeBriefTitle(title)
    setKnowledgeBriefPath(targetPath)
    setKnowledgeBriefKind(kind)
    setKnowledgeBriefContent('')
    setKnowledgeBriefError('')
    setKnowledgeBriefLoading(true)
    try {
      const content = await window.desktopAPI.readTextFile(targetPath)
      setKnowledgeBriefContent(kind === 'brief' ? stripKnowledgeBriefMetadata(content) : content)
    } catch (error) {
      setKnowledgeBriefError(error instanceof Error ? error.message : '无法读取 Markdown 文档。')
    } finally {
      setKnowledgeBriefLoading(false)
    }
  }

  const handleOpenMarkdownAsStudyPackage = async ({
    title,
    targetPath,
    htmlPath,
    materialPath,
    sourceId,
    sourceUrl,
  }: {
    title: string
    targetPath: string
    htmlPath?: string
    materialPath?: string
    sourceId?: string
    sourceUrl?: string
  }) => {
    if (!targetPath) return
    try {
      const normalizedTargetPath = targetPath.replace(/\\/g, '/')
      const presentationMode = normalizedTargetPath.endsWith('/summary/article.md') ? 'article' : 'sections'
      const inferredHtmlPath =
        presentationMode === 'article'
          ? htmlPath || targetPath.replace(/\.md$/iu, '.html')
          : ''
      const content = await window.desktopAPI.readTextFile(targetPath)
      const articleHtmlContent = inferredHtmlPath
        ? await window.desktopAPI.readTextFile(inferredHtmlPath).catch(() => '')
        : ''
      const readableContent = stripKnowledgeBriefMetadata(content)
      if (!readableContent || isRejectedModelDocument(readableContent)) {
        throw new Error('这份正文不是可读资料，可能是模型拒绝文本或空文件。请回到制作页重新制作文稿。')
      }
      const course = buildLearningNotesStudyPackage({
        title,
        sourceId,
        sourceUrl,
        materialPath: materialPath || targetPath,
        sourcePath: targetPath,
        briefContent: readableContent,
        articleHtmlContent,
        presentationMode,
      })

      await loadCourseFromText(JSON.stringify(course, null, 2), null)
      await refreshLibrary()
      setMaterialInventory(await window.desktopAPI.listMaterialPackages())
      notifyMaterialPackagesChanged()
      pushToast('资料已打开', title, 'success')
      onRequestLearn()
    } catch (error) {
      pushToast('打开失败', error instanceof Error ? error.message : '无法把资料载入专注页。', 'error')
    }
  }

  useEffect(() => {
    const handleOpenMaterialDocument = (event: Event) => {
      const detail = (event as CustomEvent<{
        title?: unknown
        path?: unknown
        htmlPath?: unknown
        materialPath?: unknown
        sourceId?: unknown
        sourceUrl?: unknown
        kind?: unknown
      }>).detail
      const targetPath = typeof detail?.path === 'string' ? detail.path : ''
      if (!targetPath) return
      const title = typeof detail?.title === 'string' && detail.title.trim() ? detail.title : '未命名资料'
      const kind: MarkdownDocumentKind = detail?.kind === 'chapter_map' ? 'chapter_map' : 'brief'
      if (kind === 'chapter_map') {
        void handleOpenMarkdownDocument(title, targetPath, kind)
        return
      }
      void handleOpenMarkdownAsStudyPackage({
        title,
        targetPath,
        htmlPath: typeof detail?.htmlPath === 'string' ? detail.htmlPath : undefined,
        materialPath: typeof detail?.materialPath === 'string' ? detail.materialPath : undefined,
        sourceId: typeof detail?.sourceId === 'string' ? detail.sourceId : undefined,
        sourceUrl: typeof detail?.sourceUrl === 'string' ? detail.sourceUrl : undefined,
      })
    }

    window.addEventListener('shijie:open-material-document', handleOpenMaterialDocument)
    return () => window.removeEventListener('shijie:open-material-document', handleOpenMaterialDocument)
  }, [handleOpenMarkdownAsStudyPackage, handleOpenMarkdownDocument])

  const handleCopyMarkdownDocument = async () => {
    if (!knowledgeBriefContent) return
    try {
      await copyTextToClipboard(knowledgeBriefContent)
      pushToast(knowledgeBriefKind === 'chapter_map' ? '结构图已复制' : '资料已复制', knowledgeBriefTitle, 'success')
    } catch {
      pushToast('复制失败', '可以在阅读窗口中手动选中文本复制。', 'error')
    }
  }

  const handleRevealKnowledgeBrief = () => {
    if (!knowledgeBriefPath) return
    void window.desktopAPI.showItem(knowledgeBriefPath)
  }

  const handleOpenKnowledgeBriefInLearning = async (record: MaterialInventoryRecord) => {
    try {
      const readablePath = getMaterialLibraryReadPath(record)
      if (readablePath) {
        await handleOpenMarkdownAsStudyPackage({
          title: record.title,
          targetPath: readablePath,
          htmlPath: getMaterialLibraryReadHtmlPath(record),
          materialPath: record.path,
          sourceId: record.sourceId,
          sourceUrl: record.sourceUrl,
        })
        return
      }
      throw new Error('还没有可阅读的清洗稿或精读稿。')
    } catch (error) {
      pushToast('打开失败', error instanceof Error ? error.message : '无法把资料载入专注页。', 'error')
    }
  }

  const handleCopyNotebookLmImportPath = async (record: MaterialInventoryRecord) => {
    const targetPath = getNotebookLmImportPath(record)
    try {
      await copyTextToClipboard(targetPath)
      pushToast('文件路径已复制', getNotebookLmPathTitle(record), 'success')
    } catch (error) {
      pushToast('复制失败', error instanceof Error ? error.message : '无法复制文件路径。', 'error')
    }
  }

  const handleBuildEditorialSummary = async (record: MaterialInventoryRecord) => {
    if (editorialSummaryBuildingPath || distillRequestState === 'loading') return
    setEditorialSummaryBuildingPath(record.path)
    try {
      const result = await window.desktopAPI.summarizeMaterialPackage({
        materialPath: record.path,
        editorialMode: 'force',
      })
      const statusPayload = (result.editorialSummary && typeof result.editorialSummary === 'object'
        ? result.editorialSummary
        : {}) as Record<string, unknown>
      const status = String(statusPayload.status ?? '')
      if (status !== 'summary_ready') {
        const reason = String(statusPayload.error ?? statusPayload.reason ?? '视频编稿未完成。')
        throw new Error(reason)
      }
      setMaterialInventory(await window.desktopAPI.listMaterialPackages())
      notifyMaterialPackagesChanged()
      pushToast('精读稿已生成', record.title, 'success')
    } catch (error) {
      pushToast('制作失败', error instanceof Error ? error.message : '无法生成视频精读稿。', 'error')
      try {
        setMaterialInventory(await window.desktopAPI.listMaterialPackages())
        notifyMaterialPackagesChanged()
      } catch {
        // Keep the original failure toast.
      }
    } finally {
      setEditorialSummaryBuildingPath(null)
    }
  }

  const handleRefreshKnowledgeLibrary = async () => {
    setKnowledgeLoading(true)
    setKnowledgeError('')
    try {
      const [knowledge, materials] = await Promise.all([
        window.desktopAPI.listKnowledgeLibrary(),
        window.desktopAPI.listMaterialPackages(),
      ])
      setKnowledgeInventory(knowledge)
      setMaterialInventory(materials)
      notifyMaterialPackagesChanged()
    } catch (error) {
      setKnowledgeError(error instanceof Error ? error.message : '无法刷新灵犀。')
    } finally {
      setKnowledgeLoading(false)
    }
  }

  const handleSaveSettings = async () => {
    try {
      const next = await window.desktopAPI.saveSettings(settingsDraft)
      setRuntimeSettings(next)
      onRuntimeSettingsSaved(next)
      setSettingsError('')
      pushToast('设置已保存', '本地素材整理与专注页配置已更新', 'success')
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '保存设置失败')
    }
  }

  const handleAutomationCheckNow = async () => {
    setAutomationBusy(true)
    try {
      const status = await window.desktopAPI.runAutomationCheckNow()
      setAutomationStatus(status)
      pushToast('后台检查完成', status.lastResult, status.lastError ? 'error' : 'success')
    } catch (error) {
      pushToast('后台检查失败', error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setAutomationBusy(false)
    }
  }

  const handleToggleAutomationPaused = async () => {
    const nextPaused = !automationStatus?.paused
    setAutomationBusy(true)
    try {
      const status = await window.desktopAPI.setAutomationPaused(nextPaused)
      setAutomationStatus(status)
      pushToast(nextPaused ? '后台任务已暂停' : '后台任务已恢复', status.lastResult, 'success')
    } catch (error) {
      pushToast('后台状态更新失败', error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setAutomationBusy(false)
    }
  }

  const handleTestEmailPush = async () => {
    setEmailTestBusy(true)
    try {
      const next = await window.desktopAPI.saveSettings(settingsDraft)
      setRuntimeSettings(next)
      onRuntimeSettingsSaved(next)
      setSettingsDraft(buildInitialDraft(next))
      const result = await window.desktopAPI.testEmailPush()
      pushToast(result.ok ? '测试邮件已发送' : '邮件配置未完成', result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      pushToast('邮件测试失败', error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setEmailTestBusy(false)
    }
  }

  const handlePreviewMimoVoice = async (voiceId: string, previewUrl: string) => {
    ttsTestAudioRef.current?.pause()
    ttsTestAudioRef.current?.removeAttribute('src')
    ttsTestAudioRef.current?.load()
    ttsTestAudioRef.current = null
    setSettingsDraft((current) => ({ ...current, mimo_tts_voice_id: voiceId }))
    setTtsPreviewVoice(voiceId)
    try {
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(previewUrl)
        ttsTestAudioRef.current = audio
        audio.onended = () => resolve()
        audio.onerror = () => reject(new Error('试听音频播放失败，请检查系统音频设置。'))
        void audio.play().catch(reject)
      })
      ttsTestAudioRef.current = null
    } catch (error) {
      pushToast('试听失败', error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setTtsPreviewVoice(null)
    }
  }

  const handlePickObsidianVault = async () => {
    const targetPath = await window.desktopAPI.pickDirectory()
    if (!targetPath) return
    setSettingsDraft((current) => ({ ...current, obsidian_vault_path: targetPath }))
  }

  const workspaceDialogs = (
    <WorkspaceDialogs
      knowledgeBriefOpen={knowledgeBriefOpen}
      knowledgeBriefTitle={knowledgeBriefTitle}
      knowledgeBriefPath={knowledgeBriefPath}
      knowledgeBriefContent={knowledgeBriefContent}
      knowledgeBriefLoading={knowledgeBriefLoading}
      knowledgeBriefError={knowledgeBriefError}
      knowledgeBriefKind={knowledgeBriefKind}
      onKnowledgeBriefOpenChange={setKnowledgeBriefOpen}
      onCopyKnowledgeBrief={() => void handleCopyMarkdownDocument()}
      onRevealKnowledgeBrief={handleRevealKnowledgeBrief}
    />
  )

  if (view === 'learn') {
    return (
      <>
        <CoachPane
          showHome={showLearningHome}
          onStartLearning={onRequestLearn}
          onOpenWorkbench={onRequestWorkbench}
          onOpenArchive={onRequestArchive}
        />
        {workspaceDialogs}
      </>
    )
  }

  if (view === 'workbench') {
    return (
      <>
        <WorkspaceShell
          eyebrow="Source Flow"
          title="制作"
          windowFocused={windowFocused}
        >
          <WorkbenchPaneContent
            activeSource={activeFollowSource}
            activeSourceId={activeFollowSourceId ?? ''}
            allSourceCount={bilibiliFollowSources?.items.length ?? 0}
            filteredSourceCount={filteredFollowSources.length}
            filteredSources={filteredFollowSources}
            pagedSources={pagedFollowSources}
            pinnedSourceIds={pinnedBilibiliSourceIds}
            pinnedOnly={followSourcePinnedOnly}
            sourceQuery={followSourceQuery}
            sourcesLoading={bilibiliFollowSourcesLoading}
            sourcesError={bilibiliFollowSourcesError ?? ''}
            sourcesMessage={bilibiliFollowSources?.message || undefined}
            sourceVideos={flatSourceVideos}
            pagedSourceVideos={pagedSourceVideos}
            selectedVideoIds={selectedSourceVideoIds}
            sourceVideoMaxDurationSeconds={sourceVideoMaxDurationSeconds}
            sourceVideoPage={sourceVideoPage}
            sourceVideosFetchedAt={bilibiliSourceVideos?.fetchedAt ?? 0}
            sourceVideosLoading={bilibiliSourceVideosLoading}
            sourceVideosError={bilibiliSourceVideosError ?? ''}
            materialSourceMode={materialSourceMode}
            videoInput={videoInput}
            manualSourceLoading={manualSourceLoading}
            distillRequestState={distillRequestState}
            distillProgressPercent={distillProgressPercent}
            distillError={distillError ?? ''}
            automationStatus={automationStatus}
            automationStatusLabel={automationStatusLabel}
            automationLastCheckLabel={automationLastCheckLabel}
            queueItems={workbenchSourceItems}
            pagedQueueItems={pagedWorkbenchItems}
            queuePageSize={WORKBENCH_LIST_PAGE_SIZE}
            canClearQueue={canClearWorkbenchQueue}
            materialRootDir={materialRootDir}
            runtimeSettings={runtimeSettings}
            editorialSummaryBuildingPath={editorialSummaryBuildingPath ?? ''}
            onAddSelectedVideos={() => handleAddSelectedVideosToQueue()}
            onPickLocalMedia={() => void handlePickLocalMedia()}
            onTogglePinnedOnly={() => setFollowSourcePinnedOnly((value) => !value)}
            onRefreshSources={() => {
              if (activeFollowSource) {
                void refreshBilibiliSourceVideos([activeFollowSource.mid])
              } else {
                void refreshBilibiliFollowSources()
              }
            }}
            onSourceQueryChange={setFollowSourceQuery}
            onSourcePageChange={setFollowSourcePage}
            onOpenSource={handleOpenFollowSource}
            onTogglePinnedSource={(source) => void handleTogglePinnedFollowSource(source)}
            onVideoInputChange={setVideoInput}
            onMaterialSourceModeChange={setMaterialSourceMode}
            onSubmitManualSource={() => void handleDistillCourse()}
            onToggleVideo={handleToggleSourceVideo}
            onSourceVideoPageChange={setSourceVideoPage}
            onClearQueue={() => void handleClearWorkbenchQueue()}
            onOpenMaterialRoot={() => runtimeSettings?.output_dir ? void window.desktopAPI.openPath(materialRootDir) : undefined}
            onRefreshMaterials={async () => {
              try {
                setMaterialInventory(await window.desktopAPI.listMaterialPackages())
              } catch {
                pushToast('刷新失败', '无法读取原材料目录。', 'error')
              }
            }}
            onQueuePageChange={setWorkbenchListPage}
            getDurationBarPercent={getDurationBarPercent}
            formatRelativeTime={formatRelativeTime}
            getItemStatus={getWorkbenchSourceStatus}
            getItemMeta={getWorkbenchSourceMeta}
            getItemTitle={getWorkbenchSourceTitle}
            canOpenBrief={canOpenMaterialBrief}
            getNotebookLmPathTitle={getNotebookLmPathTitle}
            onRetryQueueItem={(queueId) => void handleStartQueuedVideo(queueId)}
            onCopyNotebookLmPath={(record) => void handleCopyNotebookLmImportPath(record)}
            onOpenBrief={(record) => void handleOpenKnowledgeBriefInLearning(record)}
            onBuildSummary={(record) => void handleBuildEditorialSummary(record)}
            onDeleteMaterial={(record) => void handleDeleteMaterialPackage(record)}
            onRemoveQueuedVideo={handleRemoveQueuedVideo}
          />
        </WorkspaceShell>
        {workspaceDialogs}
      </>
    )
  }

  if (view === 'knowledge') {
    return (
      <>
        <WorkspaceShell
          eyebrow="Library"
          title="灵犀"
          description="这里按来源收纳已经整理或导出的文章，后续会承接 NotebookLM、Obsidian 和本地归档。"
          windowFocused={windowFocused}
          actions={
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={!runtimeSettings?.output_dir}
              onClick={() => runtimeSettings?.output_dir ? void window.desktopAPI.openPath(knowledgeRootDir) : undefined}
            >
              <FolderOpen size={14} />
              打开灵犀目录
            </Button>
          }
        >
          <KnowledgePaneContent
            totalCount={(knowledgeInventory?.records.length ?? 0) + sortedMaterialRecords.filter((record) => Boolean(getMaterialLibraryReadPath(record))).length}
            totalTextLength={knowledgeTotalTextLength + sortedMaterialRecords.reduce((sum, record) => sum + record.textLength, 0)}
            libraryPath={knowledgeInventory?.libraryPath || ''}
            rootDir={knowledgeRootDir}
            query={knowledgeQuery}
            sourceFilter={knowledgeSourceFilter}
            loading={knowledgeLoading}
            initialLoading={knowledgeLoading && !knowledgeInventory && !materialInventory}
            error={knowledgeError}
            materialRecords={filteredKnowledgeMaterialRecords}
            records={filteredKnowledgeRecords}
            onQueryChange={setKnowledgeQuery}
            onRefresh={() => void handleRefreshKnowledgeLibrary()}
            onClearSourceFilter={() => setKnowledgeSourceFilter({ kind: 'all', title: '全部资料' })}
            onRevealLibraryPath={() => knowledgeInventory?.libraryPath ? void window.desktopAPI.showItem(knowledgeInventory.libraryPath) : undefined}
            onOpenMaterialRecord={(record) => void handleOpenKnowledgeBriefInLearning(record)}
            onOpenKnowledgeRecord={(record) => void handleOpenMarkdownAsStudyPackage({
              title: record.title,
              targetPath: record.libraryPath,
              materialPath: record.materialPath,
              sourceId: record.sourceId,
            })}
            onRevealPath={(targetPath) => void window.desktopAPI.showItem(targetPath)}
            onOpenPath={(targetPath) => void window.desktopAPI.openPath(targetPath)}
            formatRelativeTime={formatRelativeTime}
            formatCompactNumber={formatCompactNumber}
          />
        </WorkspaceShell>
        {workspaceDialogs}
      </>
    )
  }

  if (view === 'archive') {
    return (
      <>
        <WorkspaceShell
          eyebrow="Archive"
          title="档案"
          windowFocused={windowFocused}
        >
          <ArchivePaneContent
            stats={archiveStats}
            filters={archiveFilters}
            activeFilter={archiveShelfFilter}
            query={libraryQuery}
            records={archiveFilteredRecords}
            materialRootDir={materialRootDir}
            canOpenRoot={Boolean(materialInventory?.rootDir)}
            emailPushEnabled={settingsDraft.email_push_enabled}
            onFilterChange={setArchiveShelfFilter}
            onQueryChange={setLibraryQuery}
            onOpenRoot={() => void window.desktopAPI.openPath(materialRootDir)}
            onRefresh={() => {
              void window.desktopAPI.listMaterialPackages().then((result) => {
                setMaterialInventory(result)
                notifyMaterialPackagesChanged()
              })
            }}
            onOpenRecord={(record) => void handleOpenKnowledgeBriefInLearning(record)}
            onCopyNotebookLmPath={(record) => void handleCopyNotebookLmImportPath(record)}
            onRevealPath={(targetPath) => void window.desktopAPI.showItem(targetPath)}
            onDeleteRecord={(record) => void handleDeleteMaterialPackage(record)}
            formatRelativeTime={formatRelativeTime}
            formatCompactNumber={formatCompactNumber}
            getNotebookLmPathTitle={getNotebookLmPathTitle}
          />
        </WorkspaceShell>
        {workspaceDialogs}
      </>
    )
  }

  if (view === 'workflow') {
    return (
      <>
        <WorkflowPane windowFocused={windowFocused} />
        {workspaceDialogs}
      </>
    )
  }



  return (
    <>
      <WorkspaceShell
        eyebrow="Settings"
        title="设置"
        windowFocused={windowFocused}
      >
        <SettingsPaneContent
          runtimeModeLabel={runtimeModeLabel}
          runtimeSettings={runtimeSettings}
          materialRootDir={materialRootDir}
          settingsDraft={settingsDraft}
          settingsStatus={settingsStatus}
          settingsStatusLoading={settingsStatusLoading}
          settingsStatusError={settingsStatusError}
          automationStatus={automationStatus}
          automationStatusLabel={automationStatusLabel}
          automationBusy={automationBusy}
          emailTestBusy={emailTestBusy}
          mimoTextModels={MIMO_TEXT_MODELS}
          ttsIcon={settingsTtsIcon}
          ttsVoices={MIMO_TTS_PRESET_VOICES}
          ttsPreviewVoice={ttsPreviewVoice}
          obsidianIcon={settingsObsidianIcon}
          transcriptionIcon={settingsTranscriptionIcon}
          bilibiliIcon={settingsBilibiliIcon}
          settingsError={settingsError}
          onSettingsDraftChange={setSettingsDraft}
          onRefreshSettingsStatus={() => void refreshSettingsStatus()}
          onToggleAutomationPaused={() => void handleToggleAutomationPaused()}
          onAutomationCheckNow={() => void handleAutomationCheckNow()}
          onTestEmailPush={() => void handleTestEmailPush()}
          onPreviewMimoVoice={(voiceId, previewUrl) => void handlePreviewMimoVoice(voiceId, previewUrl)}
          onPickObsidianVault={() => void handlePickObsidianVault()}
        />
      </WorkspaceShell>
      {workspaceDialogs}
    </>
  )
}

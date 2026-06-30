import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FolderOpen,
} from 'lucide-react'
import { WorkflowPane } from '@/ui/pages/WorkflowPane'
import { Button } from '@/ui/components/base/button'
import {
  ArchivePaneContent,
  getMaterialLibraryReadHtmlPath,
  getMaterialLibraryReadPath,
} from '@/ui/panels/workspace/ArchivePaneParts'
import {
  KnowledgePaneContent,
  type KnowledgeSourceFilter,
} from '@/ui/panels/workspace/KnowledgePaneParts'
import {
  SettingsPaneContent,
} from '@/ui/panels/workspace/SettingsPaneParts'
import { WorkbenchQueuePanel } from '@/ui/panels/workspace/WorkbenchQueueParts'
import {
  getPageSlice,
  type MaterialInventory,
  type MaterialInventoryRecord,
  type MaterialSourceMode,
  type RuntimeSettingsFallback,
  type WorkbenchQueueItem,
} from '@/ui/panels/workspace/WorkbenchShared'
import {
  WorkspaceDialogs,
  type MarkdownDocumentKind,
} from '@/ui/panels/workspace/WorkspaceDialogs'
import { WorkspaceShell } from '@/ui/panels/workspace/WorkspaceShell'
import {
  FOLLOW_SOURCE_WINDOW_SIZE,
  MIMO_TEXT_MODELS,
  SOURCE_VIDEO_WINDOW_SIZE,
  WORKBENCH_RECORD_BATCH_SIZE,
  buildArchiveStats,
  buildInitialDraft,
  buildRecordSearchText,
  buildWorkbenchSourceItems,
  canOpenMaterialBrief,
  createWorkbenchQueueItem,
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
  getVisibleWorkbenchRecordItems,
  getWorkbenchSourceMeta,
  getWorkbenchSourceStatus,
  getWorkbenchSourceTitle,
  isRejectedModelDocument,
  notifyMaterialPackagesChanged,
  normalizeWorkbenchSourceKey,
  stripKnowledgeBriefMetadata,
} from '@/ui/pages/WorkspacePaneUtils'
import {
  ARCHIVE_ALL_GROUP_ID,
  buildArchiveCreatorGroups,
  findArchiveCreatorGroup,
} from '@/ui/pages/archiveGrouping'
import { copyTextToClipboard } from '@/services/filesystem/clipboard'
import { useLearningStore } from '@/state/store'
import archiveCurrentRecordIcon from '@/assets/archive-current-record.svg'
import archiveOtherRecordsIcon from '@/assets/archive-other-records.svg'
import settingsBilibiliIcon from '@/assets/settings-bilibili.svg'
import settingsTranscriptionIcon from '@/assets/settings-transcription.svg'
import videoIcon from '@/assets/video-icon.svg'

export type WorkspaceView = 'home' | 'workbench' | 'knowledge' | 'archive' | 'workflow' | 'settings'

type WorkspacePaneProps = {
  view: WorkspaceView
  runtimeSettings: RuntimeSettingsFallback
  onRuntimeSettingsSaved: (next: Awaited<ReturnType<typeof window.desktopAPI.loadSettings>>) => void
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
  onRequestWorkbench,
  onRequestArchive,
  windowFocused,
}: WorkspacePaneProps) {
  const [settingsDraft, setSettingsDraft] = useState(() => buildInitialDraft(runtimeSettings))
  const [settingsError, setSettingsError] = useState('')
  const settingsSaveTimerRef = useRef<number | null>(null)
  const settingsLastSavedJsonRef = useRef('')
  const workbenchQueueLoadedRef = useRef(false)
  const workbenchQueueRemoteUpdateRef = useRef(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySortMode, setLibrarySortMode] = useState<LibrarySortMode>('recent')
  const [activeArchiveGroupId, setActiveArchiveGroupId] = useState(ARCHIVE_ALL_GROUP_ID)
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
  const [followSourcePage, setFollowSourcePage] = useState(1)
  const [sourceVideoPage, setSourceVideoPage] = useState(1)
  const [workbenchRecordVisibleCount, setWorkbenchRecordVisibleCount] = useState(WORKBENCH_RECORD_BATCH_SIZE)
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

  const courseData = useLearningStore((state) => state.courseData)
  const videoInput = useLearningStore((state) => state.videoInput)
  const setVideoInput = useLearningStore((state) => state.setVideoInput)
  const distillCourseFromVideo = useLearningStore((state) => state.distillCourseFromVideo)
  const distillRequestState = useLearningStore((state) => state.distillRequestState)
  const distillProgressPercent = useLearningStore((state) => state.distillProgressPercent)
  const distillError = useLearningStore((state) => state.distillError)
  const lastMaterialResult = useLearningStore((state) => state.lastMaterialResult)
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
    if (view !== 'workbench' && view !== 'settings' && view !== 'knowledge' && view !== 'archive') return
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
    if (view !== 'archive') return
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
    setWorkbenchRecordVisibleCount(WORKBENCH_RECORD_BATCH_SIZE)
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
  const archiveCreatorGroups = useMemo(
    () => buildArchiveCreatorGroups({
      records: archiveMaterialRecords,
      pinnedSources: pinnedBilibiliSources,
    }),
    [archiveMaterialRecords, pinnedBilibiliSources],
  )
  const activeArchiveGroup = useMemo(
    () => findArchiveCreatorGroup(archiveCreatorGroups, activeArchiveGroupId),
    [activeArchiveGroupId, archiveCreatorGroups],
  )
  const archiveFilteredRecords = useMemo(
    () => {
      const normalizedQuery = libraryQuery.trim().toLocaleLowerCase('zh-CN')
      const records = activeArchiveGroup?.records ?? []
      if (!normalizedQuery) return records
      return records.filter((record) => [
        record.title,
        record.creator,
        record.sourceId,
        record.sourceUrl,
        record.workflowStageLabel,
        record.path,
      ].join(' ').toLocaleLowerCase('zh-CN').includes(normalizedQuery))
    },
    [activeArchiveGroup?.records, libraryQuery],
  )
  const archiveStats = useMemo(
    () => buildArchiveStats(archiveMaterialRecords),
    [archiveMaterialRecords],
  )

  useEffect(() => {
    if (archiveCreatorGroups.length > 0 && !archiveCreatorGroups.some((group) => group.id === activeArchiveGroupId)) {
      setActiveArchiveGroupId(ARCHIVE_ALL_GROUP_ID)
    }
  }, [activeArchiveGroupId, archiveCreatorGroups])

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
  const visibleWorkbenchItems = useMemo(
    () => getVisibleWorkbenchRecordItems(workbenchSourceItems, workbenchRecordVisibleCount),
    [workbenchRecordVisibleCount, workbenchSourceItems],
  )
  const canLoadMoreWorkbenchItems = visibleWorkbenchItems.length < workbenchSourceItems.length
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
        pushToast(alreadyBuilt ? '资料已存在' : '已在队列', video.title, 'info')
        return
      }

      setWorkbenchQueue((current) => {
        if (current.some((item) => getQueueSourceKey(item) === sourceKey)) return current
        return [...current, createWorkbenchQueueItem(video)]
      })
      pushToast('已加入队列', video.title, 'success')
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
      .map((video) => createWorkbenchQueueItem(video, 'queued', {
        queueSource: 'follow_source',
        editorialMode: 'off',
        pipelineMode: 'subtitle_only',
      }))
    if (!nextItems.length) {
      pushToast('队列已包含这些视频', '可以直接从处理队列逐条开始。', 'info')
      return
    }
    setWorkbenchQueue((current) => [...current, ...nextItems])
    setSelectedSourceVideoIds([])
    pushToast('已加入处理队列', `${nextItems.length} 条视频等待处理。`, 'success')
  }

  const handleStartQueuedVideo = async (queueId: string) => {
    const target = workbenchQueue.find((item) => item.queueId === queueId)
    if (!target || target.status === 'processing') return
    setWorkbenchQueue((current) =>
      current.map((item) => item.queueId === queueId ? { ...item, status: 'queued', lastError: '', updatedAt: Date.now() } : item),
    )
    pushToast(target.status === 'failed' ? '已重新加入队列' : '已加入队列', target.title, 'success')
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

  const handleOpenMaterialMarkdown = async ({
    title,
    targetPath,
  }: {
    title: string
    targetPath: string
  }) => {
    if (!targetPath) return
    try {
      const content = await window.desktopAPI.readTextFile(targetPath)
      const readableContent = stripKnowledgeBriefMetadata(content)
      if (!readableContent || isRejectedModelDocument(readableContent)) {
        throw new Error('这份正文不是可读资料，可能是模型拒绝文本或空文件。请回到队列重新生成资料。')
      }
      setKnowledgeBriefOpen(true)
      setKnowledgeBriefTitle(title)
      setKnowledgeBriefPath(targetPath)
      setKnowledgeBriefKind('brief')
      setKnowledgeBriefContent(readableContent)
      setKnowledgeBriefError('')
      setKnowledgeBriefLoading(false)
      pushToast('资料已打开', title, 'success')
    } catch (error) {
      pushToast('打开失败', error instanceof Error ? error.message : '无法打开这份资料。', 'error')
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
      void handleOpenMaterialMarkdown({
        title,
        targetPath,
      })
    }

    window.addEventListener('shijie:open-material-document', handleOpenMaterialDocument)
    return () => window.removeEventListener('shijie:open-material-document', handleOpenMaterialDocument)
  }, [handleOpenMaterialMarkdown, handleOpenMarkdownDocument])

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
        await handleOpenMaterialMarkdown({
          title: record.title,
          targetPath: readablePath,
        })
        return
      }
      throw new Error('还没有可阅读的清洗稿或精读稿。')
    } catch (error) {
      pushToast('打开失败', error instanceof Error ? error.message : '无法打开这份资料。', 'error')
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
      pushToast('设置已保存', '任务配置已更新', 'success')
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '保存设置失败')
    }
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

  if (view === 'workbench') {
    return (
      <>
        <WorkspaceShell
          eyebrow="Queue"
          title="队列"
          description="查看已经加入队列的视频、处理状态和已生成资料。视频来源选择已前移到最近页和侧边栏。"
          windowFocused={windowFocused}
        >
          <div className="grid min-h-0 w-full grid-cols-1 gap-5">
            <WorkbenchQueuePanel
              items={workbenchSourceItems}
              visibleItems={visibleWorkbenchItems}
              canLoadMore={canLoadMoreWorkbenchItems}
              distillRequestState={distillRequestState}
              editorialSummaryBuildingPath=""
              onLoadMore={() => setWorkbenchRecordVisibleCount((current) => Math.min(workbenchSourceItems.length, current + WORKBENCH_RECORD_BATCH_SIZE))}
              getItemStatus={getWorkbenchSourceStatus}
              getItemMeta={getWorkbenchSourceMeta}
              getItemTitle={getWorkbenchSourceTitle}
              canOpenBrief={canOpenMaterialBrief}
              getNotebookLmPathTitle={getNotebookLmPathTitle}
              onRetryQueueItem={(queueId) => void handleStartQueuedVideo(queueId)}
              onCopyNotebookLmPath={(record) => void handleCopyNotebookLmImportPath(record)}
              onOpenBrief={(record) => void handleOpenKnowledgeBriefInLearning(record)}
            />
          </div>
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
            onOpenKnowledgeRecord={(record) => void handleOpenMaterialMarkdown({
              title: record.title,
              targetPath: record.libraryPath,
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
          description="按 UP 主查看已生成的字幕清洗资料和 NotebookLM 导入稿。"
          windowFocused={windowFocused}
        >
          <ArchivePaneContent
            stats={archiveStats}
            groups={archiveCreatorGroups}
            activeGroup={activeArchiveGroup}
            query={libraryQuery}
            records={archiveFilteredRecords}
            materialRootDir={materialRootDir}
            canOpenRoot={Boolean(materialInventory?.rootDir)}
            onGroupChange={setActiveArchiveGroupId}
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
          mimoTextModels={MIMO_TEXT_MODELS}
          transcriptionIcon={settingsTranscriptionIcon}
          bilibiliIcon={settingsBilibiliIcon}
          settingsError={settingsError}
          onSettingsDraftChange={setSettingsDraft}
          onRefreshSettingsStatus={() => void refreshSettingsStatus()}
        />
      </WorkspaceShell>
      {workspaceDialogs}
    </>
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AudioLines,
  ArchiveRestore,
  Award,
  Bot,
  Cookie,
  FileUp,
  FlaskConical,
  FolderOpen,
  GraduationCap,
  KeyRound,
  Link2,
  Milestone,
  RefreshCcw,
  Search,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  LibraryBig,
  WandSparkles,
} from 'lucide-react'
import { CoachPane } from '@/components/CoachPane'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  DEFAULT_COACH_MODEL,
  DEFAULT_DISTILLER_MODEL,
  DEFAULT_GROQ_TRANSCRIPTION_MODEL,
  DEFAULT_LOCAL_TRANSCRIPTION_DEVICE,
  DEFAULT_LOCAL_TRANSCRIPTION_LANGUAGE,
  DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID,
  DEFAULT_MINIMAX_BASE_URL,
  DEFAULT_TRANSCRIPTION_PROVIDER,
} from '@/lib/coachPreferences'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'
import type { LearningRecordSummary } from '@/types/course'

export type WorkspaceView = 'learn' | 'hub' | 'settings'

type RuntimeSettingsFallback = Awaited<ReturnType<typeof window.desktopAPI.loadSettings>> | null

type WorkspacePaneProps = {
  view: WorkspaceView
  runtimeSettings: RuntimeSettingsFallback
  onRuntimeSettingsSaved: (next: Awaited<ReturnType<typeof window.desktopAPI.loadSettings>>) => void
  onRequestLearn: () => void
  windowFocused: boolean
}

type LibrarySortMode = 'recent' | 'progress' | 'title'
type ArchiveShelfFilter = 'all' | 'recent' | 'coding' | 'medical' | 'highlighted'

const DISTILL_STAGE_ORDER = [
  { id: 'metadata', label: '解析视频' },
  { id: 'subtitle', label: '字幕准备' },
  { id: 'audio', label: '音频补全' },
  { id: 'chunking', label: '文本切片' },
  { id: 'chunk_distilling', label: '蒸馏分片' },
  { id: 'batch_reducing', label: '批次归并' },
  { id: 'synthesizing', label: '最终合成' },
  { id: 'cache', label: '缓存直出' },
  { id: 'injecting', label: '注入界面' },
  { id: 'complete', label: '回传界面' },
] as const

function resolveDistillStagePosition(stage?: string) {
  const index = DISTILL_STAGE_ORDER.findIndex((item) => item.id === stage)
  return index >= 0 ? index : 0
}

function formatCacheHint(cacheHint?: string | null) {
  switch (cacheHint) {
    case 'course_package':
      return '课程包缓存'
    case 'final_course_package':
      return '最终课包缓存'
    case 'subtitle_bundle':
      return '字幕缓存'
    case 'audio_page_cache':
      return '分P音频缓存'
    case 'audio_transcript_cache':
      return '整段转写缓存'
    case 'chunk_shard':
      return '分片缓存'
    case 'batch_shard':
      return '批次缓存'
    case 'chunk_prefetch':
      return '后台预热'
    case 'local_fast_synth':
      return '本地快速合成'
    default:
      return ''
  }
}

function buildInitialDraft(runtimeSettings: RuntimeSettingsFallback) {
  return {
    sessdata: runtimeSettings?.sessdata || '',
    output_dir: runtimeSettings?.output_dir || '',
    obsidian_vault_path: runtimeSettings?.obsidian_vault_path || '',
    obsidian_export_folder: runtimeSettings?.obsidian_export_folder || '视界专注',
    obsidian_auto_sync: runtimeSettings?.obsidian_auto_sync ?? true,
    coach_api_base_url: runtimeSettings?.coach_api_base_url || DEFAULT_MINIMAX_BASE_URL,
    coach_api_key: runtimeSettings?.coach_api_key || '',
    coach_model: runtimeSettings?.coach_model || DEFAULT_COACH_MODEL,
    distiller_api_base_url: runtimeSettings?.distiller_api_base_url || DEFAULT_MINIMAX_BASE_URL,
    distiller_api_key: runtimeSettings?.distiller_api_key || '',
    distiller_model: runtimeSettings?.distiller_model || DEFAULT_DISTILLER_MODEL,
    transcription_provider: runtimeSettings?.transcription_provider || DEFAULT_TRANSCRIPTION_PROVIDER,
    groq_api_key: runtimeSettings?.groq_api_key || '',
    groq_transcription_model: runtimeSettings?.groq_transcription_model || DEFAULT_GROQ_TRANSCRIPTION_MODEL,
    local_transcription_root: runtimeSettings?.local_transcription_root || '',
    local_transcription_python: runtimeSettings?.local_transcription_python || '',
    local_transcription_model_id: runtimeSettings?.local_transcription_model_id || DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID,
    local_transcription_device: runtimeSettings?.local_transcription_device || DEFAULT_LOCAL_TRANSCRIPTION_DEVICE,
    local_transcription_language: runtimeSettings?.local_transcription_language || DEFAULT_LOCAL_TRANSCRIPTION_LANGUAGE,
  }
}

function formatRelativeTime(timestamp: number) {
  if (!timestamp) return '刚刚'
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚继续过'
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))} 分钟前`
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时前`
  if (diff < day * 7) return `${Math.max(1, Math.round(diff / day))} 天前`

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(timestamp)
}

function formatSyncTime(timestamp: number) {
  if (!timestamp) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function buildRecordSearchText(record: LearningRecordSummary) {
  return [record.title, record.sourceTitle, record.sourceId, record.packageId, record.currentNodeTitle ?? '']
    .join(' ')
    .toLowerCase()
}

function inferRecordDomain(record: LearningRecordSummary) {
  const text = [record.title, record.sourceTitle, record.sourceId].join(' ').toLowerCase()
  if (
    /python|编程|代码|程序|开发|接口|爬虫|语法|函数|变量|requests|json|async|对象/u.test(text)
  ) {
    return 'coding'
  }
  if (
    /医学|口腔|临床|医师|病例|检查|操作|诊疗|病损|修复|牙|护理|无菌/u.test(text)
  ) {
    return 'medical'
  }
  return 'general'
}

function getRecordProgressLabel(record: LearningRecordSummary) {
  if (record.isArchived) {
    return `已掌握 ${record.completedCount} 节`
  }

  if (record.currentNodeTitle) {
    return `继续：${record.currentNodeTitle}`
  }

  return `${record.progressPercent}% 已掌握`
}

function getRecordChallengeMeta(record: LearningRecordSummary) {
  if (record.dominantChallenge === 'incorrect-heavy') {
    return {
      label: '纠错偏多',
      detail: record.hotspotNodeTitle ? `最常卡在 ${record.hotspotNodeTitle}` : '最近更适合回看错题',
    }
  }

  if (record.dominantChallenge === 'partial-heavy') {
    return {
      label: '理解补全中',
      detail: record.hotspotNodeTitle ? `最常差半步的是 ${record.hotspotNodeTitle}` : '最近多是答到一半但还不够稳',
    }
  }

  return {
    label: '推进稳定',
    detail: record.currentNodeTitle ? `继续推进 ${record.currentNodeTitle}` : '当前没有明显卡点',
  }
}

function formatMilestoneTime(timestamp: number) {
  if (!timestamp) return '刚刚'
  const diff = Date.now() - timestamp
  const hour = 60 * 60 * 1000
  const day = 24 * hour
  if (diff < hour) return `${Math.max(1, Math.round(diff / (60 * 1000)))} 分钟前`
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)
}

function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function formatDayLabel(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)
}

function formatWeekdayLabel(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(timestamp).replace('周', '')
}

function getAchievementToneClass(tone: LearningRecordSummary['achievementBadges'][number]['tone']) {
  switch (tone) {
    case 'success':
      return 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100'
    case 'accent':
      return 'border-sky-400/18 bg-sky-400/[0.08] text-sky-100'
    case 'info':
      return 'border-violet-400/18 bg-violet-400/[0.08] text-violet-100'
    default:
      return 'border-white/8 bg-white/[0.03] text-foreground/85'
  }
}

function WorkspaceShell({
  eyebrow,
  title,
  description,
  actions,
  children,
  windowFocused,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
  windowFocused: boolean
}) {
  return (
    <section className="flex min-h-0 flex-1">
      <Card className={cn('work-surface flex min-h-0 w-full flex-col overflow-hidden rounded-l-[22px] rounded-r-none border-0 shadow-[-10px_0_28px_rgba(0,0,0,0.1)] transition-colors duration-200', windowFocused ? 'bg-[#181818]' : 'bg-[#171717]')}>
        <div className="surface-seam-b flex items-start justify-between gap-4 pl-7 pr-5 pb-2.5 pt-3">
          <div className="space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">{eyebrow}</div>
            <h2 className="text-[20px] font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="max-w-3xl text-[11px] leading-5 text-muted-foreground">{description}</p>
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4.5">{children}</div>
      </Card>
    </section>
  )
}

function Field({
  label,
  icon,
  children,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <label className="grid gap-2">
      <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}

function SettingsBlock({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-[22px] border border-white/7 bg-white/[0.022] p-4.5">
      <div className="mb-4 text-[12px] font-semibold text-foreground">{title}</div>
      <div className="grid gap-4">{children}</div>
    </div>
  )
}

function LibraryRecordRow({
  record,
  active,
  onOpen,
  onDelete,
  onOpenSource,
  onRevealPackage,
}: {
  record: LearningRecordSummary
  active: boolean
  onOpen: () => void
  onDelete: () => void
  onOpenSource: () => void
  onRevealPackage: () => void
}) {
  const challengeMeta = getRecordChallengeMeta(record)

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group w-full rounded-[20px] border px-3.5 py-2.5 text-left transition',
        active
          ? 'border-white/10 bg-white/[0.045]'
          : record.isArchived
            ? 'border-emerald-500/12 bg-[linear-gradient(180deg,rgba(27,31,28,0.96),rgba(24,26,24,0.96))] hover:bg-[linear-gradient(180deg,rgba(29,34,30,0.98),rgba(24,28,25,0.98))]'
            : 'border-white/6 bg-[#1b1b1b] hover:bg-[#1e1e1e]',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className={cn('size-1.5 rounded-full bg-white/35', active && 'bg-white/80')} />
            <div className="truncate text-[12px] font-semibold text-foreground">{record.title}</div>
            {record.isArchived ? (
              <Badge variant="outline" className="border-emerald-500/15 bg-emerald-500/[0.08] text-emerald-100">
                <GraduationCap className="size-3" />
                已归档
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span>{record.sourceId || record.packageId}</span>
            <span>{getRecordProgressLabel(record)}</span>
            <span>{formatRelativeTime(record.lastOpenedAt)}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
              {challengeMeta.label}
            </Badge>
            {record.totalStageCount > 0 ? (
              <span className="text-muted-foreground">
                阶段 {record.stageCompletedCount}/{record.totalStageCount}
              </span>
            ) : null}
            {record.partialCount > 0 ? <span className="text-muted-foreground">补半步 {record.partialCount} 次</span> : null}
            {record.incorrectCount > 0 ? <span className="text-muted-foreground">需纠错 {record.incorrectCount} 次</span> : null}
          </div>

          <div className="text-[10px] leading-5 text-muted-foreground">{challengeMeta.detail}</div>

          {record.isArchived ? (
            <div className="rounded-2xl border border-emerald-500/12 bg-emerald-500/[0.045] px-3 py-2 text-[10px] leading-5 text-emerald-100/85">
              这门课已经完整征服，可以作为长期知识资产保留在档案柜中。
            </div>
          ) : null}

          {record.achievementBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {record.achievementBadges.slice(0, 3).map((badge) => (
                <span
                  key={badge.code}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    getAchievementToneClass(badge.tone),
                  )}
                  title={badge.description}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}

          {record.recentMilestones.length > 0 ? (
            <div className="rounded-2xl border border-white/6 bg-white/[0.018] px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                <Milestone size={12} />
                最近里程碑
              </div>
              <div className="mt-1.5 text-[11px] text-foreground/88">{record.recentMilestones[0].title}</div>
              <div className="mt-0.5 text-[10px] leading-5 text-muted-foreground">
                {record.recentMilestones[0].detail} · {formatMilestoneTime(record.recentMilestones[0].createdAt)}
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Progress value={record.isArchived ? 100 : record.progressPercent} className="h-1 bg-white/6" />
            </div>
            <span className="text-[10px] text-muted-foreground">{record.isArchived ? '100%' : `${record.progressPercent}%`}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-xl"
            onClick={(event) => {
              event.stopPropagation()
              onOpenSource()
            }}
            disabled={!record.sourceUrl}
          >
            <Link2 size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-xl"
            onClick={(event) => {
              event.stopPropagation()
              onRevealPackage()
            }}
            disabled={!record.packagePath && !record.importedCoursePath}
          >
            <FolderOpen size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-xl hover:text-destructive"
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </button>
  )
}

function ArchivedCourseTile({
  record,
  active,
  onOpen,
  onRevealPackage,
}: {
  record: LearningRecordSummary
  active: boolean
  onOpen: () => void
  onRevealPackage: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group rounded-[22px] border p-4 text-left transition',
        active
          ? 'border-emerald-400/16 bg-[linear-gradient(180deg,rgba(35,42,37,0.98),rgba(28,32,29,0.98))] shadow-[0_0_24px_rgba(16,185,129,0.08)]'
          : 'border-emerald-500/10 bg-[linear-gradient(180deg,rgba(28,32,29,0.98),rgba(22,25,23,0.98))] hover:border-emerald-400/14 hover:bg-[linear-gradient(180deg,rgba(31,36,33,0.98),rgba(24,28,25,0.98))]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-xl border border-emerald-500/14 bg-emerald-500/[0.08] text-emerald-100">
              <GraduationCap size={14} />
            </div>
            <div className="truncate text-[12px] font-semibold text-foreground">{record.title}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span>{record.sourceId || record.packageId}</span>
            <span>{record.completedCount} 节已掌握</span>
            <span>{record.stageCompletedCount}/{Math.max(record.totalStageCount, 0)} 阶段</span>
          </div>

          {record.achievementBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {record.achievementBadges.slice(0, 2).map((badge) => (
                <span
                  key={badge.code}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    getAchievementToneClass(badge.tone),
                  )}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}

          <div className="text-[11px] leading-5 text-emerald-100/78">
            {record.recentMilestones[0]?.title ?? '这门课已经沉淀为长期知识资产。'}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant="outline" className="border-emerald-500/14 bg-emerald-500/[0.08] text-emerald-100">
            100%
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-xl opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
              onRevealPackage()
            }}
            disabled={!record.packagePath && !record.importedCoursePath}
          >
            <FolderOpen size={14} />
          </Button>
        </div>
      </div>
    </button>
  )
}

export function WorkspacePane({
  view,
  runtimeSettings,
  onRuntimeSettingsSaved,
  onRequestLearn,
  windowFocused,
}: WorkspacePaneProps) {
  const [settingsDraft, setSettingsDraft] = useState(() => buildInitialDraft(runtimeSettings))
  const [settingsError, setSettingsError] = useState('')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySortMode, setLibrarySortMode] = useState<LibrarySortMode>('recent')
  const [archiveShelfFilter, setArchiveShelfFilter] = useState<ArchiveShelfFilter>('all')
  const [obsidianExporting, setObsidianExporting] = useState(false)
  const [libraryStructureRefreshing, setLibraryStructureRefreshing] = useState(false)
  const [obsidianAutoSyncMeta, setObsidianAutoSyncMeta] = useState<{
    updatedAt: number | null
    error: string | null
  }>({ updatedAt: null, error: null })
  const obsidianAutoSyncSignatureRef = useRef('')
  const obsidianExportingRef = useRef(false)

  const courseData = useLearningStore((state) => state.courseData)
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const completedNodeIds = useLearningStore((state) => state.completedNodeIds)
  const failedNodeIds = useLearningStore((state) => state.failedNodeIds)
  const videoInput = useLearningStore((state) => state.videoInput)
  const setVideoInput = useLearningStore((state) => state.setVideoInput)
  const distillCourseFromVideo = useLearningStore((state) => state.distillCourseFromVideo)
  const distillRequestState = useLearningStore((state) => state.distillRequestState)
  const distillStatusMessage = useLearningStore((state) => state.distillStatusMessage)
  const distillProgressPercent = useLearningStore((state) => state.distillProgressPercent)
  const distillError = useLearningStore((state) => state.distillError)
  const distillOutlinePreview = useLearningStore((state) => state.distillOutlinePreview)
  const distillProgressSnapshot = useLearningStore((state) => state.distillProgressSnapshot)
  const importCoursePackage = useLearningStore((state) => state.importCoursePackage)
  const libraryRecords = useLearningStore((state) => state.libraryRecords)
  const activeRecordId = useLearningStore((state) => state.activeRecordId)
  const openSavedRecord = useLearningStore((state) => state.openSavedRecord)
  const deleteSavedRecord = useLearningStore((state) => state.deleteSavedRecord)
  const refreshLibrary = useLearningStore((state) => state.refreshLibrary)
  const restoreLearningRecord = useLearningStore((state) => state.restoreLearningRecord)
  const setRuntimeSettings = useLearningStore((state) => state.setRuntimeSettings)
  const pushToast = useLearningStore((state) => state.pushToast)
  const coursePackageId = String(courseData?.package_id ?? '')
  const completedSignature = completedNodeIds.join('|')
  const failedSignature = failedNodeIds.join('|')
  const obsidianVaultPath = runtimeSettings?.obsidian_vault_path || settingsDraft.obsidian_vault_path
  const obsidianAutoSyncEnabled = runtimeSettings?.obsidian_auto_sync ?? settingsDraft.obsidian_auto_sync ?? true

  useEffect(() => {
    setSettingsDraft(buildInitialDraft(runtimeSettings))
    setSettingsError('')
  }, [runtimeSettings, view])

  const filteredLibraryRecords = useMemo(() => {
    const normalizedQuery = libraryQuery.trim().toLowerCase()
    const filtered = normalizedQuery
      ? libraryRecords.filter((record) => buildRecordSearchText(record).includes(normalizedQuery))
      : libraryRecords

    return [...filtered].sort((left, right) => {
      if (left.id === activeRecordId && right.id !== activeRecordId) return -1
      if (right.id === activeRecordId && left.id !== activeRecordId) return 1

      if (librarySortMode === 'progress') {
        if (right.progressPercent !== left.progressPercent) return right.progressPercent - left.progressPercent
        return right.updatedAt - left.updatedAt
      }

      if (librarySortMode === 'title') {
        return left.title.localeCompare(right.title, 'zh-CN')
      }

      return right.updatedAt - left.updatedAt
    })
  }, [activeRecordId, libraryQuery, libraryRecords, librarySortMode])
  const activeLibraryRecords = useMemo(
    () => filteredLibraryRecords.filter((record) => !record.isArchived),
    [filteredLibraryRecords],
  )
  const archivedLibraryRecords = useMemo(
    () => filteredLibraryRecords.filter((record) => record.isArchived),
    [filteredLibraryRecords],
  )
  const filteredArchivedShelfRecords = useMemo(() => {
    const now = Date.now()
    const recentWindowMs = 14 * 24 * 60 * 60 * 1000
    const filtered = archivedLibraryRecords.filter((record) => {
      if (archiveShelfFilter === 'recent') {
        return now - record.updatedAt <= recentWindowMs
      }
      if (archiveShelfFilter === 'coding') {
        return inferRecordDomain(record) === 'coding'
      }
      if (archiveShelfFilter === 'medical') {
        return inferRecordDomain(record) === 'medical'
      }
      if (archiveShelfFilter === 'highlighted') {
        return record.achievementBadges.length >= 3 || record.stageCompletedCount >= 3
      }
      return true
    })

    return [...filtered].sort((left, right) => {
      if (archiveShelfFilter === 'highlighted') {
        if (right.achievementBadges.length !== left.achievementBadges.length) {
          return right.achievementBadges.length - left.achievementBadges.length
        }
        return right.stageCompletedCount - left.stageCompletedCount
      }
      return right.updatedAt - left.updatedAt
    })
  }, [archiveShelfFilter, archivedLibraryRecords])
  const archiveOverview = useMemo(() => {
    return {
      totalCourses: archivedLibraryRecords.length,
      totalStages: archivedLibraryRecords.reduce((sum, record) => sum + record.stageCompletedCount, 0),
      totalBadges: archivedLibraryRecords.reduce((sum, record) => sum + record.achievementBadges.length, 0),
      codingCourses: archivedLibraryRecords.filter((record) => inferRecordDomain(record) === 'coding').length,
      medicalCourses: archivedLibraryRecords.filter((record) => inferRecordDomain(record) === 'medical').length,
    }
  }, [archivedLibraryRecords])
  const archiveWeeklyActivity = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStart = today.getTime()
    const countsByDay = new Map<number, number>()

    for (const record of libraryRecords) {
      for (const milestone of record.recentMilestones) {
        const dayKey = startOfLocalDay(milestone.createdAt)
        countsByDay.set(dayKey, (countsByDay.get(dayKey) ?? 0) + 1)
      }
    }

    return Array.from({ length: 7 }, (_, index) => {
      const dayStart = todayStart - (6 - index) * 24 * 60 * 60 * 1000
      const count = countsByDay.get(dayStart) ?? 0
      return {
        dayStart,
        count,
        label: formatWeekdayLabel(dayStart),
        dateLabel: formatDayLabel(dayStart),
        isToday: index === 6,
      }
    })
  }, [libraryRecords])
  const archiveRecentCompletions = useMemo(() => {
    return [...archivedLibraryRecords]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 4)
      .map((record) => ({
        id: record.id,
        title: record.title,
        completedAt: record.updatedAt,
        dateLabel: formatDayLabel(record.updatedAt),
        stageCount: record.stageCompletedCount,
        badgeCount: record.achievementBadges.length,
        domain: inferRecordDomain(record),
        milestoneTitle: record.recentMilestones[0]?.title ?? '课程已经完整归档',
      }))
  }, [archivedLibraryRecords])
  const archiveActivityPeak = useMemo(
    () => Math.max(1, ...archiveWeeklyActivity.map((item) => item.count)),
    [archiveWeeklyActivity],
  )
  const featuredActiveRecord = useMemo(
    () => activeLibraryRecords.find((record) => record.id === activeRecordId) ?? activeLibraryRecords[0] ?? null,
    [activeLibraryRecords, activeRecordId],
  )

  const currentDistillStageIndex = useMemo(
    () => resolveDistillStagePosition(distillProgressSnapshot?.stage),
    [distillProgressSnapshot?.stage],
  )

  const handleDeleteRecord = async (recordId: string, title: string) => {
    const shouldDelete = globalThis.confirm(`确定删除《${title}》的学习记录吗？这会移除本地进度与对话缓存。`)
    if (!shouldDelete) return
    await deleteSavedRecord(recordId)
  }

  const handleOpenRecord = async (recordId: string) => {
    await openSavedRecord(recordId)
    onRequestLearn()
  }

  const handleImportCourse = async () => {
    await importCoursePackage()
    if (useLearningStore.getState().courseData) {
      onRequestLearn()
    }
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
          '旧课结构已刷新',
          `已更新 ${result.recordUpdates} 份学习档案，触达 ${result.packageUpdates} 个课包文件。`,
          'success',
        )
      } else {
        pushToast(
          '结构已是最新',
          result.scannedPackages > 0 ? `已检查 ${result.scannedPackages} 个现成课包，没有发现需要升级的旧结构。` : '当前学习档案和课包已经是新的主线结构。',
          'info',
        )
      }
    } catch (error) {
      pushToast('刷新失败', error instanceof Error ? error.message : '批量刷新旧课结构失败。', 'error')
    } finally {
      setLibraryStructureRefreshing(false)
    }
  }

  const handleDistillCourse = async () => {
    const beforePackageId = useLearningStore.getState().courseData?.package_id
    await distillCourseFromVideo()
    const state = useLearningStore.getState()
    if (state.courseData && (!beforePackageId || state.courseData.package_id !== beforePackageId) && !state.distillError) {
      onRequestLearn()
    }
  }

  const handleSaveSettings = async () => {
    try {
        const next = await window.desktopAPI.saveSettings({
          ...(runtimeSettings ?? {}),
          ...settingsDraft,
        })
      setRuntimeSettings(next)
      onRuntimeSettingsSaved(next)
      setSettingsError('')
      pushToast('设置已保存', '新的引擎配置会用于后续提炼和伴学对话', 'success')
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '保存设置失败')
    }
  }

  const handlePickObsidianVault = async () => {
    const picked = await window.desktopAPI.pickDirectory()
    if (!picked) return
    setSettingsDraft((current) => ({ ...current, obsidian_vault_path: picked }))
  }

  const runObsidianExport = async ({
    silent = false,
    allowPickVault = false,
    signature,
  }: {
    silent?: boolean
    allowPickVault?: boolean
    signature?: string
  } = {}) => {
    if (obsidianExportingRef.current) return null
    if (!courseData) {
      if (!silent) {
        pushToast('没有可同步的课程', '请先提炼或导入一门课程。', 'error')
      }
      return null
    }

    let nextSettings = runtimeSettings
    if (!nextSettings?.obsidian_vault_path && !settingsDraft.obsidian_vault_path && allowPickVault) {
      const picked = await window.desktopAPI.pickDirectory()
      if (!picked) return null
      nextSettings = await window.desktopAPI.saveSettings({
        ...(runtimeSettings ?? {}),
        ...settingsDraft,
        obsidian_vault_path: picked,
      })
      setRuntimeSettings(nextSettings)
      onRuntimeSettingsSaved(nextSettings)
      setSettingsDraft(buildInitialDraft(nextSettings))
    } else if (!nextSettings?.obsidian_vault_path && settingsDraft.obsidian_vault_path) {
      nextSettings = await window.desktopAPI.saveSettings({
        ...(runtimeSettings ?? {}),
        ...settingsDraft,
      })
      setRuntimeSettings(nextSettings)
      onRuntimeSettingsSaved(nextSettings)
    }

    if (!nextSettings?.obsidian_vault_path) {
      if (!silent) {
        pushToast('还没有配置 Vault', '请先选择你的 Obsidian Vault 文件夹。', 'error')
      }
      return null
    }

    try {
      obsidianExportingRef.current = true
      setObsidianExporting(true)
      const result = await window.desktopAPI.exportCourseToObsidian({
        course: courseData as unknown as Record<string, unknown>,
        currentNodeId,
        completedNodeIds,
        failedNodeIds,
      })
      if (signature) {
        obsidianAutoSyncSignatureRef.current = signature
      }
      setObsidianAutoSyncMeta({ updatedAt: Date.now(), error: null })
      if (!silent) {
        pushToast('已同步到 Obsidian', `已写入 ${result.fileCount} 份笔记到 ${result.rootDir}`, 'success')
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出 Obsidian 失败'
      setObsidianAutoSyncMeta({ updatedAt: Date.now(), error: message })
      if (!silent) {
        pushToast('同步失败', message, 'error')
      }
      return null
    } finally {
      obsidianExportingRef.current = false
      setObsidianExporting(false)
    }
  }

  const handleExportToObsidian = async () => {
    await runObsidianExport({ allowPickVault: true })
  }

  const handleOpenObsidianTarget = async (target: 'current' | 'board') => {
    if (!courseData) {
      pushToast('没有可打开的课程', '请先提炼或导入一门课程。', 'error')
      return
    }

    let nextSettings = runtimeSettings
    if (!nextSettings?.obsidian_vault_path && !settingsDraft.obsidian_vault_path) {
      const picked = await window.desktopAPI.pickDirectory()
      if (!picked) return
      nextSettings = await window.desktopAPI.saveSettings({
        ...(runtimeSettings ?? {}),
        ...settingsDraft,
        obsidian_vault_path: picked,
      })
      setRuntimeSettings(nextSettings)
      onRuntimeSettingsSaved(nextSettings)
      setSettingsDraft(buildInitialDraft(nextSettings))
    } else if (!nextSettings?.obsidian_vault_path && settingsDraft.obsidian_vault_path) {
      nextSettings = await window.desktopAPI.saveSettings({
        ...(runtimeSettings ?? {}),
        ...settingsDraft,
      })
      setRuntimeSettings(nextSettings)
      onRuntimeSettingsSaved(nextSettings)
    }

    try {
      setObsidianExporting(true)
      const result = await window.desktopAPI.openObsidianTarget({
        course: courseData as unknown as Record<string, unknown>,
        currentNodeId,
        completedNodeIds,
        failedNodeIds,
        target,
      })
      setObsidianAutoSyncMeta({ updatedAt: Date.now(), error: null })
      pushToast(
        target === 'current' ? '已打开当前笔记' : '已打开学习看板',
        result.openedVia === 'obsidian-uri'
          ? `已通过 Obsidian 打开：${result.openedPath}`
          : `已通过本地文件打开：${result.openedPath}`,
        'success',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开 Obsidian 笔记失败'
      setObsidianAutoSyncMeta({ updatedAt: Date.now(), error: message })
      pushToast('打开失败', message, 'error')
    } finally {
      setObsidianExporting(false)
    }
  }

  useEffect(() => {
    if (!obsidianAutoSyncEnabled || !obsidianVaultPath || !coursePackageId) return
    const signature = `${coursePackageId}::${currentNodeId ?? ''}::${completedSignature}::${failedSignature}`
    if (signature === obsidianAutoSyncSignatureRef.current) return

    const timeoutHandle = window.setTimeout(() => {
      obsidianAutoSyncSignatureRef.current = signature
      void runObsidianExport({
        silent: true,
        allowPickVault: false,
        signature,
      })
    }, 1400)

    return () => window.clearTimeout(timeoutHandle)
  }, [
    coursePackageId,
    currentNodeId,
    completedSignature,
    failedSignature,
    obsidianAutoSyncEnabled,
    obsidianVaultPath,
  ])

  if (view === 'learn') {
    return <CoachPane />
  }

  if (view === 'hub') {
    return (
      <WorkspaceShell
        eyebrow="课程中心"
        title="在一个工作区里开始、导入和继续课程"
        description="第一次上手不必理解多个入口。把视频提炼、课包导入和学习档案都放在这里，减少切换成本。"
        windowFocused={windowFocused}
        actions={
          courseData ? (
            <Button variant="outline" className="rounded-xl" onClick={onRequestLearn}>
              <Sparkles size={14} />
              返回学习台
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-white/7 bg-[#1b1b1b] shadow-none">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                  <WandSparkles size={14} />
                  从 B 站生成新课程
                </div>
                <Field label="B 站链接或 BV 号" icon={<Link2 size={14} />}>
                  <Input
                    value={videoInput}
                    onChange={(event) => setVideoInput(event.target.value)}
                    placeholder="例如 BV17ykEBWEjv"
                    disabled={distillRequestState === 'loading'}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-3">
                  <Button className="rounded-xl" onClick={() => void handleDistillCourse()} disabled={distillRequestState === 'loading' || !videoInput.trim()}>
                    <WandSparkles size={14} />
                    {distillRequestState === 'loading' ? '正在提炼' : '开始提炼'}
                  </Button>
                  {distillRequestState === 'loading' ? (
                    <Badge variant="outline">{Math.max(0, Math.min(100, Math.round(distillProgressPercent)))}%</Badge>
                  ) : null}
                </div>
                {distillRequestState === 'loading' ? (
                  <div className="space-y-3">
                    <Progress value={Math.max(4, Math.min(100, distillProgressPercent || 4))} className="h-1.5 bg-white/7" />
                    <div className="rounded-[20px] border border-white/8 bg-[#1a1a1a] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{distillProgressSnapshot?.stageLabel || '处理中'}</Badge>
                        <Badge variant="outline">{Math.max(0, Math.min(100, Math.round(distillProgressPercent)))}%</Badge>
                        {distillProgressSnapshot?.resumed ? <Badge variant="outline">断点续炼</Badge> : null}
                        {formatCacheHint(distillProgressSnapshot?.cacheHint) ? (
                          <Badge variant="outline">{formatCacheHint(distillProgressSnapshot?.cacheHint)}</Badge>
                        ) : null}
                      </div>

                      <div className="mt-3 text-[12px] leading-6 text-muted-foreground">
                        {distillStatusMessage || '正在抓取字幕、切片并重建课程知识树。'}
                      </div>

                      <div className="mt-4 grid gap-2 md:grid-cols-3">
                        {DISTILL_STAGE_ORDER.map((item, index) => {
                          const isActive = distillProgressSnapshot?.stage === item.id
                          const isDone = index < currentDistillStageIndex
                          return (
                            <div
                              key={item.id}
                              className={cn(
                                'rounded-2xl border px-3 py-2 text-[11px] transition',
                                isActive
                                  ? 'border-white/14 bg-[#232323] text-foreground'
                                  : isDone
                                    ? 'border-white/8 bg-[#1f1f1f] text-foreground/90'
                                    : 'border-white/6 bg-[#191919] text-muted-foreground',
                              )}
                            >
                              {item.label}
                            </div>
                          )
                        })}
                      </div>

                      {distillProgressSnapshot &&
                      (distillProgressSnapshot.audioTotal > 0 ||
                        distillProgressSnapshot.chunkTotal > 0 ||
                        distillProgressSnapshot.batchTotal > 0) ? (
                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                          <div className="rounded-2xl border border-white/6 bg-[#1f1f1f] px-3 py-2.5">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">音频补全</div>
                            <div className="mt-1 text-[15px] font-semibold text-foreground">
                              {distillProgressSnapshot.audioTotal > 0
                                ? `${distillProgressSnapshot.audioCompleted}/${distillProgressSnapshot.audioTotal}`
                                : '未启用'}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/6 bg-[#1f1f1f] px-3 py-2.5">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">知识分片</div>
                            <div className="mt-1 text-[15px] font-semibold text-foreground">
                              {distillProgressSnapshot.chunkTotal > 0
                                ? `${distillProgressSnapshot.chunkCompleted}/${distillProgressSnapshot.chunkTotal}`
                                : '待开始'}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/6 bg-[#1f1f1f] px-3 py-2.5">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">批次归并</div>
                            <div className="mt-1 text-[15px] font-semibold text-foreground">
                              {distillProgressSnapshot.batchTotal > 0
                                ? `${distillProgressSnapshot.batchCompleted}/${distillProgressSnapshot.batchTotal}`
                                : '按需启用'}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {distillProgressSnapshot?.cacheHint === 'chunk_prefetch' && (distillProgressSnapshot.chunkTotal > 0 || distillProgressSnapshot.batchTotal > 0) ? (
                        <div className="mt-3 rounded-2xl border border-white/6 bg-[#1c1c1c] px-3 py-2 text-[12px] text-muted-foreground">
                          已在后台预热
                          {distillProgressSnapshot.chunkTotal > 0
                            ? ` ${distillProgressSnapshot.chunkCompleted}/${distillProgressSnapshot.chunkTotal} 个可蒸馏分片`
                            : ''}
                          {distillProgressSnapshot.chunkTotal > 0 && distillProgressSnapshot.batchTotal > 0 ? '，' : ''}
                          {distillProgressSnapshot.batchTotal > 0
                            ? ` ${distillProgressSnapshot.batchCompleted}/${distillProgressSnapshot.batchTotal} 个知识批次`
                            : ''}
                          {distillProgressSnapshot.prefetchReuseChunkRatio > 0
                            ? `，预计分片覆盖 ${Math.round(distillProgressSnapshot.prefetchReuseChunkRatio * 100)}%`
                            : ''}
                          {distillProgressSnapshot.prefetchReuseBatchRatio > 0
                            ? `，批次覆盖 ${Math.round(distillProgressSnapshot.prefetchReuseBatchRatio * 100)}%`
                            : ''}
                          。
                        </div>
                      ) : null}
                    </div>
                    {distillOutlinePreview ? (
                      <div className="rounded-[20px] border border-white/8 bg-[#1a1a1a] p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">骨架已生成</Badge>
                          <Badge variant="outline">{distillOutlinePreview.pageCount} 个分P</Badge>
                          <Badge variant="outline">约 {distillOutlinePreview.durationMinutes} 分钟</Badge>
                        </div>
                        <div className="mt-3 space-y-1">
                          <div className="text-sm font-semibold text-foreground">{distillOutlinePreview.title}</div>
                          <div className="text-[12px] leading-5 text-muted-foreground">{distillOutlinePreview.note}</div>
                        </div>
                        <div className="mt-4 grid gap-2">
                          {distillOutlinePreview.chapters.slice(0, 6).map((chapter) => (
                            <div key={chapter.id} className="rounded-2xl border border-white/6 bg-[#1f1f1f] px-3 py-2.5">
                              <div className="flex items-center justify-between gap-3">
                                <div className="truncate text-[13px] font-medium text-foreground/92">{chapter.title}</div>
                                <div className="shrink-0 text-[11px] text-muted-foreground">{chapter.lessonCount} 节</div>
                              </div>
                              {chapter.lessonTitles.length ? (
                                <div className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                                  {chapter.lessonTitles.join(' · ')}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {distillError ? (
                  <div className="rounded-[20px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                    {distillError}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-white/7 bg-[#1b1b1b] shadow-none">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                  <FolderOpen size={14} />
                  导入现成课包
                </div>
                <div className="text-[13px] leading-6 text-muted-foreground">
                  如果已经有蒸馏好的课程 JSON，就直接导入，不必重新走提炼。
                </div>
                <Button className="rounded-xl" onClick={() => void handleImportCourse()}>
                  <FileUp size={14} />
                  选择并导入课包
                </Button>
              </CardContent>
            </Card>

            {courseData ? (
              <Card className="border-white/7 bg-[#1b1b1b] shadow-none xl:col-span-2">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                    <LibraryBig size={14} />
                    同步到 Obsidian
                  </div>
                  <div className="text-[13px] leading-6 text-muted-foreground">
                    把当前课程导出成一组带双链的 Markdown 笔记。开启自动同步后，学习进度也会悄悄回写到 Vault。
                  </div>
                  <div className="rounded-[18px] border border-white/6 bg-white/[0.02] px-4 py-3 text-[12px] text-muted-foreground">
                    <div>Vault：{obsidianVaultPath || '尚未配置'}</div>
                    <div className="mt-1">
                      自动同步：{obsidianAutoSyncEnabled ? '已开启' : '已关闭'}
                      {obsidianAutoSyncMeta.updatedAt ? ` · 上次回写 ${formatSyncTime(obsidianAutoSyncMeta.updatedAt)}` : ''}
                    </div>
                    {obsidianAutoSyncMeta.error ? (
                      <div className="mt-1 text-destructive">最近一次自动同步失败：{obsidianAutoSyncMeta.error}</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button className="rounded-xl" onClick={() => void handleExportToObsidian()} disabled={obsidianExporting}>
                      <LibraryBig size={14} />
                      {obsidianExporting ? '正在同步' : '一键同步到 Obsidian'}
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => void handleOpenObsidianTarget('current')}
                      disabled={obsidianExporting}
                    >
                      <Link2 size={14} />
                      打开当前笔记
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => void handleOpenObsidianTarget('board')}
                      disabled={obsidianExporting}
                    >
                      <LibraryBig size={14} />
                      打开学习看板
                    </Button>
                    {(runtimeSettings?.obsidian_vault_path || settingsDraft.obsidian_vault_path) ? (
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => void window.desktopAPI.openPath(runtimeSettings?.obsidian_vault_path || settingsDraft.obsidian_vault_path)}
                      >
                        <FolderOpen size={14} />
                        打开 Vault
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Card className="border-white/7 bg-[#1b1b1b] shadow-none">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                  <ArchiveRestore size={14} />
                  学习档案
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => void handleRefreshLibraryStructure()}
                    disabled={libraryStructureRefreshing}
                  >
                    <RefreshCcw size={14} className={cn(libraryStructureRefreshing && 'animate-spin')} />
                    {libraryStructureRefreshing ? '正在刷新旧课结构' : '刷新旧课结构'}
                  </Button>
                  {courseData ? (
                    <Button variant="outline" className="rounded-xl" onClick={onRequestLearn}>
                      <Sparkles size={14} />
                      返回学习台
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-[240px] max-w-lg flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={libraryQuery}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                    placeholder="搜索课程、BV 或当前小节"
                    className="pl-11"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['recent', '最近学习'],
                    ['progress', '进度优先'],
                    ['title', '按标题'],
                  ] as const).map(([value, label]) => (
                    <Button
                      key={value}
                      variant={librarySortMode === value ? 'secondary' : 'outline'}
                      size="sm"
                      className="rounded-xl"
                      onClick={() => setLibrarySortMode(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3">
                {featuredActiveRecord ? (
                  <div className="grid gap-3 xl:grid-cols-[1.3fr_1fr]">
                    <div className="rounded-[20px] border border-white/7 bg-white/[0.022] p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                            <Award size={14} />
                            成长回顾
                          </div>
                          <div className="text-[15px] font-semibold text-foreground">{featuredActiveRecord.title}</div>
                          <div className="text-[12px] leading-6 text-muted-foreground">
                            已完成 {featuredActiveRecord.completedCount} 节，打通 {featuredActiveRecord.stageCompletedCount}/{Math.max(featuredActiveRecord.totalStageCount, 0)} 个阶段。
                            {featuredActiveRecord.currentNodeTitle ? ` 当前正在推进《${featuredActiveRecord.currentNodeTitle}》。` : ''}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/7 bg-white/[0.025] px-3 py-2 text-right">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">完成度</div>
                          <div className="mt-1 text-[22px] font-semibold text-foreground">{featuredActiveRecord.progressPercent}%</div>
                        </div>
                      </div>

                      {featuredActiveRecord.achievementBadges.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {featuredActiveRecord.achievementBadges.map((badge) => (
                            <span
                              key={badge.code}
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-[10px] font-medium',
                                getAchievementToneClass(badge.tone),
                              )}
                              title={badge.description}
                            >
                              {badge.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-[20px] border border-white/7 bg-white/[0.022] p-4">
                      <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                        <Milestone size={14} />
                        里程碑时间线
                      </div>
                      <div className="mt-3 space-y-3">
                        {featuredActiveRecord.recentMilestones.length ? (
                          featuredActiveRecord.recentMilestones.slice(0, 4).map((event, index) => (
                            <div key={event.id} className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <span className="mt-1 size-2 rounded-full bg-sky-300/85" />
                                {index < Math.min(featuredActiveRecord.recentMilestones.length, 4) - 1 ? (
                                  <span className="mt-1 h-full w-px bg-white/8" />
                                ) : null}
                              </div>
                              <div className="min-w-0 flex-1 pb-1">
                                <div className="text-[11px] font-medium text-foreground">{event.title}</div>
                                <div className="mt-0.5 text-[10px] leading-5 text-muted-foreground">{event.detail}</div>
                                <div className="mt-0.5 text-[10px] text-muted-foreground/80">{formatMilestoneTime(event.createdAt)}</div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-[12px] leading-6 text-muted-foreground">
                            这门课刚刚开始，等你拿下第一小关后，这里就会开始记录真正的成长轨迹。
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeLibraryRecords.length ? (
                  activeLibraryRecords.slice(0, 6).map((record) => (
                    <LibraryRecordRow
                      key={record.id}
                      record={record}
                      active={record.id === activeRecordId}
                      onOpen={() => void handleOpenRecord(record.id)}
                      onDelete={() => void handleDeleteRecord(record.id, record.title)}
                      onOpenSource={() => {
                        if (!record.sourceUrl) return
                        void window.desktopAPI.openExternal(record.sourceUrl)
                      }}
                      onRevealPackage={() => {
                        const targetPath = record.packagePath || record.importedCoursePath
                        if (!targetPath) return
                        void window.desktopAPI.showItem(targetPath)
                      }}
                    />
                  ))
                ) : (
                  <div className="rounded-[18px] border border-white/6 bg-white/[0.015] px-4 py-3 text-[13px] leading-6 text-muted-foreground">
                    {libraryQuery.trim() ? '没有匹配到正在推进的课程。' : '还没有任何正在推进的课程。先从上面的 BV 提炼开始也可以。'}
                  </div>
                )}

                {archivedLibraryRecords.length ? (
                  <div className="space-y-3 rounded-[22px] border border-emerald-500/10 bg-[linear-gradient(180deg,rgba(28,31,29,0.96),rgba(22,24,23,0.96))] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                          <GraduationCap size={14} />
                          归档陈列架
                        </div>
                        <div className="text-[12px] leading-5 text-muted-foreground">
                          这些课程已经完整学完，可以把它们当作你长期积累下来的知识资产。
                        </div>
                      </div>
                      <Badge variant="outline" className="border-emerald-500/14 bg-emerald-500/[0.08] text-emerald-100">
                        {archivedLibraryRecords.length} 门已征服
                      </Badge>
                    </div>

                    <div className="grid gap-2 md:grid-cols-5">
                      <div className="rounded-2xl border border-white/7 bg-white/[0.02] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">课程</div>
                        <div className="mt-1 text-[18px] font-semibold text-foreground">{archiveOverview.totalCourses}</div>
                      </div>
                      <div className="rounded-2xl border border-white/7 bg-white/[0.02] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">阶段</div>
                        <div className="mt-1 text-[18px] font-semibold text-foreground">{archiveOverview.totalStages}</div>
                      </div>
                      <div className="rounded-2xl border border-white/7 bg-white/[0.02] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">徽章</div>
                        <div className="mt-1 text-[18px] font-semibold text-foreground">{archiveOverview.totalBadges}</div>
                      </div>
                      <div className="rounded-2xl border border-white/7 bg-white/[0.02] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">编程类</div>
                        <div className="mt-1 text-[18px] font-semibold text-foreground">{archiveOverview.codingCourses}</div>
                      </div>
                      <div className="rounded-2xl border border-white/7 bg-white/[0.02] px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">医学类</div>
                        <div className="mt-1 text-[18px] font-semibold text-foreground">{archiveOverview.medicalCourses}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {([
                        ['all', '全部'],
                        ['recent', '最近结课'],
                        ['coding', '编程类'],
                        ['medical', '医学类'],
                        ['highlighted', '徽章丰富'],
                      ] as const).map(([value, label]) => (
                        <Button
                          key={value}
                          type="button"
                          size="sm"
                          variant={archiveShelfFilter === value ? 'secondary' : 'outline'}
                          className="rounded-xl"
                          onClick={() => setArchiveShelfFilter(value)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>

                    <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
                      <div className="rounded-[20px] border border-white/7 bg-white/[0.02] p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                              <Milestone size={13} />
                              最近 7 天推进
                            </div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                              这里会把近期学习里程碑压缩成一条轻量轨迹，方便回看最近是不是保持住了节奏。
                            </div>
                          </div>
                          <Badge variant="outline" className="border-white/8 bg-white/[0.03] text-foreground/80">
                            {archiveWeeklyActivity.reduce((sum, item) => sum + item.count, 0)} 次推进
                          </Badge>
                        </div>

                        <div className="mt-4 grid grid-cols-7 gap-2">
                          {archiveWeeklyActivity.map((item) => {
                            const barHeight = `${Math.max(16, Math.round((item.count / archiveActivityPeak) * 68))}px`
                            return (
                              <div key={item.dayStart} className="flex flex-col items-center gap-2">
                                <div
                                  className={cn(
                                    'flex h-[84px] w-full items-end justify-center rounded-[16px] border px-2 py-2 transition',
                                    item.isToday
                                      ? 'border-sky-400/20 bg-sky-400/[0.08]'
                                      : 'border-white/6 bg-white/[0.018]',
                                  )}
                                  title={`${item.dateLabel} · ${item.count} 次推进`}
                                >
                                  <div
                                    className={cn(
                                      'w-full rounded-full transition-all',
                                      item.count > 0
                                        ? item.isToday
                                          ? 'bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.18)]'
                                          : 'bg-white/75'
                                        : 'bg-white/[0.06]',
                                    )}
                                    style={{ height: barHeight }}
                                  />
                                </div>
                                <div className="text-[10px] text-muted-foreground">{item.label}</div>
                                <div className="text-[10px] font-medium text-foreground/85">{item.count}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      <div className="rounded-[20px] border border-white/7 bg-white/[0.02] p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                              <ArchiveRestore size={13} />
                              最近结课时间线
                            </div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                              最近完整征服的课程会优先出现在这里，方便回顾这段时间沉淀下来的成果。
                            </div>
                          </div>
                          <Badge variant="outline" className="border-emerald-500/14 bg-emerald-500/[0.08] text-emerald-100">
                            {archiveRecentCompletions.length} 门
                          </Badge>
                        </div>

                        <div className="mt-4 space-y-2.5">
                          {archiveRecentCompletions.length ? (
                            archiveRecentCompletions.map((item) => (
                              <div
                                key={item.id}
                                className="rounded-[16px] border border-white/6 bg-black/10 px-3 py-2.5"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-[12px] font-medium text-foreground">{item.title}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                      <span>{item.dateLabel}</span>
                                      <span>{item.stageCount} 个阶段</span>
                                      <span>{item.badgeCount} 枚徽章</span>
                                      <span>
                                        {item.domain === 'coding'
                                          ? '编程类'
                                          : item.domain === 'medical'
                                            ? '医学类'
                                            : '通用类'}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="size-2 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.42)]" />
                                </div>
                                <div className="mt-2 text-[11px] leading-5 text-foreground/75">{item.milestoneTitle}</div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-[16px] border border-white/6 bg-white/[0.018] px-3 py-3 text-[11px] leading-5 text-muted-foreground">
                              还没有新的结课记录，等下一门课程归档后，这里会自动长出来。
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {filteredArchivedShelfRecords.slice(0, 6).map((record) => (
                        <ArchivedCourseTile
                          key={record.id}
                          record={record}
                          active={record.id === activeRecordId}
                          onOpen={() => void handleOpenRecord(record.id)}
                          onRevealPackage={() => {
                            const targetPath = record.packagePath || record.importedCoursePath
                            if (!targetPath) return
                            void window.desktopAPI.showItem(targetPath)
                          }}
                        />
                      ))}
                    </div>

                    {filteredArchivedShelfRecords.length === 0 ? (
                      <div className="rounded-2xl border border-white/6 bg-white/[0.018] px-4 py-3 text-[12px] leading-6 text-muted-foreground">
                        当前筛选条件下还没有匹配到已归档课程。
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </WorkspaceShell>
    )
  }

  return (
    <WorkspaceShell
      eyebrow="设置"
      title="教练与蒸馏引擎配置"
      description="设置不再用弹窗承接，而是进入右侧工作区。左栏只保留一个入口，真正的配置和保存动作都在这里完成。"
      windowFocused={windowFocused}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <SettingsBlock title="伴学教练 API">
          <Field label="API Base URL" icon={<Server size={14} />}>
            <Input value={settingsDraft.coach_api_base_url} onChange={(event) => setSettingsDraft((current) => ({ ...current, coach_api_base_url: event.target.value }))} />
          </Field>
          <Field label="API Key" icon={<KeyRound size={14} />}>
            <Input type="password" value={settingsDraft.coach_api_key} onChange={(event) => setSettingsDraft((current) => ({ ...current, coach_api_key: event.target.value }))} />
          </Field>
          <Field label="Model Name" icon={<Bot size={14} />}>
            <Input value={settingsDraft.coach_model} onChange={(event) => setSettingsDraft((current) => ({ ...current, coach_model: event.target.value }))} />
          </Field>
        </SettingsBlock>

        <SettingsBlock title="生肉炼丹引擎">
          <Field label="Distiller Base URL" icon={<Server size={14} />}>
            <Input value={settingsDraft.distiller_api_base_url} onChange={(event) => setSettingsDraft((current) => ({ ...current, distiller_api_base_url: event.target.value }))} />
          </Field>
          <Field label="Distiller API Key" icon={<FlaskConical size={14} />}>
            <Input type="password" value={settingsDraft.distiller_api_key} onChange={(event) => setSettingsDraft((current) => ({ ...current, distiller_api_key: event.target.value }))} />
          </Field>
          <Field label="Distiller Model" icon={<FlaskConical size={14} />}>
            <Input value={settingsDraft.distiller_model} onChange={(event) => setSettingsDraft((current) => ({ ...current, distiller_model: event.target.value }))} />
          </Field>
        </SettingsBlock>

        <SettingsBlock title="音频转写引擎">
          <div className="grid gap-3">
            <div className="text-[12px] font-medium text-muted-foreground">当前方案</div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={settingsDraft.transcription_provider === 'local_sensevoice' ? 'default' : 'outline'}
                className="justify-start rounded-xl"
                onClick={() => setSettingsDraft((current) => ({ ...current, transcription_provider: 'local_sensevoice' }))}
              >
                <AudioLines size={14} />
                本地 SenseVoice
              </Button>
              <Button
                variant={settingsDraft.transcription_provider === 'groq' ? 'default' : 'outline'}
                className="justify-start rounded-xl"
                onClick={() => setSettingsDraft((current) => ({ ...current, transcription_provider: 'groq' }))}
              >
                <AudioLines size={14} />
                Groq Whisper
              </Button>
            </div>
          </div>

          {settingsDraft.transcription_provider === 'local_sensevoice' ? (
            <>
              <Field label="本地引擎目录" icon={<FolderOpen size={14} />}>
                <Input
                  value={settingsDraft.local_transcription_root}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, local_transcription_root: event.target.value }))}
                  placeholder="例如 C:\\Users\\Yu\\AI\\Cuda"
                />
              </Field>
              <Field label="Python 路径（可留空自动探测）" icon={<Server size={14} />}>
                <Input
                  value={settingsDraft.local_transcription_python}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, local_transcription_python: event.target.value }))}
                  placeholder="例如 C:\\Users\\Yu\\AI\\Cuda\\.venv\\Scripts\\python.exe"
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="模型 ID" icon={<AudioLines size={14} />}>
                  <Input
                    value={settingsDraft.local_transcription_model_id}
                    onChange={(event) => setSettingsDraft((current) => ({ ...current, local_transcription_model_id: event.target.value }))}
                    placeholder="iic/SenseVoiceSmall"
                  />
                </Field>
                <Field label="Device" icon={<Server size={14} />}>
                  <Input
                    value={settingsDraft.local_transcription_device}
                    onChange={(event) => setSettingsDraft((current) => ({ ...current, local_transcription_device: event.target.value }))}
                    placeholder="cuda:0"
                  />
                </Field>
                <Field label="Language" icon={<AudioLines size={14} />}>
                  <Input
                    value={settingsDraft.local_transcription_language}
                    onChange={(event) => setSettingsDraft((current) => ({ ...current, local_transcription_language: event.target.value }))}
                    placeholder="zh"
                  />
                </Field>
              </div>
            </>
          ) : (
            <>
              <Field label="Groq API Key" icon={<AudioLines size={14} />}>
                <Input type="password" value={settingsDraft.groq_api_key} onChange={(event) => setSettingsDraft((current) => ({ ...current, groq_api_key: event.target.value }))} />
              </Field>
              <Field label="Transcription Model" icon={<AudioLines size={14} />}>
                <Input value={settingsDraft.groq_transcription_model} onChange={(event) => setSettingsDraft((current) => ({ ...current, groq_transcription_model: event.target.value }))} />
              </Field>
            </>
          )}
        </SettingsBlock>

        <SettingsBlock title="B 站凭据">
          <Field label="SESSDATA" icon={<Cookie size={14} />}>
            <Input type="password" value={settingsDraft.sessdata} onChange={(event) => setSettingsDraft((current) => ({ ...current, sessdata: event.target.value }))} />
          </Field>
        </SettingsBlock>

        <SettingsBlock title="Obsidian 联动">
          <Field label="Vault 路径" icon={<FolderOpen size={14} />}>
            <Input
              value={settingsDraft.obsidian_vault_path}
              onChange={(event) => setSettingsDraft((current) => ({ ...current, obsidian_vault_path: event.target.value }))}
              placeholder="选择你的 Obsidian Vault 文件夹"
            />
          </Field>
          <Field label="导出子目录" icon={<LibraryBig size={14} />}>
            <Input
              value={settingsDraft.obsidian_export_folder}
              onChange={(event) => setSettingsDraft((current) => ({ ...current, obsidian_export_folder: event.target.value }))}
              placeholder="例如 视界专注"
            />
          </Field>
          <div className="rounded-[18px] border border-white/6 bg-white/[0.02] px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[13px] font-semibold text-foreground">自动同步进度到 Obsidian</div>
                <div className="text-[12px] leading-5 text-muted-foreground">
                  开启后，每次学习节点推进、完成或失败状态变化，都会在后台防抖回写到 Vault。
                </div>
              </div>
              <Button
                type="button"
                variant={settingsDraft.obsidian_auto_sync ? 'secondary' : 'outline'}
                className="rounded-xl"
                onClick={() => setSettingsDraft((current) => ({ ...current, obsidian_auto_sync: !current.obsidian_auto_sync }))}
              >
                {settingsDraft.obsidian_auto_sync ? '已开启' : '已关闭'}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => void handlePickObsidianVault()}>
              <FolderOpen size={14} />
              选择 Vault
            </Button>
            {settingsDraft.obsidian_vault_path ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => void window.desktopAPI.openPath(settingsDraft.obsidian_vault_path)}
              >
                <Link2 size={14} />
                打开 Vault
              </Button>
            ) : null}
          </div>
        </SettingsBlock>

        {settingsError ? (
          <div className="rounded-[20px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground xl:col-span-2">
            {settingsError}
          </div>
        ) : null}

        <div className="flex justify-end xl:col-span-2">
          <Button className="rounded-xl" onClick={() => void handleSaveSettings()}>
            <Settings2 size={14} />
            保存配置
          </Button>
        </div>
      </div>
    </WorkspaceShell>
  )
}

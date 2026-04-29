import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AudioLines,
  ArchiveRestore,
  Award,
  Cookie,
  Clipboard,
  FileUp,
  FileVideo,
  FolderOpen,
  GraduationCap,
  Link2,
  Milestone,
  PackageOpen,
  RefreshCcw,
  Search,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { CoachPane } from '@/components/CoachPane'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  DEFAULT_LOCAL_TRANSCRIPTION_DEVICE,
  DEFAULT_LOCAL_TRANSCRIPTION_LANGUAGE,
  DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID,
  DEFAULT_RESOURCE_MODE,
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
type MaterialSourceMode = 'bilibili' | 'local_media'
type MaterialInventory = Awaited<ReturnType<typeof window.desktopAPI.listMaterialPackages>>

const DISTILL_STAGE_ORDER = [
  { id: 'metadata', label: '解析视频' },
  { id: 'subtitle', label: '字幕准备' },
  { id: 'audio', label: '音频补全' },
  { id: 'chunking', label: '文本切片' },
  { id: 'chunk_distilling', label: '整理分片' },
  { id: 'batch_reducing', label: '批次归并' },
  { id: 'synthesizing', label: '写入材料' },
  { id: 'cache', label: '缓存直出' },
  { id: 'injecting', label: '写入完成' },
  { id: 'complete', label: '完成' },
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
    case 'material_package':
      return '原材料包'
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
    tts_provider: runtimeSettings?.tts_provider || 'none',
    minimax_api_key: runtimeSettings?.minimax_api_key || '',
    minimax_tts_endpoint: runtimeSettings?.minimax_tts_endpoint || 'https://api.minimaxi.com/v1/t2a_v2',
    minimax_tts_model: runtimeSettings?.minimax_tts_model || 'speech-2.8-hd',
    minimax_tts_voice_id: runtimeSettings?.minimax_tts_voice_id || '',
    minimax_tts_speed: runtimeSettings?.minimax_tts_speed ?? 1,
    minimax_tts_volume: runtimeSettings?.minimax_tts_volume ?? 1,
    minimax_tts_pitch: runtimeSettings?.minimax_tts_pitch ?? 0,
    mimo_api_key: runtimeSettings?.mimo_api_key || '',
    mimo_tts_endpoint: runtimeSettings?.mimo_tts_endpoint || 'https://api.xiaomimimo.com/v1/chat/completions',
    mimo_tts_model: runtimeSettings?.mimo_tts_model || 'mimo-v2.5-tts',
    mimo_tts_voice_id: runtimeSettings?.mimo_tts_voice_id || '茉莉',
    mimo_tts_style_prompt: runtimeSettings?.mimo_tts_style_prompt || '用清晰、年轻、温和的中文女声朗读，语速适中，像耐心老师讲课。',
    transcription_provider: runtimeSettings?.transcription_provider || DEFAULT_TRANSCRIPTION_PROVIDER,
    local_transcription_root: runtimeSettings?.local_transcription_root || '',
    local_transcription_python: runtimeSettings?.local_transcription_python || '',
    local_transcription_model_id: runtimeSettings?.local_transcription_model_id || DEFAULT_LOCAL_TRANSCRIPTION_MODEL_ID,
    local_transcription_device: runtimeSettings?.local_transcription_device || DEFAULT_LOCAL_TRANSCRIPTION_DEVICE,
    local_transcription_language: runtimeSettings?.local_transcription_language || DEFAULT_LOCAL_TRANSCRIPTION_LANGUAGE,
    resource_mode: runtimeSettings?.resource_mode || DEFAULT_RESOURCE_MODE,
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

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`
  return String(Math.round(value))
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
      return 'border-white/[0.07] bg-[#232323] text-foreground/85'
  }
}

function getMilestoneToneClass(kind: LearningRecordSummary['recentMilestones'][number]['kind']) {
  switch (kind) {
    case 'course_complete':
      return 'border-emerald-400/16 bg-emerald-400/[0.08] text-emerald-100'
    case 'stage_complete':
      return 'border-sky-400/16 bg-sky-400/[0.08] text-sky-100'
    default:
      return 'border-white/[0.07] bg-[#232323] text-foreground/82'
  }
}

function getMilestoneShortLabel(kind: LearningRecordSummary['recentMilestones'][number]['kind']) {
  switch (kind) {
    case 'course_complete':
      return '结课'
    case 'stage_complete':
      return '打通'
    default:
      return '通过'
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
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  windowFocused: boolean
}) {
  return (
    <section className="flex min-h-0 flex-1">
      <Card className={cn('work-surface relative flex min-h-0 w-full flex-col overflow-hidden rounded-l-[22px] rounded-r-none border-0 shadow-[-14px_0_30px_rgba(0,0,0,0.14)] transition-colors duration-200', windowFocused ? 'bg-[#171717]' : 'bg-[#151515]')}>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(118deg,rgba(56,189,248,0.07),transparent_34%),linear-gradient(244deg,rgba(251,191,36,0.045),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0)_22%)]" />
        <div className="relative flex items-start justify-between gap-4 pb-1.5 pl-6 pr-5 pt-3.5">
          <div className="space-y-1.5">
            {eyebrow ? <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-sky-100/52">{eyebrow}</div> : null}
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground">{title}</h2>
            {description ? <p className="max-w-3xl text-[12px] leading-6 text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        <div className="subtle-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </Card>
    </section>
  )
}

function Field({
  label,
  icon,
  className,
  children,
}: {
  label: string
  icon: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <label className={cn('grid gap-1.5', className)}>
      <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}

function SettingsBlock({
  title,
  className,
  children,
}: {
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-[20px] border border-white/[0.075] bg-[linear-gradient(180deg,rgba(32,32,32,0.88),rgba(24,24,24,0.96))] p-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.1)]', className)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,rgba(125,211,252,0.0),rgba(125,211,252,0.38),rgba(251,191,36,0.22),rgba(125,211,252,0.0))]" />
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[12px] font-semibold text-foreground">{title}</div>
        <div className="h-1.5 w-8 rounded-full bg-white/10" />
      </div>
      <div className="grid gap-3">{children}</div>
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
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group w-full rounded-[22px] border p-4 text-left transition',
        active
          ? 'border-sky-300/12 bg-[linear-gradient(180deg,rgba(29,38,43,0.72),rgba(24,25,26,0.94))]'
          : record.isArchived
            ? 'border-emerald-500/12 bg-[linear-gradient(180deg,rgba(27,31,28,0.96),rgba(24,26,24,0.96))] hover:bg-[linear-gradient(180deg,rgba(29,34,30,0.98),rgba(24,28,25,0.98))]'
            : 'border-white/[0.075] bg-[linear-gradient(180deg,rgba(31,31,31,0.92),rgba(24,24,24,0.96))] hover:border-sky-300/10 hover:bg-[linear-gradient(180deg,rgba(33,37,39,0.94),rgba(24,25,26,0.98))]',
      )}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-xl border border-sky-300/12 bg-sky-300/[0.06] text-sky-100">
              <Award size={13} />
            </div>
            <div className="truncate text-[14px] font-semibold text-foreground">{record.title}</div>
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

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span>已完成 {record.completedCount} 节</span>
            {record.totalStageCount > 0 ? (
              <span>
                阶段 {record.stageCompletedCount}/{record.totalStageCount}
              </span>
            ) : null}
            <span>{record.sessionCount} 个小节有记录</span>
          </div>

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

          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Progress value={record.isArchived ? 100 : record.progressPercent} className="h-1.5 bg-white/6" />
            </div>
            <span className="text-[10px] text-muted-foreground">{record.isArchived ? '100%' : `${record.progressPercent}%`}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-3">
          <div className="rounded-2xl border border-white/7 bg-white/[0.025] px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">完成度</div>
            <div className="mt-1 text-[20px] font-semibold text-foreground">
              {record.isArchived ? 100 : record.progressPercent}%
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
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

          <div className="text-[11px] leading-5 text-emerald-100/78">
            {record.recentMilestones[0]?.title ?? '这门课已经沉淀为长期知识资产。'}
          </div>

          <div className="rounded-2xl border border-white/6 bg-black/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-emerald-100/55">
              <span>完成度</span>
              <span>100%</span>
            </div>
            <Progress value={100} className="mt-2 h-1 bg-white/6" />
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
  const [ttsTestRunning, setTtsTestRunning] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySortMode, setLibrarySortMode] = useState<LibrarySortMode>('recent')
  const [archiveShelfFilter, setArchiveShelfFilter] = useState<ArchiveShelfFilter>('all')
  const [libraryStructureRefreshing, setLibraryStructureRefreshing] = useState(false)
  const [materialSourceMode, setMaterialSourceMode] = useState<MaterialSourceMode>('bilibili')
  const [materialInventory, setMaterialInventory] = useState<MaterialInventory | null>(null)

  const courseData = useLearningStore((state) => state.courseData)
  const videoInput = useLearningStore((state) => state.videoInput)
  const setVideoInput = useLearningStore((state) => state.setVideoInput)
  const distillCourseFromVideo = useLearningStore((state) => state.distillCourseFromVideo)
  const distillRequestState = useLearningStore((state) => state.distillRequestState)
  const distillStatusMessage = useLearningStore((state) => state.distillStatusMessage)
  const distillProgressPercent = useLearningStore((state) => state.distillProgressPercent)
  const distillError = useLearningStore((state) => state.distillError)
  const distillOutlinePreview = useLearningStore((state) => state.distillOutlinePreview)
  const distillProgressSnapshot = useLearningStore((state) => state.distillProgressSnapshot)
  const lastMaterialResult = useLearningStore((state) => state.lastMaterialResult)
  const loadCourseFromText = useLearningStore((state) => state.loadCourseFromText)
  const libraryRecords = useLearningStore((state) => state.libraryRecords)
  const activeRecordId = useLearningStore((state) => state.activeRecordId)
  const openSavedRecord = useLearningStore((state) => state.openSavedRecord)
  const deleteSavedRecord = useLearningStore((state) => state.deleteSavedRecord)
  const refreshLibrary = useLearningStore((state) => state.refreshLibrary)
  const restoreLearningRecord = useLearningStore((state) => state.restoreLearningRecord)
  const setRuntimeSettings = useLearningStore((state) => state.setRuntimeSettings)
  const pushToast = useLearningStore((state) => state.pushToast)

  useEffect(() => {
    setSettingsDraft(buildInitialDraft(runtimeSettings))
    setSettingsError('')
  }, [runtimeSettings, view])

  useEffect(() => {
    if (view !== 'hub') return
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
  const visibleActiveLibraryRecords = useMemo(
    () => activeLibraryRecords.filter((record) => record.id !== featuredActiveRecord?.id),
    [activeLibraryRecords, featuredActiveRecord?.id],
  )
  const materialRootDir = useMemo(
    () => materialInventory?.rootDir || (runtimeSettings?.output_dir ? `${runtimeSettings.output_dir}\\materials` : '请先在设置中配置输出目录'),
    [materialInventory?.rootDir, runtimeSettings?.output_dir],
  )
  const coursePackageRootDir = useMemo(
    () => materialInventory?.coursePackageRootDir || (runtimeSettings?.output_dir ? `${runtimeSettings.output_dir}\\courses` : '请先在设置中配置输出目录'),
    [materialInventory?.coursePackageRootDir, runtimeSettings?.output_dir],
  )
  const codexPromptText = useMemo(() => {
    if (!lastMaterialResult?.materialPath) return ''
    const startHerePath = `${lastMaterialResult.materialPath}\\START_HERE.md`
    return [
      `请读取并执行这份视界专注材料包的 START_HERE.md：${startHerePath}`,
      '目标：生成可直接导入视界专注学习台的 Course Package JSON。',
      '要求：先设计教学大纲，再分批生成 lesson，最后 strict 打包；不要把字幕证据、原材料分析或制课过程写进学生端正文。',
    ].join('\n')
  }, [lastMaterialResult?.materialPath])
  const expectedFinalCoursePath = useMemo(
    () => lastMaterialResult?.materialPath ? `${lastMaterialResult.materialPath}\\course_draft\\final.course-package.json` : '',
    [lastMaterialResult?.materialPath],
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
    await distillCourseFromVideo({
      sourceKind: materialSourceMode,
      mediaPath: materialSourceMode === 'local_media' ? videoInput : undefined,
    })
    try {
      setMaterialInventory(await window.desktopAPI.listMaterialPackages())
    } catch {
      // The main task already reports failures through the progress state.
    }
  }

  const handlePickLocalMedia = async () => {
    const result = await window.desktopAPI.pickMediaFile()
    if (!result) return
    setMaterialSourceMode('local_media')
    setVideoInput(result.path)
    pushToast('已选择本地文件', result.name, 'success')
  }

  const handleCopyCodexPrompt = async () => {
    if (!codexPromptText) return
    try {
      await navigator.clipboard.writeText(codexPromptText)
      pushToast('提示词已复制', '新开 Codex 对话后直接粘贴即可。', 'success')
    } catch {
      pushToast('复制失败', '可以从原材料包里的 00_new_window_prompt.md 手动复制。', 'error')
    }
  }

  const handleImportGeneratedCourse = async () => {
    if (!expectedFinalCoursePath) return
    try {
      const result = await window.desktopAPI.readCoursePackage(expectedFinalCoursePath)
      await loadCourseFromText(result.text, result.path)
      await refreshLibrary()
      pushToast('课包已导入', '已经载入 Codex 输出的 final.course-package.json。', 'success')
      onRequestLearn()
    } catch (error) {
      pushToast(
        '还没有找到最终课包',
        error instanceof Error ? error.message : '请先让 Codex 完成 course_draft/final.course-package.json。',
        'error',
      )
    }
  }

  const handleSaveSettings = async () => {
    try {
      const next = await window.desktopAPI.saveSettings(settingsDraft)
      setRuntimeSettings(next)
      onRuntimeSettingsSaved(next)
      setSettingsError('')
      pushToast('设置已保存', '本地素材整理与学习台配置已更新', 'success')
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '保存设置失败')
    }
  }

  const handleTestTts = async () => {
    if (ttsTestRunning) return
    setTtsTestRunning(true)
    try {
      const next = await window.desktopAPI.saveSettings(settingsDraft)
      setRuntimeSettings(next)
      onRuntimeSettingsSaved(next)
      setSettingsError('')
      const result = await window.desktopAPI.synthesizeSpeech({
        text: '视界专注语音测试。现在会用当前设置朗读一小段课程内容。',
        nodeId: 'settings-tts-test',
      })
      await new Promise<void>((resolve, reject) => {
        const audio = new Audio(result.dataUrl)
        audio.onended = () => resolve()
        audio.onerror = () => reject(new Error('音频播放失败，请检查系统音频设置。'))
        void audio.play().catch(reject)
      })
      pushToast(
        '试听完成',
        result.provider === 'mimo'
          ? `MiMo 已返回音频，音色 ${result.voiceId || '默认'}。`
          : `MiniMax 已返回音频，今日本地估算剩余 ${result.usage.remainingCharacters}。`,
        'success',
      )
    } catch (error) {
      pushToast('试听失败', error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setTtsTestRunning(false)
    }
  }

  const handlePickObsidianVault = async () => {
    const targetPath = await window.desktopAPI.pickDirectory()
    if (!targetPath) return
    setSettingsDraft((current) => ({ ...current, obsidian_vault_path: targetPath }))
  }

  if (view === 'learn') {
    return <CoachPane />
  }

  if (view === 'hub') {
    return (
      <WorkspaceShell
        eyebrow="Courses"
        title="课程中心"
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
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-12">
            <Card className="overflow-hidden border-white/[0.075] bg-[linear-gradient(180deg,rgba(31,31,31,0.94),rgba(24,24,24,0.98))] shadow-[0_14px_32px_rgba(0,0,0,0.12)] lg:col-span-12">
              <CardContent className="space-y-3 p-3.5">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                  <WandSparkles size={14} />
                  课程制作工作台
                </div>

                <div className="grid gap-3 xl:grid-cols-[1.35fr_0.9fr]">
                  <div className="rounded-[22px] border border-sky-300/10 bg-[linear-gradient(180deg,rgba(28,38,43,0.64),rgba(24,25,26,0.96))] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                        <WandSparkles size={14} />
                        原材料生成
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={materialSourceMode === 'bilibili' ? 'secondary' : 'outline'}
                          className="rounded-xl"
                          onClick={() => setMaterialSourceMode('bilibili')}
                          disabled={distillRequestState === 'loading'}
                        >
                          <Link2 size={13} />
                          B 站
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={materialSourceMode === 'local_media' ? 'secondary' : 'outline'}
                          className="rounded-xl"
                          onClick={() => void handlePickLocalMedia()}
                          disabled={distillRequestState === 'loading'}
                        >
                          <FileVideo size={13} />
                          本地文件
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                      <Field
                        label={materialSourceMode === 'local_media' ? '本地视频/音频文件' : 'B 站链接或 BV 号'}
                        icon={materialSourceMode === 'local_media' ? <FileVideo size={13} /> : <Link2 size={13} />}
                      >
                        <Input
                          value={videoInput}
                          onChange={(event) => setVideoInput(event.target.value)}
                          placeholder={materialSourceMode === 'local_media' ? '选择或粘贴本地音视频文件路径' : '例如 BV17ykEBWEjv 或 https://www.bilibili.com/video/...'}
                          disabled={distillRequestState === 'loading'}
                        />
                      </Field>
                      <div className="grid content-end gap-2 sm:grid-cols-2 md:grid-cols-1">
                        {materialSourceMode === 'local_media' ? (
                          <Button variant="outline" className="rounded-xl" onClick={() => void handlePickLocalMedia()} disabled={distillRequestState === 'loading'}>
                            <FolderOpen size={14} />
                            选择文件
                          </Button>
                        ) : null}
                        <Button className="rounded-xl" onClick={() => void handleDistillCourse()} disabled={distillRequestState === 'loading' || !videoInput.trim()}>
                          <WandSparkles size={14} />
                          {distillRequestState === 'loading' ? '正在生成' : '开始生成'}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 md:grid-cols-4">
                      {DISTILL_STAGE_ORDER.slice(0, 7).map((item, index) => {
                        const isActive = distillProgressSnapshot?.stage === item.id
                        const isDone = distillRequestState !== 'loading'
                          ? false
                          : index < currentDistillStageIndex
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              'relative overflow-hidden rounded-2xl border px-3 py-2 text-[10px] transition',
                              isActive
                                ? 'border-sky-300/30 bg-sky-300/[0.11] text-sky-50'
                                : isDone
                                  ? 'border-emerald-300/18 bg-emerald-300/[0.08] text-emerald-50'
                                  : 'border-white/6 bg-black/10 text-muted-foreground',
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span>{item.label}</span>
                              <span className={cn('size-1.5 rounded-full bg-white/18', isActive && 'bg-sky-200', isDone && 'bg-emerald-200')} />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-3 rounded-[18px] border border-white/7 bg-black/10 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-foreground/88">
                            {distillRequestState === 'loading'
                              ? distillProgressSnapshot?.stageLabel || '正在处理'
                              : lastMaterialResult?.materialPath
                                ? '最近一次原材料包已就绪'
                                : '等待开始'}
                          </div>
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                            {distillRequestState === 'loading'
                              ? distillStatusMessage || '正在抓取字幕、转写缺失音频、清洗文本并写入 Codex 原材料包。'
                              : lastMaterialResult?.materialPath || '适合长视频后台慢跑，完成后会在这里显示材料包路径。'}
                          </div>
                        </div>
                        <Badge variant="outline">{Math.max(0, Math.min(100, Math.round(distillProgressPercent || 0)))}%</Badge>
                      </div>
                      <Progress value={distillRequestState === 'loading' ? Math.max(4, Math.min(100, distillProgressPercent || 4)) : lastMaterialResult?.materialPath ? 100 : 0} className="mt-3 h-1.5 bg-white/7" />
                    </div>
                  </div>

                  <div className="min-h-0 rounded-[22px] border border-white/[0.075] bg-[#1a1a1a] p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                        <ArchiveRestore size={14} />
                        制作记录
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-lg px-2 text-[10px]"
                          onClick={() => runtimeSettings?.output_dir ? void window.desktopAPI.openPath(materialRootDir) : undefined}
                          title={materialRootDir}
                        >
                          <FolderOpen size={12} />
                          材料
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-lg px-2 text-[10px]"
                          onClick={() => runtimeSettings?.output_dir ? void window.desktopAPI.openPath(coursePackageRootDir) : undefined}
                          title={coursePackageRootDir}
                        >
                          <PackageOpen size={12} />
                          课包
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-lg"
                          onClick={async () => {
                            try {
                              setMaterialInventory(await window.desktopAPI.listMaterialPackages())
                            } catch {
                              pushToast('刷新失败', '无法读取原材料目录。', 'error')
                            }
                          }}
                        >
                          <RefreshCcw size={13} />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>{materialInventory?.records.length ?? 0} 份材料</span>
                      <span className="truncate">{coursePackageRootDir}</span>
                    </div>

                    <div className="subtle-scrollbar mt-3 grid max-h-[390px] gap-2 overflow-y-auto pr-1">
                      {materialInventory?.records.length ? (
                        materialInventory.records.map((record) => (
                          <div key={record.path} className="rounded-[18px] border border-white/6 bg-white/[0.018] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12px] font-medium text-foreground">{record.title}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                  {record.sourceId ? <span>{record.sourceId}</span> : null}
                                  <span>{record.blockCount} blocks</span>
                                  <span>{formatCompactNumber(record.textLength)} 字</span>
                                  <span>{formatRelativeTime(record.updatedAt)}</span>
                                </div>
                              </div>
                              <Badge
                                variant="outline"
                                className={record.importReadyCourseExists ? 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100' : ''}
                              >
                                {record.importReadyCourseExists ? '可导入' : '待制课'}
                              </Badge>
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2">
                              <Button variant="outline" size="sm" className="rounded-xl px-2" onClick={() => void window.desktopAPI.openPath(record.path)}>
                                <FolderOpen size={13} />
                                材料
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-xl px-2"
                                onClick={async () => {
                                  const text = [
                                    `请读取并执行这份视界专注材料包的 START_HERE.md：${record.startHerePath}`,
                                    '目标：生成可直接导入视界专注学习台的 Course Package JSON。',
                                    '要求：先设计教学大纲，再分批生成 lesson，最后 strict 打包；不要把字幕证据、原材料分析或制课过程写进学生端正文。',
                                  ].join('\n')
                                  try {
                                    await navigator.clipboard.writeText(text)
                                    pushToast('提示词已复制', record.title, 'success')
                                  } catch {
                                    pushToast('复制失败', '请打开材料包中的提示文件手动复制。', 'error')
                                  }
                                }}
                              >
                                <Clipboard size={13} />
                                提示
                              </Button>
                              <Button
                                size="sm"
                                className="rounded-xl px-2"
                                variant={record.importReadyCourseExists ? 'default' : 'outline'}
                                disabled={!record.importReadyCourseExists}
                                onClick={async () => {
                                  try {
                                    const result = await window.desktopAPI.readCoursePackage(record.importReadyCoursePath)
                                    await loadCourseFromText(result.text, result.path)
                                    await refreshLibrary()
                                    pushToast('课包已导入', record.title, 'success')
                                    onRequestLearn()
                                  } catch (error) {
                                    pushToast('导入失败', error instanceof Error ? error.message : '无法导入最终课包。', 'error')
                                  }
                                }}
                              >
                                <FileUp size={13} />
                                导入
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-[18px] border border-white/6 bg-white/[0.018] px-4 py-3 text-[12px] leading-6 text-muted-foreground">
                          还没有生成过原材料包。长视频可以直接在左侧启动，完成后会自动出现在这里。
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {distillRequestState === 'loading' ? (
                  <div className="space-y-3 rounded-[18px] border border-white/8 bg-[#1a1a1a] p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{distillProgressSnapshot?.stageLabel || '处理中'}</Badge>
                      <Badge variant="outline">{Math.max(0, Math.min(100, Math.round(distillProgressPercent)))}%</Badge>
                      {distillProgressSnapshot?.resumed ? <Badge variant="outline">断点续跑</Badge> : null}
                      {formatCacheHint(distillProgressSnapshot?.cacheHint) ? (
                        <Badge variant="outline">{formatCacheHint(distillProgressSnapshot?.cacheHint)}</Badge>
                      ) : null}
                    </div>

                    <Progress value={Math.max(4, Math.min(100, distillProgressPercent || 4))} className="h-1.5 bg-white/7" />

                    <div className="text-[12px] leading-5 text-muted-foreground">
                      {distillStatusMessage || '正在抓取字幕、转写缺失音频、清洗文本并写入 Codex 原材料包。'}
                    </div>

                    <div className="grid gap-2 md:grid-cols-5">
                      {DISTILL_STAGE_ORDER.map((item, index) => {
                        const isActive = distillProgressSnapshot?.stage === item.id
                        const isDone = index < currentDistillStageIndex
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              'rounded-2xl border px-3 py-2 text-[10px] transition',
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
                      <div className="grid gap-2 md:grid-cols-3">
                        <div className="rounded-2xl border border-white/6 bg-[#1f1f1f] px-3 py-2">
                          <div className="text-[10px] text-muted-foreground">音频补全</div>
                          <div className="mt-1 text-[14px] font-semibold text-foreground">
                            {distillProgressSnapshot.audioTotal > 0
                              ? `${distillProgressSnapshot.audioCompleted}/${distillProgressSnapshot.audioTotal}`
                              : '未启用'}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-[#1f1f1f] px-3 py-2">
                          <div className="text-[10px] text-muted-foreground">材料分片</div>
                          <div className="mt-1 text-[14px] font-semibold text-foreground">
                            {distillProgressSnapshot.chunkTotal > 0
                              ? `${distillProgressSnapshot.chunkCompleted}/${distillProgressSnapshot.chunkTotal}`
                              : '待开始'}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/6 bg-[#1f1f1f] px-3 py-2">
                          <div className="text-[10px] text-muted-foreground">批次归并</div>
                          <div className="mt-1 text-[14px] font-semibold text-foreground">
                            {distillProgressSnapshot.batchTotal > 0
                              ? `${distillProgressSnapshot.batchCompleted}/${distillProgressSnapshot.batchTotal}`
                              : '按需启用'}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {distillProgressSnapshot?.cacheHint === 'chunk_prefetch' && (distillProgressSnapshot.chunkTotal > 0 || distillProgressSnapshot.batchTotal > 0) ? (
                      <div className="rounded-2xl border border-white/6 bg-[#1c1c1c] px-3 py-2 text-[11px] text-muted-foreground">
                        已后台预热
                        {distillProgressSnapshot.chunkTotal > 0
                          ? ` ${distillProgressSnapshot.chunkCompleted}/${distillProgressSnapshot.chunkTotal} 个分片`
                          : ''}
                        {distillProgressSnapshot.chunkTotal > 0 && distillProgressSnapshot.batchTotal > 0 ? '，' : ''}
                        {distillProgressSnapshot.batchTotal > 0
                          ? `${distillProgressSnapshot.batchCompleted}/${distillProgressSnapshot.batchTotal} 个批次`
                          : ''}
                        。
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {distillOutlinePreview ? (
                  <div className="rounded-[18px] border border-white/8 bg-[#1a1a1a] p-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">材料骨架已生成</Badge>
                      <Badge variant="outline">{distillOutlinePreview.pageCount} 个分P</Badge>
                      <Badge variant="outline">约 {distillOutlinePreview.durationMinutes} 分钟</Badge>
                    </div>
                    <div className="mt-2 text-[13px] font-semibold text-foreground">{distillOutlinePreview.title}</div>
                    <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{distillOutlinePreview.note}</div>
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {distillOutlinePreview.chapters.slice(0, 6).map((chapter) => (
                        <div key={chapter.id} className="rounded-2xl border border-white/6 bg-[#1f1f1f] px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="truncate text-[12px] font-medium text-foreground/92">{chapter.title}</div>
                            <div className="shrink-0 text-[10px] text-muted-foreground">{chapter.lessonCount} 节</div>
                          </div>
                          {chapter.lessonTitles.length ? (
                            <div className="mt-1 line-clamp-2 text-[10px] leading-5 text-muted-foreground">
                              {chapter.lessonTitles.join(' · ')}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {lastMaterialResult?.materialPath ? (
                  <div className="grid gap-2 rounded-[18px] border border-emerald-300/12 bg-[linear-gradient(180deg,rgba(28,42,35,0.58),rgba(24,25,26,0.94))] p-3.5 lg:grid-cols-[1fr_auto]">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100">
                          原材料包已就绪
                        </Badge>
                        <Badge variant="outline">{lastMaterialResult.chunkCount} 个 blocks</Badge>
                        <Badge variant="outline">{lastMaterialResult.textSourceType || '本地材料'}</Badge>
                      </div>
                      <div className="truncate text-[13px] font-semibold text-foreground">{lastMaterialResult.title}</div>
                      <div className="truncate rounded-2xl border border-white/6 bg-black/10 px-3 py-2 text-[11px] text-muted-foreground">
                        {lastMaterialResult.materialPath}
                      </div>
                      <div className="text-[11px] leading-5 text-muted-foreground">
                        下一步新开 Codex 对话，粘贴短提示即可。Codex 完成 strict 打包后，课包会同时出现在材料包和统一课包目录。
                      </div>
                      <div className="truncate rounded-2xl border border-white/6 bg-black/10 px-3 py-2 text-[11px] text-muted-foreground">
                        预期课包：{expectedFinalCoursePath}
                      </div>
                    </div>
                    <div className="grid content-start gap-2 sm:grid-cols-3 lg:grid-cols-1">
                      <Button variant="outline" className="rounded-xl" onClick={() => void window.desktopAPI.openPath(lastMaterialResult.materialPath!)}>
                        <FolderOpen size={14} />
                        打开材料包
                      </Button>
                      <Button variant="outline" className="rounded-xl" onClick={() => void window.desktopAPI.showItem(lastMaterialResult.materialPath!)}>
                        <PackageOpen size={14} />
                        定位文件夹
                      </Button>
                      <Button className="rounded-xl" onClick={() => void handleCopyCodexPrompt()}>
                        <Clipboard size={14} />
                        复制制课提示
                      </Button>
                      <Button variant="outline" className="rounded-xl" onClick={() => void handleImportGeneratedCourse()}>
                        <FileUp size={14} />
                        导入最终课包
                      </Button>
                    </div>
                  </div>
                ) : null}

                {distillError ? (
                  <div className="rounded-[18px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                    {distillError}
                  </div>
                ) : null}
              </CardContent>
            </Card>

          </div>

          <Card className="overflow-hidden border-white/[0.075] bg-[linear-gradient(180deg,rgba(30,30,31,0.94),rgba(23,23,24,0.98))] shadow-[0_14px_32px_rgba(0,0,0,0.12)]">
            <CardContent className="space-y-3 p-3.5">
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
                  <div className="rounded-[22px] border border-sky-300/10 bg-[linear-gradient(180deg,rgba(29,38,43,0.68),rgba(24,25,26,0.92))] p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                            <Award size={14} />
                            当前课程
                          </div>
                          <div className="text-[15px] font-semibold text-foreground">{featuredActiveRecord.title}</div>
                          <div className="text-[12px] leading-6 text-muted-foreground">
                            已完成 {featuredActiveRecord.completedCount} 节。
                            {featuredActiveRecord.currentNodeTitle ? ` 当前正在推进《${featuredActiveRecord.currentNodeTitle}》。` : ''}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/7 bg-white/[0.025] px-3 py-2 text-right">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">完成度</div>
                          <div className="mt-1 text-[22px] font-semibold text-foreground">{featuredActiveRecord.progressPercent}%</div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">已完成</div>
                          <div className="mt-1 text-[16px] font-semibold text-foreground">{featuredActiveRecord.completedCount} 节</div>
                        </div>
                        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">阶段</div>
                          <div className="mt-1 text-[16px] font-semibold text-foreground">
                            {featuredActiveRecord.stageCompletedCount}/{Math.max(featuredActiveRecord.totalStageCount, 0)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">学习记录</div>
                          <div className="mt-1 text-[16px] font-semibold text-foreground">{featuredActiveRecord.sessionCount} 小节</div>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <Progress value={featuredActiveRecord.progressPercent} className="h-1.5 bg-white/6" />
                        </div>
                        <Button size="sm" className="rounded-xl" onClick={onRequestLearn}>
                          <Sparkles size={13} />
                          继续学习
                        </Button>
                      </div>
                  </div>
                ) : null}

                {visibleActiveLibraryRecords.length ? (
                  visibleActiveLibraryRecords.slice(0, 6).map((record) => (
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
                    {libraryQuery.trim()
                      ? '没有匹配到其他正在推进的课程。'
                      : featuredActiveRecord
                        ? '当前没有其他正在推进的课程。'
                        : '还没有任何正在推进的课程。先生成原材料包，再导入 Codex 做好的课包。'}
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
      eyebrow="Settings"
      title="设置"
      windowFocused={windowFocused}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-xl" disabled={ttsTestRunning} onClick={() => void handleTestTts()}>
            <AudioLines size={14} />
            {ttsTestRunning ? '试听中' : '试听语音'}
          </Button>
          <Button className="rounded-xl" onClick={() => void handleSaveSettings()}>
            <Settings2 size={14} />
            保存配置
          </Button>
        </div>
      }
    >
      <div className="grid items-start gap-3 lg:grid-cols-12">
        <SettingsBlock title="TTS 语音朗读" className="lg:col-span-7">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2 rounded-2xl border border-sky-300/10 bg-sky-300/[0.04] px-3 py-2 text-[11px] leading-5 text-sky-50/78">
              当前策略：小节级预热，只读正文，音频永久缓存。MiMo 适合限免测试，MiniMax 作为稳定备用。
            </div>
            <div className="grid gap-2 md:col-span-2">
              <div className="text-[10px] font-medium text-muted-foreground">朗读引擎</div>
              <div className="grid gap-2 md:grid-cols-3">
                <Button
                  type="button"
                  variant={settingsDraft.tts_provider === 'mimo' ? 'default' : 'outline'}
                  className="justify-start rounded-xl"
                  onClick={() => setSettingsDraft((current) => ({ ...current, tts_provider: 'mimo' }))}
                >
                  <AudioLines size={14} />
                  MiMo V2.5
                </Button>
                <Button
                  type="button"
                  variant={settingsDraft.tts_provider === 'minimax' ? 'default' : 'outline'}
                  className="justify-start rounded-xl"
                  onClick={() => setSettingsDraft((current) => ({ ...current, tts_provider: 'minimax' }))}
                >
                  <AudioLines size={14} />
                  MiniMax Speech 2.8
                </Button>
                <Button
                  type="button"
                  variant={settingsDraft.tts_provider === 'none' ? 'default' : 'outline'}
                  className="justify-start rounded-xl"
                  onClick={() => setSettingsDraft((current) => ({ ...current, tts_provider: 'none' }))}
                >
                  暂不启用
                </Button>
              </div>
            </div>

            <Field label="MiMo API Key" icon={<Server size={14} />} className="md:col-span-2">
              <Input
                type="password"
                value={settingsDraft.mimo_api_key}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, mimo_api_key: event.target.value }))}
                placeholder="小米 MiMo 开放平台 API Key"
              />
            </Field>
            <Field label="MiMo 音色" icon={<AudioLines size={14} />}>
              <Input
                value={settingsDraft.mimo_tts_voice_id}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, mimo_tts_voice_id: event.target.value }))}
                placeholder="茉莉"
              />
            </Field>
            <Field label="MiMo 模型" icon={<AudioLines size={14} />}>
              <Input
                value={settingsDraft.mimo_tts_model}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, mimo_tts_model: event.target.value }))}
                placeholder="mimo-v2.5-tts"
              />
            </Field>
            <Field label="MiMo 接口地址" icon={<Server size={14} />} className="md:col-span-2">
              <Input
                value={settingsDraft.mimo_tts_endpoint}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, mimo_tts_endpoint: event.target.value }))}
                placeholder="https://api.xiaomimimo.com/v1/chat/completions"
              />
            </Field>
            <Field label="MiMo 朗读风格" icon={<AudioLines size={14} />} className="md:col-span-2">
              <Input
                value={settingsDraft.mimo_tts_style_prompt}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, mimo_tts_style_prompt: event.target.value }))}
                placeholder="用清晰、年轻、温和的中文女声朗读，语速适中，像耐心老师讲课。"
              />
            </Field>

            <Field label="MiniMax API Key" icon={<Server size={14} />} className="md:col-span-2">
              <Input
                type="password"
                value={settingsDraft.minimax_api_key}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, minimax_api_key: event.target.value }))}
                placeholder="填入后才会在点击朗读时调用"
              />
            </Field>
            <Field label="Voice ID" icon={<AudioLines size={14} />}>
              <Input
                value={settingsDraft.minimax_tts_voice_id}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, minimax_tts_voice_id: event.target.value }))}
                placeholder="你选好的音色 voice_id"
              />
            </Field>
            <Field label="模型" icon={<AudioLines size={14} />}>
              <Input
                value={settingsDraft.minimax_tts_model}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, minimax_tts_model: event.target.value }))}
                placeholder="speech-2.8-hd"
              />
            </Field>
            <Field label="接口地址" icon={<Server size={14} />} className="md:col-span-2">
              <Input
                value={settingsDraft.minimax_tts_endpoint}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, minimax_tts_endpoint: event.target.value }))}
                placeholder="https://api.minimaxi.com/v1/t2a_v2"
              />
            </Field>
            <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
              <Field label="语速" icon={<AudioLines size={14} />}>
                <Input
                  type="number"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={settingsDraft.minimax_tts_speed}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, minimax_tts_speed: Number(event.target.value) }))}
                />
              </Field>
              <Field label="音量" icon={<AudioLines size={14} />}>
                <Input
                  type="number"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={settingsDraft.minimax_tts_volume}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, minimax_tts_volume: Number(event.target.value) }))}
                />
              </Field>
              <Field label="音高" icon={<AudioLines size={14} />}>
                <Input
                  type="number"
                  min="-12"
                  max="12"
                  step="1"
                  value={settingsDraft.minimax_tts_pitch}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, minimax_tts_pitch: Number(event.target.value) }))}
                />
              </Field>
            </div>
          </div>
        </SettingsBlock>

        <SettingsBlock title="Obsidian 同步" className="lg:col-span-5">
          <div className="grid gap-3">
            <Field label="Vault 路径" icon={<FolderOpen size={14} />}>
              <div className="flex gap-2">
                <Input
                  value={settingsDraft.obsidian_vault_path}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, obsidian_vault_path: event.target.value }))}
                  placeholder="选择你的 Obsidian Vault 文件夹"
                />
                <Button type="button" variant="outline" className="shrink-0 rounded-xl" onClick={() => void handlePickObsidianVault()}>
                  选择
                </Button>
              </div>
            </Field>
            <Field label="导出目录" icon={<FolderOpen size={14} />}>
              <Input
                value={settingsDraft.obsidian_export_folder}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, obsidian_export_folder: event.target.value }))}
                placeholder="视界专注"
              />
            </Field>
            <Button
              type="button"
              variant={settingsDraft.obsidian_auto_sync ? 'default' : 'outline'}
              className="justify-start rounded-xl"
              onClick={() => setSettingsDraft((current) => ({ ...current, obsidian_auto_sync: !current.obsidian_auto_sync }))}
            >
              <FolderOpen size={14} />
              {settingsDraft.obsidian_auto_sync ? '保存进度时同步：已预留' : '保存进度时同步：关闭'}
            </Button>
          </div>
        </SettingsBlock>

        <SettingsBlock title="后台资源模式" className="lg:col-span-12">
          <div className="grid gap-2 md:grid-cols-3">
            {[
              { id: 'fast', title: '快速制作' },
              { id: 'balanced', title: '均衡模式' },
              { id: 'background', title: '后台慢速' },
            ].map((mode) => (
              <Button
                key={mode.id}
                type="button"
                variant={settingsDraft.resource_mode === mode.id ? 'default' : 'outline'}
                className="h-10 justify-start rounded-xl px-4 text-left"
                onClick={() => setSettingsDraft((current) => ({ ...current, resource_mode: mode.id }))}
              >
                {mode.title}
              </Button>
            ))}
          </div>
        </SettingsBlock>

        <SettingsBlock title="音频转写引擎" className="lg:col-span-8">
          <div className="grid gap-3">
            <div className="text-[10px] font-medium text-muted-foreground">当前方案</div>
            <div className="grid gap-2">
              <Button
                variant={settingsDraft.transcription_provider === 'local_sensevoice' ? 'default' : 'outline'}
                className="justify-start rounded-xl"
                onClick={() => setSettingsDraft((current) => ({ ...current, transcription_provider: 'local_sensevoice' }))}
              >
                <AudioLines size={14} />
                本地 SenseVoice
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
              <Field label="本地引擎目录" icon={<FolderOpen size={14} />} className="md:col-span-2">
                <Input
                  value={settingsDraft.local_transcription_root}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, local_transcription_root: event.target.value }))}
                  placeholder="例如 C:\\Users\\Yu\\AI\\Cuda"
                />
              </Field>
              <Field label="Python 路径" icon={<Server size={14} />} className="md:col-span-2">
                <Input
                  value={settingsDraft.local_transcription_python}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, local_transcription_python: event.target.value }))}
                  placeholder="例如 C:\\Users\\Yu\\AI\\Cuda\\.venv\\Scripts\\python.exe"
                />
              </Field>
              <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
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
          </div>
        </SettingsBlock>

        <SettingsBlock title="B 站凭据" className="lg:col-span-4">
          <Field label="SESSDATA" icon={<Cookie size={14} />}>
            <Input type="password" value={settingsDraft.sessdata} onChange={(event) => setSettingsDraft((current) => ({ ...current, sessdata: event.target.value }))} />
          </Field>
        </SettingsBlock>

        {settingsError ? (
          <div className="rounded-[20px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground lg:col-span-12">
            {settingsError}
          </div>
        ) : null}
      </div>
    </WorkspaceShell>
  )
}

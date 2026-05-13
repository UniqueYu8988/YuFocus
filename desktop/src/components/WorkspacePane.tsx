import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AudioLines,
  ArchiveRestore,
  Award,
  Cookie,
  Clipboard,
  FileText,
  FileUp,
  FileVideo,
  FolderOpen,
  GraduationCap,
  Link2,
  LoaderCircle,
  Milestone,
  PackageOpen,
  Play,
  RefreshCcw,
  Search,
  Server,
  Sparkles,
  Trash2,
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
import archiveCurrentCourseIcon from '@/assets/archive-current-course.svg'
import archiveOtherCoursesIcon from '@/assets/archive-other-courses.svg'
import courseIcon from '@/assets/course-icon.svg'
import settingsBilibiliIcon from '@/assets/settings-bilibili.svg'
import settingsObsidianIcon from '@/assets/settings-obsidian.svg'
import settingsTranscriptionIcon from '@/assets/settings-transcription.svg'
import settingsTtsIcon from '@/assets/settings-tts.svg'
import settingsVideoSummaryIcon from '@/assets/settings-video-summary.svg'
import videoIcon from '@/assets/video-icon.svg'
import mimoPreviewBaihua from '@/assets/mimo-voice-previews/baihua.wav'
import mimoPreviewBingtang from '@/assets/mimo-voice-previews/bingtang.wav'
import mimoPreviewMoli from '@/assets/mimo-voice-previews/moli.wav'
import mimoPreviewSuda from '@/assets/mimo-voice-previews/suda.wav'

export type WorkspaceView = 'learn' | 'workbench' | 'archive' | 'settings'

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
type VideoSummaryResult = Awaited<ReturnType<typeof window.desktopAPI.runVideoSummary>>
type VideoSummaryInventory = Awaited<ReturnType<typeof window.desktopAPI.listVideoSummaries>>

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

const MIMO_TTS_PRESET_VOICES = [
  { id: '茉莉', previewUrl: mimoPreviewMoli },
  { id: '冰糖', previewUrl: mimoPreviewBingtang },
  { id: '苏打', previewUrl: mimoPreviewSuda },
  { id: '白桦', previewUrl: mimoPreviewBaihua },
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
    tts_provider: runtimeSettings?.tts_provider && runtimeSettings.tts_provider !== 'none' ? runtimeSettings.tts_provider : 'mimo',
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
    mimo_tts_style_prompt: runtimeSettings?.mimo_tts_style_prompt || '自然 清晰 语速适中',
    video_summary_provider: runtimeSettings?.video_summary_provider || 'mimo',
    video_summary_api_key: runtimeSettings?.video_summary_api_key || '',
    video_summary_base_url: runtimeSettings?.video_summary_base_url || 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions',
    video_summary_model: runtimeSettings?.video_summary_model || (runtimeSettings?.video_summary_provider === 'mimo' ? 'mimo-v2.5-pro' : 'MiniMax-M2'),
    video_summary_output_dir: runtimeSettings?.video_summary_output_dir || '',
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

function getParentPath(targetPath: string) {
  return targetPath.replace(/[\\/][^\\/]*$/u, '')
}

function getVideoSummaryProviderLabel(provider: string) {
  return provider === 'mimo' ? 'MiMo' : provider === 'minimax' ? 'MiniMax' : '本地'
}

function getVideoSummaryProviderClass(provider: string) {
  if (provider === 'mimo') return 'border-violet-300/20 bg-violet-400/[0.10] text-violet-100'
  if (provider === 'minimax') return 'border-sky-300/20 bg-sky-400/[0.10] text-sky-100'
  return 'border-white/7 bg-white/[0.02] text-muted-foreground'
}

function readCourseVisualMapFromText(text: string) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const courseVisualMap = parsed.course_visual_map
    if (!courseVisualMap || typeof courseVisualMap !== 'object') return null
    return courseVisualMap as Record<string, unknown>
  } catch {
    return null
  }
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
      <Card className={cn('work-surface relative flex min-h-0 w-full flex-col overflow-hidden rounded-l-[18px] rounded-r-none border border-r-0 border-white/[0.065] bg-[#101010] shadow-none transition-colors duration-200', !windowFocused && 'bg-[#101010]')}>
        <div className="relative mx-auto flex w-full max-w-5xl items-start justify-between gap-4 px-16 pb-7 pt-14">
          <div className="space-y-2">
            {eyebrow ? <div className="sr-only">{eyebrow}</div> : null}
            <h2 className="text-[26px] font-semibold tracking-tight text-foreground">{title}</h2>
            {description ? <p className="max-w-3xl text-[13px] leading-6 text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        <div className="subtle-scrollbar relative min-h-0 flex-1 overflow-y-auto px-16 pb-12">{children}</div>
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
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/86">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}

function SettingsBlock({
  title,
  icon,
  className,
  children,
}: {
  title: string
  icon?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
        {icon ? <img src={icon} alt="" className="size-4 opacity-90" /> : null}
        {title}
      </h3>
      <div className="grid gap-4 rounded-[10px] border border-white/[0.09] bg-[#1f1f1f] p-4">
        {children}
      </div>
    </section>
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
  const [ttsPreviewVoice, setTtsPreviewVoice] = useState<string | null>(null)
  const ttsTestAudioRef = useRef<HTMLAudioElement | null>(null)
  const settingsSaveTimerRef = useRef<number | null>(null)
  const settingsLastSavedJsonRef = useRef('')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySortMode, setLibrarySortMode] = useState<LibrarySortMode>('recent')
  const [archiveShelfFilter, setArchiveShelfFilter] = useState<ArchiveShelfFilter>('all')
  const [libraryStructureRefreshing, setLibraryStructureRefreshing] = useState(false)
  const [materialSourceMode, setMaterialSourceMode] = useState<MaterialSourceMode>('bilibili')
  const [materialInventory, setMaterialInventory] = useState<MaterialInventory | null>(null)
  const [summarySourceMode, setSummarySourceMode] = useState<MaterialSourceMode>('bilibili')
  const [summaryInput, setSummaryInput] = useState('')
  const [summaryRunning, setSummaryRunning] = useState(false)
  const [summaryResult, setSummaryResult] = useState<VideoSummaryResult | null>(null)
  const [summaryInventory, setSummaryInventory] = useState<VideoSummaryInventory | null>(null)
  const [summaryError, setSummaryError] = useState('')

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
  }, [onRuntimeSettingsSaved, setRuntimeSettings, settingsDraft, view])

  useEffect(() => {
    return () => {
      ttsTestAudioRef.current?.pause()
      ttsTestAudioRef.current?.removeAttribute('src')
      ttsTestAudioRef.current?.load()
      ttsTestAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    if (view !== 'workbench') return
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
    if (view !== 'workbench') return
    let alive = true
    window.desktopAPI.listVideoSummaries()
      .then((result) => {
        if (alive) setSummaryInventory(result)
      })
      .catch(() => {
        if (alive) setSummaryInventory(null)
      })
    return () => {
      alive = false
    }
  }, [runtimeSettings?.output_dir, runtimeSettings?.video_summary_output_dir, summaryResult?.markdownPath, view])

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
    const title = lastMaterialResult.title || '这门课程'
    return [
      '请担任“视界专注”的课程总设计师。',
      '',
      `本次课程名称是《${title}》。请把本对话视为《${title}》的课程设计工作区；如果系统自动生成对话标题，请优先围绕这个课程名命名。`,
      '',
      '我已经上传 `gpt_course_design_workspace.zip`。请读取压缩包内容，不要尝试读取我电脑上的本地路径。',
      '',
      '请先执行压缩包中的：',
      '- `gpt_designer/START_GPT_DESIGNER.md`',
      '- `gpt_designer/chatgpt-course-designer-v1.md`',
      '- `schemas/course_blueprint.schema.json`',
      '',
      '你的目标不是生成最终课程正文，而是完整理解视频/字幕/转写材料，设计一份可交给 Codex 执行的 course_blueprint.json。',
      '请先填写 `source_genre`、`learning_intent` 和 `course_design_mode`，判断这门课应是知识地图、概念训练、语言/语法训练、操作训练、工具工作流、案例推理、考试训练、观点理解还是混合课。',
      '请先建立 `topic_inventory` 候选主题池，再决定章节和 lesson；长材料、跨主题材料、访谈/播客/圆桌/纪录片不要只列最终进入课程的主题。',
      '整门课还要提供一个顶层 `course_visual_map`：它是整门课的全局学习地图提示词，不是章节图集合。`status` 先用 `planned`，必须提供中文 `alt` 和高质量 `prompt`，用于后续生成一张 16:9 的整课视觉地图。它要强调章节主线、能力成长和关键转折，少文字、强结构，不要画软件按钮、进度条或信息面板。',
      '每章都要设计 `chapter_roadmap`，它用于软件顶部的章节地图 fallback，不是正文：请用短节点、箭头关系和 `map_label/action_tag/risk_tag/output_tag` 串起本章小节，并加入 `visual_asset`。`visual_asset.status` 先用 `planned`，必须提供中文 `alt` 和可用于生成章节学习路线图图片的 `prompt`；图片 prompt 不是封面图，也不是大段文字思维导图。',
      '每节课尽量填写 `primary_training_action` 和 `training_policy`，说明本节训练识别、解析、改错、产出、操作、配置、排错、诊断、选择、论证还是反思；`must_include` 只放 2-3 个核心训练槽位，不要所有 lesson 复用同一套结构。',
      '蓝图中必须包含 `design_review`：请列出蓝图强项、生成风险、高密度 lesson、被否定的备选结构、需要核验的事实，以及当前/未来软件最需要的展示块。',
      '最终请生成一个可下载文件 `course_blueprint.json`，内容是符合 `schemas/course_blueprint.schema.json` 的 JSON 对象。不要把完整 JSON 长文本直接贴在对话正文里；如果当前环境不能生成文件，再分段输出 JSON。',
    ].join('\n')
  }, [lastMaterialResult?.materialPath, lastMaterialResult?.title])
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

  const handleRunVideoSummary = async () => {
    const input = (summaryInput || videoInput).trim()
    if (!input) {
      setSummaryError(summarySourceMode === 'local_media' ? '请先选择本地音视频文件。' : '请先填写 B 站视频链接或 BV 号。')
      return
    }
    setSummaryRunning(true)
    setSummaryError('')
    setSummaryResult(null)
    try {
      const result = await window.desktopAPI.runVideoSummary({
        video: input,
        sourceKind: summarySourceMode,
        mediaPath: summarySourceMode === 'local_media' ? input : undefined,
      })
      setSummaryResult(result)
      setSummaryInput(input)
      try {
        setSummaryInventory(await window.desktopAPI.listVideoSummaries())
      } catch {
        // The newly generated result is already visible above the record list.
      }
      pushToast('视频总结已生成', result.title, 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSummaryError(message)
      pushToast('视频总结失败', message, 'error')
    } finally {
      setSummaryRunning(false)
    }
  }

  const handleDeleteMaterialPackage = async (record: MaterialInventory['records'][number]) => {
    const shouldDelete = globalThis.confirm(`确定删除《${record.title}》的原材料包和关联课包吗？`)
    if (!shouldDelete) return
    try {
      await window.desktopAPI.deleteMaterialPackage(record.path)
      setMaterialInventory(await window.desktopAPI.listMaterialPackages())
      pushToast('制作记录已删除', record.title, 'success')
    } catch (error) {
      pushToast('删除失败', error instanceof Error ? error.message : '无法删除这条制作记录。', 'error')
    }
  }

  const handleDeleteVideoSummary = async (record: VideoSummaryInventory['records'][number]) => {
    const shouldDelete = globalThis.confirm(`确定删除《${record.title}》的视频总结和临时材料吗？`)
    if (!shouldDelete) return
    try {
      await window.desktopAPI.deleteVideoSummary(record.path)
      setSummaryInventory(await window.desktopAPI.listVideoSummaries())
      pushToast('视频总结已删除', record.title, 'success')
    } catch (error) {
      pushToast('删除失败', error instanceof Error ? error.message : '无法删除这条视频总结。', 'error')
    }
  }

  const handlePickLocalMedia = async () => {
    const result = await window.desktopAPI.pickMediaFile()
    if (!result) return
    setMaterialSourceMode('local_media')
    setVideoInput(result.path)
    pushToast('已选择本地文件', result.name, 'success')
  }

  const handlePickSummaryMedia = async () => {
    const result = await window.desktopAPI.pickMediaFile()
    if (!result) return
    setSummarySourceMode('local_media')
    setSummaryInput(result.path)
    pushToast('已选择本地文件', result.name, 'success')
  }

  const handlePickVideoSummaryOutputDir = async () => {
    const targetPath = await window.desktopAPI.pickDirectory()
    if (!targetPath) return
    setSettingsDraft((current) => ({ ...current, video_summary_output_dir: targetPath }))
  }

  const handleCopyCodexPrompt = async () => {
    if (!codexPromptText) return
    try {
      await navigator.clipboard.writeText(codexPromptText)
      pushToast('GPT 设计提示已复制', '新开 ChatGPT 对话后上传工作包并粘贴即可。', 'success')
    } catch {
      pushToast('复制失败', '可以从原材料包里的 01_copy_to_chatgpt.md 手动复制。', 'error')
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

  const handleCopyCourseVisualMapPrompt = async (targetPath: string, title: string) => {
    try {
      const result = await window.desktopAPI.readCoursePackage(targetPath)
      const courseVisualMap = readCourseVisualMapFromText(result.text)
      const prompt = String(courseVisualMap?.prompt ?? '').trim()
      if (!prompt) {
        pushToast('还没有地图提示词', '这份课包里暂时没有 `course_visual_map.prompt`。', 'error')
        return
      }
      await navigator.clipboard.writeText(prompt)
      pushToast('地图提示词已复制', `《${title}》现在可以去生成全局学习地图。`, 'success')
    } catch (error) {
      pushToast('复制失败', error instanceof Error ? error.message : '无法读取这份课包。', 'error')
    }
  }

  const handleAttachCourseVisualMap = async (targetPath: string, title: string) => {
    try {
      const image = await window.desktopAPI.pickImageFile()
      if (!image) return
      const result = await window.desktopAPI.attachCourseVisualMap({
        targetPath,
        imagePath: image.path,
      })
      const nextPackage = JSON.parse(result.text) as { package_id?: string }
      if (courseData?.package_id && nextPackage.package_id === courseData.package_id) {
        await loadCourseFromText(result.text, result.path)
      }
      await refreshLibrary()
      pushToast('全局地图已导入', `《${title}》已挂载图片地图。`, 'success')
    } catch (error) {
      pushToast('导入失败', error instanceof Error ? error.message : '无法写入地图图片。', 'error')
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

  if (view === 'learn') {
    return <CoachPane />
  }

  if (view === 'workbench') {
    return (
      <WorkspaceShell
        eyebrow="Workbench"
        title="工作台"
        windowFocused={windowFocused}
      >
        <div className="mx-auto grid min-h-0 w-full max-w-5xl grid-cols-1 gap-8">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
                <img src={courseIcon} alt="" className="size-4 opacity-90" />
                课程制作
              </h3>
              <div className="flex min-w-[132px] items-center gap-2">
                <Progress
                  value={distillRequestState === 'loading' ? Math.max(4, Math.min(100, distillProgressPercent || 4)) : lastMaterialResult?.materialPath ? 100 : 0}
                  className="h-1.5 flex-1 bg-white/[0.08]"
                />
                <span className="w-8 text-right text-[11px] font-semibold tabular-nums text-[#dbe4ef]">
                  {distillRequestState === 'loading' ? Math.max(0, Math.min(100, Math.round(distillProgressPercent || 0))) : lastMaterialResult?.materialPath ? 100 : 0}%
                </span>
              </div>
            </div>
          <Card className="overflow-hidden rounded-[10px] border-white/[0.09] bg-[#1f1f1f] shadow-none">
            <CardContent className="space-y-4 p-5">
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/86">
                      {materialSourceMode === 'local_media' ? <FileVideo size={13} /> : <Link2 size={13} />}
                      视频来源
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="ml-1 size-6 rounded-md text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
                        onClick={() => void handlePickLocalMedia()}
                        disabled={distillRequestState === 'loading'}
                        aria-label="选择本地文件"
                        title="选择本地文件"
                      >
                        <FolderOpen size={12} />
                      </Button>
                    </span>
                  </div>
                  <Input
                    value={videoInput}
                    onChange={(event) => {
                      setVideoInput(event.target.value)
                      setMaterialSourceMode('bilibili')
                    }}
                    placeholder={materialSourceMode === 'local_media' ? '选择或粘贴本地音视频文件路径' : '例如 BV17ykEBWEjv 或 https://www.bilibili.com/video/...'}
                    disabled={distillRequestState === 'loading'}
                  />
                </div>
                <div className="grid content-end gap-2 sm:grid-cols-2 md:grid-cols-1">
                  <Button
                    size="icon"
                    className={cn(
                      'size-9 rounded-lg border-0 bg-transparent shadow-none',
                      distillRequestState === 'loading'
                        ? 'text-sky-100 hover:bg-sky-400/[0.08]'
                        : 'text-foreground/82 hover:bg-white/[0.06] hover:text-foreground',
                    )}
                    onClick={() => {
                      if (distillRequestState === 'loading') return
                      void handleDistillCourse()
                    }}
                    disabled={!videoInput.trim()}
                    aria-label={distillRequestState === 'loading' ? '原材料包生成中' : '开始生成原材料包'}
                    title={distillRequestState === 'loading' ? '原材料包生成中' : '开始生成原材料包'}
                  >
                    {distillRequestState === 'loading' ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                  </Button>
                </div>
              </div>

              {distillRequestState === 'loading' ? (
                <div className="rounded-[18px] border border-white/7 bg-black/10 p-3">
                  <div className="text-[11px] font-medium text-foreground/88">
                    {distillProgressSnapshot?.stageLabel || '正在处理'}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {distillStatusMessage || '正在抓取字幕、转写缺失音频、清洗文本并写入 Codex 原材料包。'}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                    <ArchiveRestore size={14} />
                    制作记录
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-1 size-6 rounded-md text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
                      onClick={() => runtimeSettings?.output_dir ? void window.desktopAPI.openPath(materialRootDir) : undefined}
                      title={materialRootDir}
                      aria-label="打开材料目录"
                    >
                      <FolderOpen size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 rounded-md text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
                      onClick={() => runtimeSettings?.output_dir ? void window.desktopAPI.openPath(coursePackageRootDir) : undefined}
                      title={coursePackageRootDir}
                      aria-label="打开课包目录"
                    >
                      <PackageOpen size={12} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 rounded-md text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
                      onClick={async () => {
                        try {
                          setMaterialInventory(await window.desktopAPI.listMaterialPackages())
                        } catch {
                          pushToast('刷新失败', '无法读取原材料目录。', 'error')
                        }
                      }}
                      aria-label="刷新制作记录"
                      title="刷新制作记录"
                    >
                      <RefreshCcw size={12} />
                    </Button>
                  </div>
                </div>

                <div className="subtle-scrollbar grid max-h-[310px] gap-2 overflow-y-auto pr-1">
                  {materialInventory?.records.length ? (
                    materialInventory.records.map((record) => {
                      const statusLabel = record.workflowStageLabel || (
                        record.importReadyCourseExists
                          ? '可导入'
                          : record.courseBlueprintExists
                            ? '有蓝图'
                            : record.gptWorkspaceZipExists
                              ? '待设计'
                              : '旧材料'
                      )
                      const statusClass = record.workflowStage === 'course_ready' || record.importReadyCourseExists
                        ? 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100'
                        : record.workflowStage === 'blueprint_ready' || record.courseBlueprintExists
                          ? 'border-sky-400/18 bg-sky-400/[0.08] text-sky-100'
                          : record.workflowStage === 'material_ready'
                            ? 'border-violet-400/18 bg-violet-400/[0.08] text-violet-100'
                            : ''
                      return (
                        <div key={record.path} className="rounded-[16px] border border-white/6 bg-white/[0.018] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12px] font-medium text-foreground">{record.title}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                {record.sourceId ? <span>{record.sourceId}</span> : null}
                                <span>{formatCompactNumber(record.textLength)} 字</span>
                                <span>{formatRelativeTime(record.updatedAt)}</span>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Badge variant="outline" className={statusClass}>
                                {statusLabel}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-lg text-foreground/58 hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => void handleDeleteMaterialPackage(record)}
                                aria-label="删除制作记录"
                                title="删除制作记录"
                              >
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-6 gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-xl px-2"
                              disabled={!record.gptWorkspaceZipExists}
                              onClick={async () => {
                                try {
                                  const text = await window.desktopAPI.readTextFile(record.gptDesignerCopyPromptPath)
                                  await navigator.clipboard.writeText(text)
                                  await window.desktopAPI.showItem(record.gptWorkspaceZipPath)
                                  pushToast('GPT 工作包已定位', '已复制提示词，把选中的 zip 上传到 ChatGPT 后粘贴即可。', 'success')
                                } catch {
                                  pushToast('复制失败', '请打开 gpt_designer/01_copy_to_chatgpt.md 手动复制。', 'error')
                                }
                              }}
                              title="复制 GPT 提示并定位上传 zip"
                            >
                              <Clipboard size={13} />
                              GPT
                            </Button>
                            <Button variant="outline" size="sm" className="rounded-xl px-2" onClick={() => void window.desktopAPI.openPath(record.path)}>
                              <FolderOpen size={13} />
                              目录
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-xl px-2"
                              disabled={!record.courseBlueprintExists}
                              onClick={async () => {
                                try {
                                  const text = await window.desktopAPI.readTextFile(record.codexBlueprintPromptPath)
                                  await navigator.clipboard.writeText(text)
                                  pushToast('Codex 制课提示已复制', record.title, 'success')
                                } catch {
                                  pushToast('复制失败', '请打开 gpt_designer/02_copy_to_codex_after_blueprint.md 手动复制。', 'error')
                                }
                              }}
                            >
                              <Clipboard size={13} />
                              Codex
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-xl px-2"
                              disabled={!record.importReadyCourseExists}
                              onClick={() => void handleCopyCourseVisualMapPrompt(record.importReadyCoursePath, record.title)}
                              title="复制全局学习地图提示词"
                            >
                              <Milestone size={13} />
                              地图
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-xl px-2"
                              disabled={!record.importReadyCourseExists}
                              onClick={() => void handleAttachCourseVisualMap(record.importReadyCoursePath, record.title)}
                              title="导入全局学习地图图片"
                            >
                              <FileUp size={13} />
                              导图
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
                      )
                    })
                  ) : (
                    <div className="rounded-[16px] border border-white/6 bg-white/[0.018] px-4 py-3 text-[12px] leading-6 text-muted-foreground">
                      还没有生成过原材料包。
                    </div>
                  )}
                </div>
              </div>

              {distillError ? (
                <div className="rounded-[18px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {distillError}
                </div>
              ) : null}
            </CardContent>
          </Card>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
                <img src={videoIcon} alt="" className="size-4 opacity-90" />
                视频总结
              </h3>
              <div className="flex min-w-[132px] items-center gap-2">
                <Progress
                  value={summaryRunning ? 48 : summaryResult ? 100 : 0}
                  className="h-1.5 flex-1 bg-white/[0.08]"
                />
                <span className="w-8 text-right text-[11px] font-semibold tabular-nums text-[#dbe4ef]">
                  {summaryRunning ? 48 : summaryResult ? 100 : 0}%
                </span>
              </div>
            </div>
          <Card className="overflow-hidden rounded-[10px] border-white/[0.09] bg-[#1f1f1f] shadow-none">
            <CardContent className="space-y-4 p-5">
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/86">
                      {summarySourceMode === 'local_media' ? <FileVideo size={13} /> : <Link2 size={13} />}
                      视频来源
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="ml-1 size-6 rounded-md text-foreground/68 hover:bg-white/[0.07] hover:text-foreground"
                        onClick={() => void handlePickSummaryMedia()}
                        disabled={summaryRunning}
                        aria-label="选择本地文件"
                        title="选择本地文件"
                      >
                        <FolderOpen size={12} />
                      </Button>
                    </span>
                  </div>
                  <Input
                    value={summaryInput}
                    onChange={(event) => {
                      setSummaryInput(event.target.value)
                      setSummarySourceMode('bilibili')
                    }}
                    placeholder={summarySourceMode === 'local_media' ? '选择或粘贴本地音视频文件路径' : '例如 BV17ykEBWEjv 或 https://www.bilibili.com/video/...'}
                    disabled={summaryRunning}
                  />
                </div>
                <div className="grid content-end">
                  <Button
                    size="icon"
                    className={cn(
                      'size-9 rounded-lg border-0 bg-transparent shadow-none',
                      summaryRunning
                        ? 'text-sky-100 hover:bg-sky-400/[0.08]'
                        : 'text-foreground/82 hover:bg-white/[0.06] hover:text-foreground',
                    )}
                    onClick={() => {
                      if (summaryRunning) return
                      void handleRunVideoSummary()
                    }}
                    disabled={!(summaryInput || videoInput).trim()}
                    aria-label={summaryRunning ? '视频总结生成中' : '开始生成视频总结'}
                    title={summaryRunning ? '视频总结生成中' : '开始生成视频总结'}
                  >
                    {summaryRunning ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                  <ArchiveRestore size={14} />
                  制作记录
                </div>

                <div className="subtle-scrollbar grid max-h-[240px] gap-2 overflow-y-auto pr-1">
                  {summaryInventory?.records.length ? (
                    summaryInventory.records.map((record) => (
                      <div key={record.path} className="rounded-[16px] border border-white/6 bg-white/[0.018] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-medium text-foreground">{record.title}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                              {record.sourceId ? <span>{record.sourceId}</span> : null}
                              <span>{formatCompactNumber(record.textLength)} 字</span>
                              <span>{record.keyPointCount} 要点</span>
                              <span>{formatRelativeTime(record.updatedAt)}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge variant="outline" className={getVideoSummaryProviderClass(record.summaryProvider)}>
                              {getVideoSummaryProviderLabel(record.summaryProvider)}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 rounded-lg text-foreground/58 hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleDeleteVideoSummary(record)}
                              aria-label="删除视频总结"
                              title="删除视频总结"
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Button variant="outline" size="sm" className="rounded-xl px-2" onClick={() => void window.desktopAPI.openPath(record.path)}>
                            <FileText size={13} />
                            打开 MD
                          </Button>
                          <Button variant="outline" size="sm" className="rounded-xl px-2" onClick={() => void window.desktopAPI.openPath(getParentPath(record.path))}>
                            <FolderOpen size={13} />
                            打开目录
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-[16px] border border-white/6 bg-white/[0.018] px-4 py-3 text-[12px] leading-6 text-muted-foreground">
                      还没有生成过视频总结。
                    </div>
                  )}
                </div>
              </div>

              {summaryError ? (
                <div className="rounded-[18px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {summaryError}
                </div>
              ) : null}
            </CardContent>
          </Card>
          </section>
        </div>
      </WorkspaceShell>
    )
  }

  if (view === 'archive') {
    const otherActiveRecords = activeLibraryRecords.filter((record) => record.id !== featuredActiveRecord?.id)

    return (
      <WorkspaceShell
        eyebrow="Archive"
        title="学习档案"
        windowFocused={windowFocused}
      >
        <div className="mx-auto grid w-full max-w-5xl gap-8">
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
              <img src={archiveCurrentCourseIcon} alt="" className="size-4 opacity-90" />
              当前课程
            </h3>
            {featuredActiveRecord ? (
              <div className="rounded-[18px] border border-sky-300/10 bg-[linear-gradient(180deg,rgba(29,38,43,0.68),rgba(24,25,26,0.92))] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="truncate text-[17px] font-semibold text-foreground">{featuredActiveRecord.title}</div>
                    <div className="text-[12px] leading-6 text-muted-foreground">
                      已完成 {featuredActiveRecord.completedCount} 节
                      {featuredActiveRecord.currentNodeTitle ? `，正在推进《${featuredActiveRecord.currentNodeTitle}》` : ''}
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
            ) : (
              <div className="rounded-[18px] border border-white/6 bg-white/[0.015] px-4 py-3 text-[13px] leading-6 text-muted-foreground">
                还没有正在学习的课程。
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
              <img src={archiveOtherCoursesIcon} alt="" className="size-4 opacity-90" />
              其他课程
            </h3>
            {otherActiveRecords.length ? (
              <div className="grid gap-3">
                {otherActiveRecords.map((record) => (
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
                ))}
              </div>
            ) : (
              <div className="rounded-[18px] border border-white/6 bg-white/[0.015] px-4 py-3 text-[13px] leading-6 text-muted-foreground">
                当前没有其他已录入的进行中课程。
              </div>
            )}
          </section>
        </div>
      </WorkspaceShell>
    )
  }



  return (
    <WorkspaceShell
      eyebrow="Settings"
      title="设置"
      windowFocused={windowFocused}
    >
      <div className="mx-auto grid w-full max-w-5xl gap-7">
        <SettingsBlock title="TTS 语音朗读" icon={settingsTtsIcon} className="order-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2 md:col-span-2">
              <div className="grid gap-2 md:grid-cols-2">
                <Button
                  type="button"
                  variant={settingsDraft.tts_provider !== 'minimax' ? 'default' : 'outline'}
                  className="justify-start rounded-xl"
                  onClick={() => setSettingsDraft((current) => ({ ...current, tts_provider: 'mimo' }))}
                >
                  <AudioLines size={14} />
                  MiMo 预置女声
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
              </div>
            </div>

            {settingsDraft.tts_provider !== 'minimax' ? (
              <>
                <Field label="MiMo API Key" icon={<Server size={14} />} className="md:col-span-2">
                  <Input
                    type="password"
                    value={settingsDraft.mimo_api_key}
                    onChange={(event) => setSettingsDraft((current) => ({ ...current, mimo_api_key: event.target.value }))}
                    placeholder="sk- 或 tp-"
                  />
                </Field>
                <div className="grid gap-5 md:col-span-2 md:grid-cols-[1.4fr_0.8fr]">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                      <AudioLines size={14} />
                      音色选择
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {MIMO_TTS_PRESET_VOICES.map((voice) => {
                        const selected = (settingsDraft.mimo_tts_voice_id || '茉莉') === voice.id
                        const previewing = ttsPreviewVoice === voice.id
                        return (
                          <Button
                            key={voice.id}
                            type="button"
                            variant={selected ? 'default' : 'outline'}
                            className={cn(
                              'h-8 rounded-xl px-3 text-[12px]',
                              selected && 'shadow-[0_0_18px_rgba(125,211,252,0.08)]',
                            )}
                            onClick={() => void handlePreviewMimoVoice(voice.id, voice.previewUrl)}
                            title={`试听并选择 ${voice.id}`}
                          >
                            {previewing ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <Play className="size-3.5" />
                            )}
                            {voice.id}
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                      <AudioLines size={14} />
                      模型
                    </div>
                    <div className="text-[14px] font-semibold text-foreground">mimo-v2.5-tts</div>
                  </div>
                </div>
                <Field label="MiMo 接口地址" icon={<Server size={14} />} className="md:col-span-2">
                  <Input
                    value={settingsDraft.mimo_tts_endpoint}
                    onChange={(event) => setSettingsDraft((current) => ({ ...current, mimo_tts_endpoint: event.target.value }))}
                    placeholder="https://api.xiaomimimo.com/v1/chat/completions"
                  />
                </Field>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </SettingsBlock>

        <SettingsBlock title="Obsidian 同步" icon={settingsObsidianIcon} className="order-5">
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

        <SettingsBlock title="音频转写引擎" icon={settingsTranscriptionIcon} className="order-1">
          <div className="grid gap-4">
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
          </div>

          <div className="grid gap-3 md:grid-cols-2">
              <Field label="本地引擎目录" icon={<FolderOpen size={14} />} className="md:col-span-2">
                <Input
                  value={settingsDraft.local_transcription_root}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, local_transcription_root: event.target.value }))}
                  placeholder="例如 C:\\Users\\Yu\\AI\\Cuda"
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

        <SettingsBlock title="B 站凭据" icon={settingsBilibiliIcon} className="order-4">
          <Field label="SESSDATA" icon={<Cookie size={14} />}>
            <Input type="password" value={settingsDraft.sessdata} onChange={(event) => setSettingsDraft((current) => ({ ...current, sessdata: event.target.value }))} />
          </Field>
        </SettingsBlock>

        <SettingsBlock title="视频总结" icon={settingsVideoSummaryIcon} className="order-2">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2 md:col-span-2 md:grid-cols-2">
              <Button
                type="button"
                variant={settingsDraft.video_summary_provider === 'mimo' ? 'default' : 'outline'}
                className="justify-start rounded-xl"
                onClick={() => setSettingsDraft((current) => ({
                  ...current,
                  video_summary_provider: 'mimo',
                  video_summary_base_url: !current.video_summary_base_url || current.video_summary_base_url.includes('minimaxi.com')
                    ? 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
                    : current.video_summary_base_url,
                  video_summary_model: !current.video_summary_model || current.video_summary_model === 'MiniMax-M2'
                    ? 'mimo-v2.5-pro'
                    : current.video_summary_model,
                }))}
              >
                <Sparkles size={14} />
                MiMo
              </Button>
              <Button
                type="button"
                variant={settingsDraft.video_summary_provider !== 'mimo' ? 'default' : 'outline'}
                className="justify-start rounded-xl"
                onClick={() => setSettingsDraft((current) => ({
                  ...current,
                  video_summary_provider: 'minimax',
                  video_summary_base_url: current.video_summary_base_url.includes('xiaomimimo.com') ? 'https://api.minimaxi.com/v1' : current.video_summary_base_url,
                  video_summary_model: current.video_summary_model.startsWith('mimo-') ? 'MiniMax-M2' : current.video_summary_model,
                }))}
              >
                <Sparkles size={14} />
                MiniMax
              </Button>
            </div>

            <Field label="模型" icon={<Sparkles size={14} />}>
              <Input
                value={settingsDraft.video_summary_model}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, video_summary_model: event.target.value }))}
                placeholder={settingsDraft.video_summary_provider === 'mimo' ? 'mimo-v2.5-pro' : 'MiniMax-M2'}
              />
            </Field>
            <Field label="接口地址" icon={<Server size={14} />}>
              <Input
                value={settingsDraft.video_summary_base_url}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, video_summary_base_url: event.target.value }))}
                placeholder={settingsDraft.video_summary_provider === 'mimo' ? 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions' : 'https://api.minimaxi.com/v1'}
              />
            </Field>
            <Field label="API Key" icon={<Server size={14} />} className="md:col-span-2">
              <Input
                type="password"
                value={settingsDraft.video_summary_api_key}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, video_summary_api_key: event.target.value }))}
                placeholder={settingsDraft.video_summary_provider === 'mimo' ? '用于视频总结的 MiMo Key，支持 tp-' : '用于视频总结的 MiniMax Key'}
              />
            </Field>
            <Field label="保存位置" icon={<FolderOpen size={14} />} className="md:col-span-2">
              <div className="flex gap-2">
                <Input
                  value={settingsDraft.video_summary_output_dir}
                  onChange={(event) => setSettingsDraft((current) => ({ ...current, video_summary_output_dir: event.target.value }))}
                  placeholder={runtimeSettings?.output_dir ? `${runtimeSettings.output_dir}\\workbench\\summaries` : '视频总结 Markdown 输出目录'}
                />
                <Button type="button" variant="outline" className="shrink-0 rounded-xl" onClick={() => void handlePickVideoSummaryOutputDir()}>
                  选择
                </Button>
              </div>
            </Field>
          </div>
        </SettingsBlock>

        {settingsError ? (
          <div className="order-last rounded-[10px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
            {settingsError}
          </div>
        ) : null}
      </div>
    </WorkspaceShell>
  )
}

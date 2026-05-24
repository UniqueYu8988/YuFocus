import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AudioLines,
  ArchiveRestore,
  Award,
  Cookie,
  Clipboard,
  Eye,
  FileText,
  FileVideo,
  FolderOpen,
  GraduationCap,
  Link2,
  LoaderCircle,
  PackageOpen,
  Play,
  RefreshCcw,
  Search,
  Server,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { CoachPane } from '@/components/CoachPane'
import { KnowledgeBriefDialog } from '@/components/KnowledgeBriefDialog'
import { PromptPreviewDialog, type PromptPreviewModule } from '@/components/PromptPreviewDialog'
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
import { buildLearningNotesStudyPackage } from '@/lib/knowledgeBriefCourse'
import { copyTextToClipboard } from '@/lib/clipboard'
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
import videoIcon from '@/assets/video-icon.svg'
import mimoPreviewBaihua from '@/assets/mimo-voice-previews/baihua.wav'
import mimoPreviewBingtang from '@/assets/mimo-voice-previews/bingtang.wav'
import mimoPreviewMoli from '@/assets/mimo-voice-previews/moli.wav'
import mimoPreviewSuda from '@/assets/mimo-voice-previews/suda.wav'

export type WorkspaceView = 'learn' | 'workbench' | 'knowledge' | 'archive' | 'settings'

type RuntimeSettingsFallback = Awaited<ReturnType<typeof window.desktopAPI.loadSettings>> | null

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
type ArchiveShelfFilter = 'all' | 'recent' | 'coding' | 'medical' | 'highlighted'
type MaterialSourceMode = 'bilibili' | 'local_media'
type MaterialInventory = Awaited<ReturnType<typeof window.desktopAPI.listMaterialPackages>>
type MaterialInventoryRecord = MaterialInventory['records'][number]
type KnowledgeInventory = Awaited<ReturnType<typeof window.desktopAPI.listKnowledgeLibrary>>
type KnowledgeInventoryRecord = KnowledgeInventory['records'][number]
type MarkdownDocumentKind = 'brief' | 'chapter_map'
type PromptPreviewSource = {
  path: string
  title: string
  sourceId?: string
  updatedAt?: number
  workflowStageLabel?: string
}

const DISTILL_STAGE_ORDER = [
  { id: 'metadata', label: '解析视频' },
  { id: 'metadata_ready', label: '信息就绪' },
  { id: 'subtitle', label: '字幕准备' },
  { id: 'audio', label: '音频补全' },
  { id: 'chunking', label: '材料切片' },
  { id: 'material_ready', label: '材料就绪' },
  { id: 'complete', label: '完成' },
] as const

const MIMO_TTS_PRESET_VOICES = [
  { id: '茉莉', previewUrl: mimoPreviewMoli },
  { id: '冰糖', previewUrl: mimoPreviewBingtang },
  { id: '苏打', previewUrl: mimoPreviewSuda },
  { id: '白桦', previewUrl: mimoPreviewBaihua },
] as const

function joinMaterialPath(root: string, ...parts: string[]) {
  return [root.replace(/[\\/]+$/, ''), ...parts].filter(Boolean).join('\\')
}

function buildPromptPreviewModules(materialPath: string): PromptPreviewModule[] {
  const authoring = (...parts: string[]) => joinMaterialPath(materialPath, 'authoring', ...parts)
  const schemas = (...parts: string[]) => joinMaterialPath(materialPath, 'schemas', ...parts)
  const draft = (...parts: string[]) => joinMaterialPath(materialPath, 'content_draft', ...parts)

  return [
    {
      id: 'summary-workflow',
      title: '学习笔记工作流',
      summary: '主生产窗口使用的提示词、作者手册和计划 schema。',
      files: [
        {
          id: 'content-authoring',
          label: '学习笔记手册',
          path: authoring('content-synthesis-authoring.md'),
          description: '约束学习笔记的内容边界、重组方式和质量线。',
        },
        {
          id: 'codex-goal',
          label: 'Codex Goal v8',
          path: authoring('codex-goal-content-synthesis-v8.md'),
          description: '规定 Codex 如何先搭知识树，再做覆盖映射、分支材料包、分章深写和复查。',
        },
        {
          id: 'synthesis-plan-schema',
          label: '笔记计划 Schema',
          path: schemas('content_synthesis_plan.schema.json'),
          description: 'synthesis_plan.json 必须符合的结构合同。',
        },
      ],
    },
    {
      id: 'summary-artifacts',
      title: '学习笔记产物',
      summary: 'Codex 生成的计划、学习笔记、章节思维导图和审计报告。',
      files: [
        {
          id: 'synthesis-plan',
          label: '笔记计划',
          path: draft('synthesis_plan.json'),
          description: 'Codex 的工作计划，不是最终正文。',
        },
        {
          id: 'knowledge-tree',
          label: '知识树',
          path: draft('work', 'knowledge_tree.json'),
          description: '主干、分支、子节点和跨章连接的结构锚点。',
        },
        {
          id: 'tree-outline',
          label: '树状大纲',
          path: draft('work', 'tree_outline.md'),
          description: '面向人读的章节树和跨节点关系说明。',
        },
        {
          id: 'structure-review',
          label: '结构复查',
          path: draft('work', 'structure_review.md'),
          description: '检查上层过粗、下层过碎、导图提纲化等结构问题。',
        },
        {
          id: 'editorial-contract',
          label: '知识树合同',
          path: draft('work', 'editorial_contract.md'),
          description: '约定章节深度、具体情境密度和补全边界。',
        },
        {
          id: 'block-digest',
          label: '逐块消化',
          path: draft('work', 'block_digest', 'block_001.md'),
          description: '逐 block 盘点考点、例子、术语、噪声和处理建议；这里预览第一块。',
        },
        {
          id: 'topic-inventory',
          label: '考点清单',
          path: draft('work', 'topic_inventory.json'),
          description: '把全部 block digest 合成可处理的 topic pool。',
        },
        {
          id: 'evidence-ledger',
          label: '证据账本',
          path: draft('work', 'evidence_ledger.jsonl'),
          description: '保留可教学的原材料细节、例子、边界和表达重心。',
        },
        {
          id: 'coverage-matrix',
          label: '覆盖矩阵',
          path: draft('work', 'coverage_matrix.json'),
          description: '说明每个高价值 topic 的状态和下一步去向；覆盖不等于正文完成。',
        },
        {
          id: 'block-reread-ledger',
          label: '回读账本',
          path: draft('work', 'block_reread_ledger.jsonl'),
          description: '记录每章实际回读了哪些 blocks、提取了什么素材。',
        },
        {
          id: 'section-dossier',
          label: '章节材料包',
          path: draft('work', 'section_dossiers', 'section_001.md'),
          description: '深写前的章节素材包；这里预览第一章。',
        },
        {
          id: 'thinness-review',
          label: '薄度复查',
          path: draft('work', 'thinness_review.md'),
          description: '判断章节是否只是提纲、是否需要回到 dossier 或 draft 加厚。',
        },
        {
          id: 'specificity-review',
          label: '具体性复查',
          path: draft('work', 'specificity_review.md'),
          description: '检查正文是否过度抽象、偏薄或失去原材料味道。',
        },
        {
          id: 'editorial-review',
          label: '编辑复查',
          path: draft('work', 'editorial_review.md'),
          description: '初稿后的二次增厚和风险复查记录。',
        },
        {
          id: 'concept-graph',
          label: '概念关系图',
          path: draft('work', 'concept_graph.json'),
          description: '章节思维导图的概念节点、依赖关系和易混关系。',
        },
        {
          id: 'knowledge-brief',
          label: '学习笔记',
          path: draft('learning_notes.md'),
          description: '进入学习台的主产物。',
        },
        {
          id: 'chapter-map',
          label: '章节思维导图',
          path: draft('chapter_mindmap.md'),
          description: '帮助用户快速看懂知识树主线、分支和回看入口。',
        },
        {
          id: 'readonly-audit',
          label: '只读审计',
          path: draft('review_exports', 'latest-readonly-audit.md'),
          description: '第二个窗口写入的审计报告。',
        },
      ],
    },
    {
      id: 'readonly-audit',
      title: '只读审计',
      summary: '第二个 Codex 窗口只检查，不修改，降低黑箱失败风险。',
      files: [
        {
          id: 'audit-start',
          label: '只读审计入口',
          path: authoring('03_readonly_synthesis_audit.md'),
          description: '实际复制到第二个只读 Codex 窗口的审计提示词。',
        },
        {
          id: 'audit-guide',
          label: '只读审计指南',
          path: authoring('readonly-synthesis-audit.md'),
          description: '学习笔记只读审计的检查重点。',
        },
      ],
    },
  ]
}

function identityMarkdownContent(content: string) {
  return content
}

function resolveDistillStagePosition(stage?: string) {
  const index = DISTILL_STAGE_ORDER.findIndex((item) => item.id === stage)
  return index >= 0 ? index : 0
}

function formatCacheHint(cacheHint?: string | null) {
  switch (cacheHint) {
    case 'subtitle_bundle':
      return '字幕缓存'
    case 'audio_page_cache':
      return '分P音频缓存'
    case 'audio_transcript_cache':
      return '整段转写缓存'
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

function stripKnowledgeBriefMetadata(content: string) {
  return content
    .replace(/^<!--\s*shijie:learning-notes[\s\S]*?-->\s*/u, '')
    .replace(/^<!--\s*shijie:knowledge-brief[\s\S]*?-->\s*/u, '')
    .trim()
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

const WORKSPACE_CONTENT_PADDING_X = 'px-16'
const WORKSPACE_CONTENT_MAX_WIDTH = 'max-w-[1120px]'

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
        <div className={cn('relative mx-auto flex h-full w-full flex-col', WORKSPACE_CONTENT_MAX_WIDTH)}>
          <div className={cn('relative flex w-full items-start justify-between gap-4 pb-7 pt-14', WORKSPACE_CONTENT_PADDING_X)}>
            <div className="space-y-2">
              {eyebrow ? <div className="sr-only">{eyebrow}</div> : null}
              <h2 className="text-[26px] font-semibold tracking-tight text-foreground">{title}</h2>
              {description ? <p className="max-w-3xl text-[13px] leading-6 text-muted-foreground">{description}</p> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
          <div className={cn('subtle-scrollbar relative min-h-0 flex-1 overflow-y-auto pb-12', WORKSPACE_CONTENT_PADDING_X)}>{children}</div>
        </div>
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
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySortMode, setLibrarySortMode] = useState<LibrarySortMode>('recent')
  const [archiveShelfFilter, setArchiveShelfFilter] = useState<ArchiveShelfFilter>('all')
  const [libraryStructureRefreshing, setLibraryStructureRefreshing] = useState(false)
  const [materialSourceMode, setMaterialSourceMode] = useState<MaterialSourceMode>('bilibili')
  const [materialInventory, setMaterialInventory] = useState<MaterialInventory | null>(null)
  const [knowledgeInventory, setKnowledgeInventory] = useState<KnowledgeInventory | null>(null)
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [knowledgeLoading, setKnowledgeLoading] = useState(false)
  const [knowledgeError, setKnowledgeError] = useState('')
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)
  const [promptPreviewModuleId, setPromptPreviewModuleId] = useState<string | null>(null)
  const [promptPreviewFileId, setPromptPreviewFileId] = useState<string | null>(null)
  const [promptPreviewContent, setPromptPreviewContent] = useState('')
  const [promptPreviewLoading, setPromptPreviewLoading] = useState(false)
  const [promptPreviewError, setPromptPreviewError] = useState('')
  const promptPreviewCacheRef = useRef<Record<string, string>>({})
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
    if (view !== 'workbench' && view !== 'settings') return
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
        setKnowledgeError(error instanceof Error ? error.message : '无法读取知识库。')
      })
      .finally(() => {
        if (alive) setKnowledgeLoading(false)
      })
    return () => {
      alive = false
    }
  }, [runtimeSettings?.output_dir, view])

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
        milestoneTitle: record.recentMilestones[0]?.title ?? '学习档案已经完整归档',
      }))
  }, [archivedLibraryRecords])
  const archiveActivityPeak = useMemo(
    () => Math.max(1, ...archiveWeeklyActivity.map((item) => item.count)),
    [archiveWeeklyActivity],
  )
  const featuredActiveRecord = useMemo(
    () => courseData && activeRecordId
      ? activeLibraryRecords.find((record) => record.id === activeRecordId) ?? null
      : null,
    [activeLibraryRecords, activeRecordId, courseData],
  )
  const visibleActiveLibraryRecords = useMemo(
    () => featuredActiveRecord
      ? activeLibraryRecords.filter((record) => record.id !== featuredActiveRecord.id)
      : activeLibraryRecords,
    [activeLibraryRecords, featuredActiveRecord?.id],
  )
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
  const coursePackageRootDir = useMemo(
    () => materialInventory?.coursePackageRootDir || (runtimeSettings?.output_dir ? `${runtimeSettings.output_dir}\\courses` : '请先在设置中配置输出目录'),
    [materialInventory?.coursePackageRootDir, runtimeSettings?.output_dir],
  )
  const sortedMaterialRecords = useMemo<MaterialInventoryRecord[]>(() => {
    return [...(materialInventory?.records ?? [])].sort((left, right) => right.updatedAt - left.updatedAt)
  }, [materialInventory?.records])
  const promptPreviewSource = useMemo<PromptPreviewSource | null>(() => {
    if (lastMaterialResult?.materialPath) {
      return {
        path: lastMaterialResult.materialPath,
        title: lastMaterialResult.title || '最新原材料包',
        sourceId: lastMaterialResult.bvid,
        workflowStageLabel: '刚生成',
      }
    }

    const fallbackRecord = sortedMaterialRecords[0]
    if (!fallbackRecord) return null

    return {
      path: fallbackRecord.path,
      title: fallbackRecord.title,
      sourceId: fallbackRecord.sourceId,
      updatedAt: fallbackRecord.updatedAt,
      workflowStageLabel: fallbackRecord.workflowStageLabel,
    }
  }, [
    lastMaterialResult?.bvid,
    lastMaterialResult?.materialPath,
    lastMaterialResult?.title,
    sortedMaterialRecords,
  ])
  const promptPreviewModules = useMemo(
    () => (promptPreviewSource ? buildPromptPreviewModules(promptPreviewSource.path) : []),
    [promptPreviewSource],
  )
  const selectedPromptPreviewModule = useMemo(() => {
    if (!promptPreviewModules.length) return null
    return promptPreviewModules.find((module) => module.id === promptPreviewModuleId) ?? promptPreviewModules[0]
  }, [promptPreviewModuleId, promptPreviewModules])
  const selectedPromptPreviewFile = useMemo(() => {
    if (!selectedPromptPreviewModule) return null
    return selectedPromptPreviewModule.files.find((file) => file.id === promptPreviewFileId)
      ?? selectedPromptPreviewModule.files[0]
      ?? null
  }, [promptPreviewFileId, selectedPromptPreviewModule])
  const expectedKnowledgeBriefPath = useMemo(
    () => lastMaterialResult?.materialPath ? `${lastMaterialResult.materialPath}\\content_draft\\learning_notes.md` : '',
    [lastMaterialResult?.materialPath],
  )
  const knowledgeBriefDialogTitle = knowledgeBriefKind === 'chapter_map' ? '章节思维导图' : '学习笔记'
  const knowledgeBriefOutlineLabel = knowledgeBriefKind === 'chapter_map' ? '思维导图目录' : '目录'
  const knowledgeBriefSearchPlaceholder = knowledgeBriefKind === 'chapter_map' ? '搜索思维导图中的关键词' : '搜索正文中的关键词'
  const knowledgeBriefHeadingIdPrefix = knowledgeBriefKind === 'chapter_map' ? 'chapter-map' : 'knowledge-brief'
  const knowledgeBriefContentTransform = knowledgeBriefKind === 'chapter_map' ? identityMarkdownContent : undefined
  const runtimeModeLabel = window.desktopAPI.isElectron ? '原生桌面端' : '浏览器预览'

  useEffect(() => {
    if (!promptPreviewOpen || !selectedPromptPreviewFile) return

    const targetPath = selectedPromptPreviewFile.path
    const cached = promptPreviewCacheRef.current[targetPath]
    if (cached !== undefined) {
      setPromptPreviewContent(cached)
      setPromptPreviewError('')
      setPromptPreviewLoading(false)
      return
    }

    let alive = true
    setPromptPreviewContent('')
    setPromptPreviewError('')
    setPromptPreviewLoading(true)

    window.desktopAPI.readTextFile(targetPath)
      .then((text) => {
        if (!alive) return
        promptPreviewCacheRef.current[targetPath] = text
        setPromptPreviewContent(text)
      })
      .catch((error) => {
        if (!alive) return
        setPromptPreviewError(error instanceof Error ? error.message : '读取提示词文件失败')
      })
      .finally(() => {
        if (alive) setPromptPreviewLoading(false)
      })

    return () => {
      alive = false
    }
  }, [promptPreviewOpen, selectedPromptPreviewFile])

  const currentDistillStageIndex = useMemo(
    () => resolveDistillStagePosition(distillProgressSnapshot?.stage),
    [distillProgressSnapshot?.stage],
  )

  const handleDeleteRecord = async (recordId: string, title: string) => {
    const shouldDelete = globalThis.confirm(`确定删除《${title}》的学习档案吗？这会移除本地进度、对话缓存和关联学习包。`)
    if (!shouldDelete) return
    await deleteSavedRecord(recordId)
    try {
      setMaterialInventory(await window.desktopAPI.listMaterialPackages())
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
          '学习档案结构已刷新',
          `已更新 ${result.recordUpdates} 份学习档案，触达 ${result.packageUpdates} 个学习包文件。`,
          'success',
        )
      } else {
        pushToast(
          '结构已是最新',
          result.scannedPackages > 0 ? `已检查 ${result.scannedPackages} 个现成学习包，没有发现需要升级的旧结构。` : '当前学习档案和学习包已经是新的主线结构。',
          'info',
        )
      }
    } catch (error) {
      pushToast('刷新失败', error instanceof Error ? error.message : '批量刷新学习档案结构失败。', 'error')
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

  const handleDeleteMaterialPackage = async (record: MaterialInventory['records'][number]) => {
    const willDeleteMaterialPackage =
      record.workflowStage === 'material_ready' &&
      !record.synthesisPlanExists &&
      !record.knowledgeBriefExists &&
      !record.chapterMapExists &&
      !record.knowledgeImported &&
      !record.finalCourseExists &&
      !record.publishedCourseExists &&
      !record.importReadyCourseExists
    const shouldDelete = globalThis.confirm(
      willDeleteMaterialPackage
        ? `确定彻底删除《${record.title}》的原材料包吗？这会移除字幕、转写、blocks 和提示词入口。`
        : `确定清理《${record.title}》的学习笔记产物吗？字幕、转写和 blocks 会保留，工作台会退回待整理状态。`,
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
      pushToast(
        willDeleteMaterialPackage ? '原材料包已删除' : '学习产物已清理',
        willDeleteMaterialPackage ? record.title : '已保留原材料包，可重新复制提示词制作。',
        'success',
      )
    } catch (error) {
      pushToast('清理失败', error instanceof Error ? error.message : '无法清理这条整理记录。', 'error')
    }
  }

  const handlePickLocalMedia = async () => {
    const result = await window.desktopAPI.pickMediaFile()
    if (!result) return
    setMaterialSourceMode('local_media')
    setVideoInput(result.path)
    pushToast('已选择本地文件', result.name, 'success')
  }

  const handleRefreshPromptPreviewSource = async () => {
    try {
      promptPreviewCacheRef.current = {}
      const result = await window.desktopAPI.listMaterialPackages()
      setMaterialInventory(result)
      pushToast('配置预览已刷新', '已重新扫描 output/materials 下的原材料包。', 'success')
    } catch (error) {
      pushToast('刷新失败', error instanceof Error ? error.message : '无法重新读取材料包列表。', 'error')
    }
  }

  const handleOpenPromptPreview = (moduleId: string) => {
    const targetModule = promptPreviewModules.find((module) => module.id === moduleId)
    const firstFile = targetModule?.files[0]
    if (!targetModule || !firstFile) {
      pushToast('暂无可预览配置', '请先生成新的 canonical 原材料包。', 'info')
      return
    }
    setPromptPreviewModuleId(targetModule.id)
    setPromptPreviewFileId(firstFile.id)
    setPromptPreviewOpen(true)
  }

  const handleCopyPromptPreviewFile = async () => {
    if (!promptPreviewContent || !selectedPromptPreviewFile) return
    try {
      await copyTextToClipboard(promptPreviewContent)
      pushToast('配置文件已复制', selectedPromptPreviewFile.label, 'success')
    } catch {
      pushToast('复制失败', '可以在弹窗中手动选中文本复制。', 'error')
    }
  }

  const handleRevealPromptPreviewFile = () => {
    if (!selectedPromptPreviewFile) return
    void window.desktopAPI.showItem(selectedPromptPreviewFile.path)
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

  const handleOpenKnowledgeBrief = async (record: MaterialInventoryRecord) => {
    await handleOpenMarkdownDocument(record.title, record.knowledgeBriefPath, 'brief')
  }

  const handleOpenKnowledgeRecord = async (record: KnowledgeInventoryRecord) => {
    await handleOpenMarkdownDocument(record.title, record.libraryPath, 'brief')
  }

  const handleCopyMarkdownDocument = async () => {
    if (!knowledgeBriefContent) return
    try {
      await copyTextToClipboard(knowledgeBriefContent)
      pushToast(knowledgeBriefKind === 'chapter_map' ? '章节思维导图已复制' : '学习笔记已复制', knowledgeBriefTitle, 'success')
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
      if (!record.knowledgeImported && !record.pipelineReady) {
        throw new Error('学习笔记还未通过机器验证，请先查看验证报告并继续加厚。')
      }
      const [briefContent, chapterMapContent] = await Promise.all([
        window.desktopAPI.readTextFile(record.knowledgeBriefPath),
        record.chapterMapExists
          ? window.desktopAPI.readTextFile(record.chapterMapPath).catch(() => '')
          : Promise.resolve(''),
      ])
      const course = buildLearningNotesStudyPackage({
        title: record.title,
        sourceId: record.sourceId,
        materialPath: record.path,
        sourcePath: record.knowledgeBriefPath,
        briefContent,
        chapterMapContent,
      })

      await loadCourseFromText(JSON.stringify(course, null, 2), null)
      await refreshLibrary()
      setMaterialInventory(await window.desktopAPI.listMaterialPackages())
      pushToast('已进入学习台', record.title, 'success')
      onRequestLearn()
    } catch (error) {
      pushToast('进入学习失败', error instanceof Error ? error.message : '无法把学习笔记载入学习台。', 'error')
    }
  }

  const handleCopyCodexSynthesisPrompt = async (record: MaterialInventoryRecord) => {
    try {
      if (window.desktopAPI.copyTextFile) {
        await window.desktopAPI.copyTextFile(record.codexGoalPromptPath)
      } else {
        const text = await window.desktopAPI.readTextFile(record.codexGoalPromptPath)
        await copyTextToClipboard(text)
      }
      pushToast('学习笔记提示已复制', record.title, 'success')
    } catch (error) {
      pushToast(
        '复制失败',
        error instanceof Error ? error.message : '请打开 authoring/02_start_codex_synthesis.md 手动复制。',
        'error',
      )
    }
  }

  const handleRefreshKnowledgeLibrary = async () => {
    setKnowledgeLoading(true)
    setKnowledgeError('')
    try {
      setKnowledgeInventory(await window.desktopAPI.listKnowledgeLibrary())
    } catch (error) {
      setKnowledgeError(error instanceof Error ? error.message : '无法刷新知识库。')
    } finally {
      setKnowledgeLoading(false)
    }
  }

  const handleLocateGeneratedKnowledgeBrief = async () => {
    if (!expectedKnowledgeBriefPath) return
    try {
      await window.desktopAPI.showItem(expectedKnowledgeBriefPath)
      pushToast('学习笔记已定位', '生成后可以在整理记录中开始学习。', 'success')
    } catch (error) {
      pushToast(
        '还没有找到学习笔记',
        error instanceof Error ? error.message : '请先让 Codex 完成 content_draft/learning_notes.md。',
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
        pushToast('还没有地图提示词', '这份学习包里暂时没有 `course_visual_map.prompt`。', 'error')
        return
      }
      await copyTextToClipboard(prompt)
      pushToast('地图提示词已复制', `《${title}》现在可以去生成全局学习地图。`, 'success')
    } catch (error) {
      pushToast('复制失败', error instanceof Error ? error.message : '无法读取这份学习包。', 'error')
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
    return (
      <CoachPane
        showHome={showLearningHome}
        onStartLearning={onRequestLearn}
        onOpenWorkbench={onRequestWorkbench}
        onOpenArchive={onRequestArchive}
      />
    )
  }

  if (view === 'workbench') {
    return (
      <WorkspaceShell
        eyebrow="Workbench"
        title="工作台"
        windowFocused={windowFocused}
      >
        <div className="grid min-h-0 w-full grid-cols-1 gap-8">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
                <img src={courseIcon} alt="" className="size-4 opacity-90" />
                学习笔记
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
                    整理记录
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
                      aria-label="打开导入目录"
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
                      aria-label="刷新整理记录"
                      title="刷新整理记录"
                    >
                      <RefreshCcw size={12} />
                    </Button>
                  </div>
                </div>

                <div className="subtle-scrollbar grid max-h-[310px] gap-2 overflow-y-auto pr-1">
                  {materialInventory?.records.length ? (
                    materialInventory.records.map((record) => {
                      const statusLabel = record.workflowStageLabel || (
                        record.knowledgeImported
                          ? '学习笔记已可学习'
                          : record.knowledgeBriefExists && record.chapterMapExists
                            ? '笔记与思维导图已就绪'
                            : record.chapterMapExists
                              ? '章节思维导图已就绪'
                              : record.knowledgeBriefExists
                                ? '学习笔记可阅读'
                                : record.codexCoursePlanExists
                                  ? '笔记计划已就绪'
                                  : '待 Codex 整理'
                      )
                      const statusClass = (() => {
                        if (record.workflowStage === 'knowledge_ready' || record.knowledgeImported) {
                          return 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100'
                        }
                        if (
                          record.workflowStage === 'needs_restructure' ||
                          record.workflowStage === 'needs_deepening' ||
                          record.workflowStage === 'dossier_incomplete'
                        ) {
                          return 'border-amber-400/18 bg-amber-400/[0.08] text-amber-100'
                        }
                        if (record.workflowStage === 'summary_ready' || record.workflowStage === 'brief_ready' || record.knowledgeBriefExists) {
                          return 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100'
                        }
                        if (record.workflowStage === 'map_ready' || record.chapterMapExists) {
                          return 'border-sky-400/18 bg-sky-400/[0.08] text-sky-100'
                        }
                        if (record.workflowStage === 'codex_plan_ready' || record.codexCoursePlanExists) {
                          return 'border-sky-400/18 bg-sky-400/[0.08] text-sky-100'
                        }
                        if (
                          record.workflowStage === 'knowledge_tree_ready' ||
                          record.workflowStage === 'coverage_ready' ||
                          record.workflowStage === 'dossier_ready' ||
                          record.workflowStage === 'partial_learning_notes'
                        ) {
                          return 'border-sky-400/18 bg-sky-400/[0.08] text-sky-100'
                        }
                        if (record.workflowStage === 'material_ready') {
                          return 'border-violet-400/18 bg-violet-400/[0.08] text-violet-100'
                        }
                        return ''
                      })()
                      const canCopySummaryPrompt = Boolean(record.codexGoalPromptPath)
                      const canOpenBrief =
                        record.knowledgeImported ||
                        (record.workflowStage === 'learning_notes_ready' && record.pipelineReady) ||
                        record.workflowStage === 'knowledge_ready' ||
                        record.workflowStage === 'summary_ready'
                      const productionButtonLabel = (() => {
                        switch (record.workflowStage) {
                          case 'knowledge_tree_ready':
                            return '映射材料'
                          case 'coverage_ready':
                            return '生成章节材料'
                          case 'needs_restructure':
                            return '修知识树'
                          case 'dossier_ready':
                            return '深写章节'
                          case 'partial_learning_notes':
                            return '继续深写'
                          case 'needs_deepening':
                            return '继续加厚'
                          case 'dossier_incomplete':
                            return '补章节材料'
                          default:
                            return record.codexCoursePlanExists ? '继续整理' : '开始整理'
                        }
                      })()
                      const willDeleteMaterialPackage =
                        record.workflowStage === 'material_ready' &&
                        !record.synthesisPlanExists &&
                        !record.knowledgeBriefExists &&
                        !record.chapterMapExists &&
                        !record.knowledgeImported &&
                        !record.finalCourseExists &&
                        !record.publishedCourseExists &&
                        !record.importReadyCourseExists
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
                                aria-label={willDeleteMaterialPackage ? '删除原材料包' : '清理学习产物'}
                                title={willDeleteMaterialPackage ? '删除原材料包' : '清理学习产物'}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2">
                            {canOpenBrief ? (
                              <Button
                                size="sm"
                                className="justify-center rounded-xl px-3"
                                onClick={() => void handleOpenKnowledgeBriefInLearning(record)}
                              >
                                <GraduationCap size={13} />
                                开始学习
                              </Button>
                            ) : canCopySummaryPrompt ? (
                              <Button size="sm" className="justify-center rounded-xl px-3" onClick={() => void handleCopyCodexSynthesisPrompt(record)}>
                                <Clipboard size={13} />
                                {productionButtonLabel}
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="justify-center rounded-xl px-3" disabled>
                                <LoaderCircle size={13} />
                                等待材料
                              </Button>
                            )}
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

        </div>
      </WorkspaceShell>
    )
  }

  if (view === 'knowledge') {
    return (
      <WorkspaceShell
        eyebrow="Knowledge"
        title="知识库"
        description="这里收纳已经确认可用的学习笔记。它们同时存在于本地文件夹和透明索引中，方便你直接阅读、搜索和定位源材料。"
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
            打开知识库目录
          </Button>
        }
      >
        <div className="grid w-full gap-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[16px] border border-white/7 bg-white/[0.025] p-4">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <FileText size={13} />
                学习笔记
              </div>
              <div className="mt-2 text-[24px] font-semibold text-foreground">{knowledgeInventory?.records.length ?? 0}</div>
            </div>
            <div className="rounded-[16px] border border-white/7 bg-white/[0.025] p-4">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Search size={13} />
                正文字数
              </div>
              <div className="mt-2 text-[24px] font-semibold text-foreground">{formatCompactNumber(knowledgeTotalTextLength)}</div>
            </div>
            <div className="rounded-[16px] border border-white/7 bg-white/[0.025] p-4">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <FolderOpen size={13} />
                索引
              </div>
              <button
                type="button"
                className="mt-2 block max-w-full truncate text-left text-[12px] leading-6 text-muted-foreground hover:text-foreground"
                disabled={!knowledgeInventory?.libraryPath}
                onClick={() => knowledgeInventory?.libraryPath ? void window.desktopAPI.showItem(knowledgeInventory.libraryPath) : undefined}
              >
                {knowledgeInventory?.libraryPath || 'knowledge_library.json'}
              </button>
            </div>
          </div>

          <Card className="rounded-[10px] border-white/[0.09] bg-[#1f1f1f] shadow-none">
            <CardContent className="grid gap-4 p-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Field label="搜索学习笔记" icon={<Search size={14} />}>
                  <Input
                    value={knowledgeQuery}
                    onChange={(event) => setKnowledgeQuery(event.target.value)}
                    placeholder="搜索标题、来源、正文关键词"
                  />
                </Field>
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    disabled={knowledgeLoading}
                    onClick={() => void handleRefreshKnowledgeLibrary()}
                  >
                    {knowledgeLoading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCcw size={14} />}
                    刷新
                  </Button>
                </div>
              </div>

              <div className="rounded-[12px] border border-white/6 bg-black/10 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                知识库目录：{knowledgeRootDir}
              </div>

              {knowledgeError ? (
                <div className="rounded-[14px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-[12px] leading-6 text-destructive-foreground">
                  {knowledgeError}
                </div>
              ) : null}

              {knowledgeLoading && !knowledgeInventory ? (
                <div className="flex min-h-[220px] items-center justify-center gap-2 text-[12px] text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  正在读取知识库
                </div>
              ) : filteredKnowledgeRecords.length ? (
                <div className="grid gap-3">
                  {filteredKnowledgeRecords.map((record) => (
                    <div key={record.id} className="rounded-[18px] border border-white/[0.075] bg-[linear-gradient(180deg,rgba(31,31,31,0.92),rgba(24,24,24,0.96))] p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-emerald-400/14 bg-emerald-400/[0.07] text-emerald-100">
                              <FileText size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[14px] font-semibold text-foreground">{record.title}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                {record.sourceId ? <span>{record.sourceId}</span> : null}
                                <span>{formatCompactNumber(record.textLength)} 字</span>
                                <span>{formatRelativeTime(record.updatedAt)}</span>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={record.fileExists
                                ? 'border-emerald-400/16 bg-emerald-400/[0.08] text-emerald-100'
                                : 'border-amber-400/18 bg-amber-400/[0.08] text-amber-100'}
                            >
                              {record.fileExists ? '可阅读' : '文件缺失'}
                            </Badge>
                          </div>

                          <p className="line-clamp-3 text-[12px] leading-6 text-muted-foreground">
                            {record.preview || '这篇学习笔记还没有可用预览。'}
                          </p>

                          <div className="grid gap-1 text-[10px] text-muted-foreground">
                            <div className="truncate">学习笔记：{record.libraryPath}</div>
                            <div className="truncate">材料包：{record.materialPath}</div>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="rounded-xl"
                            disabled={!record.fileExists}
                            onClick={() => void handleOpenKnowledgeRecord(record)}
                          >
                            <Eye size={13} />
                            阅读
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            disabled={!record.libraryPath}
                            onClick={() => void window.desktopAPI.showItem(record.libraryPath)}
                          >
                            <FolderOpen size={13} />
                            定位
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            disabled={!record.materialPath}
                            onClick={() => void window.desktopAPI.openPath(record.materialPath)}
                          >
                            <PackageOpen size={13} />
                            材料
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[18px] border border-white/6 bg-black/10 px-4 py-8 text-center">
                  <FileText className="size-8 text-muted-foreground/70" />
                  <div className="text-[13px] font-semibold text-foreground">
                    {knowledgeQuery.trim() ? '没有匹配的学习笔记' : '知识库还是空的'}
                  </div>
                  <div className="max-w-md text-[12px] leading-6 text-muted-foreground">
                    先在工作台生成学习笔记，点击“开始学习”后，就会进入学习档案。
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </WorkspaceShell>
    )
  }

  if (view === 'archive') {
    const otherActiveRecords = visibleActiveLibraryRecords

    return (
      <WorkspaceShell
        eyebrow="Archive"
        title="学习档案"
        windowFocused={windowFocused}
      >
        <div className="grid w-full gap-8">
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
              <img src={archiveCurrentCourseIcon} alt="" className="size-4 opacity-90" />
              当前学习
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-xl hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void handleDeleteRecord(featuredActiveRecord.id, featuredActiveRecord.title)}
                  >
                    <Trash2 size={13} />
                    删除
                  </Button>
                  <Button size="sm" className="rounded-xl" onClick={onRequestLearn}>
                    <Sparkles size={13} />
                    继续学习
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-[18px] border border-white/6 bg-white/[0.015] px-4 py-3 text-[13px] leading-6 text-muted-foreground">
                还没有正在学习的档案。
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
              <img src={archiveOtherCoursesIcon} alt="" className="size-4 opacity-90" />
              其他学习
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
                当前没有其他已录入的进行中学习档案。
              </div>
            )}
          </section>
        </div>
      </WorkspaceShell>
    )
  }



  return (
    <>
      <WorkspaceShell
        eyebrow="Settings"
        title="设置"
        windowFocused={windowFocused}
      >
        <div className="grid w-full gap-7">
          <SettingsBlock title="当前配置" className="order-0">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              ['运行模式', runtimeModeLabel],
              ['输出目录', settingsDraft.output_dir || runtimeSettings?.output_dir || '未设置'],
              ['材料目录', materialRootDir],
              ['学习包目录', coursePackageRootDir],
              ['Obsidian Vault', settingsDraft.obsidian_vault_path || '未配置'],
              ['TTS', settingsDraft.tts_provider === 'mimo' ? 'MiMo' : 'MiniMax'],
              ['转写引擎', settingsDraft.transcription_provider === 'local_sensevoice' ? '本地 SenseVoice' : settingsDraft.transcription_provider],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
                <div className="mt-1 break-all text-[12px] leading-5 text-foreground/92">{value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] leading-5 text-muted-foreground">
            <span>{settingsStatusLoading ? '正在读取 B 站状态' : settingsStatus?.bilibili.message || 'B 站状态尚未刷新'}</span>
            {settingsStatus?.bilibili ? (
              <Badge
                variant="outline"
                className={cn(
                  'h-5 border-white/0 bg-black/18 px-2 text-[10px]',
                  settingsStatus.bilibili.valid
                    ? 'text-emerald-100'
                    : settingsStatus.bilibili.configured
                      ? 'text-amber-100'
                      : 'text-foreground/70',
                )}
              >
                {settingsStatus.bilibili.valid ? '已验证' : settingsStatus.bilibili.configured ? '待验证' : '未配置'}
              </Badge>
            ) : null}
            {settingsStatus?.bilibili.accountName ? <span>账号：{settingsStatus.bilibili.accountName}</span> : null}
            {settingsStatus?.bilibili.accountId ? <span>ID：{settingsStatus.bilibili.accountId}</span> : null}
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void refreshSettingsStatus()} disabled={settingsStatusLoading}>
              <RefreshCcw size={12} />
              刷新账号状态
            </Button>
          </div>

          {settingsStatusError ? (
            <div className="rounded-[10px] border border-amber-400/18 bg-amber-400/[0.08] px-3 py-2 text-[12px] leading-5 text-amber-100">
              {settingsStatusError}
            </div>
          ) : null}
          </SettingsBlock>

          <SettingsBlock title="配置预览" className="order-2">
          <div className="grid gap-4">
            <div className="flex flex-col gap-3 rounded-[10px] border border-white/[0.07] bg-white/[0.025] p-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-foreground">
                  <FileText size={14} />
                  当前配置源
                  {promptPreviewSource ? (
                    <Badge variant="outline" className="border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100">
                      新主线
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 truncate text-[12px] leading-5 text-muted-foreground">
                  {promptPreviewSource ? `${promptPreviewSource.title} · ${promptPreviewSource.path}` : `材料目录：${materialRootDir}`}
                </div>
                {promptPreviewSource ? (
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] leading-5 text-muted-foreground/80">
                    {promptPreviewSource.sourceId ? <span>{promptPreviewSource.sourceId}</span> : null}
                    {promptPreviewSource.workflowStageLabel ? <span>{promptPreviewSource.workflowStageLabel}</span> : null}
                    {promptPreviewSource.updatedAt ? <span>{formatRelativeTime(promptPreviewSource.updatedAt)}</span> : null}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => void handleRefreshPromptPreviewSource()}
                >
                  <RefreshCcw size={13} />
                  刷新
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  disabled={!promptPreviewSource}
                  onClick={() => promptPreviewSource ? void window.desktopAPI.openPath(promptPreviewSource.path) : undefined}
                >
                  <FolderOpen size={13} />
                  打开目录
                </Button>
              </div>
            </div>

            {promptPreviewModules.length ? (
              <div className="grid gap-3 md:grid-cols-3">
                {promptPreviewModules.map((module) => (
                  <div key={module.id} className="grid gap-3 rounded-[10px] border border-white/[0.07] bg-black/10 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-[13px] font-semibold text-foreground">{module.title}</div>
                        <Badge variant="outline" className="border-white/[0.08] bg-white/[0.035] text-muted-foreground">
                          {module.files.length} 个文件
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{module.summary}</p>
                    </div>
                    <div className="grid gap-1.5">
                      {module.files.slice(0, 3).map((file) => (
                        <div key={file.id} className="truncate rounded-lg bg-white/[0.035] px-2 py-1 text-[10px] font-mono text-muted-foreground/80">
                          {file.path.replace(promptPreviewSource?.path ?? '', '').replace(/^[\\/]+/, '')}
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-auto rounded-xl"
                      onClick={() => handleOpenPromptPreview(module.id)}
                    >
                      <Eye size={13} />
                      浏览
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[10px] border border-white/[0.07] bg-black/10 px-3 py-3 text-[12px] leading-6 text-muted-foreground">
                生成新的材料包后，这里会按总结工作流、总结产物、只读审计三个模块显示可浏览配置。
              </div>
            )}
          </div>
          </SettingsBlock>

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
                  备用云端朗读
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
                <Field label="备用服务 API Key" icon={<Server size={14} />} className="md:col-span-2">
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
                { id: 'fast', title: '快速整理' },
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

          {settingsError ? (
            <div className="order-last rounded-[10px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
              {settingsError}
            </div>
          ) : null}
        </div>
      </WorkspaceShell>
      <PromptPreviewDialog
        open={promptPreviewOpen}
        onOpenChange={setPromptPreviewOpen}
        module={selectedPromptPreviewModule}
        selectedFileId={promptPreviewFileId}
        content={promptPreviewContent}
        loading={promptPreviewLoading}
        error={promptPreviewError}
        sourceTitle={promptPreviewSource?.title ?? '未选择材料包'}
        sourcePath={promptPreviewSource?.path ?? materialRootDir}
        onSelectFile={setPromptPreviewFileId}
        onCopyCurrent={() => void handleCopyPromptPreviewFile()}
        onRevealCurrent={handleRevealPromptPreviewFile}
      />
      <KnowledgeBriefDialog
        open={knowledgeBriefOpen}
        onOpenChange={setKnowledgeBriefOpen}
        title={knowledgeBriefTitle || '未命名学习笔记'}
        path={knowledgeBriefPath}
        content={knowledgeBriefContent}
        loading={knowledgeBriefLoading}
        error={knowledgeBriefError}
        dialogTitle={knowledgeBriefDialogTitle}
        outlineLabel={knowledgeBriefOutlineLabel}
        searchPlaceholder={knowledgeBriefSearchPlaceholder}
        contentTransform={knowledgeBriefContentTransform}
        headingIdPrefix={knowledgeBriefHeadingIdPrefix}
        onCopy={() => void handleCopyMarkdownDocument()}
        onReveal={handleRevealKnowledgeBrief}
      />
    </>
  )
}

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AudioLines,
  ArchiveRestore,
  Bot,
  Cookie,
  FileUp,
  FlaskConical,
  FolderOpen,
  KeyRound,
  Link2,
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
  DEFAULT_MINIMAX_BASE_URL,
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

function buildInitialDraft(runtimeSettings: RuntimeSettingsFallback) {
  return {
    sessdata: runtimeSettings?.sessdata || '',
    output_dir: runtimeSettings?.output_dir || '',
    coach_api_base_url: runtimeSettings?.coach_api_base_url || DEFAULT_MINIMAX_BASE_URL,
    coach_api_key: runtimeSettings?.coach_api_key || '',
    coach_model: runtimeSettings?.coach_model || DEFAULT_COACH_MODEL,
    distiller_api_base_url: runtimeSettings?.distiller_api_base_url || DEFAULT_MINIMAX_BASE_URL,
    distiller_api_key: runtimeSettings?.distiller_api_key || '',
    distiller_model: runtimeSettings?.distiller_model || DEFAULT_DISTILLER_MODEL,
    groq_api_key: runtimeSettings?.groq_api_key || '',
    groq_transcription_model: runtimeSettings?.groq_transcription_model || DEFAULT_GROQ_TRANSCRIPTION_MODEL,
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

function buildRecordSearchText(record: LearningRecordSummary) {
  return [record.title, record.sourceTitle, record.sourceId, record.packageId, record.currentNodeTitle ?? '']
    .join(' ')
    .toLowerCase()
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
      <Card className={cn('flex min-h-0 w-full flex-col overflow-hidden rounded-l-[28px] rounded-r-none border-0 border-l border-t border-white/7 shadow-[-18px_0_44px_rgba(0,0,0,0.18)] transition-colors duration-200', windowFocused ? 'bg-[#151515]' : 'bg-[#131313]')}>
        <div className="flex items-start justify-between gap-4 border-b border-white/7 px-5 pb-3.5 pt-4.5">
          <div className="space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">{eyebrow}</div>
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="max-w-3xl text-[12px] leading-6 text-muted-foreground">{description}</p>
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
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group w-full rounded-[20px] border px-3.5 py-2.5 text-left transition',
        active
          ? 'border-white/10 bg-white/[0.045]'
          : 'border-white/6 bg-white/[0.02] hover:bg-white/[0.03]',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className={cn('size-1.5 rounded-full bg-white/35', active && 'bg-white/80')} />
            <div className="truncate text-[12px] font-semibold text-foreground">{record.title}</div>
            {record.isArchived ? <Badge variant="outline">已归档</Badge> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span>{record.sourceId || record.packageId}</span>
            <span>{getRecordProgressLabel(record)}</span>
            <span>{formatRelativeTime(record.lastOpenedAt)}</span>
          </div>

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

  const courseData = useLearningStore((state) => state.courseData)
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const videoInput = useLearningStore((state) => state.videoInput)
  const setVideoInput = useLearningStore((state) => state.setVideoInput)
  const distillCourseFromVideo = useLearningStore((state) => state.distillCourseFromVideo)
  const distillRequestState = useLearningStore((state) => state.distillRequestState)
  const distillStatusMessage = useLearningStore((state) => state.distillStatusMessage)
  const distillProgressPercent = useLearningStore((state) => state.distillProgressPercent)
  const distillError = useLearningStore((state) => state.distillError)
  const importCoursePackage = useLearningStore((state) => state.importCoursePackage)
  const libraryRecords = useLearningStore((state) => state.libraryRecords)
  const activeRecordId = useLearningStore((state) => state.activeRecordId)
  const openSavedRecord = useLearningStore((state) => state.openSavedRecord)
  const deleteSavedRecord = useLearningStore((state) => state.deleteSavedRecord)
  const setRuntimeSettings = useLearningStore((state) => state.setRuntimeSettings)
  const pushToast = useLearningStore((state) => state.pushToast)

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
            <Card className="glass-panel border-white/6 bg-white/[0.015]">
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
                  <div className="space-y-2">
                    <Progress value={Math.max(4, Math.min(100, distillProgressPercent || 4))} className="h-1.5 bg-white/7" />
                    <div className="text-[12px] text-muted-foreground">{distillStatusMessage || '正在抓取字幕、切片并重建课程知识树。'}</div>
                  </div>
                ) : null}
                {distillError ? (
                  <div className="rounded-[20px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                    {distillError}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="glass-panel border-white/6 bg-white/[0.015]">
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
          </div>

          <Card className="glass-panel border-white/6 bg-white/[0.015]">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                  <ArchiveRestore size={14} />
                  学习档案
                </div>
                {courseData ? (
                  <Button variant="outline" className="rounded-xl" onClick={onRequestLearn}>
                    <Sparkles size={14} />
                    返回学习台
                  </Button>
                ) : null}
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
                {filteredLibraryRecords.length ? (
                  filteredLibraryRecords.slice(0, 6).map((record) => (
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
                    {libraryQuery.trim() ? '没有匹配到学习记录。' : '还没有任何学习档案。先从上面的 BV 提炼开始也可以。'}
                  </div>
                )}
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
          <Field label="Groq API Key" icon={<AudioLines size={14} />}>
            <Input type="password" value={settingsDraft.groq_api_key} onChange={(event) => setSettingsDraft((current) => ({ ...current, groq_api_key: event.target.value }))} />
          </Field>
          <Field label="Transcription Model" icon={<AudioLines size={14} />}>
            <Input value={settingsDraft.groq_transcription_model} onChange={(event) => setSettingsDraft((current) => ({ ...current, groq_transcription_model: event.target.value }))} />
          </Field>
        </SettingsBlock>

        <SettingsBlock title="B 站凭据">
          <Field label="SESSDATA" icon={<Cookie size={14} />}>
            <Input type="password" value={settingsDraft.sessdata} onChange={(event) => setSettingsDraft((current) => ({ ...current, sessdata: event.target.value }))} />
          </Field>
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

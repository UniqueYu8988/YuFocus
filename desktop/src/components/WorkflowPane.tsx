import {
  Archive,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitBranch,
  Inbox,
  Mail,
  Route,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type WorkflowDocumentKey = Parameters<typeof window.desktopAPI.readWorkflowDocument>[0]
type WorkflowDocumentPayload = Awaited<ReturnType<typeof window.desktopAPI.readWorkflowDocument>>

type WorkflowNodeTone = 'local' | 'api' | 'output' | 'check'

type WorkflowNode = {
  title: string
  responsibility: string
  input: string
  output: string
  api: string
  file: string
  tone: WorkflowNodeTone
  icon: ReactNode
}

const shellPaddingX = 'px-16'
const shellMaxWidth = 'max-w-[1120px]'

const workflowDocuments: Array<{
  key: WorkflowDocumentKey
  label: string
  description: string
  icon: ReactNode
}> = [
  {
    key: 'agents',
    label: '查看工作入口',
    description: '任务流程、文档职责与安全红线',
    icon: <BookOpen size={14} />,
  },
  {
    key: 'product',
    label: '查看产品边界',
    description: '当前用途、保留能力与不可破坏行为',
    icon: <FileText size={14} />,
  },
  {
    key: 'architecture',
    label: '查看技术结构',
    description: '模块、数据流、外部服务与风险区域',
    icon: <GitBranch size={14} />,
  },
  {
    key: 'current_state',
    label: '查看当前状态',
    description: '当前阶段、风险、下一步和暂停事项',
    icon: <Route size={14} />,
  },
  {
    key: 'baseline_acceptance',
    label: '查看核心验收',
    description: '启动、队列、材料和数据安全基线',
    icon: <ShieldCheck size={14} />,
  },
  {
    key: 'stabilization_plan',
    label: '查看稳定化计划',
    description: '工作流闭环、验收收敛和阶段安排',
    icon: <Archive size={14} />,
  },
]

const longVideoRoute: WorkflowNode[] = [
  {
    title: '视频来源',
    responsibility: '读取 BV、关注源或本地音视频。',
    input: 'BV / URL / 本地文件',
    output: '视频元数据',
    api: 'B 站接口 / 本地文件',
    file: 'manifest.json',
    tone: 'local',
    icon: <Video size={16} />,
  },
  {
    title: '字幕获取 / 本地转写',
    responsibility: '优先取字幕，无字幕时进入 SenseVoice 转写。',
    input: '视频音轨 / 字幕轨',
    output: 'raw_transcript.txt',
    api: '本地转写可用',
    file: 'raw_tracks.json',
    tone: 'local',
    icon: <Inbox size={16} />,
  },
  {
    title: '字幕清洗',
    responsibility: '修断句、口癖和识别噪声，不总结、不扩写。',
    input: 'raw_transcript.txt',
    output: 'content.md',
    api: 'MiMo API / 规则',
    file: 'work/cleaning/',
    tone: 'api',
    icon: <Sparkles size={16} />,
  },
  {
    title: 'NotebookLM 导入稿',
    responsibility: '导出干净可读资料，供长视频外部分析。',
    input: 'content.md',
    output: 'exports/notebooklm.md',
    api: '不再深写',
    file: 'exports/notebooklm.md',
    tone: 'output',
    icon: <FileText size={16} />,
  },
]

const shortVideoRoute: WorkflowNode[] = [
  ...longVideoRoute.slice(0, 3),
  {
    title: '信息抽取',
    responsibility: '抽出观点、论证、例子、定义、背景和预测。',
    input: 'content.md',
    output: 'cards.json',
    api: 'MiMo API',
    file: 'summary/cards.json',
    tone: 'api',
    icon: <GitBranch size={16} />,
  },
  {
    title: '主编成稿',
    responsibility: '把结构化材料写成适合阅读的精品视频稿。',
    input: 'cards.json / mainline.md',
    output: 'article.md / article.html',
    api: 'MiMo API',
    file: 'summary/article.html',
    tone: 'api',
    icon: <FileText size={16} />,
  },
  {
    title: '邮件 / 档案 / 灵犀',
    responsibility: '归档、按来源索引，并用浅色 HTML 邮件推送。',
    input: 'summary/article.html',
    output: '档案 / 灵犀 / 邮件',
    api: 'SMTP',
    file: 'summary/summary_status.json',
    tone: 'output',
    icon: <Mail size={16} />,
  },
]

const principles = [
  '队列最多 3 个完整任务并行',
  '手动 BV 默认只清洗字幕',
  '收藏来源默认生成精读稿',
  '长视频只导出 NotebookLM 资料',
  '短视频才进入自动编稿',
  '邮件使用浅色 HTML + 纯文本兜底',
  '生成内容进入档案和灵犀',
]

function formatDocumentTime(timestamp: number) {
  if (!timestamp) return '未知时间'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getToneClass(tone: WorkflowNodeTone) {
  switch (tone) {
    case 'api':
      return 'border-cyan-300/16 bg-cyan-300/[0.045] text-cyan-50'
    case 'output':
      return 'border-emerald-300/16 bg-emerald-300/[0.045] text-emerald-50'
    case 'check':
      return 'border-amber-300/16 bg-amber-300/[0.045] text-amber-50'
    default:
      return 'border-white/[0.08] bg-white/[0.026] text-foreground'
  }
}

function WorkflowRoute({
  title,
  description,
  nodes,
}: {
  title: string
  description: string
  nodes: WorkflowNode[]
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{description}</p>
        </div>
        <Badge variant="outline" className="border-white/8 bg-white/[0.03] px-2 text-[10px] text-foreground/70">
          {nodes.length} 阶段
        </Badge>
      </div>

      <div className="grid gap-2 xl:grid-cols-[repeat(var(--workflow-count),minmax(0,1fr))]" style={{ '--workflow-count': nodes.length } as CSSProperties}>
        {nodes.map((node, index) => (
          <div key={`${title}-${node.title}`} className="grid min-w-0 gap-2 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className={cn('min-w-0 rounded-[12px] border p-3', getToneClass(node.tone))}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/8 bg-black/16 text-current">
                  {node.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{node.title}</div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{node.responsibility}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-1.5 text-[10px] leading-4 text-muted-foreground">
                <div className="truncate"><span className="text-foreground/64">输入：</span>{node.input}</div>
                <div className="truncate"><span className="text-foreground/64">输出：</span>{node.output}</div>
                <div className="truncate"><span className="text-foreground/64">调用：</span>{node.api}</div>
                <div className="truncate"><span className="text-foreground/64">文件：</span>{node.file}</div>
              </div>
            </div>
            {index < nodes.length - 1 ? (
              <div className="hidden items-center justify-center text-muted-foreground/55 xl:flex">
                <ChevronRight size={15} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

export function WorkflowPane({ windowFocused }: { windowFocused: boolean }) {
  const [activeDocumentKey, setActiveDocumentKey] = useState<WorkflowDocumentKey | null>(null)
  const [documentPayload, setDocumentPayload] = useState<WorkflowDocumentPayload | null>(null)
  const [documentLoading, setDocumentLoading] = useState(false)
  const [documentError, setDocumentError] = useState('')

  const activeDocumentMeta = useMemo(
    () => workflowDocuments.find((item) => item.key === activeDocumentKey) ?? null,
    [activeDocumentKey],
  )

  const handleOpenDocument = async (documentKey: WorkflowDocumentKey) => {
    setActiveDocumentKey(documentKey)
    setDocumentLoading(true)
    setDocumentError('')
    setDocumentPayload(null)
    try {
      const payload = await window.desktopAPI.readWorkflowDocument(documentKey)
      setDocumentPayload(payload)
    } catch (error) {
      setDocumentError(error instanceof Error ? error.message : String(error))
    } finally {
      setDocumentLoading(false)
    }
  }

  return (
    <section className="flex min-h-0 flex-1">
      <Card className={cn('work-surface relative flex min-h-0 w-full flex-col overflow-hidden rounded-l-[18px] rounded-r-none border border-r-0 border-white/[0.065] bg-[#101010] shadow-none transition-colors duration-200', !windowFocused && 'bg-[#101010]')}>
        <div className={cn('relative mx-auto flex h-full w-full flex-col', shellMaxWidth)}>
          <div className={cn('relative flex w-full items-start justify-between gap-4 pb-7 pt-14', shellPaddingX)}>
            <div className="space-y-2">
              <div className="sr-only">Workflow</div>
              <h2 className="text-[26px] font-semibold tracking-tight text-foreground">流程</h2>
              <p className="max-w-3xl text-[13px] leading-6 text-muted-foreground">
                这里展示视界专注从视频、字幕清洗、API 编稿到归档和邮件推送的完整透明流程。
              </p>
            </div>
          </div>

          <div className={cn('subtle-scrollbar relative min-h-0 flex-1 overflow-y-auto pb-12', shellPaddingX)}>
            <div className="grid gap-6">
              <div className="grid gap-4 rounded-[14px] border border-white/[0.09] bg-[#1f1f1f] p-4">
                <WorkflowRoute
                  title="长视频路线"
                  description="只做字幕提取、忠实清洗和 NotebookLM 前置资料，不进入自动深度编稿。"
                  nodes={longVideoRoute}
                />
                <div className="h-px bg-white/[0.06]" />
                <WorkflowRoute
                  title="短视频路线"
                  description="适合关注源中的短视频，清洗后进入 MiMo API 编稿、归档和邮件推送。"
                  nodes={shortVideoRoute}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                <section className="rounded-[14px] border border-white/[0.09] bg-[#1f1f1f] p-4">
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                    <CheckCircle2 size={15} />
                    当前自动化原则
                  </h3>
                  <div className="mt-3 grid gap-2">
                    {principles.map((item) => (
                      <div key={item} className="flex items-center gap-2 rounded-[10px] border border-white/[0.06] bg-white/[0.022] px-3 py-2 text-[12px] text-foreground/88">
                        <span className="size-1.5 rounded-full bg-emerald-300/80 shadow-[0_0_8px_rgba(110,231,183,0.28)]" />
                        <span className="min-w-0 flex-1">{item}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-[14px] border border-white/[0.09] bg-[#1f1f1f] p-4">
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                    <FileText size={15} />
                    文件与提示词
                  </h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {workflowDocuments.map((document) => (
                      <button
                        key={document.key}
                        type="button"
                        className="group rounded-[12px] border border-white/[0.07] bg-white/[0.022] p-3 text-left transition-colors hover:border-cyan-200/18 hover:bg-cyan-300/[0.045]"
                        onClick={() => void handleOpenDocument(document.key)}
                        aria-label={document.label}
                        title={document.label}
                      >
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                          <span className="text-cyan-100/86">{document.icon}</span>
                          {document.label}
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{document.description}</p>
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              {activeDocumentKey ? (
                <section className="rounded-[14px] border border-white/[0.09] bg-[#1f1f1f]">
                  <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-semibold text-foreground">
                        {documentPayload?.title || activeDocumentMeta?.label || '流程文件'}
                      </h3>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {documentPayload
                          ? `${documentPayload.relativePath} · ${formatDocumentTime(documentPayload.updatedAt)}`
                          : activeDocumentMeta?.description}
                      </p>
                      {documentPayload?.path ? (
                        <p className="mt-1 truncate text-[10px] text-muted-foreground/70">{documentPayload.path}</p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 rounded-lg text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                      onClick={() => {
                        setActiveDocumentKey(null)
                        setDocumentPayload(null)
                        setDocumentError('')
                      }}
                      aria-label="关闭文件查看"
                      title="关闭文件查看"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                  <div className="max-h-[420px] overflow-auto p-4">
                    {documentLoading ? (
                      <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.018] px-3 py-2 text-[12px] text-muted-foreground">
                        正在读取真实文件…
                      </div>
                    ) : documentError ? (
                      <div className="rounded-[10px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-[12px] leading-5 text-destructive-foreground">
                        {documentError}
                      </div>
                    ) : (
                      <pre className="whitespace-pre-wrap break-words rounded-[10px] border border-white/[0.06] bg-black/18 p-3 font-mono text-[11px] leading-5 text-foreground/84">
                        {documentPayload?.content || '请选择一个文件。'}
                      </pre>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </Card>
    </section>
  )
}

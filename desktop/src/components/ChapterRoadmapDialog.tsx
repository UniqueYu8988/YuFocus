import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import chapterRoadmapIcon from '@/assets/learn-chapter-map.svg'
import { cn } from '@/lib/utils'
import type {
  ChapterRoadmap,
  ChapterRoadmapEdge,
  ChapterRoadmapNode,
  ChapterRoadmapRole,
  ChapterRoadmapTone,
  FlatCourseNode,
} from '@/types/course'

type RoadmapNodeView = ChapterRoadmapNode & {
  lesson?: FlatCourseNode | null
  completed?: boolean
  active?: boolean
}

const roleLabels: Record<string, string> = {
  foundation: '基础',
  concept: '概念',
  practice: '练习',
  risk: '风险',
  decision: '判断',
  review: '复盘',
  integration: '整合',
}

const toneStyles: Record<ChapterRoadmapTone, {
  card: string
  badge: string
  line: string
  halo: string
}> = {
  green: {
    card: 'border-emerald-300/20 bg-[linear-gradient(145deg,rgba(18,53,43,0.94),rgba(13,25,23,0.94))]',
    badge: 'bg-emerald-300/14 text-emerald-100',
    line: '#49d7b0',
    halo: 'shadow-[0_0_42px_rgba(73,215,176,0.10)]',
  },
  blue: {
    card: 'border-sky-300/20 bg-[linear-gradient(145deg,rgba(19,45,68,0.94),rgba(13,22,31,0.94))]',
    badge: 'bg-sky-300/14 text-sky-100',
    line: '#7dd3fc',
    halo: 'shadow-[0_0_42px_rgba(125,211,252,0.10)]',
  },
  purple: {
    card: 'border-violet-300/24 bg-[linear-gradient(145deg,rgba(45,34,70,0.94),rgba(22,18,31,0.94))]',
    badge: 'bg-violet-300/16 text-violet-100',
    line: '#bba7ff',
    halo: 'shadow-[0_0_46px_rgba(187,167,255,0.14)]',
  },
  amber: {
    card: 'border-amber-300/22 bg-[linear-gradient(145deg,rgba(61,45,22,0.94),rgba(27,22,15,0.94))]',
    badge: 'bg-amber-300/14 text-amber-100',
    line: '#e6b55f',
    halo: 'shadow-[0_0_42px_rgba(230,181,95,0.10)]',
  },
  rose: {
    card: 'border-rose-300/22 bg-[linear-gradient(145deg,rgba(63,30,42,0.94),rgba(29,17,23,0.94))]',
    badge: 'bg-rose-300/14 text-rose-100',
    line: '#ec8eb5',
    halo: 'shadow-[0_0_42px_rgba(236,142,181,0.10)]',
  },
  neutral: {
    card: 'border-white/12 bg-[linear-gradient(145deg,rgba(35,37,42,0.94),rgba(19,20,23,0.94))]',
    badge: 'bg-white/10 text-white/80',
    line: '#9ca3af',
    halo: 'shadow-[0_0_34px_rgba(255,255,255,0.06)]',
  },
}

type RoadmapPosition = {
  x: number
  y: number
  row: number
  col: number
}

type RoadmapLayout = {
  rows: number
  maxColumns: number
  gapPx: number
  cardHeight: number
  detailClamp: string
  positions: RoadmapPosition[]
}

function collectStudyNodes(chapter: FlatCourseNode, nodeMap: Record<string, FlatCourseNode>) {
  const collected: FlatCourseNode[] = []
  const visit = (node: FlatCourseNode) => {
    if (node.childIds.length === 0) {
      collected.push(node)
      return
    }

    node.childIds
      .map((childId) => nodeMap[childId])
      .filter(Boolean)
      .sort((left, right) => left.order - right.order)
      .forEach(visit)
  }

  visit(chapter)
  return collected
}

function fallbackTone(index: number): ChapterRoadmapTone {
  return (['green', 'purple', 'blue', 'amber', 'rose'] as const)[index % 5]
}

function fallbackRole(index: number, total: number): ChapterRoadmapRole {
  if (index === 0) return 'foundation'
  if (index === total - 1) return 'integration'
  return 'practice'
}

function buildFallbackRoadmap(chapter: FlatCourseNode, lessons: FlatCourseNode[]): ChapterRoadmap {
  const nodes = lessons.map((lesson, index) => ({
    id: `rm_${index + 1}`,
    lesson_id: lesson.id,
    title: lesson.title.split(/[：:]/u)[0].trim() || lesson.title,
    summary: lesson.summary,
    role: fallbackRole(index, lessons.length),
    tone: fallbackTone(index),
  }))

  return {
    roadmap_type: 'workflow',
    title: `${chapter.title}：章节思维导图`,
    subtitle: chapter.summary,
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      from: node.id,
      to: nodes[index + 1].id,
      kind: 'next',
    })),
    focus_cards: [
      {
        title: '这一章的学习主线',
        bullets: lessons.slice(0, 4).map((lesson) => lesson.summary || lesson.title),
      },
    ],
    completion_signals: chapter.learning_objectives?.length ? chapter.learning_objectives : [chapter.summary],
  }
}

function resolveRoadmapNodes(
  roadmap: ChapterRoadmap,
  lessons: FlatCourseNode[],
  completedNodeIds: string[],
  currentNodeId: string | null,
): RoadmapNodeView[] {
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]))
  return roadmap.nodes.map((node, index) => {
    const lesson = node.lesson_id ? lessonById.get(node.lesson_id) ?? null : null
    return {
      ...node,
      tone: node.tone ?? fallbackTone(index),
      role: node.role ?? (index === 0 ? 'foundation' : 'practice'),
      lesson,
      completed: Boolean(lesson && completedNodeIds.includes(lesson.id)),
      active: Boolean(lesson && currentNodeId === lesson.id),
    }
  })
}

function roadmapTypeLabel(type: ChapterRoadmap['roadmap_type']) {
  switch (type) {
    case 'operation_flow':
      return '操作路线'
    case 'exam_strategy':
      return '考试策略'
    case 'architecture_map':
      return '架构地图'
    case 'case_reasoning':
      return '病例推理'
    case 'argument_map':
      return '论证地图'
    case 'viewpoint_map':
      return '观点地图'
    case 'concept_map':
      return '概念地图'
    case 'decision_tree':
      return '判断路径'
    default:
      return '学习路线'
  }
}

function shortText(value: string | undefined, maxLength: number) {
  const text = (value || '').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
}

function getPreferredRowCount(count: number) {
  if (count <= 5) return 1
  if (count <= 10) return 2
  if (count <= 15) return 3
  return 4
}

function buildRowLengths(count: number, rows: number) {
  const base = Math.floor(count / rows)
  const remainder = count % rows
  return Array.from({ length: rows }, (_, index) => base + (index < remainder ? 1 : 0)).filter(Boolean)
}

function buildRoadmapLayout(count: number): RoadmapLayout {
  if (count <= 1) {
    return {
      rows: 1,
      maxColumns: 1,
      gapPx: 0,
      cardHeight: 220,
      detailClamp: 'line-clamp-4',
      positions: [{ x: 50, y: 50, row: 0, col: 0 }],
    }
  }

  const rows = getPreferredRowCount(count)
  const rowLengths = buildRowLengths(count, rows)
  const maxColumns = Math.max(...rowLengths)
  const gapPx = rows >= 3 ? 18 : 24
  const cardHeight = rows === 1 ? 220 : rows === 2 ? 178 : rows === 3 ? 150 : 132
  const detailClamp = rows === 1 ? 'line-clamp-4' : rows === 2 ? 'line-clamp-3' : 'line-clamp-2'
  const positions: RoadmapPosition[] = []
  let nodeIndex = 0

  rowLengths.forEach((length, row) => {
    const y = rows === 1 ? 50 : 18 + ((64 * row) / Math.max(rows - 1, 1))

    Array.from({ length }).forEach((_, col) => {
      const visualCol = row % 2 === 0 ? col : length - 1 - col
      positions[nodeIndex] = {
        x: ((visualCol + 0.5) / length) * 100,
        y,
        row,
        col: visualCol,
      }
      nodeIndex += 1
    })
  })

  return {
    rows,
    maxColumns,
    gapPx,
    cardHeight,
    detailClamp,
    positions,
  }
}

function buildRailLayout(count: number): RoadmapLayout {
  if (count <= 1) {
    return {
      rows: 1,
      maxColumns: 1,
      gapPx: 0,
      cardHeight: 58,
      detailClamp: 'line-clamp-1',
      positions: [{ x: 50, y: 76, row: 0, col: 0 }],
    }
  }

  const rows = count <= 6 ? 1 : count <= 12 ? 2 : 3
  const rowLengths = buildRowLengths(count, rows)
  const maxColumns = Math.max(...rowLengths)
  const positions: RoadmapPosition[] = []
  let nodeIndex = 0

  rowLengths.forEach((length, row) => {
    const y = rows === 1 ? 76 : rows === 2 ? 66 + row * 17 : 58 + row * 13
    Array.from({ length }).forEach((_, col) => {
      const visualCol = row % 2 === 0 ? col : length - 1 - col
      positions[nodeIndex] = {
        x: 8 + ((visualCol + 0.5) / length) * 84,
        y,
        row,
        col: visualCol,
      }
      nodeIndex += 1
    })
  })

  return {
    rows,
    maxColumns,
    gapPx: rows === 1 ? 18 : 12,
    cardHeight: rows === 1 ? 58 : 50,
    detailClamp: rows === 1 ? 'line-clamp-1' : 'line-clamp-1',
    positions,
  }
}

function toSvgPoint(position: RoadmapPosition) {
  return {
    x: position.x * 10,
    y: position.y * 5.2,
  }
}

function buildEdgeCandidates(nodes: RoadmapNodeView[], roadmap: ChapterRoadmap): ChapterRoadmapEdge[] {
  if (roadmap.edges?.length) return roadmap.edges
  return nodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: nodes[index + 1].id,
    kind: 'next',
  }))
}

function isGenericEdgeLabel(label: string | undefined) {
  return !label || /先会|前一步|下一步|继续|进入|然后|再学|承接/u.test(label)
}

function getRoleTransitionLabel(from: RoadmapNodeView | undefined, to: RoadmapNodeView | undefined) {
  const fromRole = from?.role ?? 'practice'
  const toRole = to?.role ?? 'practice'
  if (fromRole === 'foundation' && toRole === 'practice') return '打底后练习'
  if (fromRole === 'concept' && toRole === 'practice') return '概念变操作'
  if (fromRole === 'practice' && toRole === 'risk') return '练习后查错'
  if (fromRole === 'risk' && toRole === 'review') return '避坑后复盘'
  if (fromRole === 'decision') return '判断后执行'
  if (toRole === 'integration') return '收束成体系'
  if (toRole === 'decision') return '推进到判断'
  if (toRole === 'risk') return '引出风险'
  return '知识推进'
}

function getEdgeCaption(edge: ChapterRoadmapEdge, from?: RoadmapNodeView, to?: RoadmapNodeView) {
  const label = shortText(edge.label, 12)
  if (label && !isGenericEdgeLabel(label)) return label
  switch (edge.kind) {
    case 'depends_on':
      return '依赖'
    case 'contrast':
      return '对比'
    case 'risk':
      return '风险'
    case 'feedback':
      return '回看'
    case 'supports':
      return '支撑'
    case 'tension':
      return '张力'
    case 'tradeoff':
      return '取舍'
    default:
      return getRoleTransitionLabel(from, to)
  }
}

function getRelationSentence(
  edge: ChapterRoadmapEdge | undefined,
  from: RoadmapNodeView | undefined,
  to: RoadmapNodeView | undefined,
  direction: 'previous' | 'next',
) {
  if (!from || !to) return ''
  const label = edge?.label?.trim()
  if (label && !isGenericEdgeLabel(label)) {
    return direction === 'previous'
      ? `从「${getNodeTitle(from)}」过来：${label}。`
      : `走向「${getNodeTitle(to)}」：${label}。`
  }

  const fromAction = from.output_tag || from.action_tag || roleLabels[from.role ?? 'practice'] || getNodeTitle(from)
  const toAction = to.action_tag || to.output_tag || roleLabels[to.role ?? 'practice'] || getNodeTitle(to)
  return direction === 'previous'
    ? `上一节先处理「${shortText(fromAction, 14)}」，这一节接着把它推进到「${shortText(toAction, 14)}」。`
    : `学完这里得到「${shortText(fromAction, 14)}」，下一节会用它继续解决「${shortText(toAction, 14)}」。`
}

function getNodeTitle(node: RoadmapNodeView) {
  return shortText(node.map_label || node.title, 22)
}

function getNodeDetail(node: RoadmapNodeView) {
  return shortText(node.micro_question || node.summary || node.lesson?.summary || node.completion_signal, 52)
}

function getNodeFullDetail(node: RoadmapNodeView) {
  return (node.micro_question || node.summary || node.lesson?.summary || node.completion_signal || '').trim()
}

function getNodeSignal(node: RoadmapNodeView) {
  return (node.completion_signal || node.output_tag || node.lesson?.learning_objectives?.[0] || '').trim()
}

function getNodeTags(node: RoadmapNodeView) {
  return [
    node.action_tag || roleLabels[node.role ?? 'practice'],
    node.risk_tag,
    node.output_tag,
  ]
    .filter(Boolean)
    .slice(0, 2)
    .map((tag) => shortText(tag, 8))
}

function getDirectoryName(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

function toFileUrl(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  const withPrefix = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
  return encodeURI(withPrefix)
}

function resolveVisualAssetUri(uri: string | undefined, coursePackagePath?: string | null) {
  const value = (uri || '').trim()
  if (!value) return ''
  if (/^(data:|blob:|https?:|file:)/iu.test(value)) return value
  if (/^[a-zA-Z]:[\\/]/u.test(value) || value.startsWith('\\\\')) return toFileUrl(value)
  if (coursePackagePath) {
    const base = getDirectoryName(coursePackagePath)
    if (base) return toFileUrl(`${base}/${value.replace(/^\.?[\\/]/u, '')}`)
  }
  return value
}

export function ChapterRoadmapDialog({
  open,
  onOpenChange,
  chapter,
  nodeMap,
  completedNodeIds,
  currentNodeId,
  coursePackagePath,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chapter: FlatCourseNode | null
  nodeMap: Record<string, FlatCourseNode>
  completedNodeIds: string[]
  currentNodeId: string | null
  coursePackagePath?: string | null
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [imageFailed, setImageFailed] = useState(false)

  const lessons = chapter ? collectStudyNodes(chapter, nodeMap) : []
  const roadmap = chapter ? chapter.chapter_roadmap ?? buildFallbackRoadmap(chapter, lessons) : null
  const nodes = roadmap ? resolveRoadmapNodes(roadmap, lessons, completedNodeIds, currentNodeId) : []
  const currentIndex = Math.max(0, nodes.findIndex((node) => node.active))
  const layout = buildRailLayout(nodes.length)
  const positions = layout.positions
  const positionByNodeId = new Map(nodes.map((node, index) => [node.id, positions[index]]))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edgeCandidates = roadmap ? buildEdgeCandidates(nodes, roadmap) : []
  const selectedNode = nodes[Math.min(selectedIndex, Math.max(nodes.length - 1, 0))]
  const previousNode = selectedIndex > 0 ? nodes[selectedIndex - 1] : undefined
  const nextNode = selectedIndex < nodes.length - 1 ? nodes[selectedIndex + 1] : undefined
  const previousEdge = previousNode
    ? edgeCandidates.find((edge) => edge.from === previousNode.id && edge.to === selectedNode?.id)
    : undefined
  const nextEdge = nextNode
    ? edgeCandidates.find((edge) => edge.from === selectedNode?.id && edge.to === nextNode.id)
    : undefined
  const previousRelation = getRelationSentence(previousEdge, previousNode, selectedNode, 'previous')
  const nextRelation = getRelationSentence(nextEdge, selectedNode, nextNode, 'next')
  const selectedTags = selectedNode ? getNodeTags(selectedNode) : []
  const selectedTone = selectedNode?.tone ?? fallbackTone(selectedIndex)
  const selectedToneStyle = toneStyles[selectedTone]
  const selectedDetail = selectedNode ? getNodeFullDetail(selectedNode) : ''
  const selectedSignal = selectedNode ? getNodeSignal(selectedNode) : ''
  const visualAsset = roadmap?.visual_asset
  const visualAssetSrc = resolveVisualAssetUri(visualAsset?.uri, coursePackagePath)
  const shouldShowVisualAsset =
    visualAsset?.kind === 'image' &&
    visualAsset.status === 'attached' &&
    Boolean(visualAssetSrc) &&
    !imageFailed
  const shouldShowVisualPlan = Boolean(visualAsset && !shouldShowVisualAsset)

  useEffect(() => {
    if (!open || !nodes.length) return
    setSelectedIndex(currentIndex >= 0 ? currentIndex : 0)
  }, [open, chapter?.id, currentNodeId, currentIndex, nodes.length])

  useEffect(() => {
    setImageFailed(false)
  }, [visualAsset?.uri, visualAsset?.status, open])

  if (!chapter || !roadmap || !selectedNode) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(84vh,720px)] w-[min(92vw,1120px)] overflow-hidden rounded-[30px] border-white/8 bg-[#101115] p-0 shadow-[0_38px_140px_rgba(0,0,0,0.72)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,rgba(74,96,158,0.14),transparent_30%),radial-gradient(circle_at_84%_92%,rgba(38,122,88,0.10),transparent_30%)]" />
        <div className="relative flex h-full flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-5 px-8 pb-4 pt-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04]">
                <img src={chapterRoadmapIcon} alt="" className="size-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate text-[22px] font-bold tracking-tight text-foreground">
                  {chapter.title}
                </DialogTitle>
                <DialogDescription className="truncate text-[12px] leading-5 text-muted-foreground">
                  {roadmapTypeLabel(roadmap.roadmap_type)} · {lessons.length} 小节
                  {roadmap.subtitle ? ` · ${roadmap.subtitle}` : ''}
                </DialogDescription>
              </div>
            </div>
          </header>

          <div className="relative min-h-0 flex-1 px-7 pb-7">
            <section className="relative h-full overflow-hidden rounded-[28px] bg-[#0f1115]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(76,110,245,0.12),transparent_32%),radial-gradient(circle_at_78%_72%,rgba(71,180,141,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0))]" />
              <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
              <div className="pointer-events-none absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.045] to-transparent" />
              {shouldShowVisualAsset ? (
                <div className="relative z-10 flex h-full items-center justify-center px-8 py-7">
                  <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
                    <img
                      src={visualAssetSrc}
                      alt={visualAsset?.alt || roadmap.title}
                      className="max-h-full max-w-full object-contain drop-shadow-[0_28px_80px_rgba(0,0,0,0.36)]"
                      onError={() => setImageFailed(true)}
                    />
                    {visualAsset?.hotspots?.map((hotspot) => (
                      <button
                        type="button"
                        key={hotspot.id}
                        className="absolute rounded-xl border border-white/18 bg-black/10 text-[0px] outline-none transition hover:bg-white/10 focus:bg-white/12"
                        style={{
                          left: `${hotspot.x * 100}%`,
                          top: `${hotspot.y * 100}%`,
                          width: `${hotspot.width * 100}%`,
                          height: `${hotspot.height * 100}%`,
                        }}
                        title={hotspot.label}
                        aria-label={hotspot.label}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {shouldShowVisualPlan ? (
                <div className="absolute right-5 top-5 z-20 w-[min(360px,42vw)] rounded-3xl border border-white/8 bg-[#191b20]/88 p-4 shadow-[0_20px_70px_rgba(0,0,0,0.36)] backdrop-blur">
                  <div className="mb-2 text-[12px] font-bold text-white/82">
                    {visualAsset?.status === 'missing' || imageFailed ? '图片暂不可用，已切换到结构化地图' : '本章适合生成视觉路线图'}
                  </div>
                  {visualAsset?.alt ? (
                    <p className="mb-3 text-[12px] leading-5 text-white/58">{visualAsset.alt}</p>
                  ) : null}
                  {visualAsset?.prompt ? (
                    <div className="rounded-2xl bg-black/18 p-3">
                      <p className="line-clamp-4 text-[11px] leading-5 text-white/52">{visualAsset.prompt}</p>
                      <button
                        type="button"
                        className="mt-3 rounded-full bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold text-white/76 transition hover:bg-white/[0.12]"
                        onClick={() => void navigator.clipboard?.writeText(visualAsset.prompt)}
                      >
                        复制图片提示词
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!shouldShowVisualAsset ? (
                <>
              <svg
                viewBox="0 0 1000 520"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 size-full"
                aria-hidden
              >
                <defs>
                  <marker
                    id="roadmap-arrow"
                    markerHeight="8"
                    markerWidth="8"
                    orient="auto"
                    refX="7"
                    refY="4"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" fill="rgba(226,232,240,0.46)" />
                  </marker>
                </defs>
                {edgeCandidates.map((edge, index) => {
                  const from = positionByNodeId.get(edge.from)
                  const to = positionByNodeId.get(edge.to)
                  if (!from || !to) return null
                  const start = toSvgPoint(from)
                  const end = toSvgPoint(to)
                  const curve = Math.max(70, Math.abs(end.x - start.x) * 0.34)
                  const controlA = `${start.x + curve},${start.y}`
                  const controlB = `${end.x - curve},${end.y}`

                  return (
                    <path
                      key={`edge-${edge.from}-${edge.to}-${index}`}
                      d={`M ${start.x} ${start.y} C ${controlA} ${controlB} ${end.x} ${end.y}`}
                      fill="none"
                      markerEnd="url(#roadmap-arrow)"
                      stroke="rgba(226,232,240,0.24)"
                      strokeDasharray={edge.kind === 'feedback' || edge.kind === 'risk' ? '8 8' : undefined}
                      strokeLinecap="round"
                      strokeWidth="2.3"
                    />
                  )
                })}
              </svg>

              {edgeCandidates.map((edge, index) => {
                const caption = getEdgeCaption(edge, nodeById.get(edge.from), nodeById.get(edge.to))
                const from = positionByNodeId.get(edge.from)
                const to = positionByNodeId.get(edge.to)
                if (!caption || !from || !to) return null
                const midpoint = {
                  x: (from.x + to.x) / 2,
                  y: (from.y + to.y) / 2,
                }
                return (
                  <div
                    key={`edge-label-${edge.from}-${edge.to}-${index}`}
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8 bg-[#191b20]/88 px-2.5 py-1 text-[10px] font-semibold text-white/58 shadow-[0_12px_28px_rgba(0,0,0,0.22)]"
                    style={{
                      left: `${midpoint.x}%`,
                      top: `${midpoint.y}%`,
                    }}
                  >
                    {caption}
                  </div>
                )
              })}

              <article
                className={cn(
                  'absolute left-1/2 top-[34%] flex max-h-[300px] w-[min(560px,62vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[26px] border p-5',
                  selectedToneStyle.card,
                  selectedToneStyle.halo,
                  'shadow-[0_28px_90px_rgba(0,0,0,0.38)]',
                )}
              >
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2">
                      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold', selectedToneStyle.badge)}>
                        {selectedIndex + 1}
                      </span>
                      <span className="text-[12px] font-semibold text-white/58">
                        {roleLabels[selectedNode.role ?? 'practice']}
                      </span>
                    </div>
                    <h3 className="text-[21px] font-bold leading-8 tracking-tight text-white">
                      {getNodeTitle(selectedNode)}
                    </h3>
                  </div>
                  {selectedNode.active ? (
                    <span className="shrink-0 rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold text-white/85">
                      当前
                    </span>
                  ) : selectedNode.completed ? (
                    <span className="shrink-0 rounded-full bg-emerald-300/12 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
                      已完成
                    </span>
                  ) : null}
                </div>

                <div className="min-h-0 overflow-y-auto pr-1">
                  {selectedDetail ? (
                    <p className="text-[13px] leading-6 text-white/72">
                      {selectedDetail}
                    </p>
                  ) : null}
                  {previousRelation || nextRelation ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {previousRelation ? (
                        <div className="rounded-2xl border border-white/8 bg-black/16 px-3 py-2">
                          <div className="mb-1 text-[10px] font-semibold text-white/40">承接上一节</div>
                          <p className="text-[12px] leading-5 text-white/70">{previousRelation}</p>
                        </div>
                      ) : null}
                      {nextRelation ? (
                        <div className="rounded-2xl border border-white/8 bg-black/16 px-3 py-2">
                          <div className="mb-1 text-[10px] font-semibold text-white/40">通向下一节</div>
                          <p className="text-[12px] leading-5 text-white/70">{nextRelation}</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedSignal ? (
                    <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.045] px-3 py-2 text-[12px] leading-5 text-white/68">
                      {selectedSignal}
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {selectedTags.map((tag) => (
                      <span
                        key={`${selectedNode.id}-focus-${tag}`}
                        className="rounded-full border border-white/8 bg-white/[0.055] px-2.5 py-1 text-[10px] font-semibold text-white/66"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded-full border border-white/8 bg-white/[0.055] px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:bg-white/10"
                      onClick={() => setSelectedIndex((value) => Math.max(0, value - 1))}
                    >
                      上一节
                    </button>
                    <button
                      type="button"
                      className="rounded-full border border-white/8 bg-white/[0.09] px-3 py-1.5 text-[11px] font-semibold text-white/86 transition hover:bg-white/14"
                      onClick={() => setSelectedIndex((value) => Math.min(nodes.length - 1, value + 1))}
                    >
                      下一节
                    </button>
                  </div>
                </div>
              </article>

              {nodes.map((node, index) => {
                const position = positions[index]
                const tone = node.tone ?? fallbackTone(index)
                const toneStyle = toneStyles[tone]
                return (
                  <button
                    type="button"
                    key={node.id}
                    className={cn(
                      'absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-2xl border px-3 text-left transition duration-200',
                      toneStyle.card,
                      index === selectedIndex ? 'scale-[1.05] ring-2 ring-white/35' : 'opacity-80 hover:scale-[1.025] hover:opacity-100',
                    )}
                    style={{
                      height: layout.cardHeight,
                      left: `${position.x}%`,
                      top: `${position.y}%`,
                      width: `min(150px, calc((100% - ${layout.gapPx * Math.max(layout.maxColumns - 1, 0)}px) / ${layout.maxColumns}))`,
                    }}
                    title={`${node.title}${node.summary ? `：${node.summary}` : ''}`}
                    onClick={() => setSelectedIndex(index)}
                  >
                    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold', toneStyle.badge)}>
                      {index + 1}
                    </span>
                    <span className="min-w-0 truncate text-[12px] font-bold leading-5 text-white/86">
                      {getNodeTitle(node)}
                    </span>
                  </button>
                )
              })}
                </>
              ) : null}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

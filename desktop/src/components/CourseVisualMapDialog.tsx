import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { copyTextToClipboard } from '@/lib/clipboard'
import type { CourseVisualMap, LightLearningMap, LightLearningMapChapter, LightLearningMapNode, LightLearningMapRoute } from '@/types/course'
import { ArrowRight, CheckCircle2, CircleAlert, Lock, Route, Sparkles, Target, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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

export function CourseVisualMapDialog({
  open,
  onOpenChange,
  courseTitle,
  chapterCount,
  courseVisualMap,
  lightLearningMap,
  coursePackagePath,
  completedNodeIds = [],
  unlockedNodeIds = [],
  currentNodeId,
  onSelectLesson,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  courseTitle: string
  chapterCount: number
  courseVisualMap?: CourseVisualMap
  lightLearningMap?: LightLearningMap
  coursePackagePath?: string | null
  completedNodeIds?: string[]
  unlockedNodeIds?: string[]
  currentNodeId?: string | null
  onSelectLesson?: (lessonId: string) => void
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const visualAssetSrc = resolveVisualAssetUri(courseVisualMap?.uri, coursePackagePath)
  const shouldShowImage =
    courseVisualMap?.kind === 'image' &&
    courseVisualMap.status === 'attached' &&
    Boolean(visualAssetSrc) &&
    !imageFailed
  const shouldShowLightMap = Boolean(lightLearningMap?.global_route.length && lightLearningMap.chapter_maps.length)

  useEffect(() => {
    setImageFailed(false)
  }, [open, visualAssetSrc])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(86vh,860px)] w-[min(94vw,1360px)] overflow-hidden rounded-[30px] border-white/8 bg-[#101115] p-0 shadow-[0_38px_140px_rgba(0,0,0,0.72)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,rgba(74,96,158,0.14),transparent_30%),radial-gradient(circle_at_84%_92%,rgba(38,122,88,0.10),transparent_30%)]" />
        <div className="relative flex h-full flex-col overflow-hidden">
          <DialogTitle className="sr-only">
            {courseTitle} · {shouldShowLightMap ? '轻量全局导学' : '全局学习地图'} · {chapterCount} 章
          </DialogTitle>

          <div className="relative min-h-0 flex-1 px-4 pb-4 pt-4">
            <section className="relative h-full overflow-hidden rounded-[24px] bg-[#0f1115]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(76,110,245,0.12),transparent_32%),radial-gradient(circle_at_78%_72%,rgba(71,180,141,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0))]" />
              <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
              <div className="pointer-events-none absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.045] to-transparent" />

              {shouldShowLightMap && lightLearningMap ? (
                <LightLearningMapView
                  routes={lightLearningMap.global_route}
                  chapters={lightLearningMap.chapter_maps}
                  completedNodeIds={completedNodeIds}
                  unlockedNodeIds={unlockedNodeIds}
                  currentNodeId={currentNodeId ?? null}
                  onSelectLesson={onSelectLesson}
                />
              ) : shouldShowImage && courseVisualMap ? (
                <div className="relative z-10 flex h-full items-center justify-center px-8 py-7">
                  <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
                    <img
                      src={visualAssetSrc}
                      alt={courseVisualMap.alt || courseTitle}
                      className="max-h-full max-w-full object-contain drop-shadow-[0_28px_80px_rgba(0,0,0,0.36)]"
                      onError={() => setImageFailed(true)}
                    />
                    {courseVisualMap.hotspots?.map((hotspot) => (
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
              ) : (
                <div className="relative z-10 flex h-full items-center justify-center px-8 py-8">
                  <div className="w-full max-w-3xl rounded-[28px] border border-white/8 bg-[#17191f]/92 p-6 shadow-[0_22px_90px_rgba(0,0,0,0.32)] backdrop-blur">
                    <div className="text-[12px] font-bold text-white/82">
                      {courseVisualMap ? '这门课已经具备全局地图设计提示词' : '这门课还没有全局地图数据'}
                    </div>
                    <p className="mt-2 text-[12px] leading-6 text-white/58">
                      {courseVisualMap
                        ? '课程正文已经可以正常学习。下一步只需要用图片模型生成一张整门课的全局学习地图，再导入回来，这里就会直接显示。'
                        : '课程正文可以正常学习；当前会继续使用章节思维导图作为导学入口。'}
                    </p>
                    {courseVisualMap ? (
                      <>
                        <div className="mt-4 rounded-2xl bg-black/18 p-4">
                          <div className="mb-2 text-[11px] font-semibold text-white/58">图片描述</div>
                          <p className="text-[12px] leading-6 text-white/72">{courseVisualMap.alt}</p>
                        </div>
                        <div className="mt-4 rounded-2xl bg-black/18 p-4">
                          <div className="mb-2 text-[11px] font-semibold text-white/58">图片提示词</div>
                          <p className="max-h-[240px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-6 text-white/72">
                            {courseVisualMap.prompt}
                          </p>
                          <button
                            type="button"
                            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold text-white/76 transition hover:bg-white/[0.12]"
                            onClick={() => void copyTextToClipboard(courseVisualMap.prompt)}
                          >
                            <Sparkles className="size-3.5" />
                            复制图片提示词
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LightLearningMapView({
  routes,
  chapters,
  completedNodeIds,
  unlockedNodeIds,
  currentNodeId,
  onSelectLesson,
}: {
  routes: LightLearningMapRoute[]
  chapters: LightLearningMapChapter[]
  completedNodeIds: string[]
  unlockedNodeIds: string[]
  currentNodeId: string | null
  onSelectLesson?: (lessonId: string) => void
}) {
  const completedSet = useMemo(() => new Set(completedNodeIds), [completedNodeIds])
  const unlockedSet = useMemo(() => new Set(unlockedNodeIds), [unlockedNodeIds])
  const routeByChapterId = useMemo(() => {
    const lookup = new Map<string, LightLearningMapRoute>()
    routes.forEach((route) => lookup.set(route.chapter_id, route))
    return lookup
  }, [routes])
  const nodeLookup = useMemo(() => {
    const lookup = new Map<string, { node: LightLearningMapNode; chapter: LightLearningMapChapter }>()
    chapters.forEach((chapter) => {
      chapter.nodes.forEach((node) => lookup.set(node.lesson_id, { node, chapter }))
    })
    return lookup
  }, [chapters])
  const firstNodeId = chapters[0]?.nodes[0]?.lesson_id ?? null
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(currentNodeId ?? firstNodeId)
  const selected = selectedNodeId ? nodeLookup.get(selectedNodeId) ?? null : null
  const selectedRoute = selected ? routeByChapterId.get(selected.chapter.chapter_id) ?? null : null
  const totalNodeCount = chapters.reduce((total, chapter) => total + chapter.nodes.length, 0)

  useEffect(() => {
    if (currentNodeId && nodeLookup.has(currentNodeId)) {
      setSelectedNodeId(currentNodeId)
    }
  }, [currentNodeId, nodeLookup])

  useEffect(() => {
    if (!selectedNodeId || !nodeLookup.has(selectedNodeId)) {
      setSelectedNodeId(firstNodeId)
    }
  }, [firstNodeId, nodeLookup, selectedNodeId])

  return (
    <div className="relative z-10 grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-2.5 px-3 pb-3 pt-3 md:px-4 md:pb-4">
      <div className="grid min-h-0 gap-2.5 md:grid-cols-5">
        {chapters.map((chapter, chapterIndex) => {
          const route = routeByChapterId.get(chapter.chapter_id)
          const chapterCompleted = chapter.nodes.filter((node) => completedSet.has(node.lesson_id)).length
          const edgeByPair = new Map(chapter.edges.map((edge) => [`${edge.from}->${edge.to}`, edge.label]))
          return (
            <section
              key={chapter.chapter_id}
              className={`relative min-h-0 rounded-[16px] border p-2 ${chapterColumnClass(chapterIndex)}`}
            >
              <div className="mb-1.5 min-h-[68px] rounded-[12px] bg-black/14 px-2 py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-bold text-white/92">{chapter.label}</div>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-white/55">{chapter.focus}</p>
                  </div>
                  <div className="shrink-0 rounded-full bg-white/[0.08] px-2 py-1 text-[10px] font-bold text-white/70">
                    {chapterCompleted}/{chapter.nodes.length}
                  </div>
                </div>
                {route ? (
                  <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded-full bg-rose-300/[0.075] px-2 py-0.5 text-[10px] font-semibold text-rose-100/80">
                    <CircleAlert className="size-3 shrink-0" />
                    <span className="truncate">{route.risk}</span>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-1">
                {chapter.nodes.map((node, nodeIndex) => {
                  const nextNode = chapter.nodes[nodeIndex + 1]
                  const edgeLabel = nextNode ? edgeByPair.get(`${node.lesson_id}->${nextNode.lesson_id}`) : ''
                  const completed = completedSet.has(node.lesson_id)
                  const active = node.lesson_id === currentNodeId
                  const selectedNode = node.lesson_id === selectedNodeId
                  const canOpen = active || unlockedSet.has(node.lesson_id)
                  return (
                    <div key={node.lesson_id} className="min-w-0">
                      <button
                        type="button"
                        className={`group grid min-h-[48px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[12px] border px-2 py-1.5 text-left transition ${
                          active
                            ? 'border-sky-300/45 bg-sky-300/[0.12] shadow-[0_10px_30px_rgba(56,189,248,0.12)]'
                            : selectedNode
                              ? 'border-white/28 bg-white/[0.08]'
                              : completed
                                ? 'border-emerald-300/24 bg-emerald-300/[0.07]'
                                : canOpen
                                  ? 'border-white/9 bg-black/12 hover:border-white/18 hover:bg-white/[0.055]'
                                  : 'border-white/6 bg-black/8 opacity-68'
                        }`}
                        onClick={() => setSelectedNodeId(node.lesson_id)}
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[13px] font-bold text-white/90">{node.label}</span>
                            {node.high_density ? <Zap className="size-3 shrink-0 text-amber-100/80" /> : null}
                          </div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                            <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-semibold text-white/62">
                              {node.action}
                            </span>
                            <span className="truncate text-[10px] font-medium text-white/42">{node.risk}</span>
                          </div>
                        </div>
                        <div className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                          active
                            ? 'bg-sky-200/16 text-sky-100'
                            : completed
                              ? 'bg-emerald-200/14 text-emerald-100'
                              : canOpen
                                ? 'bg-white/[0.07] text-white/62'
                                : 'bg-white/[0.04] text-white/32'
                        }`}>
                          {completed ? (
                            <CheckCircle2 className="size-3.5" />
                          ) : canOpen ? (
                            <Target className="size-3.5" />
                          ) : (
                            <Lock className="size-3" />
                          )}
                        </div>
                      </button>

                      {edgeLabel ? (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold text-white/34">
                          <span className="h-px min-w-2 flex-1 bg-white/8" />
                          <span className="inline-flex max-w-[86%] items-center gap-1 truncate">
                            {edgeLabel}
                            <ArrowRight className="size-2.5 shrink-0" />
                          </span>
                          <span className="h-px min-w-2 flex-1 bg-white/8" />
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              {route ? (
                <div className="mt-1.5 rounded-[12px] bg-black/12 px-2 py-1.5 text-[10px] leading-4 text-white/52">
                  <span className="font-semibold text-white/68">完成：</span>
                  <span className="line-clamp-2">{route.completion_signal}</span>
                </div>
              ) : null}
            </section>
          )
        })}
      </div>

      <div className="grid min-h-[68px] grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-stretch gap-2.5 rounded-[16px] border border-white/8 bg-[#17191f]/88 p-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-white/48">
            <Route className="size-3.5" />
            <span>{selected?.chapter.label ?? '课程地图'}</span>
            <span>{completedNodeIds.length}/{totalNodeCount} 已完成</span>
            {selected?.node.high_density ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/[0.09] px-2 py-0.5 text-amber-100/78">
                <Zap className="size-3" />
                高密度
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-[15px] font-bold text-white/90">
            {selected?.node.label ?? '选择一个节点'}
            {selected?.node.title ? <span className="ml-2 text-[12px] font-semibold text-white/48">{selected.node.title}</span> : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-white/60">{selected?.node.signal ?? '点击图中的节点查看完成信号和误判风险。'}</p>
        </div>

        <div className="grid min-w-0 content-center gap-1.5 rounded-[14px] bg-black/14 px-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold text-white/66">
            <span className="rounded bg-white/[0.07] px-2 py-0.5">{selected?.node.action ?? '行动'}</span>
            <span className="truncate text-rose-100/74">避免 {selected?.node.risk ?? selectedRoute?.risk ?? '误判'}</span>
          </div>
          <p className="line-clamp-2 text-[10px] leading-4 text-white/44">{selectedRoute?.completion_signal ?? selected?.chapter.focus ?? ''}</p>
        </div>

      </div>
    </div>
  )
}

function chapterColumnClass(index: number) {
  const tones = [
    'border-sky-300/12 bg-sky-300/[0.035]',
    'border-emerald-300/12 bg-emerald-300/[0.032]',
    'border-violet-300/12 bg-violet-300/[0.032]',
    'border-orange-300/12 bg-orange-300/[0.032]',
    'border-amber-300/12 bg-amber-300/[0.034]',
  ]
  return tones[index % tones.length]
}

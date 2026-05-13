import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import chapterRoadmapIcon from '@/assets/learn-chapter-map.svg'
import type { CourseVisualMap } from '@/types/course'
import { useEffect, useState } from 'react'

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
  coursePackagePath,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  courseTitle: string
  chapterCount: number
  courseVisualMap: CourseVisualMap
  coursePackagePath?: string | null
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const visualAssetSrc = resolveVisualAssetUri(courseVisualMap.uri, coursePackagePath)
  const shouldShowImage =
    courseVisualMap.kind === 'image' &&
    courseVisualMap.status === 'attached' &&
    Boolean(visualAssetSrc) &&
    !imageFailed

  useEffect(() => {
    setImageFailed(false)
  }, [open, visualAssetSrc])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(86vh,860px)] w-[min(94vw,1360px)] overflow-hidden rounded-[30px] border-white/8 bg-[#101115] p-0 shadow-[0_38px_140px_rgba(0,0,0,0.72)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,rgba(74,96,158,0.14),transparent_30%),radial-gradient(circle_at_84%_92%,rgba(38,122,88,0.10),transparent_30%)]" />
        <div className="relative flex h-full flex-col overflow-hidden">
          <header className="flex shrink-0 items-center justify-between gap-5 px-8 pb-4 pt-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04]">
                <img src={chapterRoadmapIcon} alt="" className="size-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate text-[22px] font-bold tracking-tight text-foreground">
                  {courseTitle}
                </DialogTitle>
                <DialogDescription className="truncate text-[12px] leading-5 text-muted-foreground">
                  全局学习地图 · {chapterCount} 章
                </DialogDescription>
              </div>
            </div>
          </header>

          <div className="relative min-h-0 flex-1 px-7 pb-7">
            <section className="relative h-full overflow-hidden rounded-[28px] bg-[#0f1115]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(76,110,245,0.12),transparent_32%),radial-gradient(circle_at_78%_72%,rgba(71,180,141,0.12),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0))]" />
              <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
              <div className="pointer-events-none absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.045] to-transparent" />

              {shouldShowImage ? (
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
                      这门课已经具备全局地图设计提示词
                    </div>
                    <p className="mt-2 text-[12px] leading-6 text-white/58">
                      课程正文已经可以正常学习。下一步只需要用图片模型生成一张整门课的全局学习地图，再导入回来，这里就会直接显示。
                    </p>
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
                        className="mt-4 rounded-full bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold text-white/76 transition hover:bg-white/[0.12]"
                        onClick={() => void navigator.clipboard?.writeText(courseVisualMap.prompt)}
                      >
                        复制图片提示词
                      </button>
                    </div>
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

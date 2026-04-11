import { LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CourseOutlinePane } from '@/components/CourseOutlinePane'
import { WorkspacePane, type WorkspaceView } from '@/components/WorkspacePane'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'

function App() {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('hub')
  const [windowFocused, setWindowFocused] = useState(true)
  const autoOpenedPackageRef = useRef<string | null>(null)

  const bootState = useLearningStore((state) => state.bootState)
  const courseData = useLearningStore((state) => state.courseData)
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const distillRequestState = useLearningStore((state) => state.distillRequestState)
  const distillProgressPercent = useLearningStore((state) => state.distillProgressPercent)
  const distillStatusMessage = useLearningStore((state) => state.distillStatusMessage)
  const distillError = useLearningStore((state) => state.distillError)
  const runtimeSettings = useLearningStore((state) => state.runtimeSettings)
  const toast = useLearningStore((state) => state.toast)
  const hydrateApp = useLearningStore((state) => state.hydrateApp)
  const setRuntimeSettings = useLearningStore((state) => state.setRuntimeSettings)
  const dismissToast = useLearningStore((state) => state.dismissToast)

  useEffect(() => {
    void hydrateApp()
  }, [hydrateApp])

  useEffect(() => {
    const unsubscribe = window.desktopAPI.onWindowFocusChanged((payload) => {
      setWindowFocused(Boolean(payload.focused))
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!courseData || !currentNodeId) {
      autoOpenedPackageRef.current = null
      return
    }

    if (autoOpenedPackageRef.current === courseData.package_id) {
      return
    }

    autoOpenedPackageRef.current = courseData.package_id
    setWorkspaceView('learn')
  }, [courseData, currentNodeId])

  if (bootState === 'booting') {
    return (
      <div className="flex h-screen items-center justify-center overflow-hidden bg-background p-6">
        <Card className="glass-panel-strong w-full max-w-lg">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-foreground/85">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">正在恢复你的伴学档案</p>
              <p className="text-sm text-muted-foreground">课程、进度和聊天记录都会在这里无缝续上。</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={cn('relative flex h-screen overflow-hidden text-foreground transition-colors duration-200', windowFocused ? 'bg-[#202020]' : 'bg-[#1b1b1b]')}>
      {distillRequestState === 'loading' || distillError ? (
        <Card
          className={cn(
            'glass-panel-strong absolute left-[268px] top-4 z-20 w-[min(360px,calc(100vw-19rem))] overflow-hidden rounded-[22px]',
            distillError && 'border-destructive/25',
          )}
        >
          <CardContent className="space-y-4 p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">提炼任务</div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex size-2 rounded-full bg-white/70 shadow-[0_0_10px_rgba(255,255,255,0.18)]',
                      distillError && 'bg-destructive shadow-[0_0_12px_hsl(var(--destructive)/0.8)]',
                    )}
                  />
                  <p className="text-sm font-semibold text-foreground">
                    {distillRequestState === 'loading' ? '后台提炼中' : '提炼失败'}
                  </p>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {distillRequestState === 'loading'
                    ? distillStatusMessage || '正在抓取字幕、切片并重建课程知识树。'
                    : distillError}
                </p>
              </div>
              {distillRequestState === 'loading' ? (
                <Badge variant="outline" className="border-white/10 bg-white/[0.06] text-foreground/85">
                  {Math.max(0, Math.min(100, Math.round(distillProgressPercent)))}%
                </Badge>
              ) : null}
            </div>

            {distillRequestState === 'loading' ? (
              <div className="space-y-2.5">
                <Progress value={Math.max(4, Math.min(100, distillProgressPercent || 4))} className="h-1.5 bg-white/8" />
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>提炼不会打断你当前的学习流程。</span>
                  <span>后台运行</span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {toast ? (
        <Card className="glass-panel-strong absolute right-4 top-4 z-20 w-[min(320px,calc(100vw-2rem))] rounded-[22px]">
          <CardContent className="flex items-start gap-3 p-3.5">
            <div
              className={cn(
                'mt-1 size-2 rounded-full bg-white/65 shadow-[0_0_10px_rgba(255,255,255,0.16)]',
                toast.tone === 'success' && 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]',
                toast.tone === 'error' && 'bg-destructive shadow-[0_0_12px_hsl(var(--destructive)/0.8)]',
              )}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">系统提示</div>
              <p className="text-sm font-semibold text-foreground">{toast.title}</p>
              {toast.description ? <p className="text-xs leading-5 text-muted-foreground">{toast.description}</p> : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={dismissToast}
              aria-label="关闭提示"
            >
              <X size={14} />
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <CourseOutlinePane workspaceView={workspaceView} onSelectView={setWorkspaceView} windowFocused={windowFocused} />
      <WorkspacePane
        view={workspaceView}
        runtimeSettings={runtimeSettings}
        windowFocused={windowFocused}
        onRuntimeSettingsSaved={(next) => {
          setRuntimeSettings(next)
        }}
        onRequestLearn={() => setWorkspaceView('learn')}
      />
    </div>
  )
}

export default App

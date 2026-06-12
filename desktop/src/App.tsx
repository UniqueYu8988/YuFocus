import { LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AppChrome } from '@/components/AppChrome'
import { SourceSidebarPane } from '@/components/SourceSidebarPane'
import { WorkspacePane, type WorkspaceView } from '@/components/WorkspacePane'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ensureDesktopApiFallback } from '@/lib/desktopApiFallback'
import { cn } from '@/lib/utils'
import { useLearningStore } from '@/store'

ensureDesktopApiFallback()

const SIDEBAR_WIDTH_STORAGE_KEY = 'shijie-focus-sidebar-width'
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 380
const SIDEBAR_DEFAULT_WIDTH = 240

function clampSidebarWidth(value: number) {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(value)))
}

function loadSidebarWidth() {
  const raw = Number(globalThis.localStorage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY))
  return Number.isFinite(raw) && raw > 0 ? clampSidebarWidth(raw) : SIDEBAR_DEFAULT_WIDTH
}

function App() {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('learn')
  const [showLearningHome, setShowLearningHome] = useState(true)
  const [windowFocused, setWindowFocused] = useState(true)
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const autoOpenedPackageRef = useRef<string | null>(null)
  const queryImportedPackageRef = useRef<string | null>(null)

  const bootState = useLearningStore((state) => state.bootState)
  const courseData = useLearningStore((state) => state.courseData)
  const currentNodeId = useLearningStore((state) => state.currentNodeId)
  const runtimeSettings = useLearningStore((state) => state.runtimeSettings)
  const toast = useLearningStore((state) => state.toast)
  const hydrateApp = useLearningStore((state) => state.hydrateApp)
  const setRuntimeSettings = useLearningStore((state) => state.setRuntimeSettings)
  const dismissToast = useLearningStore((state) => state.dismissToast)
  const openDeepLinkedNode = useLearningStore((state) => state.openDeepLinkedNode)
  const loadCourseFromText = useLearningStore((state) => state.loadCourseFromText)
  const pushToast = useLearningStore((state) => state.pushToast)

  useEffect(() => {
    void hydrateApp()
  }, [hydrateApp])

  const handleSelectWorkspaceView = useCallback((view: WorkspaceView) => {
    setWorkspaceView(view)
    if (view === 'learn') {
      setShowLearningHome(!(courseData && currentNodeId))
    }
  }, [courseData, currentNodeId])

  useEffect(() => {
    if (bootState !== 'ready') return
    const coursePath = new URLSearchParams(window.location.search).get('course')
    if (!coursePath || queryImportedPackageRef.current === coursePath) return

    queryImportedPackageRef.current = coursePath
    void window.desktopAPI
      .readCoursePackage(coursePath)
      .then(async (result) => {
        await loadCourseFromText(result.text, result.path)
        setShowLearningHome(false)
        setWorkspaceView('learn')
        pushToast('资料包已载入', result.path, 'success')
      })
      .catch((error) => {
        queryImportedPackageRef.current = null
        pushToast('资料包载入失败', error instanceof Error ? error.message : String(error), 'error')
      })
  }, [bootState, loadCourseFromText, pushToast])

  useEffect(() => {
    const unsubscribe = window.desktopAPI.onWindowFocusChanged((payload) => {
      setWindowFocused(Boolean(payload.focused))
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.desktopAPI.onWindowMaximizedChanged((payload) => {
      setWindowMaximized(Boolean(payload.maximized))
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = window.desktopAPI.onDeepLinkOpen((payload) => {
      void openDeepLinkedNode(payload.packageId, payload.nodeId)
      setShowLearningHome(false)
      setWorkspaceView('learn')
    })
    return unsubscribe
  }, [openDeepLinkedNode])

  useEffect(() => {
    if (!courseData || !currentNodeId) {
      autoOpenedPackageRef.current = null
      return
    }

    if (autoOpenedPackageRef.current === courseData.package_id) {
      return
    }

    autoOpenedPackageRef.current = courseData.package_id
    setShowLearningHome(false)
    setWorkspaceView('learn')
  }, [courseData, currentNodeId])

  const handleSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    setSidebarResizing(true)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + moveEvent.clientX - startX)
      setSidebarWidth(nextWidth)
    }

    const handlePointerUp = (upEvent: PointerEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + upEvent.clientX - startX)
      setSidebarWidth(nextWidth)
      globalThis.localStorage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth))
      setSidebarResizing(false)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
  }

  const workspaceNoticeStyle = {
    left: `${sidebarWidth + 8}px`,
    right: 0,
  }

  if (bootState === 'booting') {
    return (
      <div className="work-surface flex h-screen items-center justify-center overflow-hidden p-6">
        <Card className="glass-panel-strong w-full max-w-lg">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-foreground/85">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">正在恢复专注页</p>
              <p className="text-sm text-muted-foreground">资料、进度和记录都会在这里续上。</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={cn('relative flex h-screen flex-col overflow-hidden text-foreground transition-colors duration-200', windowFocused ? 'chrome-mica' : 'chrome-mica-unfocused')}>
      <AppChrome
        windowFocused={windowFocused}
        isMaximized={windowMaximized}
        sidebarWidth={sidebarWidth}
        isElectron={window.desktopAPI.isElectron}
        onMinimize={() => void window.desktopAPI.minimize()}
        onToggleMaximize={() => void window.desktopAPI.toggleMaximize()}
        onClose={() => void window.desktopAPI.close()}
      />

      {toast ? (
        <div
          className="pointer-events-none absolute top-[52px] z-40 flex justify-center px-5"
          style={workspaceNoticeStyle}
        >
          <div className="flex w-full max-w-[540px] flex-col items-center gap-3">
            {toast ? (
              <Card className="glass-panel-strong toast-enter pointer-events-auto w-[min(460px,100%)] overflow-hidden rounded-[22px]">
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
                <div
                  className={cn(
                    'toast-progress-line h-[2px] w-full origin-left bg-white/22',
                    toast.tone === 'success' && 'bg-emerald-400/70',
                    toast.tone === 'error' && 'bg-destructive/80',
                  )}
                />
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SourceSidebarPane
          workspaceView={workspaceView}
          onSelectView={handleSelectWorkspaceView}
          onActivateLearningNode={() => {
            setShowLearningHome(false)
            setWorkspaceView('learn')
          }}
          sidebarWidth={sidebarWidth}
          windowFocused={windowFocused}
        />
        <div
          className={cn(
            'app-no-drag group relative z-10 w-2 shrink-0 cursor-col-resize',
            sidebarResizing && 'cursor-col-resize',
          )}
          onPointerDown={handleSidebarResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧边栏宽度"
        >
          <div
            className={cn(
              'absolute inset-y-3 left-1/2 w-px -translate-x-1/2 rounded-full bg-white/[0.035] opacity-0 transition group-hover:opacity-100',
              sidebarResizing && 'bg-sky-300/60 opacity-100',
            )}
          />
        </div>
        <WorkspacePane
          view={workspaceView}
          runtimeSettings={runtimeSettings}
          windowFocused={windowFocused}
          onRuntimeSettingsSaved={(next) => {
            setRuntimeSettings(next)
          }}
          showLearningHome={showLearningHome}
          onRequestLearn={() => {
            setShowLearningHome(false)
            setWorkspaceView('learn')
          }}
          onRequestWorkbench={() => setWorkspaceView('workbench')}
          onRequestArchive={() => setWorkspaceView('archive')}
        />
      </div>
    </div>
  )
}

export default App

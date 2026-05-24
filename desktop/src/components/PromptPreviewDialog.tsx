import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Clipboard, FolderOpen, FileText, LoaderCircle } from 'lucide-react'

export type PromptPreviewFile = {
  id: string
  label: string
  path: string
  description: string
}

export type PromptPreviewModule = {
  id: string
  title: string
  summary: string
  files: PromptPreviewFile[]
}

export function PromptPreviewDialog({
  open,
  onOpenChange,
  module,
  selectedFileId,
  content,
  loading,
  error,
  sourceTitle,
  sourcePath,
  onSelectFile,
  onCopyCurrent,
  onRevealCurrent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  module: PromptPreviewModule | null
  selectedFileId: string | null
  content: string
  loading: boolean
  error: string
  sourceTitle: string
  sourcePath: string
  onSelectFile: (fileId: string) => void
  onCopyCurrent: () => void
  onRevealCurrent: () => void
}) {
  const selectedFile = module?.files.find((file) => file.id === selectedFileId) ?? module?.files[0] ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(88vh,900px)] w-[min(94vw,1360px)] overflow-hidden rounded-[30px] border-white/8 bg-[#101115] p-0 shadow-[0_38px_140px_rgba(0,0,0,0.72)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,rgba(74,96,158,0.14),transparent_30%),radial-gradient(circle_at_84%_92%,rgba(38,122,88,0.10),transparent_30%)]" />
        <div className="relative flex h-full flex-col overflow-hidden">
          <div className="border-b border-white/8 px-5 pb-4 pt-4">
            <DialogTitle className="truncate text-[20px] font-semibold tracking-tight text-foreground">
              配置预览
            </DialogTitle>
            <DialogDescription className="mt-1 truncate text-[12px] leading-5 text-muted-foreground">
              {sourceTitle} · {sourcePath}
            </DialogDescription>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="subtle-scrollbar min-h-0 border-b border-white/8 bg-white/[0.02] p-4 md:border-b-0 md:border-r">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-sky-100/80" />
                    <div className="truncate text-[13px] font-semibold text-foreground">{module?.title ?? '未选择模块'}</div>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{module?.summary ?? '先从左侧选择一个模块。'}</p>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {module?.files.map((file) => {
                  const selected = file.id === selectedFile?.id
                  return (
                    <button
                      type="button"
                      key={file.id}
                      className={cn(
                        'rounded-[16px] border p-3 text-left transition',
                        selected
                          ? 'border-sky-300/22 bg-sky-300/[0.08]'
                          : 'border-white/[0.07] bg-black/10 hover:border-white/[0.12] hover:bg-white/[0.045]',
                      )}
                      onClick={() => onSelectFile(file.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold text-foreground">{file.label}</div>
                          <div className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{file.description}</div>
                        </div>
                        {selected ? (
                          <Badge variant="outline" className="border-sky-400/18 bg-sky-400/[0.08] text-sky-100">
                            当前
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 truncate text-[10px] font-mono text-muted-foreground/70">{file.path}</div>
                    </button>
                  )
                })}
                {!module?.files.length ? (
                  <div className="rounded-[16px] border border-white/[0.07] bg-black/10 px-3 py-4 text-[12px] leading-6 text-muted-foreground">
                    还没有可浏览的配置模块。
                  </div>
                ) : null}
              </div>
            </aside>

            <main className="subtle-scrollbar flex min-h-0 flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-white/[0.07] bg-white/[0.025] px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-foreground">{selectedFile?.label ?? '未选择文件'}</div>
                  <div className="mt-0.5 truncate text-[11px] leading-5 text-muted-foreground" title={selectedFile?.path}>
                    {selectedFile?.path ?? '先从左侧选择一个文件。'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={onCopyCurrent}
                    disabled={loading || !content}
                  >
                    <Clipboard size={13} />
                    复制
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={onRevealCurrent}
                    disabled={!selectedFile}
                  >
                    <FolderOpen size={13} />
                    定位
                  </Button>
                </div>
              </div>

              {error ? (
                <div className="rounded-[16px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-[12px] leading-6 text-destructive-foreground">
                  {error}
                </div>
              ) : null}

              <div className="relative min-h-0 flex-1 overflow-hidden rounded-[20px] border border-white/[0.07] bg-[#16181d]">
                {loading ? (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在读取提示词文件
                  </div>
                ) : selectedFile && content ? (
                  <Textarea
                    readOnly
                    value={content}
                    className="h-full min-h-0 resize-none rounded-none border-0 bg-transparent p-4 font-mono text-[12px] leading-6 text-foreground shadow-none focus-visible:ring-0"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-[12px] leading-6 text-muted-foreground">
                    这里会直接显示当前 prompt 文件的原文，方便你核对每一层到底在要求什么。
                  </div>
                )}
              </div>
            </main>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

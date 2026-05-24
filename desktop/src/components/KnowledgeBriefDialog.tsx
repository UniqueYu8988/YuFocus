import { useEffect, useMemo, useState } from 'react'
import { Clipboard, FileText, FolderOpen, LoaderCircle, List, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  MarkdownRenderer,
  extractMarkdownHeadings,
} from '@/components/MarkdownRenderer'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

function stripKnowledgeBriefMetadata(content: string) {
  return content
    .replace(/^<!--\s*shijie:learning-notes[\s\S]*?-->\s*/u, '')
    .replace(/^<!--\s*shijie:knowledge-brief[\s\S]*?-->\s*/u, '')
    .trim()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSearchTerms(query: string) {
  return Array.from(
    new Set(
      query
        .trim()
        .split(/\s+/u)
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => right.length - left.length)
}

function countQueryMatches(text: string, query: string) {
  const terms = buildSearchTerms(query)
  if (!terms.length) return 0

  return terms.reduce((sum, term) => {
    const matches = text.match(new RegExp(escapeRegExp(term), 'ig'))
    return sum + (matches?.length ?? 0)
  }, 0)
}

function renderHighlightedTitle(text: string, query: string) {
  const terms = buildSearchTerms(query)
  if (!terms.length) return text

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig')
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  text.replace(pattern, (match, _group, offset: number) => {
    if (offset > lastIndex) {
      parts.push(text.slice(lastIndex, offset))
    }

    parts.push(
      <mark
        key={`${offset}-${match}`}
        className="rounded-[0.32rem] bg-amber-300/28 px-0.5 py-0 text-[#f8f3dc]"
      >
        {match}
      </mark>,
    )

    lastIndex = offset + match.length
    return match
  })

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

export function KnowledgeBriefDialog({
  open,
  onOpenChange,
  title,
  path,
  content,
  loading,
  error,
  onCopy,
  onReveal,
  dialogTitle = '学习笔记',
  outlineLabel = '目录',
  searchPlaceholder = '搜索正文中的关键词',
  contentTransform,
  headingIdPrefix = 'knowledge-brief',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  path: string
  content: string
  loading: boolean
  error: string
  onCopy: () => void
  onReveal: () => void
  dialogTitle?: string
  outlineLabel?: string
  searchPlaceholder?: string
  contentTransform?: (content: string) => string
  headingIdPrefix?: string
}) {
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (open) {
      setSearchQuery('')
    }
  }, [open, path])

  const visibleContent = useMemo(() => {
    if (contentTransform) return contentTransform(content)
    return stripKnowledgeBriefMetadata(content)
  }, [content, contentTransform])
  const headings = useMemo(() => extractMarkdownHeadings(visibleContent, headingIdPrefix), [headingIdPrefix, visibleContent])
  const matchCount = useMemo(() => countQueryMatches(visibleContent.toLowerCase(), searchQuery.toLowerCase()), [visibleContent, searchQuery])

  const handleJumpToHeading = (headingId: string) => {
    const target = document.getElementById(headingId)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const outlineQuery = searchQuery.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(92vh,960px)] w-[min(96vw,1360px)] overflow-hidden rounded-[28px] border-white/8 bg-[#101115] p-0 shadow-[0_38px_140px_rgba(0,0,0,0.72)]">
        <div className="relative flex h-full flex-col overflow-hidden">
          <div className="border-b border-white/8 px-5 pb-4 pt-4">
            <div className="flex items-start justify-between gap-4 pr-12">
              <div className="min-w-0">
                <DialogTitle className="truncate text-[20px] font-semibold tracking-tight text-foreground">
                  {dialogTitle}
                </DialogTitle>
                <DialogDescription className="mt-1 truncate text-[12px] leading-5 text-muted-foreground">
                  {title} · {path}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={onCopy}
                  disabled={!visibleContent || loading}
                >
                  <Clipboard size={13} />
                  复制
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={onReveal}
                  disabled={!path}
                >
                  <FolderOpen size={13} />
                  定位
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
              <div className="flex min-w-0 items-center gap-2 rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2">
                <Search size={14} className="shrink-0 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-8 border-0 bg-transparent px-0 text-[13px] shadow-none ring-0 placeholder:text-muted-foreground/80 focus-visible:ring-0"
                />
                {searchQuery ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery('')}
                    aria-label="清空搜索"
                  >
                    <X size={13} />
                  </Button>
                ) : null}
              </div>

              <Badge variant="outline" className="h-10 border-white/10 bg-white/[0.035] px-3 text-[11px] text-foreground/80">
                <List className="mr-1.5 size-3.5" />
                {headings.length} 个标题
              </Badge>

              <Badge
                variant="outline"
                className={cn(
                  'h-10 border-white/10 px-3 text-[11px]',
                  matchCount > 0
                    ? 'bg-emerald-400/[0.08] text-emerald-100'
                    : 'bg-white/[0.035] text-foreground/80',
                )}
              >
                <Search className="mr-1.5 size-3.5" />
                {matchCount} 处命中
              </Badge>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 px-5 py-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-hidden rounded-[18px] border border-white/8 bg-black/10">
                <div className="border-b border-white/8 px-4 py-3">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                    <List size={14} />
                  {outlineLabel}
                  </div>
                  <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    点击标题直接跳转到正文对应位置。
                  </div>
              </div>
              <div className="subtle-scrollbar max-h-[28vh] overflow-y-auto p-3 lg:max-h-[calc(92vh-220px)]">
                {headings.length ? (
                  <div className="space-y-1">
                    {headings.map((heading) => {
                      const hit = outlineQuery
                        ? buildSearchTerms(outlineQuery).some((term) => heading.text.toLowerCase().includes(term.toLowerCase()))
                        : false
                      return (
                        <button
                          key={heading.id}
                          type="button"
                          onClick={() => handleJumpToHeading(heading.id)}
                          className={cn(
                            'w-full rounded-xl border px-3 py-2 text-left transition',
                            hit
                              ? 'border-emerald-400/16 bg-emerald-400/[0.08] text-emerald-100'
                              : 'border-white/[0.06] bg-white/[0.025] text-foreground/86 hover:border-white/[0.1] hover:bg-white/[0.04]',
                            heading.level >= 3 && 'ml-3 w-[calc(100%-0.75rem)]',
                            heading.level >= 4 && 'ml-6 w-[calc(100%-1.5rem)]',
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <span className="mt-[0.28rem] shrink-0 rounded-full border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              H{heading.level}
                            </span>
                            <span className="min-w-0 flex-1 text-[12px] leading-5">
                              {outlineQuery ? renderHighlightedTitle(heading.text, outlineQuery) : heading.text}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-[14px] border border-dashed border-white/10 px-3 py-4 text-[12px] leading-6 text-muted-foreground">
                    这篇学习笔记暂时没有标题结构。
                  </div>
                )}
              </div>
            </aside>

            <main className="subtle-scrollbar min-h-0 overflow-y-auto rounded-[18px] border border-white/8 bg-black/10 px-4 py-5">
              {loading ? (
                <div className="flex h-full min-h-[320px] items-center justify-center gap-2 text-[12px] text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  正在读取学习笔记
                </div>
              ) : error ? (
                <div className="rounded-[18px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-[12px] leading-6 text-destructive-foreground">
                  {error}
                </div>
              ) : visibleContent ? (
                <article className="mx-auto max-w-3xl">
                  {searchQuery && matchCount === 0 ? (
                    <div className="mb-4 rounded-[14px] border border-amber-400/18 bg-amber-400/[0.08] px-4 py-3 text-[12px] leading-6 text-amber-100">
                      没有在正文里找到这个关键词。
                    </div>
                  ) : null}
                  <MarkdownRenderer
                    content={visibleContent}
                    shellUntitledSections
                    plainFlow
                    highlightQuery={searchQuery}
                    headingIdPrefix={headingIdPrefix}
                  />
                </article>
              ) : (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <FileText className="size-7 opacity-70" />
                  <div className="text-[12px] leading-6">还没有可阅读的学习笔记。</div>
                </div>
              )}
            </main>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

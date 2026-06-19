import { KnowledgeBriefDialog } from '@/ui/components/KnowledgeBriefDialog'

export type MarkdownDocumentKind = 'brief' | 'chapter_map'

function identityMarkdownContent(content: string) {
  return content
}

function getMarkdownDocumentDialogTitle(kind: MarkdownDocumentKind, targetPath: string) {
  if (kind === 'chapter_map') return '结构图'
  const normalizedPath = targetPath.replace(/\\/g, '/').toLowerCase()
  if (normalizedPath.endsWith('/summary/article.md')) return '视频精读稿'
  if (normalizedPath.endsWith('/exports/notebooklm.md')) return '清洗稿'
  if (normalizedPath.endsWith('/raw_transcript.txt')) return '原始字幕'
  return '资料正文'
}

export function WorkspaceDialogs({
  knowledgeBriefOpen,
  knowledgeBriefTitle,
  knowledgeBriefPath,
  knowledgeBriefContent,
  knowledgeBriefLoading,
  knowledgeBriefError,
  knowledgeBriefKind,
  onKnowledgeBriefOpenChange,
  onCopyKnowledgeBrief,
  onRevealKnowledgeBrief,
}: {
  knowledgeBriefOpen: boolean
  knowledgeBriefTitle: string
  knowledgeBriefPath: string
  knowledgeBriefContent: string
  knowledgeBriefLoading: boolean
  knowledgeBriefError: string | null
  knowledgeBriefKind: MarkdownDocumentKind
  onKnowledgeBriefOpenChange: (open: boolean) => void
  onCopyKnowledgeBrief: () => void
  onRevealKnowledgeBrief: () => void
}) {
  const dialogTitle = getMarkdownDocumentDialogTitle(knowledgeBriefKind, knowledgeBriefPath)
  const outlineLabel = knowledgeBriefKind === 'chapter_map' ? '思维导图目录' : '目录'
  const searchPlaceholder = knowledgeBriefKind === 'chapter_map' ? '搜索思维导图中的关键词' : '搜索正文中的关键词'
  const headingIdPrefix = knowledgeBriefKind === 'chapter_map' ? 'chapter-map' : 'knowledge-brief'
  const contentTransform = knowledgeBriefKind === 'chapter_map' ? identityMarkdownContent : undefined

  return (
    <KnowledgeBriefDialog
      open={knowledgeBriefOpen}
      onOpenChange={onKnowledgeBriefOpenChange}
      title={knowledgeBriefTitle || '未命名资料'}
      path={knowledgeBriefPath}
      content={knowledgeBriefContent}
      loading={knowledgeBriefLoading}
      error={knowledgeBriefError ?? ''}
      dialogTitle={dialogTitle}
      outlineLabel={outlineLabel}
      searchPlaceholder={searchPlaceholder}
      contentTransform={contentTransform}
      headingIdPrefix={headingIdPrefix}
      onCopy={onCopyKnowledgeBrief}
      onReveal={onRevealKnowledgeBrief}
    />
  )
}

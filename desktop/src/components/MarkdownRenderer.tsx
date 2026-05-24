import { useEffect, useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type HeadingBlock = { type: 'heading'; level: number; text: string }

type Block =
  | HeadingBlock
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }

type Section = {
  heading?: HeadingBlock
  blocks: Exclude<Block, { type: 'heading' }>[]
}

type SectionTone = 'default' | 'quiz' | 'steps' | 'warning' | 'keypoint' | 'reason' | 'example' | 'answer' | 'memory'

export type MarkdownHeading = {
  id: string
  level: number
  text: string
  index: number
}

type RenderInlineOptions = {
  highlightQuery?: string
}

type MarkdownRendererProps = {
  content: string
  className?: string
  hideLeadHeading?: boolean
  shellUntitledSections?: boolean
  plainFlow?: boolean
  highlightQuery?: string
  headingIdPrefix?: string
}

function slugifyMarkdownHeading(text: string) {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'section'
}

function buildMarkdownHeadingId(text: string, occurrence: number, prefix: string) {
  return `${prefix}-${slugifyMarkdownHeading(text)}-${occurrence + 1}`
}

export function extractMarkdownHeadings(markdown: string, prefix = 'markdown-heading'): MarkdownHeading[] {
  const lines = normalizeGeneratedMarkdown(markdown).split('\n')
  const counts = new Map<string, number>()
  const headings: MarkdownHeading[] = []

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (!headingMatch) continue

    const text = headingMatch[2].trim()
    const slug = slugifyMarkdownHeading(text)
    const occurrence = counts.get(slug) ?? 0
    counts.set(slug, occurrence + 1)
    headings.push({
      id: buildMarkdownHeadingId(text, occurrence, prefix),
      level: headingMatch[1].length,
      text,
      index: headings.length,
    })
  }

  return headings
}

function buildHighlightTerms(query: string) {
  const terms = query
    .trim()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean)

  const uniqueTerms = Array.from(new Set(terms))
  if (!uniqueTerms.length) return null
  return uniqueTerms.sort((left, right) => right.length - left.length)
}

function renderHighlightedText(text: string, highlightQuery?: string, keyPrefix = 'text'): ReactNode[] {
  const terms = highlightQuery ? buildHighlightTerms(highlightQuery) : null
  if (!terms) return [text]

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'ig')
  const parts: ReactNode[] = []
  let lastIndex = 0

  text.replace(pattern, (match, _group, offset: number) => {
    if (offset > lastIndex) {
      parts.push(text.slice(lastIndex, offset))
    }

    parts.push(
      <mark
        key={`${keyPrefix}-${offset}`}
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

function renderInline(text: string, options: RenderInlineOptions = {}) {
  const parts: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|<u>[^<]+<\/u>|`[^`]+`)/g
  let lastIndex = 0

  text.replace(pattern, (token, _group, offset: number) => {
    if (offset > lastIndex) {
      parts.push(...renderHighlightedText(text.slice(lastIndex, offset), options.highlightQuery, `${offset}-plain`))
    }

    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`${offset}-bold`} className="font-bold text-[#f4f7fb]">
          {renderInline(token.slice(2, -2), options)}
        </strong>,
      )
    } else if (token.startsWith('<u>') && token.endsWith('</u>')) {
      parts.push(
        <span
          key={`${offset}-underline`}
          className="underline decoration-sky-300/55 decoration-2 underline-offset-[5px]"
        >
          {renderInline(token.slice(3, -4), options)}
        </span>,
      )
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`${offset}-code`}
          className="rounded-md border border-white/8 bg-[#202020] px-1.5 py-0.5 font-mono text-[0.9em] text-foreground/88"
        >
          {renderHighlightedText(token.slice(1, -1), options.highlightQuery, `${offset}-code`)}
        </code>,
      )
    }

    lastIndex = offset + token.length
    return token
  })

  if (lastIndex < text.length) {
    parts.push(...renderHighlightedText(text.slice(lastIndex), options.highlightQuery, 'tail'))
  }

  return parts
}

function parseTableCells(line: string) {
  const rawCells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
  return rawCells.map((cell) => cell.trim())
}

function isTableSeparator(line: string) {
  const cells = parseTableCells(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function looksLikeTableRow(line: string) {
  return line.includes('|')
}

function hasReadableContent(value: string) {
  return /[\p{L}\p{N}]/u.test(value)
}

function cleanGeneratedListItem(value: string) {
  const cleaned = value
    .replace(/^[\s、，,；;。！？：:]+/u, '')
    .replace(/[、，,；;]\s*$/u, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return hasReadableContent(cleaned) ? cleaned : ''
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitInlineTableFragments(text: string) {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('|')) {
        if (trimmed.endsWith('|')) return line
        return line.replace(/^(\s*\|[^|\n]+(?:\|[^|\n]+){2,}\|)\s+([^|\n].*)$/u, '$1\n\n$2')
      }

      return line.replace(/\s+(\|[^|\n]+(?:\|[^|\n]+){2,}\|)/gu, '\n\n$1')
    })
    .join('\n')
}

function normalizeGeneratedMarkdown(markdown: string) {
  const compactHeadings = [
    '这一关要学会什么',
    '核心概念',
    '前置条件',
    '关键关系',
    '操作或使用流程',
    '标准学习步骤',
    '检查清单',
    '为什么重要',
    '流程图',
    '一句话记忆',
    '回忆问题',
    '主动回忆',
    '标准答案',
    '关键点',
    '常见误区',
    '应用场景',
    '案例演示',
    '练习任务',
    '拓展理解',
    '补充理解',
    '延伸学习',
    '下一步',
  ]
  let text = markdown
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim()

  text = text
    .replace(/([。！？])\s*[、，,；;]\s*/gu, '$1 ')
    .replace(/([；;])\s*[、，,]\s*/gu, '$1 ')
    .replace(/([^\n])[ \t]+(#{1,4}\s+)/g, '$1\n\n$2')
    .replace(/([。！？；;：:])\s+([-*]\s+)/gu, '$1\n$2')
    .replace(/([。！？；;：:])\s+(\d+\.\s+)/gu, '$1\n$2')
    .replace(/([。！？])\s+(这些要点|这一关|需要画图|每完成一步|本关还要补足|再补三条|把这一关)/gu, '$1\n\n$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  text = splitInlineTableFragments(text)

  compactHeadings.forEach((heading) => {
    text = text.replace(
      new RegExp(`(^|\\n)(#{1,4}\\s+${escapeRegExp(heading)})(?:[：:]?)[ \\t]+(?=\\S)`, 'gu'),
      '$1$2\n\n',
    )
  })

  text = text
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text
}

export function MermaidDiagram({
  code,
  index,
  className,
}: {
  code: string
  index: number
  className?: string
}) {
  const reactId = useId()
  const diagramId = `shijie-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${index}`
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function renderDiagram() {
      const diagram = code.trim()
      if (!diagram) return

      setError('')
      setSvg('')

      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          flowchart: {
            curve: 'basis',
            htmlLabels: true,
            nodeSpacing: 58,
            rankSpacing: 92,
            padding: 18,
          },
          themeVariables: {
            background: 'transparent',
            mainBkg: '#17201d',
            secondBkg: '#1f1f28',
            tertiaryBkg: '#1b2230',
            primaryColor: '#15352e',
            primaryBorderColor: '#3fd8b4',
            primaryTextColor: '#f4f7fb',
            lineColor: '#7dd3fc',
            textColor: '#f4f7fb',
            fontFamily: 'inherit',
            fontSize: '18px',
          },
        })
        const result = await mermaid.render(diagramId, diagram)
        const normalizedSvg = result.svg.replace(/max-width:[^;"']+;?/g, '')
        if (active) setSvg(normalizedSvg)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      }
    }

    void renderDiagram()

    return () => {
      active = false
    }
  }, [code, diagramId])

  if (error) {
    return (
      <div className={cn('rounded-2xl border border-amber-300/14 bg-[#1f1d19] p-4', className)}>
        <div className="mb-2 text-xs font-medium text-amber-100/80">Mermaid 图表渲染失败，已显示原始代码。</div>
        <pre className="overflow-x-auto rounded-xl border border-white/8 bg-[#171717] p-3">
          <code className="font-mono text-[12px] leading-6 text-foreground/82">{code}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className={cn('overflow-x-auto rounded-2xl border border-emerald-300/14 bg-[#131917] p-4', className)}>
      {svg ? (
        <div
          className="h-full w-full [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:!w-full [&_svg]:!max-w-none [&_.edgeLabel]:rounded-md [&_.edgeLabel]:bg-[#101115]/80 [&_.nodeLabel]:font-semibold"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="text-sm text-muted-foreground">正在渲染图表...</div>
      )}
    </div>
  )
}

function parseMarkdown(markdown: string) {
  const lines = normalizeGeneratedMarkdown(markdown).split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    if (/^\s*([-*_]\s*){3,}$/.test(line.trim())) {
      index += 1
      continue
    }

    if (looksLikeTableRow(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = parseTableCells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && looksLikeTableRow(lines[index]) && lines[index].trim()) {
        rows.push(parseTableCells(lines[index]))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows: normalizeTableRows(headers, rows) })
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() })
      index += 1
      continue
    }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ type: 'code', lang, text: codeLines.join('\n') })
      continue
    }

    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (index < lines.length && lines[index].startsWith('>')) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join(' ') })
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        const rawItem = cleanGeneratedListItem(lines[index].replace(/^[-*]\s+/, ''))
        const inlineItems = splitInlineUnorderedItems(rawItem)
        items.push(...(inlineItems ?? [rawItem]).filter(Boolean))
        index += 1
      }
      blocks.push({ type: 'list', items })
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        const inlineItems = splitInlineOrderedItems(lines[index])
        if (inlineItems) {
          items.push(...inlineItems)
        } else {
          const item = cleanGeneratedListItem(lines[index].replace(/^\d+\.\s+/, ''))
          if (item) items.push(item)
        }
        index += 1
      }
      blocks.push({ type: 'ordered-list', items })
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith('```') &&
      !lines[index].startsWith('>') &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index]) &&
      !(looksLikeTableRow(lines[index]) && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
    ) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') })
  }

  return blocks
}

function buildSections(blocks: Block[]): {
  leadHeading: HeadingBlock | null
  sections: Section[]
} {
  let leadHeading: HeadingBlock | null = null
  const sections: Section[] = []
  let current: Section = { blocks: [] }

  blocks.forEach((block, index) => {
    if (block.type === 'heading') {
      if (!leadHeading && block.level <= 2 && index === 0 && current.blocks.length === 0) {
        leadHeading = block
        return
      }

      if (current.heading || current.blocks.length > 0) {
        sections.push(current)
      }

      current = { heading: block, blocks: [] }
      return
    }

    current.blocks.push(block)
  })

  if (current.heading || current.blocks.length > 0) {
    sections.push(current)
  }

  return { leadHeading, sections }
}

function getHeadingEmoji(text: string, level: number) {
  if (/^[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(text.trim())) return ''
  if (/这一关要学会什么|目标|学会/u.test(text)) return '🎯'
  if (/回忆问题|测验|练习|情景题|试试|思考/u.test(text)) return '✍️'
  if (/你的回忆/u.test(text)) return '📝'
  if (/标准答案|答案/u.test(text)) return '✅'
  if (/步骤|流程|怎么|如何|操作/u.test(text)) return '🪜'
  if (/为什么|原理|机制|关系|逻辑/u.test(text)) return '🧩'
  if (/评分|检查清单|自查|排错|扣分/u.test(text)) return '🔍'
  if (/注意|错误|陷阱|误区/u.test(text)) return '⚠️'
  if (/重点|核心|关键/u.test(text)) return '🧠'
  if (/例子|示例|演示|场景|应用|案例/u.test(text)) return '📌'
  if (/区别|对比|边界/u.test(text)) return '↔️'
  if (/一句话记忆|记忆/u.test(text)) return '💡'
  if (/下一步/u.test(text)) return '➡️'
  if (level <= 2) return '✨'
  return '•'
}

function getSectionTone(text: string): SectionTone {
  if (/回忆问题|测验|练习|情景题|试试|思考/u.test(text)) return 'quiz'
  if (/标准答案|你的回忆|下一步/u.test(text)) return 'answer'
  if (/步骤|流程|怎么|如何/u.test(text)) return 'steps'
  if (/为什么|原理|机制|关系|逻辑/u.test(text)) return 'reason'
  if (/例子|示例|演示|场景|应用|案例/u.test(text)) return 'example'
  if (/注意|错误|陷阱|误区/u.test(text)) return 'warning'
  if (/重点|核心|关键/u.test(text)) return 'keypoint'
  if (/一句话记忆|记忆/u.test(text)) return 'memory'
  return 'default'
}

function getSectionToneClasses(tone: SectionTone) {
  switch (tone) {
    case 'quiz':
      return {
        shell: 'border-sky-400/16 bg-[linear-gradient(180deg,rgba(28,39,51,0.92),rgba(25,31,40,0.92))]',
        block: 'border-sky-300/10 bg-sky-400/[0.03]',
      }
    case 'steps':
      return {
        shell: 'border-emerald-400/14 bg-[linear-gradient(180deg,rgba(28,35,32,0.92),rgba(24,29,27,0.92))]',
        block: 'border-emerald-300/10 bg-emerald-400/[0.03]',
      }
    case 'warning':
      return {
        shell: 'border-amber-400/14 bg-[linear-gradient(180deg,rgba(38,33,25,0.92),rgba(30,27,22,0.92))]',
        block: 'border-amber-300/10 bg-amber-400/[0.03]',
      }
    case 'keypoint':
      return {
        shell: 'border-violet-400/14 bg-[linear-gradient(180deg,rgba(34,30,41,0.92),rgba(27,25,32,0.92))]',
        block: 'border-violet-300/10 bg-violet-400/[0.03]',
      }
    case 'reason':
      return {
        shell: 'border-cyan-400/14 bg-[linear-gradient(180deg,rgba(26,36,38,0.92),rgba(23,30,32,0.92))]',
        block: 'border-cyan-300/10 bg-cyan-400/[0.03]',
      }
    case 'example':
      return {
        shell: 'border-rose-300/14 bg-[linear-gradient(180deg,rgba(39,30,34,0.92),rgba(31,25,28,0.92))]',
        block: 'border-rose-200/10 bg-rose-300/[0.03]',
      }
    case 'answer':
      return {
        shell: 'border-sky-400/14 bg-[linear-gradient(180deg,rgba(27,34,42,0.92),rgba(23,28,35,0.92))]',
        block: 'border-sky-300/10 bg-sky-400/[0.03]',
      }
    case 'memory':
      return {
        shell: 'border-yellow-300/14 bg-[linear-gradient(180deg,rgba(38,35,26,0.92),rgba(31,29,23,0.92))]',
        block: 'border-yellow-200/10 bg-yellow-300/[0.03]',
      }
    default:
      return {
        shell: 'border-white/7 bg-[#1d1d1d]',
        block: 'border-white/[0.06] bg-white/[0.025]',
      }
  }
}

function splitInlineOrderedItems(text: string) {
  const normalized = text.trim()
  if (!/^\d+\.\s+/u.test(normalized)) return null
  const matches = normalized.match(/\d+\.\s+[\s\S]*?(?=(?:\s+\d+\.\s+)|$)/g)
  if (!matches || matches.length < 2) return null
  return matches.map((item) => cleanGeneratedListItem(item.replace(/^\d+\.\s+/u, ''))).filter(Boolean)
}

function splitInlineUnorderedItems(text: string) {
  const parts = text.split(/\s+[-*]\s+/u).map(cleanGeneratedListItem).filter(Boolean)
  return parts.length > 1 ? parts : null
}

function splitLongParagraphItems(text: string) {
  const normalized = text.trim()
  if (normalized.length < 150) return null
  if (/^[-*]\s+|\n[-*]\s+/u.test(normalized)) return null

  const items = normalized
    .match(/[^。！？；;]+[。！？；;]?/gu)
    ?.map(cleanGeneratedListItem)
    .filter((item) => item.length >= 8)

  if (!items || items.length < 2) return null
  const shortEnough = items.every((item) => item.length <= 150)
  if (!shortEnough) return null
  return items
}

function normalizeTableRows(headers: string[], rows: string[][]) {
  const columnCount = Math.max(headers.length, 1)

  return rows
    .map((row) => {
      const cells = row.map((cell) => cell.trim())
      if (cells.length < columnCount) {
        return [...cells, ...Array.from({ length: columnCount - cells.length }, () => '')]
      }
      if (cells.length > columnCount) {
        return [...cells.slice(0, columnCount - 1), cells.slice(columnCount - 1).join(' | ')]
      }
      return cells
    })
    .filter((row) => row.some(hasReadableContent))
}

function hasMeaningfulBlock(block: Exclude<Block, { type: 'heading' }>) {
  if (block.type === 'paragraph') return block.text.trim().length > 0
  if (block.type === 'blockquote') return block.text.trim().length > 0
  if (block.type === 'list' || block.type === 'ordered-list') return block.items.some((item) => item.trim().length > 0)
  if (block.type === 'code') return block.text.trim().length > 0
  return block.headers.some((header) => header.trim().length > 0) || block.rows.some((row) => row.some((cell) => cell.trim().length > 0))
}

function getUntitledSectionTone(blocks: Exclude<Block, { type: 'heading' }>[]) {
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'blockquote') {
      if (block.text.trim()) return getSectionTone(block.text)
      continue
    }

    if (block.type === 'list' || block.type === 'ordered-list') {
      const candidate = block.items.find((item) => item.trim().length > 0)
      if (candidate) return getSectionTone(candidate)
      continue
    }

    if (block.type === 'table') {
      const candidate = [...block.headers, ...block.rows.flat()].find((cell) => cell.trim().length > 0)
      if (candidate) return getSectionTone(candidate)
    }
  }

  return 'default'
}

function renderBlock(
  block: Exclude<Block, { type: 'heading' }>,
  index: number,
  tone: SectionTone,
  shouldBubble: boolean,
  options: RenderInlineOptions,
) {
  const toneClasses = getSectionToneClasses(tone)
  const bubbleClass = shouldBubble
    ? cn('rounded-[18px] border px-4 py-3', toneClasses.block)
    : ''

  if (block.type === 'paragraph') {
    const orderedItems = splitInlineOrderedItems(block.text)
    if (orderedItems) {
      return (
        <div key={`op-shell-${index}`} className={bubbleClass}>
          <ol className="space-y-2 pl-6 text-sm text-foreground/90">
            {orderedItems.map((item, itemIndex) => (
              <li key={`oli-${index}-${itemIndex}`} className="list-decimal leading-7">
                {renderInline(item, options)}
              </li>
            ))}
          </ol>
        </div>
      )
    }

    const paragraphItems = splitLongParagraphItems(block.text)
    if (paragraphItems) {
      return (
        <div key={`lp-shell-${index}`} className={bubbleClass}>
          <ul className="w-full space-y-2 pl-5 text-sm text-foreground/90">
            {paragraphItems.map((item, itemIndex) => (
              <li key={`lpi-${index}-${itemIndex}`} className="list-disc leading-7">
                {renderInline(item, options)}
              </li>
            ))}
          </ul>
        </div>
      )
    }

    const isLabelParagraph = /^\*\*[^*]+：\*\*/u.test(block.text.trim())
    return (
      <div key={`p-shell-${index}`} className={bubbleClass}>
        <p className={cn('w-full text-sm leading-7 text-foreground/90', isLabelParagraph ? 'indent-0' : 'indent-[2em]')}>
          {renderInline(block.text, options)}
        </p>
      </div>
    )
  }

  if (block.type === 'blockquote') {
    return (
      <div key={`q-shell-${index}`} className={bubbleClass}>
        <blockquote className="rounded-r-2xl border-l-2 border-white/16 bg-[#1c1c1c] px-4 py-3 text-muted-foreground">
          <p className="indent-[2em]">{renderInline(block.text, options)}</p>
        </blockquote>
      </div>
    )
  }

  if (block.type === 'list') {
    const visibleItems = block.items.map(cleanGeneratedListItem).filter(Boolean)
    return (
      <div key={`l-shell-${index}`} className={bubbleClass}>
        <ul className="w-full space-y-2 pl-5 text-sm text-foreground/90">
          {visibleItems.map((item, itemIndex) => (
            <li key={`li-${index}-${itemIndex}`} className="list-disc">
              {renderInline(item, options)}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (block.type === 'ordered-list') {
    const visibleItems = block.items.map(cleanGeneratedListItem).filter(Boolean)
    return (
      <div key={`ol-shell-${index}`} className={bubbleClass}>
        <ol className="w-full space-y-2 pl-6 text-sm text-foreground/90">
          {visibleItems.map((item, itemIndex) => (
            <li key={`oli-${index}-${itemIndex}`} className="list-decimal leading-7">
              {renderInline(item, options)}
            </li>
          ))}
        </ol>
      </div>
    )
  }

  if (block.type === 'table') {
    return (
      <div key={`t-${index}`} className="overflow-x-auto rounded-2xl border border-white/8 bg-[#1a1a1a]">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="bg-[#222222] text-foreground">
            <tr>
              {block.headers.map((header, headerIndex) => (
                <th key={`th-${index}-${headerIndex}`} className="border-b border-white/8 px-4 py-3 font-medium">
                  {renderInline(header, options)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`tr-${index}-${rowIndex}`} className="border-b border-white/6 last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={`td-${index}-${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top text-foreground/88">
                    {renderInline(cell, options)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (block.type === 'code' && block.lang.trim().toLowerCase() === 'mermaid') {
    return <MermaidDiagram key={`m-${index}`} code={block.text} index={index} />
  }

  return (
    <pre key={`c-${index}`} className="overflow-x-auto rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
      <code className="font-mono text-[13px] leading-6 text-foreground/88" data-lang={block.lang || undefined}>
        {renderHighlightedText(block.text, options.highlightQuery, `code-${index}`)}
      </code>
    </pre>
  )
}

function isFlowSectionTitle(text: string | undefined) {
  return Boolean(text && /流程图|流程|步骤图|路线图/u.test(text))
}

function shouldRenderCompactFlow(text: string | undefined, items: string[]) {
  if (!isFlowSectionTitle(text)) return false
  if (text && /操作|使用|步骤|标准|配置/u.test(text)) return false
  return items.length >= 2 && items.every((item) => item.trim().length <= 28)
}

function renderFlowSteps(items: string[], index: number) {
  const cleanedItems = items.map((item) => item.trim()).filter(Boolean)
  if (!cleanedItems.length) return null

  return (
    <div key={`flow-${index}`} className="w-full">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {cleanedItems.map((item, itemIndex) => (
          <div key={`flow-item-${index}-${itemIndex}`} className="flex min-w-0 items-center gap-2">
            <div className="flex max-w-full items-center gap-2 rounded-full border border-emerald-300/14 bg-emerald-300/[0.055] px-3 py-1.5 text-sm leading-5 text-foreground/90">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-300/12 text-[11px] font-semibold text-emerald-100">
                {itemIndex + 1}
              </span>
              <span className="min-w-0 break-words">{renderInline(item)}</span>
            </div>
            {itemIndex < cleanedItems.length - 1 ? (
              <span aria-hidden className="hidden text-xs text-emerald-100/36 sm:inline">
                →
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function renderSectionBlocks(
  section: Section,
  tone: SectionTone,
  shouldBubbleBlocks: boolean,
  options: RenderInlineOptions,
) {
  const isFlowSection = isFlowSectionTitle(section.heading?.text)
  return section.blocks.map((block, blockIndex) => {
    if (
      isFlowSection &&
      (block.type === 'ordered-list' || block.type === 'list') &&
      shouldRenderCompactFlow(section.heading?.text, block.items)
    ) {
      return renderFlowSteps(block.items, blockIndex)
    }

    return renderBlock(block, blockIndex, tone, shouldBubbleBlocks, options)
  })
}

export function MarkdownRenderer({
  content,
  className,
  hideLeadHeading = false,
  shellUntitledSections = false,
  plainFlow = false,
  highlightQuery = '',
  headingIdPrefix = 'markdown-heading',
}: MarkdownRendererProps) {
  const blocks = parseMarkdown(content)
  const { leadHeading, sections } = buildSections(blocks)
  const titleHeading = hideLeadHeading ? null : leadHeading
  const visibleSections = sections.filter((section) => section.blocks.some(hasMeaningfulBlock))
  const headingCounts = new Map<string, number>()

  function getNextHeadingId(text: string) {
    const slug = slugifyMarkdownHeading(text)
    const occurrence = headingCounts.get(slug) ?? 0
    headingCounts.set(slug, occurrence + 1)
    return buildMarkdownHeadingId(text, occurrence, headingIdPrefix)
  }

  return (
    <div className={cn('space-y-3 text-sm leading-7 text-foreground/92', className)}>
      {titleHeading ? (
        <div id={getNextHeadingId(titleHeading.text)} className="flex items-center gap-2 px-1 text-[17px] font-semibold tracking-tight text-foreground">
          <span aria-hidden className="text-[15px] opacity-90">
            {getHeadingEmoji(titleHeading.text, titleHeading.level)}
          </span>
          <span>{renderInline(titleHeading.text, { highlightQuery })}</span>
        </div>
      ) : null}

      {visibleSections.map((section, sectionIndex) => {
        const sectionHeading = section.heading
        const tone = sectionHeading ? getSectionTone(sectionHeading.text) : getUntitledSectionTone(section.blocks)
        const toneClasses = getSectionToneClasses(tone)
        const shouldBubbleBlocks = false
        const showSectionShell = Boolean(sectionHeading) || shellUntitledSections

        if (plainFlow) {
          return (
            <div key={`section-${sectionIndex}`} className="space-y-2.5">
              {sectionHeading ? (
                <div id={getNextHeadingId(sectionHeading.text)} className="flex items-center gap-2 pt-1 text-[15px] font-semibold tracking-tight text-foreground">
                  {getHeadingEmoji(sectionHeading.text, sectionHeading.level) ? (
                    <span aria-hidden className="text-[14px] opacity-85">
                      {getHeadingEmoji(sectionHeading.text, sectionHeading.level)}
                    </span>
                  ) : null}
                  <span>{renderInline(sectionHeading.text, { highlightQuery })}</span>
                </div>
              ) : null}
              {renderSectionBlocks(section, tone, shouldBubbleBlocks, { highlightQuery })}
            </div>
          )
        }

        if (!showSectionShell) {
          return (
            <div key={`section-${sectionIndex}`} className="space-y-2.5">
              {renderSectionBlocks(section, tone, shouldBubbleBlocks, { highlightQuery })}
            </div>
          )
        }

        return (
          <div
            key={`section-${sectionIndex}`}
            className={cn(
              'rounded-[18px] border px-4 py-3.5 shadow-none',
              toneClasses.shell,
            )}
          >
            {sectionHeading ? (
              <div id={getNextHeadingId(sectionHeading.text)} className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
                  {getHeadingEmoji(sectionHeading.text, sectionHeading.level) ? (
                    <span aria-hidden className="text-[14px] opacity-85">
                      {getHeadingEmoji(sectionHeading.text, sectionHeading.level)}
                    </span>
                  ) : null}
                  <span>{renderInline(sectionHeading.text, { highlightQuery })}</span>
                </div>
              </div>
            ) : null}

            <div className="space-y-2.5">
              {renderSectionBlocks(section, tone, shouldBubbleBlocks, { highlightQuery })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

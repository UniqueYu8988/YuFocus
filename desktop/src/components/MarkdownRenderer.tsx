import type { ReactNode } from 'react'
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

function renderInline(text: string) {
  const parts: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|<u>[^<]+<\/u>|`[^`]+`)/g
  let lastIndex = 0

  text.replace(pattern, (token, _group, offset: number) => {
    if (offset > lastIndex) {
      parts.push(text.slice(lastIndex, offset))
    }

    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`${offset}-bold`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith('<u>') && token.endsWith('</u>')) {
      parts.push(
        <span
          key={`${offset}-underline`}
          className="underline decoration-sky-300/55 decoration-2 underline-offset-[5px]"
        >
          {token.slice(3, -4)}
        </span>,
      )
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`${offset}-code`}
          className="rounded-md border border-white/8 bg-[#202020] px-1.5 py-0.5 font-mono text-[0.9em] text-foreground/88"
        >
          {token.slice(1, -1)}
        </code>,
      )
    }

    lastIndex = offset + token.length
    return token
  })

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
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

function parseMarkdown(markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
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
      blocks.push({ type: 'table', headers, rows })
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
        const rawItem = lines[index].replace(/^[-*]\s+/, '').trim()
        const inlineItems = splitInlineUnorderedItems(rawItem)
        items.push(...(inlineItems ?? [rawItem]))
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
          items.push(lines[index].replace(/^\d+\.\s+/, '').trim())
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
  return matches.map((item) => item.replace(/^\d+\.\s+/u, '').trim()).filter(Boolean)
}

function splitInlineUnorderedItems(text: string) {
  const parts = text.split(/\s+[-*]\s+/u).map((item) => item.trim()).filter(Boolean)
  return parts.length > 1 ? parts : null
}

function splitLongParagraphItems(text: string) {
  const normalized = text.trim()
  if (normalized.length < 150) return null
  if (/^[-*]\s+|\n[-*]\s+/u.test(normalized)) return null

  const items = normalized
    .match(/[^。！？；;]+[。！？；;]?/gu)
    ?.map((item) => item.trim())
    .filter((item) => item.length >= 8)

  if (!items || items.length < 2) return null
  const shortEnough = items.every((item) => item.length <= 150)
  if (!shortEnough) return null
  return items
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
                {renderInline(item)}
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
                {renderInline(item)}
              </li>
            ))}
          </ul>
        </div>
      )
    }

    return (
      <div key={`p-shell-${index}`} className={bubbleClass}>
        <p className="w-full indent-[2em] text-sm leading-7 text-foreground/90">{renderInline(block.text)}</p>
      </div>
    )
  }

  if (block.type === 'blockquote') {
    return (
      <div key={`q-shell-${index}`} className={bubbleClass}>
        <blockquote className="rounded-r-2xl border-l-2 border-white/16 bg-[#1c1c1c] px-4 py-3 text-muted-foreground">
          <p className="indent-[2em]">{renderInline(block.text)}</p>
        </blockquote>
      </div>
    )
  }

  if (block.type === 'list') {
    return (
      <div key={`l-shell-${index}`} className={bubbleClass}>
        <ul className="w-full space-y-2 pl-5 text-sm text-foreground/90">
          {block.items.map((item, itemIndex) => (
            <li key={`li-${index}-${itemIndex}`} className="list-disc">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (block.type === 'ordered-list') {
    return (
      <div key={`ol-shell-${index}`} className={bubbleClass}>
        <ol className="w-full space-y-2 pl-6 text-sm text-foreground/90">
          {block.items.map((item, itemIndex) => (
            <li key={`oli-${index}-${itemIndex}`} className="list-decimal leading-7">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      </div>
    )
  }

  if (block.type === 'table') {
    return (
      <div key={`t-${index}`} className="overflow-x-auto rounded-2xl border border-white/8 bg-[#1a1a1a]">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-[#222222] text-foreground">
            <tr>
              {block.headers.map((header, headerIndex) => (
                <th key={`th-${index}-${headerIndex}`} className="border-b border-white/8 px-4 py-3 font-medium">
                  {renderInline(header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`tr-${index}-${rowIndex}`} className="border-b border-white/6 last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={`td-${index}-${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top text-foreground/88">
                    {renderInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <pre key={`c-${index}`} className="overflow-x-auto rounded-2xl border border-white/8 bg-[#1a1a1a] p-4">
      <code className="font-mono text-[13px] leading-6 text-foreground/88" data-lang={block.lang || undefined}>
        {block.text}
      </code>
    </pre>
  )
}

export function MarkdownRenderer({
  content,
  className,
  hideLeadHeading = false,
  shellUntitledSections = false,
  plainFlow = false,
}: {
  content: string
  className?: string
  hideLeadHeading?: boolean
  shellUntitledSections?: boolean
  plainFlow?: boolean
}) {
  const blocks = parseMarkdown(content)
  const { leadHeading, sections } = buildSections(blocks)
  const titleHeading = hideLeadHeading ? null : leadHeading
  const visibleSections = sections.filter((section) => section.blocks.some(hasMeaningfulBlock))

  return (
    <div className={cn('space-y-3 text-sm leading-7 text-foreground/92', className)}>
      {titleHeading ? (
        <div className="flex items-center gap-2 px-1 text-[17px] font-semibold tracking-tight text-foreground">
          <span aria-hidden className="text-[15px] opacity-90">
            {getHeadingEmoji(titleHeading.text, titleHeading.level)}
          </span>
          <span>{renderInline(titleHeading.text)}</span>
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
                <div className="flex items-center gap-2 pt-1 text-[15px] font-semibold tracking-tight text-foreground">
                  {getHeadingEmoji(sectionHeading.text, sectionHeading.level) ? (
                    <span aria-hidden className="text-[14px] opacity-85">
                      {getHeadingEmoji(sectionHeading.text, sectionHeading.level)}
                    </span>
                  ) : null}
                  <span>{renderInline(sectionHeading.text)}</span>
                </div>
              ) : null}
              {section.blocks.map((block, blockIndex) => renderBlock(block, blockIndex, tone, shouldBubbleBlocks))}
            </div>
          )
        }

        if (!showSectionShell) {
          return (
            <div key={`section-${sectionIndex}`} className="space-y-2.5">
              {section.blocks.map((block, blockIndex) => renderBlock(block, blockIndex, tone, shouldBubbleBlocks))}
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
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
                  {getHeadingEmoji(sectionHeading.text, sectionHeading.level) ? (
                    <span aria-hidden className="text-[14px] opacity-85">
                      {getHeadingEmoji(sectionHeading.text, sectionHeading.level)}
                    </span>
                  ) : null}
                  <span>{renderInline(sectionHeading.text)}</span>
                </div>
              </div>
            ) : null}

            <div className="space-y-2.5">
              {section.blocks.map((block, blockIndex) => renderBlock(block, blockIndex, tone, shouldBubbleBlocks))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

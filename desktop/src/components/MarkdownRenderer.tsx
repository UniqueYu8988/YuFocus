import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }

function renderInline(text: string) {
  const parts: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let lastIndex = 0

  text.replace(pattern, (token, _group, offset: number) => {
    if (offset > lastIndex) {
      parts.push(text.slice(lastIndex, offset))
    }

    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`${offset}-bold`} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`${offset}-code`}
          className="rounded-md border border-white/8 bg-black/20 px-1.5 py-0.5 font-mono text-[0.9em] text-foreground/88"
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
        items.push(lines[index].replace(/^[-*]\s+/, '').trim())
        index += 1
      }
      blocks.push({ type: 'list', items })
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith('```') &&
      !lines[index].startsWith('>') &&
      !/^[-*]\s+/.test(lines[index]) &&
      !(looksLikeTableRow(lines[index]) && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
    ) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') })
  }

  return blocks
}

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  const blocks = parseMarkdown(content)

  return (
    <div className={cn('space-y-3 text-sm leading-7 text-foreground/92', className)}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = block.level <= 2 ? 'h2' : 'h3'
          return (
            <Tag key={`h-${index}`} className={cn(block.level <= 2 ? 'text-base font-semibold' : 'text-sm font-semibold text-foreground/88')}>
              {renderInline(block.text)}
            </Tag>
          )
        }

        if (block.type === 'paragraph') {
          return <p key={`p-${index}`} className="text-sm leading-7 text-foreground/90">{renderInline(block.text)}</p>
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={`q-${index}`} className="rounded-r-2xl border-l-2 border-white/16 bg-white/[0.04] px-4 py-3 text-muted-foreground">
              <p>{renderInline(block.text)}</p>
            </blockquote>
          )
        }

        if (block.type === 'list') {
          return (
            <ul key={`l-${index}`} className="space-y-2 pl-5 text-sm text-foreground/90">
              {block.items.map((item, itemIndex) => (
                <li key={`li-${index}-${itemIndex}`} className="list-disc">{renderInline(item)}</li>
              ))}
            </ul>
          )
        }

        if (block.type === 'table') {
          return (
            <div key={`t-${index}`} className="overflow-x-auto rounded-2xl border border-white/8 bg-black/15">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="bg-white/6 text-foreground">
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
          <pre key={`c-${index}`} className="overflow-x-auto rounded-2xl border border-white/8 bg-black/20 p-4">
            <code className="font-mono text-[13px] leading-6 text-foreground/88" data-lang={block.lang || undefined}>
              {block.text}
            </code>
          </pre>
        )
      })}
    </div>
  )
}

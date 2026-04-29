import type { FlatCourseNode } from '@/types/course'

const NON_SPEECH_SECTION_HEADINGS = new Set(['小测问题', '回忆问题', '标准答案'])

export function stripMarkdownForSpeech(text: string) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<u>([^<]+)<\/u>/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[★☆◆◇■□●○◎※→←↑↓]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function estimateMiniMaxSpeechCharacters(text: string) {
  const speechText = stripMarkdownForSpeech(text)
  let total = 0
  for (const char of Array.from(speechText)) {
    total += /\p{Script=Han}/u.test(char) ? 2 : 1
  }
  return total
}

function removeNonSpeechSections(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  const kept: string[] = []
  let skippingLevel: number | null = null

  for (const line of lines) {
    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const title = headingMatch[2].replace(/[：:]\s*$/, '').trim()
      if (skippingLevel !== null && level <= skippingLevel) {
        skippingLevel = null
      }
      if (NON_SPEECH_SECTION_HEADINGS.has(title)) {
        skippingLevel = level
        continue
      }
    }

    if (skippingLevel === null) {
      kept.push(line)
    }
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function buildLessonSpeechMarkdown(node: FlatCourseNode) {
  const markdown = node.teacher_ready_content?.teaching_markdown?.trim()
  if (markdown) return removeNonSpeechSections(markdown)
  return [node.title, node.summary].filter(Boolean).join('\n\n').trim()
}

export function formatMiniMaxCharacters(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

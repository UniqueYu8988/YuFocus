import type { CoachTurnResult, FlatCourseNode } from '../types/course'

// Fallback turns for the 专注 reader's legacy step-by-step state machine.
// They are intentionally kept away from the current API-driven production flow.
const LEARNED_CONFIRMATION_TEXT = '已学习'

function normalizeTeachingMarkdown(markdown: string) {
  const sectionHeadings = [
    '这一关要学会什么',
    '标准操作步骤',
    '每一步为什么重要',
    '考试/实操评分点',
    '考试评分点',
    '实操评分点',
    '常见错误',
    '常见误区',
    '一句话记忆',
    '小测问题',
    '回忆问题',
    '标准答案',
    '关键点',
  ]

  return sectionHeadings
    .reduce((current, heading) => {
      const pattern = new RegExp(`\\s*#{1,4}\\s+${heading}\\s*`, 'g')
      return current.replace(pattern, `\n\n## ${heading}\n\n`)
    }, markdown.trim())
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function buildAssistantTeachingMarkdown(node: FlatCourseNode) {
  const teacher = node.teacher_ready_content
  const markdown = teacher?.teaching_markdown?.trim()
  if (markdown) {
    return normalizeTeachingMarkdown(markdown)
  }

  return [
    `## ${node.title}`,
    '',
    node.summary || '这份资料还没有写入完整正文。请先回到制作页生成清洗稿或精读稿。',
  ].join('\n')
}

export function buildFallbackCoachTurn(options: {
  node: FlatCourseNode
  learningStatus: 'teaching' | 'quizzing'
  activeQuestion?: string | null
  answer?: string
  nextNode: FlatCourseNode | null
}): CoachTurnResult {
  const {
    node,
    learningStatus,
    activeQuestion,
    answer = '',
    nextNode,
  } = options

  if (learningStatus === 'teaching' && !answer.trim()) {
    return {
      reply: buildAssistantTeachingMarkdown(node),
      learningStatus: 'quizzing',
      markCurrentNodeCompleted: false,
      suggestedNextNodeId: null,
    }
  }

  if (!answer.trim()) {
    return {
      reply: `读完本节后，在下方输入框精确输入“${LEARNED_CONFIRMATION_TEXT}”进入下一小节。`,
      learningStatus: 'quizzing',
      markCurrentNodeCompleted: false,
      suggestedNextNodeId: null,
    }
  }

  if (answer.trim() !== LEARNED_CONFIRMATION_TEXT) {
    return {
      reply: `还没有标记完成。请精确输入“${LEARNED_CONFIRMATION_TEXT}”进入下一小节。`,
      learningStatus: 'quizzing',
      markCurrentNodeCompleted: false,
      suggestedNextNodeId: null,
    }
  }

  return {
    reply: nextNode
      ? `已记录。本节已学习完成，可以进入下一小节：**${nextNode.title}**。`
      : '已记录。这已经是最后一小节。',
    learningStatus: 'completed',
    markCurrentNodeCompleted: true,
    suggestedNextNodeId: nextNode?.id ?? null,
  }
}

export function resolveTrackedQuestion(node: FlatCourseNode, learningStatus: string, fallback: string | null) {
  void node
  if (learningStatus !== 'quizzing' || !fallback) return fallback
  const quoteLines = fallback
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('> '))
    .map((line) => line.replace(/^>\s*/, '').trim())
    .filter(Boolean)
  return quoteLines.length > 0 ? quoteLines[quoteLines.length - 1] : fallback
}

import type { CoachTurnResult, FlatCourseNode } from '../types/course'

function cleanList(values: string[] | undefined, limit: number) {
  return (values ?? []).map((item) => item.trim()).filter(Boolean).slice(0, limit)
}

function getQuizQuestion(node: FlatCourseNode, activeQuestion?: string | null) {
  return (
    activeQuestion?.trim() ||
    node.teacher_ready_content?.quiz_question?.trim() ||
    `不用看资料，用自己的话复述“${node.title}”这一关最重要的内容。`
  )
}

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

function formatStandardAnswerMarkdown(answer: string) {
  const trimmed = answer.trim()
  if (!trimmed) return ''
  if (/^\s*([-*]|\d+\.)\s+/m.test(trimmed) || trimmed.includes('\n')) return trimmed

  const sentences = trimmed
    .split(/(?<=[。！？；;])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  if (sentences.length < 2) return trimmed
  return sentences.map((sentence) => `- ${sentence}`).join('\n')
}

export function buildCodexTeachingMarkdown(node: FlatCourseNode) {
  const teacher = node.teacher_ready_content
  const markdown = teacher?.teaching_markdown?.trim()
  const quizQuestion = getQuizQuestion(node)
  if (markdown) {
    return [normalizeTeachingMarkdown(markdown), '', '## 回忆问题', '', `> ${quizQuestion}`, '', '先写下你的回忆，再对照标准答案。'].join('\n')
  }

  return [
    `## ${node.title}`,
    '',
    node.summary || '这节课还没有写入完整讲解。请先回到 Codex 课程制作窗口，为这一关补充 teacher_ready_content.teaching_markdown。',
    '',
    '## 回忆问题',
    '',
    `> ${quizQuestion}`,
    '',
    '先写下你的回忆，再对照标准答案。',
  ].join('\n')
}

function buildCodexReviewMarkdown(node: FlatCourseNode, answer: string, nextNode: FlatCourseNode | null) {
  const teacher = node.teacher_ready_content
  const standardAnswer = teacher?.standard_answer?.trim() || node.summary || `请回到课程正文，对照“${node.title}”的标准讲解。`
  const keyPoints = cleanList(teacher?.key_points, 8)
  const mistakes = cleanList(teacher?.common_mistakes, 6)

  return [
    '## 你的回忆',
    '',
    `> ${answer.trim() || '（空回答）'}`,
    '',
    '## 标准答案',
    '',
    formatStandardAnswerMarkdown(standardAnswer),
    '',
    keyPoints.length > 0
      ? ['## 关键点', '', ...keyPoints.map((item) => `- ${item}`)].join('\n')
      : '',
    mistakes.length > 0
      ? ['## 常见误区', '', ...mistakes.map((item) => `- ${item}`)].join('\n')
      : '',
    '',
    '## 下一步',
    '',
    nextNode
      ? `对照完标准答案后，直接进入下一关：**${nextNode.title}**。`
      : '这已经是最后一关。对照完标准答案后，可以回到课程中心复盘整门课。',
  ]
    .filter(Boolean)
    .join('\n')
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
      reply: buildCodexTeachingMarkdown(node),
      learningStatus: 'quizzing',
      markCurrentNodeCompleted: false,
      suggestedNextNodeId: null,
    }
  }

  if (!answer.trim()) {
    return {
      reply: ['## 回忆问题', '', `> ${getQuizQuestion(node, activeQuestion)}`, '', '先写下你的回忆，再对照标准答案。'].join('\n'),
      learningStatus: 'quizzing',
      markCurrentNodeCompleted: false,
      suggestedNextNodeId: null,
    }
  }

  return {
    reply: buildCodexReviewMarkdown(node, answer, nextNode),
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

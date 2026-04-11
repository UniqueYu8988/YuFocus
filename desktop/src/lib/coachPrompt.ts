import type { CoursePackage, FlatCourseNode, LearningStatus } from '../types/course'

type EvaluationResult = {
  correct: boolean
  matchedKeywords: string[]
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function makeInlineList(items: string[], emptyFallback: string) {
  if (items.length === 0) return emptyFallback
  return items.map((item) => `- ${item}`).join('\n')
}

function collectKeywords(node: FlatCourseNode) {
  const conceptKeywords = node.knowledge.concepts.map((concept) => concept.name.trim())
  const explanationKeywords = node.knowledge.concepts
    .flatMap((concept) => concept.explanation.split(/[，。、“”‘’：；（）()\s]+/))
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)

  return unique([...conceptKeywords, ...explanationKeywords]).slice(0, 12)
}

export function buildCoachSystemPrompt(
  course: CoursePackage | null,
  node: FlatCourseNode | null,
  learningStatus: LearningStatus,
  dependencyTitles: string[],
) {
  if (!course || !node) return ''

  return [
    '你是一个严厉但极具耐心的 AI 私人教练。',
    `用户正在学习节点：[${node.title}]。`,
    `当前状态：${learningStatus}。`,
    `课程总目标：${course.course.overall_goal}`,
    `节点摘要：${node.summary}`,
    `前置依赖：${dependencyTitles.length > 0 ? dependencyTitles.join('、') : '无'}`,
    '请严格遵循以下步骤：',
    '1. 先用大白话讲解该节点的核心概念。',
    '2. 讲解完后，立刻出一个简答题或情景题考考用户。',
    '3. 用户回答后，如果你判断错误，必须指出错在哪，并换个说法重新教，绝对不允许进入下一节。',
    '4. 如果用户回答正确，夸奖他，并在系统层面发送指令解锁下一个节点。',
  ].join('\n')
}

export function buildTeachingMarkdown(node: FlatCourseNode, dependencyTitles: string[]) {
  const conceptLines = node.knowledge.concepts.map((concept) => `- **${concept.name}**：${concept.explanation}`)
  const example = node.knowledge.examples[0]
  const checkpoint = node.knowledge.checkpoints[0]

  return [
    `## ${node.title}`,
    '',
    `${node.summary}`,
    '',
    dependencyTitles.length > 0
      ? `> 先修提醒：这一节默认你已经掌握了 ${dependencyTitles.join('、')}。`
      : '> 这是一节起步节点，你可以直接学。',
    '',
    '**这节只抓最要紧的点：**',
    conceptLines.join('\n') || '- 这一节没有额外概念清单，但有明确目标。',
    example
      ? ['', '**代入一个场景：**', `> ${example.scenario}`, '', `结论：${example.takeaway}`].join('\n')
      : '',
    checkpoint
      ? ['', `**学完你至少要能做到：** ${checkpoint}`].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildQuizMarkdown(node: FlatCourseNode) {
  const primaryConcept = node.knowledge.concepts[0]
  const secondaryConcept = node.knowledge.concepts[1]
  const example = node.knowledge.examples[0]

  if (example) {
    return [
      `### 小测：${node.title}`,
      '',
      '请你用自己的话回答：',
      '',
      `> ${example.scenario}`,
      '',
      secondaryConcept
        ? `请解释这里为什么会用到 **${primaryConcept?.name ?? node.title}**，以及它和 **${secondaryConcept.name}** 是什么关系。`
        : `请解释这里为什么会用到 **${primaryConcept?.name ?? node.title}**。`,
    ].join('\n')
  }

  return [
    `### 小测：${node.title}`,
    '',
    primaryConcept
      ? `请你用大白话解释一下 **${primaryConcept.name}** 是什么，并说出它在这一节里到底负责什么。`
      : '请你用自己的话复述这节的核心概念，并说明它的作用。',
  ].join('\n')
}

export function buildCorrectionMarkdown(node: FlatCourseNode, answer: string) {
  const keyConcept = node.knowledge.concepts[0]
  const checkpoint = node.knowledge.checkpoints[0]

  return [
    '### 这题先别急着往前走',
    '',
    '你刚才的回答是：',
    '',
    `> ${answer || '（空回答）'}`,
    '',
    '问题不在于你有没有说话，而在于你没有抓住这节真正的骨架。',
    keyConcept
      ? `重新记住一句话：**${keyConcept.name}**，本质上就是 ${keyConcept.explanation}。`
      : `重新记住一句话：这一节的重点是“${node.summary}”。`,
    checkpoint ? `你至少要能做到：${checkpoint}` : '',
    '',
    '现在换个更直接的说法，再回答一次。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSuccessMarkdown(node: FlatCourseNode, nextNode: FlatCourseNode | null) {
  return [
    '### 这一节过关了',
    '',
    `你已经抓住了 **${node.title}** 的关键点。`,
    nextNode
      ? `下一节将解锁 **${nextNode.title}**，继续往前推。`
      : '整条学习主线已经走完，可以开始回顾和串讲。',
  ].join('\n')
}

export function evaluateAnswer(node: FlatCourseNode, answer: string): EvaluationResult {
  const normalizedAnswer = answer.trim().toLowerCase()
  const keywords = collectKeywords(node)
  const matchedKeywords = keywords.filter((keyword) => normalizedAnswer.includes(keyword.toLowerCase()))
  const longEnough = normalizedAnswer.length >= 12
  const correct = longEnough && matchedKeywords.length >= 1

  return { correct, matchedKeywords }
}

export function buildCurrentNodeMeta(node: FlatCourseNode, dependencyTitles: string[]) {
  return {
    concepts: makeInlineList(
      node.knowledge.concepts.map((concept) => `${concept.name}：${concept.explanation}`),
      '- 暂无概念清单'
    ),
    checkpoints: makeInlineList(node.knowledge.checkpoints, '- 暂无检查点'),
    mistakes: makeInlineList(node.knowledge.common_mistakes, '- 暂无常见误区'),
    dependencies: dependencyTitles.length > 0 ? dependencyTitles.join('、') : '无',
  }
}

import type { CoursePackage, FlatCourseNode, LearningStatus, TeachingIntent } from '../types/course'

type EvaluationResult = {
  correct: boolean
  matchedKeywords: string[]
}

export type LocalAnswerGuide = {
  isStageQuiz: boolean
  expectedKeywords: string[]
  matchedKeywords: string[]
  missingKeywords: string[]
  likelyVerdict: 'likely_correct' | 'likely_partial' | 'likely_incorrect' | 'uncertain'
  cautionNotes: string[]
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function makeInlineList(items: string[], emptyFallback: string) {
  if (items.length === 0) return emptyFallback
  return items.map((item) => `- ${item}`).join('\n')
}

export function getNodeStageQuizQuestions(node: FlatCourseNode) {
  return node.knowledge.examples
    .filter((example) => example.title.includes('阶段小测'))
    .map((example) => example.scenario.trim())
    .filter(Boolean)
}

export function isStageRecapNode(node: FlatCourseNode) {
  return node.title.includes('复盘') || node.title.includes('小测') || getNodeStageQuizQuestions(node).length > 0
}

export function getPreferredQuizQuestion(node: FlatCourseNode, activeQuestion?: string | null) {
  const stageQuizQuestions = getNodeStageQuizQuestions(node)
  if (activeQuestion && activeQuestion.trim()) return activeQuestion.trim()
  if (stageQuizQuestions.length > 0) return stageQuizQuestions[0]
  return null
}

function collectKeywords(node: FlatCourseNode) {
  const conceptKeywords = node.knowledge.concepts.map((concept) => concept.name.trim())
  const explanationKeywords = node.knowledge.concepts
    .flatMap((concept) => concept.explanation.split(/[，。、“”‘’：；（）()\s]+/))
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)

  return unique([...conceptKeywords, ...explanationKeywords]).slice(0, 12)
}

function splitKnowledgeTokens(text: string) {
  return text
    .split(/[，。、“”‘’：；（）()\[\]【】、《》\s/]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
}

function getNodeComplexityScore(node: FlatCourseNode) {
  const conceptScore = Math.min(node.knowledge.concepts.length, 4)
  const exampleScore = Math.min(node.knowledge.examples.length, 3)
  const checkpointScore = Math.min(node.knowledge.checkpoints.length, 3)
  const mistakeScore = Math.min(node.knowledge.common_mistakes.length, 3)
  const dependencyScore = Math.min(node.dependencies.length, 2)
  const explanationLengthScore = Math.min(
    Math.round(
      node.knowledge.concepts.reduce((sum, concept) => sum + concept.explanation.length, 0) / 80,
    ),
    3,
  )

  return conceptScore + exampleScore + checkpointScore + mistakeScore + dependencyScore + explanationLengthScore
}

function getNodeTeachingDensity(node: FlatCourseNode) {
  const score = getNodeComplexityScore(node)
  if (score >= 10) return 'deep'
  if (score >= 6) return 'standard'
  return 'light'
}

function collectStageQuizAnchorKeywords(node: FlatCourseNode, activeQuestion?: string | null) {
  const conceptKeywords = node.knowledge.concepts.flatMap((concept) => [
    concept.name.trim(),
    ...splitKnowledgeTokens(concept.explanation),
  ])
  const checkpointKeywords = node.knowledge.checkpoints.flatMap((item) =>
    item.replace(/^小测\s*\d+[:：]/, '').split(/[，。、“”‘’：；（）()\[\]【】、《》\s/]+/)
  )
  const questionKeywords = activeQuestion ? splitKnowledgeTokens(activeQuestion) : []
  return unique([...conceptKeywords, ...checkpointKeywords, ...questionKeywords]).filter((word) => word.length >= 2).slice(0, 10)
}

export function buildLocalAnswerGuide(node: FlatCourseNode, answer: string, activeQuestion?: string | null): LocalAnswerGuide {
  const normalizedAnswer = answer.trim().toLocaleLowerCase('zh-CN')
  const isStageQuiz = isStageRecapNode(node)
  const expectedKeywords = isStageQuiz ? collectStageQuizAnchorKeywords(node, activeQuestion) : collectKeywords(node)
  const matchedKeywords = expectedKeywords.filter((keyword) => normalizedAnswer.includes(keyword.toLocaleLowerCase('zh-CN')))
  const missingKeywords = expectedKeywords.filter((keyword) => !matchedKeywords.includes(keyword)).slice(0, 4)
  const cautionNotes = unique(node.knowledge.common_mistakes).slice(0, 3)
  const longEnough = normalizedAnswer.length >= (isStageQuiz ? 18 : 12)
  const coverage = expectedKeywords.length > 0 ? matchedKeywords.length / expectedKeywords.length : 0

  let likelyVerdict: LocalAnswerGuide['likelyVerdict'] = 'uncertain'
  if (longEnough && (matchedKeywords.length >= 2 || coverage >= 0.45)) {
    likelyVerdict = 'likely_correct'
  } else if (matchedKeywords.length > 0 || coverage > 0.15 || normalizedAnswer.length >= 8) {
    likelyVerdict = 'likely_partial'
  } else if (!longEnough || matchedKeywords.length === 0 || coverage <= 0.15) {
    likelyVerdict = 'likely_incorrect'
  }

  return {
    isStageQuiz,
    expectedKeywords,
    matchedKeywords,
    missingKeywords,
    likelyVerdict,
    cautionNotes,
  }
}

export function buildCoachSystemPrompt(
  course: CoursePackage | null,
  node: FlatCourseNode | null,
  learningStatus: LearningStatus,
  dependencyTitles: string[],
  teachingIntent: TeachingIntent = 'default',
) {
  if (!course || !node) return ''
  const teachingDensity = getNodeTeachingDensity(node)

  const teachingIntentHint =
    teachingIntent === 'reframe'
      ? '本轮用户希望你“换个说法重讲”。请尽量避免重复刚才的措辞，多用更生活化的解释、比喻或不同角度。'
      : teachingIntent === 'deepen'
        ? '本轮用户希望你“讲深一点”。请在保持清晰的前提下，把因果关系、判断依据和容易混淆的边界讲得更透。'
        : teachingDensity === 'deep'
          ? '当前节点信息量较高，请按“自动加厚”的方式讲：解释完整一些，主动补足因果、边界和记忆抓手。'
          : teachingDensity === 'light'
            ? '当前节点偏基础，请保持轻盈清楚，先让用户快速抓住核心，不要堆太多旁枝。'
            : '本轮按默认讲解深度推进。'

  return [
    '你是一个严厉但极具耐心的 AI 私人教练。',
    `用户正在学习节点：[${node.title}]。`,
    `当前状态：${learningStatus}。`,
    `当前是否为阶段复盘节点：${isStageRecapNode(node) ? '是' : '否'}。`,
    `课程总目标：${course.course.overall_goal}`,
    `节点摘要：${node.summary}`,
    `前置依赖：${dependencyTitles.length > 0 ? dependencyTitles.join('、') : '无'}`,
    `重讲意图：${teachingIntentHint}`,
    '表达风格：请温柔、体贴、像陪学教练，允许少量 emoji 或一个简短颜文字，但不要堆砌。',
    '排版风格：优先用小标题和短段落组织内容，禁止使用 ---、***、___ 这类横向分割线。',
    '请严格遵循以下步骤：',
    '1. 先用一句大白话讲明白“这节到底在讲什么”。',
    '2. 再告诉用户“为什么它重要、会在什么场景下用到”。',
    '3. 然后把核心概念拆开讲，必要时指出概念之间的关系。',
    '4. 补一个简短场景、记忆钩子或判断口诀，帮助用户形成可回忆的抓手。',
    '5. 最后补一句最容易错的地方，再自然收束到提问。',
    '5.1 第一次提问优先用“低压力基础问法”，先让用户用一句自己的话解释核心点，不要一上来就问太满。',
    '5.2 只要信息足够，首次讲解不要太短，尽量让用户读完后能立刻复述，不要只给一两句定义。',
    '6. 用户回答后，如果你判断错误，必须指出错在哪，并换个说法重新教，绝对不允许进入下一节。',
    '7. 如果用户回答正确，夸奖他，并在系统层面发送指令解锁下一个节点。',
  ].join('\n')
}

function buildConceptWalkthrough(node: FlatCourseNode) {
  const coreConcepts = node.knowledge.concepts.slice(0, 3)
  if (coreConcepts.length === 0) return ''

  if (coreConcepts.length === 1) {
    return `- **${coreConcepts[0].name}**：${coreConcepts[0].explanation}`
  }

  return coreConcepts
    .map((concept, index) => {
      if (index === 0) return `- **${concept.name}**：${concept.explanation}`
      return `- 再往前一步看 **${concept.name}**：${concept.explanation}`
    })
    .join('\n')
}

function buildWhyItMatters(node: FlatCourseNode) {
  const example = node.knowledge.examples[0]
  const checkpoint = node.knowledge.checkpoints[0]

  if (example?.scenario) {
    return `因为你很可能会遇到这样的场景：${example.scenario}`
  }

  if (checkpoint) {
    return `因为学完这一节后，你至少要能做到：${checkpoint}`
  }

  return `因为它会直接影响你是否真正理解“${node.title}”这一节的核心作用。`
}

function buildLearningObjectiveBlock(node: FlatCourseNode) {
  const objectives = node.learning_objectives.filter(Boolean).slice(0, 3)
  if (objectives.length === 0) return ''
  return [
    '### 这节学完你要带走什么',
    '',
    ...objectives.map((objective) => `- ${objective}`),
  ].join('\n')
}

function buildMemoryHook(node: FlatCourseNode) {
  const firstConcept = node.knowledge.concepts[0]?.name
  const secondConcept = node.knowledge.concepts[1]?.name
  const checkpoint = node.knowledge.checkpoints[0]

  if (firstConcept && secondConcept) {
    return `先记一个抓手：看到 **${firstConcept}**，就顺手去想它和 **${secondConcept}** 怎么连起来。`
  }

  if (firstConcept && checkpoint) {
    return `你可以先这样记：抓住 **${firstConcept}**，最后能做到“${checkpoint}”，这节就算没白学。`
  }

  if (checkpoint) {
    return `先别背太多，先记住这一节最后要能做到：${checkpoint}。`
  }

  return `如果一时记不住全部内容，就先把 **${node.title}** 当成一个会反复用到的判断点。`
}

function buildQuickRetellBlock(node: FlatCourseNode) {
  const keyConcept = node.knowledge.concepts[0]
  const checkpoint = node.knowledge.checkpoints[0]
  const example = node.knowledge.examples[0]

  return [
    '### 如果现在就要你复述',
    '',
    keyConcept
      ? `你可以先这样开口：**${keyConcept.name}**，说白了就是 ${keyConcept.explanation}。`
      : `你可以先这样开口：${node.summary}`,
    checkpoint ? `再补一句“我学这一节，最后至少要能做到 ${checkpoint}”。` : '',
    example?.takeaway ? `如果怕忘，就把结论记成一句：${example.takeaway}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildConceptRelationHint(node: FlatCourseNode) {
  const concepts = node.knowledge.concepts.slice(0, 3)
  if (concepts.length < 2) return ''
  return `你可以把它理解成这样：先抓住 **${concepts[0].name}**，再把它和 **${concepts[1].name}** 连起来看，这样这节课的骨架才会立得住。`
}

function buildMistakeBlock(node: FlatCourseNode) {
  const mistakes = node.knowledge.common_mistakes.filter(Boolean).slice(0, 2)
  if (mistakes.length === 0) return ''
  return [
    '### 这节最容易踩的坑',
    '',
    ...mistakes.map((mistake) => `- ${mistake}`),
  ].join('\n')
}

function buildBoundaryBlock(node: FlatCourseNode) {
  const conceptNames = node.knowledge.concepts.map((concept) => concept.name).filter(Boolean)
  if (conceptNames.length >= 2) {
    return [
      '### 很容易混在一起的地方',
      '',
      `这一节里最值得分开的，通常是 **${conceptNames[0]}** 和 **${conceptNames[1]}**。`,
      `记法很简单：别把它们当成同义词，而要去看它们各自负责哪一步、在什么场景下出现。`,
    ].join('\n')
  }

  if (node.knowledge.common_mistakes.length > 0) {
    return [
      '### 很容易混在一起的地方',
      '',
      `这节最常见的混淆，往往就出在：${node.knowledge.common_mistakes[0]}`,
    ].join('\n')
  }

  return ''
}

export function buildTeachingMarkdown(
  node: FlatCourseNode,
  dependencyTitles: string[],
  teachingIntent: TeachingIntent = 'default',
) {
  const teachingDensity = getNodeTeachingDensity(node)
  const conceptLines = buildConceptWalkthrough(node)
  const example = node.knowledge.examples[0]
  const checkpoint = node.knowledge.checkpoints[0]
  const relationHint = buildConceptRelationHint(node)
  const learningObjectiveBlock = buildLearningObjectiveBlock(node)
  const mistakeBlock = buildMistakeBlock(node)
  const memoryHook = buildMemoryHook(node)
  const quickRetellBlock = buildQuickRetellBlock(node)
  const boundaryBlock = buildBoundaryBlock(node)
  const reframeLead =
    teachingIntent === 'reframe'
      ? `这次我们换个角度理解 **${node.title}**：别先背定义，先把它想成你真的会遇到的一件事。`
      : teachingIntent === 'deepen'
        ? `这次我们把 **${node.title}** 讲深一点：不只记“是什么”，还要抓住它为什么这样设计、和旁边概念怎么分。`
        : teachingDensity === 'deep'
          ? `先抓一句话：${node.summary}。这节信息量不小，我们这次会把骨架搭完整一点。`
        : `先抓一句话：${node.summary}`
  const extraDepthBlock =
    teachingIntent === 'deepen' || (teachingIntent === 'default' && teachingDensity === 'deep')
      ? [
          '### 再往深一层理解',
          '',
          checkpoint
            ? `如果你要真的用起来，判断自己有没有掌握，往往要看能不能做到：${checkpoint}`
            : `真正掌握这节，不只是会复述，还要能说清它为什么重要、边界在哪里。`,
          '',
          relationHint
            ? relationHint
            : `把这节当成一个会反复遇到的判断点，而不是一次性的定义卡片。`,
        ].join('\n')
      : ''

  return [
    `## ${node.title}`,
    '',
    reframeLead,
    '',
    dependencyTitles.length > 0
      ? `> 先修提醒：这一节默认你已经掌握了 ${dependencyTitles.join('、')}。`
      : '> 这是一节起步节点，你可以直接学。',
    '',
    '### 为什么这节重要',
    '',
    buildWhyItMatters(node),
    '',
    '### 先把核心想明白',
    '',
    conceptLines || '- 这一节没有额外概念清单，但有明确目标。',
    relationHint ? ['', relationHint].join('\n') : '',
    ['', '### 一个好记的抓手', '', memoryHook].join('\n'),
    learningObjectiveBlock ? ['', learningObjectiveBlock].join('\n') : '',
    example
      ? ['', '### 代入一个场景', '', `> ${example.scenario}`, '', `你可以先记住这个结论：${example.takeaway}`].join('\n')
      : '',
    checkpoint
      ? ['', '### 学完至少做到', '', `- ${checkpoint}`].join('\n')
      : '',
    quickRetellBlock ? ['', quickRetellBlock].join('\n') : '',
    boundaryBlock && teachingDensity !== 'light' ? ['', boundaryBlock].join('\n') : '',
    mistakeBlock ? ['', mistakeBlock].join('\n') : '',
    extraDepthBlock ? ['', extraDepthBlock].join('\n') : '',
    '',
    teachingIntent === 'reframe'
      ? '> 如果刚才那版说法不顺手，现在就先记住这个新角度。等会儿我会用更轻一点的方式确认你是不是真的抓住了。'
      : teachingIntent === 'deepen'
        ? '> 这一次我会稍微考得更深一点，重点不是背定义，而是看你能不能把判断依据和易错边界说出来。'
        : teachingDensity === 'deep'
          ? '> 这一节我会稍微讲厚一点，但你不用一次全记住。先抓主骨架，再慢慢把细节挂上去。'
        : '> 如果你现在只能记住一句，就先记住上面的“先抓一句话”。接下来我会马上考你一下，看看有没有真正抓住骨架。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildQuizMarkdown(node: FlatCourseNode, activeQuestion?: string | null) {
  const primaryConcept = node.knowledge.concepts[0]
  const secondaryConcept = node.knowledge.concepts[1]
  const example = node.knowledge.examples[0]
  const preferredQuestion = getPreferredQuizQuestion(node, activeQuestion)

  if (preferredQuestion) {
    return [
      `### 小测：${node.title}`,
      '',
      '先来一个基础版小问，不追求一次说满，先用你自己的话开口就好：',
      '',
      `> ${preferredQuestion}`,
      '',
      '第一步先说清它**是什么**。',
      '',
      '如果你答得比较稳，再顺手往前补两层：**为什么重要 / 用的时候最容易错哪**。',
      '',
      secondaryConcept
        ? `如果还有余力，再补一句 **${primaryConcept?.name ?? node.title}** 和 **${secondaryConcept.name}** 之间是什么关系。`
        : primaryConcept
          ? `如果还有余力，再补一句 **${primaryConcept.name}** 为什么是这节的核心点。`
          : '回答时尽量抓住这一节真正的关键词。',
    ].join('\n')
  }

  if (example) {
    return [
      `### 小测：${node.title}`,
      '',
      '先从最基础的一层开始回答：',
      '',
      `> ${example.scenario}`,
      '',
      '你先说结论本身是什么。',
      '',
      '如果已经比较稳，再补一句“为什么这样做”。',
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
      ? `请你先用大白话解释一下 **${primaryConcept.name}** 是什么。`
      : '请你先用自己的话复述这节的核心概念。',
    '',
    primaryConcept
      ? `如果你已经比较稳，再补一句：它在这一节里到底负责什么。`
      : '如果你已经比较稳，再补一句：它在这一节里到底起什么作用。',
  ].join('\n')
}

export function buildFollowupQuizMarkdown(
  node: FlatCourseNode,
  answerGuide: LocalAnswerGuide,
  activeQuestion?: string | null,
) {
  const preferredQuestion = getPreferredQuizQuestion(node, activeQuestion)
  const matchedHint = answerGuide.matchedKeywords.slice(0, 2)
  const missingHint = answerGuide.missingKeywords.slice(0, 2)

  return [
    '### 这次已经摸到门了',
    '',
    matchedHint.length > 0
      ? `你刚才已经碰到了 **${matchedHint.join('、')}** 这些点，我们先别急着判错。`
      : '你已经开始往正确方向靠近了，我们先不急着重讲整节。',
    '',
    missingHint.length > 0
      ? `现在只补半步：把 **${missingHint.join('、')}** 这几个点自然说出来就会完整很多。`
      : '现在只补半步：把这节真正的核心骨架再说完整一点就够了。',
    '',
    preferredQuestion ? `还是围绕这道题继续：\n\n> ${preferredQuestion}` : '',
    '',
    '这一次先别追求说得很满，先把关键骨架补齐。答稳了，我们再往下一层走。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildFocusedFollowupQuestion(
  node: FlatCourseNode,
  answerGuide: LocalAnswerGuide,
  activeQuestion?: string | null,
) {
  const preferredQuestion = getPreferredQuizQuestion(node, activeQuestion)
  const missingHint = answerGuide.missingKeywords.slice(0, 2)
  const matchedHint = answerGuide.matchedKeywords[0]

  if (missingHint.length > 0 && preferredQuestion) {
    return `还是围绕“${preferredQuestion}”继续，这次请你重点补上 ${missingHint.join('、')}。`
  }

  if (missingHint.length > 0) {
    return `你刚才已经答到一部分了，这次请重点补上 ${missingHint.join('、')}，再用一句自己的话说完整。`
  }

  if (matchedHint) {
    return `很好，你已经提到 ${matchedHint} 了。现在再补一句：它为什么重要，或者最容易错在哪？`
  }

  return preferredQuestion || `请你再用一句更完整的话，把“${node.title}”的核心骨架补齐。`
}

export function buildCorrectionMarkdown(node: FlatCourseNode, answer: string) {
  const keyConcept = node.knowledge.concepts[0]
  const checkpoint = node.knowledge.checkpoints[0]

  return [
    '### 我们先把这一题扶稳',
    '',
    '你刚才的回答是：',
    '',
    `> ${answer || '（空回答）'}`,
    '',
    '问题不在于你有没有作答，而在于你还没抓住这节真正的骨架。没关系，我们现在把骨架扶正就好。',
    keyConcept
      ? `重新记住一句话：**${keyConcept.name}**，本质上就是 ${keyConcept.explanation}。`
      : `重新记住一句话：这一节的重点是“${node.summary}”。`,
    checkpoint ? `你至少要能做到：${checkpoint}` : '',
    node.knowledge.common_mistakes[0] ? `这一节最容易失分的地方是：${node.knowledge.common_mistakes[0]}` : '',
    '',
    '现在我们换个更直接、更完整的说法，再回答一次。尽量把“它是什么、为什么重要、最容易错哪”一起说出来。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildSuccessMarkdown(node: FlatCourseNode, nextNode: FlatCourseNode | null) {
  return [
    '### 这节我们拿下了',
    '',
    `你已经抓住了 **${node.title}** 的关键点，说明这节的主骨架已经立住了。`,
    nextNode
      ? `下一节会解锁 **${nextNode.title}**，我们可以顺势往前推进。`
      : '整条学习主线已经走完，现在很适合回头串讲一遍，把知识链彻底焊牢。',
  ].join('\n')
}

export function evaluateAnswer(node: FlatCourseNode, answer: string): EvaluationResult {
  const normalizedAnswer = answer.trim().toLowerCase()
  const keywords = isStageRecapNode(node) ? collectStageQuizAnchorKeywords(node, null) : collectKeywords(node)
  const matchedKeywords = keywords.filter((keyword) => normalizedAnswer.includes(keyword.toLowerCase()))
  const longEnough = normalizedAnswer.length >= (isStageRecapNode(node) ? 18 : 12)
  const correct = longEnough && (matchedKeywords.length >= (isStageRecapNode(node) ? 2 : 1))

  return { correct, matchedKeywords }
}

export function buildCurrentNodeMeta(node: FlatCourseNode, dependencyTitles: string[]) {
  const stageQuizQuestions = getNodeStageQuizQuestions(node)
  return {
    concepts: makeInlineList(
      node.knowledge.concepts.map((concept) => `${concept.name}：${concept.explanation}`),
      '- 暂无概念清单'
    ),
    checkpoints: makeInlineList(node.knowledge.checkpoints, '- 暂无检查点'),
    mistakes: makeInlineList(node.knowledge.common_mistakes, '- 暂无常见误区'),
    dependencies: dependencyTitles.length > 0 ? dependencyTitles.join('、') : '无',
    stageQuizzes: makeInlineList(stageQuizQuestions, '- 暂无预设阶段题'),
  }
}

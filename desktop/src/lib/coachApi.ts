import type { CoachMessage, CoachTurnResult, CoursePackage, FlatCourseNode, LearningStatus, StageReplayInsight, TeachingIntent } from '../types/course'
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_MINIMAX_BASE_URL,
} from './coachPreferences'
import { buildLocalAnswerGuide } from './coachPrompt'

type RuntimeSettings = Awaited<ReturnType<typeof window.desktopAPI.loadSettings>>

export type CoachApiConfig = {
  apiKey: string
  baseUrl: string
  model: string
  providerLabel: string
}

type RequestCoachTurnParams = {
  config: CoachApiConfig
  courseData: CoursePackage
  currentNode: FlatCourseNode
  dependencyTitles: string[]
  learningStatus: LearningStatus
  messages: CoachMessage[]
  userAnswer?: string
  activeQuestion?: string | null
  stageReplay?: StageReplayInsight | null
  teachingIntent?: TeachingIntent
  unlockedNodeIds: string[]
  completedNodeIds: string[]
}

function stripThinkTags(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

function stripMarkdownCodeFence(text: string) {
  const trimmed = text.trim()
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fencedMatch) {
    return fencedMatch[1].trim()
  }
  return trimmed.replace(/```json\s*/gi, '').replace(/```/g, '').trim()
}

function extractBalancedJsonCandidate(text: string) {
  let start = -1
  let depth = 0
  let inString = false
  let isEscaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (start === -1) {
      if (char === '{') {
        start = index
        depth = 1
      }
      continue
    }

    if (isEscaped) {
      isEscaped = false
      continue
    }

    if (char === '\\') {
      isEscaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        return text.slice(start, index + 1)
      }
    }
  }

  return null
}

function extractJsonObject(text: string) {
  const cleaned = stripMarkdownCodeFence(stripThinkTags(text))
  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CoachTurnResult
    }
  } catch {
    // fall through
  }

  const balancedCandidate = extractBalancedJsonCandidate(cleaned)
  if (balancedCandidate) {
    try {
      const parsed = JSON.parse(balancedCandidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as CoachTurnResult
      }
    } catch {
      // fall through
    }
  }

  const starts = [...cleaned].map((char, index) => (char === '{' ? index : -1)).filter((index) => index >= 0)
  for (const start of starts) {
    const candidate = cleaned.slice(start).replace(/```[\s\S]*$/g, '').trim()
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as CoachTurnResult
      }
    } catch {
      continue
    }
  }

  throw new Error(`教练模型没有返回合法 JSON：${cleaned.slice(0, 300)}`)
}

function summarizeMessages(messages: CoachMessage[]) {
  return messages
    .filter((message) => message.role !== 'system')
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n')
}

function normalizeCoachReply(text: string) {
  return text
    .replace(/^\s*([-*_]\s*){3,}\s*$/gmu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function resolveCoachApiConfig(settings: RuntimeSettings): CoachApiConfig {
  const envBaseUrl = import.meta.env.VITE_COACH_API_BASE_URL?.trim()
  const envApiKey = import.meta.env.VITE_COACH_API_KEY?.trim()
  const envModel = import.meta.env.VITE_COACH_API_MODEL?.trim()
  const envProvider = import.meta.env.VITE_COACH_PROVIDER?.trim()

  if (envApiKey && envModel) {
    return {
      apiKey: envApiKey,
      model: envModel,
      baseUrl: envBaseUrl || DEFAULT_OPENAI_BASE_URL,
      providerLabel: envProvider || 'openai-compatible',
    }
  }

  const resolvedModel = settings.coach_model || 'MiniMax-M2.7'
  const resolvedBaseUrl =
    settings.coach_api_base_url ||
    (resolvedModel.toLowerCase().includes('minimax') ? DEFAULT_MINIMAX_BASE_URL : DEFAULT_OPENAI_BASE_URL)
  const resolvedApiKey = settings.coach_api_key

  if (resolvedApiKey && resolvedModel) {
    return {
      apiKey: resolvedApiKey,
      model: resolvedModel,
      baseUrl: resolvedBaseUrl,
      providerLabel: resolvedBaseUrl.includes('minimaxi') ? 'minimax' : 'openai-compatible',
    }
  }

  return {
    apiKey: settings.coach_api_key,
    model: settings.coach_model || 'MiniMax-M2.7',
    baseUrl: envBaseUrl || DEFAULT_MINIMAX_BASE_URL,
    providerLabel: 'minimax',
  }
}

function buildCoachUserPrompt({
  courseData,
  currentNode,
  dependencyTitles,
  learningStatus,
  messages,
  userAnswer,
  activeQuestion,
  stageReplay,
  teachingIntent = 'default',
  unlockedNodeIds,
  completedNodeIds,
}: RequestCoachTurnParams) {
  const stageQuizExamples = currentNode.knowledge.examples.filter((example) => example.title.includes('阶段小测'))
  const stageQuizQuestions = stageQuizExamples.map((example) => example.scenario).filter(Boolean)
  const isStageRecapNode =
    currentNode.title.includes('复盘') ||
    currentNode.title.includes('小测') ||
    stageQuizQuestions.length > 0
  const localAnswerGuide = userAnswer ? buildLocalAnswerGuide(currentNode, userAnswer, activeQuestion) : null

  return [
    '你必须输出一个且仅一个 JSON 对象，字段如下：',
    '{',
    '  "reply": "给用户看的 Markdown 内容",',
    '  "learningStatus": "teaching | quizzing | correcting | completed",',
    '  "markCurrentNodeCompleted": true | false,',
    '  "suggestedNextNodeId": "下一个节点 id 或 null"',
    '}',
    '',
    '绝对禁止输出 JSON 之外的解释、前言、代码块。',
    'reply 必须是干净、自然、易读的 Markdown。',
    '',
    `当前节点标题：${currentNode.title}`,
    `当前节点摘要：${currentNode.summary}`,
    `当前节点状态：${learningStatus}`,
    `当前是否为阶段复盘节点：${isStageRecapNode ? '是' : '否'}`,
    `前置依赖标题：${dependencyTitles.join('、') || '无'}`,
    `当前节点 concepts：${JSON.stringify(currentNode.knowledge.concepts, null, 2)}`,
    `当前节点 examples：${JSON.stringify(currentNode.knowledge.examples, null, 2)}`,
    `当前节点 checkpoints：${JSON.stringify(currentNode.knowledge.checkpoints, null, 2)}`,
    `当前节点 common_mistakes：${JSON.stringify(currentNode.knowledge.common_mistakes, null, 2)}`,
    `当前节点预设阶段题：${JSON.stringify(stageQuizQuestions, null, 2)}`,
    `当前正在追踪的题目：${activeQuestion || '暂无'}`,
    `当前阶段回放线索：${stageReplay ? JSON.stringify(stageReplay, null, 2) : '暂无'}`,
    `当前重讲意图：${teachingIntent}`,
    userAnswer ? `本地判题锚点：${JSON.stringify(localAnswerGuide, null, 2)}` : '本地判题锚点：暂无（因为用户还没提交答案）',
    `已解锁节点：${JSON.stringify(unlockedNodeIds)}`,
    `已完成节点：${JSON.stringify(completedNodeIds)}`,
    `课程所有章节树：${JSON.stringify(courseData.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, children: chapter.children.map((child) => ({ id: child.id, title: child.title })) })), null, 2)}`,
    userAnswer ? `用户刚提交的回答：${userAnswer}` : '当前还没有用户回答。',
    '',
    '行为约束：',
    '- 如果当前状态是 teaching，你必须先讲，再自然收束到 quizzing，并给一道简答题或情景题。',
    '- teaching 阶段的讲解不能太短，至少要覆盖这四层：一句大白话定义、为什么重要、核心概念拆解、最容易错的点。',
    '- 如果当前重讲意图是 reframe，请尽量换一种说法，不要只是重复上一版措辞；优先使用更生活化的角度或比喻。',
    '- 如果当前重讲意图是 deepen，请在保持清晰的前提下讲得更透，补上因果关系、边界和判断依据。',
    '- teaching 阶段优先使用 Markdown 小标题来组织这四层，而不是只给一小段摘要。',
    '- 如果当前节点提供了 learning objectives、多个 concepts、common_mistakes，你应尽量把“学完带走什么”“概念之间的关系”“最容易失分的地方”讲出来。',
    '- teaching 结束后的第一问请尽量温和，优先让用户先回答“它是什么”或“最核心的一句是什么”，不要第一问就把三层要求全部压满。',
    '- 如果当前状态是 quizzing 或 correcting，你必须判断用户回答。',
    '- 判断错误时：reply 必须指出错点并重讲；learningStatus 必须是 correcting；markCurrentNodeCompleted 必须是 false。',
    '- 判断正确时：reply 必须简短夸奖；learningStatus 必须是 completed；markCurrentNodeCompleted 必须是 true。',
    '- 只有在回答正确时才允许 suggestedNextNodeId 指向一个节点，否则必须为 null。',
    '- 如果当前是阶段复盘节点，并且存在“当前节点预设阶段题”，你必须优先从这些题里选题或沿用当前正在追踪的题目，不能临时换成完全无关的新题。',
    '- 如果提供了“当前阶段回放线索”，你应优先围绕最近真正错过的小关、关键词和题目来组织复盘与追问。',
    '- 如果“当前阶段回放线索”里存在 followupQuestions，在复盘节点中你应优先把其中一题作为二次追问入口。',
    '- 如果当前正在追踪的题目不为空，在 quizzing / correcting 阶段你必须围绕这道题判定，不要悄悄改题。',
    '- 如果当前是 teaching 且存在阶段题，你讲解后给出的第一道题应优先使用这些阶段题中的一题。',
    '- quizzing 阶段不要只考定义，优先考“为什么重要、怎么判断、容易错在哪”。',
    '- 但第一轮 quizzing 先让用户开口，若用户答得较稳，再在后续追问里加深到“为什么 / 易错点 / 概念关系”。',
    '- 如果提供了“本地判题锚点”，你必须把它当成判题辅助依据：matchedKeywords 说明用户已经覆盖到的点，missingKeywords 说明还没说到的点。',
    '- 如果 likelyVerdict 是 likely_partial，或者 matchedKeywords 不为空但 missingKeywords 仍然明显存在，请先肯定用户已经答到的部分，并保持 learningStatus 为 quizzing，围绕缺失点追问一小步。',
    '- 这类追问要尽量缩成一个明确补点，不要把问题重新摊成一整道大题；优先盯住 missingKeywords 里的 1 到 2 个关键词。',
    '- 只有当用户明显偏题、遗漏大部分核心点，或者出现关键事实错误时，才进入 correcting。',
    '- 当 likelyVerdict 是 likely_incorrect 且用户明显漏掉大部分关键词时，不要轻易判对；当 likelyVerdict 是 likely_correct 且用户覆盖了核心关键词时，除非存在明显事实错误，否则可以判对。',
    '- 语气要温柔、体贴、像陪学教练，允许偶尔加入 1 个简短颜文字或 1-2 个克制的 emoji，但不要堆砌。',
    '- 主要标题请写得有辨识度，适合用 Markdown 标题承接内容层次。',
    '- 严禁使用 ---、***、___ 这类横向分割线；用小标题、留白和短段落组织内容。',
    '- 不要写“下面开始总结”“这段讲了”之类流程化废话。',
    '',
    '最近对话历史：',
    summarizeMessages(messages) || '（暂无历史）',
    '',
    '课程总目标：',
    courseData.course.overall_goal,
  ].join('\n')
}

export async function requestCoachTurn(params: RequestCoachTurnParams) {
  const { config } = params

  if (!config.apiKey.trim()) {
    throw new Error('未配置教练模型 API Key。')
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.25,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            '你是一个严厉但极具耐心的 AI 私人教练。',
            `用户正在学习节点：[${params.currentNode.title}]。`,
            '你必须严格输出 CoachTurnResult JSON，不得输出闲聊、前言、代码块。',
            '在 reply 字段中，请用温柔、清晰、有人味的中文表达，标题可带少量克制 emoji，禁止使用 --- 这类分割线。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: buildCoachUserPrompt(params),
        },
      ],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`教练模型请求失败：HTTP ${response.status} ${text.slice(0, 240)}`)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((part: { text?: string; type?: string }) => (part?.type === 'text' ? String(part.text ?? '') : ''))
            .join('\n')
        : ''

  const result = extractJsonObject(text)

  if (!result.reply || typeof result.reply !== 'string') {
    throw new Error('教练模型返回缺少 reply。')
  }

  return {
    reply: normalizeCoachReply(result.reply),
    learningStatus: ['teaching', 'quizzing', 'correcting', 'completed'].includes(result.learningStatus)
      ? result.learningStatus
      : 'correcting',
    markCurrentNodeCompleted: Boolean(result.markCurrentNodeCompleted),
    suggestedNextNodeId: result.suggestedNextNodeId ?? null,
  } satisfies CoachTurnResult
}

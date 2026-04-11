import type { CoachMessage, CoachTurnResult, CoursePackage, FlatCourseNode, LearningStatus } from '../types/course'
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_MINIMAX_BASE_URL,
} from './coachPreferences'

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
  unlockedNodeIds,
  completedNodeIds,
}: RequestCoachTurnParams) {
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
    '',
    `当前节点标题：${currentNode.title}`,
    `当前节点摘要：${currentNode.summary}`,
    `当前节点状态：${learningStatus}`,
    `前置依赖标题：${dependencyTitles.join('、') || '无'}`,
    `当前节点 concepts：${JSON.stringify(currentNode.knowledge.concepts, null, 2)}`,
    `当前节点 examples：${JSON.stringify(currentNode.knowledge.examples, null, 2)}`,
    `当前节点 checkpoints：${JSON.stringify(currentNode.knowledge.checkpoints, null, 2)}`,
    `当前节点 common_mistakes：${JSON.stringify(currentNode.knowledge.common_mistakes, null, 2)}`,
    `已解锁节点：${JSON.stringify(unlockedNodeIds)}`,
    `已完成节点：${JSON.stringify(completedNodeIds)}`,
    `课程所有章节树：${JSON.stringify(courseData.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, children: chapter.children.map((child) => ({ id: child.id, title: child.title })) })), null, 2)}`,
    userAnswer ? `用户刚提交的回答：${userAnswer}` : '当前还没有用户回答。',
    '',
    '行为约束：',
    '- 如果当前状态是 teaching，你必须先讲，再自然收束到 quizzing，并给一道简答题或情景题。',
    '- 如果当前状态是 quizzing 或 correcting，你必须判断用户回答。',
    '- 判断错误时：reply 必须指出错点并重讲；learningStatus 必须是 correcting；markCurrentNodeCompleted 必须是 false。',
    '- 判断正确时：reply 必须简短夸奖；learningStatus 必须是 completed；markCurrentNodeCompleted 必须是 true。',
    '- 只有在回答正确时才允许 suggestedNextNodeId 指向一个节点，否则必须为 null。',
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
    reply: result.reply,
    learningStatus: ['teaching', 'quizzing', 'correcting', 'completed'].includes(result.learningStatus)
      ? result.learningStatus
      : 'correcting',
    markCurrentNodeCompleted: Boolean(result.markCurrentNodeCompleted),
    suggestedNextNodeId: result.suggestedNextNodeId ?? null,
  } satisfies CoachTurnResult
}

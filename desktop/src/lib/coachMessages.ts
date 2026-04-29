import type { CoachMessage } from '../types/course'

export function makeMessage(role: CoachMessage['role'], content: string, nodeId?: string): CoachMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    role,
    content,
    nodeId,
    createdAt: Date.now(),
  }
}

function splitCoachReplyIntoChunks(reply: string) {
  const normalized = reply.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const lines = normalized.split('\n')
  const chunks: string[] = []
  let current: string[] = []

  const flush = () => {
    const value = current.join('\n').trim()
    if (value) chunks.push(value)
    current = []
  }

  for (const line of lines) {
    const isHeading = /^(#{2,4})\s+/.test(line.trim())
    if (isHeading && current.length > 0) {
      flush()
    }
    current.push(line)
  }

  flush()

  const merged = chunks.reduce<string[]>((accumulator, chunk) => {
    const previous = accumulator[accumulator.length - 1]
    const isStandalone =
    /(^|\n)#{2,4}\s+.*(回忆问题|测验|练习|情景题|试试|思考|提醒|注意|错误|误区|步骤|流程)/u.test(chunk)
    const isTiny = chunk.length < 70

    if (previous && isTiny && !isStandalone) {
      accumulator[accumulator.length - 1] = `${previous}\n\n${chunk}`.trim()
      return accumulator
    }

    accumulator.push(chunk)
    return accumulator
  }, [])

  while (merged.length > 6) {
    const tail = merged.pop()
    if (!tail) break
    merged[merged.length - 1] = `${merged[merged.length - 1]}\n\n${tail}`.trim()
  }

  return merged
}

export function makeCoachMessages(content: string, nodeId?: string) {
  void splitCoachReplyIntoChunks
  return [makeMessage('coach', content, nodeId)]
}

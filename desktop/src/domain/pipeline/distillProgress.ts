export type DistillStage =
  | 'metadata'
  | 'metadata_ready'
  | 'subtitle'
  | 'audio'
  | 'chunking'
  | 'material_ready'
  | 'editorial_summary'
  | 'complete'
  | 'unknown'

export type DistillProgressSnapshot = {
  stage: DistillStage
  stageLabel: string
  message: string
  cacheHint: string | null
  audioCompleted: number
  audioTotal: number
  chunkCompleted: number
  chunkTotal: number
  resumed: boolean
}

export function formatDistillTimingSummary(stageTimings?: {
  total_seconds?: number
}) {
  if (!stageTimings) return ''
  const totalSeconds = Number(stageTimings.total_seconds ?? 0)
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return ''
  if (totalSeconds >= 120) {
    return `本次整理耗时约 ${(totalSeconds / 60).toFixed(1)} 分钟`
  }
  return `本次整理耗时约 ${Math.round(totalSeconds)} 秒`
}

function normalizeDistillStage(stage?: unknown): DistillStage {
  switch (String(stage ?? '').trim()) {
    case 'metadata':
      return 'metadata'
    case 'metadata_ready':
      return 'metadata_ready'
    case 'subtitle':
      return 'subtitle'
    case 'audio':
      return 'audio'
    case 'chunking':
      return 'chunking'
    case 'material_ready':
      return 'material_ready'
    case 'editorial_summary':
      return 'editorial_summary'
    case 'complete':
      return 'complete'
    default:
      return 'unknown'
  }
}

function formatDistillStageLabel(stage: DistillStage, cacheHint?: string | null) {
  if (cacheHint === 'material_package') return '复用资料包'
  switch (stage) {
    case 'metadata':
      return '解析视频'
    case 'metadata_ready':
      return '信息就绪'
    case 'subtitle':
      return '抓取字幕'
    case 'audio':
      return '音频补全'
    case 'chunking':
      return '文本分段'
    case 'material_ready':
      return '资料就绪'
    case 'editorial_summary':
      return '视频编稿'
    case 'complete':
      return '资料完成'
    default:
      return '处理中'
  }
}

function normalizeProgressNumber(value: unknown) {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

export function buildDistillProgressSnapshot(payload?: Partial<DistillProgressPayload> | null): DistillProgressSnapshot {
  const safePayload = payload ?? {}
  const stage = normalizeDistillStage(safePayload.stage)
  const cacheHint = safePayload.cacheHint ?? null
  return {
    stage,
    stageLabel: formatDistillStageLabel(stage, cacheHint),
    message: safePayload.message || '正在整理资料包，请稍候…',
    cacheHint,
    audioCompleted: normalizeProgressNumber(safePayload.audioCompleted),
    audioTotal: normalizeProgressNumber(safePayload.audioTotal),
    chunkCompleted: normalizeProgressNumber(safePayload.chunkCompleted),
    chunkTotal: normalizeProgressNumber(safePayload.chunkTotal),
    resumed: Boolean(safePayload.resumed),
  }
}

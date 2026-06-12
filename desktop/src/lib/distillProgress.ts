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

function normalizeDistillStage(stage?: string): DistillStage {
  switch ((stage || '').trim()) {
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

export function buildDistillProgressSnapshot(payload: DistillProgressPayload): DistillProgressSnapshot {
  const stage = normalizeDistillStage(payload.stage)
  const cacheHint = payload.cacheHint ?? null
  return {
    stage,
    stageLabel: formatDistillStageLabel(stage, cacheHint),
    message: payload.message || '正在整理资料包，请稍候…',
    cacheHint,
    audioCompleted: Number(payload.audioCompleted ?? 0) || 0,
    audioTotal: Number(payload.audioTotal ?? 0) || 0,
    chunkCompleted: Number(payload.chunkCompleted ?? 0) || 0,
    chunkTotal: Number(payload.chunkTotal ?? 0) || 0,
    resumed: Boolean(payload.resumed),
  }
}

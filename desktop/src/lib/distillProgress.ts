export type DistillStage =
  | 'metadata'
  | 'subtitle'
  | 'audio'
  | 'chunking'
  | 'chunk_distilling'
  | 'batch_reducing'
  | 'synthesizing'
  | 'cache'
  | 'injecting'
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
  batchCompleted: number
  batchTotal: number
  resumed: boolean
  prefetchReuseChunkRatio: number
  prefetchReuseBatchRatio: number
}

export function formatDistillTimingSummary(stageTimings?: {
  total_seconds?: number
  cache_hit?: string
  cache_total_seconds?: number
  historical_total_seconds?: number
  prefetch_chunk_warm_seconds?: number
  prefetch_chunk_count?: number
  prefetch_reuse_chunk_count?: number
  prefetch_batch_warm_seconds?: number
  prefetch_batch_count?: number
  prefetch_reuse_batch_count?: number
}) {
  if (!stageTimings) return ''
  if (stageTimings.cache_hit === 'course_package' || stageTimings.cache_hit === 'final_course_package') {
    const cacheSeconds = Number(stageTimings.cache_total_seconds ?? stageTimings.total_seconds ?? 0)
    const historicalTotalSeconds = Number(stageTimings.historical_total_seconds ?? 0)
    const cacheSummary =
      Number.isFinite(cacheSeconds) && cacheSeconds > 0
        ? cacheSeconds >= 60
          ? `本次约 ${(cacheSeconds / 60).toFixed(1)} 分钟`
          : `本次约 ${Math.round(cacheSeconds)} 秒`
        : '本次几乎瞬时完成'
    if (Number.isFinite(historicalTotalSeconds) && historicalTotalSeconds > 0) {
      const historicalSummary =
        historicalTotalSeconds >= 120
      ? `上次完整整理约 ${(historicalTotalSeconds / 60).toFixed(1)} 分钟`
      : `上次完整整理约 ${Math.round(historicalTotalSeconds)} 秒`
      return `命中本地缓存，${cacheSummary} · ${historicalSummary}`
    }
    return `命中本地缓存，${cacheSummary}`
  }
  const totalSeconds = Number(stageTimings.total_seconds ?? 0)
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return ''
  const prefetchSeconds = Number(stageTimings.prefetch_chunk_warm_seconds ?? 0)
  const prefetchCount = Number(stageTimings.prefetch_reuse_chunk_count ?? stageTimings.prefetch_chunk_count ?? 0)
  const prefetchBatchSeconds = Number(stageTimings.prefetch_batch_warm_seconds ?? 0)
  const prefetchBatchCount = Number(stageTimings.prefetch_reuse_batch_count ?? stageTimings.prefetch_batch_count ?? 0)
  const prefetchSummary =
    Number.isFinite(prefetchSeconds) && prefetchSeconds > 0 && Number.isFinite(prefetchCount) && prefetchCount > 0
      ? ` · 预热 ${prefetchCount} 个分片（约 ${prefetchSeconds >= 60 ? `${(prefetchSeconds / 60).toFixed(1)} 分钟` : `${Math.round(prefetchSeconds)} 秒`}）`
      : ''
  const prefetchBatchSummary =
    Number.isFinite(prefetchBatchSeconds) &&
    prefetchBatchSeconds > 0 &&
    Number.isFinite(prefetchBatchCount) &&
    prefetchBatchCount > 0
      ? ` · 预热 ${prefetchBatchCount} 个批次（约 ${prefetchBatchSeconds >= 60 ? `${(prefetchBatchSeconds / 60).toFixed(1)} 分钟` : `${Math.round(prefetchBatchSeconds)} 秒`}）`
      : ''
  if (totalSeconds >= 120) {
    return `本次整理耗时约 ${(totalSeconds / 60).toFixed(1)} 分钟${prefetchSummary}${prefetchBatchSummary}`
  }
  return `本次整理耗时约 ${Math.round(totalSeconds)} 秒${prefetchSummary}${prefetchBatchSummary}`
}

function normalizeDistillStage(stage?: string): DistillStage {
  switch ((stage || '').trim()) {
    case 'metadata':
      return 'metadata'
    case 'subtitle':
      return 'subtitle'
    case 'audio':
      return 'audio'
    case 'chunking':
      return 'chunking'
    case 'chunk_distilling':
      return 'chunk_distilling'
    case 'batch_reducing':
      return 'batch_reducing'
    case 'synthesizing':
      return 'synthesizing'
    case 'cache':
      return 'cache'
    case 'injecting':
      return 'injecting'
    case 'complete':
      return 'complete'
    default:
      return 'unknown'
  }
}

function formatDistillStageLabel(stage: DistillStage, cacheHint?: string | null) {
  if (stage === 'cache') {
    if (cacheHint === 'course_package') return '复用课程缓存'
    if (cacheHint === 'final_course_package') return '复用最终课包'
    if (cacheHint === 'material_package') return '复用原材料'
    return '命中缓存'
  }
  switch (stage) {
    case 'metadata':
      return '解析视频'
    case 'subtitle':
      return '抓取字幕'
    case 'audio':
      return '音频补全'
    case 'chunking':
      return '切片预处理'
    case 'chunk_distilling':
      return '整理分片'
    case 'batch_reducing':
      return '批次归并'
    case 'synthesizing':
      return '写入材料'
    case 'injecting':
      return '写入完成'
    case 'complete':
      return '材料完成'
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
    message: payload.message || '正在整理 Codex 原材料包，请稍候…',
    cacheHint,
    audioCompleted: Number(payload.audioCompleted ?? 0) || 0,
    audioTotal: Number(payload.audioTotal ?? 0) || 0,
    chunkCompleted: Number(payload.chunkCompleted ?? 0) || 0,
    chunkTotal: Number(payload.chunkTotal ?? 0) || 0,
    batchCompleted: Number(payload.batchCompleted ?? 0) || 0,
    batchTotal: Number(payload.batchTotal ?? 0) || 0,
    resumed: Boolean(payload.resumed),
    prefetchReuseChunkRatio: Number(payload.prefetchReuseChunkRatio ?? 0) || 0,
    prefetchReuseBatchRatio: Number(payload.prefetchReuseBatchRatio ?? 0) || 0,
  }
}

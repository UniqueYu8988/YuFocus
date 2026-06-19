import assert from 'node:assert/strict'

import {
  buildDistillProgressSnapshot,
  formatDistillTimingSummary,
} from '../src/domain/pipeline/distillProgress.ts'

function assertSnapshot(actual, expected) {
  assert.deepEqual(actual, {
    stage: expected.stage,
    stageLabel: expected.stageLabel,
    message: expected.message,
    cacheHint: expected.cacheHint ?? null,
    audioCompleted: expected.audioCompleted ?? 0,
    audioTotal: expected.audioTotal ?? 0,
    chunkCompleted: expected.chunkCompleted ?? 0,
    chunkTotal: expected.chunkTotal ?? 0,
    resumed: expected.resumed ?? false,
  })
}

const normal = buildDistillProgressSnapshot({
  stage: 'subtitle',
  message: '正在抓取字幕…',
  audioCompleted: 1,
  audioTotal: 3,
  chunkCompleted: 2,
  chunkTotal: 5,
  resumed: true,
})

assertSnapshot(normal, {
  stage: 'subtitle',
  stageLabel: '抓取字幕',
  message: '正在抓取字幕…',
  audioCompleted: 1,
  audioTotal: 3,
  chunkCompleted: 2,
  chunkTotal: 5,
  resumed: true,
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'metadata' }), {
  stage: 'metadata',
  stageLabel: '解析视频',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'metadata_ready' }), {
  stage: 'metadata_ready',
  stageLabel: '信息就绪',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'audio' }), {
  stage: 'audio',
  stageLabel: '音频补全',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'chunking' }), {
  stage: 'chunking',
  stageLabel: '文本分段',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'material_ready' }), {
  stage: 'material_ready',
  stageLabel: '资料就绪',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'editorial_summary' }), {
  stage: 'editorial_summary',
  stageLabel: '视频编稿',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'complete' }), {
  stage: 'complete',
  stageLabel: '资料完成',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: '  subtitle  ' }), {
  stage: 'subtitle',
  stageLabel: '抓取字幕',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'complete', cacheHint: 'material_package' }), {
  stage: 'complete',
  stageLabel: '复用资料包',
  message: '正在整理资料包，请稍候…',
  cacheHint: 'material_package',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'failed', message: '' }), {
  stage: 'unknown',
  stageLabel: '处理中',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({ stage: 'waiting' }), {
  stage: 'unknown',
  stageLabel: '处理中',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({}), {
  stage: 'unknown',
  stageLabel: '处理中',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot(undefined), {
  stage: 'unknown',
  stageLabel: '处理中',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({
  stage: 42,
  audioCompleted: Number.NaN,
  audioTotal: Number.POSITIVE_INFINITY,
  chunkCompleted: 'bad',
  chunkTotal: undefined,
}), {
  stage: 'unknown',
  stageLabel: '处理中',
  message: '正在整理资料包，请稍候…',
})

assertSnapshot(buildDistillProgressSnapshot({
  stage: 'chunking',
  audioCompleted: -1,
  audioTotal: 999,
  chunkCompleted: 120,
  chunkTotal: -5,
}), {
  stage: 'chunking',
  stageLabel: '文本分段',
  message: '正在整理资料包，请稍候…',
  audioCompleted: -1,
  audioTotal: 999,
  chunkCompleted: 120,
  chunkTotal: -5,
})

assert.equal(formatDistillTimingSummary(), '')
assert.equal(formatDistillTimingSummary({}), '')
assert.equal(formatDistillTimingSummary({ total_seconds: 0 }), '')
assert.equal(formatDistillTimingSummary({ total_seconds: -5 }), '')
assert.equal(formatDistillTimingSummary({ total_seconds: Number.NaN }), '')
assert.equal(formatDistillTimingSummary({ total_seconds: 1.4 }), '本次整理耗时约 1 秒')
assert.equal(formatDistillTimingSummary({ total_seconds: 90 }), '本次整理耗时约 90 秒')
assert.equal(formatDistillTimingSummary({ total_seconds: 119.6 }), '本次整理耗时约 120 秒')
assert.equal(formatDistillTimingSummary({ total_seconds: 120 }), '本次整理耗时约 2.0 分钟')
assert.equal(formatDistillTimingSummary({ total_seconds: 366 }), '本次整理耗时约 6.1 分钟')

console.log(JSON.stringify({
  ok: true,
  checked: {
    normalProgress: true,
    missingFields: true,
    emptyAndUndefinedPayload: true,
    invalidNumbers: true,
    outOfRangeNumbersKeepCurrentSemantics: true,
    unknownFailedWaitingStages: true,
    cacheHintReuseLabel: true,
    timingSummary: true,
  },
}, null, 2))

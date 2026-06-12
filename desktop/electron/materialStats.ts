import fs from 'node:fs'
import path from 'node:path'

function readJsonDocument(documentPath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(documentPath)) return null
    const payload = JSON.parse(fs.readFileSync(documentPath, 'utf-8')) as unknown
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function getFileByteSize(targetPath: string): number {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) return 0
    const stat = fs.statSync(targetPath)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

export function getDirectoryByteSize(targetPath: string): number {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) return 0
    const stat = fs.statSync(targetPath)
    if (stat.isFile()) return stat.size
    if (!stat.isDirectory()) return 0
    return fs.readdirSync(targetPath, { withFileTypes: true }).reduce((sum, entry) => {
      const childPath = path.join(targetPath, entry.name)
      if (entry.isDirectory()) return sum + getDirectoryByteSize(childPath)
      if (entry.isFile()) return sum + getFileByteSize(childPath)
      return sum
    }, 0)
  } catch {
    return 0
  }
}

export function getTextFileLength(targetPath: string): number {
  try {
    if (!targetPath || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) return 0
    return fs.readFileSync(targetPath, 'utf-8').trim().length
  } catch {
    return 0
  }
}

export function readMaterialMetricsSummary(metricsPath: string) {
  const payload = fs.existsSync(metricsPath) ? readJsonDocument(metricsPath) ?? {} : {}
  const stages = payload.stages && typeof payload.stages === 'object' ? payload.stages as Record<string, unknown> : {}
  const totals = payload.totals && typeof payload.totals === 'object' ? payload.totals as Record<string, unknown> : {}
  const elapsedSeconds = Object.values(stages).reduce<number>((sum, stage) => {
    if (!stage || typeof stage !== 'object') return sum
    const value = Number((stage as Record<string, unknown>).elapsed_seconds ?? 0)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
  return {
    exists: Boolean(payload.schema_version),
    elapsedSeconds: Math.round(elapsedSeconds * 1000) / 1000,
    inputTokens: Number(totals.input_tokens ?? 0) || 0,
    outputTokens: Number(totals.output_tokens ?? 0) || 0,
    totalTokens: Number(totals.total_tokens ?? 0) || 0,
  }
}

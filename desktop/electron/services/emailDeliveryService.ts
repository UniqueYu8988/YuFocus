import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'

import type { RuntimeSettings } from '../runtime/settings'
import type { WorkbenchQueueItem } from '../queue/workbenchQueue'
import { isPathInsideRoot } from './pathSafety.ts'

export const EMAIL_DELIVERY_SCHEMA_VERSION = 'shijie.email-delivery.v0.1'

export type EmailDeliveryResult = {
  status: 'sent' | 'skipped' | 'failed'
  reason: string
  statusPath: string
  dryRun: boolean
  messageId?: string
}

export type EmailDeliveryOptions = {
  materialPath: string
  queueSource?: WorkbenchQueueItem['queueSource']
  settings: RuntimeSettings
  dryRun?: boolean
  now?: () => number
  appendRuntimeLog?: (message: string) => void
}

function readTextIfExists(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return ''
    return fs.readFileSync(filePath, 'utf-8').trim()
  } catch {
    return ''
  }
}

function readJsonIfExists(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {}
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function writeJsonInsideMaterial(filePath: string, materialPath: string, payload: unknown) {
  if (!isPathInsideRoot(path.resolve(filePath), path.resolve(materialPath))) {
    throw new Error(`邮件状态拒绝写入资料包之外的路径：${filePath}`)
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

function sha1(text: string) {
  return createHash('sha1').update(text).digest('hex')
}

function isEmailAddress(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(String(value ?? '').trim())
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

function markdownToSimpleHtml(markdown: string) {
  const lines = String(markdown || '').split(/\r?\n/u)
  const htmlLines = lines.map((line) => {
    const text = line.trimEnd()
    if (!text) return '<br />'
    const heading = text.match(/^(#{1,3})\s+(.+)$/u)
    if (heading) {
      const level = Math.min(3, heading[1].length)
      return `<h${level}>${escapeHtml(heading[2])}</h${level}>`
    }
    if (/^\s*[-*]\s+/u.test(text)) {
      return `<p>• ${escapeHtml(text.replace(/^\s*[-*]\s+/u, ''))}</p>`
    }
    return `<p>${escapeHtml(text)}</p>`
  })
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8" /></head>',
    '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.7;color:#1f2937;">',
    htmlLines.join('\n'),
    '</body></html>',
  ].join('\n')
}

function readManifest(materialPath: string) {
  const manifest = readJsonIfExists(path.join(materialPath, 'manifest.json'))
  const source = manifest.source && typeof manifest.source === 'object'
    ? manifest.source as Record<string, unknown>
    : {}
  return {
    title: String(source.title || path.basename(materialPath)).trim(),
    creator: String(source.creator || '').trim(),
    sourceId: String(source.source_id || path.basename(materialPath)).trim(),
    sourceUrl: String(source.url || '').trim(),
  }
}

function readQualityRisk(materialPath: string) {
  const quality = readJsonIfExists(path.join(materialPath, 'work', 'quality', 'local_check.json'))
  return {
    ok: quality.ok === undefined ? true : Boolean(quality.ok),
    riskLevel: String(quality.riskLevel || '').toLowerCase(),
    reason: String(quality.reason || ''),
  }
}

function readDecision(materialPath: string) {
  const decision = readJsonIfExists(path.join(materialPath, 'delivery', 'decision.json'))
  return {
    worthEmail: decision.worthEmail === undefined ? true : Boolean(decision.worthEmail),
    importance: Number(decision.importance || 0) || 0,
    reason: String(decision.reason || ''),
  }
}

function hasForbiddenContent(value: string) {
  return /<think\b|<\/think>|api[\s_-]?key|cookie|authorization|bearer\s+[a-z0-9._-]+|smtp\s*password|smtp授权|授权码/iu.test(value)
}

function maskSensitiveError(message: string, settings: RuntimeSettings) {
  let safe = String(message || '')
  const sensitiveValues = [
    settings.email_smtp_password,
    settings.email_smtp_user,
  ].filter((value) => String(value || '').trim().length >= 4)
  for (const value of sensitiveValues) {
    const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    safe = safe.replace(new RegExp(escaped, 'gu'), '[redacted]')
  }
  return safe
}

function resolveEmailBody(materialPath: string) {
  const emailPath = path.join(materialPath, 'delivery', 'email.md')
  const briefPath = path.join(materialPath, 'exports', 'brief.local.md')
  const emailBody = readTextIfExists(emailPath)
  if (emailBody) return { body: emailBody, sourcePath: emailPath, sourceKind: 'email' as const }
  const briefBody = readTextIfExists(briefPath)
  if (briefBody) return { body: briefBody, sourcePath: briefPath, sourceKind: 'brief' as const }
  return { body: '', sourcePath: '', sourceKind: 'missing' as const }
}

function mergeStatusPayload(options: {
  existing: Record<string, unknown>
  delivery: Record<string, unknown>
}) {
  return {
    ...options.existing,
    schemaVersion: EMAIL_DELIVERY_SCHEMA_VERSION,
    delivery: options.delivery,
  }
}

function buildSkippedResult(statusPath: string, reason: string, dryRun: boolean): EmailDeliveryResult {
  return { status: 'skipped', reason, statusPath, dryRun }
}

export async function pushFreshMaterialEmail(options: EmailDeliveryOptions): Promise<EmailDeliveryResult> {
  const materialPath = path.resolve(options.materialPath)
  const statusPath = path.join(materialPath, 'delivery', 'email_status.json')
  const now = options.now || Date.now
  const dryRun = options.dryRun ?? process.env.SHIJIE_EMAIL_DRY_RUN === '1'
  const existingStatus = readJsonIfExists(statusPath)
  const existingDelivery = existingStatus.delivery && typeof existingStatus.delivery === 'object'
    ? existingStatus.delivery as Record<string, unknown>
    : {}

  const writeDeliveryStatus = (delivery: Record<string, unknown>) => {
    writeJsonInsideMaterial(statusPath, materialPath, mergeStatusPayload({
      existing: existingStatus,
      delivery: {
        schemaVersion: EMAIL_DELIVERY_SCHEMA_VERSION,
        updatedAt: new Date(now()).toISOString(),
        ...delivery,
      },
    }))
  }

  if (options.queueSource !== 'fresh') {
    writeDeliveryStatus({
      status: 'skipped',
      reason: `queue_source_${options.queueSource || 'unknown'}_not_fresh`,
      queueSource: options.queueSource || '',
      dryRun,
    })
    return buildSkippedResult(statusPath, '仅 fresh 最近更新视频允许邮件推送。', dryRun)
  }

  const settings = options.settings
  if (!settings.email_push_enabled) {
    writeDeliveryStatus({ status: 'skipped', reason: 'email_push_disabled', queueSource: options.queueSource, dryRun })
    return buildSkippedResult(statusPath, '邮件推送未启用。', dryRun)
  }

  const missingSettings = [
    ['email_smtp_host', settings.email_smtp_host],
    ['email_smtp_user', settings.email_smtp_user],
    ['email_smtp_password', settings.email_smtp_password],
    ['email_from', settings.email_from],
    ['email_to', settings.email_to],
  ].filter(([, value]) => !String(value || '').trim()).map(([key]) => key)
  if (missingSettings.length) {
    writeDeliveryStatus({
      status: 'skipped',
      reason: 'missing_email_settings',
      missingSettings,
      queueSource: options.queueSource,
      dryRun,
    })
    return buildSkippedResult(statusPath, `邮件配置不完整：${missingSettings.join(', ')}`, dryRun)
  }
  if (!isEmailAddress(settings.email_to) || !isEmailAddress(settings.email_from)) {
    writeDeliveryStatus({ status: 'skipped', reason: 'invalid_email_address', queueSource: options.queueSource, dryRun })
    return buildSkippedResult(statusPath, '发件人或收件人邮箱格式不正确。', dryRun)
  }

  const decision = readDecision(materialPath)
  if (decision.worthEmail === false || (decision.importance > 0 && decision.importance < 2)) {
    writeDeliveryStatus({
      status: 'skipped',
      reason: 'decision_not_worth_email',
      decision,
      queueSource: options.queueSource,
      dryRun,
    })
    return buildSkippedResult(statusPath, '本地判断为不值得邮件推送。', dryRun)
  }

  const quality = readQualityRisk(materialPath)
  if (quality.ok === false || quality.riskLevel === 'high') {
    writeDeliveryStatus({
      status: 'skipped',
      reason: 'quality_gate_not_passed',
      quality,
      queueSource: options.queueSource,
      dryRun,
    })
    return buildSkippedResult(statusPath, '本地质量门控未通过。', dryRun)
  }

  const manifest = readManifest(materialPath)
  const body = resolveEmailBody(materialPath)
  if (!body.body) {
    writeDeliveryStatus({ status: 'skipped', reason: 'missing_email_body', queueSource: options.queueSource, dryRun })
    return buildSkippedResult(statusPath, '缺少 delivery/email.md 或 exports/brief.local.md。', dryRun)
  }
  if (hasForbiddenContent(body.body)) {
    writeDeliveryStatus({ status: 'skipped', reason: 'forbidden_content_detected', queueSource: options.queueSource, dryRun })
    return buildSkippedResult(statusPath, '邮件正文疑似包含敏感词或模型推理标签。', dryRun)
  }

  const contentSha1 = sha1([
    EMAIL_DELIVERY_SCHEMA_VERSION,
    manifest.sourceId,
    body.sourceKind,
    body.body,
  ].join('\n'))
  if (
    existingDelivery.status === 'sent' &&
    existingDelivery.contentSha1 === contentSha1 &&
    existingDelivery.to === settings.email_to
  ) {
    return buildSkippedResult(statusPath, '同一内容已经发送过。', dryRun)
  }

  const subject = `视界专注｜${manifest.creator ? `${manifest.creator}：` : ''}${manifest.title}`.slice(0, 120)
  const text = [
    body.body,
    '',
    '---',
    `来源：${manifest.sourceUrl || manifest.sourceId}`,
    '资料已保存在本机档案，可从「档案」页打开。',
  ].join('\n')
  const html = markdownToSimpleHtml(text)

  if (dryRun) {
    writeDeliveryStatus({
      status: 'sent',
      mode: 'dry_run',
      reason: 'dry_run',
      queueSource: options.queueSource,
      subject,
      to: settings.email_to,
      from: settings.email_from,
      sourceKind: body.sourceKind,
      sourcePath: path.relative(materialPath, body.sourcePath).replace(/\\/gu, '/'),
      contentSha1,
      sentAt: new Date(now()).toISOString(),
      dryRun,
    })
    return { status: 'sent', reason: 'dry-run 邮件状态已写入。', statusPath, dryRun }
  }

  try {
    const transportOptions: SMTPTransport.Options = {
      host: settings.email_smtp_host,
      port: settings.email_smtp_port,
      secure: settings.email_smtp_secure,
      auth: {
        user: settings.email_smtp_user,
        pass: settings.email_smtp_password,
      },
    }
    const transporter = nodemailer.createTransport(transportOptions)
    const info = await transporter.sendMail({
      from: settings.email_from,
      to: settings.email_to,
      subject,
      text,
      html,
    })
    const messageId = String(info.messageId || '')
    writeDeliveryStatus({
      status: 'sent',
      mode: 'smtp',
      queueSource: options.queueSource,
      subject,
      to: settings.email_to,
      from: settings.email_from,
      sourceKind: body.sourceKind,
      sourcePath: path.relative(materialPath, body.sourcePath).replace(/\\/gu, '/'),
      contentSha1,
      sentAt: new Date(now()).toISOString(),
      provider: 'smtp',
      messageId,
      dryRun,
    })
    return { status: 'sent', reason: '邮件已发送。', statusPath, dryRun, messageId }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = maskSensitiveError(rawMessage, settings)
    options.appendRuntimeLog?.(`fresh email delivery failed material=${manifest.sourceId || path.basename(materialPath)} message=${message}`)
    writeDeliveryStatus({
      status: 'failed',
      reason: 'smtp_send_failed',
      queueSource: options.queueSource,
      subject,
      to: settings.email_to,
      from: settings.email_from,
      sourceKind: body.sourceKind,
      sourcePath: path.relative(materialPath, body.sourcePath).replace(/\\/gu, '/'),
      contentSha1,
      failedAt: new Date(now()).toISOString(),
      error: message,
      dryRun,
    })
    return { status: 'failed', reason: message, statusPath, dryRun }
  }
}

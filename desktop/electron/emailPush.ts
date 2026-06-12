import fs from 'node:fs'
import path from 'node:path'
import type { MaterialPackageSummary } from './materialInventory'
import {
  escapeHtml,
  isEmailPushConfigured,
  sendSmtpMessage,
  type EmailRuntimeSettings,
  type EmailSendResult,
} from './smtpEmail'

export type EditorialEmailRuntimeSettings = EmailRuntimeSettings & {
  email_push_enabled: boolean
}

export type EditorialEmailPushResult = EmailSendResult & {
  skipped: boolean
  materialPath: string
}

function sanitizeSubjectText(value: unknown, fallback = '视频精读稿') {
  const text = String(value ?? '').replace(/[\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim()
  return text || fallback
}

function readJsonObject(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return {}
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function writeJsonObject(filePath: string, payload: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

function buildFallbackHtml(record: MaterialPackageSummary, markdownText: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;color:#111827;">
    <div style="max-width:760px;margin:0 auto;padding:28px 18px;">
      <article style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:28px;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
        <div style="font-size:13px;color:#6b7280;">${escapeHtml(record.creator || '视界专注')}</div>
        <h1 style="margin:10px 0 18px;font-size:26px;line-height:1.35;color:#111827;">${escapeHtml(record.title)}</h1>
        <pre style="white-space:pre-wrap;margin:0;font:15px/1.9 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;color:#1f2937;">${escapeHtml(markdownText)}</pre>
      </article>
    </div>
  </body>
</html>`
}

function buildArticleEmail(record: MaterialPackageSummary) {
  const markdownText = fs.existsSync(record.editorialSummaryPath)
    ? fs.readFileSync(record.editorialSummaryPath, 'utf-8').trim()
    : ''
  if (!markdownText) {
    throw new Error('视频精读稿正文不存在，无法推送邮件。')
  }

  const html = fs.existsSync(record.editorialSummaryHtmlPath)
    ? fs.readFileSync(record.editorialSummaryHtmlPath, 'utf-8').trim()
    : buildFallbackHtml(record, markdownText)

  const creatorPrefix = record.creator ? `${record.creator}｜` : ''
  const subject = `视界专注｜${creatorPrefix}${sanitizeSubjectText(record.title)}`
  const sourceLine = record.sourceUrl ? `原视频：${record.sourceUrl}` : record.sourceId ? `来源：${record.sourceId}` : ''
  const text = [
    sanitizeSubjectText(record.title),
    record.creator ? `作者：${record.creator}` : '',
    sourceLine,
    '',
    markdownText,
  ].filter((line) => line !== '').join('\n')

  return { subject, text, html }
}

function markEmailPushed(record: MaterialPackageSummary, result: EmailSendResult) {
  const statusPath = path.join(record.path, 'summary', 'summary_status.json')
  const status = readJsonObject(statusPath)
  const pushedAt = Date.now()
  writeJsonObject(statusPath, {
    ...status,
    email_pushed_at: pushedAt,
    email_push: {
      ok: result.ok,
      mode: result.mode,
      message: result.message,
      recipient_count: result.recipientCount,
      pushed_at: pushedAt,
    },
  })
}

export async function pushEditorialArticleEmail({
  settings,
  appId,
  record,
}: {
  settings: EditorialEmailRuntimeSettings
  appId: string
  record: MaterialPackageSummary | null
}): Promise<EditorialEmailPushResult> {
  const materialPath = record?.path ?? ''
  if (!record) {
    return {
      ok: true,
      skipped: true,
      mode: 'smtp',
      configured: false,
      recipientCount: 0,
      materialPath,
      message: '没有可推送的资料记录。',
    }
  }
  if (!settings.email_push_enabled) {
    return {
      ok: true,
      skipped: true,
      mode: 'smtp',
      configured: isEmailPushConfigured(settings),
      recipientCount: 0,
      materialPath,
      message: '邮件推送未启用。',
    }
  }
  if (record.emailPushedAt > 0) {
    return {
      ok: true,
      skipped: true,
      mode: 'smtp',
      configured: isEmailPushConfigured(settings),
      recipientCount: 0,
      materialPath,
      message: '这篇精读稿已经推送过。',
    }
  }
  if (!record.editorialSummaryExists) {
    return {
      ok: true,
      skipped: true,
      mode: 'smtp',
      configured: isEmailPushConfigured(settings),
      recipientCount: 0,
      materialPath,
      message: '视频精读稿尚未就绪，跳过邮件推送。',
    }
  }

  const result = await sendSmtpMessage(settings, appId, buildArticleEmail(record))
  if (result.ok) {
    markEmailPushed(record, result)
  }
  return {
    ...result,
    skipped: false,
    materialPath,
  }
}

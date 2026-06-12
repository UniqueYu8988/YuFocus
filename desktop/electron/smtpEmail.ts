import crypto from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'

export type EmailRuntimeSettings = {
  email_smtp_host: string
  email_smtp_port: number
  email_smtp_secure: boolean
  email_smtp_user: string
  email_smtp_password: string
  email_from: string
  email_to: string
}

export type EmailSendResult = {
  ok: boolean
  mode: 'smtp'
  message: string
  configured: boolean
  recipientCount: number
}

export type SmtpMessage = {
  subject: string
  text: string
  html: string
}

function countEmailRecipients(value: string) {
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean).length
}

export function parseEmailRecipients(value: string) {
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function isEmailPushConfigured(settings: EmailRuntimeSettings) {
  return Boolean(
    settings.email_smtp_host &&
    settings.email_smtp_port &&
    settings.email_smtp_user &&
    settings.email_smtp_password &&
    settings.email_from &&
    countEmailRecipients(settings.email_to) > 0
  )
}

function encodeMimeWord(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

function escapeSmtpDataLines(value: string) {
  return value.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildMultipartMessage(settings: EmailRuntimeSettings, recipients: string[], message: SmtpMessage) {
  const boundary = `shijie-${crypto.randomBytes(12).toString('hex')}`

  return escapeSmtpDataLines([
    `From: <${settings.email_from}>`,
    `To: ${recipients.map((item) => `<${item}>`).join(', ')}`,
    `Subject: ${encodeMimeWord(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.html,
    '',
    `--${boundary}--`,
  ].join('\r\n'))
}

function buildSmtpTestMessage() {
  const now = new Date()
  const subject = `视界专注推送测试 ${now.toLocaleString('zh-CN')}`
  const text = [
    '这是一封来自视界专注的推送测试邮件。',
    '',
    '如果你收到这封邮件，说明后台推送邮箱已经可以连接并发送。未来这里会承接每日或批次的视频精读稿。',
    '',
    '测试摘要：',
    '- 后台检测间隔：每 6 小时',
    '- 队列并发：固定 3 个任务',
    '- 邮件形态：HTML 正文 + 纯文本兜底',
    '',
    `发送时间：${now.toISOString()}`,
  ].join('\n')
  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;color:#111827;">
    <div style="max-width:680px;margin:0 auto;padding:28px 18px;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.08);">
        <div style="padding:24px 28px 18px;border-bottom:1px solid #eef0f3;">
          <div style="font-size:13px;letter-spacing:0.08em;color:#6b7280;text-transform:uppercase;">Shijie Focus</div>
          <h1 style="margin:10px 0 0;font-size:24px;line-height:1.35;color:#111827;">视界专注推送测试</h1>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.8;color:#6b7280;">邮箱链路已经接通。未来视频精读稿会以这种邮件正文形式推送，打开即可阅读。</p>
        </div>
        <div style="padding:22px 28px;">
          <div style="display:grid;gap:12px;">
            <div style="padding:14px 16px;border-radius:14px;background:#f8fafc;border:1px solid #edf2f7;">
              <div style="font-size:13px;color:#6b7280;">后台检测</div>
              <div style="margin-top:4px;font-size:18px;font-weight:700;color:#111827;">每 6 小时自动检查一次</div>
            </div>
            <div style="padding:14px 16px;border-radius:14px;background:#f8fafc;border:1px solid #edf2f7;">
              <div style="font-size:13px;color:#6b7280;">任务队列</div>
              <div style="margin-top:4px;font-size:18px;font-weight:700;color:#111827;">固定 3 个任务并行处理</div>
            </div>
          </div>
          <h2 style="margin:24px 0 8px;font-size:17px;color:#111827;">邮件阅读形态</h2>
          <p style="margin:0;font-size:15px;line-height:1.9;color:#374151;">这封测试邮件使用 HTML 正文，并保留纯文本兜底。后续推送真实视频精读稿时，可以直接把标题、摘要、重点段落和原文链接放在邮件里，尽量接近一篇干净的短日报。</p>
          <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">发送时间：${escapeHtml(now.toISOString())}</p>
        </div>
      </div>
    </div>
  </body>
</html>`
  return { subject, text, html }
}

function getSmtpResponseCode(response: string) {
  return Number(response.slice(0, 3))
}

export function formatSmtpFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/unexpectedly closed|closed|disconnect/i.test(message)) {
    return 'SMTP 连接已建立，但登录阶段被服务器断开。QQ 邮箱通常需要在网页版邮箱开启 SMTP/IMAP 服务，并使用生成的 SMTP 授权码，不是 QQ 登录密码。'
  }
  if (/535|auth|login|password|credential/i.test(message)) {
    return 'SMTP 登录失败。请确认 SMTP User 是完整发件邮箱，SMTP Password 是邮箱服务生成的授权码。'
  }
  if (/timeout/i.test(message)) {
    return 'SMTP 连接超时，请稍后重试或检查网络。'
  }
  return message
}

export async function sendSmtpMessage(settings: EmailRuntimeSettings, appId: string, message: SmtpMessage): Promise<EmailSendResult> {
  const recipients = parseEmailRecipients(settings.email_to)
  const recipientCount = recipients.length
  const configured = isEmailPushConfigured(settings)
  if (!configured) {
    return {
      ok: false,
      mode: 'smtp',
      configured: false,
      recipientCount,
      message: '邮件配置还不完整。QQ 邮箱通常需要 smtp.qq.com、465、SSL、完整发件邮箱和 SMTP 授权码。',
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const host = settings.email_smtp_host
      const port = settings.email_smtp_port
      const socket: net.Socket | tls.TLSSocket = settings.email_smtp_secure
        ? tls.connect({
            host,
            port,
            servername: host,
            rejectUnauthorized: true,
          })
        : net.connect({ host, port })
      let buffer = ''
      let responseLines: string[] = []
      const queuedResponses: string[] = []
      const waiters: Array<(response: string) => void> = []
      let settled = false

      const cleanup = () => {
        socket.removeAllListeners()
        socket.destroy()
      }

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }

      const deliverResponse = (response: string) => {
        const waiter = waiters.shift()
        if (waiter) {
          waiter(response)
        } else {
          queuedResponses.push(response)
        }
      }

      const consumeBuffer = () => {
        let lineEnd = buffer.indexOf('\n')
        while (lineEnd >= 0) {
          const line = buffer.slice(0, lineEnd).replace(/\r$/u, '')
          buffer = buffer.slice(lineEnd + 1)
          if (line) responseLines.push(line)
          if (/^\d{3} /u.test(line)) {
            deliverResponse(responseLines.join('\n'))
            responseLines = []
          }
          lineEnd = buffer.indexOf('\n')
        }
      }

      const waitForResponse = (expectedCodes: number[]) => new Promise<string>((resolveResponse, rejectResponse) => {
        const accept = (response: string) => {
          const code = getSmtpResponseCode(response)
          if (!expectedCodes.includes(code)) {
            rejectResponse(new Error(`SMTP 返回 ${code}：${response.split('\n').slice(-1)[0] || response}`))
            return
          }
          resolveResponse(response)
        }
        const queued = queuedResponses.shift()
        if (queued) {
          accept(queued)
          return
        }
        waiters.push(accept)
      })

      const writeCommand = (command: string) => {
        socket.write(`${command}\r\n`, 'utf-8')
      }

      const writeData = (message: string) => {
        socket.write(`${message}\r\n.\r\n`, 'utf-8')
      }

      socket.setEncoding('utf-8')
      socket.setTimeout(20_000)
      socket.on('data', (chunk) => {
        buffer += chunk
        consumeBuffer()
      })
      socket.on('timeout', () => fail(new Error('SMTP 连接超时。')))
      socket.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))

      socket.once(settings.email_smtp_secure ? 'secureConnect' : 'connect', () => {
        void (async () => {
          try {
            await waitForResponse([220])
            writeCommand(`EHLO ${appId}`)
            await waitForResponse([250])
            writeCommand('AUTH LOGIN')
            await waitForResponse([334])
            writeCommand(Buffer.from(settings.email_smtp_user, 'utf-8').toString('base64'))
            await waitForResponse([334])
            writeCommand(Buffer.from(settings.email_smtp_password, 'utf-8').toString('base64'))
            await waitForResponse([235])
            writeCommand(`MAIL FROM:<${settings.email_from}>`)
            await waitForResponse([250])
            for (const recipient of recipients) {
              writeCommand(`RCPT TO:<${recipient}>`)
              await waitForResponse([250, 251])
            }
            writeCommand('DATA')
            await waitForResponse([354])
            writeData(buildMultipartMessage(settings, recipients, message))
            await waitForResponse([250])
            writeCommand('QUIT')
            await waitForResponse([221, 250]).catch(() => '')
            if (settled) return
            settled = true
            cleanup()
            resolve()
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
          }
        })()
      })
    })
  } catch (error) {
    return {
      ok: false,
      mode: 'smtp',
      configured: true,
      recipientCount,
      message: formatSmtpFailureMessage(error),
    }
  }

  return {
    ok: true,
    mode: 'smtp',
    configured: true,
    recipientCount,
    message: `邮件已通过 ${settings.email_smtp_host}:${settings.email_smtp_port} 发送到 ${recipientCount} 个收件人。`,
  }
}

export async function sendSmtpTestEmail(settings: EmailRuntimeSettings, appId: string): Promise<EmailSendResult> {
  const result = await sendSmtpMessage(settings, appId, buildSmtpTestMessage())
  if (!result.ok) return result
  return {
    ...result,
    message: `测试${result.message}`,
  }
}

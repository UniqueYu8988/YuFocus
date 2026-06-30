import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mod = await import('../electron/services/emailDeliveryService.ts')

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text, 'utf-8')
}

function createMaterial(root, name) {
  const materialPath = path.join(root, name)
  writeJson(path.join(materialPath, 'manifest.json'), {
    source: {
      title: '测试 fresh 邮件视频',
      creator: '测试 UP',
      source_id: 'BV_TEST_FRESH',
      url: 'https://www.bilibili.com/video/BV_TEST_FRESH',
    },
  })
  writeText(path.join(materialPath, 'delivery', 'email.md'), '# 视频更新\n\n这是一封 dry-run 测试邮件正文，包含足够的中文内容用于检查发送流程。')
  writeJson(path.join(materialPath, 'delivery', 'decision.json'), {
    worthEmail: true,
    importance: 4,
    reason: '测试需要发送',
    tags: ['test'],
  })
  writeJson(path.join(materialPath, 'work', 'quality', 'local_check.json'), {
    ok: true,
    riskLevel: 'low',
    issues: [],
    missingCriticalTerms: [],
    reason: '测试质量通过',
  })
  return materialPath
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-email-check-'))
const settings = {
  email_push_enabled: true,
  email_smtp_host: 'smtp.example.com',
  email_smtp_port: 465,
  email_smtp_secure: true,
  email_smtp_user: 'sender@example.com',
  email_smtp_password: 'test-password-not-printed',
  email_from: 'sender@example.com',
  email_to: 'receiver@example.com',
}

const freshMaterial = createMaterial(tmpRoot, 'fresh-material')
const freshResult = await mod.pushFreshMaterialEmail({
  materialPath: freshMaterial,
  queueSource: 'fresh',
  settings,
  dryRun: true,
  now: () => 1782816000000,
})
assert.equal(freshResult.status, 'sent')
assert.equal(freshResult.dryRun, true)

const freshStatusPath = path.join(freshMaterial, 'delivery', 'email_status.json')
const freshStatus = JSON.parse(fs.readFileSync(freshStatusPath, 'utf-8'))
assert.equal(freshStatus.delivery.status, 'sent')
assert.equal(freshStatus.delivery.queueSource, 'fresh')
assert.equal(freshStatus.delivery.mode, 'dry_run')
assert.equal(typeof freshStatus.delivery.contentSha1, 'string')
assert.doesNotMatch(JSON.stringify(freshStatus), /test-password-not-printed/u)

const duplicateResult = await mod.pushFreshMaterialEmail({
  materialPath: freshMaterial,
  queueSource: 'fresh',
  settings,
  dryRun: true,
  now: () => 1782816001000,
})
assert.equal(duplicateResult.status, 'skipped')
assert.match(duplicateResult.reason, /已经发送/u)

const historyMaterial = createMaterial(tmpRoot, 'history-material')
const historyResult = await mod.pushFreshMaterialEmail({
  materialPath: historyMaterial,
  queueSource: 'history',
  settings,
  dryRun: true,
  now: () => 1782816002000,
})
assert.equal(historyResult.status, 'skipped')
const historyStatus = JSON.parse(fs.readFileSync(path.join(historyMaterial, 'delivery', 'email_status.json'), 'utf-8'))
assert.equal(historyStatus.delivery.status, 'skipped')
assert.equal(historyStatus.delivery.queueSource, 'history')
assert.match(historyStatus.delivery.reason, /not_fresh/u)

const disabledMaterial = createMaterial(tmpRoot, 'disabled-material')
const disabledResult = await mod.pushFreshMaterialEmail({
  materialPath: disabledMaterial,
  queueSource: 'fresh',
  settings: {
    ...settings,
    email_push_enabled: false,
  },
  dryRun: true,
})
assert.equal(disabledResult.status, 'skipped')
assert.match(disabledResult.reason, /未启用/u)

fs.rmSync(tmpRoot, { recursive: true, force: true })

const queueExecutorSource = fs.readFileSync(new URL('../electron/queue/queueExecutor.ts', import.meta.url), 'utf-8')
assert.match(queueExecutorSource, /target\.queueSource/u, '队列邮件调用必须携带 queueSource。')
assert.match(queueExecutorSource, /!localConsumptionNote[\s\S]*tryPushMaterialEmail/u, '本地总结失败或需复核时不得发送邮件。')

const emailServiceSource = fs.readFileSync(new URL('../electron/services/emailDeliveryService.ts', import.meta.url), 'utf-8')
assert.doesNotMatch(emailServiceSource, /资料目录：\$\{materialPath\}/u, '邮件正文不得附带本机材料路径。')
assert.match(emailServiceSource, /maskSensitiveError/u, 'SMTP 报错写入状态或日志前必须经过脱敏。')

console.log('fresh email delivery check passed')

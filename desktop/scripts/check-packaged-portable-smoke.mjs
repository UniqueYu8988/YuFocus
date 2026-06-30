import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const releaseDir = path.join(repoRoot, 'desktop', 'release')

function findPortableExe() {
  const candidates = fs.readdirSync(releaseDir)
    .filter((name) => /^视界专注_v.+_x64\.exe$/u.test(name))
    .map((name) => path.join(releaseDir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  if (!candidates[0]) {
    throw new Error('未找到便携版 exe，请先运行 npm run build:portable。')
  }
  return candidates[0]
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url, timeoutMs = 3000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function waitForPage(port) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < 30000) {
    try {
      const pages = await fetchJson(`http://127.0.0.1:${port}/json/list`, 2000)
      const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
      if (page) return page
    } catch (error) {
      lastError = error
    }
    await wait(500)
  }
  throw new Error(`等待打包版页面超时：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

class CdpClient {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
  }

  async open() {
    this.socket = new WebSocket(this.url)
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      if (!payload.id) return
      const pending = this.pending.get(payload.id)
      if (!pending) return
      this.pending.delete(payload.id)
      if (payload.error) {
        pending.reject(new Error(payload.error.message || JSON.stringify(payload.error)))
      } else {
        pending.resolve(payload.result)
      }
    })
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接调试端口超时')), 5000)
      this.socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
      this.socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('连接调试端口失败'))
      }, { once: true })
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    const payload = JSON.stringify({ id, method, params })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(payload)
    })
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || '页面脚本执行失败')
    }
    return result.result?.value
  }

  close() {
    try {
      this.socket?.close()
    } catch {
      // ignore
    }
  }
}

async function taskkill(pid) {
  if (!pid) return
  await new Promise((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    killer.on('close', () => resolve())
    killer.on('error', () => resolve())
  })
}

const exePath = findPortableExe()
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-portable-smoke-'))
const port = 9400 + Math.floor(Math.random() * 300)
const beforeLogSize = fs.existsSync(path.join(releaseDir, 'data', 'logs', 'runtime.log'))
  ? fs.statSync(path.join(releaseDir, 'data', 'logs', 'runtime.log')).size
  : 0

const app = spawn(exePath, [
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${port}`,
], {
  detached: false,
  stdio: 'ignore',
  windowsHide: true,
})

let client = null
try {
  const page = await waitForPage(port)
  client = new CdpClient(page.webSocketDebuggerUrl)
  await client.open()
  await client.send('Runtime.enable')
  await client.evaluate('new Promise((resolve) => { if (document.readyState === "complete") resolve(true); else window.addEventListener("load", () => resolve(true), { once: true }); })', true)
  await client.evaluate(`new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const text = document.body.innerText || ''
      if (text.includes('队列') && text.includes('档案') && text.includes('设置')) {
        clearInterval(timer)
        resolve(true)
      }
      if (Date.now() - startedAt > 15000) {
        clearInterval(timer)
        reject(new Error('导航入口等待超时：' + text.slice(0, 300)))
      }
    }, 250)
  })`, true)

  const title = await client.evaluate('document.title')
  assert.equal(title, '视界专注')

  const navigationResult = await client.evaluate(`(async () => {
    const labels = ['最近', '队列', '档案', '流程', '设置']
    const results = []
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    for (const label of labels) {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
      const rawTarget = candidates.find((element) => (element.textContent || '').trim().includes(label))
      const target = rawTarget?.closest?.('button, [role="button"], a') || rawTarget
      if (!target) {
        results.push({
          label,
          ok: label === '最近' && document.body.innerText.includes(label),
          reason: '未找到入口',
          bodyLength: document.body.innerText.length,
        })
        continue
      }
      target.click()
      await sleep(650)
      const bodyText = document.body.innerText
      results.push({
        label,
        ok: bodyText.length > 50 && bodyText.includes(label),
        bodyLength: bodyText.length,
      })
    }
    return results
  })()`, true)

  for (const item of navigationResult) {
    assert.equal(item.ok, true, `${item.label} 页面未能打开：${JSON.stringify(item)}`)
  }

  const environmentResult = await client.evaluate(`window.desktopAPI.runEnvironmentCheck().then((result) => ({
    itemIds: result.items.map((item) => item.id),
    backendStatus: result.items.find((item) => item.id === 'backend_scripts')?.status || '',
    serialized: JSON.stringify(result),
  }))`, true)
  for (const id of ['backend_scripts', 'python', 'python_dependencies', 'sensevoice', 'ollama', 'mimo', 'bilibili_cookie', 'smtp']) {
    assert.ok(environmentResult.itemIds.includes(id), `环境自检缺少 ${id}`)
  }
  assert.equal(environmentResult.backendStatus, 'ok', '便携版环境自检必须能找到 backend 脚本。')
  assert.doesNotMatch(environmentResult.serialized, /email_smtp_password|sessdata|mimo_api_key|SMTP 授权码/u)

  await wait(1200)
  const runtimeLogPath = path.join(releaseDir, 'data', 'logs', 'runtime.log')
  const logTail = fs.existsSync(runtimeLogPath)
    ? fs.readFileSync(runtimeLogPath, 'utf-8').slice(beforeLogSize)
    : ''
  assert.doesNotMatch(logTail, /spawn material builder|spawn material summary|distiller|transcribe|SenseVoice|smtp|sendMail|mimo|ollama/iu)

  console.log(JSON.stringify({
    ok: true,
    exePath,
    pageTitle: title,
    visited: navigationResult.map((item) => item.label),
    environmentItems: environmentResult.itemIds,
  }, null, 2))
} finally {
  client?.close()
  await taskkill(app.pid)
}

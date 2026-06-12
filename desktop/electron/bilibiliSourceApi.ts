import crypto from 'node:crypto'
import path from 'node:path'

export type BilibiliSettings = {
  sessdata: string
}

export type SettingsStatus = {
  bilibili: {
    configured: boolean
    valid: boolean
    accountName: string
    accountId: string
    message: string
  }
}

export type BilibiliFollowSourcesPayload = {
  provider: 'bilibili'
  configured: boolean
  authenticated: boolean
  accountName: string
  accountId: string
  message: string
  nextAction: string
  items: Array<{
    mid: string
    name: string
    face: string
    sign: string
    mtime: number
    officialTitle: string
    latestCount?: number
  }>
}

export type BilibiliSourceVideosPayload = {
  provider: 'bilibili'
  fetchedAt: number
  totalVideos: number
  sources: Array<{
    mid: string
    name: string
    error: string
    videos: BilibiliVideoMetadata[]
  }>
}

export type BilibiliVideoMetadata = {
  bvid: string
  aid: string
  title: string
  authorMid: string
  authorName: string
  pic: string
  description: string
  durationText: string
  durationSeconds: number
  pubdate: number
  statView: number
  url: string
}

function sanitizeSecret(value: unknown) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  if (normalized.includes('文件名、目录名或卷标语法不正确')) return ''
  if (/[^\x20-\x7E]/.test(normalized)) return ''
  return normalized
}

function sanitizeDisplayText(value: unknown, fallback = '') {
  const normalized = String(value ?? '').replace(/[\x00-\x1F]/g, '').trim()
  return normalized || fallback
}

export async function fetchSettingsStatus(settings: BilibiliSettings): Promise<SettingsStatus> {
  const bilibili = {
    configured: Boolean(settings.sessdata.trim()),
    valid: false,
    accountName: '',
    accountId: '',
    message: '未配置 SESSDATA',
  }

  if (bilibili.configured) {
    try {
      const cookieValue = sanitizeSecret(settings.sessdata)
      if (!cookieValue) {
        bilibili.message = 'SESSDATA 格式无效'
      } else {
        const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          headers: {
            Cookie: `SESSDATA=${cookieValue}`,
            Referer: 'https://www.bilibili.com',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        })
        const payload = await response.json()
        const data = payload?.data ?? {}
        if (payload?.code === 0 && data?.isLogin) {
          bilibili.valid = true
          bilibili.accountName = String(data.uname ?? '')
          bilibili.accountId = String(data.mid ?? '')
          bilibili.message = bilibili.accountName
            ? `已登录 ${bilibili.accountName}`
            : '已登录'
        } else {
          bilibili.message = '登录状态无效'
        }
      }
    } catch {
      bilibili.message = '登录状态检测失败'
    }
  }

  return { bilibili }
}

function buildBilibiliCookie(settings: BilibiliSettings) {
  const sessdata = sanitizeSecret(settings.sessdata)
  return sessdata ? `SESSDATA=${sessdata}` : ''
}

function buildBilibiliHeaders(cookie: string): Record<string, string> {
  return {
    Cookie: cookie,
    Referer: 'https://www.bilibili.com',
    Origin: 'https://www.bilibili.com',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }
}

function readBilibiliOfficialTitle(raw: unknown) {
  if (!raw || typeof raw !== 'object') return ''
  const official = raw as Record<string, unknown>
  return sanitizeDisplayText(official.desc ?? official.title ?? '')
}

const BILIBILI_WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const

function extractBilibiliWbiKey(rawUrl: unknown) {
  const value = sanitizeDisplayText(rawUrl)
  if (!value) return ''
  try {
    const parsed = new URL(value)
    const filename = path.basename(parsed.pathname)
    return filename.split('.')[0] || ''
  } catch {
    const filename = path.basename(value)
    return filename.split('.')[0] || ''
  }
}

function buildBilibiliMixinKey(imgKey: string, subKey: string) {
  const rawKey = `${imgKey}${subKey}`
  return BILIBILI_WBI_MIXIN_KEY_ENC_TAB.map((index) => rawKey[index] ?? '').join('').slice(0, 32)
}

function encodeBilibiliWbiValue(value: string) {
  return encodeURIComponent(value.replace(/[!'()*]/g, ''))
}

function signBilibiliWbiParams(params: Record<string, string | number | boolean>, mixinKey: string) {
  const signedParams: Record<string, string> = {
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    wts: String(Math.floor(Date.now() / 1000)),
  }
  const query = Object.keys(signedParams)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeBilibiliWbiValue(signedParams[key])}`)
    .join('&')
  const wRid = crypto.createHash('md5').update(`${query}${mixinKey}`).digest('hex')
  return `${query}&w_rid=${wRid}`
}

async function fetchBilibiliWbiMixinKey(headers: Record<string, string>) {
  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers })
  if (!response.ok) return ''
  const payload = await response.json() as Record<string, unknown>
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  const wbiImg = data.wbi_img && typeof data.wbi_img === 'object' ? data.wbi_img as Record<string, unknown> : {}
  const imgKey = extractBilibiliWbiKey(wbiImg.img_url)
  const subKey = extractBilibiliWbiKey(wbiImg.sub_url)
  return imgKey && subKey ? buildBilibiliMixinKey(imgKey, subKey) : ''
}

function parseBilibiliDurationSeconds(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  const text = sanitizeDisplayText(value)
  if (!text) return 0
  const parts = text.split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((sum, part) => sum * 60 + part, 0)
}

function formatBilibiliDurationText(value: unknown) {
  const seconds = parseBilibiliDurationSeconds(value)
  if (!seconds) return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainSeconds = seconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainSeconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(remainSeconds).padStart(2, '0')}`
}

export function extractBilibiliBvid(input: unknown) {
  const text = sanitizeDisplayText(input)
  const match = text.match(/BV[a-zA-Z0-9]+/u)
  if (!match) {
    throw new Error('请输入有效的 BV 号或 B 站视频链接。')
  }
  return match[0]
}

function normalizeBilibiliVideoItem(rawItem: unknown, fallbackMid: string, fallbackName: string): BilibiliVideoMetadata | null {
  if (!rawItem || typeof rawItem !== 'object') return null
  const item = rawItem as Record<string, unknown>
  const bvid = sanitizeDisplayText(item.bvid ?? item.bvid_id ?? '')
  const aid = sanitizeDisplayText(item.aid ?? item.aid_id ?? '')
  const title = sanitizeDisplayText(item.title ?? '')
  if (!bvid || !title) return null
  const durationText = sanitizeDisplayText(item.length ?? item.duration ?? '')
  const authorName = sanitizeDisplayText(item.author ?? item.owner ?? fallbackName, fallbackName)
  const authorMid = sanitizeDisplayText(item.mid ?? item.owner_mid ?? fallbackMid, fallbackMid)
  return {
    bvid,
    aid,
    title,
    authorMid,
    authorName,
    pic: sanitizeDisplayText(item.pic ?? item.cover ?? ''),
    description: sanitizeDisplayText(item.description ?? item.desc ?? ''),
    durationText,
    durationSeconds: parseBilibiliDurationSeconds(item.duration ?? item.length),
    pubdate: Number(item.created ?? item.pubdate ?? 0) || 0,
    statView: Number(item.play ?? item.view ?? 0) || 0,
    url: `https://www.bilibili.com/video/${bvid}`,
  }
}

function normalizeBilibiliViewVideo(rawItem: unknown, fallbackBvid: string): BilibiliVideoMetadata | null {
  if (!rawItem || typeof rawItem !== 'object') return null
  const item = rawItem as Record<string, unknown>
  const owner = item.owner && typeof item.owner === 'object' ? item.owner as Record<string, unknown> : {}
  const stat = item.stat && typeof item.stat === 'object' ? item.stat as Record<string, unknown> : {}
  const bvid = sanitizeDisplayText(item.bvid ?? fallbackBvid)
  const title = sanitizeDisplayText(item.title ?? '')
  if (!bvid || !title) return null
  return {
    bvid,
    aid: sanitizeDisplayText(item.aid ?? ''),
    title,
    authorMid: sanitizeDisplayText(owner.mid ?? ''),
    authorName: sanitizeDisplayText(owner.name ?? ''),
    pic: sanitizeDisplayText(item.pic ?? ''),
    description: sanitizeDisplayText(item.desc ?? ''),
    durationText: formatBilibiliDurationText(item.duration),
    durationSeconds: parseBilibiliDurationSeconds(item.duration),
    pubdate: Number(item.pubdate ?? 0) || 0,
    statView: Number(stat.view ?? 0) || 0,
    url: `https://www.bilibili.com/video/${bvid}`,
  }
}

export async function getBilibiliVideoMetadata(settings: BilibiliSettings, videoInput: unknown): Promise<BilibiliVideoMetadata> {
  const bvid = extractBilibiliBvid(videoInput)
  const cookie = buildBilibiliCookie(settings)
  const headers = buildBilibiliHeaders(cookie)
  const url = new URL('https://api.bilibili.com/x/web-interface/view')
  url.searchParams.set('bvid', bvid)
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`视频信息读取失败：HTTP ${response.status}`)
  }
  const payload = await response.json() as Record<string, unknown>
  if (Number(payload.code ?? -1) !== 0) {
    throw new Error(sanitizeDisplayText(payload.message ?? payload.msg ?? '视频信息读取失败'))
  }
  const video = normalizeBilibiliViewVideo(payload.data, bvid)
  if (!video) {
    throw new Error('视频信息不完整，无法加入队列。')
  }
  return video
}

async function fetchBilibiliVideosForSource(
  headers: Record<string, string>,
  mixinKey: string,
  source: { mid: string; name: string },
  pageSize: number,
) {
  const baseParams = {
    mid: source.mid,
    pn: 1,
    ps: pageSize,
    tid: 0,
    keyword: '',
    order: 'pubdate',
    platform: 'web',
    web_location: 1550101,
  }
  const urls = mixinKey
    ? [
        `https://api.bilibili.com/x/space/wbi/arc/search?${signBilibiliWbiParams(baseParams, mixinKey)}`,
        `https://api.bilibili.com/x/space/arc/search?${new URLSearchParams(Object.entries(baseParams).map(([key, value]) => [key, String(value)])).toString()}`,
      ]
    : [
        `https://api.bilibili.com/x/space/arc/search?${new URLSearchParams(Object.entries(baseParams).map(([key, value]) => [key, String(value)])).toString()}`,
      ]

  let lastError = ''
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers })
      if (!response.ok) {
        lastError = `HTTP ${response.status}`
        continue
      }
      const payload = await response.json() as Record<string, unknown>
      if (Number(payload.code ?? -1) !== 0) {
        lastError = sanitizeDisplayText(payload.message ?? payload.msg ?? '投稿列表读取失败')
        continue
      }
      const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
      const list = data.list && typeof data.list === 'object' ? data.list as Record<string, unknown> : {}
      const rawVideos = Array.isArray(list.vlist) ? list.vlist : Array.isArray(data.vlist) ? data.vlist : []
      return rawVideos
        .map((item) => normalizeBilibiliVideoItem(item, source.mid, source.name))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    } catch (error) {
      lastError = error instanceof Error ? error.message : '投稿列表读取失败'
    }
  }

  throw new Error(lastError || '投稿列表读取失败')
}

export async function listBilibiliFollowSources(settings: BilibiliSettings): Promise<BilibiliFollowSourcesPayload> {
  const status = await fetchSettingsStatus(settings)
  const bilibili = status.bilibili
  const authenticated = bilibili.valid

  if (!authenticated || !bilibili.accountId) {
    return {
      provider: 'bilibili',
      configured: bilibili.configured,
      authenticated,
      accountName: bilibili.accountName,
      accountId: bilibili.accountId,
      message: bilibili.message,
      nextAction: bilibili.configured ? '检查 SESSDATA 登录状态' : '先在设置中配置 SESSDATA',
      items: [],
    }
  }

  const cookie = buildBilibiliCookie(settings)
  const headers = buildBilibiliHeaders(cookie)
  const items: BilibiliFollowSourcesPayload['items'] = []
  let total = 0
  const pageSize = 50
  const maxPages = 6

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL('https://api.bilibili.com/x/relation/followings')
      url.searchParams.set('vmid', bilibili.accountId)
      url.searchParams.set('pn', String(page))
      url.searchParams.set('ps', String(pageSize))
      url.searchParams.set('order', 'desc')
      url.searchParams.set('order_type', 'attention')
      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`关注列表读取失败：HTTP ${response.status}`)
      }
      const payload = await response.json() as Record<string, unknown>
      if (Number(payload.code ?? -1) !== 0) {
        throw new Error(sanitizeDisplayText(payload.message ?? payload.msg ?? '关注列表读取失败'))
      }
      const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
      total = Number(data.total ?? total) || total
      const list = Array.isArray(data.list) ? data.list : []
      for (const rawItem of list) {
        if (!rawItem || typeof rawItem !== 'object') continue
        const item = rawItem as Record<string, unknown>
        const mid = sanitizeDisplayText(item.mid ?? '')
        const name = sanitizeDisplayText(item.uname ?? item.name ?? '')
        if (!mid || !name) continue
        items.push({
          mid,
          name,
          face: sanitizeDisplayText(item.face ?? ''),
          sign: sanitizeDisplayText(item.sign ?? ''),
          mtime: Number(item.mtime ?? 0) || 0,
          officialTitle: readBilibiliOfficialTitle(item.official_verify),
        })
      }

      if (list.length < pageSize || (total > 0 && items.length >= total)) break
    }
  } catch (error) {
    return {
      provider: 'bilibili',
      configured: true,
      authenticated: true,
      accountName: bilibili.accountName,
      accountId: bilibili.accountId,
      message: error instanceof Error ? error.message : '关注列表读取失败',
      nextAction: '稍后重试或检查 B 站登录状态',
      items,
    }
  }

  return {
    provider: 'bilibili',
    configured: bilibili.configured,
    authenticated,
    accountName: bilibili.accountName,
    accountId: bilibili.accountId,
    message: total > 0 ? `已读取 ${items.length}/${total} 个关注源` : `已读取 ${items.length} 个关注源`,
    nextAction: '选择关注源后载入最近视频',
    items,
  }
}

export async function listBilibiliSourceVideos(
  settings: BilibiliSettings,
  sources: Array<{ mid: string; name?: string }> = [],
  pageSize = 12,
): Promise<BilibiliSourceVideosPayload> {
  const normalizedSources = sources
    .map((source) => ({
      mid: sanitizeDisplayText(source.mid),
      name: sanitizeDisplayText(source.name ?? source.mid),
    }))
    .filter((source) => source.mid)
    .slice(0, 12)

  if (!normalizedSources.length) {
    return {
      provider: 'bilibili',
      fetchedAt: Date.now(),
      totalVideos: 0,
      sources: [],
    }
  }

  const status = await fetchSettingsStatus(settings)
  if (!status.bilibili.valid) {
    throw new Error(status.bilibili.configured ? status.bilibili.message : '请先在设置中配置 SESSDATA。')
  }

  const cookie = buildBilibiliCookie(settings)
  const headers = buildBilibiliHeaders(cookie)
  const mixinKey = await fetchBilibiliWbiMixinKey(headers).catch(() => '')
  const safePageSize = Math.max(1, Math.min(30, Math.floor(pageSize) || 12))
  const resultSources: BilibiliSourceVideosPayload['sources'] = []

  for (const source of normalizedSources) {
    try {
      const videos = await fetchBilibiliVideosForSource(headers, mixinKey, source, safePageSize)
      resultSources.push({
        mid: source.mid,
        name: source.name,
        error: '',
        videos,
      })
    } catch (error) {
      resultSources.push({
        mid: source.mid,
        name: source.name,
        error: error instanceof Error ? error.message : '投稿列表读取失败',
        videos: [],
      })
    }
  }

  return {
    provider: 'bilibili',
    fetchedAt: Date.now(),
    totalVideos: resultSources.reduce((sum, source) => sum + source.videos.length, 0),
    sources: resultSources,
  }
}

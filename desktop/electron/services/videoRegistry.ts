import fs from 'node:fs'
import path from 'node:path'
import type { BilibiliVideoMetadata } from '../providers/bilibiliSourceApi'

export type VideoRegistryStatus = 'fetched' | 'queued' | 'processing' | 'done'

export type VideoRegistryEntry = {
  title: string
  bvid: string
  aid: string
  author_mid: string
  author_name: string
  pic: string
  description: string
  published_time: string
  pubdate: number
  duration: string
  duration_seconds: number
  stat_view: number
  url: string
  status: VideoRegistryStatus
  last_seen: string
  cached: true
}

export type VideoRegistryDocument = {
  up_id: string
  videos: Record<string, VideoRegistryEntry>
  last_sync: string
}

function sanitizePathPart(value: unknown, fallback: string) {
  const text = String(value ?? '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
  return text || fallback
}

function sanitizeText(value: unknown, fallback = '') {
  const text = String(value ?? '').replace(/[\x00-\x1F]/g, '').trim()
  return text || fallback
}

function parseIsoFromPubdate(pubdate: number) {
  if (!Number.isFinite(pubdate) || pubdate <= 0) return ''
  return new Date(pubdate * 1000).toISOString()
}

function registryPathForSource(registryRoot: string, upId: string) {
  return path.join(registryRoot, `${sanitizePathPart(upId, 'unknown_up')}.json`)
}

function normalizeRegistryStatus(value: unknown): VideoRegistryStatus {
  return value === 'queued' || value === 'processing' || value === 'done' ? value : 'fetched'
}

function normalizeRegistryEntry(raw: unknown, bvidFallback: string): VideoRegistryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const bvid = sanitizeText(item.bvid ?? bvidFallback)
  if (!bvid) return null
  const pubdate = Number(item.pubdate ?? 0) || 0
  const durationSeconds = Number(item.duration_seconds ?? 0) || 0
  return {
    title: sanitizeText(item.title, bvid),
    bvid,
    aid: sanitizeText(item.aid),
    author_mid: sanitizeText(item.author_mid),
    author_name: sanitizeText(item.author_name),
    pic: sanitizeText(item.pic),
    description: sanitizeText(item.description),
    published_time: sanitizeText(item.published_time) || parseIsoFromPubdate(pubdate),
    pubdate,
    duration: sanitizeText(item.duration),
    duration_seconds: durationSeconds,
    stat_view: Number(item.stat_view ?? 0) || 0,
    url: sanitizeText(item.url) || `https://www.bilibili.com/video/${bvid}`,
    status: normalizeRegistryStatus(item.status),
    last_seen: sanitizeText(item.last_seen),
    cached: true,
  }
}

export function readVideoRegistry(registryRoot: string, upId: string): VideoRegistryDocument {
  const normalizedUpId = sanitizeText(upId, 'unknown_up')
  const registryPath = registryPathForSource(registryRoot, normalizedUpId)
  try {
    if (!fs.existsSync(registryPath)) {
      return { up_id: normalizedUpId, videos: {}, last_sync: '' }
    }
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as unknown
    const document = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    const rawVideos = document.videos && typeof document.videos === 'object' && !Array.isArray(document.videos)
      ? document.videos as Record<string, unknown>
      : {}
    const videos: Record<string, VideoRegistryEntry> = {}
    for (const [bvid, rawVideo] of Object.entries(rawVideos)) {
      const entry = normalizeRegistryEntry(rawVideo, bvid)
      if (entry) videos[entry.bvid] = entry
    }
    return {
      up_id: sanitizeText(document.up_id, normalizedUpId),
      videos,
      last_sync: sanitizeText(document.last_sync),
    }
  } catch {
    return { up_id: normalizedUpId, videos: {}, last_sync: '' }
  }
}

export function writeVideoRegistry(registryRoot: string, document: VideoRegistryDocument) {
  fs.mkdirSync(registryRoot, { recursive: true })
  const registryPath = registryPathForSource(registryRoot, document.up_id)
  const tempPath = `${registryPath}.tmp`
  fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8')
  fs.renameSync(tempPath, registryPath)
  return registryPath
}

function videoToRegistryEntry(video: BilibiliVideoMetadata, existing: VideoRegistryEntry | undefined, nowIso: string): VideoRegistryEntry {
  const pubdate = Number(video.pubdate ?? existing?.pubdate ?? 0) || 0
  return {
    title: sanitizeText(video.title, existing?.title || video.bvid),
    bvid: sanitizeText(video.bvid, existing?.bvid || ''),
    aid: sanitizeText(video.aid, existing?.aid || ''),
    author_mid: sanitizeText(video.authorMid, existing?.author_mid || ''),
    author_name: sanitizeText(video.authorName, existing?.author_name || ''),
    pic: sanitizeText(video.pic, existing?.pic || ''),
    description: sanitizeText(video.description, existing?.description || ''),
    published_time: parseIsoFromPubdate(pubdate) || existing?.published_time || '',
    pubdate,
    duration: sanitizeText(video.durationText, existing?.duration || ''),
    duration_seconds: Number(video.durationSeconds ?? existing?.duration_seconds ?? 0) || 0,
    stat_view: Number(video.statView ?? existing?.stat_view ?? 0) || 0,
    url: sanitizeText(video.url, existing?.url || `https://www.bilibili.com/video/${video.bvid}`),
    status: existing?.status ?? 'fetched',
    last_seen: nowIso,
    cached: true,
  }
}

export function mergeVideosIntoRegistry(options: {
  registryRoot: string
  upId: string
  videos: BilibiliVideoMetadata[]
  now?: Date
}) {
  const nowIso = (options.now ?? new Date()).toISOString()
  const document = readVideoRegistry(options.registryRoot, options.upId)
  for (const video of options.videos) {
    if (!video.bvid) continue
    document.videos[video.bvid] = videoToRegistryEntry(video, document.videos[video.bvid], nowIso)
  }
  document.last_sync = nowIso
  writeVideoRegistry(options.registryRoot, document)
  return document
}

export function registryEntryToBilibiliVideo(entry: VideoRegistryEntry): BilibiliVideoMetadata {
  return {
    bvid: entry.bvid,
    aid: entry.aid,
    title: entry.title,
    authorMid: entry.author_mid,
    authorName: entry.author_name,
    pic: entry.pic,
    description: entry.description,
    durationText: entry.duration,
    durationSeconds: entry.duration_seconds,
    pubdate: entry.pubdate,
    statView: entry.stat_view,
    url: entry.url,
  }
}

export function listRegistryVideos(registryRoot: string, upId: string) {
  const document = readVideoRegistry(registryRoot, upId)
  return Object.values(document.videos)
    .sort((left, right) =>
      (right.pubdate || 0) - (left.pubdate || 0) ||
      Date.parse(right.last_seen || '') - Date.parse(left.last_seen || '') ||
      right.bvid.localeCompare(left.bvid),
    )
    .map(registryEntryToBilibiliVideo)
}

export function resolveVideoRegistryRoot(dataRoot: string) {
  return path.join(dataRoot, 'registry')
}

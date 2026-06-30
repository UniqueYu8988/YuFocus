import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  listRegistryVideos,
  mergeVideosIntoRegistry,
  readVideoRegistry,
  resolveVideoRegistryRoot,
} from '../electron/services/videoRegistry.ts'
import { createRuntimePaths } from '../electron/runtime/runtimePaths.ts'

const readDesktop = (relativePath) => fs.readFileSync(path.resolve(import.meta.dirname, '..', relativePath), 'utf-8')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-video-registry-'))
const registryRoot = resolveVideoRegistryRoot(tempRoot)
assert.equal(registryRoot, path.join(tempRoot, 'registry'), 'registry resolver 必须接收已经确定的标准数据根。')

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-runtime-paths-'))
const projectRoot = path.join(runtimeRoot, 'project')
fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'desktop'), { recursive: true })
for (const relativePath of ['AGENTS.md', 'PRODUCT.md', 'ARCHITECTURE.md', path.join('src', 'distiller.py'), path.join('desktop', 'package.json')]) {
  fs.writeFileSync(path.join(projectRoot, relativePath), '', 'utf-8')
}
const runtimePaths = createRuntimePaths({
  isPackaged: false,
  userDataRoot: path.join(runtimeRoot, 'user-data'),
  resourcesPath: runtimeRoot,
  execPath: path.join(projectRoot, 'desktop', 'node.exe'),
  cwd: projectRoot,
  moduleDir: path.join(projectRoot, 'desktop', 'electron'),
})
assert.equal(runtimePaths.canonicalDataRoot, path.join(projectRoot, 'data'), '开发运行时标准数据根必须是项目 data 目录。')
assert.equal(resolveVideoRegistryRoot(runtimePaths.canonicalDataRoot), path.join(projectRoot, 'data', 'registry'))

function makeVideo(patch = {}) {
  const bvid = patch.bvid ?? 'BVregistry001'
  return {
    bvid,
    aid: patch.aid ?? '100',
    title: patch.title ?? `视频 ${bvid}`,
    authorMid: patch.authorMid ?? 'up_100',
    authorName: patch.authorName ?? '稳定 UP',
    pic: patch.pic ?? '',
    description: patch.description ?? '',
    durationText: patch.durationText ?? '01:00',
    durationSeconds: patch.durationSeconds ?? 60,
    pubdate: patch.pubdate ?? 1_700_000_000,
    statView: patch.statView ?? 1,
    url: patch.url ?? `https://www.bilibili.com/video/${bvid}`,
  }
}

try {
  mergeVideosIntoRegistry({
    registryRoot,
    upId: 'up_100',
    videos: [
      makeVideo({ bvid: 'BVold001', title: '历史视频', pubdate: 1_600_000_000 }),
      makeVideo({ bvid: 'BVnew001', title: '新视频', pubdate: 1_700_000_000 }),
    ],
    now: new Date('2026-06-16T00:00:00.000Z'),
  })

  mergeVideosIntoRegistry({
    registryRoot,
    upId: 'up_100',
    videos: [
      makeVideo({ bvid: 'BVnew001', title: '新视频标题更新', pubdate: 1_700_000_000, statView: 8 }),
    ],
    now: new Date('2026-06-16T01:00:00.000Z'),
  })

  const registry = readVideoRegistry(registryRoot, 'up_100')
  assert.equal(registry.up_id, 'up_100')
  assert.equal(Object.keys(registry.videos).length, 2, '刷新缺少历史视频时不能删除 registry 旧条目。')
  assert.equal(registry.videos.BVnew001.title, '新视频标题更新', '刷新应合并更新已有视频元数据。')
  assert.equal(registry.videos.BVold001.title, '历史视频', 'API 未返回的历史视频必须保留。')
  assert.equal(registry.videos.BVnew001.status, 'fetched', '新视频默认状态应为 fetched。')
  assert.equal(registry.videos.BVnew001.cached, true, 'registry 条目必须标记 cached。')

  registry.videos.BVold001.status = 'done'
  fs.writeFileSync(path.join(registryRoot, 'up_100.json'), `${JSON.stringify(registry, null, 2)}\n`, 'utf-8')
  mergeVideosIntoRegistry({
    registryRoot,
    upId: 'up_100',
    videos: [
      makeVideo({ bvid: 'BVold001', title: '历史视频再次出现', pubdate: 1_600_000_000 }),
    ],
    now: new Date('2026-06-16T02:00:00.000Z'),
  })
  assert.equal(readVideoRegistry(registryRoot, 'up_100').videos.BVold001.status, 'done', '合并元数据不能覆盖本地处理状态。')

  const listed = listRegistryVideos(registryRoot, 'up_100')
  assert.deepEqual(listed.map((video) => video.bvid), ['BVnew001', 'BVold001'], 'UI 应从 registry 读取稳定且去重后的视频列表。')
  assert.equal(new Set(listed.map((video) => video.bvid)).size, listed.length, 'registry 不能产生重复 bvid。')
  assert.equal(listed[0].bvid, 'BVnew001', 'registry 列表应按发布时间优先排序。')

  const apiFailureFallback = listRegistryVideos(registryRoot, 'up_100')
  assert.equal(apiFailureFallback.length, 2, 'API 失败时仍应可以从 registry 读取历史视频。')
  assert.equal(apiFailureFallback[0].bvid, 'BVnew001', 'API 失败不应影响稳定视频身份。')

  const sourceDiscovery = readDesktop('electron/providers/sourceDiscovery.ts')
  const sourceIpcHandlers = readDesktop('electron/ipc/sourceIpcHandlers.ts')
  const sourceDiscoveryRuntime = readDesktop('electron/providers/sourceDiscoveryRuntime.ts')
  const mainProcess = readDesktop('electron/main.ts')

  assert.match(sourceDiscovery, /listRegisteredBilibiliSourceVideos/, '来源视频读取必须通过 registry 包装函数。')
  assert.match(sourceDiscovery, /mergeVideosIntoRegistry/, 'API 结果必须合并进入 registry。')
  assert.match(sourceDiscovery, /readRegisteredBilibiliSourceVideos/, '本地读取和 API 失败时必须能回退读取 registry。')
  assert.match(sourceIpcHandlers, /listRegisteredBilibiliSourceVideos/, 'UI IPC 必须读取 registry 合并后的来源视频。')
  assert.match(sourceIpcHandlers, /registryRoot/, 'UI IPC 必须接收已经解析好的标准 registry 根。')
  assert.match(sourceDiscoveryRuntime, /registryRoot/, '后台发现必须接收 registry 根。')
  assert.match(mainProcess, /resolveVideoRegistryRoot\(canonicalDataRoot\)/, '主进程必须把 registry 根绑定到标准 data/registry。')

  console.log('video registry layer check passed')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
  fs.rmSync(runtimeRoot, { recursive: true, force: true })
}

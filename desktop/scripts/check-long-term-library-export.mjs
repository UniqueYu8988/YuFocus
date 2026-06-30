import assert from 'node:assert/strict'
import fs, { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')

function readSource(relativePath) {
  return fs.readFileSync(path.join(desktopRoot, relativePath), 'utf-8')
}

async function importLibraryExportServiceForCheck() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'shijie-library-export-module-'))
  const serviceRoot = path.join(desktopRoot, 'electron', 'services')
  const serviceSource = readFileSync(path.join(serviceRoot, 'libraryExportService.ts'), 'utf-8')
    .replace("from './pathSafety'", "from './pathSafety.ts'")
  writeFileSync(path.join(tempDir, 'libraryExportService.ts'), serviceSource, 'utf-8')
  copyFileSync(path.join(serviceRoot, 'pathSafety.ts'), path.join(tempDir, 'pathSafety.ts'))
  const module = await import(pathToFileURL(path.join(tempDir, 'libraryExportService.ts')).href)
  rmSync(tempDir, { recursive: true, force: true })
  return module
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

function createQueueItem(overrides = {}) {
  return {
    queueId: 'queue-library-export',
    bvid: 'BV1LongTerm0001',
    aid: '',
    title: '标题含非法字符: <> / \\ | ? * 但应该保留主要文字',
    authorMid: '123456',
    authorName: '测试/UP:长期资料',
    sourceName: '测试/UP:长期资料',
    pic: '',
    description: '',
    durationText: '10:00',
    durationSeconds: 600,
    pubdate: 1782734400,
    statView: 0,
    url: 'https://www.bilibili.com/video/BV1LongTerm0001',
    queueSource: 'fresh',
    editorialMode: 'off',
    pipelineMode: 'subtitle_only',
    status: 'done',
    ...overrides,
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-library-export-'))
const materialPath = path.join(tmpRoot, 'materials', '123456', 'bv1longterm0001')
const libraryRoot = path.join(tmpRoot, 'library')
const { syncMaterialToLibrary } = await importLibraryExportServiceForCheck()

writeJson(path.join(materialPath, 'manifest.json'), {
  source: {
    source_type: 'bilibili',
    source_id: 'BV1LongTerm0001',
    title: '备用标题',
    creator: '备用 UP',
    url: 'https://www.bilibili.com/video/BV1LongTerm0001',
  },
})
writeText(path.join(materialPath, 'exports', 'notebooklm.md'), '# NotebookLM\n\n这是一份长期清洗稿。')
writeText(path.join(materialPath, 'delivery', 'email.md'), '# 视频更新\n\n这是一份邮件稿。')
writeText(path.join(materialPath, 'raw_transcript.txt'), '原始字幕必须仍然存在。')

const queueItem = createQueueItem()
const result = syncMaterialToLibrary({
  libraryRoot,
  materialPath,
  queueItem,
  now: () => 1782840000000,
})

assert.equal(result.status, 'ok')
assert.ok(result.notebooklmPath.endsWith('.md'))
assert.ok(result.emailPath.endsWith('.md'))
assert.ok(fs.existsSync(result.notebooklmPath), 'NotebookLM 成品文件应存在。')
assert.ok(fs.existsSync(result.emailPath), '邮件稿成品文件应存在。')
assert.match(result.notebooklmPath, /notebooklm/u)
assert.match(result.emailPath, /email/u)
assert.equal(path.basename(result.notebooklmPath), '标题含非法字符 但应该保留主要文字.md')
assert.doesNotMatch(path.basename(result.notebooklmPath), /^2026-06-29 /u)
assert.doesNotMatch(path.basename(result.notebooklmPath), /\[BV1LongTerm0001\]\.md$/u)
assert.doesNotMatch(path.basename(result.notebooklmPath), /[<>:"/\\|?*]/u)
assert.equal(fs.existsSync(path.join(materialPath, 'raw_transcript.txt')), true, '第一阶段不得删除原始字幕。')
assert.equal(fs.readFileSync(result.notebooklmPath, 'utf-8'), '# NotebookLM\n\n这是一份长期清洗稿。')
assert.equal(fs.readFileSync(result.emailPath, 'utf-8'), '# 视频更新\n\n这是一份邮件稿。')

const notebooklmMtime = fs.statSync(result.notebooklmPath).mtimeMs
assert.ok(Math.abs(notebooklmMtime - queueItem.pubdate * 1000) < 2000, '成品文件修改时间应接近视频发布日期。')

const indexPath = path.join(libraryRoot, 'index.json')
const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
assert.equal(index.version, 1)
assert.equal(index.items.length, 1)
assert.equal(index.items[0].bvid, 'BV1LongTerm0001')
assert.equal(index.items[0].sourceName, '测试/UP:长期资料')
assert.equal(index.items[0].notebooklmPath, result.notebooklmPath)
assert.equal(index.items[0].emailPath, result.emailPath)
assert.equal(index.items[0].publishedAt, new Date(queueItem.pubdate * 1000).toISOString())

const duplicateResult = syncMaterialToLibrary({
  libraryRoot,
  materialPath,
  queueItem: createQueueItem({ title: '同一 BV 的新标题' }),
  now: () => 1782840001000,
})
assert.equal(duplicateResult.status, 'ok')
const dedupedIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
assert.equal(dedupedIndex.items.length, 1, '同一 BV 只能保留一条长期索引。')
assert.equal(dedupedIndex.items[0].title, '同一 BV 的新标题')
assert.equal(path.basename(dedupedIndex.items[0].notebooklmPath), '同一 BV 的新标题.md')

const collisionMaterialPath = path.join(tmpRoot, 'materials', '123456', 'bv1longterm0002')
writeJson(path.join(collisionMaterialPath, 'manifest.json'), {
  source: {
    source_type: 'bilibili',
    source_id: 'BV1LongTerm0002',
    title: '同一 BV 的新标题',
    creator: '测试/UP:长期资料',
  },
})
writeText(path.join(collisionMaterialPath, 'exports', 'notebooklm.md'), '# NotebookLM\n\n同标题第二份。')
const collisionResult = syncMaterialToLibrary({
  libraryRoot,
  materialPath: collisionMaterialPath,
  queueItem: createQueueItem({
    bvid: 'BV1LongTerm0002',
    title: '同一 BV 的新标题',
  }),
  now: () => 1782840002000,
})
assert.equal(collisionResult.status, 'ok')
assert.equal(path.basename(collisionResult.notebooklmPath), '同一 BV 的新标题 (2).md')
const collisionIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
assert.equal(collisionIndex.items.length, 2)

const serviceSource = readSource('electron/services/libraryExportService.ts')
const syncFunctionSource = serviceSource.slice(serviceSource.indexOf('export function syncMaterialToLibrary'))
assert.doesNotMatch(syncFunctionSource, /rmSync|unlinkSync|rmdirSync|deletePath|Remove-Item/u, '成品库同步函数不能删除原材料。')
assert.match(serviceSource, /removeLibraryExportItem/, '成品库服务应提供显式删除单条成品的入口。')

const queueExecutorSource = readSource('electron/queue/queueExecutor.ts')
assert.match(queueExecutorSource, /syncMaterialLibrary/)
assert.match(queueExecutorSource, /trySyncMaterialLibrary/)
assert.match(queueExecutorSource, /trySlimMaterialPackage/)

const migrationSource = readSource('scripts/migrate-materials-to-library.mjs')
assert.match(migrationSource, /syncMaterialToLibrary/)
assert.doesNotMatch(migrationSource, /rmSync|unlinkSync|rmdirSync|Remove-Item/u, '迁移脚本不能删除原材料。')

console.log('long-term library export check passed')

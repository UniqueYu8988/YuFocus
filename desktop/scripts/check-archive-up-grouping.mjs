import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const groupingSource = fs.readFileSync(path.join(desktopRoot, 'src/ui/pages/archiveGrouping.ts'), 'utf-8')
const archivePaneSource = fs.readFileSync(path.join(desktopRoot, 'src/ui/panels/workspace/ArchivePaneParts.tsx'), 'utf-8')
const workspacePaneSource = fs.readFileSync(path.join(desktopRoot, 'src/ui/pages/WorkspacePane.tsx'), 'utf-8')

assert.match(groupingSource, /export function buildArchiveCreatorGroups/, '必须提供档案 UP 主分组纯函数。')
assert.match(groupingSource, /ARCHIVE_ALL_GROUP_ID/, '必须保留全部分组。')
assert.match(groupingSource, /ARCHIVE_MISC_GROUP_ID/, '必须保留拾遗分组。')
assert.doesNotMatch(groupingSource, /fs\.|window\.desktopAPI|ipcRenderer|fetch\(/, '档案分组函数必须保持只读纯内存，不访问文件系统或外部接口。')

const {
  ARCHIVE_ALL_GROUP_ID,
  ARCHIVE_MISC_GROUP_ID,
  buildArchiveCreatorGroups,
  findArchiveCreatorGroup,
} = await import('../src/ui/pages/archiveGrouping.ts')

const createRecord = (pathId, creator, updatedAt, extra = {}) => ({
  name: pathId,
  path: `C:/data/materials/${pathId}`,
  title: `${creator || '未知'} ${pathId}`,
  sourceId: extra.sourceId ?? pathId,
  sourceType: extra.sourceType ?? 'bilibili',
  sourceUrl: extra.sourceUrl ?? '',
  creator,
  textSourceType: 'subtitle',
  blockCount: 0,
  textLength: 100,
  byteSize: 10,
  rawTranscriptTextLength: 100,
  notebooklmTextLength: 90,
  editorialSummaryTextLength: 0,
  editorialSummaryHtmlBytes: 0,
  metricsPath: '',
  metricsExists: false,
  metricsElapsedSeconds: 0,
  metricsInputTokens: 0,
  metricsOutputTokens: 0,
  metricsTotalTokens: 0,
  emailPushedAt: 0,
  updatedAt,
  notebooklmPath: '',
  notebooklmExists: true,
  editorialSummaryStatus: '',
  editorialSummaryPath: '',
  editorialSummaryExists: false,
  editorialSummaryHtmlPath: '',
  editorialSummaryHtmlExists: false,
  editorialCardsPath: '',
  editorialCardsExists: false,
  editorialReviewPath: '',
  editorialReviewExists: false,
  rawTranscriptPath: '',
  rawTranscriptExists: true,
  sourceIndexPath: '',
  sourceIndexExists: false,
  handoffPath: '',
  handoffExists: false,
  runStatePath: '',
  runStateExists: false,
  handoffStatusPath: '',
  handoffStatusExists: false,
  workflowStage: 'content_ready',
  workflowStageLabel: '清洗完成',
  nextActionLabel: '',
  pipelineReady: true,
})

const pinnedSources = [
  { mid: '100', name: '张三', face: 'avatar-a', sign: '', officialTitle: '', pinnedAt: 1 },
  { mid: '200', name: '空来源', face: 'avatar-b', sign: '', officialTitle: '', pinnedAt: 2 },
]
const records = [
  createRecord('bv1', '张三', 1000),
  createRecord('bv2', '张三', 3000),
  createRecord('bv3', '李四', 2000),
  createRecord('local1', '', 1500, { sourceType: 'local', sourceId: '' }),
]

const groups = buildArchiveCreatorGroups({ records, pinnedSources })
const allGroup = findArchiveCreatorGroup(groups, ARCHIVE_ALL_GROUP_ID)
const pinnedGroup = groups.find((group) => group.id === 'pinned:100')
const emptyPinnedGroup = groups.find((group) => group.id === 'pinned:200')
const creatorGroup = groups.find((group) => group.kind === 'creator' && group.title === '李四')
const miscGroup = findArchiveCreatorGroup(groups, ARCHIVE_MISC_GROUP_ID)

assert.equal(allGroup?.count, 4, '全部分组必须包含所有资料。')
assert.equal(pinnedGroup?.count, 2, '同一固定 UP 的资料必须进入同一分组。')
assert.deepEqual(pinnedGroup?.records.map((record) => record.path), [
  'C:/data/materials/bv2',
  'C:/data/materials/bv1',
], 'UP 分组内资料必须按更新时间倒序。')
assert.equal(emptyPinnedGroup?.count, 0, '固定 UP 即使没有资料也必须显示为空分组。')
assert.equal(creatorGroup?.count, 1, '非固定但有明确 creator 的资料必须进入独立来源组。')
assert.equal(miscGroup?.count, 1, '无法归属到明确 UP 的资料必须进入拾遗。')
assert.match(archivePaneSource, /ArchiveCreatorGroup/, '档案 UI 应接收 UP 主分组模型。')
assert.match(archivePaneSource, />UP 主</, '档案 UI 应保留 UP 主分组入口。')
assert.match(archivePaneSource, /data-archive-vertical-avatar-layout="true"/, '档案页必须改为上下结构。')
assert.match(archivePaneSource, /data-archive-avatar-strip="true"/, '档案页上方必须提供横向头像选择条。')
assert.match(archivePaneSource, /data-archive-avatar-with-count="true"/, '档案页 UP 头像必须带数量角标。')
assert.match(archivePaneSource, /aria-label=\{`\$\{group\.title\} 视频数量 \$\{count\}`\}/, '头像角标必须能表达对应视频数量。')
assert.doesNotMatch(archivePaneSource, /lg:grid-cols-\[240px_minmax\(0,1fr\)\]/, '档案页不能回退到左右双栏结构。')
assert.match(archivePaneSource, /record\.sourceId/, '档案 UI 资料记录应使用 BV 或来源 ID 表达视频层。')
assert.match(archivePaneSource, /backdrop-blur-md/, '头像数量角标应使用半透明毛玻璃效果。')
assert.match(archivePaneSource, /label: '总字数'[\s\S]*label: '占用'[\s\S]*label: '耗时'[\s\S]*label: 'Token'/, '档案顶部统计应只保留核心四项。')
assert.doesNotMatch(archivePaneSource, />\s*原字\s*</, '档案记录不应回退显示“原字”文件状态标签。')
assert.doesNotMatch(archivePaneSource, />\s*清洗\s*</, '档案记录不应回退显示“清洗”文件状态标签。')
assert.doesNotMatch(archivePaneSource, />\s*文稿\s*</, '档案记录不应回退显示“文稿”文件状态标签。')
assert.doesNotMatch(archivePaneSource, />\s*HTML\s*</, '档案记录不应回退显示“HTML”文件状态标签。')
assert.doesNotMatch(archivePaneSource, />\s*长稿\s*</, '档案记录不应回退显示“长稿”标签。')
assert.match(archivePaneSource, /aria-label="打开"/, '档案视频资料卡片必须保留打开入口。')
assert.match(archivePaneSource, /aria-label="复制路径"/, '档案视频资料卡片必须保留复制 NotebookLM 路径入口。')
assert.match(archivePaneSource, /aria-label="定位"/, '档案视频资料卡片必须保留定位资料入口。')
assert.match(workspacePaneSource, /view !== 'workbench' && view !== 'settings' && view !== 'knowledge' && view !== 'archive'/, '进入档案页时必须只读加载材料清单。')
assert.match(workspacePaneSource, /title="档案"/, '档案页面标题必须是“档案”。')
assert.match(workspacePaneSource, /按 UP 主查看已生成的字幕清洗资料和 NotebookLM 导入稿。/, '档案页面描述必须体现 UP 主结构。')

console.log('archive up grouping check passed')

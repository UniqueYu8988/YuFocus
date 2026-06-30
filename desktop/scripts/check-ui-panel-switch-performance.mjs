import assert from 'node:assert/strict'
import fs from 'node:fs'

const appSource = fs.readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf-8')
const homeSource = fs.readFileSync(new URL('../src/ui/pages/HomePane.tsx', import.meta.url), 'utf-8')

assert.match(
  appSource,
  /workspaceView\s*===\s*['"]home['"]\s*\?\s*\(/u,
  'App 应只挂载当前主面板，避免隐藏的大面板继续参与计算和拖慢滚动。',
)
assert.doesNotMatch(appSource, /lastWorkspaceView/u, '不应保留隐藏工作区的常驻状态方案。')
assert.doesNotMatch(appSource, /workspaceView !== 'home' && 'hidden'/u, '首页不应通过 hidden 常驻隐藏。')
assert.doesNotMatch(appSource, /workspaceView === 'home' && 'hidden'/u, '工作区不应通过 hidden 常驻隐藏。')
assert.match(homeSource, /homePaneSnapshotCache/u, 'HomePane 必须使用内存快照缓存，避免切回最近时空白重载。')
assert.match(homeSource, /useState<PinnedSource\[\]>\(\(\) => homePaneSnapshotCache\?\.pinnedSources/u, '固定 UP 来源必须从首页缓存恢复。')
assert.match(homeSource, /useState\(\(\) => !homePaneSnapshotCache\)/u, '有首页缓存时不应显示初始 loading。')
assert.match(homeSource, /if \(homePaneSnapshotCache\)[\s\S]*setLoading\(false\)[\s\S]*return/u, '有首页缓存时不应重新读取完整本地快照。')

const loadLocalSnapshotMatch = homeSource.match(/const loadLocalSnapshot = useCallback\([\s\S]*?\n  \}, \[(.*?)\]\)/u)
assert.ok(loadLocalSnapshotMatch, '必须能定位 HomePane 的 loadLocalSnapshot useCallback。')
assert.doesNotMatch(
  loadLocalSnapshotMatch[1],
  /activeSourceId/u,
  '切换侧边栏 UP 来源不应触发首页完整本地快照重载。',
)
assert.match(
  homeSource,
  /if \(!activeSourceId \|\| pinnedSources\.length === 0\) return/u,
  '首页应单独校验 activeSourceId 是否仍属于固定来源。',
)

console.log('ui panel switch performance check passed')

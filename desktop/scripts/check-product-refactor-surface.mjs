import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8')

const app = read('src/ui/App.tsx')
const sidebar = read('src/ui/panels/SourceSidebarPane.tsx')
const workspace = read('src/ui/pages/WorkspacePane.tsx')
const queueParts = read('src/ui/panels/workspace/WorkbenchQueueParts.tsx')
const settingsPane = read('src/ui/panels/workspace/SettingsPaneParts.tsx')
const queueExecutor = read('electron/queue/queueExecutor.ts')

assert.match(app, /useState<WorkspaceView>\('home'\)/, '应用默认入口必须是最近页。')
assert.doesNotMatch(app, /正在恢复专注页/, '启动提示不能再把专注页作为默认心智。')

assert.match(sidebar, /title="最近"/, '侧边栏必须暴露最近入口。')
assert.match(sidebar, /视频来源/, '侧边栏必须暴露视频来源列表。')
assert.match(sidebar, /title="队列"/, '侧边栏必须暴露队列入口。')
assert.match(sidebar, /title="档案"/, '侧边栏必须暴露档案入口。')
assert.doesNotMatch(sidebar, /title="专注"/, '侧边栏不应再暴露专注作为主入口。')
assert.doesNotMatch(sidebar, /title="灵犀"/, '侧边栏不应再暴露灵犀作为主入口。')

assert.match(workspace, /title="队列"/, '工作台标题应反映队列。')
assert.doesNotMatch(workspace, /<WorkbenchPaneContent/, '队列页不应再渲染视频来源选择板块。')
assert.match(workspace, /title="档案"/, '档案页标题应反映档案。')

assert.doesNotMatch(queueParts, /onBuildSummary/, '队列 UI 不应暴露手动 summary 构建回调。')
assert.doesNotMatch(queueParts, /制作文稿|正在制作文稿/, '队列 UI 不应暴露制作文稿按钮。')

assert.doesNotMatch(settingsPane, /<AutomationEmailSettingsBlock/, '设置页不应渲染邮件系统。')
assert.doesNotMatch(settingsPane, /<TtsSettingsBlock/, '设置页不应渲染 TTS 系统。')
assert.doesNotMatch(settingsPane, /<ObsidianSettingsBlock/, '设置页不应渲染非 NotebookLM 输出系统。')

assert.match(queueExecutor, /const isSubtitleOnly = pipelineMode === 'subtitle_only'/, '队列执行器必须显式识别 subtitle_only。')
assert.match(queueExecutor, /const effectiveEditorialMode: EditorialSummaryMode = isSubtitleOnly \? 'off' : editorialMode/, 'subtitle_only 必须强制关闭编稿模式。')
assert.match(queueExecutor, /if \(!isSubtitleOnly && effectiveEditorialMode !== 'off'\) \{[\s\S]*deps\.runMaterialSummary/, 'summary 分支必须被 !isSubtitleOnly 守卫。')
assert.match(queueExecutor, /deps\.updateQueueItem\(target\.queueId, \{[\s\S]*status: 'done'[\s\S]*materialPath/, 'subtitle_only 资料生成后必须能直接标记队列完成。')

console.log('product refactor surface check passed')

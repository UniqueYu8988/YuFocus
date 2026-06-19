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

assert.match(app, /useState<WorkspaceView>\('workbench'\)/, '应用默认入口必须是字幕流水线工作台。')
assert.doesNotMatch(app, /正在恢复专注页/, '启动提示不能再把专注页作为默认心智。')

assert.match(sidebar, /title="字幕流水线"/, '侧边栏必须暴露字幕流水线主入口。')
assert.match(sidebar, /title="输出"/, '侧边栏必须暴露 NotebookLM 输出入口。')
assert.doesNotMatch(sidebar, /title="专注"/, '侧边栏不应再暴露专注作为主入口。')
assert.doesNotMatch(sidebar, /title="档案"/, '侧边栏不应再暴露档案作为主入口。')
assert.doesNotMatch(sidebar, /title="灵犀"/, '侧边栏不应再暴露灵犀作为主入口。')

assert.match(workspace, /title="字幕流水线"/, '工作台标题应反映字幕流水线。')
assert.match(workspace, /title="NotebookLM 输出"/, '输出页标题应反映 NotebookLM 输出。')

assert.doesNotMatch(queueParts, /onBuildSummary/, '队列 UI 不应暴露手动 summary 构建回调。')
assert.doesNotMatch(queueParts, /制作文稿|正在制作文稿/, '队列 UI 不应暴露制作文稿按钮。')

assert.doesNotMatch(settingsPane, /<AutomationEmailSettingsBlock/, '设置页不应渲染邮件系统。')
assert.doesNotMatch(settingsPane, /<TtsSettingsBlock/, '设置页不应渲染 TTS 系统。')
assert.doesNotMatch(settingsPane, /<ObsidianSettingsBlock/, '设置页不应渲染非 NotebookLM 输出系统。')

assert.match(queueExecutor, /const isSubtitleOnly = pipelineMode === 'subtitle_only'/, '队列执行器必须显式识别 subtitle_only。')
assert.match(queueExecutor, /if \(isSubtitleOnly\) \{[\s\S]*status: 'done'[\s\S]*continue[\s\S]*\}/, 'subtitle_only 必须在资料生成后直接完成并跳过后续分支。')

console.log('product refactor surface check passed')

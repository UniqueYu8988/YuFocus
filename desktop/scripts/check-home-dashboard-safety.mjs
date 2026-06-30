import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(desktopRoot, relativePath), 'utf-8')

const app = read('src/ui/App.tsx')
const home = read('src/ui/pages/HomePane.tsx')
const sidebar = read('src/ui/panels/SourceSidebarPane.tsx')
const sourceDiscovery = read('electron/providers/sourceDiscovery.ts')
const sourceIpc = read('electron/ipc/sourceIpcHandlers.ts')
const preload = read('electron/preload.ts')

assert.match(app, /useState<WorkspaceView>\('home'\)/, '桌面端必须默认进入最近页。')
assert.match(app, /workspaceView === 'home'[\s\S]*<HomePane/, '最近页必须独立渲染，不挂载工作台业务组件。')
assert.match(home, /homePaneSnapshotCache/, '最近页必须用内存缓存减少切回时的重复加载。')
assert.match(sidebar, /title="最近"/, '侧边栏必须提供最近入口。')
assert.match(sidebar, /视频来源/, '侧边栏必须承载视频来源列表。')
assert.match(sidebar, /onSelectBilibiliSource\(source\.mid\)/, '侧边栏点击 UP 后必须切换右侧视频列表。')

assert.match(home, /listRegisteredBilibiliSourceVideos/, '最近页首次加载必须读取本地 registry。')
assert.match(home, /handleRefreshData[\s\S]*listBilibiliSourceVideos/, '最近页手动更新必须只调用视频元数据刷新接口。')
assert.match(home, /不会下载或转写/, '最近页必须向用户明确数据更新边界。')
assert.match(home, /sourceFace: sourceFaces\.get\(source\.mid\)/, '最近页最近视频必须把固定来源头像映射到视频。')
assert.match(home, /onError=\{\(\) => setFailed\(true\)\}/, '最近页头像加载失败时必须有兜底。')
assert.doesNotMatch(home, /recentVideos\.filter\(\(video\) => video\.sourceMid === activeSourceId\)/, '最近页最近视频不能被 UP 选择筛选。')
assert.match(home, /sourceVideosForActiveSource/, '最近页必须能按侧边栏选择显示 UP 视频。')
assert.doesNotMatch(home, /<Dialog/, '最近页不应再承载固定 UP 管理弹窗。')
assert.match(sidebar, /管理固定 UP/, '侧边栏必须提供固定 UP 弹窗管理入口。')
assert.match(sidebar, /savePinnedBilibiliSources/, '侧边栏固定 UP 弹窗必须能保存固定来源。')
assert.match(sidebar, /loadTrackedBilibiliSources/, '侧边栏必须读取 UP 追踪账本，用于历史补足优先级排序。')
assert.match(sidebar, /saveTrackedBilibiliSources/, '侧边栏必须把 UP 优先级保存到 tracking 账本。')
assert.match(sidebar, /orderedPinnedBilibiliSources/, '侧边栏固定 UP 展示必须使用 tracking priority 排序后的列表。')
assert.match(sidebar, /handleMovePinnedSource/, '侧边栏必须提供调整 UP 优先级的入口。')
assert.match(sidebar, /提高 \$\{source\.name\} 的历史补足优先级/, '侧边栏必须提供提高 UP 历史补足优先级的按钮。')
assert.match(sidebar, /降低 \$\{source\.name\} 的历史补足优先级/, '侧边栏必须提供降低 UP 历史补足优先级的按钮。')
assert.match(home, /handleAddSelectedVideosToQueue[\s\S]*saveWorkbenchQueue/, '最近页必须通过按钮把选中视频加入任务队列。')
assert.doesNotMatch(home, /首页数据概览/, '最近页顶部不应再显示统计卡片区。')
assert.doesNotMatch(home, /进入任务队列/, '最近页右上角不应再显示进入任务队列文字按钮。')
assert.doesNotMatch(home, />\s*更新数据\s*</, '最近页右上角不应再显示更新数据文字按钮。')
assert.doesNotMatch(home, /仅元数据/, '最近页不应再显示“仅元数据”标签。')
assert.doesNotMatch(home, /actions=\{\(/, '最近页刷新和暂停图标不应继续放在页面顶部操作区。')
assert.match(home, /getVideoStatusMeta/, '最近页视频状态必须使用统一映射函数。')
for (const statusLabel of ['未入队', '排队中', '制作中', '已完成', '已跳过', '失败']) {
  assert.match(home, new RegExp(`label: '${statusLabel}'`), `最近页必须提供状态：${statusLabel}。`)
}
assert.match(home, /className:\s*'border-sky-400\/24/, '最近页制作中状态必须有蓝色展示。')
assert.match(home, /className:\s*'border-amber-300\/24/, '最近页排队中状态必须有琥珀色展示。')
assert.match(home, /getAutomationStatus/, '最近页必须读取自动同步状态。')
assert.match(home, /onAutomationStatus/, '最近页必须订阅自动同步状态变化。')
assert.match(home, /data-automation-live-status="true"/, '最近页必须显示极简实时同步状态。')
assert.match(home, /processingQueueItem/, '最近页实时状态必须优先提示当前正在处理的视频。')
assert.match(home, /正在处理：/, '最近页必须用简单文案提示当前正在处理的任务。')
assert.match(home, /后台待处理：\$\{queuedCount\} 条/, '最近页必须提示等待处理的队列数量。')
assert.match(home, /后台运行 · 下次检查/, '最近页必须提示后台自动检查仍在运行。')
assert.match(home, /同步异常：/, '最近页必须提示最近一次后台同步异常。')
assert.match(home, /setAutomationPaused\(\{\s*paused:\s*true,\s*durationMs\s*\}\)/, '最近页必须能按时长暂停同步。')
assert.match(home, /2 \* 60 \* 60 \* 1000/, '最近页必须提供暂停 2 小时。')
assert.match(home, /5 \* 60 \* 60 \* 1000/, '最近页必须提供暂停 5 小时。')
assert.match(home, /暂停到手动恢复/, '最近页必须提供暂停到手动恢复。')
assert.match(home, /setAutomationPaused\(\{\s*paused:\s*false\s*\}\)/, '最近页必须提供恢复同步。')
assert.match(
  home,
  /createWorkbenchQueueItem\(video,\s*'queued',\s*\{[\s\S]*editorialMode:\s*'off'[\s\S]*pipelineMode:\s*'subtitle_only'/,
  '最近页加入队列必须显式使用 subtitle_only 且关闭 editorial。',
)

for (const forbidden of [
  'runDistillation',
  'runAutomationCheckNow',
  'clearWorkbenchQueue',
  'deleteMaterialPackage',
  'distillCourseFromVideo',
]) {
  assert.doesNotMatch(home, new RegExp(forbidden), `最近页不能调用高风险入口：${forbidden}`)
}

const readOnlyRegistryFunction = sourceDiscovery.match(
  /export function readRegisteredBilibiliSourceVideos[\s\S]*?\n}\n\nexport async function listRegisteredBilibiliSourceVideos/,
)?.[0] ?? ''
assert.ok(readOnlyRegistryFunction, '必须存在独立的本地 registry 读取函数。')
assert.doesNotMatch(readOnlyRegistryFunction, /listBilibiliSourceVideos\(/, '本地最近页读取不能调用 B 站 API。')
assert.doesNotMatch(readOnlyRegistryFunction, /mergeVideosIntoRegistry\(/, '本地最近页读取不能改写 registry。')

assert.match(sourceIpc, /sources:bilibili:registered-videos/, '主进程必须暴露本地 registry 只读 IPC。')
assert.match(preload, /listRegisteredBilibiliSourceVideos/, 'preload 必须暴露本地 registry 只读接口。')

console.log('home dashboard safety check passed')

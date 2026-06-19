import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(__dirname, '..')
const projectRoot = path.resolve(desktopRoot, '..')

const readDesktop = (relativePath) => fs.readFileSync(path.join(desktopRoot, relativePath), 'utf8')
const readProject = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')

const runtimePaths = readDesktop('electron/runtime/runtimePaths.ts')
const backendRuntime = readDesktop('electron/runtime/backendRuntime.ts')
const materialInventory = readDesktop('electron/services/materialInventory.ts')
const knowledgeLibrary = readDesktop('electron/services/knowledgeLibrary.ts')
const videoRegistry = readDesktop('electron/services/videoRegistry.ts')
const sourceDiscovery = readDesktop('electron/providers/sourceDiscovery.ts')
const configPy = readProject('src/config.py')
const distillerPy = readProject('src/distiller.py')
const audioFallbackPy = readProject('src/audio_fallback.py')

assert.match(runtimePaths, /path\.join\(devProjectRoot, 'data'\)/, 'Electron 默认输出根必须是 data。')
assert.match(runtimePaths, /'logs', 'runtime\.log'/, 'Electron 运行日志必须落到 data/logs/runtime.log。')
assert.match(runtimePaths, /legacyOutputRoots:\s*\[path\.join\(options\.devProjectRoot, 'output'\)\]/, '旧 output 设置必须单向迁移到 data。')
assert.doesNotMatch(runtimePaths, /path\.join\(devProjectRoot, 'output'\)/, '旧 output 根不应继续作为导入默认路径。')

assert.doesNotMatch(
  backendRuntime,
  /SHIJIE_FOCUS_OUTPUT_DIR:\s*materialOutputDir/,
  'Python 子进程不能收到 data/materials 作为输出根，否则 cache/temp 会混入材料目录。',
)

assert.match(configPy, /DEFAULT_OUTPUT_DIR = os\.path\.join\(PROJECT_ROOT, "data"\)/, 'Python 默认数据根必须是 data。')
assert.match(configPy, /def ensure_materials_dir\(\)/, 'Python 必须有 materials 子目录函数。')
assert.match(configPy, /def ensure_temp_dir\(\)/, 'Python 必须有 temp 子目录函数。')
assert.match(configPy, /def ensure_cache_dir\(\)/, 'Python 必须有 cache 子目录函数。')
assert.match(configPy, /def ensure_logs_dir\(\)/, 'Python 必须有 logs 子目录函数。')
assert.match(configPy, /def ensure_legacy_dir\(\)/, 'Python 必须有 legacy 子目录函数。')

assert.match(distillerPy, /_material_up_id\(video_info, source\)/, '资料包路径必须包含 up_id 层。')
assert.match(distillerPy, /_material_video_id\(video_info, source, bvid\)/, '资料包路径必须包含 video_id 层。')
assert.match(distillerPy, /return config\.ensure_cache_dir\(\)/, 'distiller 缓存必须写入 data/cache。')
assert.match(distillerPy, /cleaned_transcript\.txt/, '资料包必须写出 cleaned_transcript.txt。')
assert.match(distillerPy, /config\.ensure_temp_dir\(\),\s*"local_media"/, '本地媒体中间文件必须写入 data/temp/local_media。')

assert.match(audioFallbackPy, /config\.ensure_cache_dir\(\),\s*"audio_prepare"/, '音频转写缓存必须写入 data/cache/audio_prepare。')
assert.match(audioFallbackPy, /config\.ensure_temp_dir\(\),\s*"audio_prepare"/, '音频下载和切片临时文件必须写入 data/temp/audio_prepare。')

assert.match(materialInventory, /collectMaterialPackagePaths/, '材料扫描必须集中在标准材料目录。')
assert.match(materialInventory, /isMaterialPackageDirectory/, '材料扫描必须通过 manifest 和核心文件识别新目录。')
assert.doesNotMatch(materialInventory, /\.course_material/, '材料扫描不应继续包含旧 .course_material 兼容分支。')
assert.match(knowledgeLibrary, /'legacy', 'knowledge'/, '旧知识库新写入必须隔离到 data/legacy/knowledge。')
assert.match(runtimePaths, /canonicalDataRoot/, 'Electron 必须明确区分项目运行根和标准 data 根。')
assert.match(videoRegistry, /path\.join\(dataRoot, 'registry'\)/, '视频注册表必须在传入的标准 data 根下写入 registry。')
assert.match(sourceDiscovery, /mergeVideosIntoRegistry/, '来源视频刷新必须合并进 registry，而不是替换列表。')

console.log('data layer normalization check passed')

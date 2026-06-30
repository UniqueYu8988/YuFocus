import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const desktopRoot = path.resolve(import.meta.dirname, '..')

const files = {
  settings: fs.readFileSync(path.join(desktopRoot, 'electron/runtime/settings.ts'), 'utf-8'),
  backendRuntime: fs.readFileSync(path.join(desktopRoot, 'electron/runtime/backendRuntime.ts'), 'utf-8'),
  workspaceUtils: fs.readFileSync(path.join(desktopRoot, 'src/ui/pages/WorkspacePaneUtils.ts'), 'utf-8'),
  fallback: fs.readFileSync(path.join(desktopRoot, 'src/services/filesystem/desktopApiFallback.ts'), 'utf-8'),
}

assert.match(files.settings, /mimo_text_model:\s*'mimo-v2\.5'/, '运行设置默认 MiMo 文本模型必须是非 Pro。')
assert.match(files.settings, /normalized === 'mimo-v2\.5-pro'[\s\S]*return fallback/, '旧 Pro 设置必须自动降级。')
assert.match(files.backendRuntime, /configuredMimoTextModel === 'mimo-v2\.5-pro' \? 'mimo-v2\.5'/, '后台运行时必须防止旧 Pro 设置继续传给 Python。')
assert.match(files.backendRuntime, /'mimo-v2\.5'\s*\n\s*const mimoTtsEndpoint/, '后台运行时 MiMo 文本模型兜底必须是非 Pro。')
assert.match(files.workspaceUtils, /MIMO_TEXT_MODELS = \['mimo-v2\.5'\]/, '设置页候选模型应只展示非 Pro。')
assert.match(files.workspaceUtils, /runtimeSettings\?\.mimo_text_model === 'mimo-v2\.5-pro' \? 'mimo-v2\.5'/, '前端设置草稿应把旧 Pro 值显示为非 Pro。')
assert.match(files.fallback, /mimo_text_model:\s*'mimo-v2\.5'/, '浏览器 fallback 默认 MiMo 文本模型必须是非 Pro。')

for (const [name, source] of Object.entries(files)) {
  assert.doesNotMatch(source, /mimo_text_model:\s*'mimo-v2\.5-pro'/, `${name} 不应再默认使用 Pro 模型。`)
  assert.doesNotMatch(source, /\|\|\s*'mimo-v2\.5-pro'/, `${name} 不应再把 Pro 作为兜底模型。`)
}

console.log('mimo non-pro default check passed')

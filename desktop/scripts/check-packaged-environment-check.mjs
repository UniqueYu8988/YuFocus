import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const servicePath = path.join(repoRoot, 'desktop', 'electron', 'services', 'environmentCheckService.ts')
const ipcPath = path.join(repoRoot, 'desktop', 'electron', 'ipc', 'settingsAutomationIpcHandlers.ts')
const preloadPath = path.join(repoRoot, 'desktop', 'electron', 'preload.ts')
const settingsBlocksPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'panels', 'workspace', 'SettingsBlocks.tsx')
const workspacePanePath = path.join(repoRoot, 'desktop', 'src', 'ui', 'pages', 'WorkspacePane.tsx')

const serviceSource = fs.readFileSync(servicePath, 'utf-8')
const ipcSource = fs.readFileSync(ipcPath, 'utf-8')
const preloadSource = fs.readFileSync(preloadPath, 'utf-8')
const settingsBlocksSource = fs.readFileSync(settingsBlocksPath, 'utf-8')
const workspacePaneSource = fs.readFileSync(workspacePanePath, 'utf-8')

assert.match(ipcSource, /settings:environment-check/u)
assert.match(preloadSource, /runEnvironmentCheck/u)
assert.match(settingsBlocksSource, /运行环境自检/u)
assert.match(workspacePaneSource, /refreshEnvironmentCheck/u)

assert.match(serviceSource, /importlib\.util\.find_spec/u)
assert.doesNotMatch(serviceSource, /from local_audio_distiller import/u)
assert.doesNotMatch(serviceSource, /chat\/completions[\s\S]*fetch/u)
assert.doesNotMatch(serviceSource, /nodemailer|createTransport|sendMail/u)
assert.doesNotMatch(serviceSource, /detail:\s*settings\.(email_smtp_password|sessdata|mimo_api_key)/u)

const mod = await import('../electron/services/environmentCheckService.ts')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shijie-env-check-'))
const backendRoot = path.join(tmpRoot, 'src')
fs.mkdirSync(backendRoot, { recursive: true })
for (const fileName of ['distiller.py', 'config.py', 'bilibili_api.py', 'local_audio_client.py']) {
  fs.writeFileSync(path.join(backendRoot, fileName), '# test\n', 'utf-8')
}

const previousEndpoint = process.env.LOCAL_OLLAMA_ENDPOINT
process.env.LOCAL_OLLAMA_ENDPOINT = 'http://127.0.0.1:9/api/chat'

const secret = 'secret-value-should-not-appear'
const result = await mod.runEnvironmentCheck({
  devProjectRoot: tmpRoot,
  dataRoot: tmpRoot,
  canonicalDataRoot: path.join(tmpRoot, 'data'),
  userDataRoot: path.join(tmpRoot, 'user-data'),
  resourcesPath: path.join(tmpRoot, 'resources'),
  execPath: process.execPath,
  isPackaged: false,
  loadSettings: () => ({
    sessdata: secret,
    output_dir: path.join(tmpRoot, 'data'),
    obsidian_vault_path: '',
    obsidian_export_folder: '',
    obsidian_auto_sync: false,
    tts_provider: '',
    minimax_api_key: '',
    minimax_tts_endpoint: '',
    minimax_tts_model: '',
    minimax_tts_voice_id: '',
    minimax_tts_speed: 1,
    minimax_tts_volume: 1,
    minimax_tts_pitch: 0,
    mimo_api_key: secret,
    mimo_text_endpoint: '',
    mimo_text_model: 'mimo-v2.5',
    mimo_tts_endpoint: '',
    mimo_tts_model: '',
    mimo_tts_voice_id: '',
    mimo_tts_style_prompt: '',
    transcription_provider: 'local_sensevoice',
    local_transcription_root: '',
    local_transcription_python: '',
    local_transcription_model_id: 'iic/SenseVoiceSmall',
    local_transcription_device: 'cuda:0',
    local_transcription_language: 'zh',
    resource_mode: 'balanced',
    background_automation_enabled: true,
    background_check_interval_minutes: 60,
    email_push_enabled: true,
    email_smtp_host: 'smtp.example.com',
    email_smtp_port: 465,
    email_smtp_secure: true,
    email_smtp_user: 'sender@example.com',
    email_smtp_password: secret,
    email_from: 'sender@example.com',
    email_to: 'receiver@example.com',
    workbench_queue_concurrency: 1,
  }),
})

if (previousEndpoint === undefined) {
  delete process.env.LOCAL_OLLAMA_ENDPOINT
} else {
  process.env.LOCAL_OLLAMA_ENDPOINT = previousEndpoint
}

assert.equal(result.runtime.backendRoot, backendRoot)
assert.ok(result.items.find((item) => item.id === 'backend_scripts' && item.status === 'ok'))
assert.ok(result.items.find((item) => item.id === 'ollama'))
assert.doesNotMatch(JSON.stringify(result), new RegExp(secret, 'u'))
assert.doesNotMatch(JSON.stringify(result), /email_smtp_password|sessdata|mimo_api_key/u)

console.log('packaged environment check passed')

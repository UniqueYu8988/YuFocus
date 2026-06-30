$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $desktopRoot
$logDir = Join-Path $repoRoot 'data\logs'
$logPath = Join-Path $logDir 'dev-shortcut.log'

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content -LiteralPath $logPath -Value "[$timestamp] starting desktop dev app"

Set-Location -LiteralPath $desktopRoot
npm run dev *>> $logPath

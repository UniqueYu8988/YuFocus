$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'release'
$appName = '视界专注'
$packageJsonPath = Join-Path $projectRoot 'package.json'
$packageJsonRaw = [System.IO.File]::ReadAllText($packageJsonPath, [System.Text.Encoding]::UTF8)
$versionMatch = [regex]::Match($packageJsonRaw, '"version"\s*:\s*"(?<version>[^"]+)"')
$versionLabel = if ($versionMatch.Success) { $versionMatch.Groups['version'].Value } else { 'latest' }

function Stop-MatchingProcess {
  param(
    [string]$Name,
    [string]$CommandLineLike = ''
  )

  $candidates = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq $Name -and (
      [string]::IsNullOrWhiteSpace($CommandLineLike) -or $_.CommandLine -like $CommandLineLike
    )
  }

  foreach ($process in $candidates) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-Host "Stopped process $($process.ProcessId): $($process.Name)"
    } catch {
      Write-Warning "Failed to stop process $($process.ProcessId): $($_.Exception.Message)"
    }
  }
}

Stop-MatchingProcess -Name "$appName.exe"
Stop-MatchingProcess -Name 'node.exe' -CommandLineLike '*electron-builder*'

Start-Sleep -Seconds 2

$artifactPatterns = @(
  '*_v*.exe',
  '*_v*_share.zip',
  'README_v*.txt',
  'shijie-focus-desktop-*.nsis.7z'
)

foreach ($pattern in $artifactPatterns) {
  Get-ChildItem -Path $releaseDir -Filter $pattern -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
      Write-Host "Removed stale artifact: $($_.Name)"
    } catch {
      Write-Warning "Failed to remove artifact $($_.Name): $($_.Exception.Message)"
    }
  }
}

if (-not (Test-Path -LiteralPath $releaseDir)) {
  New-Item -ItemType Directory -Path $releaseDir | Out-Null
}

$releaseReadmePath = Join-Path $releaseDir ("README_v{0}.txt" -f $versionLabel)
$releaseReadmeContent = @"
视界专注 v$versionLabel

启动方式：
1. 双击运行同目录下的 视界专注_v$versionLabel`_x64.exe
2. 首次使用请先在“设置”中填写教练 API / 蒸馏引擎配置
3. 可从“课程中心”粘贴 BV 号开始提炼，或导入现成课程包继续学习

当前版本重点：
- 课程中心 / 学习台 / 设置中心三入口整理
- 持久化学习档案与课程归档
- Obsidian 导出与双链笔记同步
- 更干净的 Obsidian 命名与归档视图

项目仓库：
https://github.com/UniqueYu8988/YuFocus
"@

Set-Content -LiteralPath $releaseReadmePath -Value $releaseReadmeContent -Encoding UTF8
Write-Host "Prepared release readme: $releaseReadmePath"

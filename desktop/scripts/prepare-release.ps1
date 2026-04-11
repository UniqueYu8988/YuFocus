$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'release'
$appName = '视界专注'

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
  "$appName`_v*.exe",
  "$appName`_v*_share.zip",
  'Onboard_Anything_v*_share.zip',
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

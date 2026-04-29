$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'release'
$appName = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('6KeG55WM5LiT5rOo'))
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
$releaseReadmeTemplateBase64 = '6KeG55WM5LiT5rOoIHZ7e1ZFUlNJT059fQoK5ZCv5Yqo5pa55byP77yaCjEuIOWPjOWHu+i/kOihjOWQjOebruW9leS4i+eahCDop4bnlYzkuJPms6hfdnt7VkVSU0lPTn19X3g2NC5leGUKMi4g6aaW5qyh5L2/55So6K+35YWI5Zyo4oCc6K6+572u4oCd5Lit5aGr5YaZ5pWZ57uDIEFQSSAvIOiSuOmmj+W8leaTjumFjee9rgozLiDlj6/ku47igJzor77nqIvkuK3lv4PigJ3nspjotLQgQlYg5Y+35byA5aeL5o+Q54K877yM5oiW5a+85YWl546w5oiQ6K++56iL5YyF57un57ut5a2m5LmgCgrlvZPliY3niYjmnKzph43ngrnvvJoKLSDor77nqIvkuK3lv4MgLyDlrabkuaDlj7AgLyDorr7nva7kuK3lv4PkuInlhaXlj6PmlbTnkIYKLSDmjIHkuYXljJblrabkuaDmoaPmoYjkuI7or77nqIvlvZLmoaMKLSBPYnNpZGlhbiDlr7zlh7rkuI7lj4zpk77nrJTorrDlkIzmraUKLSDmm7TlubLlh4DnmoQgT2JzaWRpYW4g5ZG95ZCN5LiO5b2S5qGj6KeG5Zu+Cgrpobnnm67ku5PlupPvvJoKaHR0cHM6Ly9naXRodWIuY29tL1VuaXF1ZVl1ODk4OC9ZdUZvY3VzCg=='
$releaseReadmeContent = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($releaseReadmeTemplateBase64)).Replace('{{VERSION}}', $versionLabel)
$utf8WithBom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($releaseReadmePath, $releaseReadmeContent, $utf8WithBom)
Write-Host "Prepared release readme: $releaseReadmePath"

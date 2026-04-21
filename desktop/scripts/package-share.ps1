$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'release'

$portableExe = Get-ChildItem -Path $releaseDir -File |
  Where-Object { $_.Name -like '*_v*_x64.exe' } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $portableExe) {
  throw 'Portable EXE not found. Run portable build first.'
}

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($portableExe.Name)
$productName = $baseName -replace '_v.*$', ''
$versionMatch = [regex]::Match($baseName, '_v(?<version>.+?)_x64$')
$versionLabel = if ($versionMatch.Success) { $versionMatch.Groups['version'].Value } else { 'latest' }
$readmePath = Join-Path $releaseDir ("README_v{0}.txt" -f $versionLabel)
$shareZipPath = Join-Path $releaseDir ($productName + "_v" + $versionLabel + "_share.zip")
$stagingDir = Join-Path $releaseDir 'share-staging'

if (Test-Path -LiteralPath $stagingDir) {
  Remove-Item -LiteralPath $stagingDir -Recurse -Force
}

if (Test-Path -LiteralPath $shareZipPath) {
  Remove-Item -LiteralPath $shareZipPath -Force
}

New-Item -ItemType Directory -Path $stagingDir | Out-Null
Copy-Item -LiteralPath $portableExe.FullName -Destination (Join-Path $stagingDir $portableExe.Name)

if (Test-Path -LiteralPath $readmePath) {
  Copy-Item -LiteralPath $readmePath -Destination (Join-Path $stagingDir (Split-Path $readmePath -Leaf))
}

Compress-Archive -Path (Join-Path $stagingDir '*') -DestinationPath $shareZipPath -CompressionLevel Optimal
Remove-Item -LiteralPath $stagingDir -Recurse -Force

Write-Host ('Created share package: ' + $shareZipPath)

$ErrorActionPreference = "Stop"

$desktopRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$targets = @("dist", "dist-electron")

foreach ($target in $targets) {
  $targetPath = [System.IO.Path]::GetFullPath((Join-Path $desktopRoot $target))
  $expectedPrefix = $desktopRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

  if (-not $targetPath.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean outside desktop root: $targetPath"
  }

  if (Test-Path -LiteralPath $targetPath) {
    Remove-Item -LiteralPath $targetPath -Recurse -Force
  }
}

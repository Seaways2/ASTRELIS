# A CMake build directory remembers the absolute path it was configured at.
# scripts/release.ps1 builds a non-ASCII checkout through a subst drive
# (X:\...), so the next build from the real path (or the other way round)
# stopped with "CMakeCache.txt directory ... is different than the directory
# ... where CMakeCache.txt was created". Such a cache is dropped so CMake
# configures afresh; the build outputs themselves stay where they are.
function Reset-MovedCMakeCache {
  param([Parameter(Mandatory)][string]$Build)
  $cacheFile = Join-Path $Build "CMakeCache.txt"
  if (-not (Test-Path -LiteralPath $cacheFile)) { return }
  # Read as UTF-8 explicitly: the recorded path may contain Chinese folder names.
  $recordedLine = [IO.File]::ReadAllLines($cacheFile, [Text.Encoding]::UTF8) |
    Where-Object { $_ -like "CMAKE_CACHEFILE_DIR:INTERNAL=*" } | Select-Object -First 1
  if (-not $recordedLine) { return }
  $recorded = [IO.Path]::GetFullPath($recordedLine.Substring("CMAKE_CACHEFILE_DIR:INTERNAL=".Length).Replace("/", "\")).TrimEnd("\")
  $current = [IO.Path]::GetFullPath($Build).TrimEnd("\")
  if ([string]::Equals($recorded, $current, [StringComparison]::OrdinalIgnoreCase)) { return }
  if ([IO.Path]::GetFileName($current) -ne "build") { throw "Refusing to reset an unexpected CMake build path: $current" }
  Write-Output "CMake cache was configured at $recorded; reconfiguring at $current."
  Remove-Item -LiteralPath $cacheFile -Force
  $cmakeFiles = Join-Path $Build "CMakeFiles"
  if (Test-Path -LiteralPath $cmakeFiles) { Remove-Item -LiteralPath $cmakeFiles -Recurse -Force }
}

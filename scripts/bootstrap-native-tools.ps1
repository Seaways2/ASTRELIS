[CmdletBinding()]
param(
  [string]$PythonExe = "",
  [string]$CMakeVersion = "3.31.6"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $repoRoot ".tools\cmake"

if (-not $PythonExe) {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if (-not $python) { throw "Python was not found. Pass -PythonExe with an absolute path." }
  $PythonExe = $python.Source
}
if (-not (Test-Path -LiteralPath $PythonExe)) { throw "Python does not exist: $PythonExe" }

& $PythonExe -m pip install --disable-pip-version-check --no-input --target $target "cmake==$CMakeVersion"
if ($LASTEXITCODE -ne 0) { throw "CMake bootstrap failed with exit code $LASTEXITCODE" }

$cmake = Join-Path $target "cmake\data\bin\cmake.exe"
if (-not (Test-Path -LiteralPath $cmake)) { throw "CMake executable was not installed at $cmake" }
& $cmake --version
Write-Output "Native build tool ready: $cmake"

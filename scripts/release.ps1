# Builds the Windows installer end to end: lint, renderer and native builds,
# all tests, then electron-builder (the package.json "dist:win" script).
#
# It takes care of the two things that used to be done by hand:
#  - pnpm is found on PATH, through corepack, or in a known install location;
#  - CMake cannot build the native host under a path with non-ASCII
#    characters, so such a checkout is mapped to a free drive letter with
#    subst for the duration of the build and unmapped afterwards.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1 [-SkipVerify]
[CmdletBinding()]
param([switch]$SkipVerify)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Resolve-Pnpm {
  $onPath = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($onPath) { return @($onPath.Source) }
  $candidates = @(
    (Join-Path $env:APPDATA "npm\pnpm.cmd"),
    (Join-Path $env:LOCALAPPDATA "pnpm\pnpm.exe"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd")
  )
  foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate) { return @($candidate) } }
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    # Only a pnpm corepack already has: never download one or wait on its
    # prompt. Its progress text on stderr must not stop the script either.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $env:COREPACK_ENABLE_NETWORK = "0"
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
    try { & corepack pnpm --version *> $null; $ok = $LASTEXITCODE -eq 0 } catch { $ok = $false }
    finally { $ErrorActionPreference = $previous }
    if ($ok) { return @("corepack", "pnpm") }
  }
  throw "pnpm not found: install it (npm i -g pnpm) or enable corepack with a cached pnpm."
}

function Get-FreeDriveLetter {
  $used = (Get-PSDrive -PSProvider FileSystem).Name
  foreach ($letter in "XWVUTSRQPONMLKJIHG".ToCharArray()) {
    if ($used -notcontains [string]$letter) { return [string]$letter }
  }
  throw "No free drive letter for subst."
}

# @() keeps a single path an array: PowerShell unrolls one-element results to a string.
$pnpm = @(Resolve-Pnpm)
# The package scripts call pnpm themselves (dist:win runs "pnpm verify"), so
# a pnpm found off PATH must be on PATH for the build's child processes.
if ($pnpm.Count -eq 1) {
  $pnpmDirectory = Split-Path -Parent $pnpm[0]
  if (($env:PATH -split ";") -notcontains $pnpmDirectory) { $env:PATH = "$pnpmDirectory;$env:PATH" }
}
$needsAsciiPath = $repoRoot -match "[^\u0000-\u007F]"
$mappedDrive = $null
$workRoot = $repoRoot
try {
  if ($needsAsciiPath) {
    $mappedDrive = Get-FreeDriveLetter
    & subst "$($mappedDrive):" "$repoRoot"
    if ($LASTEXITCODE -ne 0) { throw "subst $($mappedDrive): failed" }
    $workRoot = "$($mappedDrive):\"
    Write-Output "Non-ASCII checkout path: building from $workRoot"
  }
  Push-Location $workRoot
  try {
    $command = if ($SkipVerify) { @("exec", "electron-builder", "--win", "nsis") } else { @("run", "dist:win") }
    $exe = $pnpm[0]
    $arguments = @($pnpm | Select-Object -Skip 1) + $command
    & $exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "pnpm $($command -join ' ') failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
  $version = (Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw -Encoding utf8 | ConvertFrom-Json).version
  $installer = Join-Path $repoRoot "release\ASTRELIS-$version-Setup-x64.exe"
  if (-not (Test-Path -LiteralPath $installer)) { throw "Installer not found: $installer" }
  $item = Get-Item -LiteralPath $installer
  Write-Output ("Installer: {0} ({1:N0} MB, {2})" -f $item.FullName, ($item.Length / 1MB), $item.LastWriteTime)
} finally {
  if ($mappedDrive) { & subst "$($mappedDrive):" /d | Out-Null }
}

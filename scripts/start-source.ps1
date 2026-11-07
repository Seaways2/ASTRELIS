$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$pnpmBin = Join-Path $runtime 'bin\fallback'
$nodeBin = Join-Path $runtime 'node\bin'
$pnpm = Join-Path $pnpmBin 'pnpm.cmd'

if (-not (Test-Path -LiteralPath $pnpm)) {
    Write-Error "pnpm runtime not found: $pnpm"
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $repo 'package.json'))) {
    Write-Error "ASTRELIS source not found: $repo"
    exit 1
}

$env:PATH = "$pnpmBin;$nodeBin;$env:PATH"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath $repo
Write-Host "Starting ASTRELIS source from: $repo"
& $pnpm dev
exit $LASTEXITCODE

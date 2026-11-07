$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$destination = Join-Path $root 'video-engine'
$manifest = Get-Content -LiteralPath (Join-Path $destination 'runtime.json') -Raw | ConvertFrom-Json
$executable = Join-Path $destination 'mpv.exe'
if ((Test-Path -LiteralPath $executable) -and (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -eq $manifest.executableSha256 -and (Test-Path -LiteralPath (Join-Path $destination 'd3dcompiler_43.dll'))) {
  Write-Output 'Pinned video engine is already available.'
  exit 0
}
$work = Join-Path $root 'release-work'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$archive = Join-Path $work 'mpv-20260928.7z'
if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -Uri $manifest.url -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $manifest.archiveSha256) { throw 'Video engine archive SHA256 mismatch. No files extracted.' }
& tar -xf $archive -C $destination mpv.exe mpv.com d3dcompiler_43.dll
if ($LASTEXITCODE -ne 0) { throw 'Video engine extraction failed.' }
if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne $manifest.executableSha256) { throw 'Video executable SHA256 mismatch.' }
Write-Output 'Pinned video engine restored. No system installation performed.'

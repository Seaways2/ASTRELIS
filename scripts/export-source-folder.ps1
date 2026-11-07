[CmdletBinding()]
param([string]$Destination = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ASTRELIS-2.17.7-Source-2026-10-12'))

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$target = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
if ($target.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Destination must be outside the source tree.'
}
if (Test-Path -LiteralPath $target) { throw "Destination already exists: $target" }

$source = Join-Path $target 'source'
New-Item -ItemType Directory -Path $source -Force | Out-Null

$rootFiles = @(
  '.gitignore', 'auralis-version.json', 'index.html', 'package.json',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'README.md',
  'LICENSE-STATUS.md', 'THIRD-PARTY-NOTICES.md',
  'tsconfig.json', 'tsconfig.app.json', 'vite.config.ts'
)
$rootFiles += @(Get-ChildItem -LiteralPath $root -File -Filter '*.md' | Where-Object { $_.Name -notlike '*Source-FileList*' } | Select-Object -ExpandProperty Name)
$rootFiles = @($rootFiles | Sort-Object -Unique)
foreach ($name in $rootFiles) {
  $file = Join-Path $root $name
  if (Test-Path -LiteralPath $file -PathType Leaf) { Copy-Item -LiteralPath $file -Destination (Join-Path $source $name) }
}

foreach ($dir in @('src','electron','scripts','tests','build')) {
  Copy-Item -LiteralPath (Join-Path $root $dir) -Destination (Join-Path $source $dir) -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $source 'native-host') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'native-host/CMakeLists.txt') -Destination (Join-Path $source 'native-host/CMakeLists.txt')
Copy-Item -LiteralPath (Join-Path $root 'native-host/src') -Destination (Join-Path $source 'native-host/src') -Recurse
New-Item -ItemType Directory -Path (Join-Path $source 'native-host/third_party') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'native-host/third_party/JUCE') -Destination (Join-Path $source 'native-host/third_party/JUCE') -Recurse
New-Item -ItemType Directory -Path (Join-Path $source 'native-window') | Out-Null
foreach ($name in @('CMakeLists.txt','NODE-GYP-LICENSE','outline.cpp','win_delay_load_hook.cc')) {
  Copy-Item -LiteralPath (Join-Path $root "native-window/$name") -Destination (Join-Path $source "native-window/$name")
}
New-Item -ItemType Directory -Path (Join-Path $source 'video-engine') | Out-Null
foreach ($name in @('astrelis-controls.lua','astrelis-input.lua','LICENSE-Copyright','LICENSE.GPL','README.md','runtime.json')) {
  Copy-Item -LiteralPath (Join-Path $root "video-engine/$name") -Destination (Join-Path $source "video-engine/$name")
}

$readme = @'
# ASTRELIS source export

Contains application source, build scripts, tests, resources, the dependency lockfile, and the vendored JUCE source used by the native host.

Excludes node_modules, compiled output, old installers, test output, logs, local caches, ffmpeg.exe, mpv.exe, and other deployment binaries. Obtain and verify those external runtimes separately before building an installer. This source export is not proof that third-party distribution requirements have been met.

LICENSE-STATUS.md and THIRD-PARTY-NOTICES.md retain their current status. SHA256SUMS.txt lists the hashes of files in source; ZIP-SHA256.txt lists the archive hash.
'@
[IO.File]::WriteAllText((Join-Path $target 'EXPORT-NOTES.md'), $readme, [Text.UTF8Encoding]::new($false))
$files = @(Get-ChildItem -LiteralPath $source -File -Recurse | Sort-Object FullName)
$hashLines = foreach ($file in $files) {
  $relative = $file.FullName.Substring($source.Length + 1).Replace('\','/')
  '{0}  {1}' -f (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash, $relative
}
[IO.File]::WriteAllLines((Join-Path $target 'SHA256SUMS.txt'), [string[]]$hashLines, [Text.UTF8Encoding]::new($false))

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $target 'ASTRELIS-2.17.7-Source.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($source, $zip, [IO.Compression.CompressionLevel]::Optimal, $false, [Text.UTF8Encoding]::new($false))
$zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
[IO.File]::WriteAllText((Join-Path $target 'ZIP-SHA256.txt'), "$zipHash  $(Split-Path -Leaf $zip)`n", [Text.UTF8Encoding]::new($false))

[pscustomobject]@{ Folder=$target; SourceFiles=$files.Count; SourceBytes=($files | Measure-Object Length -Sum).Sum; ZipBytes=(Get-Item -LiteralPath $zip).Length; ZipSHA256=$zipHash }

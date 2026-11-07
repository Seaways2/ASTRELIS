[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$sourceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$sourceManifest = Get-Content -LiteralPath (Join-Path $sourceRoot "auralis-version.json") -Raw | ConvertFrom-Json
$sourcePackage = Get-Content -LiteralPath (Join-Path $sourceRoot "package.json") -Raw | ConvertFrom-Json
if ($sourceManifest.appVersion -ne $sourcePackage.version) { throw "Source version manifests disagree." }
if (-not $Version) { $Version = [string]$sourceManifest.appVersion }
if ($Version -ne $sourceManifest.appVersion) { throw "Requested archive version does not match the source manifest." }
$outputRoot = if ($OutputDirectory) {
  [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\')
} else {
  Join-Path $sourceRoot "release"
}
$utf8 = [Text.UTF8Encoding]::new($false)

function Get-SourceFiles {
  Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force | Where-Object {
    $relative = $_.FullName.Substring($sourceRoot.Length + 1).Replace('\', '/')
    $relative -notmatch '^(node_modules|dist|dist-electron|release(?:-[^/]+)?|baseline|review|\.tools)(/|$)' -and
      $relative -notmatch '^(native-host|native-window)/build(/|$)' -and
      $relative -notmatch '^ffmpeg/.*\.exe$' -and
      $relative -notmatch '^video-engine/(doc/|.*\.(exe|dll|com)$)' -and
      $relative -notmatch '(^|/)\.git(/|$)' -and
      $relative -notmatch '(?i)\.tsbuildinfo$|\.log$|(^|/)(cache|\.cache)(/|$)'
  }
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$sourceListPath = Join-Path $sourceRoot "ASTRELIS-$Version-Source-FileList.txt"
$initial = @(Get-SourceFiles | ForEach-Object {
  $_.FullName.Substring($sourceRoot.Length + 1)
} | Sort-Object)
$header = @(
  "ASTRELIS $Version SOURCE FILE LIST",
  "Generated: $((Get-Date).ToString('yyyy-MM-dd'))",
  "Excludes: node_modules, dist, dist-electron, release/release-*, baseline, review, Native build trees, nested .git, FFmpeg/video binaries, video runtime docs, *.tsbuildinfo, logs and caches",
  ""
)
$entries = @($initial + "ASTRELIS-$Version-Source-FileList.txt" | Sort-Object -Unique)
[IO.File]::WriteAllLines($sourceListPath, @($header + $entries), $utf8)

$files = @(Get-SourceFiles)
$taskTempBase = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$staging = Join-Path $taskTempBase ("astrelis-$Version-source-" + [guid]::NewGuid().ToString("N"))
$resolvedStaging = [IO.Path]::GetFullPath($staging).TrimEnd('\')
if (-not $resolvedStaging.StartsWith($taskTempBase + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe source staging path: $resolvedStaging"
}

New-Item -ItemType Directory -Path $resolvedStaging | Out-Null
try {
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($sourceRoot.Length + 1)
    $destination = Join-Path $resolvedStaging $relative
    $parent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $parent)) {
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -LiteralPath $file.FullName -Destination $destination
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zipPath = Join-Path $outputRoot "ASTRELIS-$Version-Source.zip"
  if (Test-Path -LiteralPath $zipPath) {
    throw "Refusing to overwrite existing source ZIP: $zipPath"
  }
  [IO.Compression.ZipFile]::CreateFromDirectory(
    $resolvedStaging,
    $zipPath,
    [IO.Compression.CompressionLevel]::Optimal,
    $false,
    $utf8)

  $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entryCount = $archive.Entries.Count
    $unsafe = @($archive.Entries | Where-Object {
      $_.FullName -match '(^|/)(node_modules|dist|dist-electron|release(?:-[^/]+)?|baseline|review|\.tools)(/|$)' -or
        $_.FullName -match '(^|/)(native-host|native-window)/build(/|$)' -or
        $_.FullName -match '^ffmpeg/.*\.exe$' -or
        $_.FullName -match '(^|/)\.git(/|$)' -or
        $_.FullName -match '(?i)\.tsbuildinfo$'
    })
  } finally {
    $archive.Dispose()
  }
  if ($unsafe.Count -gt 0) {
    throw "Source ZIP exclusion audit failed: $($unsafe[0].FullName)"
  }

  [pscustomobject]@{
    Path = $zipPath
    Entries = $entryCount
    Bytes = (Get-Item -LiteralPath $zipPath).Length
    SHA256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
  }
} finally {
  if (Test-Path -LiteralPath $resolvedStaging) {
    $checked = [IO.Path]::GetFullPath($resolvedStaging).TrimEnd('\')
    if (-not $checked.StartsWith($taskTempBase + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to delete unsafe staging path: $checked"
    }
    Remove-Item -LiteralPath $checked -Recurse -Force
  }
}

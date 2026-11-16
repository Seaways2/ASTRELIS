[CmdletBinding()]
param(
  [ValidateSet("Debug", "Release", "RelWithDebInfo")]
  [string]$Configuration = "Release",
  [switch]$Clean
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot "native-host"
$build = Join-Path $source "build"
$bundledCMake = Join-Path $repoRoot ".tools\cmake\cmake\data\bin\cmake.exe"

$cmake = if ($env:CMAKE_EXE -and (Test-Path -LiteralPath $env:CMAKE_EXE)) {
  $env:CMAKE_EXE
} elseif (Test-Path -LiteralPath $bundledCMake) {
  $bundledCMake
} else {
  $command = Get-Command cmake -ErrorAction SilentlyContinue
  if ($command) { $command.Source } else { "" }
}
if (-not $cmake) {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path -LiteralPath $vswhere) {
    $cmake = & $vswhere -latest -products * -find "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" |
      Select-Object -First 1
  }
}
if (-not $cmake) {
  throw "CMake was not found. Run scripts/bootstrap-native-tools.ps1 first or set CMAKE_EXE."
}

if ($Clean -and (Test-Path -LiteralPath $build)) {
  $resolvedSource = [IO.Path]::GetFullPath($source).TrimEnd('\')
  $resolvedBuild = [IO.Path]::GetFullPath($build).TrimEnd('\')
  $insideNativeSource = $resolvedBuild.StartsWith($resolvedSource + '\', [StringComparison]::OrdinalIgnoreCase)
  $isExpectedLeaf = [IO.Path]::GetFileName($resolvedBuild) -eq "build"
  if (-not $insideNativeSource -or -not $isExpectedLeaf) {
    throw "Refusing to delete unexpected native build path: $resolvedBuild"
  }
  Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}

. (Join-Path $PSScriptRoot "lib\CMakeCache.ps1")
Reset-MovedCMakeCache -Build $build

& $cmake -S $source -B $build -G "Visual Studio 17 2022" -A x64
if ($LASTEXITCODE -ne 0) { throw "Native configure failed with exit code $LASTEXITCODE" }

$resourceInfo = Join-Path $build "AuralisPluginHost_artefacts\JuceLibraryCode\Info.txt"
$resourceFile = Join-Path $build "AuralisPluginHost_artefacts\JuceLibraryCode\AuralisPluginHost_resources.rc"
$juceaide = Join-Path $build "third_party\JUCE\tools\extras\Build\juceaide\juceaide_artefacts\Custom\juceaide.exe"
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot "auralis-version.json") -Raw -Encoding utf8 | ConvertFrom-Json
if (Test-Path -LiteralPath $resourceFile) {
  $resourceText = Get-Content -LiteralPath $resourceFile -Raw -Encoding utf8
  $expectedVersionLine = 'VALUE "FileVersion",  "' + [string]$manifest.nativeHostVersion + '\0"'
  if (-not $resourceText.Contains($expectedVersionLine)) {
    # This is a generated JUCE build artifact at one fixed path. Removing it
    # forces the normal generator (or the Unicode-path fallback below) to
    # synchronize Windows file metadata with the shared version manifest.
    Remove-Item -LiteralPath $resourceFile -Force
  }
}

& $cmake --build $build --config $Configuration --target AuralisPluginHost --parallel 4
$buildExitCode = $LASTEXITCODE

# JUCE 8.0.8 juceaide can abort while generating a Windows rcfile when its
# input/output arguments contain non-ASCII path segments. Generate that one
# resource in an ASCII-only temporary directory, then resume the same build.
$needsResourceFallback = $buildExitCode -ne 0 -and
  $repoRoot -match '[^\x00-\x7F]' -and
  -not (Test-Path -LiteralPath $resourceFile) -and
  (Test-Path -LiteralPath $resourceInfo) -and
  (Test-Path -LiteralPath $juceaide)

if ($needsResourceFallback) {
  $tempBase = @($env:TEMP, (Join-Path $env:SystemRoot "Temp")) |
    Where-Object { $_ -and $_ -notmatch '[^\x00-\x7F]' -and (Test-Path -LiteralPath $_) } |
    Select-Object -First 1
  if ($tempBase) {
    $tempRoot = Join-Path $tempBase "astrelis-juce-rc-$PID"
    $resolvedTempBase = [IO.Path]::GetFullPath($tempBase).TrimEnd('\')
    $resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot).TrimEnd('\')
    if (-not $resolvedTempRoot.StartsWith($resolvedTempBase + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to use unexpected JUCE resource fallback path: $resolvedTempRoot"
    }

    New-Item -ItemType Directory -Path $resolvedTempRoot -Force | Out-Null
    try {
      $tempInfo = Join-Path $resolvedTempRoot "Info.txt"
      $tempResource = Join-Path $resolvedTempRoot "AuralisPluginHost_resources.rc"
      Copy-Item -LiteralPath $resourceInfo -Destination $tempInfo -Force
      & $juceaide rcfile $tempInfo $tempResource
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tempResource)) {
        throw "JUCE resource fallback failed with exit code $LASTEXITCODE"
      }
      Copy-Item -LiteralPath $tempResource -Destination $resourceFile -Force
      [IO.File]::SetLastWriteTimeUtc($resourceFile, [DateTime]::UtcNow)
    } finally {
      if (Test-Path -LiteralPath $resolvedTempRoot) {
        Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force
      }
    }

    Write-Output "JUCE Windows resource generated through the ASCII-path fallback."
    & $cmake --build $build --config $Configuration --target AuralisPluginHost --parallel 4
    $buildExitCode = $LASTEXITCODE
  }
}

if ($buildExitCode -ne 0) { throw "Native build failed with exit code $buildExitCode" }

$exe = Join-Path $build "AuralisPluginHost_artefacts\$Configuration\AuralisPluginHost.exe"
if (-not (Test-Path -LiteralPath $exe)) { throw "Native host output is missing: $exe" }
$sha256 = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($exe)
try {
  $hash = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace("-", "")
} finally {
  $stream.Dispose()
  $sha256.Dispose()
}
Write-Output "Native host: $exe"
Write-Output "SHA256: $hash"

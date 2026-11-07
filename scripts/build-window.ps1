$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$electronVersion = (Get-Content (Join-Path $repoRoot 'node_modules/electron/package.json') -Raw | ConvertFrom-Json).version
$cache = Join-Path $repoRoot ".tools/window-native-$electronVersion"
$include = Join-Path $cache 'node-v20.18.0/include/node'
$library = Join-Path $cache 'node.lib'
New-Item -ItemType Directory -Force $cache | Out-Null
if (-not (Test-Path (Join-Path $include 'node_api.h'))) {
  $archive = Join-Path $cache 'headers.tar.gz'
  Invoke-WebRequest 'https://nodejs.org/download/release/v20.18.0/node-v20.18.0-headers.tar.gz' -OutFile $archive
  & tar -xzf $archive -C $cache
  if ($LASTEXITCODE -ne 0) { throw 'Node API header extraction failed' }
}
if (-not (Test-Path $library)) {
  Invoke-WebRequest "https://electronjs.org/headers/v$electronVersion/win-x64/node.lib" -OutFile $library
}
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$cmake = if ($env:CMAKE_EXE) { $env:CMAKE_EXE } else {
  & $vswhere -latest -products * -find 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe' | Select-Object -First 1
}
if (-not $cmake) { throw 'Visual Studio CMake is required to build the window outline module' }
$build = Join-Path $repoRoot 'native-window/build'
& $cmake -S (Join-Path $repoRoot 'native-window') -B $build -G 'Visual Studio 17 2022' -A x64 "-DNODE_INCLUDE_DIR=$include" "-DNODE_LIBRARY=$library"
if ($LASTEXITCODE -ne 0) { throw 'Window module configure failed' }
& $cmake --build $build --config Release
if ($LASTEXITCODE -ne 0) { throw 'Window module build failed' }

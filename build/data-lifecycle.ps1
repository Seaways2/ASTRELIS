param([ValidateSet('Prepare','RemoveData','RemoveProgram')][string]$Action, [string]$Target, [string]$Manifest)
$ErrorActionPreference = 'Stop'
try {
  if (-not [IO.Path]::IsPathRooted($Target)) { throw 'An absolute directory is required.' }
  $root = [IO.Path]::GetFullPath($Target).TrimEnd('\')
  if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) { throw 'A drive root is not allowed.' }
  function Assert-NoLink([string]$itemPath) {
    $cursor = $itemPath
    while ($cursor) {
      if (Test-Path -LiteralPath $cursor) {
        if ((Get-Item -Force -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked directories are not allowed.' }
      }
      $cursor = Split-Path -Parent $cursor
    }
  }
  Assert-NoLink $root
  $owner = Join-Path $root '.astrelis-owner'
  if ($Action -eq 'Prepare') {
    if (Test-Path -LiteralPath $owner) {
      if ((Get-Content -Raw -LiteralPath $owner).Trim() -ne 'com.auralis.player') { throw 'Data directory ownership mismatch.' }
    } elseif ((Test-Path -LiteralPath $root) -and @(Get-ChildItem -Force -LiteralPath $root).Count) {
      throw 'Select a new empty folder, or an existing ASTRELIS UserData folder.'
    }
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $probe = Join-Path $root ('.write-test-' + [Guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($probe, '')
    Remove-Item -LiteralPath $probe
    [IO.File]::WriteAllText($owner, 'com.auralis.player')
  } elseif ($Action -eq 'RemoveData') {
    if (-not (Test-Path -LiteralPath $owner) -or (Get-Content -Raw -LiteralPath $owner).Trim() -ne 'com.auralis.player') { throw 'Data directory ownership mismatch; data preserved.' }
    # Only the dedicated application profile is owned; other files are preserved.
    $profile = Join-Path $root 'Profile'
    Assert-NoLink $profile
    if (Test-Path -LiteralPath $profile) {
      $items = @(Get-ChildItem -LiteralPath $profile -Force -Recurse)
      if (@($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Linked profile content found; data preserved.' }
      Remove-Item -LiteralPath $profile -Recurse -Force
    }
    Remove-Item -LiteralPath $owner -Force
    if (@(Get-ChildItem -LiteralPath $root -Force).Count -eq 0) { Remove-Item -LiteralPath $root }
  } else {
    $files = Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json
    $targets = @($files | ForEach-Object {
      $candidate = [IO.Path]::GetFullPath((Join-Path $root $_))
      if (-not $candidate.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid program manifest path.' }
      Assert-NoLink $candidate
      $candidate
    })
    foreach ($candidate in $targets) {
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { Remove-Item -LiteralPath $candidate -Force }
    }
    # Empty program directories only; never recurse into UserData or arbitrary content.
    $parents = @($targets | ForEach-Object { Split-Path -Parent $_ } | Sort-Object -Unique | Sort-Object Length -Descending)
    foreach ($candidate in $parents) {
      while ($candidate -ne $root -and $candidate.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        if ((Test-Path -LiteralPath $candidate) -and @(Get-ChildItem -LiteralPath $candidate -Force).Count -eq 0) { Remove-Item -LiteralPath $candidate }
        $candidate = Split-Path -Parent $candidate
      }
    }
  }
  exit 0
} catch { Write-Output $_.Exception.Message; exit 1 }

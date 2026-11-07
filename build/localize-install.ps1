param([Parameter(Mandatory=$true)][string]$Executable, [string]$Language)
$ErrorActionPreference = 'Stop'
$names = @('ASTRELIS', '星律', 'アストレリス')
$exe = [IO.Path]::GetFullPath($Executable)
# Only the per-user installation whose registered executable matches may be changed.
$registration = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object {
  $_.DisplayIcon -and (($_.DisplayIcon -replace ',\d+$','').Trim('"') -ieq $exe)
} | Select-Object -First 1
if (!$registration) { exit 0 }
$installKey = 'HKCU:\Software\' + $registration.PSChildName
if (!(Test-Path -LiteralPath $installKey)) { throw 'Installation identity missing' }
if (!$Language) {
  $Language = (Get-ItemProperty -LiteralPath $installKey).DisplayLanguage
  if (!$Language) { $Language = [Globalization.CultureInfo]::CurrentUICulture.Name }
}
$name = if ($Language -match '^zh') { '星律' } elseif ($Language -match '^ja') { 'アストレリス' } else { 'ASTRELIS' }
$shell = New-Object -ComObject WScript.Shell
$folders = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
$owned = @()
foreach ($folder in $folders) {
  foreach ($oldName in $names) {
    $link = Join-Path $folder ($oldName + '.lnk')
    if (!(Test-Path -LiteralPath $link)) { continue }
    $shortcut = $shell.CreateShortcut($link)
    if ($shortcut.TargetPath -ine $exe) { continue }
    $target = Join-Path $folder ($name + '.lnk')
    if (($link -ine $target) -and (Test-Path -LiteralPath $target)) {
      if ($shell.CreateShortcut($target).TargetPath -ine $exe) { throw 'Shortcut name is already used by another application' }
    }
    $owned += @{ Source=$link; Target=$target }
  }
}
foreach ($link in $owned) {
  if ($link.Source -ieq $link.Target) { continue }
  if (Test-Path -LiteralPath $link.Target) { Remove-Item -LiteralPath $link.Source } else { Move-Item -LiteralPath $link.Source -Destination $link.Target }
}
Set-ItemProperty -LiteralPath $installKey -Name ShortcutName -Value $name
Set-ItemProperty -LiteralPath $installKey -Name DisplayLanguage -Value $Language
Set-ItemProperty -LiteralPath $registration.PSPath -Name DisplayName -Value $name

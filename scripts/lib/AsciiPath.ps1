# CMake and the MSVC compiler checks cannot work under a path with non-ASCII
# characters (the C compiler identification crashes with 0xC0000409). Such a
# checkout is built from a drive letter mapped onto it with subst.

function Test-NonAsciiPath([string]$Path) {
  return $Path -match "[^\u0000-\u007F]"
}

# X first, so repeated builds reuse the same letter and CMake keeps its cache.
function Get-FreeDriveLetter {
  $used = (Get-PSDrive -PSProvider FileSystem).Name
  foreach ($letter in "XWVUTSRQPONMLKJIHG".ToCharArray()) {
    if ($used -notcontains [string]$letter) { return [string]$letter }
  }
  throw "No free drive letter for subst."
}

// CMake's compiler checks crash under a path with non-ASCII characters, so
// the native build maps such a checkout to a drive letter itself (as the
// release script does) and "pnpm verify" works from any checkout.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

test("the native build re-runs itself from a mapped drive under a non-ASCII path", () => {
  const build = read("scripts/build-native.ps1");
  assert.match(build, /\. \(Join-Path \$PSScriptRoot "lib\\AsciiPath\.ps1"\)/);
  assert.match(build, /if \(Test-NonAsciiPath \$repoRoot\) \{\s*\$drive = Get-FreeDriveLetter\s*& subst "\$\(\$drive\):" "\$repoRoot"/);
  assert.match(build, /"scripts\\build-native\.ps1"\), "-Configuration", \$Configuration\)/);
  // The mapping is always removed, and the build's exit code is passed on.
  assert.match(build, /\} finally \{\s*& subst "\$\(\$drive\):" \/d \| Out-Null\s*\}\s*exit \$exitCode/);
  assert.doesNotMatch(build, /[\u0000-\u0008]/, "no stray control characters");
});

test("the release and native builds share one drive-letter helper", () => {
  const helper = read("scripts/lib/AsciiPath.ps1");
  assert.match(helper, /function Test-NonAsciiPath/);
  assert.match(helper, /"XWVUTSRQPONMLKJIHG"/, "X first, so CMake keeps its cache between builds");
  const release = read("scripts/release.ps1");
  assert.match(release, /\. \(Join-Path \$PSScriptRoot "lib\\AsciiPath\.ps1"\)/);
  assert.match(release, /\$needsAsciiPath = Test-NonAsciiPath \$repoRoot/);
  assert.doesNotMatch(release, /function Get-FreeDriveLetter/);
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { readMainProcessSource } = require("../helpers/mainProcessSource.cjs");
const read = relative => relative === "electron/main.ts" ? readMainProcessSource() : fs.readFileSync(path.join(root, relative), "utf8");

test("Main Window blocks renderer navigation and validates external URLs", () => {
  const main = read("electron/main.ts");
  assert.match(main, /webContents\.setWindowOpenHandler/);
  assert.match(main, /webContents\.on\("will-navigate"/);
  assert.match(main, /safeExternalUrl\(url\)/);
  assert.match(main, /sameOriginNavigation\(url, devUrl\)/);
});

test("local media protocol requires an authorization policy grant", () => {
  const main = read("electron/main.ts");
  const security = read("electron/security/ElectronSecurity.ts");
  assert.match(main, /protocol\.handle\("auralis-media"/);
  assert.match(main, /localMediaAccess\?\.isAllowed\(filePath\)/);
  assert.match(main, /request\.method !== "GET"/);
  assert.match(security, /fs\.realpathSync\.native/);
  assert.match(security, /path\.relative/);
});

test("embedded online audio bridge stays restricted to YouTube Music", () => {
  const main = read("electron/main.ts");
  const preload = read("electron/online-preload.ts");
  assert.match(preload, /TRUSTED_ONLINE_ORIGIN = "https:\/\/music\.youtube\.com"/);
  assert.match(preload, /isTrustedOnlinePage\(\)/);
  assert.match(main, /trustedOnlineIpcSender/);
  assert.match(main, /senderFrame\.url/);
  assert.match(main, /frames > 16384/);
});

test("embedded NetEase API runs no local HTTP server and keeps cookies out of request URLs", () => {
  const api = read("electron/neteaseApi.ts");
  const cookie = read("electron/neteaseCookie.ts");
  // N09: the package's Express server (no auth, reflected CORS, uploads, proxy=) is never started.
  assert.doesNotMatch(api, /serveNcmApi|\.listen\(|createServer|fetch\(/);
  assert.match(api, /normalizeNeteaseCookieHeader\(cookie\)/);
  assert.match(api, /cookie: includeCookie && apiCookie \? neteaseCookieObject\(apiCookie\) : \{\}/);
  assert.match(cookie, /replace\(\/;\\s\*\/g, "; "\)/);
  assert.doesNotMatch(api, /cookie=\$\{encodeURIComponent\(apiCookie\)\}/);
});

test("library IPC payloads cross runtime validators before services", () => {
  const main = read("electron/main.ts");
  for (const validator of ["parseCommandMeta", "parseAbsolutePath", "parsePathList", "parseRescanRequest", "parseLegacyMutation"])
    assert.match(main, new RegExp(`${validator}\\(`));
  assert.match(main, /library:authorize-dropped-file/);
  assert.match(main, /event\.sender !== mainWindow\?\.webContents/);
});

test("preload exposes command-oriented library methods but not legacy raw write or scan", () => {
  const preload = read("electron/preload.ts");
  const libraryBlock = preload.match(/library: \{[\s\S]*?\r?\n  \},\r?\n  nativeAudio:/);
  assert.ok(libraryBlock);
  assert.match(libraryBlock[0], /load:/);
  assert.match(libraryBlock[0], /chooseFolder:/);
  assert.match(libraryBlock[0], /rescan:/);
  assert.doesNotMatch(libraryBlock[0], /\bsave:/);
  assert.doesNotMatch(libraryBlock[0], /\bscan:/);
  assert.match(preload, /ipcRenderer\.send\("library:authorize-dropped-file"/);
});

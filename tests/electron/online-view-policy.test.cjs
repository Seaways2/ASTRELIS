// S02: the YouTube Music view's session denies permissions by default and
// keeps its top-level pages on YouTube and Google sign-in.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ExternalOpenThrottle, applyOnlineSessionPolicy, onlineNavigationAllowed, onlinePermissionChecked, onlinePermissionGranted
} = require("../../dist-electron/security/OnlineViewPolicy");

test("navigation stays on YouTube and Google sign-in, over https only", () => {
  for (const url of [
    "https://music.youtube.com/watch?v=x", "https://www.youtube.com/", "https://consent.youtube.com/m",
    "https://accounts.google.com/ServiceLogin", "https://youtu.be/abc", "https://youtube.com/"
  ]) assert.equal(onlineNavigationAllowed(url), true, url);
  for (const url of [
    "http://music.youtube.com/", "https://evil.example/", "https://youtube.com.evil.example/", "https://notyoutube.com/",
    "https://user:pw@music.youtube.com/", "search-ms:query=x", "file:///C:/Windows/", "javascript:alert(1)", "not a url"
  ]) assert.equal(onlineNavigationAllowed(url), false, url);
});

test("permission requests: playback needs only; capture, notifications, external protocols never", () => {
  const yt = "https://music.youtube.com/watch?v=x";
  for (const permission of ["fullscreen", "mediaKeySystem", "clipboard-sanitized-write"])
    assert.equal(onlinePermissionGranted(permission, yt), true, permission);
  for (const permission of ["media", "geolocation", "notifications", "clipboard-read", "openExternal", "midiSysex",
    "midi", "display-capture", "idle-detection", "pointerLock", "keyboardLock", "window-management", "fileSystem", "unknown"])
    assert.equal(onlinePermissionGranted(permission, yt), false, permission);
  assert.equal(onlinePermissionGranted("fullscreen", "https://evil.example/"), false);
  assert.equal(onlinePermissionGranted("fullscreen", undefined), false);
});

test("permission checks keep YouTube Music's output-device matching working, and only there", () => {
  // applyOnlineOutputSelection matches outputs by enumerateDevices() labels.
  assert.equal(onlinePermissionChecked("media", "https://music.youtube.com/"), true);
  assert.equal(onlinePermissionChecked("speaker-selection", "https://music.youtube.com"), true);
  assert.equal(onlinePermissionChecked("media", "https://www.youtube.com/"), false);
  assert.equal(onlinePermissionChecked("media", "https://evil.example/"), false);
  assert.equal(onlinePermissionChecked("notifications", "https://music.youtube.com/"), false);
  assert.equal(onlinePermissionChecked("fullscreen", "https://music.youtube.com/"), true);
});

test("the handlers are installed once per session and answer through the policy", () => {
  const calls = {};
  const session = {
    setPermissionRequestHandler: handler => { calls.request = handler; },
    setPermissionCheckHandler: handler => { calls.check = handler; },
    setDevicePermissionHandler: handler => { calls.device = handler; }
  };
  applyOnlineSessionPolicy(session);
  const first = calls.request;
  applyOnlineSessionPolicy(session);
  assert.equal(calls.request, first);
  const answers = [];
  calls.request({}, "media", granted => answers.push(granted), { requestingUrl: "https://music.youtube.com/" });
  calls.request({}, "openExternal", granted => answers.push(granted), { requestingUrl: "https://music.youtube.com/", externalURL: "search-ms:x" });
  calls.request({}, "fullscreen", granted => answers.push(granted), { requestingUrl: "https://music.youtube.com/" });
  assert.deepEqual(answers, [false, false, true]);
  assert.equal(calls.check(null, "media", "https://music.youtube.com/", {}), true);
  assert.equal(calls.check(null, "geolocation", "https://music.youtube.com/", {}), false);
  assert.equal(calls.device({}), false);
});

test("pages cannot open system-browser tabs in a loop", () => {
  let now = 0;
  const throttle = new ExternalOpenThrottle(1500, () => now);
  assert.equal(throttle.allow(), true);
  now = 200; assert.equal(throttle.allow(), false);
  now = 1499; assert.equal(throttle.allow(), false);
  now = 1500; assert.equal(throttle.allow(), true);
});

test("the online view wires the policy, navigation guard and address-bar check", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "../../electron/main.ts"), "utf8");
  const view = main.slice(main.indexOf("function ensureOnlineView()"), main.indexOf("// Keep Canvas/WebAudio rendering active"));
  assert.match(view, /applyOnlineSessionPolicy\(contents\.session\)/);
  assert.match(view, /contents\.on\("will-navigate"/);
  assert.match(view, /contents\.on\("will-redirect", \(event, url, _isInPlace, isMainFrame\) => \{ if \(isMainFrame\) keepOnlinePage\(event, url\); \}\)/);
  assert.doesNotMatch(view, /void shell\.openExternal\(url\)/, "external opens go through the throttle");
  const navigate = main.slice(main.indexOf('ipcMain.handle("browser:navigate"'), main.indexOf('ipcMain.on("browser:back"'));
  assert.ok(navigate.length > 0);
  assert.match(navigate, /event\.sender !== mainWindow\?\.webContents/);
  assert.match(navigate, /const target = onlineAddressTarget\(input\);\s*if \(!target\) return \{ ok: false, error: "ONLINE_ADDRESS_INVALID" \};/);
  assert.match(navigate, /onlineNavigationAllowed\(target\)/);
  // The address bar learns where the address went.
  assert.match(navigate, /const external = openOnlineLinkExternally\(target\);/);
  assert.match(navigate, /\{ ok: true, external \}/);
  assert.doesNotMatch(main, /ipcMain\.on\("browser:navigate"/);
});

function loadAddressBar() {
  const ts = require("typescript");
  const vm = require("node:vm");
  const { safeExternalUrl } = require("../../dist-electron/security/ElectronSecurity");
  const main = fs.readFileSync(path.resolve(__dirname, "../../electron/main.ts"), "utf8");
  const block = (start, end) => {
    const from = main.indexOf(start), to = main.indexOf(end, from);
    assert.ok(from >= 0 && to > from, start);
    return main.slice(from, to);
  };
  const source = [
    block("function onlineAddressTarget(", "const onlineExternalOpens"),
    block("  ipcMain.handle(\"browser:navigate\"", "  ipcMain.on(\"browser:back\"")
  ].join("\n");
  const handlers = new Map(), loaded = [], external = [];
  const sender = {};
  const context = {
    URL, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    mainWindow: { webContents: sender },
    onlineView: { webContents: { loadURL: async url => { loaded.push(url); } } },
    onlineNavigationAllowed,
    // The real check of what may leave for the system browser; the throttle is not under test.
    openOnlineLinkExternally: url => { if (!safeExternalUrl(url)) return "refused"; external.push(url); return "opened"; }
  };
  vm.runInNewContext(`${ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}\nthis.onlineAddressTarget = onlineAddressTarget;`, context);
  const navigate = handlers.get("browser:navigate");
  // Replies are copied out of the sandbox's realm so deepEqual compares plain objects.
  return {
    target: context.onlineAddressTarget, loaded, external,
    navigate: async input => JSON.parse(JSON.stringify(await navigate({ sender }, input)))
  };
}

test("address-bar entries: domains open, words search YouTube Music, http becomes https", () => {
  const { target } = loadAddressBar();
  assert.equal(target("music.youtube.com"), "https://music.youtube.com/");
  assert.equal(target("  https://www.youtube.com/watch?v=x "), "https://www.youtube.com/watch?v=x");
  assert.equal(target("http://music.youtube.com"), "https://music.youtube.com/", "http is upgraded");
  assert.equal(target("HTTP://Example.com/a"), "https://example.com/a");
  assert.equal(target("music.youtube.com/search?q=lofi hip hop"), "https://music.youtube.com/search?q=lofi%20hip%20hop");
  // Words are a search, not a host.
  assert.equal(target("lofi"), "https://music.youtube.com/search?q=lofi");
  assert.equal(target("lofi hip hop"), "https://music.youtube.com/search?q=lofi%20hip%20hop");
  assert.equal(target("3.14"), "https://music.youtube.com/search?q=3.14");
  assert.equal(target("search-ms:query=x"), "https://music.youtube.com/search?q=search-ms%3Aquery%3Dx");
  // A typed scheme is taken at its word.
  for (const invalid of ["https://lofi/", "https://lofi hip hop", "ftp://example.com/", "file:///C:/Windows/", "javascript://x.com", ""])
    assert.equal(target(invalid), undefined, invalid);
});

test("the address bar never hands a made-up host to the system browser", async () => {
  const bar = loadAddressBar();
  assert.deepEqual(await bar.navigate("lofi"), { ok: true });
  assert.deepEqual(await bar.navigate("lofi hip hop"), { ok: true });
  assert.deepEqual(await bar.navigate("http://music.youtube.com"), { ok: true });
  assert.deepEqual(bar.loaded, [
    "https://music.youtube.com/search?q=lofi", "https://music.youtube.com/search?q=lofi%20hip%20hop", "https://music.youtube.com/"
  ]);
  assert.deepEqual(await bar.navigate("https://lofi/"), { ok: false, error: "ONLINE_ADDRESS_INVALID" });
  assert.deepEqual(await bar.navigate("https://user:pw@example.com/"), { ok: false, error: "ONLINE_ADDRESS_INVALID" });
  assert.deepEqual(bar.external, []);
  assert.deepEqual(await bar.navigate("example.com"), { ok: true, external: "opened" });
  assert.deepEqual(bar.external, ["https://example.com/"]);
  assert.deepEqual(await bar.navigate("   "), { ok: false, error: "ONLINE_VIEW_UNAVAILABLE" });
  assert.deepEqual(await bar.navigate(42), { ok: false, error: "UNTRUSTED_SENDER" });
});

test("the address bar says when a site opened in the system browser, in three languages", () => {
  const read = relative => fs.readFileSync(path.resolve(__dirname, "../..", relative), "utf8");
  assert.match(read("electron/preload.ts"), /navigate: \(url: string\) => ipcRenderer\.invoke\("browser:navigate", url\)/);
  const main = read("electron/main.ts");
  assert.match(main, /function openOnlineLinkExternally\(url: string\): "opened" \| "throttled" \| "refused"/);
  const online = read("src/components/OnlineBrowser.tsx");
  const hints = online.slice(online.indexOf("const addressHints"), online.indexOf("const addressHintText"));
  for (const language of ["zh-CN", "en-US", "ja-JP"]) {
    const block = hints.slice(hints.indexOf(`"${language}": {`));
    for (const key of ["external", "throttled", "invalid"]) assert.match(block, new RegExp(`${key}: "[^"]+"`), `${language} ${key}`);
  }
  assert.match(online, /setAddressHint\(result\.external === "opened" \? "external" : "throttled"\)/);
  assert.match(online, /addressHint \? addressHintText\(resolvedLanguage, addressHint\) :/);
  assert.match(online, /onSubmit=\{event => \{ event\.preventDefault\(\); void navigate\(\); \}\}/);
});

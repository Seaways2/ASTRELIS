const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");
const {
  DesktopMediaKeys, DesktopPreferenceService, defaultDesktopPreferences,
  normalizeDesktopPreferences, validateDesktopPreferencesPatch
} = require("../../dist-electron/desktopPreferences.js");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-desktop-preferences-"));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("astrelis-desktop-preferences-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { directory, file: path.join(directory, "desktop-preferences.json") };
}
function fakeRuntime() {
  return {
    top: false, media: false,
    setAlwaysOnTop(value) { this.top = value; },
    setMediaKeysEnabled(value) { this.media = value; }
  };
}

test("desktop preferences start with compatible defaults and do not write until changed", t => {
  const { file } = fixture(t);
  const runtime = fakeRuntime();
  const service = new DesktopPreferenceService(file, runtime);
  assert.deepEqual(service.initialize(), { ok: true, preferences: defaultDesktopPreferences });
  assert.equal(runtime.media, true);
  assert.equal(runtime.top, false);
  assert.equal(fs.existsSync(file), false);
});

test("preferences persist only known fields and restore across service instances", t => {
  const { file } = fixture(t);
  const service = new DesktopPreferenceService(file, fakeRuntime());
  service.initialize();
  const next = { alwaysOnTop: true, rememberWindowState: false, mediaKeysEnabled: false, closeBehavior: "quit" };
  assert.deepEqual(service.update(next), { ok: true, preferences: next });
  const runtime = fakeRuntime();
  const reopened = new DesktopPreferenceService(file, runtime);
  assert.deepEqual(reopened.initialize(), { ok: true, preferences: next });
  assert.equal(runtime.media, false);
  assert.equal(runtime.top, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), next);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test("invalid IPC patches leave state and persisted data untouched", t => {
  const { file } = fixture(t);
  const service = new DesktopPreferenceService(file, fakeRuntime());
  service.initialize();
  service.update({ alwaysOnTop: true });
  const original = fs.readFileSync(file, "utf8");
  for (const patch of [null, [], "true", { alwaysOnTop: 1 }, { mediaKeysEnabled: "false" }, { closeBehavior: "hide" }, { rememberWindowState: null }, { unknown: true }, JSON.parse('{"__proto__":{}}')]) {
    assert.equal(service.update(patch).ok, false);
    assert.equal(service.get().preferences.alwaysOnTop, true);
    assert.equal(fs.readFileSync(file, "utf8"), original);
  }
});

test("stored missing or invalid fields use safe defaults without accepting truthy strings", () => {
  assert.deepEqual(normalizeDesktopPreferences({ alwaysOnTop: "false", rememberWindowState: 0, mediaKeysEnabled: "true", closeBehavior: "other", extra: true }), defaultDesktopPreferences);
  assert.deepEqual(normalizeDesktopPreferences({ mediaKeysEnabled: false, closeBehavior: "quit" }), { ...defaultDesktopPreferences, mediaKeysEnabled: false, closeBehavior: "quit" });
  assert.deepEqual(validateDesktopPreferencesPatch({ rememberWindowState: false }), { rememberWindowState: false });
});

test("a malformed preference file is reported and preserved until an explicit valid update", t => {
  const { file } = fixture(t);
  fs.writeFileSync(file, "{broken");
  const service = new DesktopPreferenceService(file, fakeRuntime());
  assert.equal(service.initialize().ok, false);
  assert.deepEqual(service.get().preferences, defaultDesktopPreferences);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
  assert.equal(service.update({ closeBehavior: "tray" }).ok, true);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
});

test("media shortcuts can be disabled without unregistering unrelated app shortcuts", () => {
  const registered = new Map([["CommandOrControl+Shift+L", () => {}]]);
  const actions = [];
  const keys = new DesktopMediaKeys({
    register(key, callback) { registered.set(key, callback); return true; },
    unregister(key) { registered.delete(key); }
  }, action => actions.push(action));
  keys.setEnabled(true);
  keys.setEnabled(true);
  assert.equal(registered.size, 5);
  registered.get("MediaPlayPause")();
  registered.get("MediaNextTrack")();
  assert.deepEqual(actions, ["toggle", "next"]);
  keys.setEnabled(false);
  assert.deepEqual([...registered.keys()], ["CommandOrControl+Shift+L"]);
});

test("a partial media shortcut registration failure releases only newly acquired keys", () => {
  const registered = new Set(["CommandOrControl+Shift+L"]);
  const keys = new DesktopMediaKeys({
    register(key) { if (key === "MediaNextTrack") return false; registered.add(key); return true; },
    unregister(key) { registered.delete(key); }
  }, () => {});
  assert.throws(() => keys.setEnabled(true), /MediaNextTrack/);
  assert.deepEqual([...registered], ["CommandOrControl+Shift+L"]);
  keys.setEnabled(false);
  assert.deepEqual([...registered], ["CommandOrControl+Shift+L"]);
});

test("startup registration failure exposes disabled media keys and preserves the desired file for retry", t => {
  const { file } = fixture(t);
  fs.writeFileSync(file, JSON.stringify(defaultDesktopPreferences));
  const runtime = fakeRuntime();
  runtime.setMediaKeysEnabled = value => { if (value) throw new Error("key occupied"); };
  const service = new DesktopPreferenceService(file, runtime);
  const result = service.initialize();
  assert.equal(result.ok, false);
  assert.equal(result.preferences.mediaKeysEnabled, false);
  assert.match(result.error, /occupied/);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).mediaKeysEnabled, true);
});

test("failed enabling does not persist a misleading enabled setting", t => {
  const { file } = fixture(t);
  const runtime = fakeRuntime();
  const service = new DesktopPreferenceService(file, runtime);
  service.initialize();
  service.update({ mediaKeysEnabled: false });
  runtime.setMediaKeysEnabled = value => { if (value) throw new Error("unavailable"); runtime.media = value; };
  const result = service.update({ mediaKeysEnabled: true, alwaysOnTop: true });
  assert.equal(result.ok, false);
  assert.equal(result.preferences.mediaKeysEnabled, false);
  assert.equal(runtime.top, false);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).mediaKeysEnabled, false);
});

test("persistence failure rolls runtime effects back and removes the temporary file", t => {
  const { file } = fixture(t);
  fs.mkdirSync(file);
  const runtime = fakeRuntime();
  const service = new DesktopPreferenceService(file, runtime);
  service.initialize();
  const result = service.update({ alwaysOnTop: true, mediaKeysEnabled: false, closeBehavior: "quit" });
  assert.equal(result.ok, false);
  assert.deepEqual(result.preferences, defaultDesktopPreferences);
  assert.equal(runtime.top, false);
  assert.equal(runtime.media, true);
  assert.equal(fs.statSync(file).isDirectory(), true);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test("failed rollback of media registration is reported with its actual disabled state", t => {
  const { file } = fixture(t);
  fs.mkdirSync(file);
  const runtime = fakeRuntime();
  const service = new DesktopPreferenceService(file, runtime);
  service.initialize();
  runtime.setMediaKeysEnabled = value => { if (value) throw new Error("reacquire failed"); runtime.media = false; };
  const result = service.update({ mediaKeysEnabled: false });
  assert.equal(result.ok, false);
  assert.equal(result.preferences.mediaKeysEnabled, false);
  assert.match(result.error, /reacquire failed/);
});

test("returned preference snapshots cannot mutate live state", t => {
  const { file } = fixture(t);
  const service = new DesktopPreferenceService(file, fakeRuntime());
  const result = service.initialize();
  result.preferences.closeBehavior = "quit";
  assert.equal(service.get().preferences.closeBehavior, "tray");
});

const mainSource = fs.readFileSync(path.resolve(__dirname, "../../electron/main.ts"), "utf8");
function sourceBlock(startText, endText) {
  const start = mainSource.indexOf(startText), end = mainSource.indexOf(endText, start);
  assert.ok(start >= 0 && end > start);
  return ts.transpileModule(mainSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
}

test("selected native glass stays enabled through maximize and restore", () => {
  let maximized = false;
  const applied = [];
  const context = vm.createContext({
    syncWindowFit() {},
    fitWindowBounds: require("../../dist-electron/windowFit").fitWindowBounds,
    windowResize: { end() {} },
    currentWindowGlass: "none", process: { platform: "win32" },
    mainWindow: { isMaximized: () => maximized, setBackgroundMaterial: value => applied.push(value) },
    refreshWindowOutline() {}, setNativeAccentAcrylic() {}, writeLog() {}
  });
  vm.runInContext(sourceBlock("function setWindowGlass(", "app.whenReady()"), context);
  context.setWindowGlass("mica");
  maximized = true;
  context.setWindowGlass(context.currentWindowGlass);
  maximized = false;
  context.setWindowGlass(context.currentWindowGlass);
  context.setWindowGlass("acrylic");
  assert.deepEqual(applied, ["mica", "mica", "mica", "none"]);
  assert.equal(context.currentWindowGlass, "acrylic");
});

function windowHarness(t, preferences = {}) {
  const { directory } = fixture(t), stateFile = path.join(directory, "window-state.json");
  const stored = { x: 100, y: 90, width: 1300, height: 850, maximized: false };
  fs.writeFileSync(stateFile, JSON.stringify(stored));
  const timers = new Set(), quitCallbacks = [];
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
    }
    loadFile() {} loadURL() {} isMaximized() { return Boolean(this.maximized); } isMinimized() { return false; }
    getBounds() { return this.bounds; } getNormalBounds() { return this.bounds; }
    getSize() { return [this.bounds.width, this.bounds.height]; }
    isDestroyed() { return false; } isFullScreen() { return false; }
    hookWindowMessage(message, callback) { this.windowMessageHook = { message, callback }; }
    maximize() { this.maximized = true; } unmaximize() { this.maximized = false; }
    setHasShadow(value) { this.shadow = value; } setShape(value) { this.shape = value; }
    setIgnoreMouseEvents() {} setFocusable() {} setSkipTaskbar() {} setOpacity(value) { this.opacity = value; } blur() {}
  }
  const preferencesState = { ...defaultDesktopPreferences, ...preferences };
  const context = vm.createContext({
    syncWindowFit() {},
    fitWindowBounds: require("../../dist-electron/windowFit").fitWindowBounds,
    windowResize: { end() {} },
    fs, path, pathToFileURL, __dirname: path.resolve(__dirname, "../../dist-electron"),
    process: { env: {}, platform: "win32" }, desktopPreferences: { get: () => ({ ok: true, preferences: preferencesState }) },
    applyNativeWindowOutline() {},
    roundedWindowShape: require("../../dist-electron/windowOutline.js").roundedWindowShape,
    windowStatePath: () => stateFile,
    screen: { on() {}, removeListener() {}, getDisplayMatching: () => ({workArea:{x:0,y:0,width:2200,height:1400}}), getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 2200, height: 1400 } }] },
    BrowserWindow: FakeWindow, mainWindow: null, rendererAcceptsExternalFiles: false,
    videoScreenRestore: undefined, compactActive: false, compactRestoreBounds: null, immersiveActive: false, immersiveRestoreBounds: null,
    trayConcealed: false, isQuitting: false, resolveAppIconPath: () => null,
    app: { quit: () => { context.quitCalls++; } }, quitCalls: 0,
    safeExternalUrl: () => false, sameOriginNavigation: () => false, shell: { openExternal() {} },
    scheduleOnlineBoundsResync() {}, setWindowGlass() {}, currentWindowGlass: "mica",
    setTimeout: callback => { timers.add(callback); return callback; }, clearTimeout: callback => timers.delete(callback),
    setImmediate: callback => quitCallbacks.push(callback)
  });
  vm.runInContext(sourceBlock("function loadWindowState()", "function emitBrowserState()")
    + sourceBlock("function refreshWindowOutline()", "function setWindowGlass(")
    + sourceBlock("function createWindow()", "function showMainWindow()") + "\ncreateWindow();", context);
  return { context, window: context.mainWindow, stored, stateFile, preferences: preferencesState,
    flush: () => { for (const callback of [...timers]) { timers.delete(callback); callback(); } },
    quit: () => { for (const callback of quitCallbacks.splice(0)) callback(); } };
}

test("disabled window memory uses default bounds and leaves saved state unchanged on resize and close", t => {
  const h = windowHarness(t, { rememberWindowState: false });
  assert.equal(h.window.options.width, 1500);
  h.window.bounds.width = 1600;
  h.window.emit("resize"); h.flush();
  h.window.emit("close", { preventDefault() {} });
  assert.deepEqual(JSON.parse(fs.readFileSync(h.stateFile, "utf8")), h.stored);
});

test("enabled window memory restores geometry and persists both resize and close", t => {
  const h = windowHarness(t);
  assert.equal(h.window.options.width, 1300);
  h.window.bounds.width = 1600;
  h.window.emit("resize"); h.flush();
  assert.equal(JSON.parse(fs.readFileSync(h.stateFile, "utf8")).width, 1600);
  assert.equal(h.window.shadow, false);
  assert.equal(h.window.shape, undefined);
  h.window.bounds.width = 1700;
  h.window.emit("close", { preventDefault() {} });
  assert.equal(JSON.parse(fs.readFileSync(h.stateFile, "utf8")).width, 1700);
});

test("turning memory off also cancels a previously queued save", t => {
  const h = windowHarness(t);
  h.window.bounds.width = 1600;
  h.window.emit("resize");
  h.preferences.rememberWindowState = false;
  h.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(h.stateFile, "utf8")), h.stored);
});

test("close preference only takes effect when close is clicked and quit uses the normal app route", t => {
  const h = windowHarness(t, { closeBehavior: "quit" });
  assert.equal(h.context.quitCalls, 0);
  h.window.emit("close", { preventDefault() {} });
  assert.equal(h.context.trayConcealed, false);
  assert.equal(h.context.quitCalls, 0);
  h.quit();
  assert.equal(h.context.quitCalls, 1);
});

test("the default close behavior still conceals the window in the tray", t => {
  const h = windowHarness(t);
  h.window.emit("close", { preventDefault() {} }); h.quit();
  assert.equal(h.context.trayConcealed, true);
  assert.equal(h.window.opacity, 0);
  assert.equal(h.context.quitCalls, 0);
});

test("desktop preference IPC rejects other windows and subframes, including the legacy top IPC", t => {
  const { file } = fixture(t);
  const service = new DesktopPreferenceService(file, fakeRuntime()); service.initialize();
  const handlers = new Map(), broadcasts = [], frame = {};
  const sender = { mainFrame: frame, send: (...args) => broadcasts.push(args) };
  vm.runInNewContext(sourceBlock("  const trustedPreferencesSender =", '  ipcMain.handle("external-open:ready",'), {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => handlers.set(name, handler) },
    mainWindow: { webContents: sender }, desktopPreferences: service, defaultDesktopPreferences, writeLog() {}
  });
  const get = handlers.get("desktop-preferences:get"), update = handlers.get("desktop-preferences:update"),
    legacy = handlers.get("window:always-on-top");
  for (const event of [{ sender: {}, senderFrame: frame }, { sender, senderFrame: {} }, { sender, senderFrame: null }]) {
    assert.equal(get(event).ok, false);
    assert.equal(update(event, { alwaysOnTop: true }).ok, false);
    legacy(event, true);
  }
  assert.equal(service.get().preferences.alwaysOnTop, false);
  assert.equal(broadcasts.length, 0);
  const trusted = { sender, senderFrame: frame };
  assert.equal(get(trusted).ok, true);
  assert.equal(update(trusted, { alwaysOnTop: true }).ok, true);
  legacy(trusted, false);
  assert.equal(service.get().preferences.alwaysOnTop, false);
  assert.equal(broadcasts.length, 2);
});

test("compact mode keeps its forced top state while preferences change and restores the new ordinary preference", t => {
  const { directory } = fixture(t), handlers = new Map();
  const window = {
    top: false, setAlwaysOnTop(value) { this.top = value; },
    setResizable() {}, setMinimumSize() {}, setBounds() {},
    webContents: { send() {} }
  };
  const context = vm.createContext({
    syncWindowFit() {},
    fitWindowBounds: require("../../dist-electron/windowFit").fitWindowBounds,
    windowResize: { end() {} },
    path, app: { getPath: () => directory }, DesktopMediaKeys, DesktopPreferenceService,
    globalShortcut: { register: () => true, unregister() {} }, mainWindow: window,
    compactActive: false, compactPreviousTop: false, compactRestoreBounds: null,
    ipcMain: { on: (name, handler) => handlers.set(name, handler) }
  });
  vm.runInContext(sourceBlock("const desktopMediaKeys =", "let nativeAudioActive =")
    + "\nglobalThis.preferenceService = desktopPreferences;", context);
  context.preferenceService.initialize();
  assert.equal(context.preferenceService.update({ alwaysOnTop: true }).ok, true);
  assert.equal(window.top, true);
  context.compactActive = true;
  context.compactPreviousTop = true;
  assert.equal(context.preferenceService.update({ alwaysOnTop: false }).ok, true);
  assert.equal(window.top, true);
  assert.equal(context.compactPreviousTop, false);
  assert.equal(context.preferenceService.get().preferences.alwaysOnTop, false);
  vm.runInContext(sourceBlock('  ipcMain.on("window:compact",', '  ipcMain.on("window:click-through",'), context);
  handlers.get("window:compact")({}, false);
  assert.equal(window.top, false);
});


test("transparent native caption SC_MAXIMIZE toggles exactly once and excludes other commands", t => {
  const h = windowHarness(t), hook = h.window.windowMessageHook;
  assert.equal(hook.message, 0x0112);
  const command = value => { const buffer = Buffer.alloc(8); buffer.writeUInt32LE(value); hook.callback(buffer); h.quit(); };
  for (const value of [0xF010, 0xF020, 0xF060, 0xF030]) { command(value); assert.equal(h.window.isMaximized(), false); }
  command(0xF032); assert.equal(h.window.isMaximized(), true);
  command(0xF032); assert.equal(h.window.isMaximized(), false);
  h.context.compactActive = true;
  command(0xF032); assert.equal(h.window.isMaximized(), false);
});

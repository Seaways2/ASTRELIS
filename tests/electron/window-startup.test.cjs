// Main-window lifecycle in electron/main.ts, run in a vm against a fake
// BrowserWindow that emulates Electron 33's transparent-window maximize:
// isMaximized() means "bounds equal the work area (and not minimized)", and the
// restore rectangle is empty until maximize() records it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

const mainSource = fs.readFileSync(path.resolve(__dirname, "../../electron/main.ts"), "utf8");
function sourceBlock(startText, endText) {
  const start = mainSource.indexOf(startText), end = mainSource.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `${startText} .. ${endText}`);
  return ts.transpileModule(mainSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
}
const same = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function harness(t, { work = { x: 0, y: 0, width: 1280, height: 672 }, stored, preferences = {}, startupComplete = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-window-startup-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "window-state.json");
  if (stored) fs.writeFileSync(stateFile, JSON.stringify(stored));
  const display = { bounds: { ...work, height: work.height + 48 }, workArea: work };
  const timers = new Set(), immediates = [], constructed = [], handlers = new Map();
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); constructed.push(this); this.options = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.restoreRect = { x: 0, y: 0, width: 0, height: 0 };
      this.minimized = false; this.top = undefined;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
      this.webContents.isDestroyed = () => false;
    }
    loadFile() {} loadURL() {}
    isDestroyed() { return false; } isFullScreen() { return false; } isMinimized() { return this.minimized; }
    isMaximized() { return !this.minimized && same(this.bounds, work); }
    getBounds() { return { ...this.bounds }; }
    getNormalBounds() { return this.isMaximized() ? { ...this.restoreRect } : { ...this.bounds }; }
    maximize() { if (this.isMaximized()) return; this.restoreRect = { ...this.bounds }; this.bounds = { ...work }; this.emit("maximize"); this.emit("resize"); }
    unmaximize() { if (!this.isMaximized()) return; this.bounds = { ...this.restoreRect }; this.emit("unmaximize"); this.emit("resize"); }
    setBounds(bounds) {
      const next = { ...this.bounds, ...bounds };
      // Windows applies the minimum size (640x400 DIP here).
      this.bounds = { ...next, width: Math.max(next.width, 640), height: Math.max(next.height, 400) };
      this.emit("resize");
    }
    setSize(width, height) { this.bounds = { ...this.bounds, width, height }; this.emit("resize"); }
    setAlwaysOnTop(on, level) { this.top = [on, level]; } isAlwaysOnTop() { return Boolean(this.top?.[0]); }
    setMinimumSize() {} setResizable() {}
    hookWindowMessage() {} setHasShadow() {}
    setIgnoreMouseEvents() {} setFocusable() {} setSkipTaskbar() {} setOpacity() {} blur() {}
    show() { this.shown = (this.shown || 0) + 1; } focus() {} restore() { this.minimized = false; this.emit("restore"); }
  }
  const preferencesState = { alwaysOnTop: false, rememberWindowState: true, mediaKeysEnabled: true, closeBehavior: "tray", ...preferences };
  const windowFit = require("../../dist-electron/windowFit");
  const machine = require("../../dist-electron/windowStateMachine");
  const context = vm.createContext({
    ...windowFit, ...machine,
    syncWindowFit() {}, windowResize: { end() {} }, displayLog: { schedule() {}, dispose() {} },
    fs, path, pathToFileURL, __dirname: path.resolve(__dirname, "../../dist-electron"),
    process: { env: {}, platform: "win32" }, desktopPreferences: { get: () => ({ ok: true, preferences: preferencesState }) },
    applyNativeWindowOutline() {}, writeLog() {}, sendToMainWindow() {},
    windowStatePath: () => stateFile,
    screen: { on() {}, removeListener() {}, getDisplayMatching: () => display, getAllDisplays: () => [display] },
    BrowserWindow: FakeWindow, mainWindow: null, mainWindowStartupComplete: startupComplete, rendererAcceptsExternalFiles: false,
    compactActive: false, immersiveActive: false, compactPreviousTop: false, trayConcealed: false, isQuitting: false,
    resolveAppIconPath: () => null, app: { quit() {} },
    safeExternalUrl: () => false, sameOriginNavigation: () => false, shell: { openExternal() {} },
    scheduleOnlineBoundsResync() {}, setWindowGlass() {}, currentWindowGlass: "mica",
    ipcMain: { on: (name, handler) => handlers.set(name, handler) },
    setTimeout: callback => { timers.add(callback); return callback; }, clearTimeout: callback => timers.delete(callback),
    setImmediate: callback => immediates.push(callback)
  });
  vm.runInContext(sourceBlock("function loadWindowState()", "function emitBrowserState()")
    + sourceBlock("function refreshWindowOutline()", "function setWindowGlass(")
    + sourceBlock("function createWindow()", "function resolveAppIconPath()")
    + sourceBlock('  ipcMain.on("window:compact",', '  ipcMain.on("window:click-through",')
    + sourceBlock('  ipcMain.on("window:immersive",', "  const trustedWindowSender"), context);
  return {
    context, constructed, handlers, stateFile,
    get window() { return context.mainWindow; },
    flush: () => { for (const callback of [...timers]) { timers.delete(callback); callback(); } },
    saved: () => JSON.parse(fs.readFileSync(stateFile, "utf8"))
  };
}

test("a default size larger than the screen opens truly maximized and restores to a centred window (W02/LV03)", t => {
  // 3840x2160@300% or 1920x1080@150%: the 1500x940 default exceeds the 1280x672 DIP work area.
  const h = harness(t);
  h.context.createWindow();
  const w = h.window;
  assert.deepEqual({ x: w.options.x, y: w.options.y, width: w.options.width, height: w.options.height },
    { x: 160, y: 84, width: 960, height: 504 }, "created at the centred floating size");
  assert.equal(w.isMaximized(), true, "then really maximized, so Electron has a restore rectangle");
  w.emit("close", { preventDefault() {} });
  assert.deepEqual(h.saved(), { x: 160, y: 84, width: 960, height: 504, maximized: true });
  h.context.toggleMaximize(w, "button");
  assert.deepEqual(w.bounds, { x: 160, y: 84, width: 960, height: 504 }, "not 640x400 in the top-left corner");
  assert.equal(w.isMaximized(), false);
});

test("even a window that only looks maximized (never maximize()d) restores to a usable size", t => {
  const h = harness(t);
  h.context.createWindow();
  const w = h.window;
  w.restoreRect = { x: 0, y: 0, width: 0, height: 0 }; // what Electron holds before any maximize()
  h.context.toggleMaximize(w, "caption");
  assert.deepEqual(w.bounds, { x: 160, y: 84, width: 960, height: 504 });
});

test("a default size that fits stays a floating window", t => {
  const h = harness(t, { work: { x: 0, y: 0, width: 2200, height: 1400 } });
  h.context.createWindow();
  assert.equal(h.window.options.width, 1500);
  assert.equal(h.window.isMaximized(), false);
});

test("only one main window is ever created, also for a second instance during startup (W01)", t => {
  const h = harness(t, { startupComplete: false });
  // second-instance arrives while startup still awaits the library.
  h.context.showMainWindow();
  assert.equal(h.constructed.length, 0, "no window before startup creates it");
  h.context.mainWindowStartupComplete = true;
  h.context.createWindow();
  h.context.createWindow();
  h.context.showMainWindow();
  assert.equal(h.constructed.length, 1);
  assert.equal(h.window.shown, 1);
  const main = mainSource;
  const startup = main.slice(main.indexOf("await Promise.race([libraryRootsReady"));
  assert.ok(startup.indexOf("mainWindowStartupComplete = true;") < startup.indexOf("\n  createWindow();"));
});

test("always-on-top uses a level Windows keeps above the taskbar, at startup and everywhere else (LV04)", t => {
  const h = harness(t, { preferences: { alwaysOnTop: true } });
  h.context.createWindow();
  assert.equal("alwaysOnTop" in h.window.options, false, "the constructor option would use the floating level");
  assert.deepEqual(h.window.top, [true, "pop-up-menu"]);
  const calls = mainSource.match(/setAlwaysOnTop\([^)]*\)/g).filter(call => !/setAlwaysOnTop\(enabled\)$/.test(call));
  assert.ok(calls.length >= 5);
  for (const call of calls) assert.match(call, /, "pop-up-menu"\)$/, call);
});

test("maximized -> compact -> back returns maximized, and a relaunch from compact mode is maximized (LV05)", t => {
  const h = harness(t, { work: { x: 0, y: 0, width: 2200, height: 1400 }, stored: { x: 100, y: 90, width: 1300, height: 850, maximized: true } });
  h.context.createWindow();
  const w = h.window, compact = h.handlers.get("window:compact");
  assert.equal(w.isMaximized(), true);
  compact({}, true);
  assert.deepEqual({ width: w.bounds.width, height: w.bounds.height }, { width: 420, height: 124 });
  assert.deepEqual(w.top, [true, "pop-up-menu"]);
  h.flush();
  assert.deepEqual(h.saved(), { x: 100, y: 90, width: 1300, height: 850, maximized: true });
  compact({}, false);
  assert.equal(w.isMaximized(), true);
  assert.deepEqual(w.restoreRect, { x: 100, y: 90, width: 1300, height: 850 }, "the next restore returns to the floating bounds");
  assert.deepEqual(w.top, [false, "pop-up-menu"]);
});

test("a floating window leaves compact mode floating", t => {
  const h = harness(t, { work: { x: 0, y: 0, width: 2200, height: 1400 }, stored: { x: 100, y: 90, width: 1300, height: 850, maximized: false } });
  h.context.createWindow();
  const w = h.window, compact = h.handlers.get("window:compact");
  compact({}, true); compact({}, false);
  assert.deepEqual(w.bounds, { x: 100, y: 90, width: 1300, height: 850 });
  assert.equal(w.isMaximized(), false);
});

test("a restore made inside immersive mode stands when leaving it", t => {
  const h = harness(t, { work: { x: 0, y: 0, width: 2200, height: 1400 }, stored: { x: 100, y: 90, width: 1300, height: 850, maximized: true } });
  h.context.createWindow();
  const w = h.window, immersive = h.handlers.get("window:immersive");
  assert.equal(w.isMaximized(), true);
  immersive({}, true);
  // The immersive drag zone: double-click restores the window.
  h.context.toggleMaximize(w, "caption");
  assert.equal(w.isMaximized(), false);
  h.flush();
  assert.equal(h.saved().maximized, false, "immersive mode saves the state it is in now");
  immersive({}, false);
  assert.equal(w.isMaximized(), false, "not maximized again");
  assert.deepEqual(w.bounds, { x: 100, y: 90, width: 1300, height: 850 });
  // Maximized in immersive mode and left that way: still maximized afterwards, and saved so.
  immersive({}, true);
  h.context.toggleMaximize(w, "caption");
  h.flush();
  assert.deepEqual(h.saved(), { x: 100, y: 90, width: 1300, height: 850, maximized: true });
  immersive({}, false);
  assert.equal(w.isMaximized(), true);
});

test("the shrunken corner window earlier builds saved is not reused as the floating size (LV03)", t => {
  const h = harness(t, { stored: { x: 0, y: 0, width: 640, height: 400, maximized: true } });
  h.context.createWindow();
  const w = h.window;
  assert.equal(w.isMaximized(), true);
  h.context.toggleMaximize(w, "button");
  assert.deepEqual(w.bounds, { x: 160, y: 84, width: 960, height: 504 });
  // Floating at that size too: it opens centred instead of in the corner.
  const floating = harness(t, { stored: { x: 1, y: 0, width: 641, height: 400, maximized: false } });
  floating.context.createWindow();
  assert.deepEqual(floating.window.bounds, { x: 160, y: 84, width: 960, height: 504 });
  assert.equal(floating.window.isMaximized(), false);
  // A minimum-size window the user placed elsewhere is left alone.
  const placed = harness(t, { stored: { x: 300, y: 200, width: 640, height: 400, maximized: false } });
  placed.context.createWindow();
  assert.deepEqual(placed.window.bounds, { x: 300, y: 200, width: 640, height: 400 });
});

test("minimizing a maximized window keeps maximized:true in window-state.json (LV10)", t => {
  const h = harness(t, { work: { x: 0, y: 0, width: 2200, height: 1400 }, stored: { x: 100, y: 90, width: 1300, height: 850, maximized: true } });
  h.context.createWindow();
  const w = h.window;
  const minimize = () => { w.minimized = true; w.emit("minimize"); w.emit("move"); };
  minimize(); // Electron: isMaximized() is false now; getBounds() stays the work area.
  h.flush();
  assert.deepEqual(h.saved(), { x: 100, y: 90, width: 1300, height: 850, maximized: true });
  fs.rmSync(h.stateFile);
  w.restore(); h.flush();
  assert.deepEqual(h.saved(), { x: 100, y: 90, width: 1300, height: 850, maximized: true }, "restoring saves the shown state");
  minimize();
  w.emit("close", { preventDefault() {} });
  assert.equal(h.saved().maximized, true, "closing to the tray while minimized");
});

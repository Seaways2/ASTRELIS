const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const diagnostics = require("../../dist-electron/displayDiagnostics");
const { DisplayLogScheduler, describeDisplays, describeGpuDevices, describeGpuFeatureStatus } = diagnostics;

// The 2.18.3 field machine: 4K primary at 225 % with the window, plus a 300 %
// monitor to the left of it (negative origin).
const fieldDisplays = [
  { id: 2528732444, label: "DELL U2720Q", scaleFactor: 2.25, bounds: { x: 0, y: 0, width: 1820, height: 960 }, workArea: { x: 0, y: 0, width: 1820, height: 912 }, rotation: 0, internal: false, displayFrequency: 59.997 },
  { id: 77, label: "", scaleFactor: 3, bounds: { x: -1280, y: 0, width: 1280, height: 720 }, workArea: { x: -1280, y: 0, width: 1280, height: 680 }, rotation: 90, internal: true, displayFrequency: 0 }
];

test("display lines carry scale, DIP geometry, approximate physical size and markers", () => {
  assert.deepEqual(describeDisplays(fieldDisplays, 2528732444, 2528732444, "startup"), [
    'startup 1/2 id=2528732444 "DELL U2720Q" primary window scale=2.25 bounds=0,0 1820x960 work=0,0 1820x912 px~4095x2160 rot=0 60Hz internal=no',
    "startup 2/2 id=77 scale=3 bounds=-1280,0 1280x720 work=-1280,0 1280x680 px~3840x2160 rot=90 internal=yes"
  ]);
});

test("an empty display list and an unknown window display stay explicit", () => {
  assert.deepEqual(describeDisplays([], undefined, undefined, "metrics:workArea@1"), ["metrics:workArea@1 no displays reported"]);
  const lines = describeDisplays(fieldDisplays, 2528732444, 999, "added");
  assert.equal(lines.some(line => / window /.test(line)), false);
  assert.equal(describeDisplays(fieldDisplays, undefined, undefined, "x").some(line => line.includes(" primary")), false);
});

test("GPU feature status is grouped by value and reports the acceleration mode", () => {
  const gtx1060 = {
    "2d_canvas": "enabled", gpu_compositing: "enabled", webgl: "enabled", webgl2: "enabled", rasterization: "enabled",
    video_decode: "enabled", opengl: "enabled_on", vulkan: "disabled_off", skia_graphite: "disabled_off", multiple_raster_threads: "enabled_on"
  };
  assert.equal(describeGpuFeatureStatus(gtx1060),
    "acceleration=hardware disabled_off[skia_graphite,vulkan] enabled[2d_canvas,gpu_compositing,rasterization,video_decode,webgl,webgl2] enabled_on[multiple_raster_threads,opengl]");
  assert.equal(describeGpuFeatureStatus({ gpu_compositing: "disabled_software", webgl: "unavailable_software" }),
    "acceleration=software disabled_software[gpu_compositing] unavailable_software[webgl]");
  assert.equal(describeGpuFeatureStatus({ webgl: "enabled" }), "acceleration=unknown enabled[webgl]");
  for (const bad of [undefined, null, "enabled", 3, []]) assert.equal(describeGpuFeatureStatus(bad), "features=unknown");
});

test("GPU devices fall back to PCI ids, join adapters and cap runaway strings", () => {
  assert.equal(describeGpuDevices({ gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x1c02, deviceString: "NVIDIA GeForce GTX 1060 3GB", driverVendor: "NVIDIA", driverVersion: "31.0.15.3623" }] }),
    "*NVIDIA GeForce GTX 1060 3GB driver=NVIDIA 31.0.15.3623 (0x10de:0x1c02)");
  assert.equal(describeGpuDevices({ gpuDevice: [{ active: false, vendorId: 0x8086, deviceId: 0x3e92 }], auxAttributes: { glRenderer: "ANGLE (Intel)" } }),
    'unnamed (0x8086:0x3e92) gl="ANGLE (Intel)"');
  assert.equal(describeGpuDevices({ gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x1c02, deviceString: "A" }, { vendorId: 0x8086, deviceId: 0x3e92, deviceString: "B" }] }),
    "*A (0x10de:0x1c02) | B (0x8086:0x3e92)");
  const flooded = describeGpuDevices({ gpuDevice: [{ vendorId: 1, deviceId: 2, deviceString: "x".repeat(10000) }] });
  assert.ok(flooded.length < 200, flooded.length);
  assert.match(flooded, /^x+\.\.\. \(0x0001:0x0002\)$/);
  for (const bad of [undefined, null, {}, { gpuDevice: "nope" }, { gpuDevice: [null, 4] }]) assert.equal(describeGpuDevices(bad), "devices=none reported");
});

function fakeTimers() {
  const pending = new Map(), cleared = [];
  let next = 1;
  return {
    pending, cleared,
    timers: { set(callback, ms) { const id = next++; pending.set(id, { callback, ms }); return id; }, clear(id) { cleared.push(id); pending.delete(id); } },
    fire() { const entries = [...pending]; pending.clear(); for (const [, entry] of entries) entry.callback(); }
  };
}

test("display log bursts collapse into one flush with deduplicated, ordered reasons", () => {
  const clock = fakeTimers(), flushed = [];
  const scheduler = new DisplayLogScheduler(reasons => flushed.push(reasons), 500, clock.timers);
  scheduler.schedule("metrics:scaleFactor@1");
  scheduler.schedule("metrics:workArea@1");
  scheduler.schedule("metrics:scaleFactor@1");
  assert.equal(clock.pending.size, 1);
  assert.equal([...clock.pending.values()][0].ms, 500);
  assert.deepEqual(flushed, []);
  clock.fire();
  assert.deepEqual(flushed, [["metrics:scaleFactor@1", "metrics:workArea@1"]]);
  scheduler.schedule("added");
  clock.fire();
  assert.deepEqual(flushed, [["metrics:scaleFactor@1", "metrics:workArea@1"], ["added"]]);
});

test("disposing the display log cancels a pending flush", () => {
  const clock = fakeTimers(), flushed = [];
  const scheduler = new DisplayLogScheduler(reasons => flushed.push(reasons), 500, clock.timers);
  scheduler.schedule("removed");
  const [handle] = clock.pending.keys();
  scheduler.dispose();
  assert.ok(clock.cleared.includes(handle));
  clock.fire();
  assert.deepEqual(flushed, []);
  scheduler.schedule("added");
  clock.fire();
  assert.deepEqual(flushed, [["added"]]);
});

const mainSource = fs.readFileSync(path.resolve(__dirname, "../../electron/main.ts"), "utf8");
function sourceBlock(startText, endText) {
  const start = mainSource.indexOf(startText), end = mainSource.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `${startText} .. ${endText}`);
  return ts.transpileModule(mainSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
}

function fakeApp(extra = {}) {
  const listeners = { on: {}, once: {} };
  const add = kind => (name, callback) => { (listeners[kind][name] ||= []).push(callback); };
  return {
    listeners,
    on: add("on"), once: add("once"),
    emit(name, ...args) {
      const once = listeners.once[name] || [];
      listeners.once[name] = [];
      for (const callback of [...(listeners.on[name] || []), ...once]) callback(...args);
    },
    getGPUInfo: async () => { extra.calls && extra.calls.gpuInfo++; return { gpuDevice: [{ active: true, vendorId: 0x10de, deviceId: 0x1c02, deviceString: "GTX 1060" }] }; },
    getGPUFeatureStatus: () => ({ gpu_compositing: "enabled" }),
    ...extra.app
  };
}

function glueHarness(overrides = {}, appOverrides = {}) {
  const log = [], calls = { gpuInfo: 0 };
  const context = vm.createContext({
    ...diagnostics, log, calls, Promise, Error, String,
    writeLog: (level, message) => log.push(`${level} ${message}`),
    gpuInfoUpdated: Promise.resolve(),
    setTimeout: () => 0, clearTimeout() {},
    mainWindow: { isDestroyed: () => false, getBounds: () => ({ x: -900, y: 40, width: 800, height: 500 }) },
    screen: {
      getAllDisplays: () => fieldDisplays, getPrimaryDisplay: () => fieldDisplays[0],
      getDisplayMatching: bounds => bounds.x < 0 ? fieldDisplays[1] : fieldDisplays[0]
    },
    app: fakeApp({ calls, app: appOverrides }),
    ...overrides
  });
  vm.runInContext(sourceBlock("function logDisplays(", "function createWindow()"), context);
  return context;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("startup display logging writes one DISPLAY line per display and marks the window's display", () => {
  const context = glueHarness();
  context.logDisplays(["startup"]);
  assert.equal(context.log.length, 2);
  assert.ok(context.log.every(line => line.startsWith("DISPLAY startup ")));
  assert.equal(context.log[0].includes(" window "), false);
  assert.match(context.log[1], /^DISPLAY startup 2\/2 id=77 window scale=3 /);
});

test("display query failures are logged instead of thrown", () => {
  const context = glueHarness({ screen: { getAllDisplays() { throw new Error("no screen"); }, getPrimaryDisplay: () => ({ id: 1 }), getDisplayMatching: () => ({ id: 1 }) } });
  assert.doesNotThrow(() => context.logDisplays(["startup"]));
  assert.deepEqual(context.log, ["DISPLAY display query failed: no screen"]);
});

test("GPU logging runs once and survives failing Electron GPU queries", async () => {
  const context = glueHarness();
  context.logGpu(); context.logGpu();
  await settle(); await settle();
  assert.equal(context.calls.gpuInfo, 1);
  assert.deepEqual(context.log, ["GPU *GTX 1060 (0x10de:0x1c02); acceleration=hardware enabled[gpu_compositing]"]);

  const failing = glueHarness({}, {
    getGPUInfo: async () => { throw new Error("gpu process gone"); },
    getGPUFeatureStatus() { throw new Error("not ready"); }
  });
  failing.logGpu();
  await settle(); await settle();
  assert.deepEqual(failing.log, ["GPU info unavailable (gpu process gone); features unavailable (not ready)"]);
});

test("GPU logging falls back after 5 s when gpu-info-update never fires", async () => {
  const timers = [], cleared = [];
  const context = glueHarness({
    gpuInfoUpdated: new Promise(() => {}),
    setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
    clearTimeout: handle => cleared.push(handle)
  });
  context.logGpu();
  await settle(); await settle();
  assert.deepEqual(context.log, []);
  assert.deepEqual(timers.map(timer => timer.ms), [5000]);
  timers[0].callback();
  await settle(); await settle();
  assert.deepEqual(context.log, ["GPU *GTX 1060 (0x10de:0x1c02); acceleration=hardware enabled[gpu_compositing]"]);

  // gpu-info-update winning the race cancels the fallback timer.
  let handle;
  const early = glueHarness({ setTimeout: () => (handle = { id: "fallback" }), clearTimeout: value => cleared.push(value) });
  early.logGpu();
  await settle(); await settle();
  assert.ok(handle && cleared.includes(handle));
  assert.equal(early.log.length, 1);
});

test("debounced display changes re-log the GPU feature status, startup does not", () => {
  let features = { gpu_compositing: "enabled" };
  const context = glueHarness({}, { getGPUFeatureStatus: () => features });
  context.logDisplays(["startup"]);
  assert.equal(context.log.some(line => line.startsWith("GPU ")), false);
  context.log.length = 0;
  features = { gpu_compositing: "disabled_software" };
  context.logDisplayChange(["metrics:scaleFactor,workArea@77", "added"]);
  assert.equal(context.log.filter(line => line.startsWith("DISPLAY metrics:scaleFactor,workArea@77+added ")).length, 2);
  assert.equal(context.log.at(-1), "GPU metrics:scaleFactor,workArea@77+added acceleration=software disabled_software[gpu_compositing]");
});

test("a GPU process crash is logged with the status after the relaunch", () => {
  let features = { gpu_compositing: "enabled" };
  const context = glueHarness({}, { getGPUFeatureStatus: () => features });
  const app = context.app;
  assert.equal(app.listeners.on["child-process-gone"].length, 1);
  app.emit("child-process-gone", {}, { type: "Utility", reason: "crashed", exitCode: 1 });
  assert.deepEqual(context.log, []);
  app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: -1073741819 });
  app.emit("child-process-gone", {}, { type: "GPU", reason: "launch-failed", exitCode: 0 });
  // Two crashes before the relaunch still wait on a single status line.
  assert.equal((app.listeners.once["gpu-info-update"] || []).length, 1);
  features = { gpu_compositing: "disabled_software" };
  app.emit("gpu-info-update");
  assert.deepEqual(context.log, [
    "GPU process gone reason=crashed exit=-1073741819",
    "GPU process gone reason=launch-failed exit=0",
    "GPU after relaunch acceleration=software disabled_software[gpu_compositing]"
  ]);
  app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 1 });
  assert.equal(app.listeners.once["gpu-info-update"].length, 1);
});

test("the display-metrics-changed listener refits first and schedules a reason built from the change", () => {
  const block = sourceBlock("  const displayMetricsChanged =", "  screen.on(\"display-metrics-changed\"");
  const calls = [];
  const context = vm.createContext({
    syncWindowFit: (...args) => calls.push(`fit ${args.join(",")}`),
    displayLog: { schedule: reason => calls.push(`log ${reason}`) }
  });
  vm.runInContext(`${block}\nthis.handlers = { displayMetricsChanged, displayRemoved, displayAdded };`, context);
  context.handlers.displayMetricsChanged({}, { id: 2528732444 }, ["scaleFactor", "workArea"]);
  context.handlers.displayRemoved();
  context.handlers.displayAdded();
  assert.deepEqual(calls, ["fit true,true", "log metrics:scaleFactor,workArea@2528732444", "fit true,true", "log removed", "log added"]);
});

test("main process registers display listeners symmetrically and logs after the window exists", () => {
  const registered = [...mainSource.matchAll(/screen\.on\("(display-[a-z-]+)",\s*(\w+)\)/g)].map(match => `${match[1]}:${match[2]}`);
  const removed = [...mainSource.matchAll(/screen\.removeListener\("(display-[a-z-]+)",\s*(\w+)\)/g)].map(match => `${match[1]}:${match[2]}`);
  assert.deepEqual(registered.sort(), ["display-added:displayAdded", "display-metrics-changed:displayMetricsChanged", "display-removed:displayRemoved"]);
  assert.deepEqual(removed.sort(), registered);
  assert.match(mainSource, /const displayMetricsChanged = [^]*?syncWindowFit\(true,true\);[^]*?\};/);
  assert.match(mainSource, /const displayRemoved = \(\) => \{ syncWindowFit\(true,true\);/);
  assert.match(mainSource, /displayLog\.dispose\(\);/);
  const created = mainSource.indexOf("\n  createWindow();");
  assert.ok(created > 0);
  assert.ok(mainSource.indexOf('logDisplays(["startup"]);', created) > created);
  assert.ok(mainSource.indexOf("logGpu();", created) > created);
  assert.doesNotMatch(mainSource, /await app\.getGPUInfo|getGPUInfo\("complete"\)/);
  const gpuEvent = mainSource.indexOf('app.once("gpu-info-update"');
  assert.ok(gpuEvent > 0 && gpuEvent < mainSource.indexOf("app.whenReady()"));
  // The vm harnesses in desktop-preferences run createWindow with a fake screen:
  // the glue must stay outside createWindow's synchronous path.
  assert.ok(mainSource.indexOf("function logDisplays(") < mainSource.indexOf("function createWindow()"));
});

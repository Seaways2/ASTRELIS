const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");

function loadModule(relative) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const module = { exports: {} };
  Function("require", "module", "exports", javascript)(require, module, module.exports);
  return module.exports;
}

const { frameIsDue, nextFrameDue } = loadModule("src/visualizers/framePacing.ts");

// Simulates the canvas loop on a display with the given refresh rate and
// vsync jitter; returns the intervals between draws.
function simulate(refreshHz, targetFps, { jitter = 0, seconds = 4 } = {}) {
  const period = 1000 / refreshHz;
  const interval = 1000 / targetFps;
  let nextDue = 0;
  let last = null;
  const gaps = [];
  for (let frame = 1; frame < refreshHz * seconds; frame++) {
    const now = 1000 + frame * period + (frame % 2 ? jitter : -jitter);
    if (!frameIsDue(now, nextDue)) continue;
    if (last !== null) gaps.push(now - last);
    last = now;
    nextDue = nextFrameDue(now, nextDue, interval);
  }
  return gaps;
}

const fps = gaps => 1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length);

test("30 FPS on a jittery 60 Hz display draws every other frame", () => {
  const gaps = simulate(60, 30, { jitter: .4 });
  assert.ok(gaps.every(gap => gap > 32 && gap < 35), `uneven gaps: ${[...new Set(gaps.map(Math.round))]}`);
});

test("60 FPS on a jittery 60 Hz display never skips a frame", () => {
  const gaps = simulate(60, 60, { jitter: .4 });
  assert.ok(gaps.every(gap => gap < 18));
});

test("30 FPS on 72 and 144 Hz displays averages the target rate", () => {
  for (const hz of [72, 144, 165]) {
    const rate = fps(simulate(hz, 30));
    assert.ok(rate > 29 && rate < 31.5, `${hz} Hz -> ${rate.toFixed(1)} FPS`);
  }
});

test("a long pause resets the schedule instead of bursting", () => {
  const interval = 1000 / 30;
  const due = nextFrameDue(5000, 1000, interval);
  assert.equal(due, 5000 + interval);
});

test("the canvas loop uses the shared pacing helpers", () => {
  const canvas = fs.readFileSync(path.join(root, "src/visualizers/VisualizerCanvas.tsx"), "utf8");
  assert.match(canvas, /if \(!frameIsDue\(now, nextDue\)\) \{/);
  assert.match(canvas, /nextDue = nextFrameDue\(now, nextDue, frameInterval\);/);
});

test("the reused library index is exported and saved only once", () => {
  const hook = fs.readFileSync(path.join(root, "src/hooks/useLibraryViewModel.ts"), "utf8");
  assert.match(hook, /savedDerivedIndexes\.has\(canonicalIndex\)/);
  assert.match(hook, /savedDerivedIndexes\.add\(canonicalIndex\);\s*void window\.desktop\?\.library\.saveDerivedIndex/);
});

test("a debounced volume is flushed when the window unloads for quit", () => {
  const store = fs.readFileSync(path.join(root, "src/stores/playerStore.ts"), "utf8");
  assert.match(store, /addEventListener\?\.\("beforeunload", flushPersistedVolume\)/);
});

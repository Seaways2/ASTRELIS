// Runs the real scenes against a context that records glint strokes, and
// checks that the starfield and black hole show galaxy-style glints within
// their limits, and that ECO draws none.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const load = (relative, requireFn = () => ({})) => {
  const exports = {};
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  Function("exports", "require", output)(exports, requireFn);
  return exports;
};
const modules = {
  "./framePacing": load("src/visualizers/framePacing.ts"),
  "./galaxyPalette": load("src/visualizers/galaxyPalette.ts"),
  "./musicDynamics": load("src/visualizers/musicDynamics.ts")
};
const { createVisualizerScene } = load("src/visualizers/visualizerScene.ts", name => modules[name]);
const { smoothFrequencyFrame } = load("src/utils/frequencySmoothing.ts");

// A glint is two strokes of a linear gradient with exactly three stops
// (transparent, colour, transparent); every other gradient in these scenes
// has more stops or is radial.
function glintCanvas(frame) {
  const state = { globalAlpha: 1 };
  const context = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "createLinearGradient") return () => { const stops = []; return { stops, addColorStop(offset) { stops.push(offset); } }; };
      if (key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key === "stroke") return () => {
        const stops = state.strokeStyle?.stops;
        if (stops && stops.length === 3 && stops[1] === .5) frame.strokes.push(state.globalAlpha);
      };
      return () => undefined;
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  return { width: 300, height: 150, getContext: () => context };
}
globalThis.OffscreenCanvas = class { constructor(width, height) { Object.assign(this, glintCanvas({ strokes: [] }), { width, height }); } };
globalThis.Path2D = class { moveTo() {} lineTo() {} arc() {} };

const settings = { smoothing: .76, sensitivity: 1, barCount: 90, barOpacity: 1, lineWidth: 1.5, animationSpeed: 1, decaySpeed: 1, peakHoldMs: 650, lowPerformance: false };
const layout = { width: 1600, height: 900, ratio: 1, left: 0, top: 0, cssWidth: 1600, cssHeight: 900, viewportWidth: 1600, viewportHeight: 900 };
const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const song = t => {
  const bins = new Uint8Array(256), kick = Math.exp(-(t % .5) / .12), hat = 130 * Math.exp(-(t % .25) / .05);
  for (let index = 0; index < 256; index++) {
    let value = 0;
    if (index < 4) value = (60 + 180 * kick) * [1, .95, .7, .4][index];
    if (index >= 1 && index < 30) value = Math.max(value, 160 - index * 1.2);
    if (index >= 25 && index < 100) value = Math.max(value, Math.max(55, hat) - (index - 25) * .5);
    bins[index] = clamp(value);
  }
  return bins;
};

// Glints drawn per frame, as the alpha of each (one entry per glint).
function run(mode, sceneSettings = settings, seconds = 10) {
  const frame = { strokes: [] };
  const scene = createVisualizerScene(glintCanvas(frame), { mode, accent: "#38d3e1", settings: sceneSettings, glowStrength: 1, playbackActive: true, backgroundBrightness: 1, backgroundOpacity: 1 });
  scene.resize(layout);
  const frames = [];
  let smoothed;
  for (let index = 0; index < seconds * 60; index++) {
    frame.strokes = [];
    smoothed = smoothFrequencyFrame(song(index / 60), smoothed, .76, smoothed ? 1000 / 60 : 0);
    const data = smoothed;
    scene.draw(10000 + index * 1000 / 60, { getFrequencyData: () => data, meters: () => ({ sampleRate: 48000 }) });
    frames.push(frame.strokes.filter((_, stroke) => stroke % 2 === 0));
  }
  return frames.slice(120);
}

for (const [mode, limit] of [["waveform", 14], ["particles", 10], ["pulse", 8]]) {
  test(`${mode} draws up to ${limit} galaxy-style glints`, () => {
    const frames = run(mode);
    const counts = frames.map(glints => glints.length);
    const visible = frames.map(glints => glints.filter(alpha => alpha > .1).length);
    const average = visible.reduce((sum, count) => sum + count, 0) / visible.length;
    assert.ok(Math.max(...counts) <= limit, `${mode}: ${Math.max(...counts)} glints in one frame`);
    assert.ok(average > limit * .4, `${mode}: only ${average.toFixed(1)} visible glints on average`);
  });
}

test("ECO mode draws no glints", () => {
  for (const mode of ["waveform", "particles", "pulse"])
    assert.equal(run(mode, { ...settings, lowPerformance: true }, 4).flat().length, 0);
});

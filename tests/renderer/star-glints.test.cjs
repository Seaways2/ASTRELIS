// Runs the real scenes against a context that records glint strokes, and
// checks how many glints show, that they ease in, and that ECO draws none.
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

// Star spikes are the only gradients with a stop at .44; each spike is two
// strokes, so a glint is counted once per pair, keyed by its centre.
function spikeCanvas(frame) {
  const state = { globalAlpha: 1 };
  const context = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "createLinearGradient") return (x0, y0, x1, y1) => ({
        addColorStop(offset) { if (offset === .44) frame.spikes.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, alpha: state.globalAlpha }); }
      });
      if (key === "createRadialGradient") return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  return { width: 300, height: 150, getContext: () => context };
}
globalThis.OffscreenCanvas = class { constructor(width, height) { Object.assign(this, spikeCanvas({ spikes: [] }), { width, height }); } };
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

function run(mode, sceneSettings = settings, seconds = 12) {
  const frame = { spikes: [] };
  const scene = createVisualizerScene(spikeCanvas(frame), { mode, accent: "#38d3e1", settings: sceneSettings, glowStrength: 1, playbackActive: true, backgroundBrightness: 1, backgroundOpacity: 1 });
  scene.resize(layout);
  const frames = [];
  let smoothed;
  for (let index = 0; index < seconds * 60; index++) {
    frame.spikes = [];
    smoothed = smoothFrequencyFrame(song(index / 60), smoothed, .76, smoothed ? 1000 / 60 : 0);
    const data = smoothed;
    scene.draw(10000 + index * 1000 / 60, { getFrequencyData: () => data, meters: () => ({ sampleRate: 48000 }) });
    frames.push(frame.spikes.filter((_, spike) => spike % 2 === 0));
  }
  return frames.slice(120);
}

for (const [mode, limit] of [["particles", 4], ["pulse", 3]]) {
  test(`${mode} shows a few star spikes, eased in and out`, () => {
    const frames = run(mode);
    const strong = frames.map(spikes => spikes.filter(spike => spike.alpha > .3).length);
    const average = strong.reduce((sum, count) => sum + count, 0) / strong.length;
    assert.ok(average > .5, `${mode}: only ${average.toFixed(2)} visible spikes on average`);
    assert.ok(average <= limit + .5, `${mode}: ${average.toFixed(2)} visible spikes on average, limit ${limit}`);
    // Fading ones may overlap a swap, but never a crowd.
    assert.ok(Math.max(...strong) <= limit * 2, `${mode}: ${Math.max(...strong)} spikes at once`);
    // A spike swells in: none appears already bright where none was before.
    // Spikes follow their stars, and nearer starfield stars move tens of
    // pixels a frame; with only a few spikes on screen 80 px cannot mismatch.
    for (let index = 1; index < frames.length; index++) {
      for (const spike of frames[index]) {
        const before = frames[index - 1].find(other => Math.hypot(other.x - spike.x, other.y - spike.y) < 80);
        assert.ok(before || spike.alpha < .3, `${mode}: a spike appeared at alpha ${spike.alpha.toFixed(2)}`);
      }
    }
  });
}

test("ECO mode draws no star spikes", () => {
  for (const mode of ["particles", "pulse"])
    assert.equal(run(mode, { ...settings, lowPerformance: true }, 6).flat().length, 0);
});

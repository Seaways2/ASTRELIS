// Shared harness for visualizer behaviour tests: loads the real scene code
// (TypeScript transpiled in memory), feeds it spectra through the app's own
// frame smoothing, and measures what it draws.
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

const palette = load("src/visualizers/galaxyPalette.ts");
const modules = {
  "./framePacing": load("src/visualizers/framePacing.ts"),
  "./galaxyPalette": palette,
  "./musicDynamics": load("src/visualizers/musicDynamics.ts")
};
const { createVisualizerScene, visualizerTargetFps } = load("src/visualizers/visualizerScene.ts", name => modules[name]);
const { smoothFrequencyFrame } = load("src/utils/frequencySmoothing.ts");
const { MusicDynamics } = modules["./musicDynamics"];

const defaultSettings = { smoothing: .76, sensitivity: 1, barCount: 90, barOpacity: 1, lineWidth: 1.5, animationSpeed: 1, decaySpeed: 1, peakHoldMs: 650, lowPerformance: false };
const layoutOf = (width, height) => ({ width, height, ratio: 1, left: 0, top: 0, cssWidth: width, cssHeight: height, viewportWidth: width, viewportHeight: height });

/**
 * A 2D context that adds up the light each frame emits: globalAlpha × area of
 * every additive ("lighter") fill, rect, image and stroke. Not a renderer, but
 * a faithful relative measure of how bright the frame is.
 */
function lightCanvas(meter) {
  const gradient = { addColorStop() {} };
  let radius = 0, pathLength = 0, lastX = 0, lastY = 0;
  const state = { globalAlpha: 1, globalCompositeOperation: "source-over", lineWidth: 1 };
  const add = amount => { if (state.globalCompositeOperation === "lighter") meter.light += state.globalAlpha * amount; };
  const methods = {
    beginPath() { radius = 0; pathLength = 0; },
    arc(x, y, r) { radius = Math.max(radius, r); },
    fill() { add(Math.PI * radius * radius); },
    fillRect(x, y, w, h) { add(Math.abs(w * h)); },
    drawImage(image, x, y, w, h) { add((w ?? image.width) * (h ?? image.height)); },
    moveTo(x, y) { lastX = x; lastY = y; },
    lineTo(x, y) { pathLength += Math.hypot(x - lastX, y - lastY); lastX = x; lastY = y; },
    stroke() { add(pathLength * state.lineWidth); },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient
  };
  const context = new Proxy(state, {
    get: (target, key) => key in target ? target[key] : methods[key] || (() => undefined),
    set: (target, key, value) => { target[key] = value; return true; }
  });
  return { width: 300, height: 150, getContext: () => context };
}

const installCanvasGlobals = () => {
  globalThis.OffscreenCanvas = class { constructor(width, height) { Object.assign(this, lightCanvas({ light: 0 }), { width, height }); } };
  globalThis.Path2D = class { moveTo() {} lineTo() {} arc() {} };
};

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));

/**
 * A 34-second song at 120 BPM as 256-bin analyser frames (93.75 Hz bins):
 * verse, a louder chorus, a drumless break, then the drums return.
 */
const songSections = [
  { name: "verse", from: 0, to: 10, kick: 215, bass: 150, pad: 140, hats: 90 },
  { name: "chorus", from: 10, to: 20, kick: 240, bass: 170, pad: 162, hats: 130 },
  { name: "break", from: 20, to: 26, kick: 0, bass: 0, pad: 118, hats: 0 },
  { name: "drop", from: 26, to: 34, kick: 245, bass: 170, pad: 160, hats: 130 }
];
function song(seed = 11) {
  let state = seed;
  const random = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  return t => {
    const section = songSections.find(part => t >= part.from && t < part.to) || songSections[songSections.length - 1];
    const bins = new Uint8Array(256);
    const kick = section.kick ? Math.exp(-(t % .5) / .12) : 0;
    const note = Math.floor(t / .25), age = t % .25;
    const bass = section.bass ? (section.bass + ((note * 37) % 5) * 8) * (age < .03 ? age / .03 : 1 - (age - .03) * .4) : 0;
    const syllable = .5 + .5 * Math.sin(t * 2 * Math.PI * 3.3);
    const hat = section.hats ? section.hats * Math.exp(-(t % .25) / .05) : 0;
    for (let index = 0; index < 256; index++) {
      let value = 0;
      if (index < 4) value = Math.max(value, (section.kick ? 60 + (section.kick - 60) * kick : 0) * [1, .95, .7, .4][index]);
      if (index < 3) value = Math.max(value, bass * [.75, 1, .8][index]);
      if (index >= 1 && index < 30) value = Math.max(value, (section.pad - index * 1.2) * (.85 + .15 * syllable));
      if (index >= 25 && index < 100) value = Math.max(value, Math.max(55, hat) - (index - 25) * .5);
      bins[index] = clamp(value ? value + (random() - .5) * 12 : 0);
    }
    return bins;
  };
}

/**
 * Runs a scene over `frames` (a function of time returning raw 256-bin
 * spectra, or an array of already smoothed frames) at 60 FPS and returns the
 * light of every frame.
 */
function runScene(mode, frames, { seconds = 34, settings = defaultSettings, width = 1600, height = 900, glowStrength = 1 } = {}) {
  installCanvasGlobals();
  const meter = { light: 0 };
  const scene = createVisualizerScene(lightCanvas(meter), { mode, accent: "#38d3e1", settings, glowStrength, playbackActive: true, backgroundBrightness: 1, backgroundOpacity: 1 });
  scene.resize(layoutOf(width, height));
  const count = Array.isArray(frames) ? frames.length : Math.round(seconds * 60);
  const lights = new Float64Array(count);
  let smoothed;
  for (let index = 0; index < count; index++) {
    let data;
    if (Array.isArray(frames)) data = frames[index];
    else {
      smoothed = smoothFrequencyFrame(frames(index / 60), smoothed, settings.smoothing, smoothed ? 1000 / 60 : 0);
      data = smoothed;
    }
    meter.light = 0;
    scene.draw(10000 + index * 1000 / 60, { getFrequencyData: () => data, meters: () => ({ sampleRate: 48000 }) });
    lights[index] = meter.light;
  }
  return lights;
}

module.exports = {
  load, palette, createVisualizerScene, visualizerTargetFps, smoothFrequencyFrame, MusicDynamics,
  defaultSettings, layoutOf, lightCanvas, installCanvasGlobals, song, songSections, runScene, clamp
};

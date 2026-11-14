// Runs the real visualizer scene against a recording 2D context: no DOM, no
// window, exactly what the visualizer worker provides.
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
const pacing = load("src/visualizers/framePacing.ts");
const { createVisualizerScene, visualizerTargetFps } = load("src/visualizers/visualizerScene.ts", () => pacing);

// Every property read is a no-op function or a settable slot; gradient and
// pattern factories return objects that accept color stops. Calls are counted.
function recordingCanvas() {
  const calls = new Map();
  const state = {};
  const gradient = { addColorStop() {} };
  const context = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        calls.set(key, (calls.get(key) || 0) + 1);
        if (key === "createLinearGradient" || key === "createRadialGradient" || key === "createConicGradient") return gradient;
        if (key === "measureText") return { width: 0 };
        return undefined;
      };
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  const canvas = { width: 300, height: 150, getContext: () => context };
  return { canvas, calls };
}

globalThis.OffscreenCanvas = class { constructor(width, height) { Object.assign(this, recordingCanvas().canvas, { width, height }); } };
globalThis.Path2D = class { moveTo() {} lineTo() {} arc() {} ellipse() {} closePath() {} bezierCurveTo() {} quadraticCurveTo() {} };

const settings = { smoothing: .7, sensitivity: 1, barCount: 160, barOpacity: .9, lineWidth: 2, animationSpeed: 1, decaySpeed: 1, peakHoldMs: 600, lowPerformance: false };
const options = mode => ({ mode, accent: "#38d3e1", settings, glowStrength: 1, playbackActive: true, backgroundBrightness: 1, backgroundOpacity: 1 });
const layout = { width: 1280, height: 720, ratio: 1, left: 0, top: 0, cssWidth: 1280, cssHeight: 720, viewportWidth: 1280, viewportHeight: 720 };
const frequency = Uint8Array.from({ length: 256 }, (_, index) => Math.max(0, 230 - index));
const audio = { getFrequencyData: () => frequency, meters: () => ({ left: .5, right: .5, peak: .6, rms: .4, low: .5, mid: .4, high: .3, sampleRate: 48000 }) };

for (const mode of ["waveform", "particles", "pulse", "spectrum", "mirror", "radial"]) {
  test(`${mode} draws from posted audio and layout alone`, () => {
    const { canvas, calls } = recordingCanvas();
    const scene = createVisualizerScene(canvas, options(mode));
    scene.resize(layout);
    assert.equal(canvas.width, 1280);
    assert.equal(canvas.height, 720);
    for (let frame = 0; frame < 12; frame++) scene.draw(1000 + frame * 1000 / 60, audio);
    const drawCalls = ["fillRect", "fill", "stroke", "drawImage", "arc"].reduce((sum, key) => sum + (calls.get(key) || 0), 0);
    assert.ok(drawCalls > 0, `${mode} drew nothing`);
  });
}

test("the scene paces itself to its target frame rate", () => {
  const fpsReports = [];
  const { canvas, calls } = recordingCanvas();
  const lowPower = { ...options("spectrum"), settings: { ...settings, lowPerformance: true } };
  assert.equal(visualizerTargetFps(lowPower), 30);
  assert.equal(visualizerTargetFps({ ...lowPower, playbackActive: false }), 15);
  const scene = createVisualizerScene(canvas, lowPower, fps => fpsReports.push(fps));
  scene.resize(layout);
  // Two seconds of 60 Hz display frames on the clock the FPS meter started from.
  const start = performance.now();
  for (let frame = 0; frame <= 120; frame++) scene.draw(start + frame * 1000 / 60, audio);
  const drawn = calls.get("clearRect") || 0;
  assert.ok(drawn >= 58 && drawn <= 62, `drew ${drawn} frames in 2 s at a 30 FPS target`);
  assert.ok(fpsReports.length >= 2 && fpsReports.every(fps => fps >= 28 && fps <= 32), String(fpsReports));
});

test("the black-hole lens samples the wallpaper bitmap it was given", () => {
  const { canvas, calls } = recordingCanvas();
  const scene = createVisualizerScene(canvas, options("pulse"));
  scene.resize(layout);
  scene.draw(1000, audio);
  const withoutLens = calls.get("drawImage") || 0;
  scene.setLensImage({ width: 1920, height: 1080 });
  scene.draw(1100, audio);
  assert.ok((calls.get("drawImage") || 0) - withoutLens >= 10, "lens rings did not draw the wallpaper");
});

test("the page hands the canvas to one shared worker and posts paced analyser frames", () => {
  const host = fs.readFileSync(path.join(root, "src/visualizers/visualizerHost.ts"), "utf8");
  const worker = fs.readFileSync(path.join(root, "src/workers/visualizer.worker.ts"), "utf8");
  assert.match(host, /new Worker\(new URL\("\.\.\/workers\/visualizer\.worker\.ts", import\.meta\.url\), \{ type: "module" \}\)/);
  assert.match(host, /if \(sharedWorker !== undefined\) return sharedWorker;/);
  assert.match(host, /canvas\.transferControlToOffscreen\(\)/);
  assert.match(host, /const frequency = audioEngine\.getFrequencyData\(\)\.slice\(\);\s*this\.post\(\{ type: "audio", frequency, meters: audioEngine\.meters\(\) \}, \[frequency\.buffer\]\);/);
  // Without OffscreenCanvas the same scene draws on the page.
  assert.match(host, /this\.scene\?\.draw\(now, audioEngine\);/);
  // The worker keeps animating on its own clock with the latest frame.
  assert.match(worker, /scope\.requestAnimationFrame\(tick\)/);
  assert.match(worker, /surface\.scene\.draw\(now, audio\)/);
  assert.doesNotMatch(worker, /audioEngine|document\./);
});

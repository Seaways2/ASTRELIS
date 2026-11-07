const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname,"../..");
const read = relative => fs.readFileSync(path.join(root,relative),"utf8");

test("GPU lighting defaults on while preserving a saved manual opt-out", () => {
  const store = read("src/stores/playerStore.ts");
  assert.match(store,/gpuAccelerationEnabled: boolean/);
  assert.match(store,/gpuQuality: GpuVisualQuality/);
  assert.match(store,/gpuAccelerationEnabled: true/);
  assert.match(store,/gpuQuality: "standard"/);
  assert.match(store,/stored\.gpuAccelerationEnabled !== false/);
  assert.match(store,/stored\.gpuQuality === "eco" \|\| stored\.gpuQuality === "cosmic"/);
});

test("capability probing respects Chromium safety decisions", () => {
  const runtime = read("src/visualizers/gpuVisualRuntime.ts");
  assert.match(runtime,/getContext\("webgl2"/);
  assert.match(runtime,/failIfMajorPerformanceCaveat: true/);
  assert.match(runtime,/WEBGL_lose_context/);
  assert.doesNotMatch(runtime,/ignore-gpu-blocklist|disable-gpu-driver-bug-workarounds|use-gl=/,
    "the renderer must not bypass Chromium's GPU blacklist");
});

test("Canvas 2D owns every scene while GPU FX stays in the compositor", () => {
  const app = read("src/App.tsx");
  const canvas = read("src/visualizers/VisualizerCanvas.tsx");
  const styles = read("src/styles/global.css");
  const overview = read("src/visualizers/VisualizerOverview.tsx");
  assert.match(canvas,/return <canvas ref=\{ref\} className="visualizer-canvas"/);
  assert.doesNotMatch(canvas,/GpuBlackHoleCanvas|GpuGalaxyCanvas|GpuStarfieldCanvas|gpuSceneActive/,
    "GPU prototypes must not replace the tuned Canvas 2D scenes");
  assert.doesNotMatch(overview,/gpuConfig=/,
    "overview thumbnails must remain low-rate Canvas 2D scenes");
  assert.match(app,/gpuEffectsRequested[\s\S]{0,100}&& !lowPerformanceMode[\s\S]{0,80}&& !state\.obsMode/);
  assert.match(app,/gpu-effects-on gpu-effects-\$\{gpuEffectsQuality\}/);
  assert.doesNotMatch(app,/2D \+ GPU FX/,
    "the removed performance readout must not return to the player chrome");
  assert.match(styles,/\.app-shell\.gpu-effects-on::after/,
    "the compositor must own the global ambient-light layer");
  assert.match(styles,/\.app-shell\.gpu-effects-on \.visual-area \.visualizer-canvas[\s\S]{0,500}drop-shadow/,
    "the compositor must bloom the transparent 2D canvas without redrawing it");
  assert.match(styles,/\.app-shell\.low-performance-mode::after[\s\S]{0,80}display: none/);
  assert.match(styles,/transform: translateZ\(0\)/,
    "post effects should be promoted to a compositor layer");
});


test("GPU controls merge the capability-aware switch and fixed quality selector", () => {
  const app = read("src/App.tsx");
  const workspace = read("src/components/WorkspacePage.tsx");
  const locale = read("src/i18n/index.ts");
  assert.match(workspace,/gpu-render-module/);
  assert.match(workspace,/gpu-master-switch/);
  assert.match(workspace,/gpu-quality-field/);
  assert.match(workspace,/gpuAccelerationEnabled && gpuCapabilities\.webgl2/);
  assert.doesNotMatch(workspace,/gpuAutoQuality|appearance\.gpuAuto/);
  assert.doesNotMatch(app,/gpuAutoQuality/);
  assert.doesNotMatch(read("src/visualizers/gpuVisualRuntime.ts"),/autoQuality|lowerGpuQuality|consecutiveSlowWindows/);
  assert.match(workspace,/probeGpuVisualCapabilities/);
  for (const key of ["appearance.gpuAcceleration","appearance.gpuQuality"]) {
    assert.equal(locale.split(`"${key}"`).length - 1,3,`${key} must exist in all three locales`);
  }
  assert.doesNotMatch(locale,/appearance\.gpuAuto/);
});

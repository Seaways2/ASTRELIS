const { readAppSource } = require("./helpers/appSource.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const canvas = read("src/visualizers/visualizerScene.ts");

test("Galaxy Spiral replaces the waveform renderer without changing its persisted mode id", () => {
  const dictionary = read("src/i18n/index.ts");
  assert.match(dictionary, /"mode\.waveform": "银河旋涡"/);
  assert.match(dictionary, /"mode\.waveform": "Galaxy Spiral"/);
  assert.match(dictionary, /"mode\.waveform": "銀河スパイラル"/);
  assert.doesNotMatch(canvas, /getWaveformData\(\)/);
  assert.match(canvas, /if \(mode === "waveform"\)/);
});

test("galaxy, starfield and black hole lead the mode tabs, bar spectra follow", () => {
  const app = readAppSource();
  assert.match(app, /\{ id: "waveform", key: "mode\.waveform" \}, \{ id: "particles", key: "mode\.particles" \}, \{ id: "pulse", key: "mode\.pulse" \},\s*\{ id: "spectrum", key: "mode\.spectrum" \}, \{ id: "mirror", key: "mode\.mirror" \}, \{ id: "radial", key: "mode\.radial" \}/);
  assert.doesNotMatch(app, /"overview"|VisualizerOverview/);
  const types = read("src/utils/visualizerMode.ts");
  assert.match(types, /export const DEFAULT_VISUALIZER_MODE: VisualizerMode = "waveform";/);
  const store = read("src/stores/playerStore.ts");
  // First launch, and any saved retired mode, open the galaxy.
  assert.match(store, /\? normalizeVisualizerMode\(localStorage\.getItem\("auralis\.visualizer"\)\)\s*: DEFAULT_VISUALIZER_MODE,/);
  assert.match(store, /const visualizer = normalizeVisualizerMode\(mode\);/);
});

test("Galaxy Spiral uses cached differential dust layers and a bounded live layer", () => {
  assert.match(canvas, /galaxyDustPerEffectUnit = settings\.lowPerformance \? 8 : 24/);
  assert.match(canvas, /galaxyLiveStarsPerEffectUnit = settings\.lowPerformance \? 3 : 6/);
  assert.match(canvas, /galaxyLayers = Array\.from\(\{ length: 3 \}/);
  assert.match(canvas, /if \(changed \|\| galaxyLayerSize === 0\) rebuildGalaxyLayers\(\)/);
  assert.match(canvas, /const layerSpeed = \[1\.32, \.92, \.62\]/);
  assert.match(canvas, /context\.drawImage\(layer, -galaxyLayerSize \/ 2/);
});

test("Galaxy Spiral maps the existing tuning controls to its renderer", () => {
  for (const token of [
    "settings.barCount", "settings.lineWidth", "settings.animationSpeed", "settings.barOpacity",
    "settings.smoothing", "settings.sensitivity", "settings.decaySpeed", "settings.peakHoldMs",
    "settings.lowPerformance", "glowStrength"
  ]) assert.match(canvas, new RegExp(token.replace(".", "\\.")));
  const dictionary = read("src/i18n/index.ts");
  assert.match(dictionary, /特效透明度/);
  assert.match(dictionary, /Effect Opacity/);
  assert.match(dictionary, /エフェクト透明度/);
});

test("Galaxy Spiral separates musical bands and reinforces a traveling density ridge", () => {
  assert.match(canvas, /galaxyLow \+= \(music\.low - galaxyLow\)/);
  assert.match(canvas, /galaxyMid \+= \(music\.mid - galaxyMid\)/);
  assert.match(canvas, /galaxyHigh \+= \(music\.high - galaxyHigh\)/);
  assert.match(canvas, /galaxyRotationVelocity/);
  assert.match(canvas, /if \(music\.beatHit && galaxyWaveProgress >= 1\) galaxyWaveProgress = 0/);
  assert.match(canvas, /if \(music\.beatRising\) galaxyWaveStrength = Math\.max\(galaxyWaveStrength, music\.beatStrength\)/);
});

test("Galaxy Spiral derives luminous layers from the active accent", () => {
  const galaxyBlock = canvas.match(/if \(mode === "waveform"\) \{[\s\S]*?\} else if \(mode === "pulse"\)/)?.[0] || "";
  // Every galaxy colour comes from the accent through galaxyPalette.
  assert.match(canvas, /const palette = galaxyPalette\(\[accentRed, accentGreen, accentBlue\]\);/);
  assert.match(canvas, /layerContext\.fillStyle = accent/);
  assert.match(canvas, /diskGlow\.addColorStop\(\.38, accent\)/);
  assert.match(canvas, /core\.addColorStop\(\.46, galaxyAccent\(\.36\)\)/);
  assert.doesNotMatch(galaxyBlock, /#[0-9a-f]{6}/i);
  assert.doesNotMatch(read("src/visualizers/galaxyPalette.ts"), /#[0-9a-f]{6}/i);
});

test("Galaxy Spiral borrows independently rotating elliptical motes from Black Hole Pulse", () => {
  assert.match(canvas, /galaxyInnerOrbitMoteCount = settings\.lowPerformance/);
  assert.match(canvas, /galaxyInnerOrbitMotes = Array\.from/);
  assert.match(canvas, /galaxyOrbitMoteCount = settings\.lowPerformance/);
  assert.match(canvas, /galaxyOrbitMotes = Array\.from/);
  assert.match(canvas, /\[galaxyInnerOrbitMotes, galaxyOrbitMotes\]/);
  assert.match(canvas, /mote\.angle \+= deltaSeconds \* mote\.speed \* settings\.animationSpeed/);
  assert.match(canvas, /sin \* orbit \* \(\.46 \+ Math\.abs\(mote\.tilt\) \* \.34\)/);
  assert.match(canvas, /context\.arc\(x, y, moteRadius/);
});

test("Galaxy Spiral shares one beat flash across dust, stars, motes, and core", () => {
  // Straight from the shared beat envelope: a second smoothing stage lagged
  // the kick by ~200 ms and kept the scene lit between beats.
  assert.match(canvas, /const galaxySceneFlash = music\.beat \* [\d.]+;/);
  // Flash amounts and fades are tuned against behaviour in visualizer-dynamics.test.cjs, not pinned here.
  assert.doesNotMatch(canvas, /galaxySceneGlow|galaxyBeatTarget/);
});

test("Galaxy Spiral core brightens gradually from its transparent rim to a tiny center", () => {
  assert.match(canvas, /const galaxyAccent = \(alpha: number\)/);
  assert.match(canvas, /const coreBreath = \.5 \+ Math\.sin/);
  // Near-white centre, warm bulge, then the accent out to a clear rim.
  assert.match(canvas, /core\.addColorStop\(0, rgba\(palette\.core, \.95\)\)/);
  assert.match(canvas, /core\.addColorStop\(\.08, rgba\(palette\.core, \.72\)\)/);
  assert.match(canvas, /core\.addColorStop\(\.24, rgba\(palette\.warm, \.62\)\)/);
  assert.match(canvas, /core\.addColorStop\(\.82, galaxyAccent\(\.07\)\)/);
  assert.match(canvas, /core\.addColorStop\(1, "transparent"\)/);
});

test("Galaxy Spiral renders a full-frame twinkling background star field", () => {
  assert.match(canvas, /const backgroundBeatFlash = galaxySceneFlash \*/);
  assert.match(canvas, /const backgroundStarRadius = Math\.max/);
  assert.match(canvas, /galaxyBackgroundGlow = Math\.min\(\.11/);
  assert.match(canvas, /star\.x \* width \* \.49/);
  assert.match(canvas, /star\.y \* height \* \.72/);
});

test("Galaxy Spiral reduces the broad fog disk and selectively lifts the existing arm spine", () => {
  assert.match(canvas, /normalizedRadius - \.2\) \/ \.05/);
  assert.match(canvas, /\(\.85 - normalizedRadius\) \/ \.05/);
  assert.match(canvas, /const ridgeCenter = Math\.max\(0, 1 - Math\.abs\(armScatter\)/);
  assert.match(canvas, /const ridgeLift = 1 \+ ridgeBand \* ridgeCenter \* \.16/);
  assert.match(canvas, /brightNode \? \.34 : \.065 \+ Math\.random\(\) \* \.13\) \* ridgeLift/);
  assert.match(canvas, /sharedBeatFlash\) \* barOpacity \* star\.ridgeLift/);
});

test("Galaxy Spiral fog uses four continuous cached paths with two-axis falloff", () => {
  assert.match(canvas, /galaxyFogLayer = createLayer\(\)/);
  assert.match(canvas, /for \(let arm = 0; arm < 4; arm\+\+\)/);
  assert.match(canvas, /const armPath = \(arm: number, angleOffset = 0\) => \{\s*const path = new Path2D\(\);/);
  assert.match(canvas, /for \(let sample = 0; sample <= 96; sample\+\+\)/);
  assert.match(canvas, /fogLayerContext\.lineCap = "round"/);
  // Two clean tones only: a narrow accent haze and a blue-white spine. Extra
  // hues, nebula edges and cut-out dust lanes made the arms look dirty.
  assert.match(canvas, /\{ width: \.16, blur: \.055, color: galaxyAccent\(\.09\) \}/);
  assert.match(canvas, /\{ width: \.045, blur: \.014, color: rgba\(palette\.ice, \.1\) \}/);
  assert.match(canvas, /fogLayerContext\.stroke\(armFogPath\)/);
  assert.doesNotMatch(canvas, /destination-out|palette\.analog|knotCount/);
  assert.match(canvas, /fogLayerContext\.globalCompositeOperation = "destination-in"/);
  assert.match(canvas, /fogLengthFade\.addColorStop\(\.12, "rgba\(255,255,255,\.08\)"\)/);
  assert.match(canvas, /fogLengthFade\.addColorStop\(\.88, "rgba\(255,255,255,\.24\)"\)/);
  assert.match(canvas, /context\.drawImage\(galaxyFogLayer, -galaxyLayerSize \/ 2/);
});

test("Galaxy Spiral adds crisp jewel stars, coloured stars, glints and core diffraction spikes", () => {
  // Jewel stars in the opposite hue are crisp points with a small halo, never soft blotches.
  assert.match(canvas, /const jewelShare = layerIndex === 0 \? 0 : settings\.lowPerformance \? \.008 : \.016;/);
  assert.match(canvas, /layerContext\.globalAlpha = \(jewel \? \.9 : brightNode \? \.34/);
  // Live stars are drawn per colour group, four fill-style changes per frame.
  assert.match(canvas, /galaxyLiveStarGroups\.forEach\(group => \{ context\.fillStyle = group\.color;/);
  assert.match(canvas, /const glintLimit = settings\.lowPerformance \? 0 : mode === "waveform" \? 14 :/);
  // The strongest glints win, and each fades in from the threshold.
  assert.match(canvas, /if \(glintStrength > GLINT_THRESHOLD && glintLimit && galaxyGlow > 0\)/);
  assert.match(canvas, /glints\.sort\(\(a, b\) => b\.strength - a\.strength\);\s*glints\.length = glintLimit;/);
  assert.match(canvas, /const visibility = Math\.min\(1, \(glint\.strength - GLINT_THRESHOLD\) \/ \(1 - GLINT_THRESHOLD\)\);/);
  assert.match(canvas, /drawGlints\(glints, galaxyGlow\);/);
  assert.match(canvas, /const spikeLength = coreRadius \*/);
});

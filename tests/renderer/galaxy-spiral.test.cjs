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
  assert.match(canvas, /averageHz\(40, 180\)/);
  assert.match(canvas, /averageHz\(180, 2000\)/);
  assert.match(canvas, /averageHz\(2000, 8000\)/);
  assert.match(canvas, /galaxyRotationVelocity/);
  assert.match(canvas, /if \(galaxyWaveProgress >= 1\) galaxyWaveProgress = 0/);
  assert.match(canvas, /galaxyWaveStrength = Math\.max\(galaxyWaveStrength, beatStrength\)/);
});

test("Galaxy Spiral derives luminous layers from the active accent", () => {
  const galaxyBlock = canvas.match(/if \(mode === "waveform"\) \{[\s\S]*?\} else if \(mode === "pulse"\)/)?.[0] || "";
  assert.match(canvas, /layerContext\.fillStyle = accent/);
  assert.match(canvas, /diskGlow\.addColorStop\(\.12, accent\)/);
  assert.match(canvas, /core\.addColorStop\(\.24, galaxyAccent\(\.62\)\)/);
  assert.doesNotMatch(galaxyBlock, /#[0-9a-f]{6}/i);
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

test("Galaxy Spiral shares one softened scene flash across dust, stars, motes, and core", () => {
  assert.match(canvas, /galaxyBassLevel[\s\S]*rawLow > galaxyBassLevel \? 9 : 2\.2/);
  assert.match(canvas, /currentTime - lastGalaxyBeatAt > \.16/);
  assert.match(canvas, /galaxyBeatFadeSpeed = galaxyBeatTarget > galaxyBeatFlash \? 12 : 3\.2/);
  assert.match(canvas, /galaxySceneFadeSpeed = galaxyBeatFlash > galaxySceneGlow/);
  assert.match(canvas, /\? 9\.2 \+ \(1 - smoothing\) \* 1\.8/);
  assert.match(canvas, /: 2\.7 \+ \(1 - smoothing\) \* \.5/);
  assert.match(canvas, /galaxySceneFlash = Math\.min\(\.74, galaxySceneGlow \* \.86\)/);
  assert.match(canvas, /sharedBeatFlash = galaxySceneFlash \* \(\.4 \+ star\.response \* \.22\)/);
  assert.match(canvas, /moteBeatFlash = galaxySceneFlash \* \(\.4 \+ mote\.response \* \.22\)/);
  assert.match(canvas, /galaxyMid \* \.22 \+ galaxySceneFlash \* \.16/);
  assert.match(canvas, /galaxyLow \* \.18 \+ galaxySceneFlash \* \.24/);
});

test("Galaxy Spiral core brightens gradually from its transparent rim to a tiny center", () => {
  assert.match(canvas, /const galaxyAccent = \(alpha: number\)/);
  assert.match(canvas, /const coreBreath = \.5 \+ Math\.sin/);
  assert.match(canvas, /core\.addColorStop\(0, "rgba\(250,255,255,\.9\)"\)/);
  assert.match(canvas, /core\.addColorStop\(\.08, "rgba\(250,255,255,\.66\)"\)/);
  assert.match(canvas, /core\.addColorStop\(\.24, galaxyAccent\(\.62\)\)/);
  assert.match(canvas, /core\.addColorStop\(\.82, galaxyAccent\(\.07\)\)/);
  assert.match(canvas, /core\.addColorStop\(1, "transparent"\)/);
  assert.match(canvas, /galaxySceneFlash \* \.24 \+ coreBreath \* \.025/);
});

test("Galaxy Spiral renders a full-frame twinkling background star field", () => {
  assert.match(canvas, /const backgroundBeatFlash = galaxySceneFlash \* \(\.4 \+ star\.response \* \.22\)/);
  assert.match(canvas, /const backgroundStarRadius = Math\.max/);
  assert.match(canvas, /galaxyBackgroundGlow = Math\.min\(\.11/);
  assert.match(canvas, /backgroundBeatFlash \* \.62/);
  assert.match(canvas, /star\.x \* width \* \.49/);
  assert.match(canvas, /star\.y \* height \* \.72/);
});

test("Galaxy Spiral reduces the broad fog disk and selectively lifts the existing arm spine", () => {
  assert.match(canvas, /Math\.min\(\.065, \(\.055 \+ galaxyMid \* \.085 \+ galaxySceneFlash \* \.12 \+ galaxyGlow \* \.025\) \* barOpacity \* \.28\)/);
  assert.match(canvas, /normalizedRadius - \.2\) \/ \.05/);
  assert.match(canvas, /\(\.85 - normalizedRadius\) \/ \.05/);
  assert.match(canvas, /const ridgeCenter = Math\.max\(0, 1 - Math\.abs\(armScatter\)/);
  assert.match(canvas, /const ridgeLift = 1 \+ ridgeBand \* ridgeCenter \* \.16/);
  assert.match(canvas, /layerContext\.globalAlpha = \(brightNode \? \.24 : \.045 \+ Math\.random\(\) \* \.105\) \* ridgeLift/);
  assert.match(canvas, /sharedBeatFlash\) \* barOpacity \* star\.ridgeLift/);
});

test("Galaxy Spiral fog uses four continuous cached paths with two-axis falloff", () => {
  assert.match(canvas, /galaxyFogLayer = createLayer\(\)/);
  assert.match(canvas, /for \(let arm = 0; arm < 4; arm\+\+\)/);
  assert.match(canvas, /const armFogPath = new Path2D\(\)/);
  assert.match(canvas, /for \(let sample = 0; sample <= 96; sample\+\+\)/);
  assert.match(canvas, /fogLayerContext\.lineCap = "round"/);
  assert.match(canvas, /\{ width: \.24, blur: \.065, color: galaxyAccent\(\.062\) \}/);
  assert.match(canvas, /\{ width: \.14, blur: \.042, color: galaxyAccent\(\.052\) \}/);
  assert.match(canvas, /fogLayerContext\.stroke\(armFogPath\)/);
  assert.match(canvas, /fogLayerContext\.globalCompositeOperation = "destination-in"/);
  assert.match(canvas, /fogLengthFade\.addColorStop\(\.12, "rgba\(255,255,255,\.08\)"\)/);
  assert.match(canvas, /fogLengthFade\.addColorStop\(\.88, "rgba\(255,255,255,\.24\)"\)/);
  assert.match(canvas, /context\.drawImage\(galaxyFogLayer, -galaxyLayerSize \/ 2/);
});

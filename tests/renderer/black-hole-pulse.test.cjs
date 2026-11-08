const { readAppSource } = require("./helpers/appSource.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "src/visualizers/VisualizerCanvas.tsx"), "utf8");

test("Black Hole Pulse separates bass, mid, and high-frequency responses", () => {
  assert.match(source, /averageHz\(40, 180\)/);
  assert.match(source, /averageHz\(180, 2000\)/);
  assert.match(source, /averageHz\(2000, 8000\)/);
  assert.match(source, /pulseMidLevel/);
  assert.match(source, /pulseHighLevel/);
});

test("Black Hole Pulse uses a softened beat envelope and continuous body rebound", () => {
  assert.match(source, /pulseBeatTarget = beatStrength/);
  assert.match(source, /beatFadeSpeed = pulseBeatTarget > pulseBeat \? 12 : 3\.2/);
  assert.match(source, /pulseCoreVelocity = Math\.max\(-\.04, pulseCoreVelocity - beatStrength \* \.026\)/);
  assert.match(source, /pulseCoreVelocity \+= \(-pulseCoreMotion \* 30 - pulseCoreVelocity \* 7\.5\) \* springStep/);
  assert.match(source, /pulseCoreMotion \+= pulseCoreVelocity \* springStep/);
  assert.doesNotMatch(source, /Math\.sin\(beatAge \* 14 - Math\.PI \/ 2\)/);
});

test("Black Hole Pulse adds shockwaves and gravitational lensing", () => {
  assert.match(source, /pulseShockwaves\.push/);
  assert.match(source, /lensedDistance/);
  assert.match(source, /bentAngle/);
});

test("Black Hole Pulse refracts the custom wallpaper through concentric lens rings", () => {
  const app = readAppSource();
  assert.match(app, /backgroundUrl=\{customBackgroundActive \? state\.uiSettings\.customBackgroundUrl : undefined\}/);
  assert.match(source, /lensBackground = backgroundUrl \? new Image\(\) : undefined/);
  assert.match(source, /lensRingCount = settings\.lowPerformance \? 10 : 18/);
  assert.match(source, /distortionProfile = Math\.pow\(Math\.sin\(middleMix \* Math\.PI\), 1\.35\)/);
  assert.match(source, /context\.clip\("evenodd"\)/);
  assert.match(source, /context\.scale\(refractionScale, 1 \+ \(refractionScale - 1\) \* \.82\)/);
  assert.match(source, /context\.drawImage\(lensBackground, imageX, imageY, imageWidth, imageHeight\)/);
});

test("Black Hole Pulse reuses effect count and size with an ECO cap", () => {
  assert.match(source, /coreMoteCount[\s\S]*particleUnits \* \.8[\s\S]*particleUnits \* 1\.4/);
  assert.match(source, /pulseOrbitCount = settings\.lowPerformance \? 4 : 6/);
  assert.match(source, /pulseEffectScale = \.72 \+ settings\.lineWidth \* \.19/);
});

test("Black Hole Pulse shockwaves use soft radial and line gradients", () => {
  assert.match(source, /createRadialGradient\(0, 0, radius \* \.76, 0, 0, radius \* 1\.22\)/);
  assert.match(source, /waveGlow\.addColorStop\(\.69, "transparent"\)/);
  assert.match(source, /makeLineGradient\(-radius, radius/);
  assert.doesNotMatch(source, /wave\.strength \* fade \* \.34/);
});

test("Black Hole Pulse shockwaves expand independently from later beat contractions", () => {
  assert.match(source, /shockwaveUnitRadius = scale \* \.073 \* pulseEffectScale/);
  assert.match(source, /wave\.radius \+= shockwaveUnitRadius \* 7\.2 \* travelStep/);
  assert.match(source, /radius = wave\.radius/);
  assert.doesNotMatch(source, /radius = coreRadius \* \(1\.45 \+ wave\.progress \* 7\.2\)/);
});

test("Black Hole Pulse reinforces an active outward wave instead of restarting at the core", () => {
  assert.match(source, /travelingWave = pulseShockwaves\.find\(\(wave\) => wave\.progress < 1\)/);
  assert.match(source, /travelingWave\.strength = Math\.max\(travelingWave\.strength, beatStrength\)/);
  assert.doesNotMatch(source, /progress: -\.13/);
});

test("Black Hole Pulse shockwaves stay subdued", () => {
  assert.match(source, /waveGlow\.addColorStop\(\.53, "rgba\(235,255,255,\.52\)"\)/);
  assert.match(source, /Math\.min\(\.12, wave\.strength \* fade \* \.12\)/);
  assert.match(source, /Math\.min\(\.07, wave\.strength \* fade \* \.07\)/);
});

test("Black Hole Pulse shares a softened beat flash across its body and background stars", () => {
  assert.match(source, /pulseBassLevel[\s\S]*rawLow > pulseBassLevel \? 9 : 2\.2/);
  assert.match(source, /currentTime - lastPulseBeatAt > \.16/);
  assert.match(source, /beatStrength = Math\.min\(\.9, \.42 \+ onset \* 4\.5\)/);
  assert.match(source, /pulseSceneFlash = pulseBeat/);
  assert.match(source, /sharedBeatFlash = pulseSceneFlash \* \(\.4 \+ star\.response \* \.22\)/);
  assert.match(source, /moteBeatFlash = pulseSceneFlash \* \(\.4 \+ mote\.response \* \.22\)/);
  assert.doesNotMatch(source, /pulseBeatGlow/);
  assert.match(source, /low \* \.24 \+ pulseSceneFlash \* \.16 \+ glow \* \.08/);
});

test("Black Hole Pulse maps glow strength across stars, motes, halo, and disk", () => {
  assert.match(source, /pulseStarGlow = Math\.min\(\.24,[\s\S]*\* glow\)/);
  assert.match(source, /moteGlow = Math\.min\(\.28,[\s\S]*\* glow\)/);
  assert.match(source, /outerHaloRadius = haloRadius \* \(1\.08 \+ glow \* \.1\)/);
  assert.match(source, /diskBloom = Math\.min\(\.2, glow \*/);
  assert.ok((source.match(/if \(glow > 0\)/g) || []).length >= 4,
    "zero glow must skip every added Black Hole Pulse glow layer");
});

test("Black Hole Pulse applies effect opacity to every visual layer", () => {
  assert.match(source, /const pulseOpacity = barOpacity/);
  assert.match(source, /pulseStarGlow \* pulseOpacity/);
  assert.match(source, /wave\.strength \* fade \* \.12\) \* pulseOpacity/);
  assert.match(source, /moteGlow \* pulseOpacity/);
  assert.match(source, /diskBloom \* pulseOpacity/);
  assert.match(source, /context\.globalAlpha = pulseOpacity/);
});

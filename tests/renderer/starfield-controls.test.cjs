const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("Starfield Motion maps the shared effect controls to star count and size", () => {
  const canvas = read("src/visualizers/visualizerScene.ts");
  assert.match(canvas, /starsPerEffectUnit = settings\.lowPerformance \? 4 : 8/);
  assert.match(canvas, /starCount = Math\.max\(96, Math\.round\(particleUnits \* starsPerEffectUnit\)\)/);
  assert.match(canvas, /starEffectSize = \.5 \+ settings\.lineWidth \/ 3/);
  assert.match(canvas, /starfieldEffectSize = starEffectSize \* \.6/);
  assert.ok((canvas.match(/starfieldEffectSize/g) || []).length >= 5,
    "the 40% reduction must scale star cores, halos, flashes, and trails together");
  assert.ok((canvas.match(/starEffectSize/g) || []).length >= 5,
    "effect size must scale star cores, halos, flashes, and trails");
  assert.doesNotMatch(canvas, /starCount = settings\.lowPerformance \? 220 : 480/);
});

test("Starfield Motion gives every star a shared low-frequency beat flash", () => {
  const canvas = read("src/visualizers/visualizerScene.ts");
  assert.match(canvas, /bassOnset = Math\.max\(0, rawBass - starBassLevel\)/);
  assert.match(canvas, /starBeatTarget = Math\.min\(\.9, \.42 \+ bassOnset \* 4\.5\)/);
  assert.match(canvas, /beatFadeSpeed = starBeatTarget > starBeatFlash \? 12 : 3\.2/);
  assert.match(canvas, /starBeatFlash \+= \(starBeatTarget - starBeatFlash\)/);
  assert.match(canvas, /musicalFlash = Math\.min\(1\.4,[\s\S]*starBeatFlash \* \(\.4 \+ particle\.response \* \.22\)/);
});

test("Galaxy Spiral and Black Hole Pulse reuse the Starfield Motion beat timing", () => {
  const canvas = read("src/visualizers/visualizerScene.ts");
  assert.ok((canvas.match(/\.42 \+ onset \* 4\.5/g) || []).length >= 2);
  assert.ok((canvas.match(/\? 12 : 3\.2/g) || []).length >= 3);
  assert.match(canvas, /currentTime - lastGalaxyBeatAt > \.16/);
  assert.match(canvas, /currentTime - lastPulseBeatAt > \.16/);
  assert.match(canvas, /starBeatTarget > starBeatFlash \? 12 : 3\.2/);
});

test("Starfield Motion applies effect opacity to trails, stars, halos, and flashes", () => {
  const canvas = read("src/visualizers/visualizerScene.ts");
  assert.match(canvas, /const starfieldOpacity = barOpacity/);
  assert.match(canvas, /shimmer\) \* starfieldOpacity/);
  assert.match(canvas, /musicalFlash\) \* starfieldOpacity/);
  assert.match(canvas, /starGlow\) \* starfieldOpacity/);
  assert.match(canvas, /starGlow \* \.13\)\) \* starfieldOpacity/);
});

test("visualizer controls use effect-oriented labels in every language", () => {
  const dictionary = read("src/i18n/index.ts");
  for (const label of ["特效数量", "Effect Count", "エフェクト数", "特效大小", "Effect Size", "エフェクトサイズ"])
    assert.match(dictionary, new RegExp(label));
});

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
  assert.match(canvas, /const starBeatFlash = music\.beat \* \.62;/);
  assert.match(canvas, /musicalFlash = Math\.min\(1\.4,[\s\S]*starBeatFlash \* \(\.4 \+ particle\.response \* \.22\)/);
});

test("Galaxy Spiral, Starfield Motion and Black Hole Pulse share one beat detector", () => {
  const canvas = read("src/visualizers/visualizerScene.ts");
  assert.match(canvas, /const music = new MusicDynamics\(settings\);/);
  assert.equal((canvas.match(/music\.update\(data, audio\.meters\(\)\.sampleRate/g) || []).length, 3);
  // No scene keeps its own copy of the old absolute-level detector.
  assert.doesNotMatch(canvas, /averageHz|rawBass|onset \* 4\.5/);
});

test("Starfield Motion keeps every sparkle peak at least two frames long", () => {
  const canvas = read("src/visualizers/visualizerScene.ts");
  assert.match(canvas, /const maximumTwinkleRate = visualizerTargetFps\(options\) \* \.175;/);
  assert.match(canvas, /particle\.twinkle \+= deltaSeconds \* Math\.min\(maximumTwinkleRate,/);
});

test("Starfield Motion applies effect opacity to trails, stars, halos, and flashes", () => {
  const canvas = read("src/visualizers/visualizerScene.ts");
  assert.match(canvas, /const starfieldOpacity = barOpacity/);
  assert.match(canvas, /shimmer\) \* trailFade \* starfieldOpacity/);
  assert.match(canvas, /musicalFlash\) \* starfieldOpacity/);
  assert.match(canvas, /starGlow\) \* haloFade \* starfieldOpacity/);
  assert.match(canvas, /starGlow \* \.13\)\) \* flareFade \* starfieldOpacity/);
});

test("Starfield Motion eases flight speed and fades trails, halos and flares in", () => {
  const canvas = read("src/visualizers/visualizerScene.ts");
  assert.match(canvas, /starfieldPace \+= \(targetPace - starfieldPace\)/);
  assert.match(canvas, /particle\.pace \+= \(\.72 \+ particle\.size \* \.2 \+ energy \* \.75 - particle\.pace\) \* paceEase;/);
  assert.match(canvas, /particle\.z -= travel \* particle\.pace;/);
  assert.match(canvas, /const trailFade = Math\.min\(1, Math\.max\(\(depth - \.26\) \/ \.12, \(musicalFlash - \.32\) \/ \.3\)\);/);
  assert.match(canvas, /const flareFade = Math\.min\(1, \(musicalFlash - \.52\) \/ \.35\);/);
});

test("visualizer controls use effect-oriented labels in every language", () => {
  const dictionary = read("src/i18n/index.ts");
  for (const label of ["特效数量", "Effect Count", "エフェクト数", "特效大小", "Effect Size", "エフェクトサイズ"])
    assert.match(dictionary, new RegExp(label));
});

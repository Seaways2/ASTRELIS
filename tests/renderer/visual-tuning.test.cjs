// The tuning panel opens the particle scenes' main amounts to the user: beat
// flash, glint count, the starfield's theme-colour share and the pointer
// strength. Each is read when the scene is built (a settings change rebuilds
// it), defaults to the look before, and is clamped to its slider's range.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runScene, song, defaultSettings } = require("../../scripts/lib/sceneHarness.cjs");
const { loadPlayerStore } = require("./helpers/player-store-harness.cjs");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const spread = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * .95)] - sorted[Math.floor(sorted.length * .05)];
};

test("the beat flash scales with its slider in all three particle scenes", () => {
  for (const mode of ["waveform", "particles", "pulse"]) {
    const swing = flashStrength => spread(runScene(mode, song(), { seconds: 12, settings: { ...defaultSettings, flashStrength } }).slice(120));
    const [none, normal, double] = [swing(0), swing(1), swing(2)];
    assert.ok(none < normal && normal < double, `${mode}: beat swing ${none.toFixed(0)} / ${normal.toFixed(0)} / ${double.toFixed(0)}`);
  }
});

test("the glint slider changes how many glints the scenes may show", () => {
  const total = glintAmount => runScene("waveform", song(), { seconds: 10, settings: { ...defaultSettings, glintAmount } }).reduce((a, b) => a + b, 0);
  assert.ok(total(0) < total(1) && total(1) < total(2), "more glints, more light");
  const scene = read("src/visualizers/visualizerScene.ts");
  assert.match(scene, /\* tuning\(settings\.glintAmount, 1, 0, 2\)\);/);
});

test("the starfield's theme-colour share follows its slider, the rest keeps warm to blue-white at 1:2", () => {
  const scene = read("src/visualizers/visualizerScene.ts");
  assert.match(scene, /const accentShare = tuning\(settings\.accentShare, \.65, \.3, \.95\);/);
  assert.match(scene, /const others = 1 - \.02 - accentShare;\s*tint = tintRoll < \.02 \? "jewel" : tintRoll < \.02 \+ others \/ 3 \? "warm" : tintRoll < \.02 \+ others \? "ice" : "accent";/);
  // Missing settings (an older scene caller) fall back to the defaults.
  assert.match(scene, /const tuning = \(value: number \| undefined, fallback: number, minimum: number, maximum: number\) =>\s*Number\.isFinite\(value\)/);
  const lights = runScene("particles", song(), { seconds: 4 });
  assert.ok(lights.every(Number.isFinite));
});

test("stored tuning values survive upgrades within their ranges", () => {
  const { store } = loadPlayerStore({ initialStorage: [["auralis.visual.settings", JSON.stringify({ flashStrength: 9, glintAmount: "lots", accentShare: .1, pointerStrength: 1.5 })]] });
  const settings = store.getState().visualSettings;
  assert.equal(settings.flashStrength, 2);
  assert.equal(settings.glintAmount, 1);
  assert.equal(settings.accentShare, .3);
  assert.equal(settings.pointerStrength, 1.5);
  const fresh = loadPlayerStore().store.getState().visualSettings;
  assert.deepEqual([fresh.flashStrength, fresh.glintAmount, fresh.accentShare, fresh.pointerStrength], [1, 1, .65, 1]);
});

test("the tuning panel has the four sliders with copy in every language", () => {
  const app = read("src/App.tsx");
  for (const key of ["flashStrength", "glintAmount", "accentShare", "pointerStrength"])
    assert.match(app, new RegExp(`state\\.setVisualSetting\\("${key}", Number\\(e\\.target\\.value\\)\\)`), key);
  assert.match(app, /disabled=\{!state\.visualSettings\.pointerInteraction\} value=\{state\.visualSettings\.pointerStrength\}/);
  const i18n = read("src/i18n/index.ts");
  for (const key of ["visual.flash", "visual.glints", "visual.accentShare", "visual.pointerStrength"])
    assert.equal(i18n.split(`"${key}"`).length - 1, 3, key);
});

// Runs the real fader scale: one stop per decibel from -59 dB to 0 dB, the
// bottom stop is mute, and the 10 dB marks are sticky while dragging.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const scale = {};
Function("exports", ts.transpileModule(
  fs.readFileSync(path.join(root, "src/utils/volumeFaderScale.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText)(scale);
const {
  FADER_STEPS, faderPositionToAmplitude, amplitudeToFaderPosition, amplitudeToFaderPercent,
  formatFaderDb, nudgeFaderAmplitude, advanceFaderDrag
} = scale;
const db = amplitude => 20 * Math.log10(amplitude);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);

test("every stop maps to whole decibels and back", () => {
  assert.equal(FADER_STEPS, 60);
  assert.equal(faderPositionToAmplitude(0), 0, "bottom stop is mute");
  near(faderPositionToAmplitude(1), 1, "top stop is unity gain");
  for (let step = 1; step <= FADER_STEPS; step++) {
    const amplitude = faderPositionToAmplitude(step / FADER_STEPS);
    near(db(amplitude), step - FADER_STEPS, `step ${step}`);
    near(amplitudeToFaderPosition(amplitude) * FADER_STEPS, step, `round trip ${step}`);
  }
  assert.equal(amplitudeToFaderPosition(0), 0);
  assert.equal(amplitudeToFaderPosition(4), 1, "gain above unity clamps to the top");
  assert.equal(amplitudeToFaderPercent(1), 100);
  assert.equal(amplitudeToFaderPercent(0), 0);
});

test("positions between stops snap to the nearest decibel", () => {
  near(db(faderPositionToAmplitude(30.4 / FADER_STEPS)), -30, "30.4 rounds down");
  near(db(faderPositionToAmplitude(30.6 / FADER_STEPS)), -29, "30.6 rounds up");
  assert.equal(faderPositionToAmplitude(-1), 0);
  near(faderPositionToAmplitude(2), 1, "beyond the top clamps");
});

test("the dB readout shows mute as minus infinity", () => {
  assert.equal(formatFaderDb(0), "−∞");
  assert.equal(formatFaderDb(1), "0.0");
  assert.equal(formatFaderDb(faderPositionToAmplitude(48 / FADER_STEPS)), "-12.0");
});

test("wheel and arrow nudges move whole decibels and stop at both ends", () => {
  const minus12 = faderPositionToAmplitude(48 / FADER_STEPS);
  near(db(nudgeFaderAmplitude(minus12, 1)), -11, "one wheel notch up");
  near(db(nudgeFaderAmplitude(minus12, -5)), -17, "arrow key down");
  near(nudgeFaderAmplitude(1, 1), 1, "no gain above 0 dB");
  near(db(nudgeFaderAmplitude(0, 1)), -59, "first notch out of mute");
  assert.equal(nudgeFaderAmplitude(faderPositionToAmplitude(1 / FADER_STEPS), -1), 0, "last notch mutes");
  assert.equal(nudgeFaderAmplitude(0, -3), 0, "mute stays mute");
});

test("10 dB marks catch a slow drag and release after 3 dB", () => {
  // Approaching -20 dB (step 40) from below.
  let state = { position: 38.5 / FADER_STEPS, detent: null };
  state = advanceFaderDrag(state, 39.6 / FADER_STEPS, true);
  assert.equal(state.detent, 40, "captured within 0.8 dB of the mark");
  near(state.position * FADER_STEPS, 40, "held exactly on the mark");
  state = advanceFaderDrag(state, 42.5 / FADER_STEPS, true);
  assert.equal(state.detent, 40, "still held 2.5 dB past the mark");
  state = advanceFaderDrag(state, 43.5 / FADER_STEPS, true);
  assert.equal(state.detent, null, "released beyond 3 dB");
  near(state.position * FADER_STEPS, 43.5, "settles on the pointer once released");
});

test("drag eases toward the pointer and the end stops have no detent", () => {
  const eased = advanceFaderDrag({ position: 20 / FADER_STEPS, detent: null }, 30 / FADER_STEPS);
  assert.ok(eased.position * FADER_STEPS > 20 && eased.position * FADER_STEPS < 30, "moves part of the way per event");
  assert.equal(advanceFaderDrag({ position: .5 / FADER_STEPS, detent: null }, 0, true).detent, null, "mute end is free");
  assert.equal(advanceFaderDrag({ position: 59.5 / FADER_STEPS, detent: null }, 1, true).detent, null, "0 dB end is free");
  near(advanceFaderDrag({ position: 59.5 / FADER_STEPS, detent: null }, 1, true).position, 1, "reaches 0 dB");
});

test("volume nudges from mute resume at the last audible level, like the fader", () => {
  const hook = fs.readFileSync(path.join(root, "src/hooks/usePlaybackShortcuts.ts"), "utf8");
  assert.match(hook, /const base = state\.volume > \.001 \? state\.volume : latest\.current\.restoreVolume\?\.\(\) \?\? 0;/);
  assert.match(hook, /act\("volumeDb", event\.deltaY < 0 \? 1 : -1\)/, "one wheel notch is one decibel");
});

// Feeds MusicDynamics synthetic spectra (256 bins of 93.75 Hz, the analyser's
// dB byte scale, through the app's own frame smoothing) and checks that the
// beat follows kicks only and the levels follow the music's dynamics.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const load = relative => {
  const exports = {};
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  Function("exports", "require", output)(exports, () => ({}));
  return exports;
};
const { MusicDynamics } = load("src/visualizers/musicDynamics.ts");
const { smoothFrequencyFrame } = load("src/utils/frequencySmoothing.ts");

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const kickEnvelope = (t, period = .5) => Math.exp(-(t % period) / .12);
const addKick = (bins, t, peak = 230) => {
  const k = kickEnvelope(t);
  [1, .95, .7, .4].forEach((weight, index) => { bins[index] = Math.max(bins[index], clamp((60 + (peak - 60) * k) * weight)); });
};
const addBassLine = (bins, t, level = 160) => {
  const note = Math.floor(t / .25), age = t % .25;
  const bass = (level + ((note * 37) % 5) * 10) * (age < .03 ? age / .03 : 1 - (age - .03) * .4);
  [.75, 1, .8].forEach((weight, index) => { bins[index] = Math.max(bins[index], clamp(bass * weight)); });
};
const addPad = (bins, t, level) => {
  const syllable = .85 + .15 * Math.sin(t * 2 * Math.PI * 3.3);
  for (let index = 1; index < 30; index++) bins[index] = Math.max(bins[index], clamp((level - index * 1.2) * syllable));
};

function run(spectrum, seconds, settings = { sensitivity: 1, decaySpeed: 1 }) {
  const music = new MusicDynamics(settings);
  const frames = [];
  let smoothed;
  let seed = 3;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - .5) * 10;
  for (let frame = 0; frame < seconds * 60; frame++) {
    const t = frame / 60;
    const bins = new Uint8Array(256);
    spectrum(bins, t);
    for (let index = 0; index < bins.length; index++) if (bins[index]) bins[index] = clamp(bins[index] + noise());
    smoothed = smoothFrequencyFrame(bins, smoothed, .76, smoothed ? 1000 / 60 : 0);
    music.update(smoothed, 48000, t, 1 / 60);
    frames.push({ t, beat: music.beat, hit: music.beatHit, low: music.low, mid: music.mid, level: music.level, bin: music.bin(10) });
  }
  return frames;
}
const hitsOnKick = frames => frames.filter(f => f.hit && f.t % .5 < .12).length;
const hitsOffKick = frames => frames.filter(f => f.hit && f.t % .5 >= .12).length;

test("every kick fires a beat, even under a moving bass line", () => {
  const kicks = run((bins, t) => addKick(bins, t), 12);
  assert.ok(hitsOnKick(kicks) >= 23, `kick only: ${hitsOnKick(kicks)}/24`);
  assert.equal(hitsOffKick(kicks), 0);
  const withBass = run((bins, t) => { addKick(bins, t); addBassLine(bins, t); }, 12);
  assert.ok(hitsOnKick(withBass) >= 21, `kick + bass: ${hitsOnKick(withBass)}/24`);
  assert.ok(hitsOffKick(withBass) <= 2, `kick + bass: ${hitsOffKick(withBass)} beats on bass notes`);
});

test("vocals, pads and dense noise without a kick never fire beats", () => {
  const vocals = run((bins, t) => {
    const age = t % .28, envelope = age < .04 ? age / .04 : Math.exp(-(age - .04) / .2);
    bins[1] = 35;
    for (let index = 2; index < 40; index++) bins[index] = clamp(130 * envelope * (1 - index / 60) + 20);
  }, 10);
  assert.equal(vocals.filter(f => f.hit).length, 0);
  const dense = run(bins => { for (let index = 0; index < 120; index++) bins[index] = clamp(200 - index * .9); }, 10);
  assert.equal(dense.filter(f => f.hit && f.t > .5).length, 0);
});

test("the beat flash lands within ~100 ms and goes dark before the next kick", () => {
  for (const period of [.5, .4]) {
    const frames = run((bins, t) => { const k = Math.exp(-(t % period) / .12); [1, .95, .7, .4].forEach((w, i) => { bins[i] = clamp((60 + 170 * k) * w); }); }, 10);
    const steady = frames.filter(f => f.t > 3);
    const peakPhase = steady.reduce((best, f) => f.beat > best.beat ? f : best).t % period;
    assert.ok(peakPhase < .1, `peak ${Math.round(peakPhase * 1000)} ms after the kick at ${period}s`);
    const beforeNext = steady.filter(f => f.t % period > period - .04);
    assert.ok(Math.max(...beforeNext.map(f => f.beat)) < .15, `still lit at ${period}s: ${Math.max(...beforeNext.map(f => f.beat)).toFixed(2)}`);
    assert.ok(Math.max(...steady.map(f => f.beat)) > .6);
  }
});

test("a song does not start with seconds of glare", () => {
  const frames = run((bins, t) => { addPad(bins, t, 160); for (let i = 30; i < 100; i++) bins[i] = clamp(90 - (i - 30) * .5); }, 6);
  const settled = frames.filter(f => f.t > 1 && f.t < 2);
  assert.ok(Math.max(...settled.map(f => f.mid)) < .85, `mid ${Math.max(...settled.map(f => f.mid)).toFixed(2)} a second in`);
  assert.ok(Math.max(...settled.map(f => f.level)) < .85, `level ${Math.max(...settled.map(f => f.level)).toFixed(2)} a second in`);
});

test("a louder section stays brighter than a quieter one, and silence is dark", () => {
  const frames = run((bins, t) => {
    if (t < 12) addPad(bins, t, 135);
    else if (t < 24) addPad(bins, t, 165);
  }, 30);
  const mean = (from, to, key) => { const part = frames.filter(f => f.t >= from && f.t < to); return part.reduce((sum, f) => sum + f[key], 0) / part.length; };
  assert.ok(mean(18, 24, "mid") > mean(6, 12, "mid") + .06, `quiet ${mean(6, 12, "mid").toFixed(2)} vs loud ${mean(18, 24, "mid").toFixed(2)}`);
  assert.ok(mean(18, 24, "level") > mean(6, 12, "level") + .04);
  assert.ok(mean(25, 30, "mid") < .02 && mean(25, 30, "bin") < .02);
});

test("loud mastering no longer pins the per-star levels near the top", () => {
  // A steady, loudly mastered bed: in absolute terms bin 10 reads ~0.8.
  const frames = run((bins, t) => { addKick(bins, t, 240); addPad(bins, t, 215); }, 12);
  const steady = frames.filter(f => f.t > 6).map(f => f.bin);
  const average = steady.reduce((a, b) => a + b, 0) / steady.length;
  assert.ok(average > .3 && average < .7, `bin 10 averages ${average.toFixed(2)}`);
  assert.ok(Math.max(...steady) - Math.min(...steady) > .25, "per-star level should still move with the music");
});

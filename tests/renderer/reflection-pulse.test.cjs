// The music-reactive glass reflection used absolute levels (low band and RMS),
// which a mastered song keeps near the top: the reflection sat at full
// brightness while anything played. These tests drive ReflectionPulse with the
// synthetic song (verse, chorus, break, drop) through the app's frame
// smoothing and check that it now breathes with the song and its kicks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, song, songSections, smoothFrequencyFrame, MusicDynamics } = require("../../scripts/lib/sceneHarness.cjs");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const { ReflectionPulse, reflectionGain, pulseDepth } = load("src/utils/reflectionPulse.ts", name => name === "../visualizers/musicDynamics" ? { MusicDynamics } : {});
const { LIT_SURFACES } = load("src/utils/atmosphere.ts");

const FPS = 60;
const DEPTH = pulseDepth(1.6);

/** Gain per frame for a spectrum source; frames after `playingUntil` are paused (null). */
function run(spectrum, seconds, { playingUntil = Infinity, depth = DEPTH } = {}) {
  const pulse = new ReflectionPulse();
  let smoothed;
  const samples = [];
  for (let index = 0; index < seconds * FPS; index++) {
    const t = index / FPS;
    let frame = null;
    if (t < playingUntil) {
      smoothed = smoothFrequencyFrame(spectrum(t), smoothed, .76, 1000 / FPS);
      frame = smoothed;
    }
    const value = pulse.update(frame, 48000, t, 1 / FPS);
    samples.push({ t, pulse: value, gain: reflectionGain(value, depth) });
  }
  return samples;
}
const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const inSection = (samples, name) => {
  const section = songSections.find(part => part.name === name);
  // Skip the first two seconds of a section while the levels settle.
  return samples.filter(sample => sample.t >= section.from + 2 && sample.t < section.to);
};

test("a loud, steadily mastered song no longer holds the reflection at full brightness", () => {
  const samples = run(song(), 34).filter(sample => sample.t > 2);
  const gains = samples.map(sample => sample.gain).sort((a, b) => a - b);
  assert.ok(gains.filter(gain => gain > .98).length / gains.length < .05, "pinned at full brightness");
  const spread = gains[Math.floor(gains.length * .9)] - gains[Math.floor(gains.length * .1)];
  assert.ok(spread > .15, `the reflection barely moves (p10–p90 spread ${spread.toFixed(3)})`);
  // A flat wall of sound with no kicks settles mid-range instead of at the top.
  const wall = run(() => new Uint8Array(256).fill(200), 12).filter(sample => sample.t > 8);
  assert.ok(Math.max(...wall.map(sample => sample.gain)) < .9, "a constant loud signal still reads as full");
});

test("the reflection swells on each kick and settles before the next", () => {
  const samples = run(song(), 34).filter(sample => sample.t > 2 && songSections.find(part => sample.t >= part.from && sample.t < part.to).kick);
  const after = mean(samples.filter(sample => sample.t % .5 > .05 && sample.t % .5 < .13).map(sample => sample.gain));
  const before = mean(samples.filter(sample => sample.t % .5 > .4 && sample.t % .5 < .48).map(sample => sample.gain));
  assert.ok(after - before > .08, `kick ${after.toFixed(3)} vs between kicks ${before.toFixed(3)}`);
});

test("the chorus and drop glow brighter than the verse, the break stays calm", () => {
  const samples = run(song(), 34);
  const section = name => mean(inSection(samples, name).map(sample => sample.gain));
  assert.ok(section("chorus") > section("verse"), `chorus ${section("chorus").toFixed(3)} verse ${section("verse").toFixed(3)}`);
  assert.ok(section("break") < section("verse") - .05, `break ${section("break").toFixed(3)} verse ${section("verse").toFixed(3)}`);
  assert.ok(section("drop") > section("break") + .1);
});

test("after pausing the reflection settles to its calm level within about a second", () => {
  const samples = run(song(), 16, { playingUntil: 12 });
  const settled = samples.find(sample => sample.t > 13.5);
  assert.ok(settled.pulse < .05, `still pulsing ${settled.pulse.toFixed(3)} 1.5 s after pausing`);
  assert.ok(Math.abs(settled.gain - reflectionGain(0, DEPTH)) < .03);
  // It does not snap: a quarter second after pausing it is still on its way down.
  const fading = samples.find(sample => sample.t > 12.1);
  assert.ok(fading.gain > reflectionGain(0, DEPTH) + .02);
});

test("the pulse depth grows with the slider; zero keeps a static reflection", () => {
  assert.equal(pulseDepth(0), 0);
  assert.equal(pulseDepth(NaN), 0);
  assert.ok(pulseDepth(.4) < pulseDepth(1.6) && pulseDepth(1.6) < pulseDepth(3) && pulseDepth(3) < 1);
  assert.ok(DEPTH > .6 && DEPTH < .8);
  for (const pulse of [0, .3, 1]) assert.equal(reflectionGain(pulse, 0), 1);
  assert.equal(reflectionGain(0, 1), .25);
  assert.equal(reflectionGain(1, 1), 1);
  assert.equal(reflectionGain(NaN, 1), .25);
  assert.equal(reflectionGain(9, 9), 1);
  // At depth 0 the brightness never moves at all.
  assert.ok(run(song(), 6, { depth: 0 }).every(sample => sample.gain === 1));
});

test("the layer drives the reflection from ReflectionPulse and writes stepped values only", () => {
  const layer = read("src/components/AtmosphereLayer.tsx");
  assert.match(layer, /reflection\.update\(playing \? audioEngine\.getFrequencyData\(\) : null, audioEngine\.analysisSampleRate/);
  assert.match(layer, /if \(value === written\) return;/);
  assert.match(layer, /if \(now - writtenAt >= MIN_WRITE_MS\) write\(reflectionGain\(value, depth\), now\);/);
  assert.doesNotMatch(layer + read("src/utils/atmosphere.ts"), /atmosphereEnergy|meter\.rms|--fx-energy/);
  assert.doesNotMatch(read("src/styles/atmosphere.css"), /--fx-energy/);
});

test("the pointer lights each surface from its own position, and the surface list matches the glass rule", () => {
  const layer = read("src/components/AtmosphereLayer.tsx");
  assert.match(layer, /surface\.style\.setProperty\("--fx-light-x", `\$\{Math\.round\(pointer\.x - box\.left\)\}px`\)/);
  assert.match(layer, /shell\.addEventListener\("scroll", schedule, true\)/);
  assert.doesNotMatch(layer, /shell\.style\.setProperty\("--fx-light-[xy]"/);
  // Same surfaces as the glass material rule, minus the library results whose reflection is off.
  const rule = read("src/styles/surfaces.css").match(/:not\(\.immersive-mode\) :is\(([^)]*)\) \{\n  background:/);
  const glass = rule[1].split(",").map(item => item.trim());
  const expected = glass.filter(item => ![".library-card", ".library-entry", ".folder-card"].includes(item));
  assert.deepEqual(LIT_SURFACES.split(", "), expected);
});

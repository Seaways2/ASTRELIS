// How brightly the galaxy, starfield and black hole respond to music, measured
// as the light each frame emits over a synthetic song (see sceneHarness): they
// must pulse with the kick, swell rather than strobe, follow the song's
// sections, and not open with a glare.
const test = require("node:test");
const assert = require("node:assert/strict");
const { runScene, song, songSections } = require("../../scripts/lib/sceneHarness.cjs");

const second = value => Math.round(value * 60);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const slice = (lights, from, to) => Array.from(lights.slice(second(from), second(to)));

// Per scene: minimum swing within a beat and the largest allowed one-frame
// brightening, both relative to the section's mean light. Calibrated so that
// the 2.18.0 scenes (always lit) and the first rework (strobing) both fail.
const expectations = {
  waveform: { swing: .05, jump: .06 },
  particles: { swing: .25, jump: .45 },
  pulse: { swing: .12, jump: .2 }
};

for (const [mode, expected] of Object.entries(expectations)) {
  test(`${mode} pulses with the kick, swells instead of strobing, and follows the song`, () => {
    const lights = runScene(mode, song());
    const chorus = slice(lights, 12, 20), chorusMean = mean(chorus);

    let swing = 0, cycles = 0;
    for (let start = 12; start + .5 <= 20; start += .5) {
      const cycle = slice(lights, start, start + .5);
      swing += (Math.max(...cycle) - Math.min(...cycle)) / chorusMean;
      cycles++;
    }
    assert.ok(swing / cycles > expected.swing, `${mode}: beats swing the light by only ${(swing / cycles * 100).toFixed(0)}%`);

    let jump = 0;
    for (let index = 1; index < chorus.length; index++) jump = Math.max(jump, (chorus[index] - chorus[index - 1]) / chorusMean);
    assert.ok(jump < expected.jump, `${mode}: one frame brightened by ${(jump * 100).toFixed(0)}% (a strobe)`);

    const section = name => { const part = songSections.find(entry => entry.name === name); return mean(slice(lights, part.from + 2, part.to)); };
    assert.ok(section("break") < section("verse") * .9, `${mode}: the drumless break is not darker than the verse`);
    assert.ok(section("drop") > section("break") * 1.1, `${mode}: the returning drums do not brighten the scene`);

    const opening = mean(slice(lights, 0, 1.5));
    assert.ok(opening < section("verse") * 1.25, `${mode}: the song opens ${(opening / section("verse") * 100).toFixed(0)}% as bright as the verse`);
  });
}

test("silence leaves the particle scenes calm and steady", () => {
  for (const mode of ["waveform", "particles", "pulse"]) {
    const lights = Array.from(runScene(mode, () => new Uint8Array(256), { seconds: 6 })).slice(60);
    const average = mean(lights);
    // Twinkles still move, but nothing pulses: no frame strays far from the mean.
    assert.ok(Math.max(...lights) < average * 1.35, `${mode}: a ${(Math.max(...lights) / average * 100 - 100).toFixed(0)}% flare in silence`);
  }
});

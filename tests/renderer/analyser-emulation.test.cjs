// The tuning tool's analyser emulation must match what Web Audio would hand
// the visualizers, or tuning against it would tune against the wrong data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  analyserBytes, normalizeBins, analyserFrame, spectrumFrames, writeCapture, readCapture, OUTPUT_BINS, FRAME_RATE
} = require("../../scripts/lib/analyserEmulation.cjs");

const tone = (frequency, amplitude, seconds, sampleRate = 48000) =>
  Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate));
// A tone centred on analyser bin 42 (23.4375 Hz per bin at 48 kHz, fftSize 2048).
const centred = 42 * 48000 / 2048;
const byteFor = decibels => Math.floor(255 / 80 * (decibels + 90));

test("a full-scale tone reads at the Web Audio level in its analyser bin", () => {
  const bytes = analyserBytes(tone(centred, 1, .1), 4800);
  assert.equal(bytes.indexOf(Math.max(...bytes)), 42);
  // Blackman-windowed peak magnitude / fftSize: amplitude × 0.42 / 2.
  assert.ok(Math.abs(bytes[42] - byteFor(20 * Math.log10(.21))) <= 1, `peak byte ${bytes[42]}`);
  assert.ok(bytes[200] === 0, "far from the tone the spectrum is at the floor");
});

test("a tone 40 dB quieter reads 127.5 bytes lower", () => {
  const loud = analyserBytes(tone(centred, 1, .1), 4800), quiet = analyserBytes(tone(centred, .01, .1), 4800);
  assert.ok(Math.abs((loud[42] - quiet[42]) - 127.5) <= 1, `difference ${loud[42] - quiet[42]}`);
});

test("frames reduce the analyser bins to 256 by averaging, as the app does", () => {
  const samples = tone(1000, .5, .1);
  const bytes = analyserBytes(samples, 4800), frame = analyserFrame(samples, 4800);
  assert.equal(frame.length, OUTPUT_BINS);
  assert.deepEqual(Array.from(frame), Array.from(normalizeBins(bytes)));
  assert.equal(frame[10], Math.round((bytes[40] + bytes[41] + bytes[42] + bytes[43]) / 4));
  assert.equal(frame.indexOf(Math.max(...frame)), Math.floor(1000 / 93.75));
});

test("silence is all zeros and frames come at 60 per second", () => {
  const frames = spectrumFrames(new Float32Array(48000 * 2), 48000);
  assert.equal(frames.length, 2 * FRAME_RATE * OUTPUT_BINS);
  assert.ok(frames.every(value => value === 0));
});

test("a capture round-trips its header and frames", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-capture-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const frames = spectrumFrames(tone(220, .5, 1), 48000);
  const file = path.join(directory, "tone.spectrum");
  writeCapture(file, { title: "tone", source: "tone.wav", sampleRate: 48000 }, frames);
  const capture = readCapture(file);
  assert.equal(capture.header.title, "tone");
  assert.equal(capture.frames.length, FRAME_RATE);
  assert.deepEqual(Array.from(capture.frames[10]), Array.from(frames.subarray(10 * OUTPUT_BINS, 11 * OUTPUT_BINS)));
});

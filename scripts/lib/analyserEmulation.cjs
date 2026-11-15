// Reproduces, from decoded audio, the spectrum frames the app's visualizers
// receive: Web Audio's AnalyserNode.getByteFrequencyData (Blackman window,
// magnitude / fftSize, no analyser smoothing, -90…-10 dB onto 0–255), then the
// app's reduction to 256 bins (AudioEngine.normalizeFrequency). The app's own
// frame smoothing is applied at replay time, as in the app.
const fs = require("node:fs");

const FFT_SIZE = 2048;
const MIN_DB = -90;
const MAX_DB = -10;
const OUTPUT_BINS = 256;
const FRAME_RATE = 60;

const blackman = (() => {
  const window = new Float64Array(FFT_SIZE);
  for (let index = 0; index < FFT_SIZE; index++)
    window[index] = .42 - .5 * Math.cos(2 * Math.PI * index / FFT_SIZE) + .08 * Math.cos(4 * Math.PI * index / FFT_SIZE);
  return window;
})();

const bitReversal = (() => {
  const bits = Math.log2(FFT_SIZE), table = new Uint32Array(FFT_SIZE);
  for (let index = 0; index < FFT_SIZE; index++) {
    let reversed = 0;
    for (let bit = 0; bit < bits; bit++) reversed |= ((index >> bit) & 1) << (bits - 1 - bit);
    table[index] = reversed;
  }
  return table;
})();

/** In-place iterative radix-2 FFT. */
function fft(real, imaginary) {
  for (let index = 0; index < FFT_SIZE; index++) {
    const other = bitReversal[index];
    if (other > index) {
      [real[index], real[other]] = [real[other], real[index]];
      [imaginary[index], imaginary[other]] = [imaginary[other], imaginary[index]];
    }
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2, step = -2 * Math.PI / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let offset = 0; offset < half; offset++) {
        const angle = step * offset, cos = Math.cos(angle), sin = Math.sin(angle);
        const a = start + offset, b = a + half;
        const tre = real[b] * cos - imaginary[b] * sin, tim = real[b] * sin + imaginary[b] * cos;
        real[b] = real[a] - tre; imaginary[b] = imaginary[a] - tim;
        real[a] += tre; imaginary[a] += tim;
      }
    }
  }
}

const freshScratch = () => ({ real: new Float64Array(FFT_SIZE), imaginary: new Float64Array(FFT_SIZE) });

/** getByteFrequencyData (fftSize / 2 bins) for the FFT_SIZE samples ending at `end`. */
function analyserBytes(samples, end, scratch = freshScratch()) {
  const { real, imaginary } = scratch;
  for (let index = 0; index < FFT_SIZE; index++) {
    const source = end - FFT_SIZE + index;
    real[index] = (source >= 0 && source < samples.length ? samples[source] : 0) * blackman[index];
    imaginary[index] = 0;
  }
  fft(real, imaginary);
  const bytes = new Uint8Array(FFT_SIZE / 2);
  for (let k = 0; k < bytes.length; k++) {
    const magnitude = Math.hypot(real[k], imaginary[k]) / FFT_SIZE;
    const decibels = magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity;
    bytes[k] = Math.max(0, Math.min(255, Math.floor(255 / (MAX_DB - MIN_DB) * (decibels - MIN_DB))));
  }
  return bytes;
}

/** The app's reduction of analyser bins to 256 (AudioEngine.normalizeFrequency). */
function normalizeBins(input) {
  const output = new Uint8Array(OUTPUT_BINS);
  for (let index = 0; index < OUTPUT_BINS; index++) {
    const start = Math.floor(index * input.length / OUTPUT_BINS);
    const end = Math.max(start + 1, Math.floor((index + 1) * input.length / OUTPUT_BINS));
    let sum = 0;
    for (let source = start; source < Math.min(end, input.length); source++) sum += input[source];
    output[index] = Math.round(sum / Math.max(1, Math.min(end, input.length) - start));
  }
  return output;
}

/** One spectrum frame as the visualizers receive it, before the app's smoothing. */
function analyserFrame(samples, end, scratch = freshScratch()) {
  return normalizeBins(analyserBytes(samples, end, scratch));
}

/** Spectrum frames at 60 FPS for mono float samples at `sampleRate`. */
function spectrumFrames(samples, sampleRate) {
  const frameCount = Math.floor(samples.length / sampleRate * FRAME_RATE);
  const frames = new Uint8Array(frameCount * OUTPUT_BINS);
  const scratch = freshScratch();
  for (let frame = 0; frame < frameCount; frame++)
    frames.set(analyserFrame(samples, Math.round((frame + 1) * sampleRate / FRAME_RATE), scratch), frame * OUTPUT_BINS);
  return frames;
}

/**
 * Capture file: one JSON header line, then the raw 256-byte frames. Small
 * (about 900 kB a minute) and derived data only, never the audio itself.
 */
function writeCapture(file, header, frames) {
  const head = Buffer.from(`${JSON.stringify({ format: "astrelis-spectrum", version: 1, bins: OUTPUT_BINS, frameRate: FRAME_RATE, ...header })}\n`);
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from(frames.buffer, frames.byteOffset, frames.byteLength)]));
}

function readCapture(file) {
  const buffer = fs.readFileSync(file);
  const newline = buffer.indexOf(10);
  const header = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
  if (header.format !== "astrelis-spectrum" || header.bins !== OUTPUT_BINS) throw new Error(`${file}: not a spectrum capture`);
  const body = buffer.subarray(newline + 1);
  const frames = [];
  for (let offset = 0; offset + OUTPUT_BINS <= body.length; offset += OUTPUT_BINS) frames.push(new Uint8Array(body.subarray(offset, offset + OUTPUT_BINS)));
  return { header, frames };
}

module.exports = { FFT_SIZE, OUTPUT_BINS, FRAME_RATE, analyserBytes, normalizeBins, analyserFrame, spectrumFrames, writeCapture, readCapture };

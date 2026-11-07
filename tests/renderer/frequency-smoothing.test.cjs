const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const source = read("src/utils/frequencySmoothing.ts");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const loaded = { exports: {} };
Function("exports", "module", output)(loaded.exports, loaded);
const { smoothFrequencyFrame } = loaded.exports;

test("zero smoothing follows the newest spectrum exactly", () => {
  assert.deepEqual([...smoothFrequencyFrame(Uint8Array.from([0, 128, 255]), Uint8Array.from([255, 0, 0]), 0, 16.67)], [0, 128, 255]);
});

test("the configured smoothing amount blends every frequency bin", () => {
  assert.deepEqual([...smoothFrequencyFrame(Uint8Array.from([100, 200]), Uint8Array.from([0, 100]), .75, 1000 / 60)], [25, 125]);
});

test("frequency smoothing is normalized across different update rates", () => {
  const input = Uint8Array.from([200]);
  const initial = Uint8Array.from([0]);
  const oneFrame = smoothFrequencyFrame(input, initial, .81, 1000 / 60);
  const halfFrame = smoothFrequencyFrame(input, initial, .81, 1000 / 120);
  const twoHalfFrames = smoothFrequencyFrame(input, halfFrame, .81, 1000 / 120);
  assert.ok(Math.abs(oneFrame[0] - twoHalfFrames[0]) <= 1);
});

test("AudioEngine applies one shared smoother after local, online or Native acquisition", () => {
  const engine = read("src/audio/AudioEngine.ts");
  assert.match(engine, /this\.analyser\.smoothingTimeConstant = 0/);
  assert.match(engine, /return this\.applyFrequencySmoothing\(this\.nativeFrequency\)/);
  assert.match(engine, /return this\.applyFrequencySmoothing\(this\.onlineFrequency\)/);
  assert.match(engine, /analyser\.getByteFrequencyData\(data\);\s*return this\.applyFrequencySmoothing\(data\)/);
  assert.match(engine, /sourceChanged \? undefined : this\.smoothedFrequency/);
});

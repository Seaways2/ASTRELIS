const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function engineFixture() {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/audio/AudioEngine.ts"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  let now = 100;
  const exports = {};
  Function("exports", "require", "Audio", "window", "performance", code)(
    exports, () => ({ smoothFrequencyFrame: input => input }),
    class { addEventListener() {} }, { addEventListener() {} }, { now: () => now }
  );
  const engine = exports.audioEngine;
  engine.context = { sampleRate: 48000 };
  return { engine, advance: ms => { now += ms; } };
}

test("encoded HDMI analysis uses decoded sample rate instead of carrier rate", () => {
  const {engine} = engineFixture();
  const frequency = Array(256).fill(0); frequency[64] = 255;
  engine.setNativeAnalysis({sampleRate:192000, analysisSampleRate:48000, nativeFrequency:frequency, nativeLeft:[.2], nativeRight:[.2]});
  const meter = engine.meters();
  assert.equal(meter.sampleRate,48000);
  assert.ok(meter.high > 0);
});

test("native frequency bands follow 44.1/48/96/192 kHz output rates", () => {
  const { engine } = engineFixture();
  for (const sampleRate of [44100, 48000, 96000, 192000]) {
    const frequency = Array(256).fill(0);
    frequency[Math.round(6000 * 512 / sampleRate)] = 255;
    engine.setNativeAnalysis({ sampleRate, nativeFrequency: frequency, nativeLeft: [0], nativeRight: [0] });
    const meter = engine.meters();
    assert.equal(meter.sampleRate, sampleRate);
    assert.equal(meter.low, 0);
    assert.equal(meter.mid, 0);
    assert.ok(meter.high > 0, "6 kHz belongs to the high band");
  }
});

test("native snapshots are shared until a new packet, including time-only packets", () => {
  const { engine } = engineFixture();
  engine.setNativeAnalysis({ sampleRate: 96000, nativeLeft: [.1], nativeRight: [.2] });
  const first = engine.meters();
  assert.strictEqual(engine.meters(), first);
  engine.setNativeAnalysis({ nativeLeft: [.5], nativeRight: [.5] });
  const changed = engine.meters();
  assert.notStrictEqual(changed, first);
  assert.equal(changed.sampleRate, 96000);
  assert.ok(changed.rms > first.rms);
});

test("invalid native rates cannot corrupt band boundaries; valid rate survives absent metadata", () => {
  const { engine } = engineFixture();
  engine.setNativeAnalysis({ sampleRate: NaN });
  assert.equal(engine.meters().sampleRate, 48000);
  engine.setNativeAnalysis({ sampleRate: 192000 });
  for (const sampleRate of [undefined, 0, -1, Infinity, 99999999]) {
    engine.setNativeAnalysis({ sampleRate });
    assert.equal(engine.meters().sampleRate, 192000);
  }
});

test("reset and resume invalidate old levels while preserving native output rate", () => {
  const { engine } = engineFixture();
  engine.setNativeAnalysis({ sampleRate: 96000, nativeLeft: [.7], nativeRight: [.7] });
  assert.ok(engine.meters().peak > 0);
  engine.resetAnalysis();
  assert.equal(engine.meters().peak, 0);
  assert.equal(engine.meters().sampleRate, 96000);
  engine.resumeAnalysis();
  assert.equal(engine.meters().peak, 0);
  engine.setNativeAnalysis({ nativeLeft: [.3], nativeRight: [.3] });
  assert.ok(engine.meters().peak > 0);
});

test("web analysis shares one meter read per visual frame and refreshes on source switch", () => {
  const { engine, advance } = engineFixture();
  let reads = 0;
  const analyser = { getFloatTimeDomainData: data => { reads++; data.fill(.2); } };
  engine.leftAnalyser = analyser;
  engine.rightAnalyser = analyser;
  engine.timeLeft = new Float32Array(8);
  engine.timeRight = new Float32Array(8);
  engine.getFrequencyData = () => new Uint8Array(256);
  const first = engine.meters();
  assert.strictEqual(engine.meters(), first);
  assert.equal(reads, 2);
  advance(20);
  assert.notStrictEqual(engine.meters(), first);
  assert.equal(reads, 4);
  engine.setNativeAnalysis({ sampleRate: 96000, nativeLeft: [.1], nativeRight: [.1] });
  assert.equal(engine.meters().sampleRate, 96000);
  engine.useLocalAnalysis();
  assert.equal(engine.meters().sampleRate, 48000);
});

test("output metadata changes notify idle meters without a polling timer", () => {
  const { engine } = engineFixture();
  const rates = [];
  const detach = engine.on("analysisratechange", () => rates.push(engine.analysisSampleRate));
  engine.setNativeAnalysis({ sampleRate: 44100 });
  engine.resetAnalysis();
  engine.setNativeAnalysis({ sampleRate: 96000 });
  engine.setNativeAnalysis({ sampleRate: 96000, nativeLeft: [0] });
  engine.useLocalAnalysis();
  assert.deepEqual(rates, [44100, 96000, 48000]);
  detach();
  engine.useNativeAnalysis();
  assert.equal(rates.length, 3);
});


test("analysis demand disconnects only the analysis taps and resumes without reconnecting audible output", () => {
  const {engine}=engineFixture();
  const analyser={}, splitter={}, audible={};
  const connected=new Set([analyser,splitter,audible]);
  engine.analyser=analyser; engine.splitter=splitter;
  engine.analysisBus={connect:node=>connected.add(node),disconnect:node=>connected.delete(node)};
  engine.setAnalysisDemand(false);
  assert.deepEqual([...connected],[audible]);
  engine.setAnalysisDemand(false);
  assert.equal(connected.size,1);
  engine.setAnalysisDemand(true);
  assert.equal(connected.size,3);
  assert.ok(connected.has(audible));
});

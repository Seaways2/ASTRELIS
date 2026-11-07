const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { LocalWaveformService, WaveformPeakAccumulator, streamWaveform } = require("../../dist-electron/library/media/LocalWaveformService.js");
const { parseAbsolutePath } = require("../../dist-electron/library/validation/LibraryIpcValidator.js");
const peakValues = value => Array(720).fill(value);

function sources(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-wave-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("astrelis-wave-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const files = ["a.wav", "b.wav", "c.wav"].map(name => path.join(directory, name));
  files.forEach(file => fs.writeFileSync(file, "source"));
  return files;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("streaming peaks preserve their timeline across arbitrary byte boundaries", () => {
  const bytes = Buffer.alloc(7200 * 4); bytes.writeFloatLE(0.5, 0); bytes.writeFloatLE(1, bytes.length - 4);
  const accumulator = new WaveformPeakAccumulator(0.9);
  for (let offset = 0; offset < bytes.length; offset += 113) accumulator.push(bytes.subarray(offset, offset + 113));
  const peaks = accumulator.finish();
  assert.equal(peaks.length, 720); assert.equal(peaks[0], 0.5); assert.equal(peaks[719], 1);
  assert.equal(peaks.slice(1, 719).every(value => value === 0), true);
});
test("unknown durations coarsen their envelope while retaining silence and late activity", () => {
  const accumulator = new WaveformPeakAccumulator();
  const quiet = Buffer.alloc(3200 * 4), loud = Buffer.alloc(3200 * 4);
  for (let offset = 0; offset < loud.length; offset += 4) loud.writeFloatLE(0.7, offset);
  for (let index = 0; index < 100; index++) accumulator.push(index < 50 ? quiet : loud);
  const peaks = accumulator.finish();
  assert.equal(peaks.length, 720); assert.equal(peaks[0], 0); assert.equal(peaks.at(-1), 1);
  assert.equal(peaks.every(Number.isFinite), true);
  const incomplete = new WaveformPeakAccumulator(); incomplete.push(Buffer.from([0, 0, 0]));
  assert.throws(() => incomplete.finish(), /不完整/);
});
test("same-file waveform consumers share work and an old cancellation cannot kill a new consumer", async t => {
  const [source] = sources(t); let started, release, runs = 0, aborted = false;
  const entered = new Promise(resolve => { started = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const service = new LocalWaveformService({ executable: () => "mock", duration: async () => 1,
    run: async (_source, _duration, signal) => { runs++; signal.addEventListener("abort", () => { aborted = true; }); started(); await hold; return peakValues(1); } });
  const old = service.request(source, "old"); await entered;
  const fresh = service.request(source, "fresh"); assert.equal(old, fresh);
  service.cancel(source, "old"); service.cancel(source, "old");
  assert.equal(aborted, false); release();
  assert.equal((await fresh).ok, true); assert.equal(runs, 1);
});
test("StrictMode request-cancel-request starts only the live same-path job", async t => {
  const [source] = sources(t); let runs = 0;
  const service = new LocalWaveformService({ executable: () => "mock", duration: async () => 1,
    run: async (_source, _duration, signal) => { assert.equal(signal.aborted, false); runs++; return peakValues(1); } });
  const first = service.request(source, "mount-1"); service.cancel(source, "mount-1");
  const second = service.request(source, "mount-2"); service.cancel(source, "mount-1");
  assert.equal((await first).ok, false); assert.equal((await second).ok, true); assert.equal(runs, 1);
});
test("switching songs waits for decoder shutdown and skips obsolete queued songs", async t => {
  const [a, b, c] = sources(t); let entered, active = 0, maximum = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const runs = [];
  const service = new LocalWaveformService({ executable: () => "mock", duration: async () => 1,
    run: async (file, _duration, signal) => {
      runs.push(file); active++; maximum = Math.max(maximum, active);
      if (file === a) { entered(); await new Promise(resolve => signal.addEventListener("abort", () => setImmediate(resolve), { once: true })); }
      active--; return peakValues(1);
    } });
  const first = service.request(a, "a"); await started;
  const obsolete = service.request(b, "b"), latest = service.request(c, "c");
  assert.equal((await first).ok, false); assert.equal((await obsolete).ok, false); assert.equal((await latest).ok, true);
  assert.deepEqual(runs, [a, c]); assert.equal(maximum, 1);
});
test("cancelling while metadata is pending cannot revive an obsolete song", async t => {
  const [a, b] = sources(t); let releaseMetadata, metadataEntered;
  const entered = new Promise(resolve => { metadataEntered = resolve; });
  const hold = new Promise(resolve => { releaseMetadata = resolve; }); const runs = [];
  const service = new LocalWaveformService({ executable: () => "mock",
    duration: async source => { if (source === a) { metadataEntered(); await hold; } return 1; },
    run: async source => { runs.push(source); return peakValues(1); } });
  const first = service.request(a, "a"); await entered; service.cancel(a, "a");
  const latest = service.request(b, "b");
  assert.equal((await first).ok, false); assert.equal((await latest).ok, true);
  releaseMetadata(); await tick(); assert.deepEqual(runs, [b]);
});
test("waveform cache uses file revisions, obeys LRU capacity, and isolates returned arrays", async t => {
  const [a, b, c] = sources(t), runs = [];
  const service = new LocalWaveformService({ executable: () => "mock", duration: async () => 1, cacheSize: 2,
    run: async source => { runs.push(source); return peakValues(0.5); } });
  (await service.request(a)).peaks[0] = 0;
  await service.request(b); assert.equal((await service.request(a)).peaks[0], 0.5);
  await service.request(c); await service.request(b);
  assert.deepEqual(runs, [a, b, c, b]);
  fs.appendFileSync(b, "changed"); await service.request(b); assert.equal(runs.length, 5);
});
test("waveform failure resolves explicitly and leaves the queue usable", async t => {
  const [a, b] = sources(t);
  const service = new LocalWaveformService({ executable: () => "mock", duration: async () => undefined,
    run: async source => { if (source === a) throw new Error("missing ffmpeg"); return peakValues(1); } });
  assert.match((await service.request(a)).error, /missing ffmpeg/); assert.equal((await service.request(b)).ok, true);
});
test("implausible metadata durations fall back to progressive waveform sampling", async t => {
  const [source] = sources(t); let receivedDuration = null;
  const service = new LocalWaveformService({ executable: () => "mock", duration: async () => 113152869.22502,
    run: async (_source, duration) => { receivedDuration = duration; return peakValues(1); } });
  assert.equal((await service.request(source)).ok, true);
  assert.equal(receivedDuration, undefined);
});
test("the waveform deadline also covers stalled metadata reads", async t => {
  const [source] = sources(t); let runs = 0;
  const service = new LocalWaveformService({ executable: () => "mock", timeoutMs: 25,
    duration: () => new Promise(() => {}), run: async () => { runs++; return peakValues(1); } });
  const result = await service.request(source, "stalled");
  assert.equal(result.ok, false); assert.match(result.error, /超时/); assert.equal(runs, 0);
});
test("the waveform deadline covers the final source-version stat after decoding", async t => {
  const [source] = sources(t), originalStat = fs.promises.stat.bind(fs.promises);
  let sourceStats = 0, runs = 0;
  t.mock.method(fs.promises, "stat", file => {
    if (file === source && ++sourceStats === 2) return new Promise(() => {});
    return originalStat(file);
  });
  const service = new LocalWaveformService({ executable: () => "mock", timeoutMs: 40,
    duration: async () => 1, run: async () => { runs++; return peakValues(1); } });
  const result = await service.request(source, "stalled-final-stat");
  assert.equal(sourceStats, 2); assert.equal(runs, 1);
  assert.equal(result.ok, false); assert.match(result.error, /超时/);
});
test("waveform IPC accepts only authorized local audio and the main renderer", async () => {
  const main = fs.readFileSync(path.resolve(__dirname, "../../electron/main.ts"), "utf8");
  const start = main.indexOf('  ipcMain.handle("library:waveform",');
  const end = main.indexOf('  registerVstPluginIpc(', start);
  assert.ok(start > 0 && end > start);
  const handlers = new Map(), sender = {}, accepted = [], cancelled = [], source = path.resolve("synthetic-authorized.flac");
  vm.runInNewContext(ts.transpileModule(main.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS } }).outputText, {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => handlers.set(name, handler) },
    mainWindow: { webContents: sender }, parseAbsolutePath, path, AUDIO_EXTENSIONS: new Set([".flac"]),
    localMediaAccess: { isAllowed: file => file === source }, localWaveformService: {
      request: async (file, id) => { accepted.push([file, id]); return { ok: true, peaks: peakValues(1) }; },
      cancel: (file, id) => cancelled.push([file, id])
    }
  });
  const request = handlers.get("library:waveform"), cancel = handlers.get("library:waveform-cancel");
  assert.equal((await request({ sender }, source, "a")).ok, true);
  assert.equal((await request({ sender: {} }, source, "b")).ok, false);
  assert.equal((await request({ sender }, path.resolve("other.flac"), "c")).ok, false);
  assert.equal((await request({ sender }, "https://example.com/audio.flac", "d")).ok, false);
  assert.equal((await request({ sender }, source, {})).ok, false);
  cancel({ sender: {} }, source, "a"); cancel({ sender }, source, "a");
  assert.deepEqual(accepted, [[source, "a"]]); assert.deepEqual(cancelled, [[source, "a"]]);
});
test("bundled FFmpeg streams a real WAV into the fixed-size peak response", async t => {
  const [source] = sources(t), frames = 8000, wave = Buffer.alloc(44 + frames * 4);
  wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(3, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(32000, 28);
  wave.writeUInt16LE(4, 32); wave.writeUInt16LE(32, 34); wave.write("data", 36); wave.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) wave.writeFloatLE(frame < frames / 2 ? 0 : Math.sin(frame * Math.PI / 40), 44 + frame * 4);
  fs.writeFileSync(source, wave);
  const executable = path.resolve(__dirname, "../../ffmpeg/ffmpeg.exe");
  const values = await streamWaveform(executable, source, 1, new AbortController().signal);
  assert.equal(values.length, 720); assert.equal(values[0], 0); assert.ok(values.at(-1) > 0.8);
  await assert.rejects(streamWaveform(path.join(path.dirname(source), "missing.exe"), source, 1, new AbortController().signal));
});

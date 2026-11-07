const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const source = fs.readFileSync("src/utils/waveformPreview.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const loaded = { exports: {} };
Function("exports", compiled)(loaded.exports);
const { keyboardSeek, scheduleWaveform, readPreviewBytes, cacheWaveform, cachedWaveform } = loaded.exports;

test("keyboard seeking clamps endpoints and ignores unavailable or non-seek keys", () => {
  assert.equal(keyboardSeek("ArrowLeft", 2, 60), 0);
  assert.equal(keyboardSeek("ArrowRight", 58, 60), 60);
  assert.equal(keyboardSeek("ArrowUp", 10, 60, true), 40);
  assert.equal(keyboardSeek("Home", 45, 60), 0);
  assert.equal(keyboardSeek("End", 12, 60), 60);
  assert.equal(keyboardSeek("Enter", 12, 60), null);
  assert.equal(keyboardSeek("ArrowRight", 12, Infinity), null);
  assert.equal(keyboardSeek("ArrowRight", 0, 0), null);
});

test("preview jobs serialize decoding and skip cancelled queued work", async () => {
  const first = new AbortController();
  const obsolete = new AbortController();
  const latest = new AbortController();
  const events = [];
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const a = scheduleWaveform(first.signal, async () => { events.push("first"); await gate; events.push("done"); });
  await Promise.resolve();
  const b = scheduleWaveform(obsolete.signal, async () => events.push("obsolete"));
  const c = scheduleWaveform(latest.signal, async () => events.push("latest"));
  obsolete.abort();
  assert.deepEqual(events, ["first"]);
  finish();
  await Promise.all([a, b, c]);
  assert.deepEqual(events, ["first", "done", "latest"]);
  await assert.rejects(scheduleWaveform(latest.signal, async () => { throw Error("decode failed"); }));
  assert.equal(await scheduleWaveform(latest.signal, async () => 42), 42);
});

test("ordinary lossless audio above 24 MiB remains available for waveform decoding", async () => {
  const signal = new AbortController().signal;
  const bytes = new Uint8Array(44100 * 192 * 4 + 44);
  bytes[0] = 82;
  bytes[bytes.length - 1] = 91;
  for (const headers of [{ "content-length": String(bytes.length) }, {}]) {
    const result = new Uint8Array(await readPreviewBytes(new Response(bytes, { headers }), signal));
    assert.equal(result.length, bytes.length);
    assert.equal(result[0], 82);
    assert.equal(result[result.length - 1], 91);
  }
  const result = await readPreviewBytes(new Response(new Uint8Array([1, 2, 3])), signal);
  assert.deepEqual([...new Uint8Array(result)], [1, 2, 3]);
});

test("aborting a pending preview read cancels its stream", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const job = readPreviewBytes(response, controller.signal);
  controller.abort();
  await assert.rejects(job, error => error.name === "AbortError");
  assert.equal(cancelled, true);
});

test("waveform cache evicts old entries while keeping recently read previews", () => {
  for (let i = 0; i < 96; i++) cacheWaveform("fixture-" + i, new Float32Array([i]));
  assert.equal(cachedWaveform("fixture-0")[0], 0);
  cacheWaveform("fixture-96", new Float32Array([96]));
  assert.equal(cachedWaveform("fixture-1"), undefined);
  assert.equal(cachedWaveform("fixture-0")[0], 0);
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const persistence = require(path.resolve(__dirname, "../../dist-electron/nativeOutputPersistence.js"));

test("Native output persistence round-trips preferred intent and LKG", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-native-output-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const lkg = {
    backend: "wasapi-shared-low-latency",
    juceDeviceName: "Test Device",
    platformEndpointId: "test-endpoint-id",
    sampleRateMode: "system",
    bufferMode: "auto",
    exclusiveFallback: "shared-low-latency"
  };
  const preferred = { ...lkg, backend: "wasapi-exclusive" };
  persistence.writeNativeOutputState(directory, {
    schemaVersion: 1,
    preferred,
    lastKnownGood: lkg,
    updatedAt: "2026-08-11T00:00:00.000Z"
  });
  assert.deepEqual(persistence.readNativeOutputState(directory), {
    schemaVersion: 1,
    preferred,
    lastKnownGood: lkg,
    updatedAt: "2026-08-11T00:00:00.000Z"
  });
  assert.equal(fs.existsSync(`${persistence.nativeOutputStatePath(directory)}.tmp`), false);
});

test("corrupt or incompatible Native output state is ignored", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-native-output-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(persistence.nativeOutputStatePath(directory), "not json", "utf8");
  assert.equal(persistence.readNativeOutputState(directory), null);
  fs.writeFileSync(persistence.nativeOutputStatePath(directory), JSON.stringify({ schemaVersion: 99 }), "utf8");
  assert.equal(persistence.readNativeOutputState(directory), null);
});

// PCM diagnostics sample every 2 s but log a healthy stream only every 30 s,
// and log new trouble as soon as it is sampled.
const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

const { PcmDiagnostics, PCM_DIAG_HEALTHY_INTERVAL_MS } = require("../../dist-electron/pcmDiagnostics.js");

test("a healthy stream is logged every 30 s and new trouble at once", t => {
  let clock = 1_000_000;
  t.mock.method(performance, "now", () => clock);
  const lines = [];
  const diagnostics = new PcmDiagnostics(line => lines.push(line), () => ({}));
  let sequence = 0;
  const sample = (packets = 50) => {
    for (let index = 0; index < packets; index++) diagnostics.recordMainPacket({ mediaSessionId: 1, sequence: ++sequence });
    clock += 2000;
    diagnostics["flush"]();
  };

  sample();
  assert.equal(lines.length, 1, "the first sample of a stream is logged");
  for (let index = 0; index < 10; index++) sample();
  assert.equal(lines.length, 1, "a healthy stream stays quiet within 30 s");
  while (clock - 1_002_000 < PCM_DIAG_HEALTHY_INTERVAL_MS) sample();
  assert.equal(lines.length, 2, "a healthy stream is logged again after 30 s");

  sequence += 5; // five packets lost
  sample();
  assert.equal(lines.length, 3, "a sequence gap is logged immediately");
  assert.match(lines[2], /"mainSequenceGaps":5/);
  sample();
  assert.equal(lines.length, 3, "the same trouble is not repeated every sample");

  diagnostics.recordNativeStatus({ captureUnderruns: 1 });
  sample();
  assert.equal(lines.length, 4, "a native underrun is logged immediately");
});

test("nothing is logged while no packets flow", t => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock);
  const lines = [];
  const diagnostics = new PcmDiagnostics(line => lines.push(line), () => ({}));
  for (let index = 0; index < 40; index++) { clock += 2000; diagnostics["flush"](); }
  assert.equal(lines.length, 0);
});

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const { SingleProcessGate } = require(path.join(root, "dist-electron/singleProcessGate.js"));

test("a failed termination does not poison later starts", async () => {
  let starts = 0;
  const failures = [];
  const gate = new SingleProcessGate(
    () => ({ id: ++starts, alive: true }),
    process => process.alive,
    async process => {
      if (process.id === 1) throw new Error("NATIVE_ENGINE_TERMINATION_TIMEOUT: pid=1");
      process.alive = false;
    },
    { onRetirementFailure: (process, reason) => failures.push([process.id, String(reason.message || reason)]) }
  );
  const first = await gate.ensure();
  first.alive = false;
  await assert.rejects(gate.retire(first), /NATIVE_ENGINE_TERMINATION_TIMEOUT/);
  const replacements = await Promise.all([gate.ensure(), gate.ensure(), gate.ensure()]);
  assert.equal(starts, 2);
  assert.equal(new Set(replacements).size, 1);
  assert.equal(replacements[0].id, 2);
  assert.deepEqual(failures, [[1, "NATIVE_ENGINE_TERMINATION_TIMEOUT: pid=1"]]);
  assert.deepEqual(gate.unterminatedProcesses().map(process => process.id), [1]);

  // Later retirements still run their stop instead of hanging on a rejected tail.
  await gate.retire(replacements[0]);
  assert.equal(replacements[0].alive, false);
  const third = await gate.ensure();
  assert.equal(third.id, 3);
});

test("a termination that never settles only delays the next start by the bound", async () => {
  let starts = 0;
  const failures = [];
  const gate = new SingleProcessGate(
    () => ({ id: ++starts, alive: true }),
    process => process.alive,
    process => process.id === 1 ? new Promise(() => undefined) : Promise.resolve(),
    { retirementTimeoutMs: 30, onRetirementFailure: (process, reason) => failures.push([process.id, String(reason.message)]) }
  );
  const first = await gate.ensure();
  first.alive = false;
  void gate.retire(first);
  const started = Date.now();
  const second = await gate.ensure();
  assert.equal(second.id, 2);
  assert.ok(Date.now() - started < 2000);
  assert.equal(failures.length, 1);
  assert.match(failures[0][1], /PROCESS_RETIREMENT_TIMEOUT/);
  assert.deepEqual(gate.unterminatedProcesses().map(process => process.id), [1]);
});

test("successful retirements keep strict ordering and leave no unterminated process", async () => {
  let starts = 0;
  const order = [];
  const gate = new SingleProcessGate(
    () => { order.push(`start${starts + 1}`); return { id: ++starts, alive: true }; },
    process => process.alive,
    async process => { await new Promise(resolve => setTimeout(resolve, 10)); process.alive = false; order.push(`stop${process.id}`); },
    { retirementTimeoutMs: 1000 }
  );
  const first = await gate.ensure();
  void gate.retire(first);
  await gate.ensure();
  assert.deepEqual(order, ["start1", "stop1", "start2"]);
  assert.deepEqual(gate.unterminatedProcesses(), []);
});

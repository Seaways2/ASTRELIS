const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const { SingleProcessGate } = require(path.join(root, "dist-electron/singleProcessGate.js"));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

test("100 simultaneous ensure calls start exactly one native process", async () => {
  let starts = 0;
  const gate = new SingleProcessGate(
    async () => ({ id: ++starts, alive: true }),
    process => process.alive,
    async process => { process.alive = false; }
  );
  const processes = await Promise.all(Array.from({ length: 100 }, () => gate.ensure()));
  assert.equal(starts, 1);
  assert.equal(new Set(processes).size, 1);
});

test("replacement waits for the retiring process to exit", async () => {
  let starts = 0;
  const exit = deferred();
  const gate = new SingleProcessGate(
    () => ({ id: ++starts, alive: true }),
    process => process.alive,
    async process => { await exit.promise; process.alive = false; }
  );
  const first = await gate.ensure();
  const retiring = gate.retire(first);
  let replacementSettled = false;
  const replacement = gate.ensure().then(process => { replacementSettled = true; return process; });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(replacementSettled, false);
  assert.equal(starts, 1);
  exit.resolve();
  await retiring;
  const second = await replacement;
  assert.equal(starts, 2);
  assert.notEqual(second, first);
});

test("a stale process exit cannot clear the replacement", async () => {
  let starts = 0;
  const gate = new SingleProcessGate(
    () => ({ id: ++starts, alive: true }),
    process => process.alive,
    async process => { process.alive = false; }
  );
  const first = await gate.ensure();
  await gate.retire(first);
  const second = await gate.ensure();
  assert.equal(gate.clearIfCurrent(first), false);
  assert.equal(gate.current(), second);
  assert.equal(gate.clearIfCurrent(second), true);
  assert.equal(gate.current(), null);
});


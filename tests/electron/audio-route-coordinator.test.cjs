const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const sourcePath = path.resolve(__dirname, "../../electron/audioRouteCoordinator.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleValue = { exports: {} };
new Function("module", "exports", "require", js)(moduleValue, moduleValue.exports, require);
const { AudioRouteCoordinator } = moduleValue.exports;

test("route ownership rejects stale commits and releases", () => {
  const routes = new AudioRouteCoordinator();
  const local = routes.prepare("local", "local:1");
  const youtube = routes.prepare("youtube", "youtube:2");
  assert.equal(routes.commit(local.generation).error, "STALE_ROUTE_COMMIT");
  assert.equal(routes.commit(youtube.generation).ok, true);
  assert.equal(routes.release("local", "local:1").error, "STALE_ROUTE_RELEASE");
  assert.equal(routes.snapshot().active.source, "youtube");
});

test("100 rapid source transitions leave exactly one authoritative owner", () => {
  const routes = new AudioRouteCoordinator();
  const prepared = [];
  const sources = ["local", "netease", "youtube", "web-direct"];
  for (let index = 0; index < 100; index++) {
    const source = sources[index % sources.length];
    prepared.push({ source, sessionId: `${source}:${index}`, ...routes.prepare(source, `${source}:${index}`) });
  }
  for (let index = 0; index < prepared.length - 1; index++)
    assert.equal(routes.commit(prepared[index].generation).error, "STALE_ROUTE_COMMIT");
  const winner = prepared.at(-1);
  assert.equal(routes.commit(winner.generation).ok, true);
  for (let index = 0; index < prepared.length - 1; index++)
    assert.equal(routes.release(prepared[index].source, prepared[index].sessionId).error, "STALE_ROUTE_RELEASE");
  const snapshot = routes.snapshot();
  assert.equal(snapshot.phase, "active");
  assert.deepEqual(snapshot.active, { source: winner.source, sessionId: winner.sessionId, generation: winner.generation });
  assert.equal(snapshot.pending, null);
});

test("failed candidate abort restores the previous authoritative owner", () => {
  const routes = new AudioRouteCoordinator();
  const local = routes.prepare("local", "local:stable");
  assert.equal(routes.commit(local.generation).ok, true);
  const candidate = routes.prepare("youtube", "youtube:failed");
  assert.equal(routes.abort(candidate.generation).ok, true);
  assert.equal(routes.snapshot().active.source, "local");
  assert.equal(routes.snapshot().active.sessionId, "local:stable");
});

test("serialized 100-operation route lane completes without deadlock", async () => {
  const routes = new AudioRouteCoordinator();
  const sources = ["local", "netease", "youtube", "web-direct"];
  let lane = Promise.resolve();
  for (let index = 0; index < 100; index++) {
    lane = lane.then(async () => {
      const source = sources[index % sources.length];
      const prepared = routes.prepare(source, `${source}:lane:${index}`);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(routes.commit(prepared.generation).ok, true);
    });
  }
  await Promise.race([
    lane,
    new Promise((_, reject) => setTimeout(() => reject(new Error("route lane deadlocked")), 2000))
  ]);
  assert.equal(routes.snapshot().active.sessionId, "web-direct:lane:99");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const compiled = ts.transpileModule(read("src/utils/libraryThumbnailCache.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const loaded = { exports: {} };
Function("exports", compiled)(loaded.exports);
const { createThumbnailStore, createThumbnailQueue, isAbandonedThumbnail } = loaded.exports;

const storeWithSpy = maxWeight => {
  const revoked = [];
  return { revoked, store: createThumbnailStore({ maxWeight, revoke: url => revoked.push(url) }) };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

test("the store evicts least recently used blobs until it is under budget", () => {
  const { store, revoked } = storeWithSpy(100);
  store.keep("a", "url-a", 40);
  store.keep("b", "url-b", 40);
  store.keep("c", "url-c", 10);
  assert.equal(store.get("a"), "url-a"); // a is now the most recent of the three
  store.keep("d", "url-d", 40);
  assert.deepEqual(revoked, ["url-b"]);
  assert.equal(store.weight(), 90);
  assert.equal(store.get("b"), undefined);
  assert.equal(store.get("a"), "url-a");
});

test("replacing or invalidating a key keeps the weight exact and revokes the old URL", () => {
  const { store, revoked } = storeWithSpy(1000);
  store.keep("a", "url-a1", 30);
  store.keep("a", "url-a2", 50);
  assert.equal(store.weight(), 50);
  assert.deepEqual(revoked, ["url-a1"]);
  store.invalidate("a");
  assert.equal(store.weight(), 0);
  assert.deepEqual(revoked, ["url-a1", "url-a2"]);
  assert.equal(store.has("a"), false);
});

test("keeping a pinned key again keeps the URL on screen and revokes the duplicate", () => {
  const { store, revoked } = storeWithSpy(1000);
  assert.equal(store.keep("a", "url-a1", 30), "url-a1");
  store.pin("a");
  assert.equal(store.keep("a", "url-a2", 50), "url-a1");
  assert.deepEqual(revoked, ["url-a2"]);
  assert.equal(store.get("a"), "url-a1");
  assert.equal(store.weight(), 30);
  store.unpin("a");
  assert.equal(store.keep("a", "url-a3", 20), "url-a3");
  assert.deepEqual(revoked, ["url-a2", "url-a1"]);
  assert.equal(store.weight(), 20);
});

test("covers on screen are pinned against eviction", () => {
  const { store, revoked } = storeWithSpy(50);
  store.keep("a", "url-a", 40);
  store.pin("a");
  store.pin("a");
  store.keep("b", "url-b", 40);
  // Over budget, but a is pinned and b is the newest: eviction stops instead of looping.
  assert.deepEqual(revoked, []);
  assert.equal(store.weight(), 80);
  store.unpin("a");
  assert.deepEqual(revoked, [], "still pinned by a second viewer");
  store.unpin("a");
  assert.deepEqual(revoked, ["url-a"]);
  assert.equal(store.weight(), 40);
  store.unpin("a"); // stray unpins never go negative
  store.pin("b");
  store.keep("c", "url-c", 40);
  assert.equal(store.get("b"), "url-b");
});

test("the queue never runs more than its limit at once", async () => {
  const queue = createThumbnailQueue(2);
  const jobs = Array.from({ length: 5 }, () => deferred());
  let running = 0, peak = 0;
  const releases = jobs.map((_, index) => queue.claim(`cover-${index}`));
  const results = jobs.map((job, index) => queue.run(`cover-${index}`, async () => {
    running++;
    peak = Math.max(peak, running);
    try { return await job.promise; } finally { running--; }
  }));
  await settle();
  assert.equal(running, 2);
  jobs.forEach((job, index) => job.resolve(index));
  assert.deepEqual(await Promise.all(results), [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.equal(queue.active(), 0);
  releases.forEach(release => release());
});

test("covers paged past before their turn are skipped, not failed", async () => {
  const queue = createThumbnailQueue(1);
  const first = deferred();
  const calls = [];
  const releaseFirst = queue.claim("first");
  const releasePassed = queue.claim("passed");
  const releaseBack = queue.claim("back");
  const releaseLast = queue.claim("last");
  const running = queue.run("first", () => { calls.push("first"); return first.promise; });
  const passed = queue.run("passed", async () => { calls.push("passed"); return "passed"; });
  const back = queue.run("back", async () => { calls.push("back"); return "back"; });
  const last = queue.run("last", async () => { calls.push("last"); return "last"; });
  releasePassed();
  releasePassed(); // release is idempotent
  // Paged away from and back to before its turn: the second claim keeps it.
  releaseBack();
  const releaseBackAgain = queue.claim("back");
  first.resolve("first");
  await assert.rejects(passed, error => isAbandonedThumbnail(error));
  assert.deepEqual(await Promise.all([running, back, last]), ["first", "back", "last"]);
  assert.deepEqual(calls, ["first", "back", "last"]);
  assert.equal(isAbandonedThumbnail(new Error("Artwork: 404")), false);
  [releaseFirst, releaseBackAgain, releaseLast].forEach(release => release());
});

test("a running job finishes even when its cover leaves, so the result is still cached", async () => {
  const queue = createThumbnailQueue(1);
  const job = deferred();
  const release = queue.claim("cover");
  const result = queue.run("cover", () => job.promise);
  await settle();
  release();
  job.resolve("done");
  assert.equal(await result, "done");
});

test("the thumbnail component uses the store, the queue and abandonment-aware failures", () => {
  const thumbnail = read("src/components/LibraryThumbnail.tsx");
  assert.match(thumbnail, /const MAX_READY_WEIGHT = 160 \* 1024 \* 1024;/);
  assert.match(thumbnail, /const MAX_SOURCE_METADATA = 2048;/);
  assert.match(thumbnail, /if \(!isAbandonedThumbnail\(error\)\) rememberFailure\(key\);/);
  assert.match(thumbnail, /store\.pin\(displayKey\);\s*return \(\) => store\.unpin\(displayKey\);/);
  assert.match(thumbnail, /release \?\?= queue\.claim\(source\);/);
  assert.match(thumbnail, /cancelled = true;\s*release\?\.\(\);/);
  assert.doesNotMatch(thumbnail, /readyWeight/);
});

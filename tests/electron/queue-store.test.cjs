const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { QueueStore, parseSavedQueues } = require("../../dist-electron/queue/QueueStore.js");

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-queues-"));
  try { return run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
const queue = (...names) => ({
  kind: "music",
  tracks: names.map(name => ({ id: name, name, sourcePath: `K:\\music\\${name}.flac` })),
  selection: { music: names[0] || "" },
  bookmarks: names.length ? { [names[0]]: 12.5 } : {}
});

test("saves atomically and loads the newest snapshot", () => withTempDirectory(base => {
  const store = new QueueStore(base, { saveDelayMs: 10_000 });
  assert.equal(store.load(), null);
  assert.equal(store.save(queue("a", "b")), true);
  assert.deepEqual(store.load().tracks.map(track => track.id), ["a", "b"], "pending snapshot is visible before the write");
  store.flush();
  assert.equal(fs.existsSync(path.join(base, "queues-v1.json.tmp")), false);
  assert.deepEqual(new QueueStore(base).load(), queue("a", "b"));
}));

test("an emptied or replaced queue leaves the previous one in a backup", () => withTempDirectory(base => {
  let clock = 1000;
  const store = new QueueStore(base, { now: () => clock++ });
  store.save(queue("a", "b", "c")); store.flush();
  store.save({ ...queue("a", "b", "c"), bookmarks: { a: 99 } }); store.flush();
  assert.equal(store.backupFiles().length, 0, "position-only updates do not create backups");
  store.save(queue()); store.flush();
  const backups = store.backupFiles();
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(backups[0], "utf8")).tracks.map(track => track.id), ["a", "b", "c"]);
  store.save(queue("x")); store.flush();
  assert.equal(store.backupFiles().length, 1, "an empty queue is not worth a backup");
}));

test("backups rotate and a damaged queue file falls back to the newest backup", () => withTempDirectory(base => {
  let clock = 1000;
  const store = new QueueStore(base, { backups: 3, now: () => clock++ });
  for (const name of ["a", "b", "c", "d", "e", "f"]) { store.save(queue(name)); store.flush(); }
  const backups = store.backupFiles();
  assert.equal(backups.length, 3);
  assert.deepEqual(backups.map(file => JSON.parse(fs.readFileSync(file, "utf8")).tracks[0].id), ["e", "d", "c"]);
  fs.writeFileSync(path.join(base, "queues-v1.json"), "{ broken");
  assert.equal(new QueueStore(base).load().tracks[0].id, "e");
}));

test("malformed snapshots are rejected and unsafe fields are dropped", () => {
  assert.equal(parseSavedQueues(null), null);
  assert.equal(parseSavedQueues({ tracks: "nope" }), null);
  assert.equal(parseSavedQueues({ tracks: Array.from({ length: 20_001 }, () => ({ sourcePath: "a" })) }), null);
  const parsed = parseSavedQueues({
    kind: "other",
    tracks: [{ id: "a", sourcePath: "K:\\a.flac" }, { id: "b" }, null, { sourcePath: 7 }],
    selection: { music: "a", video: 3 },
    bookmarks: { a: 5, b: -1, c: Infinity, d: "1" }
  });
  assert.equal(parsed.kind, "music");
  assert.deepEqual(parsed.tracks.map(track => track.id), ["a"]);
  assert.deepEqual(parsed.selection, { music: "a" });
  assert.deepEqual(parsed.bookmarks, { a: 5 });
});

test("main wires the queue store, trusted-sender IPC and the quit flush", () => {
  const main = fs.readFileSync(path.join(__dirname, "../../electron/main.ts"), "utf8");
  assert.match(main, /queueStore = new QueueStore\(app\.getPath\("userData"\)\);\s*registerQueueIpc\(\{ getMainWindow: \(\) => mainWindow, queueStore, writeLog \}\);/);
  assert.match(main, /app\.on\("will-quit", \(\) => \{[\s\S]*queueStore\?\.flush\(\);/);
  const ipc = fs.readFileSync(path.join(__dirname, "../../electron/ipc/queueIpc.ts"), "utf8");
  assert.match(ipc, /ipcMain\.handle\("queue:load", event => trusted\(event\) \? queueStore\.load\(\) : null\);/);
  assert.match(ipc, /ipcMain\.on\("queue:save", \(event, payload: unknown\) => \{\s*if \(!trusted\(event\)\) return;/);
});

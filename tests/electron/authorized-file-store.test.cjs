const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AuthorizedFileStore } = require("../../dist-electron/security/AuthorizedFileStore.js");
const { LocalMediaAccessPolicy } = require("../../dist-electron/security/ElectronSecurity.js");

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-grants-"));
  try { return run(directory); }
  finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("explicit file grants survive a restart through the store", () => withTempDirectory(base => {
  const storePath = path.join(base, "authorized-files-v1.json");
  const outside = path.join(base, "outside.flac");
  fs.writeFileSync(outside, "audio");

  const firstPolicy = new LocalMediaAccessPolicy();
  const firstStore = new AuthorizedFileStore(storePath);
  firstStore.load();
  firstPolicy.onFileAuthorized = file => firstStore.record(file);
  firstPolicy.authorizeFile(outside);
  firstStore.flush();

  const restartedPolicy = new LocalMediaAccessPolicy();
  assert.equal(restartedPolicy.isAllowed(outside), false, "grants are not implicit after a restart");
  const restartedStore = new AuthorizedFileStore(storePath);
  restartedStore.load().forEach(file => restartedPolicy.authorizeFile(file));
  assert.equal(restartedPolicy.isAllowed(outside), true);
  assert.equal(restartedPolicy.hasExplicitGrant(outside), true);
}));

test("a missing file is not granted but its persisted grant survives (unplugged drive)", () => withTempDirectory(base => {
  const storePath = path.join(base, "authorized-files-v1.json");
  const kept = path.join(base, "kept.mp3");
  const offline = path.join(base, "offline.mp3");
  fs.writeFileSync(kept, "audio");
  fs.writeFileSync(storePath, JSON.stringify({ version: 1, files: [kept, offline] }));

  const policy = new LocalMediaAccessPolicy();
  const store = new AuthorizedFileStore(storePath);
  const persisted = store.load();
  persisted.forEach(file => policy.authorizeFile(file));
  store.reset(persisted);
  store.flush();
  assert.equal(policy.isAllowed(offline), false);
  assert.deepEqual(new AuthorizedFileStore(storePath).load(), [kept, offline]);

  // The drive comes back: the next launch grants it again.
  fs.writeFileSync(offline, "audio");
  const relaunched = new LocalMediaAccessPolicy();
  new AuthorizedFileStore(storePath).load().forEach(file => relaunched.authorizeFile(file));
  assert.equal(relaunched.isAllowed(offline), true);
}));

test("reset dedupes Windows paths case-insensitively, keeping the newest spelling", () => withTempDirectory(base => {
  const storePath = path.join(base, "authorized-files-v1.json");
  const store = new AuthorizedFileStore(storePath);
  store.reset([path.join(base, "A.mp3"), path.join(base, "b.mp3"), path.join(base, "a.mp3")]);
  assert.deepEqual(store.list(), [path.join(base, "b.mp3"), path.join(base, "a.mp3")]);
}));

test("only new external grants are reported; library files and missing files are not", () => withTempDirectory(base => {
  const library = path.join(base, "library");
  fs.mkdirSync(library);
  const inLibrary = path.join(library, "song.flac");
  const outside = path.join(base, "dropped.wav");
  fs.writeFileSync(inLibrary, "audio");
  fs.writeFileSync(outside, "audio");

  const reported = [];
  const policy = new LocalMediaAccessPolicy();
  policy.registerRoot(library);
  policy.onFileAuthorized = file => reported.push(file);
  policy.authorizeFile(inLibrary);
  policy.authorizeFile(path.join(base, "missing.wav"));
  policy.authorizeFile("relative.wav");
  policy.authorizeFile(outside);
  policy.authorizeFile(outside);
  assert.deepEqual(reported, [outside]);
}));

test("folder protection still blocks a persisted grant", () => withTempDirectory(base => {
  const hidden = path.join(base, "hidden");
  fs.mkdirSync(hidden);
  const file = path.join(hidden, "private.flac");
  fs.writeFileSync(file, "audio");

  const policy = new LocalMediaAccessPolicy();
  policy.authorizeFile(file);
  policy.blocked = candidate => candidate.startsWith(hidden);
  assert.equal(policy.hasExplicitGrant(file), true);
  assert.equal(policy.isAllowed(file), false);
}));

test("the store keeps the most recent grants up to its limit and tolerates damage", () => withTempDirectory(base => {
  const storePath = path.join(base, "authorized-files-v1.json");
  const store = new AuthorizedFileStore(storePath, 3);
  store.load();
  for (const name of ["a", "b", "c", "d"]) store.record(path.join(base, `${name}.mp3`));
  store.record(path.join(base, "b.mp3"));
  store.flush();
  assert.deepEqual(new AuthorizedFileStore(storePath, 3).load(), ["c", "d", "b"].map(name => path.join(base, `${name}.mp3`)));

  fs.writeFileSync(storePath, "{ not json");
  assert.deepEqual(new AuthorizedFileStore(storePath).load(), []);
  fs.writeFileSync(storePath, JSON.stringify({ version: 1, files: ["relative.mp3", 7, path.join(base, "ok.mp3")] }));
  assert.deepEqual(new AuthorizedFileStore(storePath).load(), [path.join(base, "ok.mp3")]);
}));

test("open-files skips paths without a grant instead of failing the whole batch", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../electron/ipc/libraryIpc.ts"), "utf8");
  const handler = source.slice(source.indexOf('ipcMain.handle("library:open-files"'), source.indexOf('return { tracks, errors: errors.slice(0, 20), unauthorized };'));
  assert.ok(handler.length > 0);
  assert.doesNotMatch(handler, /未授权的外部音频路径/);
  // Waits for startup root registration instead of reloading the snapshot per call.
  assert.match(handler, /await libraryRootsReady;\s*const unauthorized = visiblePaths\.filter\(sourcePath => !localMediaAccess\?\.isAllowed\(sourcePath\)\);/);
  assert.doesNotMatch(handler, /getSnapshot/);
  assert.match(handler, /externalAudioPaths\(requestedPaths\)/);
});

test("main registers persisted library folders at startup, before the window opens", () => {
  const main = require("node:fs").readFileSync(require("node:path").join(__dirname, "../../electron/main.ts"), "utf8");
  assert.match(main, /const libraryRootsReady: Promise<void> = libraryService\.getSnapshot\(\)\s*\.then\(result => \{ \(result\.snapshot\?\.folders \|\| \[\]\)\.forEach\(folder => localMediaAccess\?\.registerRoot\(folder\)\); \}\)/);
  const startup = main.slice(main.indexOf("const libraryRootsReady"));
  assert.ok(startup.indexOf("await Promise.race([libraryRootsReady") < startup.indexOf("\n  createWindow();"));
  assert.match(main, /authorisedAudio, prepareLocalSource, writeLog, libraryRootsReady/);
});

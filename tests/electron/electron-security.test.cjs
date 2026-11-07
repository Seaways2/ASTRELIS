const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  LocalMediaAccessPolicy,
  pathIsContained,
  safeExternalUrl,
  sameOriginNavigation
} = require("../../dist-electron/security/ElectronSecurity.js");
const {
  parseAbsolutePath,
  parseCommandMeta,
  parseLegacyMutation,
  parsePathList,
  parseRescanRequest
} = require("../../dist-electron/library/validation/LibraryIpcValidator.js");

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-security-"));
  try { return run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test("local media policy accepts registered roots and rejects siblings or traversal", () => withTempDirectory(base => {
  const root = path.join(base, "Music");
  const sibling = path.join(base, "Music-Evil");
  fs.mkdirSync(root);
  fs.mkdirSync(sibling);
  const inside = path.join(root, "album", "song.flac");
  const outside = path.join(sibling, "secret.flac");
  fs.mkdirSync(path.dirname(inside));
  fs.writeFileSync(inside, "audio");
  fs.writeFileSync(outside, "secret");

  const policy = new LocalMediaAccessPolicy();
  policy.registerRoot(root);
  assert.equal(policy.isRegisteredRoot(root), true);
  assert.equal(policy.isRegisteredRoot(sibling), false);
  assert.equal(policy.isAllowed(inside), true);
  assert.equal(policy.isAllowed(outside), false);
  assert.equal(pathIsContained(path.join(root, "..", "Music-Evil", "secret.flac"), root), false);
}));

test("local media policy supports app cache directories and explicit file grants", () => withTempDirectory(base => {
  const cache = path.join(base, "cache");
  const dropped = path.join(base, "dropped.wav");
  const denied = path.join(base, "denied.wav");
  fs.mkdirSync(cache);
  fs.writeFileSync(path.join(cache, "cover.jpg"), "image");
  fs.writeFileSync(dropped, "audio");
  fs.writeFileSync(denied, "audio");

  const policy = new LocalMediaAccessPolicy();
  policy.registerApplicationDirectory(cache);
  policy.authorizeFile(dropped);
  assert.equal(policy.isAllowed(path.join(cache, "cover.jpg")), true);
  assert.equal(policy.isAllowed(dropped), true);
  assert.equal(policy.isAllowed(denied), false);
}));

test("external URL and navigation validation reject executable or credentialed URLs", () => {
  assert.equal(safeExternalUrl("https://example.com/music?q=1"), true);
  assert.equal(safeExternalUrl("http://localhost:41739"), true);
  for (const value of [
    "javascript:alert(1)",
    "file:///C:/Windows/win.ini",
    "data:text/html,pwned",
    "https://user:pass@example.com/"
  ]) assert.equal(safeExternalUrl(value), false);
  assert.equal(sameOriginNavigation("http://localhost:41739/library", "http://localhost:41739"), true);
  assert.equal(sameOriginNavigation("http://localhost.evil:41739/", "http://localhost:41739"), false);
});

test("library IPC validators enforce command metadata and absolute bounded paths", () => withTempDirectory(base => {
  assert.deepEqual(parseCommandMeta({ requestId: "request-1", expectedRevision: 3 }), {
    requestId: "request-1", expectedRevision: 3
  });
  assert.equal(parseAbsolutePath(base), path.resolve(base));
  assert.deepEqual(parsePathList([base]), [path.resolve(base)]);
  assert.deepEqual(parseRescanRequest({ folders: [base], meta: { requestId: "scan-1" } }).folders, [path.resolve(base)]);
  assert.throws(() => parseCommandMeta({ requestId: "" }), /requestId/);
  assert.throws(() => parseCommandMeta({ requestId: "x", expectedRevision: -1 }), /expectedRevision/);
  assert.throws(() => parseAbsolutePath("relative/music"), /invalid/);
  assert.throws(() => parsePathList(new Array(10001).fill(base)), /invalid/);
}));

test("legacy mutation validation rejects malformed tracks and normalizes folder paths", () => withTempDirectory(base => {
  const track = {
    id: "track-1", name: "Song", artist: "Artist", album: "Album",
    url: "auralis-media://local/song", format: "FLAC", size: 10
  };
  const parsed = parseLegacyMutation({ tracks: [track], folders: [base], meta: { requestId: "legacy-1" } });
  assert.deepEqual(parsed.folders, [path.resolve(base)]);
  assert.throws(() => parseLegacyMutation({ tracks: [{}], folders: [base], meta: { requestId: "bad" } }), /invalid legacy Track/);
  assert.throws(() => parseLegacyMutation({ tracks: [track], folders: ["relative"], meta: { requestId: "bad-path" } }), /invalid/);
}));

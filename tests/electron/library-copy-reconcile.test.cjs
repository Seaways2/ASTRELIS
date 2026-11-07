const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { LibraryReconciler } = require("../../dist-electron/library/reconcile/LibraryReconciler.js");
const { toTrackRecord, disambiguateMediaIds } = require("../../dist-electron/library/domain/LibraryDomain.js");
const root = "K:\\SyntheticMusic";
const copies = names => disambiguateMediaIds(names.map(name => ({ ...toTrackRecord({ folders: [root], fingerprint: "a".repeat(64), mtimeMs: 1,
  track: { id: name, name: "Same song", artist: "Artist", album: "Album", size: 100, format: "FLAC", sourcePath: path.join(root, name), url: "media:" + name } }), metadataRead: true })));
const reconcile = (previous, observed, status = "complete") => new LibraryReconciler().reconcile({ tracks: previous, folders: [root] }, {
  scanId: "synthetic", startedAt: "", completedAt: "", roots: [{ rootId: "root", path: root, status, scannedFiles: observed.length,
    skippedFiles: 0, unreadableDirectories: [] }], tracks: observed, failures: []
}, [root]);

test("deleting the first identical copy retains the surviving copy identity", () => {
  const [a, b] = copies(["a.flac", "b.flac"]);
  for (const previous of [[a, b], [b, a]]) {
    const result = reconcile(previous, copies(["b.flac"]));
    assert.equal(result.snapshot.tracks[0].mediaId, b.mediaId);
    assert.deepEqual(result.removed, [a.id]); assert.deepEqual(result.relocated, []);
  }
});
test("moving one identical copy does not steal a surviving direct match", () => {
  const [a, b] = copies(["a.flac", "b.flac"]);
  const result = reconcile([a, b], copies(["b.flac", "c.flac"]));
  assert.equal(result.snapshot.tracks.find(track => track.sourcePath.endsWith("b.flac")).mediaId, b.mediaId);
  assert.equal(result.snapshot.tracks.find(track => track.sourcePath.endsWith("c.flac")).mediaId, a.mediaId);
  assert.deepEqual(result.relocated, [a.id]);
});
test("partial scans retain missing copies without changing observed copy identities", () => {
  const [a, b] = copies(["a.flac", "b.flac"]);
  const result = reconcile([a, b], copies(["b.flac"]), "partial");
  assert.equal(result.snapshot.tracks.length, 2); assert.deepEqual(result.removed, []);
  assert.equal(result.snapshot.tracks.find(track => track.sourcePath.endsWith("b.flac")).mediaId, b.mediaId);
  assert.deepEqual(result.unavailable, [a.id]);
});
test("ambiguous duplicate relocations are not assigned by iteration order", () => {
  const result = reconcile(copies(["a.flac", "b.flac"]), copies(["c.flac", "d.flac"]));
  assert.deepEqual(result.relocated, []); assert.equal(result.added.length, 2); assert.equal(result.removed.length, 2);
});

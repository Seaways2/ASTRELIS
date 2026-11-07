const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { LibraryReconciler } = require(path.join(root, "dist-electron/library/reconcile/LibraryReconciler.js"));
const { JsonLibraryRepository } = require(path.join(root, "dist-electron/library/repository/JsonLibraryRepository.js"));
const { LibraryService } = require(path.join(root, "dist-electron/library/LibraryService.js"));

const musicRoot = "Z:\\NAS\\Music";

function track(index, rootPath = musicRoot) {
  const sourcePath = path.win32.join(rootPath, "Album", "track-" + index + ".flac");
  return {
    id: "track-" + index,
    name: "Track " + index,
    artist: "Known Artist",
    album: "Known Album",
    genre: "Known Genre",
    url: "auralis-media://local/" + index,
    format: "FLAC",
    size: 100 + index,
    sourcePath,
    nativePath: sourcePath,
    folder: path.win32.dirname(sourcePath)
  };
}

function scan(status, tracks, failures = []) {
  return {
    scanId: "scan-" + status,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(),
    roots: [{
      rootId: "root",
      path: musicRoot,
      status,
      scannedFiles: tracks.length,
      skippedFiles: failures.length,
      unreadableDirectories: failures.map(item => item.path)
    }],
    tracks,
    failures
  };
}

test("only a complete root can authorize deletion", () => {
  const reconciler = new LibraryReconciler();
  const previousTracks = Array.from({ length: 10 }, (_, index) => track(index));
  const observed = previousTracks.slice(0, 7);
  for (const status of ["partial", "offline", "permissionDenied", "cancelled"]) {
    const result = reconciler.reconcile(
      { tracks: previousTracks, folders: [musicRoot] },
      scan(status, status === "partial" ? observed : []),
      [musicRoot]
    );
    assert.equal(result.removed.length, 0, status + " must not remove tracks");
    assert.equal(result.snapshot.tracks.length, 10);
    assert.equal(result.unavailable.length, status === "partial" ? 3 : 10);
  }
  const complete = reconciler.reconcile(
    { tracks: previousTracks, folders: [musicRoot] },
    scan("complete", observed),
    [musicRoot]
  );
  assert.deepEqual(complete.removed, ["track-7", "track-8", "track-9"]);
  assert.equal(complete.snapshot.tracks.length, 7);
});

test("partial observation updates seen tracks but preserves every unverified track", () => {
  const reconciler = new LibraryReconciler();
  const previousTracks = Array.from({ length: 10 }, (_, index) => track(index));
  const observed = previousTracks.slice(0, 7).map(item => ({ ...item, name: item.name + " updated", metadataRead: true }));
  const failure = { stage: "directory", path: musicRoot + "\\Unavailable", code: "EACCES", message: "denied" };
  const result = reconciler.reconcile(
    { tracks: previousTracks, folders: [musicRoot] },
    scan("partial", observed, [failure]),
    [musicRoot]
  );
  assert.equal(result.updated.length, 7);
  assert.deepEqual(result.unavailable, ["track-7", "track-8", "track-9"]);
  assert.equal(result.snapshot.tracks.length, 10);
  assert.deepEqual(result.failures, [failure]);
});

test("metadata failure preserves the last known tags and artwork", () => {
  const reconciler = new LibraryReconciler();
  const previous = { ...track(1), coverUrl: "cached-cover", year: 2024, duration: 180 };
  const failed = {
    ...previous,
    name: "fallback filename",
    artist: "未知艺术家",
    album: "未分类专辑",
    genre: "未分类",
    coverUrl: undefined,
    metadataRead: false
  };
  const result = reconciler.reconcile(
    { tracks: [previous], folders: [musicRoot] },
    scan("complete", [failed]),
    [musicRoot]
  );
  assert.deepEqual(result.snapshot.tracks[0], previous);
  assert.deepEqual(result.preserved, [previous.id]);
});

test("tracks outside the scanned root are always preserved", () => {
  const reconciler = new LibraryReconciler();
  const local = track(1, "D:\\Local");
  const nas = track(2);
  const result = reconciler.reconcile(
    { tracks: [local, nas], folders: ["D:\\Local", musicRoot] },
    scan("complete", []),
    ["D:\\Local", musicRoot]
  );
  assert.deepEqual(result.removed, [nas.id]);
  assert.deepEqual(result.preserved, [local.id]);
  assert.equal(result.snapshot.tracks.length, 1);
});

test("partial scan integration cannot reduce a committed library, while complete scan can", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-library-reconcile-"));
  try {
    const repository = new JsonLibraryRepository({ storageDirectory: path.join(directory, "library-v2") });
    const service = new LibraryService(repository);
    const previousTracks = Array.from({ length: 10 }, (_, index) => track(index));
    const initial = await service.commitLegacySnapshot(
      { tracks: previousTracks, folders: [musicRoot] },
      { requestId: "initial", expectedRevision: 0 }
    );
    const authoritativeInitial = await service.getSnapshot();
    const expectedRemoved = authoritativeInitial.snapshot.tracks.slice(7).map(track => track.id);
    const partial = await service.applyScan(
      scan("partial", previousTracks.slice(0, 7), [{
        stage: "directory", path: musicRoot + "\\Unavailable", code: "EACCES", message: "denied"
      }]),
      [musicRoot],
      { requestId: "partial", expectedRevision: initial.revision }
    );
    assert.equal(partial.mutation.status, "noop");
    assert.equal((await service.getSnapshot()).snapshot.tracks.length, 10);

    const complete = await service.applyScan(
      scan("complete", previousTracks.slice(0, 7)),
      [musicRoot],
      { requestId: "complete", expectedRevision: initial.revision }
    );
    assert.equal(complete.mutation.status, "committed");
    assert.deepEqual(complete.reconcile.removed, expectedRemoved);
    assert.equal((await service.getSnapshot()).snapshot.tracks.length, 7);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

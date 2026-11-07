const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { albumIdentity, toTrackRecord, upgradeLibraryDomain } = require(path.join(root, "dist-electron/library/domain/LibraryDomain.js"));
const { validateLibraryPayloadV2 } = require(path.join(root, "dist-electron/library/validation/LibraryValidator.js"));
const { LibraryReconciler } = require(path.join(root, "dist-electron/library/reconcile/LibraryReconciler.js"));
const { JsonLibraryRepository } = require(path.join(root, "dist-electron/library/repository/JsonLibraryRepository.js"));
const { LibraryMigrator } = require(path.join(root, "dist-electron/library/migration/LibraryMigrator.js"));

function legacyTrack(sourcePath, overrides = {}) {
  return {
    id: "legacy-path-id",
    name: "Song",
    artist: "Artist A",
    album: "Shared Title",
    genre: "Rock",
    url: "auralis-media://local/" + encodeURIComponent(sourcePath),
    format: "FLAC",
    size: 123456,
    sourcePath,
    nativePath: sourcePath,
    duration: 241.25,
    folder: path.win32.dirname(sourcePath),
    ...overrides
  };
}

test("mediaId is stable across rename and drive changes when file fingerprint matches", () => {
  const fingerprint = "f".repeat(64);
  const before = toTrackRecord({
    track: legacyTrack("D:\\Music\\Album\\before.flac"),
    folders: ["D:\\Music"],
    fingerprint,
    mtimeMs: 100
  });
  const after = toTrackRecord({
    track: legacyTrack("E:\\Archive\\Renamed\\after.flac"),
    folders: ["E:\\Archive"],
    fingerprint,
    mtimeMs: 200
  });
  assert.equal(after.mediaId, before.mediaId);
  assert.notEqual(after.location.canonicalPath, before.location.canonicalPath);
  assert.notEqual(after.location.rootId, before.location.rootId);
});

test("domain tags support multiple artists, albumArtist and compilation without persisting unknown labels", () => {
  const multi = toTrackRecord({
    track: legacyTrack("D:\\Music\\multi.flac"),
    folders: ["D:\\Music"],
    artistNames: ["Artist A", "Artist B"],
    albumArtist: "Various Artists",
    genres: ["Rock", "Live"],
    trackNumber: 2,
    discNumber: 1,
    compilation: true
  });
  assert.deepEqual(multi.tags.artists.map(artist => artist.name), ["Artist A", "Artist B"]);
  assert.equal(multi.tags.albumArtist, "Various Artists");
  assert.equal(multi.tags.compilation, true);
  assert.equal(multi.tags.trackNumber, 2);

  const unknown = toTrackRecord({
    track: legacyTrack("D:\\Music\\unknown.flac", {
      name: "unknown",
      artist: "未知艺术家",
      album: "未分类专辑",
      genre: "未分类"
    }),
    folders: ["D:\\Music"]
  });
  assert.deepEqual(unknown.tags.artists, []);
  assert.equal(unknown.tags.album, undefined);
  assert.deepEqual(unknown.tags.genres, []);
});

test("same album title from different album artists has different album identity", () => {
  assert.notEqual(
    albumIdentity("Greatest Hits", "Artist A", false),
    albumIdentity("Greatest Hits", "Artist B", false)
  );
  const payload = upgradeLibraryDomain({
    tracks: [
      legacyTrack("D:\\Music\\A\\one.flac", { artist: "Artist A", album: "Greatest Hits" }),
      legacyTrack("D:\\Music\\B\\two.flac", { artist: "Artist B", album: "Greatest Hits", size: 654321 })
    ],
    folders: ["D:\\Music"]
  });
  assert.equal(payload.albums.length, 2);
  assert.equal(new Set(payload.albums.map(album => album.albumId)).size, 2);
});

test("duplicate filenames in different folders retain distinct media identities", () => {
  const first = toTrackRecord({
    track: legacyTrack("D:\\Music\\Artist A\\same.flac"), folders: ["D:\\Music"], fingerprint: "1".repeat(64)
  });
  const second = toTrackRecord({
    track: legacyTrack("D:\\Music\\Artist B\\same.flac"), folders: ["D:\\Music"], fingerprint: "2".repeat(64)
  });
  assert.equal(path.win32.basename(first.location.sourcePath), path.win32.basename(second.location.sourcePath));
  assert.notEqual(first.mediaId, second.mediaId);
});

test("legacy fallback identity collisions are disambiguated deterministically", () => {
  const legacy = {
    tracks: [
      legacyTrack("D:\\Music\\Disc A\\same.flac"),
      legacyTrack("D:\\Music\\Disc B\\same.flac", { id: "legacy-path-id-2" })
    ],
    folders: ["D:\\Music"]
  };
  const first = upgradeLibraryDomain(legacy);
  const repeated = upgradeLibraryDomain(legacy);
  assert.equal(first.tracks.length, 2);
  assert.equal(new Set(first.tracks.map(track => track.mediaId)).size, 2);
  assert.deepEqual(
    first.tracks.map(track => track.mediaId),
    repeated.tracks.map(track => track.mediaId)
  );
  assert.doesNotThrow(() => validateLibraryPayloadV2(first));
});

test("domain validation rejects duplicate IDs and broken root, artist or album references", () => {
  const valid = upgradeLibraryDomain({
    tracks: [legacyTrack("D:\\Music\\valid.flac")],
    folders: ["D:\\Music"]
  });
  assert.doesNotThrow(() => validateLibraryPayloadV2(valid));
  const driveRoot = upgradeLibraryDomain({ tracks: [legacyTrack("D:\\Music\\root.flac")], folders: ["D:\\"] });
  assert.doesNotThrow(() => validateLibraryPayloadV2(driveRoot));

  const duplicate = { ...valid, tracks: [valid.tracks[0], { ...valid.tracks[0] }] };
  assert.throws(() => validateLibraryPayloadV2(duplicate), /identities must be unique/);
  const brokenRoot = { ...valid, tracks: [{
    ...valid.tracks[0], location: { ...valid.tracks[0].location, rootId: "0".repeat(64) }
  }] };
  assert.throws(() => validateLibraryPayloadV2(brokenRoot), /location or file identity/);
  const brokenArtist = { ...valid, tracks: [{
    ...valid.tracks[0], tags: { ...valid.tracks[0].tags, artists: [{ artistId: "0".repeat(64), name: "Missing" }] }
  }] };
  assert.throws(() => validateLibraryPayloadV2(brokenArtist), /domain reference/);
  const brokenAlbum = { ...valid, tracks: [{ ...valid.tracks[0], albumId: "0".repeat(64) }] };
  assert.throws(() => validateLibraryPayloadV2(brokenAlbum), /domain reference/);
});

test("Reconciler classifies a matching mediaId at a new path as relocation and preserves identity", () => {
  const fingerprint = "a".repeat(64);
  const previous = toTrackRecord({
    track: legacyTrack("D:\\Music\\old.flac"), folders: ["D:\\Music"], fingerprint
  });
  const moved = toTrackRecord({
    track: legacyTrack("E:\\Music\\new.flac"), folders: ["E:\\Music"], fingerprint
  });
  const result = new LibraryReconciler().reconcile(
    { tracks: [previous], folders: ["D:\\Music"] },
    {
      scanId: "move",
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
      roots: [{ rootId: moved.location.rootId, path: "E:\\Music", status: "complete", scannedFiles: 1, skippedFiles: 0, unreadableDirectories: [] }],
      tracks: [moved],
      failures: []
    },
    ["E:\\Music"]
  );
  assert.deepEqual(result.relocated, [previous.mediaId]);
  assert.equal(result.snapshot.tracks.length, 1);
  assert.equal(result.snapshot.tracks[0].mediaId, previous.mediaId);
  assert.equal(result.snapshot.tracks[0].sourcePath, "E:\\Music\\new.flac");
});

test("Reconciler keeps a migrated identity on the first direct-path content scan", () => {
  const previous = toTrackRecord({
    track: legacyTrack("D:\\Music\\stable.flac"), folders: ["D:\\Music"]
  });
  const scanned = toTrackRecord({
    track: legacyTrack("D:\\Music\\stable.flac"), folders: ["D:\\Music"], fingerprint: "b".repeat(64)
  });
  assert.notEqual(scanned.mediaId, previous.mediaId);
  const result = new LibraryReconciler().reconcile(
    { tracks: [previous], folders: ["D:\\Music"] },
    {
      scanId: "first-content-scan",
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
      roots: [{ rootId: scanned.location.rootId, path: "D:\\Music", status: "complete", scannedFiles: 1, skippedFiles: 0, unreadableDirectories: [] }],
      tracks: [scanned],
      failures: []
    },
    ["D:\\Music"]
  );
  assert.equal(result.snapshot.tracks[0].mediaId, previous.mediaId);
  assert.equal(result.snapshot.tracks[0].file.fingerprint, "b".repeat(64));
});

test("Reconciler relocates by content fingerprint when provisional media identities differ", () => {
  const fingerprint = "c".repeat(64);
  const previous = {
    ...toTrackRecord({
      track: legacyTrack("D:\\Music\\old-place.flac"), folders: ["D:\\Music"], fingerprint
    }),
    id: "preserved-library-id",
    mediaId: "preserved-library-id"
  };
  const scanned = toTrackRecord({
    track: legacyTrack("E:\\Archive\\new-place.flac"), folders: ["E:\\Archive"], fingerprint
  });
  assert.notEqual(scanned.mediaId, previous.mediaId);
  const result = new LibraryReconciler().reconcile(
    { tracks: [previous], folders: ["D:\\Music"] },
    {
      scanId: "fingerprint-move",
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
      roots: [{ rootId: scanned.location.rootId, path: "E:\\Archive", status: "complete", scannedFiles: 1, skippedFiles: 0, unreadableDirectories: [] }],
      tracks: [scanned],
      failures: []
    },
    ["E:\\Archive"]
  );
  assert.deepEqual(result.relocated, [previous.mediaId]);
  assert.equal(result.snapshot.tracks[0].mediaId, previous.mediaId);
  assert.equal(result.snapshot.tracks[0].sourcePath, "E:\\Archive\\new-place.flac");
});

test("an existing schema-v2 legacy payload upgrades idempotently to domainVersion 2", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-domain-migration-"));
  try {
    const storageDirectory = path.join(directory, "library-v2");
    const repository = new JsonLibraryRepository({ storageDirectory });
    await repository.commit({
      schemaVersion: 2,
      tracks: [legacyTrack("D:\\Music\\legacy.flac")],
      folders: ["D:\\Music"]
    }, { requestId: "pre-domain", expectedRevision: 0 });
    const migrator = new LibraryMigrator(repository, { storageDirectory });
    const upgraded = await migrator.ensureMigrated();
    assert.equal(upgraded.snapshot.domainVersion, 2);
    assert.equal(upgraded.snapshot.tracks[0].id, upgraded.snapshot.tracks[0].mediaId);
    assert.equal(upgraded.snapshot.artists.length, 1);
    assert.equal(upgraded.snapshot.albums.length, 1);
    const repeated = await migrator.ensureMigrated();
    assert.equal(repeated.snapshot.revision, upgraded.snapshot.revision);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

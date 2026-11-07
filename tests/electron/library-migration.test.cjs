const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { LibraryMigrator } = require(path.join(root, "dist-electron/library/migration/LibraryMigrator.js"));
const { JsonLibraryRepository } = require(path.join(root, "dist-electron/library/repository/JsonLibraryRepository.js"));
const { LibraryService } = require(path.join(root, "dist-electron/library/LibraryService.js"));
const { revisionChecksum } = require(path.join(root, "dist-electron/library/validation/LibraryValidator.js"));

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-library-migration-"));
  return {
    directory,
    storageDirectory: path.join(directory, "library-v2"),
    legacyPath: path.join(directory, "music-library.json")
  };
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function legacyPayload(label = "legacy") {
  const sourcePath = `K:\\Music\\${label}.flac`;
  return {
    tracks: [{
      id: label.padEnd(40, "0").slice(0, 40),
      name: label,
      artist: "Legacy Artist",
      album: "Legacy Album",
      url: "auralis-media://local/" + encodeURIComponent(sourcePath),
      format: "FLAC",
      size: 123,
      sourcePath,
      nativePath: sourcePath,
      folder: "K:\\Music"
    }],
    folders: ["K:\\Music"]
  };
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createMigrator(paths, options = {}) {
  const repository = new JsonLibraryRepository({
    storageDirectory: paths.storageDirectory,
    legacyPath: paths.legacyPath,
    failpoint: options.repositoryFailpoint
  });
  return {
    repository,
    migrator: new LibraryMigrator(repository, {
      storageDirectory: paths.storageDirectory,
      legacyPath: paths.legacyPath,
      failpoint: options.migrationFailpoint
    })
  };
}

test("v1 legacy file migrates to schemaVersion 2 with sourceHash and an atomic marker", async () => {
  const paths = workspace();
  try {
    const legacy = legacyPayload();
    fs.writeFileSync(paths.legacyPath, JSON.stringify(legacy, null, 2), "utf8");
    const originalHash = hashFile(paths.legacyPath);
    const { repository, migrator } = createMigrator(paths);
    const migrated = await migrator.ensureMigrated();
    assert.equal(migrated.status, "ok");
    assert.equal(migrated.snapshot.schemaVersion, 2);
    assert.equal(migrated.snapshot.tracks.length, 1);
    assert.equal(migrated.snapshot.migration.sourceHash, originalHash);
    assert.equal(hashFile(paths.legacyPath), originalHash, "legacy source must remain byte-for-byte unchanged");

    const markerPath = path.join(paths.storageDirectory, "migrations", "library-v1-to-v2.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    assert.deepEqual(marker, {
      migration: "library-v1-to-v2",
      sourceHash: originalHash,
      targetRevision: 1,
      completed: true
    });
    const repeated = await migrator.ensureMigrated();
    assert.equal(repeated.snapshot.revision, 1);
    assert.deepEqual(await repository.listValidRevisions(), [1]);
    await repository.commit({ schemaVersion: 2, tracks: legacy.tracks, folders: [...legacy.folders, "D:\\More"] }, {
      requestId: "post-migration-change",
      expectedRevision: 1
    });
    await migrator.ensureMigrated();
    assert.equal(JSON.parse(fs.readFileSync(markerPath, "utf8")).targetRevision, 1,
      "later library revisions must not rewrite migration provenance");
  } finally {
    cleanup(paths.directory);
  }
});

test("legacy null optional metadata is accepted and normalized without changing the source", async () => {
  const paths = workspace();
  try {
    const legacy = legacyPayload("null-year");
    legacy.tracks[0].year = null;
    legacy.tracks[0].coverUrl = null;
    fs.writeFileSync(paths.legacyPath, JSON.stringify(legacy), "utf8");
    const originalHash = hashFile(paths.legacyPath);
    const { migrator } = createMigrator(paths);
    const migrated = await migrator.ensureMigrated();
    assert.equal(migrated.status, "ok");
    assert.equal(migrated.snapshot.tracks.length, 1);
    assert.equal(migrated.snapshot.tracks[0].year, undefined);
    assert.equal(migrated.snapshot.tracks[0].coverUrl, undefined);
    assert.equal(migrated.snapshot.tracks[0].tags.year, undefined);
    assert.equal(hashFile(paths.legacyPath), originalHash);
  } finally {
    cleanup(paths.directory);
  }
});

test("legacy fallback identity collisions migrate to unique deterministic identities", async () => {
  const paths = workspace();
  try {
    const legacy = legacyPayload("collision-a");
    legacy.tracks.push({
      ...legacy.tracks[0],
      id: "collision-b",
      sourcePath: "K:\\Music\\Other\\same.flac",
      nativePath: "K:\\Music\\Other\\same.flac",
      url: "auralis-media://local/collision-b"
    });
    fs.writeFileSync(paths.legacyPath, JSON.stringify(legacy), "utf8");
    const originalHash = hashFile(paths.legacyPath);
    const { migrator } = createMigrator(paths);
    const migrated = await migrator.ensureMigrated();
    assert.equal(migrated.status, "ok");
    assert.equal(migrated.snapshot.tracks.length, 2);
    assert.equal(new Set(migrated.snapshot.tracks.map(track => track.mediaId)).size, 2);
    assert.equal(hashFile(paths.legacyPath), originalHash);
  } finally {
    cleanup(paths.directory);
  }
});

test("an existing schema-1 revision remains readable and migrates without being overwritten", async () => {
  const paths = workspace();
  try {
    const payload = legacyPayload("level-one-revision");
    const unsigned = {
      formatVersion: 1,
      revision: 1,
      createdAt: new Date(0).toISOString(),
      requestId: "old-level-one",
      payload
    };
    const stored = { ...unsigned, checksum: revisionChecksum(unsigned) };
    const revisions = path.join(paths.storageDirectory, "revisions");
    fs.mkdirSync(revisions, { recursive: true });
    const oldPath = path.join(revisions, "0000000001.json");
    fs.writeFileSync(oldPath, JSON.stringify(stored), "utf8");
    const oldHash = hashFile(oldPath);

    const { repository, migrator } = createMigrator(paths);
    const migrated = await migrator.ensureMigrated();
    assert.equal(migrated.snapshot.schemaVersion, 2);
    assert.equal(migrated.snapshot.revision, 2);
    assert.equal(hashFile(oldPath), oldHash);
    assert.deepEqual(await repository.listValidRevisions(), [1, 2]);
  } finally {
    cleanup(paths.directory);
  }
});

test("a corrupted migration marker is rebuilt from the committed v2 revision", async () => {
  const paths = workspace();
  try {
    fs.writeFileSync(paths.legacyPath, JSON.stringify(legacyPayload("marker-recovery")), "utf8");
    const first = createMigrator(paths);
    const migrated = await first.migrator.ensureMigrated();
    const markerPath = path.join(paths.storageDirectory, "migrations", "library-v1-to-v2.json");
    fs.writeFileSync(markerPath, "{broken", "utf8");

    const restarted = createMigrator(paths);
    const recovered = await restarted.migrator.ensureMigrated();
    assert.equal(recovered.snapshot.revision, migrated.snapshot.revision);
    assert.equal(recovered.snapshot.tracks.length, 1);
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    assert.equal(marker.completed, true);
    assert.equal(marker.targetRevision, migrated.snapshot.revision);
    assert.deepEqual(await restarted.repository.listValidRevisions(), [migrated.snapshot.revision]);
  } finally {
    cleanup(paths.directory);
  }
});

for (const failpoint of [
  "AFTER_LEGACY_READ",
  "AFTER_TRANSFORM",
  "AFTER_REVISION_COMMIT",
  "BEFORE_MIGRATION_MARKER",
  "AFTER_MIGRATION_MARKER",
  "BEFORE_IPC_ACK"
]) {
  test(`${failpoint} interruption restarts idempotently without data loss or duplicates`, async () => {
    const paths = workspace();
    try {
      const legacy = legacyPayload(failpoint.toLowerCase());
      fs.writeFileSync(paths.legacyPath, JSON.stringify(legacy), "utf8");
      const originalHash = hashFile(paths.legacyPath);
      const interrupted = createMigrator(paths, {
        migrationFailpoint(point) {
          if (point === failpoint) throw new Error("simulated crash");
        }
      });
      await assert.rejects(
        interrupted.migrator.ensureMigrated(),
        error => error.libraryError?.code === "LIBRARY_MIGRATION_FAILED"
      );
      assert.equal(hashFile(paths.legacyPath), originalHash);

      const restarted = createMigrator(paths);
      const recovered = await restarted.migrator.ensureMigrated();
      assert.equal(recovered.snapshot.schemaVersion, 2);
      assert.equal(recovered.snapshot.tracks.length, 1);
      assert.equal(new Set(recovered.snapshot.tracks.map(track => track.id)).size, 1);
      const repeated = await restarted.migrator.ensureMigrated();
      assert.equal(repeated.snapshot.revision, recovered.snapshot.revision);
      assert.equal(hashFile(paths.legacyPath), originalHash);
    } finally {
      cleanup(paths.directory);
    }
  });
}

test("AFTER_TMP_WRITE interruption leaves LastKnownGood intact and retries safely", async () => {
  const paths = workspace();
  try {
    fs.writeFileSync(paths.legacyPath, JSON.stringify(legacyPayload("tmp-write")), "utf8");
    const originalHash = hashFile(paths.legacyPath);
    const interrupted = createMigrator(paths, {
      repositoryFailpoint(point) {
        if (point === "after-temp-sync") throw new Error("simulated crash after temp sync");
      }
    });
    await assert.rejects(
      interrupted.migrator.ensureMigrated(),
      error => error.libraryError?.code === "LIBRARY_MIGRATION_FAILED"
    );
    const lkg = await interrupted.repository.loadLatestValid();
    assert.equal(lkg.snapshot.schemaVersion, 1);
    assert.equal(lkg.snapshot.tracks.length, 1);
    assert.equal(hashFile(paths.legacyPath), originalHash);

    const restarted = createMigrator(paths);
    const recovered = await restarted.migrator.ensureMigrated();
    assert.equal(recovered.snapshot.schemaVersion, 2);
    assert.equal(recovered.snapshot.tracks.length, 1);
    assert.equal(hashFile(paths.legacyPath), originalHash);
  } finally {
    cleanup(paths.directory);
  }
});

test("legacy LocalStorage import merges once, validates read-back, and never duplicates tracks", async () => {
  const paths = workspace();
  try {
    const { repository, migrator } = createMigrator(paths);
    const service = new LibraryService(repository, undefined, undefined, migrator);
    const legacy = legacyPayload("localstorage");
    const first = await service.importLegacyState(legacy, { requestId: "legacy-browser-1" });
    assert.equal(first.status, "imported");
    assert.equal(first.revision, 1);
    const second = await service.importLegacyState(legacy, { requestId: "legacy-browser-2" });
    assert.equal(second.status, "alreadyImported");
    assert.equal(second.revision, 1);
    const loaded = await service.getSnapshot();
    assert.equal(loaded.snapshot.schemaVersion, 2);
    assert.equal(loaded.snapshot.tracks.length, 1);
    assert.deepEqual(await repository.listValidRevisions(), [1]);
  } finally {
    cleanup(paths.directory);
  }
});

test("invalid legacy LocalStorage cannot create an empty revision or marker", async () => {
  const paths = workspace();
  try {
    const { repository, migrator } = createMigrator(paths);
    const service = new LibraryService(repository, undefined, undefined, migrator);
    await assert.rejects(
      service.importLegacyState({ tracks: [{ id: "incomplete" }], folders: [] }, { requestId: "invalid" }),
      error => error.libraryError?.code === "LIBRARY_INVALID_SCHEMA"
    );
    assert.deepEqual(await repository.listValidRevisions(), []);
    assert.equal(fs.existsSync(path.join(paths.storageDirectory, "migrations", "legacy-localstorage-v1-to-v2.json")), false);
  } finally {
    cleanup(paths.directory);
  }
});

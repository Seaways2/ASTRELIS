const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { JsonLibraryRepository } = require(path.join(root, "dist-electron/library/repository/JsonLibraryRepository.js"));
const { LibraryService } = require(path.join(root, "dist-electron/library/LibraryService.js"));

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "auralis-library-repository-"));
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function payload(label) {
  const sourcePath = "K:\\Music\\" + label + ".flac";
  return {
    schemaVersion: 2,
    tracks: [{
      id: label.padEnd(40, "0").slice(0, 40),
      name: label,
      artist: "Test Artist",
      album: "Test Album",
      url: "auralis-media://local/" + encodeURIComponent(sourcePath),
      format: "FLAC",
      size: 100,
      sourcePath,
      nativePath: sourcePath,
      folder: "K:\\Music"
    }],
    folders: ["K:\\Music"]
  };
}

test("repository distinguishes a never-created library from a corrupt legacy library", async () => {
  const directory = tempWorkspace();
  try {
    const legacyPath = path.join(directory, "music-library.json");
    const repository = new JsonLibraryRepository({ storageDirectory: path.join(directory, "library-v2"), legacyPath });
    assert.deepEqual(await repository.loadLatestValid(), { status: "empty" });
    fs.writeFileSync(legacyPath, "{broken", "utf8");
    const corrupt = await repository.loadLatestValid();
    assert.equal(corrupt.status, "error");
    assert.equal(corrupt.error.code, "LIBRARY_SNAPSHOT_CORRUPT");
  } finally {
    cleanup(directory);
  }
});

test("valid legacy state loads as revision zero and remains untouched after the first commit", async () => {
  const directory = tempWorkspace();
  try {
    const legacyPath = path.join(directory, "music-library.json");
    const { schemaVersion: _schemaVersion, ...legacy } = payload("legacy");
    fs.writeFileSync(legacyPath, JSON.stringify(legacy), "utf8");
    const beforeHash = require("node:crypto").createHash("sha256").update(fs.readFileSync(legacyPath)).digest("hex");
    const repository = new JsonLibraryRepository({ storageDirectory: path.join(directory, "library-v2"), legacyPath });
    const loaded = await repository.loadLatestValid();
    assert.equal(loaded.status, "ok");
    assert.equal(loaded.snapshot.revision, 0);
    await repository.commit(payload("first"), { requestId: "legacy-first", expectedRevision: 0 });
    const afterHash = require("node:crypto").createHash("sha256").update(fs.readFileSync(legacyPath)).digest("hex");
    assert.equal(afterHash, beforeHash);
  } finally {
    cleanup(directory);
  }
});

test("serialized writer commits 50 concurrent mutations with monotonic revisions and unique temp names", async () => {
  const directory = tempWorkspace();
  try {
    const repository = new JsonLibraryRepository({ storageDirectory: path.join(directory, "library-v2"), retentionCount: 5 });
    const service = new LibraryService(repository);
    const results = await Promise.all(Array.from({ length: 50 }, (_, index) =>
      service.commitLegacySnapshot(payload("track-" + index), { requestId: "request-" + index })
    ));
    assert.deepEqual(results.map(result => result.revision), Array.from({ length: 50 }, (_, index) => index + 1));
    assert.equal(results.every(result => result.status === "committed"), true);
    assert.deepEqual(await repository.listValidRevisions(), [46, 47, 48, 49, 50]);
    const files = fs.readdirSync(repository.revisionsDirectory);
    assert.equal(files.some(file => file.includes(".tmp.")), false);
    assert.equal(files.some(file => file === "music-library.json.tmp"), false);
  } finally {
    cleanup(directory);
  }
});

test("requestId retry is idempotent and expectedRevision rejects stale overwrites", async () => {
  const directory = tempWorkspace();
  try {
    const repository = new JsonLibraryRepository({ storageDirectory: path.join(directory, "library-v2") });
    const service = new LibraryService(repository);
    const first = await service.commitLegacySnapshot(payload("one"), { requestId: "same-request", expectedRevision: 0 });
    const retry = await service.commitLegacySnapshot(payload("different-payload"), { requestId: "same-request", expectedRevision: 0 });
    assert.deepEqual(retry, first);
    const conflict = await service.commitLegacySnapshot(payload("two"), { requestId: "stale", expectedRevision: 0 });
    assert.equal(conflict.status, "conflict");
    assert.equal(conflict.revision, 1);
    assert.equal(conflict.error.code, "LIBRARY_REVISION_CONFLICT");
    assert.deepEqual(await repository.listValidRevisions(), [1]);
  } finally {
    cleanup(directory);
  }
});

test("a truncated latest revision recovers the previous LastKnownGood revision", async () => {
  const directory = tempWorkspace();
  try {
    const repository = new JsonLibraryRepository({ storageDirectory: path.join(directory, "library-v2") });
    for (let index = 1; index <= 3; index++) {
      await repository.commit(payload("revision-" + index), { requestId: "revision-" + index });
    }
    fs.writeFileSync(path.join(repository.revisionsDirectory, "0000000003.json"), "{\"cut\":", "utf8");
    const recovered = await repository.loadLatestValid();
    assert.equal(recovered.status, "recovered");
    assert.equal(recovered.snapshot.revision, 2);
    assert.equal(recovered.recoveredFromRevision, 2);
    assert.equal(recovered.snapshot.tracks[0].name, "revision-2");
  } finally {
    cleanup(directory);
  }
});

test("orphan temporary files are ignored and cannot replace LastKnownGood", async () => {
  const directory = tempWorkspace();
  try {
    const repository = new JsonLibraryRepository({ storageDirectory: path.join(directory, "library-v2") });
    await repository.commit(payload("stable"), { requestId: "stable" });
    fs.writeFileSync(path.join(repository.revisionsDirectory, "0000000002.json.tmp.orphan"), "{\"partial\":", "utf8");
    const loaded = await repository.loadLatestValid();
    assert.equal(loaded.status, "ok");
    assert.equal(loaded.snapshot.revision, 1);
    assert.equal(loaded.snapshot.tracks[0].name, "stable");
    assert.deepEqual(await repository.listValidRevisions(), [1]);
  } finally {
    cleanup(directory);
  }
});

test("a write failure after temp flush never damages the previous revision", async () => {
  const directory = tempWorkspace();
  try {
    const storageDirectory = path.join(directory, "library-v2");
    const stable = new JsonLibraryRepository({ storageDirectory });
    await stable.commit(payload("stable"), { requestId: "stable" });
    const failing = new JsonLibraryRepository({
      storageDirectory,
      failpoint(point) {
        if (point === "after-temp-sync") throw new Error("simulated disk failure");
      }
    });
    await assert.rejects(
      failing.commit(payload("uncommitted"), { requestId: "write-failure", expectedRevision: 1 }),
      error => error.libraryError && error.libraryError.code === "LIBRARY_WRITE_FAILED"
    );
    const loaded = await stable.loadLatestValid();
    assert.equal(loaded.status, "ok");
    assert.equal(loaded.snapshot.revision, 1);
    assert.equal(loaded.snapshot.tracks[0].name, "stable");
    assert.equal(fs.readdirSync(failing.revisionsDirectory).some(file => file.includes(".tmp.")), true);
  } finally {
    cleanup(directory);
  }
});

for (const [code, label] of [["ENOSPC", "disk full"], ["EACCES", "permission denied"]]) {
  test(`${label} during commit preserves the previous valid revision`, async () => {
    const directory = tempWorkspace();
    try {
      const storageDirectory = path.join(directory, "library-v2");
      const stable = new JsonLibraryRepository({ storageDirectory });
      await stable.commit(payload("stable"), { requestId: "stable" });
      const failing = new JsonLibraryRepository({
        storageDirectory,
        failpoint(point) {
          if (point === "after-temp-sync") throw Object.assign(new Error(label), { code });
        }
      });
      await assert.rejects(
        failing.commit(payload("must-not-replace-lkg"), { requestId: code, expectedRevision: 1 }),
        error => error.libraryError?.code === "LIBRARY_WRITE_FAILED"
      );
      const recovered = await stable.loadLatestValid();
      assert.equal(recovered.snapshot.revision, 1);
      assert.equal(recovered.snapshot.tracks[0].name, "stable");
    } finally {
      cleanup(directory);
    }
  });
}

test("crash after rename before ACK is recovered and retry cannot duplicate the commit", async () => {
  const directory = tempWorkspace();
  try {
    const storageDirectory = path.join(directory, "library-v2");
    const stable = new JsonLibraryRepository({ storageDirectory });
    await stable.commit(payload("stable"), { requestId: "stable" });
    const crashing = new JsonLibraryRepository({
      storageDirectory,
      failpoint(point) {
        if (point === "after-rename") throw new Error("simulated process exit before ACK");
      }
    });
    await assert.rejects(
      crashing.commit(payload("committed-before-crash"), { requestId: "crash-request", expectedRevision: 1 }),
      error => error.libraryError && error.libraryError.code === "LIBRARY_WRITE_FAILED"
    );
    const afterRestart = new JsonLibraryRepository({ storageDirectory });
    const loaded = await afterRestart.loadLatestValid();
    assert.equal(loaded.status, "ok");
    assert.equal(loaded.snapshot.revision, 2);
    assert.equal(loaded.snapshot.tracks[0].name, "committed-before-crash");
    const retry = await afterRestart.commit(payload("retry-payload"), { requestId: "crash-request", expectedRevision: 1 });
    assert.equal(retry.status, "committed");
    assert.equal(retry.revision, 2);
    assert.deepEqual(await afterRestart.listValidRevisions(), [1, 2]);
  } finally {
    cleanup(directory);
  }
});

test("checksum corruption cannot become authoritative", async () => {
  const directory = tempWorkspace();
  try {
    const repository = new JsonLibraryRepository({ storageDirectory: path.join(directory, "library-v2") });
    await repository.commit(payload("good"), { requestId: "good" });
    await repository.commit(payload("tampered"), { requestId: "tampered" });
    const latestPath = path.join(repository.revisionsDirectory, "0000000002.json");
    const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    latest.payload.tracks[0].name = "checksum-bypass";
    fs.writeFileSync(latestPath, JSON.stringify(latest), "utf8");
    const recovered = await repository.loadLatestValid();
    assert.equal(recovered.status, "recovered");
    assert.equal(recovered.snapshot.revision, 1);
    assert.equal(recovered.snapshot.tracks[0].name, "good");
  } finally {
    cleanup(directory);
  }
});


test("validated revision cache cannot be mutated through returned snapshots", async () => {
  const directory = tempWorkspace();
  try {
    const repo = new JsonLibraryRepository({storageDirectory: directory});
    await repo.commit(payload("original"), {requestId:"cache-original"});
    const first = await repo.loadLatestValid();
    const original = JSON.stringify(first.snapshot);
    first.snapshot.tracks.length = 0;
    assert.equal(JSON.stringify((await repo.loadLatestValid()).snapshot), original);
    const file = path.join(directory,"revisions","0000000001.json");
    fs.writeFileSync(file,"corrupt");
    assert.equal((await repo.loadLatestValid()).status,"error", "changed files must invalidate cached validation");
  } finally {cleanup(directory);}
});

test("repeated commits reuse validation of unchanged history", async () => {
  const directory=tempWorkspace();
  const originalRead=fs.promises.readFile;
  try {
    const repo=new JsonLibraryRepository({storageDirectory:directory});
    for(let i=0;i<5;i++) await repo.commit(payload("entry-"+i),{requestId:"warm-"+i});
    let historyReads=0;
    fs.promises.readFile=async function(file,...args){
      if(String(file).startsWith(directory) && /000000000[1-4]\.json$/.test(String(file))) historyReads++;
      return originalRead.call(this,file,...args);
    };
    await repo.commit(payload("next"),{requestId:"next"});
    assert.equal(historyReads,0,"idempotency and retention must not parse warm historical payloads");
    assert.equal((await repo.commit(payload("different"),{requestId:"warm-4"})).revision,5);
  } finally {fs.promises.readFile=originalRead;cleanup(directory);}
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { LibraryDerivedIndexCache } = require(path.join(root, "dist-electron/library/derived/LibraryDerivedIndexCache.js"));

function snapshot(revision = 7) {
  return {
    schemaVersion: 1,
    normalizationVersion: 1,
    libraryRevision: revision,
    trackSignature: "1:100:abc",
    searchTextEntries: [["media-1", "song artist album"]],
    artists: [{ key: "artist-1", name: "Artist", ids: ["media-1"], artists: ["Artist"], albums: ["Album"], formats: ["FLAC"], covers: [], searchText: "artist" }],
    albums: [{ key: "album-1", name: "Album", ids: ["media-1"], artists: ["Artist"], albums: ["Album"], formats: ["FLAC"], covers: [], searchText: "album artist" }],
    folders: [{ path: "D:\\Music", directIds: ["media-1"], descendantIds: ["media-1"], formats: ["FLAC"], covers: [] }],
    stats: { totalBytes: 100, hiRes: 1, artistCount: 1, albumCount: 1 }
  };
}

test("derived index cache is revision-bound and round-trips independently of the repository", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "auralis-derived-index-"));
  try {
    const cache = new LibraryDerivedIndexCache(directory);
    assert.deepEqual(await cache.save(7, snapshot(7)), { ok: true });
    assert.deepEqual(await cache.load(7), snapshot(7));
    assert.equal(await cache.load(8), null);
    assert.equal(fs.existsSync(cache.cachePath), false, "a revision-mismatched derived cache is disposable");
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("corrupt or renderer-forged derived caches fail closed without blocking library data", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "auralis-derived-index-corrupt-"));
  try {
    const cache = new LibraryDerivedIndexCache(directory);
    assert.deepEqual(await cache.save(7, { ...snapshot(7), artists: "forged" }), { ok: false });
    await fs.promises.mkdir(cache.cacheDirectory, { recursive: true });
    await fs.promises.writeFile(cache.cachePath, "{broken", "utf8");
    assert.equal(await cache.load(7), null);
    assert.equal(fs.existsSync(cache.cachePath), false);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

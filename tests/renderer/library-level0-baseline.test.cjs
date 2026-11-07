const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const fixtureRoot = path.join(root, "tests/fixtures/library");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const readFixture = relative => fs.readFileSync(path.join(fixtureRoot, relative), "utf8");
const parseFixture = relative => JSON.parse(readFixture(relative));
const { SCALE_PROFILES, makeLegacyLibrary } = require(path.join(fixtureRoot, "fixtureFactory.cjs"));

function loadTypeScriptModule(relative) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const loaded = { exports: {} };
  Function("exports", "module", output)(loaded.exports, loaded);
  return loaded.exports;
}

test("Level 0 fixture catalog covers every required legacy and failure scenario", () => {
  const required = [
    "empty/music-library.json",
    "normal-v1/manifest.json",
    "damaged-json/music-library.json",
    "truncated-json/music-library.json",
    "duplicate-albums/library.json",
    "missing-metadata/library.json",
    "moved-files/before.json",
    "moved-files/after.json",
    "partial-root/previous.json",
    "partial-root/scan-observation.json",
    "legacy-localstorage/localstorage.json"
  ];
  for (const relative of required) {
    assert.equal(fs.existsSync(path.join(fixtureRoot, relative)), true, relative + " must exist");
  }
  assert.deepEqual(parseFixture("empty/music-library.json"), { tracks: [], folders: [] });
  assert.throws(() => JSON.parse(readFixture("damaged-json/music-library.json")));
  assert.throws(() => JSON.parse(readFixture("truncated-json/music-library.json")));
});

test("deterministic fixtures provide normal, real-library and stress scales", () => {
  assert.deepEqual(SCALE_PROFILES, { normal: 128, realistic: 15388, stress: 100000 });
  for (const count of Object.values(SCALE_PROFILES)) {
    const fixture = makeLegacyLibrary(count);
    assert.equal(fixture.tracks.length, count);
    assert.deepEqual(fixture.folders, ["K:\\Music"]);
    assert.equal(new Set(fixture.tracks.map(track => track.id)).size, count);
    assert.equal(new Set(fixture.tracks.map(track => track.sourcePath.toLowerCase())).size, count);
  }
});

test("Auralis 2.3.16 legacy Track and folder schemas are frozen", () => {
  const track = makeLegacyLibrary(1).tracks[0];
  assert.deepEqual(Object.keys(track).sort(), [
    "album", "artist", "duration", "folder", "format", "genre", "id", "name",
    "nativePath", "size", "sourcePath", "url", "year"
  ]);
  const audioTypes = read("src/types/audio.ts");
  for (const field of [
    "id: string", "name: string", "artist: string", "album: string", "url: string",
    "format: string", "size: number", "coverUrl?: string", "nativePath?: string",
    "sourcePath?: string", "duration?: number", "year?: number", "genre?: string",
    "folder?: string"
  ]) {
    assert.match(audioTypes, new RegExp(field.replace(/[?]/g, "\\?")));
  }
  const legacy = makeLegacyLibrary(128);
  assert.equal(Array.isArray(legacy.tracks), true);
  assert.equal(legacy.folders.every(folder => typeof folder === "string"), true);
  assert.equal("schemaVersion" in legacy, false);
  assert.equal("revision" in legacy, false);
});

test("Level 0 records the legacy storage risk while Level 1 removes it from runtime", () => {
  const main = read("electron/main.ts");
  const preload = read("electron/preload.ts");
  const store = read("src/stores/playerStore.ts");
  assert.match(main, /new JsonLibraryRepository/);
  assert.match(main, /libraryService\.getSnapshot\(\)/);
  assert.doesNotMatch(main, /catch \{ return \{ tracks: \[\], folders: \[\] \}; \}/);
  assert.match(preload, /meta: \{ requestId: string; expectedRevision\?: number \}/);
  assert.match(store, /await window\.desktop\.library\.chooseFolder\(libraryCommandMeta\(state\.libraryRevision\)\)/);
  assert.match(store, /await window\.desktop\.library\.rescan\(folders, meta\)/);
  assert.match(store, /const meta = libraryCommandMeta\(get\(\)\.libraryRevision\)/);
  assert.doesNotMatch(store, /void window\.desktop\?\.library\.save/);
});

test("legacy favorites remain stable while Level 3 imports LocalStorage without deleting it", () => {
  const store = read("src/stores/playerStore.ts");
  const legacy = parseFixture("legacy-localstorage/localstorage.json");
  assert.equal(JSON.parse(legacy["auralis.library.favorites.v1"])[0], "path:k:\\music\\favorite.flac");
  assert.match(store, /const FAVORITES_STORAGE_KEY = "auralis\.library\.favorites\.v1"/);
  assert.match(store, /return [^;]+path:[\s\S]{0,160}localPath\.trim\(\)/);
  assert.doesNotMatch(store, /localStorage\.removeItem\("auralis\.library\.tracks"\)/);
  assert.doesNotMatch(store, /localStorage\.removeItem\("auralis\.library\.folders"\)/);
  assert.match(store, /window\.desktop\.library\.importLegacyState/);
  assert.match(store, /LEGACY_LIBRARY_IMPORTED_KEY/);
});

test("Level 0 scanner risks remain documented while Level 2 isolates them", () => {
  const scanner = read("electron/library/scanner/LibraryScanner.ts");
  assert.match(scanner, /directoryConcurrency = Math\.max\(1/);
  assert.match(scanner, /pending\.splice\(0, this\.directoryConcurrency\)/);
  assert.match(scanner, /failures\.push\(failure\("stat", sourcePath, error\)\)/);
  assert.match(scanner, /let artist = "未知艺术家"/);
  assert.match(scanner, /createHash\("sha1"\)\.update\(sourcePath\.toLowerCase\(\)\)/);
  assert.match(scanner, /roots: rootResults/);
  const missing = parseFixture("missing-metadata/library.json").tracks[0];
  assert.deepEqual([missing.artist, missing.album, missing.genre], ["未知艺术家", "未分类专辑", "未分类"]);
});

test("legacy complete-scan merge treats the scan as the full surviving library", () => {
  const { mergeScannedLibrary } = loadTypeScriptModule("src/utils/libraryCoverMerge.ts");
  const previous = makeLegacyLibrary(3).tracks;
  const scanned = [{ ...previous[1], name: "Updated" }];
  const merged = mergeScannedLibrary(scanned, previous);
  assert.deepEqual(merged.map(track => track.id), [previous[1].id]);
  assert.equal(merged[0].name, "Updated");
});

test("Level 5 replaces the frozen legacy queue order bug with explicit requested order", () => {
  const store = read("src/stores/playerStore.ts");
  assert.doesNotMatch(store, /const requested = new Set\(ids\)/);
  assert.match(store, /ids\.map\(id => byId\.get\(id\)\)/);
  const libraryOrder = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const requested = new Set(["c", "a"]);
  const currentResult = libraryOrder.filter(track => requested.has(track.id));
  assert.deepEqual(currentResult.map(track => track.id), ["a", "c"]);
});

test("Level 5 delegates frozen legacy category scopes to the indexed query service", () => {
  const library = read("src/components/MusicLibrary.tsx");
  const query = read("src/library/LibraryQueryService.ts");
  assert.match(library, /const facets: Facet\[\] = \["文件夹", "收藏", "艺术家", "专辑"\]/);
  assert.match(library, /useLibraryViewModel\(/);
  assert.match(query, /const artists = track\.tags\?\.artists\.length[\s\S]*track\.tags\.artists\.map/);
  assert.match(query, /const albumKey = albumIdOf\(track\)/);
  assert.doesNotMatch(library, /"流派"|"格式"/);
  assert.match(query, /group\.ids\.push\(mediaId\)/);
  assert.match(query, /readonly byArtistId/);
  assert.match(query, /readonly byAlbumId/);
});

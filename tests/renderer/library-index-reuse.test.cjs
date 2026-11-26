const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");

function loadQueryModule() {
  const source = fs.readFileSync(path.join(root, "src/library/LibraryQueryService.ts"), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const module = { exports: {} };
  Function("require", "module", "exports", javascript)(require, module, module.exports);
  return module.exports;
}

const { LibraryIndex, reusableLibraryIndex, reusableHiddenFolderIndex } = loadQueryModule();

function track(index, folder = index % 2 ? "D:\\Music\\Public" : "D:\\Music\\Private") {
  const mediaId = String(index).padStart(64, "0");
  return {
    id: mediaId, mediaId, albumId: `album-${index % 5}`,
    name: `Track ${index}`, artist: `Artist  ${index % 7}`, album: `Album ${index % 5}`,
    genre: "Rock", format: "FLAC", size: 1000 + index,
    url: `auralis-media://local/${index}`,
    sourcePath: `${folder}\\${index}.flac`, folder,
    location: { rootId: "root-d", sourcePath: `${folder}\\${index}.flac`, canonicalPath: `${folder}\\${index}.flac` },
    tags: { title: `Track ${index}`, artists: [{ artistId: `artist-${index % 7}`, name: `Artist ${index % 7}` }], album: `Album ${index % 5}`, genres: ["Rock"] }
  };
}

test("re-opening the library reuses the index for the same track array", () => {
  const tracks = Array.from({ length: 50 }, (_, index) => track(index));
  const first = reusableLibraryIndex(tracks, null, 3);
  assert.equal(reusableLibraryIndex(tracks, null, 3), first);
  // A new snapshot, revision or derived cache must rebuild.
  assert.notEqual(reusableLibraryIndex([...tracks], null, 3), first);
  assert.notEqual(reusableLibraryIndex(tracks, null, 4), reusableLibraryIndex(tracks, null, 3));
  const snapshot = new LibraryIndex(tracks, null, 5).exportSnapshot();
  const cached = reusableLibraryIndex(tracks, snapshot, 5);
  assert.equal(cached.usedDerivedCache, true);
  assert.equal(reusableLibraryIndex(tracks, snapshot, 5), cached);
});

test("the hidden-folder index matches a fresh build and is reused per folder set", () => {
  const tracks = Array.from({ length: 40 }, (_, index) => track(index));
  const canonical = reusableLibraryIndex(tracks, null, 1);
  const hidden = ["D:\\Music\\Private"];
  const isHidden = item => item.sourcePath.startsWith(hidden[0]);
  const reused = reusableHiddenFolderIndex(canonical, hidden, isHidden);
  const fresh = new LibraryIndex(tracks.filter(item => !isHidden(item)), null, 1);
  assert.deepEqual(reused.orderedMediaIds, fresh.orderedMediaIds);
  assert.equal(reused.orderedMediaIds.length, 20);
  assert.equal(reusableHiddenFolderIndex(canonical, [...hidden], isHidden), reused, "same folder set reuses");
  assert.notEqual(reusableHiddenFolderIndex(canonical, ["D:\\Music\\Public"], item => item.sourcePath.startsWith("D:\\Music\\Public")), reused);
});

test("favorites under hidden folders are not counted while locked", () => {
  const tracks = Array.from({ length: 6 }, (_, index) => track(index));
  const canonical = reusableLibraryIndex(tracks, null, 1);
  const hidden = ["D:\\Music\\Private"];
  const index = reusableHiddenFolderIndex(canonical, hidden, item => item.sourcePath.startsWith(hidden[0]));
  const favorites = tracks.map(item => item.mediaId);
  // Before, the hidden favourites stayed in the ids: the count and the grid
  // were sized for six while only three cards came back.
  const ids = index.queryIds({ favoriteMediaIds: favorites, sort: "title", sortAscending: true }, "en");
  assert.deepEqual(ids, ["1", "3", "5"].map(id => id.padStart(64, "0")));
  assert.equal(index.queryPage({ favoriteMediaIds: favorites }, "en", 0, 10).total, 3);
  // All favourites hidden: an empty list, so the "no favourites" state shows.
  assert.deepEqual(index.queryIds({ favoriteMediaIds: [favorites[0], favorites[2]] }, "en"), []);
  // Unlocked, the canonical index still lists all of them.
  assert.equal(canonical.queryIds({ favoriteMediaIds: favorites }, "en").length, 6);
});

test("the library header counts only the folders it shows", () => {
  const library = fs.readFileSync(path.join(root, "src/components/MusicLibrary.tsx"), "utf8");
  assert.match(library, /const visibleLibraryFolders = useMemo\(\(\) => state\.libraryFolders\.filter\(folder => !hiddenByFolders\(folder, hiddenFolders\)\), \[state\.libraryFolders, hiddenFolders\]\);/);
  // Gated on the real roots: every root hidden reads "0 · 文件夹", not the empty-library hint.
  assert.equal((library.match(/\{state\.libraryFolders\.length \? `\$\{visibleLibraryFolders\.length\} · \$\{t\("library\.folder"\)\}` : t\("library\.scanHint"\)\}/g) || []).length, 2, "both header variants");
  // Hidden favourites drop out of the selection when the library locks.
  assert.match(library, /favoriteKeySet\.has\(favoriteTrackKey\(track\)\) && !hiddenByFolders\(track\.sourcePath, hiddenFolders\)\)[\s\S]{0,60}\[state\.libraryTracks, favoriteKeySet, hiddenFolders\]/);
  assert.doesNotMatch(library, /\$\{state\.libraryFolders\.length\} ·/);
  assert.match(library, /\{visibleLibraryFolders\.map\(folder => <div className="library-managed-folder"/);
});

test("cached normalization keeps search semantics", () => {
  const tracks = [track(1), track(2)];
  const index = new LibraryIndex(tracks, null, 1);
  // "Artist  1" (double space) must still match the normalized single-space query.
  const page = index.queryPage({ search: "artist 1" }, "en", 0, 10);
  assert.deepEqual(page.items.map(item => item.name), ["Track 1"]);
});

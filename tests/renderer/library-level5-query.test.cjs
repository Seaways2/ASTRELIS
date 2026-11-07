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

const { LibraryIndex } = loadQueryModule();

function track(index, artistIndex = index % 100) {
  const mediaId = String(index).padStart(64, "0");
  const artistId = `artist-${artistIndex}`;
  return {
    id: mediaId,
    mediaId,
    albumId: `album-${artistIndex}-${index % 20}`,
    name: `Track ${String(index).padStart(6, "0")}`,
    artist: `Artist ${artistIndex}`,
    album: `Album ${index % 20}`,
    genre: index % 2 ? "Rock" : "Jazz",
    format: index % 3 ? "FLAC" : "MP3",
    size: 1000 + index,
    url: `auralis-media://local/${index}`,
    sourcePath: `D:\\Music\\Artist ${artistIndex}\\${index}.flac`,
    folder: `D:\\Music\\Artist ${artistIndex}`,
    location: { rootId: "root-d", sourcePath: `D:\\Music\\${index}.flac`, canonicalPath: `D:\\Music\\${index}.flac` },
    tags: { title: `Track ${index}`, artists: [{ artistId, name: `Artist ${artistIndex}` }], album: `Album ${index % 20}`, genres: [index % 2 ? "Rock" : "Jazz"] }
  };
}

test("LibraryIndex uses explicit QueryScope indexes and preserves requested queue order", () => {
  const tracks = [track(1), track(2), track(3)];
  const index = new LibraryIndex(tracks);
  assert.deepEqual(index.orderedTracks([tracks[2].mediaId, tracks[0].mediaId]).map(item => item.mediaId), [
    tracks[2].mediaId, tracks[0].mediaId
  ]);
  const scoped = index.query({ artistIds: [tracks[1].tags.artists[0].artistId] });
  assert.deepEqual(scoped.map(item => item.mediaId), [tracks[1].mediaId]);
  assert.deepEqual(index.query({ favoriteMediaIds: [] }), []);
});

test("SelectionSnapshot freezes click-time order and scope arrays from later UI mutation", () => {
  const tracks = [track(1), track(2), track(3)];
  const index = new LibraryIndex(tracks);
  const ids = [tracks[2].mediaId, tracks[0].mediaId];
  const scope = { artistIds: [tracks[0].tags.artists[0].artistId], sort: "title" };
  const snapshot = index.selectionSnapshot(17, ids, scope);
  ids.reverse();
  scope.artistIds.push("changed-after-click");
  assert.deepEqual(snapshot.orderedMediaIds, [tracks[2].mediaId, tracks[0].mediaId]);
  assert.deepEqual(snapshot.scope.artistIds, [tracks[0].tags.artists[0].artistId]);
  assert.equal(snapshot.libraryRevision, 17);
});

test("album category grouping uses albumId instead of merging identical titles", () => {
  const first = track(1, 1);
  const second = { ...track(2, 2), album: first.album, tags: { ...track(2, 2).tags, album: first.album } };
  const groups = new LibraryIndex([first, second]).categoryGroups("专辑", "", { sort: "title" }, "en-US");
  assert.equal(groups.length, 2);
  assert.equal(new Set(groups.map(group => group.key)).size, 2);
});

test("album search matches album artists while artist search stays category-only", () => {
  const jayOne = {
    ...track(1, 1),
    albumId: "jay-album-one",
    artist: "周杰伦",
    album: "范特西",
    tags: { ...track(1, 1).tags, artists: [{ artistId: "jay", name: "周杰伦" }], album: "范特西", albumArtist: "周杰伦" }
  };
  const jayTwo = {
    ...track(2, 1),
    albumId: "jay-album-two",
    artist: "周杰伦",
    album: "叶惠美",
    tags: { ...track(2, 1).tags, artists: [{ artistId: "jay", name: "周杰伦" }], album: "叶惠美", albumArtist: "周杰伦" }
  };
  const unrelated = {
    ...track(3, 2),
    albumId: "other-album",
    name: "写给周杰伦的歌",
    artist: "其他歌手",
    album: "其他专辑",
    tags: { ...track(3, 2).tags, title: "写给周杰伦的歌", artists: [{ artistId: "other", name: "其他歌手" }], album: "其他专辑" }
  };
  const index = new LibraryIndex([jayOne, jayTwo, unrelated]);
  assert.deepEqual(
    index.categoryGroups("专辑", "周杰伦", {}, "zh-CN").map(group => group.name).sort(),
    ["叶惠美", "范特西"].sort()
  );
  assert.deepEqual(
    index.categoryGroups("艺术家", "周杰伦", {}, "zh-CN").map(group => group.name),
    ["周杰伦"]
  );
});

test("derived index snapshots preserve query, category and folder results", () => {
  const tracks = [track(1, 1), track(2, 1), track(3, 2)];
  const original = new LibraryIndex(tracks, null, 23);
  const snapshot = original.exportSnapshot();
  const restored = new LibraryIndex(tracks, snapshot, 23);
  assert.deepEqual(
    restored.query({ search: "artist 1", sort: "album" }, "en-US").map(item => item.mediaId),
    original.query({ search: "artist 1", sort: "album" }, "en-US").map(item => item.mediaId)
  );
  assert.deepEqual(
    restored.categoryGroups("艺术家", "artist 1", {}, "en-US").map(group => [group.key, group.count]),
    original.categoryGroups("艺术家", "artist 1", {}, "en-US").map(group => [group.key, group.count])
  );
  assert.deepEqual(
    restored.folderNodes(["D:\\Music"], "D:\\Music").map(node => [node.path, node.count]),
    original.folderNodes(["D:\\Music"], "D:\\Music").map(node => [node.path, node.count])
  );
});

test("query and category pages expose stable totals before view creation", () => {
  const tracks = Array.from({ length: 250 }, (_, index) => track(index, index % 25));
  const index = new LibraryIndex(tracks, null, 9);
  const queryPage = index.queryPage({ search: "track" }, "en-US", 100, 40);
  assert.equal(queryPage.total, 250);
  assert.equal(queryPage.items.length, 40);
  assert.equal(queryPage.offset, 100);
  assert.equal(queryPage.hasMore, true);
  const categoryPage = index.categoryPage("艺术家", "", {}, "en-US", 5, 7);
  assert.equal(categoryPage.total, 25);
  assert.equal(categoryPage.items.length, 7);
});

for (const size of [15000, 50000, 100000]) {
  test(`${size.toLocaleString()} track index and query performance stays bounded`, () => {
    const tracks = Array.from({ length: size }, (_, index) => track(index));
    const started = performance.now();
    const index = new LibraryIndex(tracks);
    const indexedMs = performance.now() - started;
    const queryStarted = performance.now();
    const result = index.query({ artistIds: ["artist-43"], genres: ["rock"], sort: "album" }, "en-US");
    const queryMs = performance.now() - queryStarted;
    assert.ok(result.length > 0);
    assert.ok(indexedMs < 8000, `index took ${indexedMs.toFixed(1)}ms`);
    assert.ok(queryMs < 1500, `query took ${queryMs.toFixed(1)}ms`);
  });
}

test("MusicLibrary delegates query, grouping and selection semantics to its view model", () => {
  const component = fs.readFileSync(path.join(root, "src/components/MusicLibrary.tsx"), "utf8");
  const virtualHook = fs.readFileSync(path.join(root, "src/hooks/useVirtualLibraryGrid.ts"), "utf8");
  const store = fs.readFileSync(path.join(root, "src/stores/playerStore.ts"), "utf8");
  assert.match(component, /useLibraryViewModel\(/);
  assert.match(component, /useDeferredValue\(query\)/,
    "large-library search must not block urgent input rendering");
  assert.match(component, /viewModel\.selectionSnapshot\(ids\)/);
  assert.match(component, /viewModel\.categoryPage\(pageOffset, pageRemaining\)/);
  assert.match(component, /viewModel\.trackPage\(pageOffset, pageRemaining\)/);
  assert.match(component, /useVirtualLibraryGrid\(totalListItems/);
  assert.match(virtualHook, /startRow[\s\S]*endRow[\s\S]*overscan/);
  assert.doesNotMatch(component, /IntersectionObserver|visibleCount|LIBRARY_PAGE_SIZE/);
  assert.doesNotMatch(component, /state\.libraryTracks\.map\(\(track, index\)/);
  assert.doesNotMatch(store, /const requested = new Set\(ids\)/);
  assert.match(store, /ids\.map\(id => byId\.get\(id\)\)/);
});

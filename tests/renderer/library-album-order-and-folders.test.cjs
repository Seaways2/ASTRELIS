// Album order and folder bounds in the media centre (full test report LL04,
// LA09, LL02).
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
const { LibraryIndex, LIBRARY_SORTS, libraryFolderWithin } = loadQueryModule();

function track(id, { album = "夜航星", disc, number, size = 100, name = `Track ${id}`, folder = "D:\\星律\\Library\\夜航星" } = {}) {
  return {
    id, mediaId: id, albumId: `album:${album}`, name, artist: "Artist", album, format: "FLAC", size,
    url: "media:" + id, sourcePath: `${folder}\\${id}.flac`, folder,
    tags: { title: name, artists: [{ artistId: "artist", name: "Artist" }], album, genres: [], discNumber: disc, trackNumber: number }
  };
}

test("track sort lists albums in disc and track order, unnumbered tracks last", () => {
  assert.equal(LIBRARY_SORTS[0], "track");
  const album = "Night Flight";
  const tracks = [
    track("d2t1", { album, disc: 2, number: 1, size: 900 }),
    track("d1t2", { album, disc: 1, number: 2, size: 800 }),
    track("none", { album, size: 999, name: "A first by title" }),
    track("d1t1", { album, disc: 1, number: 1, size: 100 }),
    track("t3", { album, number: 3, size: 500 }),
    track("other", { album: "Another", number: 1 })
  ];
  const index = new LibraryIndex(tracks);
  assert.deepEqual(index.queryIds({ sort: "track", sortAscending: true }, "en-US"), ["other", "d1t1", "d1t2", "d2t1", "t3", "none"]);
});

test("adding a whole album uses disc and track order whatever the list is sorted by", () => {
  const tracks = [6, 5, 4, 3, 2, 1].map(number => track(`t${number}`, { disc: 1, number, size: number * 1000 }));
  const index = new LibraryIndex(tracks);
  for (const scope of [{ sort: "size", sortAscending: false }, { sort: "title", sortAscending: false }, {}]) {
    const [album] = index.categoryGroups("专辑", "", scope, "zh-CN");
    assert.deepEqual(album.ids, ["t1", "t2", "t3", "t4", "t5", "t6"], JSON.stringify(scope));
  }
  // The visible list still follows the chosen sort.
  assert.deepEqual(index.queryIds({ albumIds: ["album:夜航星"], sort: "size", sortAscending: false }, "zh-CN"), ["t6", "t5", "t4", "t3", "t2", "t1"]);
});

test("folder browsing never lists folders above the library roots", () => {
  const index = new LibraryIndex([track("a", { folder: "D:\\星律\\Library\\Album" })]);
  const roots = ["D:\\星律\\Library"];
  assert.deepEqual(index.folderNodes(roots, "").map(node => node.path), ["D:\\星律\\Library"]);
  assert.deepEqual(index.folderNodes(roots, "D:\\星律\\Library").map(node => node.path), ["D:\\星律\\Library\\Album"]);
  assert.deepEqual(index.folderNodes(roots, "D:\\星律"), [], "above the root");
  assert.deepEqual(index.folderNodes(roots, "D:\\"), [], "the drive above the root");
  assert.equal(libraryFolderWithin("D:\\星律\\Library\\Album", "d:\\星律\\library\\"), true);
  assert.equal(libraryFolderWithin("D:\\星律", "D:\\星律\\Library"), false);
  assert.equal(libraryFolderWithin("D:\\星律\\Library2", "D:\\星律\\Library"), false);
  assert.equal(libraryFolderWithin("E:\\Music", "E:\\"), true, "a whole drive is a root too");
  const drive = new LibraryIndex([track("b", { folder: "E:\\Music" })]);
  assert.deepEqual(drive.folderNodes(["E:\\"], "E:\\").map(node => node.path), ["E:\\Music"]);
});

test("a whole-drive root shows in the overview however its separator is spelled", () => {
  // The renderer stored "E:\" as "E:" (separator trimmed); the index keys the
  // drive node as "e:\", so the overview listed nothing for that drive.
  const drive = new LibraryIndex([track("b", { folder: "E:\\Music" }), track("c", { folder: "D:\\Music" })]);
  for (const roots of [["E:\\"], ["E:"], ["e:/"]])
    assert.deepEqual(drive.folderNodes(roots, "").map(node => node.path), ["E:\\"], JSON.stringify(roots));
  assert.deepEqual(drive.folderNodes(["E:"], "E:\\").map(node => node.path), ["E:\\Music"]);
  assert.deepEqual(drive.folderNodes(["E:", "E:\\", "D:\\Music\\"], "").map(node => node.path), ["D:\\Music", "E:\\"], "no duplicate, trailing separator ignored");
});

test("files directly on a whole-drive root are listed and counted under that drive", () => {
  const tracks = [track("a", { folder: "E:\\" }), track("b", { folder: "E:\\Music" }), track("c", { folder: "F:" })];
  const index = new LibraryIndex(tracks);
  const [drive] = index.folderNodes(["E:\\"], "");
  assert.equal(drive.path, "E:\\");
  assert.equal(drive.count, 2, "the file on the drive root counts too");
  assert.deepEqual(drive.directIds, ["a"]);
  assert.deepEqual(index.folderNodes(["E:\\"], "E:\\").map(node => node.path), ["E:\\Music"]);
  for (const folder of ["E:\\", "E:", "e:/"]) assert.deepEqual(index.queryIds({ folders: [folder] }), ["a"], folder);
  assert.deepEqual(index.queryIds({ folders: ["E:\\Music\\"] }), ["b"]);
  // A drive holding only files directly on it still shows up.
  assert.deepEqual(index.folderNodes(["F:\\"], "").map(node => [node.path, node.count]), [["F:\\", 1]]);
  // The derived cache round-trips; one from before (a bare "E:" node) is rebuilt.
  const snapshot = index.exportSnapshot();
  assert.equal(new LibraryIndex(tracks, snapshot).usedDerivedCache, true);
  const legacy = { ...snapshot, folders: [...snapshot.folders, { path: "E:", directIds: ["a"], descendantIds: ["a"], formats: ["FLAC"], covers: [] }] };
  const rebuilt = new LibraryIndex(tracks, legacy);
  assert.equal(rebuilt.usedDerivedCache, false);
  assert.equal(rebuilt.folderNodes(["E:\\"], "")[0].count, 2);
});

test("albums with the same title stay together in album order", () => {
  const album = (id, artist, number) => ({
    ...track(id, { album: "Greatest Hits", number }),
    albumId: `album:${artist}:greatest-hits`, artist,
    tags: { title: `Track ${id}`, artists: [{ artistId: artist, name: artist }], album: "Greatest Hits", albumArtist: artist, genres: [], trackNumber: number }
  });
  const legacy = (id, artist, number) => {
    const value = album(id, artist, number);
    delete value.albumId;
    value.tags = { ...value.tags, albumArtist: undefined };
    return value;
  };
  const index = new LibraryIndex([album("y1", "Y", 1), album("x2", "X", 2), album("y2", "Y", 2), album("x1", "X", 1)]);
  assert.deepEqual(index.queryIds({ sort: "track", sortAscending: true }, "en-US"), ["x1", "x2", "y1", "y2"]);
  // Without an album artist the album identity still keeps them apart.
  const untagged = new LibraryIndex([legacy("q1", "Q", 1), legacy("p2", "P", 2), legacy("q2", "Q", 2), legacy("p1", "P", 1)]);
  const order = untagged.queryIds({ sort: "track", sortAscending: true }, "en-US");
  assert.ok(["p1,p2,q1,q2", "q1,q2,p1,p2"].includes(order.join(",")), order.join(","));
});

test("choosing a sort stores the direction shown, so a restart keeps it", () => {
  const library = fs.readFileSync(path.join(root, "src/components/MusicLibrary.tsx"), "utf8");
  const start = library.indexOf("const setLibrarySort = (sort: LibrarySort) => {");
  const body = library.slice(library.indexOf("{", start) + 1, library.indexOf("\n  };", start));
  const initializerStart = library.indexOf("const [sortAscending, setSortAscending] = useState(");
  const initializer = library.slice(initializerStart, library.indexOf("\n  });", initializerStart)).replace(/^[^]*?useState\(\(\) => \{/, "");
  const memory = values => ({
    values,
    getItem: key => key in values ? values[key] : null,
    setItem: (key, value) => { values[key] = String(value); }
  });
  const readDirection = Function("localStorage", initializer);
  const choose = Function("localStorage", "setLibrarySortState", "sortAscending", "sort", body);
  // New user: ascending, picks "title" without touching the direction.
  const fresh = memory({});
  const shown = readDirection(fresh);
  assert.equal(shown, true);
  choose(fresh, () => {}, shown, "title");
  assert.deepEqual(fresh.values, { "auralis.library.sortAscending": "true", "auralis.library.sort": "title" });
  assert.equal(readDirection(fresh), true, "still ascending after a restart");
  // An old user with a stored sort and no direction keeps descending.
  const old = memory({ "auralis.library.sort": "size" });
  const oldShown = readDirection(old);
  choose(old, () => {}, oldShown, "title");
  assert.equal(readDirection(old), false);
  // A direction the user chose is never overwritten by choosing a sort.
  const chosen = memory({ "auralis.library.sortAscending": "false" });
  choose(chosen, () => {}, true, "artist");
  assert.equal(chosen.values["auralis.library.sortAscending"], "false");
});

test("a sort chosen before the track default keeps its old descending direction", () => {
  const library = fs.readFileSync(path.join(root, "src/components/MusicLibrary.tsx"), "utf8");
  const start = library.indexOf("const [sortAscending, setSortAscending] = useState(");
  const initializer = library.slice(start, library.indexOf("\n  });", start));
  const direction = Function("localStorage", initializer.replace(/^[^]*?useState\(\(\) => \{/, ""));
  const storage = values => ({ getItem: key => key in values ? values[key] : null });
  assert.equal(direction(storage({})), true, "new users: track order, ascending");
  assert.equal(direction(storage({ "auralis.library.sort": "size" })), false, "a stored sort without a direction stays descending");
  assert.equal(direction(storage({ "auralis.library.sort": "title", "auralis.library.sortAscending": "true" })), true);
  assert.equal(direction(storage({ "auralis.library.sortAscending": "false" })), false);
  assert.equal(direction({ getItem() { throw new Error("blocked"); } }), true);
});

test("the media centre defaults to album order and stops 'up' at the library root", () => {
  const library = fs.readFileSync(path.join(root, "src/components/MusicLibrary.tsx"), "utf8");
  assert.match(library, /readStoredChoice\("auralis\.library\.sort", LIBRARY_SORTS, "track"\)/);
  assert.match(library, /return stored === null \? localStorage\.getItem\("auralis\.library\.sort"\) === null : stored === "true";/, "ascending unless the user chose otherwise");
  assert.match(library, /\{LIBRARY_SORTS\.map\(sort =>/);
  assert.match(library, /const parent = parentFolderPath\(folderPath\);\s*return parent && state\.libraryFolders\.some\(root => libraryFolderWithin\(parent, root\)\) \? parent : "";/);
  const dictionary = fs.readFileSync(path.join(root, "src/i18n/index.ts"), "utf8");
  assert.equal((dictionary.match(/"library\.sortTrack"/g) || []).length, 3);
});

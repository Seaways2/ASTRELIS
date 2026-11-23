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

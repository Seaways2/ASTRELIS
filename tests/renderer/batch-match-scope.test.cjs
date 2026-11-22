// Batch film matching covers the folder the user is in (subfolders included),
// not the other video folders of the library.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const load = (relative, modules = {}) => {
  const exports = {};
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  Function("exports", "require", output)(exports, name => modules[name]);
  return exports;
};
const visibility = load("src/utils/folderVisibility.ts");
const scope = load("src/utils/batchMatchScope.ts", { "./folderVisibility": visibility });

const video = (id, sourcePath) => ({ id, name: id, artist: "", album: "", format: "MKV", mediaKind: "video", size: 1, sourcePath });
const library = [
  video("a1", "D:\\电影\\动作\\A1.mkv"),
  video("a2", "D:\\电影\\动作\\续集\\A2.mkv"),
  video("b1", "D:\\电影\\动画\\B1.mkv"),
  video("c1", "D:\\电影\\动作片合集\\C1.mkv"),
  video("w1", "D:\\作品\\W1.mkv")
];
const ids = tracks => tracks.map(track => track.id);

test("an open folder limits the batch to itself and its subfolders", () => {
  const tracks = scope.batchMatchTracks({ tracks: library, hiddenFolders: [], folder: scope.batchMatchFolder("D:\\电影\\动作") });
  // Neither the sibling folder nor a folder that only shares the name prefix.
  assert.deepEqual(ids(tracks), ["a1", "a2"]);
  assert.deepEqual(ids(scope.batchMatchTracks({ tracks: library, hiddenFolders: [], folder: "d:/电影/动作/" })), ["a1", "a2"]);
});

test("at the top level the folder centred in cover flow stands for the current one", () => {
  assert.equal(scope.batchMatchFolder("", "D:\\作品"), "D:\\作品");
  assert.equal(scope.batchMatchFolder("D:\\电影", "D:\\电影\\动画"), "D:\\电影");
  assert.deepEqual(ids(scope.batchMatchTracks({ tracks: library, hiddenFolders: [], folder: scope.batchMatchFolder("", "D:\\作品") })), ["w1"]);
  // Nothing open and nothing focused: the whole library, as the dialog says.
  assert.deepEqual(ids(scope.batchMatchTracks({ tracks: library, hiddenFolders: [], folder: scope.batchMatchFolder("") })), ids(library));
});

test("search hits outside the open folder stay out, and hidden folders never join", () => {
  const hits = new Set(["a2", "b1", "w1"]);
  assert.deepEqual(ids(scope.batchMatchTracks({ tracks: library, hiddenFolders: [], folder: "D:\\电影\\动作", listIds: hits })), ["a2"]);
  assert.deepEqual(ids(scope.batchMatchTracks({ tracks: library, hiddenFolders: ["D:\\电影\\动作\\续集"], folder: "D:\\电影" })), ["a1", "b1", "c1"]);
});

test("the media library builds the batch from the current folder", () => {
  const source = read("src/components/MusicLibrary.tsx");
  const openBatch = source.slice(source.indexOf("function openBatch()"), source.indexOf("const { stats: libraryStats }"));
  assert.match(openBatch, /batchMatchFolder\(folderPath,/);
  assert.match(openBatch, /batchMatchTracks\(\{/);
  assert.match(openBatch, /libraryView==="flow"/);
});

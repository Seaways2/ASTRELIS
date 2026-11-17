// A queued file can disappear: a tagging tool reorganised the folders, or it
// was deleted. The player used to show the raw "ENOENT: no such file or
// directory, stat ..." for DSF and WAV. Now the main process answers
// SOURCE_MISSING, the queue finds the file again through the rescanned
// library, and otherwise marks the entry missing and moves on when advancing.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { loadPlayerStore } = require("./helpers/player-store-harness.cjs");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const relocate = (() => {
  const exports = {};
  Function("exports", ts.transpileModule(read("src/utils/relocateTrack.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports);
  return exports;
})();

const track = (id, fields = {}) => ({
  id, name: `Song ${id}`, artist: "Artist", album: "Album", format: "WAV", size: 1000, duration: 200,
  sourcePath: `K:\\old\\${id}.wav`, nativePath: `K:\\old\\${id}.wav`, url: `auralis-media://local/${id}`, ...fields
});

test("a moved file is found again by content, size, duration and title", () => {
  const queued = track("a", { name: "Waltz Of The Flowers", sourcePath: "K:\\HIFI\\西洋\\柴可夫斯基\\01.Waltz Of The Flowers.wav", size: 5000, duration: 410.2 });
  const moved = track("lib-1", { name: "Waltz of the Flowers", sourcePath: "K:\\HIFI\\Пётр Ильич Чайковский\\2-01 Waltz of the Flowers.wav", size: 5000, duration: 410.3 });
  const other = track("lib-2", { name: "Panorama", sourcePath: "K:\\HIFI\\x\\Panorama.wav", size: 5100, duration: 410.1 });
  assert.equal(relocate.relocateMissingTrack(queued, [other, moved]), moved);
  // Retagged (new size and title) but the same content fingerprint.
  const retagged = track("lib-3", { name: "Nutcracker: Waltz", size: 5100, duration: 410.2, sourcePath: "K:\\HIFI\\y\\z.wav", file: { size: 5100, mtimeMs: 1, fingerprint: "abc" } });
  assert.equal(relocate.relocateMissingTrack({ ...queued, file: { size: 5000, mtimeMs: 0, fingerprint: "abc" } }, [other, retagged]), retagged);
  // Another format, or only a similar duration, is not the same file.
  assert.equal(relocate.relocateMissingTrack(queued, [{ ...moved, format: "FLAC" }]), undefined);
  assert.equal(relocate.relocateMissingTrack(queued, [other]), undefined);
  // Two equally good candidates: no guess.
  assert.equal(relocate.relocateMissingTrack(queued, [moved, { ...moved, id: "lib-4", sourcePath: "K:\\HIFI\\copy\\01.Waltz Of The Flowers.wav" }]), undefined);
  // The renderer and the main process agree on the code.
  assert.equal(relocate.SOURCE_MISSING, "SOURCE_MISSING");
  assert.match(read("electron/library/media/sourceAvailability.ts"), /export const SOURCE_MISSING = "SOURCE_MISSING";/);
});

test("playing a moved file relinks the queue entry and plays it from its new place", async () => {
  const prepared = [];
  const { store } = loadPlayerStore({ desktop: { library: {
    prepare: async source => {
      prepared.push(source);
      return source.startsWith("K:\\old\\") ? { ok: false, code: "SOURCE_MISSING", error: "找不到音频文件「a.wav」：它可能已被移动、重命名或删除。" }
        : { ok: true, url: `prepared:${source}`, path: source };
    }
  } } });
  store.setState({ libraryTracks: [track("lib-a", { sourcePath: "K:\\new\\a.wav", nativePath: "K:\\new\\a.wav" })] });
  store.getState().addQueueTracks([track("a")]);
  await store.getState().playTrack(0);
  const entry = store.getState().tracks[0];
  assert.deepEqual(prepared, ["K:\\old\\a.wav", "K:\\new\\a.wav"]);
  assert.equal(entry.id, "a", "the queue entry keeps its id");
  assert.equal(entry.sourcePath, "K:\\new\\a.wav");
  assert.equal(entry.url, "prepared:K:\\new\\a.wav");
  assert.equal(entry.missing, undefined);
  assert.equal(store.getState().libraryError, "");
  assert.equal(store.getState().currentIndex, 0);
});

test("a file that is gone is marked missing; advancing skips past it", async () => {
  const prepared = [];
  const { store } = loadPlayerStore({ desktop: { library: {
    prepare: async source => {
      prepared.push(source);
      return source.includes("gone") ? { ok: false, code: "SOURCE_MISSING", error: "找不到音频文件「gone.wav」：它可能已被移动、重命名或删除。" }
        : { ok: true, url: `prepared:${source}`, path: source };
    }
  } } });
  store.getState().addQueueTracks([track("first"), track("gone-1"), track("gone-2"), track("last")]);
  // A user's own choice stops on the missing file and says why.
  await store.getState().playTrack(1);
  assert.equal(store.getState().tracks[1].missing, true);
  assert.match(store.getState().libraryError, /找不到音频文件「gone\.wav」.*重新扫描所在文件夹/);
  // Advancing after a song ends moves on to the next file that is there.
  await store.getState().playTrack(1, { navigateToNowPlaying: false, skipMissing: 4 });
  for (let attempt = 0; attempt < 10 && store.getState().currentIndex !== 3; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(store.getState().currentIndex, 3);
  assert.equal(store.getState().tracks[2].missing, true);
  assert.ok(prepared.at(-1).includes("last"));
});

test("skipping missing files stops at the end of the queue unless repeat is all", async () => {
  const run = async repeat => {
    const prepared = [];
    const { store } = loadPlayerStore({ desktop: { library: {
      prepare: async source => {
        prepared.push(source);
        return source.includes("gone") ? { ok: false, code: "SOURCE_MISSING", error: "找不到音频文件。" } : { ok: true, url: `prepared:${source}`, path: source };
      }
    } } });
    store.getState().addQueueTracks([track("first"), track("gone-last")]);
    store.setState({ repeat });
    await store.getState().playTrack(1, { navigateToNowPlaying: false, skipMissing: 2 });
    for (let attempt = 0; attempt < 10; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
    return prepared;
  };
  assert.deepEqual(await run("off"), [String.raw`K:\old\gone-last.wav`], "repeat off: stop after the last entry");
  assert.ok((await run("all")).some(source => source.includes("first")), "repeat all: go round to the first entry");
});

test("both prepare handlers check the file before decoding", () => {
  for (const file of ["electron/ipc/libraryIpc.ts", "electron/ipc/audioCacheIpc.ts"])
    assert.match(read(file), /if \(await sourceIsMissing\(source\)\) return missingSourceResult\(source\);/, file);
  const availability = read("electron/library/media/sourceAvailability.ts");
  assert.match(availability, /return code === "ENOENT" \|\| code === "ENOTDIR";/);
  // Automatic advancement may skip; a user's own choice does not.
  const app = read("src/App.tsx");
  assert.equal((app.match(/skipMissing: latest\.tracks\.length/g) || []).length, 2);
});

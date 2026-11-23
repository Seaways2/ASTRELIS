// Web Audio failures and entries whose source is still an original file only
// the decoded cache plays (APE/DSF/WMA/WV/TTA/AIFF): a failure never cancels a
// track the user is choosing, never starts a paused queue, and an entry that
// became current without being prepared is prepared on Play instead of being
// loaded and reported as a broken file.
const assert = require("node:assert/strict");
const test = require("node:test");
const ts = require("typescript");
const { readAppSource } = require("./helpers/appSource.cjs");
const { loadPlayerStore } = require("./helpers/player-store-harness.cjs");

const appSource = readAppSource();
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const appCallback = (name, deps, depsList = "\\[\\]") => {
  const body = appSource.match(new RegExp(`const ${name} = useCallback\\(([\\s\\S]+?), ${depsList}\\);`))[1];
  const names = Object.keys(deps);
  return Function(...names, transpile(`const fn = ${body};`) + "\nreturn fn;")(...names.map(key => deps[key]));
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const raw = (id, extension = "ape") => ({ id, name: id, artist: "Artist", album: "Album", format: extension.toUpperCase(), size: 100,
  sourcePath: `C:/${id}.${extension}`, nativePath: undefined, url: `auralis-media://local/C:/${id}.${extension}` });
const flac = id => ({ ...raw(id, "flac"), nativePath: `C:/${id}.flac` });
const decoded = source => ({ ok: true, url: `auralis-media://local/cache/${source}.wav`, path: `cache/${source}.wav` });

function errorHandler(store, code) {
  const reports = [];
  const handle = appCallback("handleLocalPlaybackError", {
    usePlayerStore: store, failedLocalPlaybackToken: { current: "" }, audioEngine: { element: { error: { code, message: "" } } },
    setDeviceError: message => reports.push(message), t: (key, values) => `${key}:${values.name}`
  }, "\\[t\\]");
  return { reports, handle };
}
const quietly = fn => {
  const original = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = original; }
};
const tokenOf = store => `${store.getState().tracks[store.getState().currentIndex].id}:${store.getState().localPlayRequest}`;

test("an entry still on its original file is told apart from a prepared one", () => {
  const { exports } = loadPlayerStore();
  const awaits = exports.awaitsDecodedSource;
  assert.equal(awaits(raw("A")), true, "restored or scanned APE: no native path");
  assert.equal(awaits({ ...raw("A", "aiff"), nativePath: "C:/A.aiff" }), true, "AIFF: the native path is the original file");
  assert.equal(awaits({ ...raw("A", "wma"), nativePath: "C:/A.wma", url: "blob:x" }), true, "added while HDMI direct was on");
  assert.equal(awaits({ ...raw("A"), ...{ url: decoded("A").url, nativePath: decoded("A").path } }), false, "prepared");
  assert.equal(awaits(flac("B")), false);
  assert.equal(awaits(undefined), false);
});

test("a Web source failing while a chosen track is prepared does not cancel that choice", async () => {
  const pending = new Map();
  const { store, exports } = loadPlayerStore({ desktop: { library: { prepare: source => new Promise(resolve => pending.set(source, resolve)) } } });
  const s = () => store.getState();
  store.setState({ libraryTracks: [raw("X")] });
  // Double-click an APE with the queue empty: it is current at once, and its
  // original file may reach the element before prepare (ffmpeg) returns.
  const playing = s().enqueueLibraryTrack("X", true);
  assert.equal(s().tracks[s().currentIndex].id, "X");
  assert.equal(s().hasPendingPlay(), true);
  assert.equal(exports.awaitsDecodedSource(s().tracks[s().currentIndex]), true, "App does not load this url at all");
  const { reports, handle } = errorHandler(store, 4);
  quietly(() => handle(tokenOf(store)));
  assert.deepEqual(reports, [], "the choice reports for itself");
  assert.equal(s().hasPendingPlay(), true, "still being prepared");
  pending.get("C:/X.ape")(decoded("X"));
  await playing;
  assert.equal(s().playing, true, "the chosen track plays");
  assert.equal(s().tracks[s().currentIndex].url, decoded("X").url);
});

test("a paused entry that fails reports only; a playing one moves on within its budget", async () => {
  const { store } = loadPlayerStore({ desktop: { library: { prepare: async source => ({ ok: true, url: `prepared:${source}`, path: source }) } } });
  const s = () => store.getState();
  s().addQueueTracks(["A", "B", "C"].map(flac));
  // An automatic advance (it carries a skip budget) that the user paused.
  await s().playTrack(0, { navigateToNowPlaying: false, skipMissing: 3 });
  s().setPlaying(false);
  const paused = errorHandler(store, 2);
  quietly(() => paused.handle(tokenOf(store)));
  await settle();
  assert.equal(s().tracks[s().currentIndex].id, "A", "the pause is kept");
  assert.equal(s().playing, false);
  assert.deepEqual(paused.reports, ["playback.failed:A"]);
  // The budget is kept for when it plays again.
  s().setPlaying(true);
  const playing = errorHandler(store, 3);
  quietly(() => playing.handle(tokenOf(store)));
  assert.deepEqual(playing.reports, ["playback.failedSkipped:A"]);
  await settle();
  assert.equal(s().tracks[s().currentIndex].id, "B");
  assert.equal(s().playing, true);
});

test("Play prepares an entry that became current unprepared, keeping its request and position", async () => {
  let answer = decoded;
  const calls = [];
  const { store, exports } = loadPlayerStore({ desktop: { library: { prepare: async source => { calls.push(source); return answer(source); } } } });
  const s = () => store.getState();
  const prepareCurrentEntry = appCallback("prepareCurrentEntry", { usePlayerStore: store, awaitsDecodedSource: exports.awaitsDecodedSource });
  // A restored queue: the APE is current with its bookmark, never prepared.
  store.setState({ tracks: [raw("X"), flac("B")], currentIndex: 0, currentTime: 42, duration: 0, localPlayRequest: 5 });
  s().setPlaying(true);
  const first = prepareCurrentEntry();
  await prepareCurrentEntry();
  await first;
  assert.deepEqual(calls, ["C:/X.ape"], "prepared once");
  assert.equal(s().localPlayRequest, 5, "the same request: its new url reloads it");
  assert.equal(s().currentTime, 42, "from the restored position");
  assert.equal(s().playing, true);
  assert.equal(exports.awaitsDecodedSource(s().tracks[0]), false);

  // Removing the playing entry moves an unprepared one into place.
  store.setState({ tracks: [flac("A"), raw("Y", "dsf")], currentIndex: 0, playing: true });
  s().removeTrack("A");
  assert.equal(s().tracks[s().currentIndex].id, "Y");
  await prepareCurrentEntry();
  assert.equal(s().tracks[s().currentIndex].url, decoded("C:/Y.dsf").url);
  assert.equal(s().playing, true);

  // An entry that cannot be prepared stops (with playTrack's message) instead of silent "playing".
  answer = () => ({ ok: false, error: "HiFi 音源解码失败: bad header" });
  store.setState({ tracks: [raw("Z", "wv")], currentIndex: 0, libraryError: "" });
  s().setPlaying(true);
  await prepareCurrentEntry();
  assert.equal(s().playing, false);
  assert.equal(s().libraryError, "HiFi 音源解码失败: bad header");
  assert.equal(s().tracks[s().currentIndex].id, "Z");
});

test("App never loads an unprepared original file and prepares it on Play", () => {
  // Load chain: such an entry is not handed to the element, whose "error"
  // would report a good file as broken.
  assert.match(appSource, /const unprepared = awaitsDecodedSource\(current\);\s*void \(async \(\) => \{\s*try \{\s*await fadeOutPreviousTrack\(\);/);
  // Its prepared url is a new source of the same request, not a failed one.
  assert.match(appSource, /if \(unprepared\) \{ audioEngine\.stop\(\); if \(usePlayerStore\.getState\(\)\.playing\) void prepareCurrentEntry\(\); return; \}\s*failedLocalPlaybackToken\.current = "";\s*localWebSourceToken\.current = playbackToken;\s*audioEngine\.load\(current\.url\);/);
  // Transport: Play on it prepares instead of waiting for a source that never loads.
  assert.match(appSource, /if \(state\.playing\) \{[^}]*?if \(awaitsDecodedSource\(current\)\) void prepareCurrentEntry\(\);\s*else if \(localWebSourceToken\.current === playToken\) \{/);
});

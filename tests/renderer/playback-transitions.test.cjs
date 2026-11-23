// Track changes, completion and failures on the default Web Audio output:
// the shared <audio> element, its events and the queue state they drive.
const { readAppSource } = require("./helpers/appSource.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { loadPlayerStore, makeTrack } = require("./helpers/player-store-harness.cjs");

const root = path.resolve(__dirname, "../..");
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(relative, globals = {}) {
  const module = { exports: {} };
  const names = Object.keys(globals);
  Function("exports", "module", "require", ...names, transpile(fs.readFileSync(path.join(root, relative), "utf8")))(
    module.exports, module, name => name === "../utils/frequencySmoothing" ? load("src/utils/frequencySmoothing.ts") : require(name),
    ...names.map(name => globals[name]));
  return module.exports;
}
const { bindWebPlaybackEvents } = load("src/utils/webPlaybackEvents.ts");
const { PlaybackEndLatch, nextQueueIndexAfterEnd } = load("src/utils/playbackEndLatch.ts");
const { PlaybackExclusion } = load("src/utils/playbackExclusion.ts");
const { isVideoTrack } = load("src/utils/videoTrack.ts");
const settle = () => new Promise(resolve => setImmediate(resolve));

// A media element that dispatches its events asynchronously, as Chromium does.
class FakeAudio extends EventTarget {
  constructor() { super(); this.paused = true; this.ended = false; this.src = ""; this.currentTime = 0; this.duration = NaN; this.readyState = 0; this.error = null; this.loads = []; }
  queue(type) { setImmediate(() => this.dispatchEvent(new Event(type))); }
  play() { if (this.paused) { this.paused = false; this.queue("play"); } return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.queue("pause"); } }
  load() { this.loads.push(this.src); this.paused = true; this.ended = false; this.currentTime = 0; }
}
const param = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
const node = extra => ({ connect: target => target, disconnect() {}, ...extra });
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.destination = node(); }
  createMediaElementSource() { return node(); }
  createGain() { return node({ gain: param() }); }
  createAnalyser() { return node({ fftSize: 2048, frequencyBinCount: 1024 }); }
  createChannelSplitter() { return node(); }
  async resume() {}
}
function loadAudioEngine() {
  return load("src/audio/AudioEngine.ts", {
    Audio: FakeAudio, AudioContext: FakeAudioContext, HTMLMediaElement: { HAVE_METADATA: 1 },
    window: { setTimeout, clearTimeout, addEventListener() {} }
  }).audioEngine;
}

const appSource = readAppSource();
const appFunction = (name, deps) => {
  const body = appSource.match(new RegExp(`const ${name} = useCallback\\(([\\s\\S]+?), \\[\\]\\);`))[1];
  const names = Object.keys(deps);
  return Function(...names, transpile(`const fn = ${body};`) + "\nreturn fn;")(...names.map(key => deps[key]));
};

test("Next during playback with a fade keeps playing and starts the new track (LA01/LV01)", async () => {
  const engine = loadAudioEngine();
  engine.setFade(30);
  const { store } = loadPlayerStore({ desktop: { library: { prepare: async source => ({ ok: true, url: `prepared:${source}`, path: source }) } } });
  const s = () => store.getState();
  store.setState({ tracks: ["A", "B"].map(makeTrack), currentIndex: 0, playing: true });
  const tokenOf = () => `${s().tracks[s().currentIndex].id}:${s().localPlayRequest}`;
  // App: the element holds the play request it was loaded for; listeners are
  // bound per play request and re-bound when it changes.
  let loadedToken = tokenOf();
  engine.load(s().tracks[0].url);
  await engine.play();
  const bind = () => bindWebPlaybackEvents(engine, tokenOf(), () => loadedToken, {
    sync() {}, ended() {}, failed() {}, observed: playing => s().setPlaybackObserved(playing)
  });
  let unbind = bind();
  await settle();
  await s().playTrack(1, { navigateToNowPlaying: false, skipMissing: 2 });
  unbind(); unbind = bind();
  assert.equal(s().playing, true);
  // Load chain: fade the old source out, a native IPC round trip, then load.
  await engine.pause();
  await settle();
  assert.equal(s().playing, true, "the old source's fade-out pause is not a user pause");
  loadedToken = tokenOf();
  engine.load(s().tracks[1].url);
  if (s().playing) await engine.play();
  await settle();
  assert.equal(engine.element.src, "prepared:B.ape");
  assert.equal(engine.element.paused, false, "the new track starts");
  assert.equal(s().playing, true);
  // A real pause of the loaded source still reaches the store.
  engine.element.pause();
  await settle();
  assert.equal(s().playing, false);
  unbind();
});

test("events of a superseded or not yet loaded source are ignored; failures of the current one are reported", () => {
  const listeners = new Map();
  const source = { element: { ended: false }, on: (event, listener) => { listeners.set(event, listener); return () => listeners.delete(event); } };
  const calls = [];
  let loaded = "A:1";
  const unbind = bindWebPlaybackEvents(source, "B:2", () => loaded, {
    sync: () => calls.push("sync"), ended: () => calls.push("ended"), failed: () => calls.push("failed"), observed: playing => calls.push(playing)
  });
  for (const event of ["timeupdate", "ended", "pause", "error"]) listeners.get(event)();
  assert.deepEqual(calls, [], "the previous track's late events do not touch the new request");
  loaded = "B:2";
  for (const event of ["timeupdate", "play", "pause", "error", "ended"]) listeners.get(event)();
  assert.deepEqual(calls, ["sync", true, false, "failed", "ended"]);
  calls.length = 0;
  source.element.ended = true;
  listeners.get("pause")();
  assert.deepEqual(calls, [], "the pause that precedes 'ended' is part of completion");
  unbind();
  assert.equal(listeners.size, 0);
});

test("AudioEngine forwards the element's error event", () => {
  const engine = loadAudioEngine();
  let failures = 0;
  engine.on("error", () => failures++);
  engine.element.dispatchEvent(new Event("error"));
  assert.equal(failures, 1);
});

test("repeat-one replays on the Web output although the element pauses before 'ended' (LA02)", async () => {
  const { store } = loadPlayerStore();
  const s = () => store.getState();
  store.setState({ tracks: [makeTrack("A")], currentIndex: 0, localPlayRequest: 4, playing: true, repeat: "one", currentTime: 199.9, duration: 200 });
  const calls = [];
  const listeners = new Map();
  const audioEngine = {
    element: { ended: false },
    on: (event, listener) => { listeners.set(event, listener); return () => listeners.delete(event); },
    seek: time => calls.push(["seek", time]),
    play: async () => calls.push(["play"]),
    pause: async () => calls.push(["pause"]),
    clearOnlineAnalysis() {}
  };
  const refs = { localNativeReady: { current: false }, localRouteSession: { current: "" } };
  const window = { desktop: { nativeAudio: { command: async () => ({ ok: true }) } } };
  const playExclusive = appFunction("playExclusive", {
    usePlayerStore: store, videoActiveRef: { current: false }, playbackExclusion: { current: new PlaybackExclusion() }, window, audioEngine, ...refs
  });
  const errors = [];
  const handleLocalEnded = appFunction("handleLocalEnded", {
    usePlayerStore: store, nextQueueIndexAfterEnd, localPlaybackEndLatch: { current: new PlaybackEndLatch() },
    completedLocalPlaybackToken: { current: "" }, playbackBackend: { current: { trackId: "A", native: false } },
    window, setDeviceError: message => errors.push(message), playExclusive, isVideoTrack, audioEngine, ...refs
  });
  bindWebPlaybackEvents(audioEngine, "A:4", () => "A:4", {
    sync() {}, failed() {}, ended: () => handleLocalEnded("A:4"), observed: playing => s().setPlaybackObserved(playing)
  });
  // Chromium at the end of the media: paused=true, 'pause', then 'ended'.
  audioEngine.element.ended = true;
  listeners.get("pause")();
  listeners.get("ended")();
  await settle(); await settle();
  assert.deepEqual(calls, [["seek", 0], ["play"]]);
  assert.equal(s().playing, true);
  assert.equal(s().currentTime, 0);
  assert.deepEqual(errors, []);
});

test("a natural video ending never loops back to an unrelated first video (LV08)", () => {
  const video = id => ({ id, format: "MKV", mediaKind: "video" });
  for (const [index, expected] of [[0, [["play", 1]]], [2, [["playing", false]]]]) {
    const calls = [];
    const latest = { tracks: ["film", "E01", "E02"].map(video), currentIndex: index, localPlayRequest: 0, repeat: "all", shuffle: false,
      hasPendingPlay: () => false, playTrack: next => calls.push(["play", next]), setPlaying: value => calls.push(["playing", value]) };
    appFunction("handleLocalEnded", {
      usePlayerStore: { getState: () => latest }, nextQueueIndexAfterEnd, localPlaybackEndLatch: { current: new PlaybackEndLatch() },
      completedLocalPlaybackToken: { current: "" }, isVideoTrack
    })();
    assert.deepEqual(calls, expected);
  }
});

test("Play after the queue ended rewinds a native reader and re-arms completion (P06)", () => {
  // The transport effect needs a window; check its steps in the source.
  assert.match(appSource, /const playToken = `\$\{current\.id\}:\$\{state\.localPlayRequest\}`;/);
  assert.match(appSource, /const nativeRewind = startedLocal && nativePlayback && localNativeReady\.current\s*&& timing\.duration > 0 && timing\.currentTime >= timing\.duration - \.05;/);
  assert.match(appSource, /if \(startedLocal && !nativeRewind\) localPlaybackEndLatch\.current\.release\(playToken\);/,
    "starting playback releases the completion latch of the same request");
  // A status reply requested before the seek still reports the end: the
  // latch is released only once the reader is back at the start.
  assert.match(appSource, /if \(nativeRewind\) \{\s*await window\.desktop\?\.nativeAudio\.command\(\{ type: "seek", position: 0 \}\);\s*localPlaybackEndLatch\.current\.release\(playToken\);\s*\}\s*await playExclusive\(true, routeSessionId\);/);
});

test("the Web source of a play request is recorded before it loads and only that source is started (LA01)", () => {
  // Load chain: no await between naming the source and loading it, otherwise
  // events of the new source would be dropped as belonging to an old one.
  assert.match(appSource, /localWebSourceToken\.current = playbackToken;\s*audioEngine\.load\(current\.url\);/);
  // Transport: Play addresses only the source loaded for the current request.
  assert.match(appSource, /const playToken = `\$\{current\.id\}:\$\{state\.localPlayRequest\}`;/);
  assert.match(appSource, /if \(state\.playing\) \{[^}]*?if \(localWebSourceToken\.current === playToken\) \{/);
  assert.match(appSource, /useEffect\(\(\) => \{\s*localWebSourceToken\.current = "";\s*if \(!current\) \{/, "a new request forgets the loaded source first");
});

test("Play on a Web source that failed to load stops and reports again instead of silent playing (LA06)", () => {
  // play() on such an element rejects with NotSupportedError and no new
  // "error" event follows, so the transport effect must not call it.
  assert.match(appSource, /if \(failedLocalPlaybackToken\.current !== playToken\) playExclusive\(false\)\.catch\(handleWebPlayRejection\);\s*else if \(!usePlayerStore\.getState\(\)\.hasPendingPlay\(\)\) \{\s*state\.setPlaying\(false\);\s*setDeviceError\(t\("playback\.failed", \{ name: current\.name \}\)\);\s*\}/);
});

test("a video resumes only from the store's bookmark, so choosing it again starts from the top (P04)", () => {
  assert.doesNotMatch(appSource, /videoBookmarks/);
  assert.match(appSource, /const resumePosition = videoState\?\.playbackToken === token \? videoState\.position : positionAtSwitch;/);
});

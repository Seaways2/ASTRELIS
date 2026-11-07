const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { pendingPlayback, makeTrack } = require("./helpers/player-store-harness.cjs");
const root = path.resolve(__dirname, "../..");
function load(relative) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  Function("exports", "module", js)(module.exports, module);
  return module.exports;
}
const { nextQueueIndex, nextQueueIndexAfterEnd, PlaybackEndLatch } = load("src/utils/playbackEndLatch.ts");
const { virtualQueueRange } = load("src/utils/virtualQueueRange.ts");
const { isVideoTrack } = load("src/utils/videoTrack.ts");

test("natural completion distinguishes repeat off, all and one at the queue boundary", () => {
  for (const shuffle of [false, true]) {
    assert.equal(nextQueueIndexAfterEnd(3, 2, shuffle, "off"), -1);
    assert.equal(nextQueueIndexAfterEnd(1, 0, shuffle, "off"), -1);
    assert.equal(nextQueueIndexAfterEnd(3, 2, shuffle, "one"), 2);
  }
  assert.equal(nextQueueIndexAfterEnd(3, 2, false, "all"), 0);
  assert.equal(nextQueueIndexAfterEnd(3, 0, false, "off"), 1);
  assert.equal(nextQueueIndexAfterEnd(0, -1, false, "all"), -1);
  assert.equal(nextQueueIndex(3, 2, false), 0, "manual Next still wraps");
});

test("the actual App ended handler stops instead of playing the first track with repeat off", () => {
  const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
  const handlerBody = app.match(/const handleLocalEnded = useCallback\(([\s\S]+?), \[\]\);/)[1];
  for (const repeat of ["off", "all"]) {
    const calls = [];
    const latest = { tracks: [{ id: "A" }, { id: "B" }], currentIndex: 1, localPlayRequest: 0, repeat, shuffle: false,
      hasPendingPlay: () => false,
      playTrack: index => calls.push(["play", index]), setPlaying: value => calls.push(["playing", value]) };
    const javascript = ts.transpileModule("const handler = " + handlerBody + ";", {}).outputText;
    const handler = Function("usePlayerStore", "nextQueueIndexAfterEnd", "localPlaybackEndLatch", "completedLocalPlaybackToken", "isVideoTrack",
      javascript + "\nreturn handler;")({ getState: () => latest }, nextQueueIndexAfterEnd, { current: new PlaybackEndLatch() }, { current: "" }, isVideoTrack);
    handler(); handler();
    assert.deepEqual(calls, repeat === "off" ? [["playing", false]] : [["play", 0]]);
  }
});

test("large queues render a bounded visible window at the start, middle and end", () => {
  for (const total of [1000, 10000, 100000]) {
    for (const top of [0, total * 25, total * 50]) {
      const range = virtualQueueRange(total, 50, top, 600);
      assert.ok(range.limit <= 22);
      assert.ok(range.offset >= 0);
      assert.ok(range.offset + range.limit <= total);
      assert.equal(range.totalHeight, total * 50);
    }
  }
});

test("virtual queue stays valid after deleting rows at the bottom or clearing it", () => {
  const shrunk = virtualQueueRange(3, 50, 499900, 600);
  assert.deepEqual(shrunk, { offset: 0, limit: 3, totalHeight: 150 });
  assert.deepEqual(virtualQueueRange(0, 50, 499900, 600), { offset: 0, limit: 0, totalHeight: 0 });
});

function endedHandler(store) {
  const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
  const body = app.match(/const handleLocalEnded = useCallback\(([\s\S]+?), \[\]\);/)[1];
  const javascript = ts.transpileModule("const handler = " + body + ";", {}).outputText;
  return Function("usePlayerStore", "nextQueueIndexAfterEnd", "localPlaybackEndLatch", "completedLocalPlaybackToken", "isVideoTrack",
    javascript + "\nreturn handler;")(store, nextQueueIndexAfterEnd, { current: new PlaybackEndLatch() }, { current: "" }, isVideoTrack);
}
for (const repeat of ["off", "all", "one"]) {
  for (const outcome of ["prepared", "stop", "failed"]) {
    test(`${repeat}: an old track ending preserves the pending selection until ${outcome}`, async () => {
      const { store, finish, pending } = pendingPlayback();
      store.setState({ tracks: ["A", "B"].map(makeTrack), currentIndex: 1, playing: true, repeat });
      const playing = store.getState().playTrack(0);
      // Chromium can report the old media's pause before its ended event.
      store.getState().setPlaybackObserved(false);
      endedHandler(store)("B:0");
      assert.equal(store.getState().hasPendingPlay(), true);
      assert.equal(store.getState().currentIndex, 1);
      assert.equal(store.getState().playing, false);
      if (outcome === "stop") store.getState().setPlaying(false);
      if (outcome === "failed") pending.get("A.ape").reject(new Error("invalid audio"));
      else finish("A");
      await playing;
      const state = store.getState();
      assert.equal(state.hasPendingPlay(), false);
      assert.equal(state.tracks[state.currentIndex].id, outcome === "prepared" ? "A" : "B");
      assert.equal(state.playing, outcome === "prepared");
      if (outcome === "failed") assert.equal(state.libraryError, "invalid audio");
    });
  }
}

for (const interruption of ["none", "pause", "track", "pending-track", "route"]) {
  test(`native repeat-one respects ${interruption} while the seek reply is pending`, async () => {
    const { store } = pendingPlayback();
    store.setState({ tracks: ["A", "B"].map(makeTrack), currentIndex: 1, localPlayRequest: 0, playing: true, repeat: "one", duration: 120, currentTime: 120 });
    let finishSeek;
    const commands = [], errors = [];
    const route = { current: "route:B" };
    const latch = new PlaybackEndLatch();
    const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
    const body = app.match(/const handleLocalEnded = useCallback\(([\s\S]+?), \[\]\);/)[1];
    const javascript = ts.transpileModule("const handler = " + body + ";", {}).outputText;
    const handler = Function("usePlayerStore", "nextQueueIndexAfterEnd", "localPlaybackEndLatch", "completedLocalPlaybackToken",
      "playbackBackend", "localNativeReady", "localRouteSession", "window", "setDeviceError", "playExclusive", "isVideoTrack", javascript + "\nreturn handler;")(
        store, nextQueueIndexAfterEnd, { current: latch }, { current: "" }, { current: { trackId: "B", native: true } },
        { current: true }, route, { desktop: { nativeAudio: { command: command => {
          commands.push(command);
          return command.type === "seek" ? new Promise(resolve => { finishSeek = resolve; }) : Promise.resolve({ ok: true });
        } } } }, message => errors.push(message), async (native, routeSessionId) => {
          assert.equal(native, true);
          commands.push({type:"play",routeSessionId});
        }, isVideoTrack);
    handler("B:0");
    if (interruption === "pause") store.getState().setPlaying(false);
    else if (interruption === "track") store.getState().setCurrentIndex(0);
    else if (interruption === "pending-track") void store.getState().playTrack(0);
    else if (interruption === "route") route.current = "route:new";
    finishSeek({ ok: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(commands.map(command => command.type), interruption === "none" ? ["seek", "play"] : ["seek"]);
    if (interruption === "none") {
      assert.equal(commands[1].routeSessionId, "route:B");
      assert.equal(store.getState().currentTime, 0);
    }
    if (interruption === "pause") assert.equal(store.getState().playing, false);
    assert.deepEqual(errors, []);
    assert.equal(latch.claim("B:0"), true, "superseded replay releases only its old latch");
  });
}

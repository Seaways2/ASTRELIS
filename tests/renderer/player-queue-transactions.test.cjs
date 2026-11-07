const assert = require("node:assert/strict");
const test = require("node:test");
const { loadPlayerStore, makeTrack, pendingPlayback } = require("./helpers/player-store-harness.cjs");

test("prepared playback follows track identity after removing an earlier queue row", async () => {
  const { store, finish } = pendingPlayback();
  store.setState({ tracks: ["A", "B", "C"].map(makeTrack), currentIndex: 0 });
  const playing = store.getState().playTrack(1);
  store.getState().removeTrack("A");
  finish("B");
  await playing;
  const state = store.getState();
  assert.equal(state.tracks[state.currentIndex].id, "B");
  assert.equal(state.tracks[0].url, "prepared-B");
  assert.equal(state.tracks[1].url, "auralis-media://local/C");
  assert.equal(state.playing, true);
});

for (const cancel of ["delete-target", "clear", "pause", "handoff"]) {
  test(`pending preparation cannot resume after ${cancel}`, async () => {
    const { store, finish } = pendingPlayback();
    store.setState({ tracks: ["A", "B"].map(makeTrack), currentIndex: 0, playing: false });
    const playing = store.getState().playTrack(1);
    if (cancel === "delete-target") store.getState().removeTrack("B");
    else if (cancel === "clear") store.getState().clearTracks();
    else if (cancel === "pause") store.getState().setPlaying(false);
    else store.getState().cancelPendingPlay();
    finish("B");
    await playing;
    const state = store.getState();
    assert.equal(state.playing, false);
    assert.equal(state.currentIndex, cancel === "clear" ? -1 : 0);
    assert.ok(state.tracks.every(track => !track.url.startsWith("prepared-")));
  });
}

test("a deleted and re-added ID cannot receive an old preparation result", async () => {
  const { store, finish } = pendingPlayback();
  store.setState({ tracks: [makeTrack("A")], currentIndex: 0 });
  const pending = store.getState().playTrack(0);
  store.getState().removeTrack("A");
  await store.getState().enqueueStreamTrack(makeTrack("A"), false);
  finish("A");
  await pending;
  assert.equal(store.getState().tracks[0].url, "auralis-media://local/A");
  assert.equal(store.getState().playing, false);
});

test("the latest play request wins when decoding completes out of order", async () => {
  const { store, finish } = pendingPlayback();
  store.setState({ tracks: ["A", "B"].map(makeTrack), currentIndex: 0 });
  const a = store.getState().playTrack(0), b = store.getState().playTrack(1);
  finish("B"); await b;
  finish("A"); await a;
  assert.equal(store.getState().tracks[store.getState().currentIndex].id, "B");
  assert.equal(store.getState().tracks[0].url, "auralis-media://local/A");
});

test("a failed IPC preparation reports an error without an unhandled rejection", async () => {
  const { store, pending } = pendingPlayback();
  store.setState({ tracks: [makeTrack("A")], currentIndex: 0 });
  const play = store.getState().playTrack(0);
  pending.get("A.ape").reject(new Error("decode unavailable"));
  await play;
  assert.equal(store.getState().libraryError, "decode unavailable");
  assert.equal(store.getState().playing, false);
});

test("re-importing a duplicate keeps the playing track identity and position", async () => {
  const { store } = loadPlayerStore();
  const file = { name: "A.mp3", size: 3, lastModified: 1 };
  store.setState({
    tracks: [makeTrack("A.mp3-3-1"), makeTrack("B")], currentIndex: 1, playing: true, currentTime: 24
  });
  await store.getState().addTracks([file]);
  const state = store.getState();
  assert.equal(state.tracks[state.currentIndex].id, "B");
  assert.equal(state.currentTime, 24);
  assert.equal(state.playing, true);
  assert.equal(state.tracks.length, 2);
});

test("removing an already removed row does not move the current selection", () => {
  const { store } = loadPlayerStore();
  store.setState({ tracks: ["A", "B"].map(makeTrack), currentIndex: 1 });
  store.getState().removeTrack("missing");
  assert.equal(store.getState().currentIndex, 1);
});

test("cancelling during the online stop response cannot continue a stale local handoff", async () => {
  let finishStop;
  const commands = [];
  const { store } = loadPlayerStore({ desktop: {
    browser: { mediaAction: () => new Promise(resolve => { finishStop = resolve; }) },
    nativeAudio: { command: async command => { commands.push(command); return { ok: true }; } },
    library: { prepare: async () => { throw new Error("stale preparation must not start"); } }
  } });
  store.setState({ tracks: [makeTrack("A")], currentIndex: 0, onlineMedia: { playing: true } });
  const playing = store.getState().playTrack(0);
  store.getState().setPlaying(false);
  finishStop({ ok: true });
  await playing;
  assert.deepEqual(commands, []);
  assert.equal(store.getState().playing, false);
});

test("a successful online-to-local handoff pauses the page and preserves its position", async () => {
  const order = [];
  const { store } = loadPlayerStore({ desktop: {
    browser: { mediaAction: async action => { order.push(action); return { ok: true }; } },
    nativeAudio: { command: async command => { order.push(command.type); return { ok: true }; } },
    library: { prepare: async () => { order.push("prepare"); return { ok: true, url: "prepared-A", path: "A.wav" }; } }
  } });
  store.setState({ tracks: [makeTrack("A")], currentIndex: 0, onlineMedia: { playing: true, currentTime: 115 } });
  await store.getState().playTrack(0);
  assert.deepEqual(order, ["pause", "prepare"]);
  assert.equal(store.getState().onlineMedia.currentTime, 115);
  assert.equal(store.getState().onlineMedia.playing, false);
  assert.equal(store.getState().playing, true);
});

for (const response of [{ ok: false, error: "pause failed" }, undefined]) {
  test(`local playback waits for a successful page pause: ${JSON.stringify(response)}`, async () => {
    let finishPause;
    let prepared = false;
    const { store } = loadPlayerStore({ desktop: {
      browser: { mediaAction: action => {
        assert.equal(action, "pause");
        return new Promise(resolve => { finishPause = resolve; });
      } },
      library: { prepare: async () => { prepared = true; return { ok: true, url: "prepared-A" }; } }
    } });
    store.setState({ tracks: [makeTrack("A")], currentIndex: 0, playing: false, onlineMedia: { playing: true } });
    const playing = store.getState().playTrack(0);
    assert.equal(prepared, false);
    assert.equal(store.getState().playing, false);
    finishPause(response);
    await playing;
    assert.equal(prepared, false);
    assert.equal(store.getState().playing, false);
    assert.equal(store.getState().onlineMedia.playing, true);
    assert.ok(store.getState().libraryError);
  });
}

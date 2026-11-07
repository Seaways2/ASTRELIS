const assert = require("node:assert/strict");
const test = require("node:test");
const { loadPlayerStore } = require("./helpers/player-store-harness.cjs");

test("choosing the startup page persists without navigation or playback", () => {
  const { store, persisted } = loadPlayerStore();
  store.getState().setActivePage("settings");
  store.getState().setUiSetting("startupPage", "library");
  assert.equal(store.getState().activePage, "settings");
  assert.equal(store.getState().playing, false);
  const reopened = loadPlayerStore({ initialStorage: [...persisted] }).store.getState();
  assert.equal(reopened.activePage, "library");
  assert.equal(reopened.playing, false);
  assert.equal(reopened.currentIndex, -1);
  assert.deepEqual(reopened.tracks, []);
});

test("old or invalid startup preferences open a supported default page", () => {
  for (const value of [undefined, null, "plugins", "invalid", 42, {}]) {
    const { store } = loadPlayerStore({ initialStorage: [
      ["auralis.ui.settings", JSON.stringify({ startupPage: value, glowStrength: 2 })]
    ] });
    assert.equal(store.getState().activePage, "nowPlaying");
    assert.equal(store.getState().uiSettings.glowStrength, 2);
    assert.equal(store.getState().playing, false);
  }
});

test("all offered startup pages restore, while invalid setters cannot navigate", () => {
  for (const page of ["nowPlaying", "playlist", "library", "online"]) {
    const { store, persisted } = loadPlayerStore();
    store.getState().setUiSetting("startupPage", page);
    assert.equal(loadPlayerStore({ initialStorage: [...persisted] }).store.getState().activePage, page);
  }
  const { store } = loadPlayerStore();
  store.getState().setActivePage("settings");
  store.getState().setUiSetting("startupPage", "unknown");
  assert.equal(store.getState().uiSettings.startupPage, "nowPlaying");
  assert.equal(store.getState().activePage, "settings");
});

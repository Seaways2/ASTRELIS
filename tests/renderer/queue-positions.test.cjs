// Where a queue entry starts, what removing/re-adding entries does to the
// current one, cold-start restoring, unplayable entries and series queuing.
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadPlayerStore, makeTrack } = require("./helpers/player-store-harness.cjs");

const prepare = async source => ({ ok: true, url: `prepared:${source}`, path: source });
const music = id => ({ ...makeTrack(id), sourcePath: `C:/${id}.flac`, nativePath: `C:/${id}.flac`, format: "FLAC" });
const video = (id, file = `${id}.mkv`, folder = "C:/Videos") => ({ ...makeTrack(id), name: id, sourcePath: `${folder}/${file}`, format: "MKV", mediaKind: "video" });
const idsOf = tracks => tracks.map(track => track.id);

test("songs chosen or reached by Next/Previous start from the top; only videos keep their place (LA04/P04)", async () => {
  const { store } = loadPlayerStore({ desktop: { library: { prepare } } });
  const s = () => store.getState();
  s().addQueueTracks(["A", "B", "C"].map(music));
  await s().playTrack(0); s().setTiming(150, 300);
  await s().playTrack(1, { navigateToNowPlaying: false });
  assert.equal(s().currentTime, 0);
  s().setTiming(20, 300);
  await s().playTrack(0);
  assert.equal(s().currentTime, 0, "returning to a song that was skipped mid-way starts it again");
  s().setTiming(170, 300);
  const request = s().localPlayRequest;
  await s().playTrack(0);
  assert.equal(s().currentTime, 0, "double-clicking the current song restarts it");
  assert.equal(s().localPlayRequest, request + 1);
  assert.deepEqual(s().queueBookmarks, {}, "songs do not collect bookmarks");

  const videos = loadPlayerStore({ desktop: { library: { prepare } } }).store;
  videos.getState().addQueueTracks([video("v1"), video("v2")]);
  videos.getState().switchQueue("video");
  await videos.getState().playTrack(0); videos.getState().setTiming(65, 500);
  await videos.getState().playTrack(1);
  assert.equal(videos.getState().currentTime, 0);
  await videos.getState().playTrack(0);
  assert.equal(videos.getState().currentTime, 65, "a video continues where it was left");
});

test("a restored entry resumes once; after playback starts, choosing it again restarts it", async () => {
  const saved = { kind: "music", tracks: [music("A"), music("B")], selection: { music: "B" }, bookmarks: { A: 12, B: 42, gone: 99 } };
  const desktop = { library: { prepare, openFiles: async paths => ({ tracks: saved.tracks.filter(track => paths.includes(track.sourcePath)), errors: [] }) },
    queue: { load: async () => saved, save() {} } };
  const { store } = loadPlayerStore({ desktop });
  const s = () => store.getState();
  await s().restoreQueues();
  assert.equal(s().currentTime, 42);
  assert.equal("gone" in s().queueBookmarks, false, "bookmarks of entries no longer queued are dropped");
  await s().playTrack(1);
  assert.equal(s().currentTime, 42, "pressing play on the restored entry resumes it");
  s().setTiming(50, 300);
  await s().playTrack(1);
  assert.equal(s().currentTime, 0);
});

test("removing the playing entry starts the next one from its start as a new request (LA05/P03)", async () => {
  const { store } = loadPlayerStore({ desktop: { library: { prepare } } });
  const s = () => store.getState();
  s().addQueueTracks(["A", "B", "C"].map(music));
  await s().playTrack(0); s().setTiming(185, 200);
  const request = s().localPlayRequest;
  s().removeTrack("A");
  assert.equal(s().tracks[s().currentIndex].id, "B");
  assert.equal(s().currentTime, 0);
  assert.equal(s().duration, 0);
  assert.equal(s().localPlayRequest, request + 1);
  assert.equal(s().playing, true);
  assert.equal(s().queueSelection.music, "B");
  s().setTiming(30, 200);
  s().removeTrack("C");
  assert.equal(s().currentTime, 30, "removing another row leaves the current entry alone");
  s().removeTrack("B");
  assert.equal(s().currentIndex, -1);
  assert.equal(s().playing, false);
  assert.equal(s().currentTime, 0);
});

test("removed and cleared entries leave no bookmark in the saved queue", async () => {
  const saves = [];
  const { store, flush } = loadPlayerStore({ desktop: { library: { prepare }, queue: { load: async () => null, save: snapshot => saves.push(snapshot) } } });
  const s = () => store.getState();
  s().addQueueTracks([music("A"), video("v1"), video("v2")]);
  s().switchQueue("video");
  await s().playTrack(0); s().setTiming(65, 500);
  await s().playTrack(1);
  assert.equal(s().queueBookmarks.v1, 65);
  s().removeTrack("v1");
  flush();
  // A: the music queue's selection, v2: the current video.
  assert.deepEqual(Object.keys(saves.at(-1).bookmarks).sort(), ["A", "v2"]);
  s().clearTracks();
  assert.deepEqual(Object.keys(s().queueBookmarks), ["A"], "clearing the video queue drops its bookmarks only");
});

test("a file opened at a cold start joins the saved queue instead of replacing it (P01)", async () => {
  const saved = { kind: "music", tracks: ["A", "B", "C"].map(music), selection: { music: "B" }, bookmarks: { B: 30 } };
  let releaseLoad;
  const saves = [];
  const external = music("X");
  const desktop = {
    library: { prepare, openFiles: async paths => ({ tracks: [...saved.tracks, external].filter(track => paths.includes(track.sourcePath)), errors: [] }) },
    queue: { load: () => new Promise(resolve => { releaseLoad = resolve; }), save: snapshot => saves.push(snapshot) }
  };
  const h = loadPlayerStore({ desktop });
  const s = () => h.store.getState();
  const restoring = s().restoreQueues();
  await s().openExternalFiles(["C:/X.flac"]);
  assert.equal(s().tracks[s().currentIndex].id, "X");
  assert.equal(s().playing, true);
  h.flush(); h.events.beforeunload();
  assert.equal(saves.length, 0, "nothing is saved over the queue that is still loading");
  releaseLoad(saved);
  await restoring;
  assert.deepEqual(idsOf(s().tracks), ["A", "B", "C", "X"]);
  assert.equal(s().tracks[s().currentIndex].id, "X", "the opened file keeps playing");
  assert.equal(s().playing, true);
  h.flush();
  assert.deepEqual(idsOf(saves.at(-1).tracks), ["A", "B", "C", "X"]);
});

test("a saved queue that fails to load is never saved over in that session (P01)", async () => {
  const saves = [];
  const desktop = {
    library: { prepare, openFiles: async () => { throw new Error("IPC unavailable"); } },
    queue: { load: async () => ({ kind: "music", tracks: ["A", "B"].map(music), selection: {}, bookmarks: {} }), save: snapshot => saves.push(snapshot) }
  };
  const h = loadPlayerStore({ desktop });
  const s = () => h.store.getState();
  const originalError = console.error;
  console.error = () => {};
  try {
    const restoring = s().restoreQueues();
    await s().openExternalFiles(["C:/X.flac"]).catch(() => undefined);
    await restoring;
  } finally { console.error = originalError; }
  s().addQueueTracks([music("Y")]);
  h.flush(); h.events.beforeunload();
  assert.equal(saves.length, 0, "the queue on disk is kept");
});

test("re-adding a queued track keeps its decoded source; a missing one takes the new copy (P02)", () => {
  const { store } = loadPlayerStore();
  const s = () => store.getState();
  const library = ["A", "B", "M"].map(id => ({ ...makeTrack(id), nativePath: undefined }));
  store.setState({ libraryTracks: library, currentIndex: 0, playing: true, tracks: [
    { ...makeTrack("A"), url: "auralis-media://local/cache/A.ape.wav", nativePath: "cache/A.ape.wav" },
    { ...makeTrack("M"), url: "auralis-media://local/old/M", missing: true }
  ] });
  s().enqueueLibraryTracks(["A", "B", "M"]);
  const [a, m, b] = s().tracks;
  assert.deepEqual([a.id, m.id, b.id], ["A", "M", "B"]);
  assert.equal(a.url, "auralis-media://local/cache/A.ape.wav");
  assert.equal(a.nativePath, "cache/A.ape.wav");
  assert.equal(m.missing, undefined);
  assert.equal(m.url, "auralis-media://local/M");
  assert.equal(s().playing, true);
});

test("an unplayable entry is skipped only within the request's budget, so broken queues stop (LA06)", async () => {
  const { store } = loadPlayerStore({ desktop: { library: { prepare } } });
  const s = () => store.getState();
  s().addQueueTracks(["A", "B", "C"].map(music));
  await s().playTrack(0, { navigateToNowPlaying: false, skipMissing: 3 });
  const visited = [s().tracks[s().currentIndex].id];
  for (let attempt = 0; attempt < 10 && s().skipUnplayableTrack(); attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    visited.push(s().tracks[s().currentIndex].id);
  }
  assert.deepEqual(visited, ["A", "B", "C", "A"]);
  assert.equal(s().playing, false);

  await s().playTrack(1);
  assert.equal(s().skipUnplayableTrack(), false, "a track the user chose is not skipped past");
  assert.equal(s().tracks[s().currentIndex].id, "B");
  assert.equal(s().playing, false);

  s().cycleRepeat(); s().cycleRepeat(); // all -> one -> off
  await s().playTrack(2, { skipMissing: 3 });
  assert.equal(s().skipUnplayableTrack(), false, "with repeat off the end of the queue stops");
});

test("playing an episode queues the rest of its season in order after it (LV08)", async () => {
  const { store } = loadPlayerStore({ desktop: { library: { prepare } } });
  const s = () => store.getState();
  const season = "C:/Shows/Show/Season 1";
  const episodes = ["E01", "E02", "E03", "E10"].map(id => video(id, `Show.S01${id}.1080p.mkv`, season));
  const film = video("film", "Some Film (2019).mkv", "C:/Movies");
  const other = video("other", "Other Film (2020).mkv", "C:/Movies");
  store.setState({ libraryTracks: [episodes[3], film, episodes[1], other, episodes[0], episodes[2], video("extra", "Show.S01E05.mkv", `${season}/Extras`)] });
  s().addQueueTracks([episodes[2], film]);
  await s().enqueueLibraryTrack("E01", true);
  assert.equal(s().queueKind, "video");
  assert.deepEqual(idsOf(s().tracks), ["film", "E01", "E02", "E03", "E10"]);
  assert.equal(s().tracks[s().currentIndex].id, "E01");
  assert.equal(s().playing, true);

  await s().enqueueLibraryTrack("other", true);
  assert.deepEqual(idsOf(s().tracks), ["film", "E01", "E02", "E03", "E10", "other"], "a film is queued alone");
  assert.equal(s().tracks[s().currentIndex].id, "other");
});

test("only episodes of the same series form a run in a mixed folder (LV08)", async () => {
  const { store } = loadPlayerStore({ desktop: { library: { prepare } } });
  const s = () => store.getState();
  const folder = "C:/Downloads";
  store.setState({ libraryTracks: [
    video("bb1", "Breaking.Bad.S01E01.mkv", folder), video("ch1", "Chernobyl.S01E01.mkv", folder),
    video("bb2", "Breaking.Bad.S01E02.mkv", folder), video("dark", "Dark.S02E03.mkv", folder),
    video("bb10", "breaking.bad.S01E10.mkv", folder), video("bbc", "Breaking.Bad.Commentary.S01E03.mkv", folder)
  ] });
  await s().enqueueLibraryTrack("bb1", true);
  assert.deepEqual(idsOf(s().tracks), ["bb1", "bb2", "bb10"]);
});

test("an automatic advance stops when the next track cannot be prepared; a chosen one only reports (LA02 regression)", async () => {
  const { store } = loadPlayerStore({ desktop: { library: {
    prepare: async source => source.endsWith("/B.flac") ? { ok: false, error: "decode failed" } : source.endsWith("/C.flac") ? Promise.reject(new Error("IPC")) : prepare(source)
  } } });
  const s = () => store.getState();
  s().addQueueTracks(["A", "B", "C", "D"].map(music));
  await s().playTrack(0);
  // A ended: App's handleLocalEnded asks for B with the queue as skip budget.
  await s().playTrack(1, { navigateToNowPlaying: false, skipMissing: 4 });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(s().tracks[s().currentIndex].id, "D", "B (decode failure) and C (error) are skipped");
  assert.equal(s().playing, true);

  s().cycleRepeat(); s().cycleRepeat(); // all -> one -> off
  await s().playTrack(0);
  await s().playTrack(1, { navigateToNowPlaying: false, skipMissing: 1 });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(s().playing, false, "with the budget spent, playback stops instead of silent \"playing\"");
  assert.equal(s().tracks[s().currentIndex].id, "A");

  await s().playTrack(0);
  await s().playTrack(1);
  assert.equal(s().playing, true, "a failing track the user picked leaves the current one playing");
  assert.equal(s().libraryError, "decode failed");
});

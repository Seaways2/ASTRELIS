const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("other output selection updates Web Audio and YouTube together", () => {
  const engine = read("src/audio/AudioEngine.ts");
  const app = read("src/App.tsx");
  assert.match(engine, /enumerateDevices\(\)/);
  assert.match(engine, /setSinkId/);
  assert.match(app, /audioEngine\.setOutput\(id\)/);
  assert.match(app, /browser\.setOutput/);
});

test("Web fallback maps the logical default output to Chromium's default sink", () => {
  const engine = read("src/audio/AudioEngine.ts");
  assert.match(engine, /deviceId === "default" \? "" : deviceId/);
  assert.match(engine, /setSinkId\(sinkId\)/);
});

test("stable online routes cannot enter Native capture while local guards remain", () => {
  const app = read("src/App.tsx");
  assert.doesNotMatch(app, /onlineRecoveryPending|neteaseRecoveryPending|onlineNativeGeneration/);
  assert.doesNotMatch(app, /neteaseCaptureDesired|type: "online-start"|type: "stream-start"/);
  assert.match(app, /localBackendGeneration/);
  assert.match(app, /routeSource: "local"/);
});

test("stable renderer does not subscribe to or start the experimental online Native path", () => {
  const app = read("src/App.tsx");
  const store = read("src/stores/playerStore.ts");
  const dictionary = read("src/i18n/index.ts");

  assert.doesNotMatch(app, /nativeAudio\.onSafetyFallback|type: "online-start"|type: "stream-start"/);
  assert.match(store, /youtubeVstLabEnabled:\s*false/);
  assert.match(store, /youtubeProcessLoopbackEnabled:\s*false/);
  assert.match(store, /key === "youtubeVstLabEnabled" \|\| key === "youtubeProcessLoopbackEnabled"[\s\S]{0,80}\? false/);
  assert.equal((dictionary.match(/"settings\.onlineStableMode"/g) || []).length, 3);
  assert.equal((dictionary.match(/"vst\.onlineWebDirect"/g) || []).length, 3);
});

test("a stale Native status reply cannot reclaim visualization after a backend handoff", () => {
  const app = read("src/App.tsx");
  assert.match(app, /let nativeStatusCancelled = false/);
  assert.match(app, /cancelled: nativeStatusCancelled, ready: localNativeReady.current/);
  assert.match(app, /return \(\) => \{\s*nativeStatusCancelled = true;\s*window\.clearInterval\(timer\)/);
  assert.match(app, /if \(!statusStillCurrent\(\)\) return;/);
});

test("device page separates requested Native intent from actual state", () => {
  const page = read("src/components/WorkspacePage.tsx");
  assert.match(page, /t\("device\.guideTitle"\)/);
  assert.match(page, /native-output-overview/);
  assert.match(page, /nativeSelectedKey/);
  assert.match(page, /selectedNativeDevice/);
  assert.match(page, /device-apply/);
  assert.match(page, /result\.actual/);
  assert.match(page, /result\.degraded/);
});

test("Native playback never inherits the Web fallback output selection", () => {
  const app = read("src/App.tsx");
  const page = read("src/components/WorkspacePage.tsx");
  assert.match(app, /selectedOutputLabelRef/,
    "the chosen endpoint label must survive a temporary enumerateDevices gap");
  assert.match(page, /chromium-device-setting/,
    "the separate Web fallback selector must remain available");
  assert.doesNotMatch(app, /nativeAudio\.command\(\{ type: "output"/,
    "Web fallback selection must not issue Native output commands during selection or track changes");
  assert.match(app, /outputFallbackTimerRef[\s\S]*audioEngine\.listOutputs\(\)[\s\S]*2500/,
    "a missing endpoint must be confirmed by a delayed fresh enumeration");
  assert.doesNotMatch(app, /else if \(!available\)[\s\S]{0,120}selectDevice\("default"\)/,
    "one transient device list must not immediately overwrite the selected output");
});

test("built-in audio path is dry except for Fade", () => {
  const engine = read("src/audio/AudioEngine.ts");
  const store = read("src/stores/playerStore.ts");
  for (const removed of ["createBiquadFilter", "createDynamicsCompressor", "createStereoPanner", "setCrossfade", "setEqualizer"]) {
    assert.doesNotMatch(engine, new RegExp(removed));
  }
  for (const removed of ["eqGains", "preampDb", "balance", "loudness", "limiter", "crossfadeMs"]) {
    assert.doesNotMatch(store, new RegExp(removed));
  }
  assert.match(engine, /setFade\(durationMs/);
  assert.match(engine, /source\.connect\(this\.deckGains\[index\]\)\.connect\(this\.transitionGain/);
});

test("manual local track changes fade out before replacing the source", () => {
  const engine = read("src/audio/AudioEngine.ts");
  const app = read("src/App.tsx");
  assert.match(engine, /async pause\(\)[\s\S]*linearRampToValueAtTime\(0[\s\S]*await new Promise<void>/,
    "Web fallback pause must be awaitable through the configured fade-out");
  assert.match(app, /const switchingTrack = Boolean/);
  assert.match(app, /await fadeOutPreviousTrack\(\);[\s\S]{0,900}audioEngine\.load\(current\.url\)/,
    "Web fallback must finish the old-track fade before loading the new source");
  assert.match(app, /type: "pause"[\s\S]{0,400}waitForAudioTransition\(effectiveFadeMs\)/,
    "Native playback must be allowed to finish its existing pause ramp before load");
  assert.match(app, /completedLocalPlaybackToken/,
    "natural completion must not add a redundant fade delay before the next track");
});

test("VST processing switch does not disable the Native output route", () => {
  const app = read("src/App.tsx");
  const vstStore = read("src/stores/vstRackStore.ts");
  assert.match(app, /uiSettings\.nativeOutputEnabled && nativeReadable/);
  assert.match(vstStore, /type: "rack", plugins: \[\]/);
  assert.doesNotMatch(vstStore, /type: "enable"/);
});

test("device page groups native configuration and status before the unified other output", () => {
  const page = read("src/components/WorkspacePage.tsx");
  assert.match(page, /WASAPI Shared/);
  assert.match(page, /Shared Low Latency/);
  assert.match(page, /WASAPI Exclusive/);
  assert.match(page, /device\.outputDevice/);
  assert.match(page, /device\.otherSettings/);
  assert.match(page, /device\.applyConfiguration/);
  const outputConfigIndex = page.indexOf("unified-output-config");
  const webFallbackIndex = page.indexOf("chromium-device-setting");
  const explanationIndex = page.indexOf("native-output-overview");
  assert.ok(outputConfigIndex < webFallbackIndex && explanationIndex < webFallbackIndex, "native configuration and explanation precede ordinary outputs");
  assert.ok(page.indexOf('native-overview-status') < webFallbackIndex);
  assert.doesNotMatch(page, /youtube-output-device/);
  assert.match(page, /web-output-device/);
  assert.doesNotMatch(page, /nativeDevices\.filter\(device => device\.backend !== "directsound-legacy"\)\.map/);
});

test("new output and appearance controls have complete zh-CN, en-US and ja-JP copy", () => {
  const page = read("src/components/WorkspacePage.tsx");
  const dictionary = read("src/i18n/index.ts") + read("src/i18n/currentFeatures.ts") + read("src/i18n/directOutput.ts");
  const keys = [...new Set([...page.matchAll(/"((?:device|appearance)\.[A-Za-z0-9]+)"/g)].map(match => match[1]))];
  for (const key of keys) {
    assert.equal((dictionary.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length, 3, `${key} must exist in all three dictionaries`);
  }
});

test("local favorites persist by stable file path and stay independent from the queue", () => {
  const store = read("src/stores/playerStore.ts");
  assert.match(store, /auralis\.library\.favorites\.v1/);
  assert.match(store, /favoriteTrackKey/);
  assert.match(store, /track\.sourcePath/);
  assert.match(store, /toggleFavoriteTrack/);
  assert.match(store, /favoriteTrackKeys: storedFavoriteTrackKeys/);
  assert.doesNotMatch(store, /clearTracks:[\s\S]{0,500}favoriteTrackKeys:\s*\[\]/);
});

test("favorites are available from both the music library and playlist with complete translations", () => {
  const library = read("src/components/MusicLibrary.tsx");
  const playlist = read("src/components/PlaylistTable.tsx");
  const dictionary = read("src/i18n/index.ts");
  assert.match(library, /"收藏"/);
  assert.match(library, /library\.favorites/);
  assert.match(library, /state\.toggleFavoriteTrack\(track\)/);
  assert.match(playlist, /state\.toggleFavoriteTrack\(track\)/);
  for (const key of ["library.favorites", "library.favorite", "library.unfavorite", "library.removeTrack", "library.noFavorites", "library.noFavoritesHint"]) {
    assert.equal((dictionary.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length, 3, `${key} must exist in all three dictionaries`);
  }
});

test("favorite view supports per-track selection, select all and duplicate-safe queue insertion", () => {
  const library = read("src/components/MusicLibrary.tsx");
  const dictionary = read("src/i18n/index.ts");
  assert.match(library, /selectedFavoriteIds/);
  assert.match(library, /toggleAllFilteredFavorites/);
  assert.match(library, /allFilteredFavoritesSelected/);
  assert.match(library, /enqueueSelectedFavorites/);
  assert.match(library, /enqueueTracksWithFeedback\(ids\)/);
  assert.match(library, /queuedTrackIds\.has\(id\)/);
  for (const key of ["library.selectTrack", "library.selectAll", "library.selectedCount", "library.addSelected"]) {
    assert.equal((dictionary.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length, 3, `${key} must exist in all three dictionaries`);
  }
});

test("music library offers persistent flow, card and details views with sorting", () => {
  const library = read("src/components/MusicLibrary.tsx");
  const styles = read("src/styles/global.css");
  const dictionary = read("src/i18n/index.ts");
  for (const view of ["flow", "cards", "details"]) {
    assert.match(library, new RegExp(`id: "${view}"`));
  }
  for (const styledView of ["large", "cards", "details"]) assert.match(styles, new RegExp(`library-view-${styledView}`));
  assert.doesNotMatch(library, /id: "list"/);
  assert.doesNotMatch(styles, /library-view-list/);
  assert.match(dictionary, /library\.viewList/);
  assert.match(library, /auralis\.library\.view/);
  assert.match(library, /stored === "list"/);
  assert.match(library, /auralis\.library\.sort/);
  assert.match(library, /auralis\.library\.sortAscending/);
  assert.match(library, /viewModel\.trackPage\(pageOffset, remaining\)/);
  assert.match(library, /entriesAt\(pageOffset, pageRemaining\)/);
  assert.match(library, /useVirtualLibraryGrid\(totalListItems/);
  assert.match(styles, /\.library-virtual-row/);
  assert.match(library, /library-detail-head/);
  for (const key of ["library.viewMode", "library.viewLarge", "library.viewCards", "library.viewDetails", "library.sortBy", "library.sortTitle", "library.sortArtist", "library.sortAlbum", "library.sortFormat", "library.sortSize", "library.sortAscending", "library.sortDescending", "library.cover", "library.item", "library.info", "library.summary", "library.type", "library.countSize", "library.actions", "library.open"]) {
    assert.equal((dictionary.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length, 3, `${key} must exist in all three dictionaries`);
  }
});

test("folders, categories and tracks share the same structure in every library view", () => {
  const library = read("src/components/MusicLibrary.tsx");
  const styles = read("src/styles/global.css");
  for (const entry of ["library-folder-entry", "library-category-entry", "library-track-entry"]) assert.match(library, new RegExp(entry));
  for (const field of ["library-entry-media", "library-entry-title", "library-entry-primary", "library-entry-secondary", "library-entry-type", "library-entry-size", "library-entry-actions"]) assert.ok((library.match(new RegExp(field, "g")) || []).length >= 3, `${field} must be shared by all entry types`);
  assert.match(styles, /\.library-view-cards \.library-entry \{ height: 132px/);
  assert.match(styles, /\.library-view-large \.library-entry \{ height: 350px/);
  assert.match(styles, /\.library-detail-head, \.library-view-details \.library-entry/);
});

test("VST entry points require Native output and share one non-automatic guide guard", () => {
  const store = read("src/stores/playerStore.ts");
  const app = read("src/App.tsx");
  const channel = read("src/components/ChannelStripPopover.tsx");
  const page = read("src/components/WorkspacePage.tsx");
  const styles = read("src/styles/global.css");
  const dictionary = read("src/i18n/index.ts");

  assert.match(store, /requestNativeOutputForVst:[\s\S]*uiSettings\.nativeOutputEnabled[\s\S]*activePage: "devices"[\s\S]*nativeOutputGuideRequest/);
  const guard = store.match(/requestNativeOutputForVst: \(\) => \{([\s\S]*?)\r?\n  \},\r?\n  setAccent/);
  assert.ok(guard, "shared VST access guard must exist");
  assert.doesNotMatch(guard[1], /setUiSetting|nativeOutputEnabled:\s*true/, "the guard must never silently enable Native output");
  assert.match(app, /id === "plugins" && !state\.requestNativeOutputForVst\(\)/);
  assert.match(app, /vstAccessAvailable=\{!videoActive && !onlineDirectSource && state\.uiSettings\.nativeOutputEnabled\}/);
  assert.match(channel, /channel-inserts.*native-output-required/);
  assert.match(channel, /onClickCapture/);
  assert.match(channel, /onRequestVstAccess/);
  assert.match(page, /nativeOutputGuideRef/);
  assert.match(page, /if \(state\.uiSettings\.nativeOutputEnabled\)[\s\S]*setNativeOutputGuideVisible\(false\)[\s\S]*return;/,
    "an already-enabled Native output must not auto-scroll the device page");
  assert.doesNotMatch(page, /page !== "devices" \|\| state\.nativeOutputGuideRequest < 1/,
    "ordinary device-page entry must be able to guide users when Native output is off");
  assert.doesNotMatch(page, /scrollIntoView/,
    "Native output guidance must never scroll the application root viewport");
  assert.match(page, /closest<HTMLElement>\("\.page-content"\)[\s\S]*pageScroller\.scrollTo/,
    "Native output guidance must stay inside the device-page scroller");
  assert.match(page, /window\.scrollTo\(\{ left: 0, top: 0, behavior: "auto" \}\)/,
    "the custom titlebar must be restored if an older build scrolled the root viewport");
  assert.match(page, /native-output-vst-guide/);
  assert.match(styles, /native-output-overview\.vst-guide-active/);
  assert.match(styles, /channel-native-output-guide/);
  for (const key of ["vst.nativeOutputRequiredTitle", "vst.nativeOutputRequiredChannelHint", "vst.nativeOutputRequiredGuideHint"]) {
    assert.equal((dictionary.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length, 3, `${key} must exist in all three dictionaries`);
  }
});

test("startup silently restores the unified Web Audio and YouTube output", () => {
  const app = read("src/App.tsx");
  assert.match(app, /browser\.setOutput/);
  assert.match(app, /selectDevice\(deviceId, \{ silent: true \}\)/,
    "automatic startup restoration must not surface a transient routing toast");
});

test("native output controls reject rapid repeated switching", () => {
  const page = read("src/components/WorkspacePage.tsx");
  const dictionary = read("src/i18n/index.ts");
  assert.match(page, /nativeApplyBusyRef/);
  assert.match(page, /nativeSelectionBusyRef/);
  assert.match(page, /nativeToggleBusyRef/);
  assert.match(page, /nativeControlsBusy/);
  assert.match(page, /handleNativeOutputToggle/);
  assert.match(page, /disabled=\{nativeControlsBusy\}/);
  assert.equal((dictionary.match(/"device\.switching"/g) || []).length, 3);
});

test("a completed track can advance the playlist only once per playback generation", () => {
  const source = read("src/utils/playbackEndLatch.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const loaded = { exports: {} };
  Function("exports", "module", output)(loaded.exports, loaded);
  const { PlaybackEndLatch, nativeStatusCompletesTrack, nextQueueIndex } = loaded.exports;
  const latch = new PlaybackEndLatch();
  assert.equal(Array.from({ length: 100 }, () => latch.claim("track-a:7")).filter(Boolean).length, 1);
  assert.equal(latch.claim("track-b:8"), true);
  latch.release("track-a:7");
  assert.equal(latch.claim("track-b:8"), false, "a stale release must not unlock the current track");
  latch.release("track-b:8");
  assert.equal(latch.claim("track-b:8"), true);
  assert.equal(nextQueueIndex(5, 2, false), 3);
  for (const random of [0, .2, .5, .999999]) assert.notEqual(nextQueueIndex(5, 2, true, () => random), 2);
  assert.equal(nativeStatusCompletesTrack({ position: 200, duration: 200, playbackToken: "track-a:7" }, "track-b:8", true), false,
    "the outgoing native status must not finish the incoming track");
  assert.equal(nativeStatusCompletesTrack({ position: 200, duration: 200, playbackToken: "track-b:8" }, "track-b:8", false), false,
    "the incoming backend must finish loading before completion is accepted");
  assert.equal(nativeStatusCompletesTrack({ position: 200, duration: 200, playbackToken: "track-b:8" }, "track-b:8", true), true);
  assert.equal(nativeStatusCompletesTrack({ position: 200, duration: 200 }, "track-b:8", true), true,
    "older matching hosts remain compatible after the backend-ready barrier");

  const app = read("src/App.tsx");
  assert.match(app, /handleLocalEnded/);
  assert.match(app, /expectedToken !== token/);
  assert.match(app, /latestTrack\.id.*latest\.localPlayRequest/);
  assert.match(app, /playbackBackend\.current\.native/);
  assert.match(app, /playbackToken/);
  assert.match(app, /backendReadyForTrack/);
  assert.match(app, /type: "seek", position: 0/);
});

test("rescanning the library never erases previously known artwork", () => {
  const source = read("src/utils/libraryCoverMerge.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const loaded = { exports: {} };
  Function("exports", "module", output)(loaded.exports, loaded);
  const { preserveScannedArtwork } = loaded.exports;
  const previous = [
    { id: "one", sourcePath: "K:\\Music\\One.flac", coverUrl: "cached-one" },
    { id: "old-id", sourcePath: "K:\\Music\\Two.flac", coverUrl: "cached-two" }
  ];
  const scanned = [
    { id: "one", sourcePath: "K:\\Music\\One.flac" },
    { id: "new-id", sourcePath: "k:\\music\\two.flac" },
    { id: "three", sourcePath: "K:\\Music\\Three.flac", coverUrl: "fresh-three" }
  ];
  assert.deepEqual(preserveScannedArtwork(scanned, previous).map(track => track.coverUrl), [
    "cached-one", "cached-two", "fresh-three"
  ]);

  const store = read("src/stores/playerStore.ts");
  const reconciler = read("electron/library/reconcile/LibraryReconciler.ts");
  assert.match(reconciler, /coverUrl: previous\.coverUrl \|\| clean\.coverUrl/);
  assert.match(reconciler, /!clean\.coverUrl && previous\.coverUrl/);
  assert.ok((store.match(/mergeScannedLibrary\(result\.tracks as Array<Track/g) || []).length >= 2);
});

test("library rescans remove overlapping roots and preserve metadata on read failure", () => {
  const source = read("src/utils/libraryCoverMerge.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const loaded = { exports: {} };
  Function("exports", "module", output)(loaded.exports, loaded);
  const { mergeScannedLibrary, sanitizeLibraryFolders } = loaded.exports;
  assert.deepEqual(sanitizeLibraryFolders(["K:\\music\\HIFI", "K:\\music", "k:/music/"]), ["K:\\music"]);

  const previous = [{
    id: "one", sourcePath: "K:\\music\\one.flac", name: "Known title", artist: "Known artist",
    album: "Known album", genre: "Known genre", year: 2024, duration: 180, coverUrl: "cached-cover",
    url: "old", format: "FLAC", size: 10
  }];
  const failedScan = {
    id: "one", sourcePath: "K:\\music\\one.flac", name: "one", artist: "未知艺术家",
    album: "未分类专辑", metadataRead: false, url: "new", format: "FLAC", size: 11
  };
  const result = mergeScannedLibrary([failedScan, { ...failedScan }], previous);
  assert.equal(result.length, 1, "the same path from overlapping roots must be deduplicated");
  assert.deepEqual({ name: result[0].name, artist: result[0].artist, album: result[0].album, coverUrl: result[0].coverUrl }, {
    name: "Known title", artist: "Known artist", album: "Known album", coverUrl: "cached-cover"
  });
  assert.equal("metadataRead" in result[0], false, "scan-only state must not leak into the persisted library");

  const store = read("src/stores/playerStore.ts");
  const reconciler = read("electron/library/reconcile/LibraryReconciler.ts");
  assert.match(store, /sanitizeLibraryFolders\(get\(\)\.libraryFolders\)/);
  assert.match(store, /window\.desktop\.library\.rescan\(folders/);
  assert.match(reconciler, /sanitizeLibraryRoots\(requestedRoots\)/);
  assert.match(reconciler, /metadataRead === false/);
});

test("category search cannot expose an unrelated artist for bulk queue insertion", () => {
  const source = read("src/utils/libraryCategorySearch.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const loaded = { exports: {} };
  Function("exports", "module", output)(loaded.exports, loaded);
  const { categoryMatchesSearch } = loaded.exports;
  assert.equal(categoryMatchesSearch("周杰伦", "周杰伦"), true);
  assert.equal(categoryMatchesSearch("周杰伦 & 陈建州", "周杰伦"), true);
  assert.equal(categoryMatchesSearch("林俊杰", "周杰伦"), false,
    "a track title or album match must not expose an unrelated artist bulk action");

  const library = read("src/components/MusicLibrary.tsx");
  const queryService = read("src/library/LibraryQueryService.ts");
  assert.match(library, /viewModel\.categoryPage\(pageOffset, remaining\)/);
  assert.match(queryService, /group\.searchText = normalize\(\[group\.name, \.\.\.group\.artists\]\.join\(" "\)\)/,
    "album search text may include its artists when the derived index is built");
  assert.match(queryService, /this\.artistGroups\.values\(\)\) group\.searchText = normalize\(group\.name\)/,
    "artist search must remain limited to the artist category name");
  assert.doesNotMatch(library, /group\.matches = `\$\{category\} \$\{track\.name\}/);
  assert.match(library, /enqueueTracksWithFeedback\(group\.ids\)/);
});

test("VST status cannot report ON while Native output is disabled", () => {
  const app = read("src/App.tsx");
  const styles = read("src/styles/global.css");
  assert.match(app, /vstControlNativeRequired = Boolean\(!onlineDirectSource && vstControlRequested && !state\.uiSettings\.nativeOutputEnabled\)/);
  assert.match(app, /!videoActive && !hdmiDirect && !onlineDirectSource && vstControlRequested && state\.uiSettings\.nativeOutputEnabled/);
  assert.match(app, /vstControlNativeRequired[\s\S]*?"VST · NATIVE OFF"/);
  assert.match(app, /vstControlActive \? "vst\.processingOn" : "vst\.processingOff"/);
  assert.match(app, /vstControlNativeRequired \? "native-required"/);
  assert.match(styles, /titlebar-vst-mode\.native-required/);
});

test("YouTube and NetEase always use unfaded Web Direct without changing the local Native preference", () => {
  const app = read("src/App.tsx");
  const page = read("src/components/WorkspacePage.tsx");
  assert.match(app, /const onlineDirectSource = onlinePlaybackSession \|\| neteaseOnlineSource/);
  assert.match(app, /hdmiDirect = state\.uiSettings\.hdmiDirectEnabled && !onlineDirectSource/);
  assert.match(app, /state\.uiSettings\.nativeOutputEnabled && nativeReadable && !onlineDirectSource/);
  assert.doesNotMatch(app, /setUiSetting\("nativeOutputEnabled", false\)/,
    "online playback must not overwrite the saved local Native preference");
  assert.doesNotMatch(app, /type: "online-start"|type: "stream-start"/);
  assert.doesNotMatch(app, /browser\.fade/);
  assert.match(app, /browser\.mediaAction\("pause"\)/);
  assert.match(app, /current\?\.format === "NETEASE" \? 0 : state\.fadeMs/);
  assert.match(app, /const routeSessionId = localRouteSession\.current/,
    "the outgoing local Native session must survive readiness being cleared by render effects");
  assert.doesNotMatch(app, /if \(!nativeWasReady\) return;/,
    "cleared readiness must not skip pausing an audible native session");
  assert.doesNotMatch(page, /youtubeDirectNativeLocked|youtubeVstLabGuideRef|settings\.youtubeVstLab/);
  assert.match(page, /disabled=\{nativeControlsBusy\}/,
    "the local Native preference remains independently configurable");
});

test("stable online mode keeps all local Native and VST entry points", () => {
  const store = read("src/stores/playerStore.ts");
  const page = read("src/components/WorkspacePage.tsx");
  const dictionary = read("src/i18n/index.ts");
  assert.match(store, /nativeOutputEnabled:\s*stored\.nativeOutputEnabled === true/);
  assert.match(page, /if \(page === "plugins"\)[\s\S]{0,180}<VstRack/);
  assert.match(page, /t\("device\.guideTitle"\)/);
  assert.match(page, /checked=\{state\.uiSettings\.nativeOutputEnabled \|\| state\.uiSettings\.hdmiDirectEnabled\}/);
  assert.match(page, /<SystemSettings \/>/);
  assert.match(read("src/components/SystemSettings.tsx"), /state\.setFadeMs/,
    "local playback fade remains available");
  assert.equal((dictionary.match(/"settings\.onlineStableModeHint"/g) || []).length, 3);
});

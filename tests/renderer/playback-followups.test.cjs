// Renderer follow-ups of the test report: a lost native host or output device
// (A01/A02), a video that failed to open (LV02), unplayable sources (LA06),
// .wv/.tta (LL13), scan failure reports (LL01/B03), drive and junction roots
// (B01/B03), a queue that failed to restore (P01/S03) and plug-in rack refusals (S05).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { readAppSource } = require("./helpers/appSource.cjs");
const { loadPlayerStore, makeTrack } = require("./helpers/player-store-harness.cjs");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loadModule = (file, globals = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(transpile(read(file)), { exports: module.exports, module, require, ...globals });
  return module.exports;
};
const i18nCache = {};
function loadI18n(name = "index", language = "zh-CN") {
  const key = `${name}:${language}`;
  if (i18nCache[key]) return i18nCache[key];
  const module = { exports: {} };
  vm.runInNewContext(transpile(read(`src/i18n/${name}.ts`)), {
    exports: module.exports, module,
    require: id => id === "react" ? {} : loadI18n(id.replace("./", ""), language),
    localStorage: { getItem: () => language, setItem() {} }, navigator: { language }, document: { documentElement: {} }, window: { addEventListener() {} }
  });
  return i18nCache[key] = module.exports;
}
const translator = language => loadI18n("index", language);
const music = id => ({ ...makeTrack(id), sourcePath: `C:/${id}.flac`, nativePath: `C:/${id}.flac`, format: "FLAC" });
const prepare = async source => ({ ok: true, url: `prepared:${source}`, path: source });

test("a lost host, a missing device and a substitute device are told apart (A01/A02)", () => {
  const notice = loadModule("src/utils/nativeEngineNotice.ts");
  const t = (key, values = {}) => `${key}${Object.keys(values).length ? JSON.stringify(values) : ""}`;
  const lost = { ok: false, error: "NATIVE_ENGINE_LOST: exit 3221225477", engineLost: true, engineLossCount: 1, suspectPlugins: ["fx1"] };
  assert.equal(notice.isNativeEngineLost(lost), true);
  assert.equal(notice.isNativeEngineLost({ ok: true, deferred: true, engineLost: true }), false, "a deferred pause did not fail");
  assert.equal(notice.isNativeEngineLost({ ok: false, error: "LOAD_FAILED" }), false);
  assert.equal(notice.isNativeEngineLost(Object.assign(new Error("NATIVE_ENGINE_LOST: crash"), { nativeReply: lost })), true);
  assert.equal(notice.isNativeEngineLost(new Error("NATIVE_ENGINE_LOST: crash")), true);
  assert.equal(notice.isNativeEngineLost(new Error("原生播放失败")), false);

  const name = id => ({ fx1: "Crashy EQ", fx2: "Comp" })[id] || id;
  assert.equal(notice.nativeEngineLostNotice(t, lost, name), "native.engineLost", "one loss names no plug-in");
  assert.equal(notice.nativeEngineLostNotice(t, { ...lost, engineLossCount: 2, suspectPlugins: ["fx1", "fx2", "fx1", 7] }, name),
    'native.engineLostPlugins{"count":2,"plugins":"Crashy EQ, Comp"}');
  assert.equal(notice.nativeEngineLostNotice(t, { ...lost, engineLossCount: 3, suspectPlugins: [] }, name), "native.engineLost");
  assert.equal(notice.nativeEngineLostNotice(t, undefined, name), "native.engineLost");

  assert.equal(notice.nativeOutputNotice(t, { ok: true }), null);
  assert.equal(notice.nativeOutputNotice(t, lost), null, "only a working backend reports its output");
  assert.deepEqual({ ...notice.nativeOutputNotice(t, { ok: true, outputDegraded: true, outputState: "no-device", outputError: "NATIVE_OUTPUT_DEVICE_LOST" }) },
    { id: "device-lost", text: "native.outputDeviceLost", persistent: true });
  assert.equal(notice.nativeOutputNotice(t, { ok: true, outputDegraded: true, outputState: "stalled", outputError: "NATIVE_OUTPUT_STALLED" }).id, "stalled");
  const fallback = notice.nativeOutputNotice(t, { ok: true, outputDegraded: true, outputState: "fallback-device", outputDevice: "Realtek", expectedOutputDevice: "TV (HDMI)" });
  assert.equal(fallback.persistent, false);
  assert.equal(fallback.text, 'native.outputFallback{"expected":"TV (HDMI)","device":"Realtek"}');
  assert.notEqual(fallback.id, notice.nativeOutputNotice(t, { ok: true, outputDegraded: true, outputState: "fallback-device", outputDevice: "Speakers", expectedOutputDevice: "TV (HDMI)" }).id);
  assert.equal(notice.nativeOutputNotice(t, { ok: true, outputDegraded: true, outputState: "fallback-device", outputDevice: "Realtek" }).text,
    'native.outputFallbackUnnamed{"device":"Realtek"}');

  for (const language of ["zh-CN", "en-US", "ja-JP"]) {
    const { translate } = translator(language);
    for (const key of ["native.engineLost", "native.outputDeviceLost", "native.outputStalled", "native.outputNotice"])
      assert.ok(translate(key) !== key && translate(key).trim(), `${language} ${key}`);
    assert.match(translate("native.engineLostPlugins", { count: 2, plugins: "Crashy EQ" }), /Crashy EQ/);
    assert.match(translate("native.outputFallback", { expected: "TV", device: "Realtek" }), /TV[\s\S]*Realtek/);
  }
});

test("App stops on a lost host once, reloads on Play and never treats a missing device as a lost backend (A01/A02)", () => {
  const app = readAppSource();
  const poll = app.slice(app.indexOf("const status = await window.desktop?.nativeAudio.command({ type: \"status\""), app.indexOf("if (analysisNeeded) audioEngine.setNativeAnalysis(status);"));
  assert.ok(poll.indexOf("isNativeEngineLost(status)") >= 0 && poll.indexOf("isNativeEngineLost(status)") < poll.indexOf("markNativeUnavailable"),
    "a lost host is reported before the generic failure path");
  assert.match(poll, /if \(isNativeEngineLost\(status\)\) \{\s*if \(hdmiDirect\) setDirectOutputLabel\(""\);\s*reportNativeEngineLost\(statusTrackToken, status\);\s*return;\s*\}/);
  // Main answers every later status of a lost direct (HDMI) host the same
  // way: the HDMI branch would stop and re-show its notice on every poll.
  assert.ok(poll.indexOf("isNativeEngineLost(status)") < poll.indexOf("if (hdmiDirect) {"), "a lost host is reported before the HDMI branch");
  const outputBranch = poll.slice(poll.indexOf("const output = nativeOutputNotice(t, status);"));
  assert.ok(outputBranch.length > 0);
  assert.doesNotMatch(outputBranch, /markNativeUnavailable|setPlaying\(false\)/, "a missing device keeps the backend and its play state");
  assert.match(outputBranch, /if \(\(output\?\.id \|\| ""\) !== outputNoticeId\.current\)/, "a notice is shown once per condition");

  const report = app.slice(app.indexOf("const reportNativeEngineLost = useCallback("), app.indexOf("const handleNativePlayFailure = useCallback("));
  assert.match(report, /localNativeReady\.current = false;/, "the poll stops and transport no longer addresses the dead host");
  // The lost request is recorded before a pending choice defers the stop, so
  // Play reloads it when that choice fails and leaves it current.
  assert.ok(report.indexOf("nativeEngineLostToken.current = token;") >= 0
    && report.indexOf("nativeEngineLostToken.current = token;") < report.indexOf("hasPendingPlay()"));
  assert.match(report, /if \(usePlayerStore\.getState\(\)\.hasPendingPlay\(\)\) \{[\s\S]*?window\.setTimeout\(settle, 250\);\s*return;\s*\}\s*usePlayerStore\.getState\(\)\.setPlaying\(false\);/,
    "setPlaying(false) would cancel the pending choice: the stop waits for it");
  assert.match(report, /if \(nativeEngineLostNoticeToken\.current === token\) return;\s*nativeEngineLostNoticeToken\.current = token;/, "the notice is shown once per request");
  // Play on the lost request loads it again as a new request.
  assert.match(app, /if \(nativeEngineLostToken\.current === playToken\) usePlayerStore\.getState\(\)\.reloadCurrentTrack\(\);/);
  assert.match(app, /else if \(failedNativeLoadToken\.current === playToken\) \{\s*state\.setPlaying\(false\);/);
  // {ok:false} from "play" is a failed start that carries its reply.
  assert.match(app, /if \(!result\?\.ok\) throw Object\.assign\(new Error\(result\?\.error \|\| "原生播放失败"\), \{ nativeReply: result \}\);/);
  assert.match(app, /\}\)\(\)\.catch\(error => handleNativePlayFailure\(playToken, error\)\);/);
  assert.match(app, /<Volume2 \/><div><b>\{t\("native\.outputNotice"\)\}<\/b><span>\{outputNotice\.text\}<\/span>/);
});

test("a native source that cannot be loaded skips on auto-advance and is reported again on Play (LA06)", () => {
  const app = readAppSource();
  const failure = app.slice(app.indexOf("if (!loaded?.ok) {"), app.indexOf("if (resumePosition > 0) await window.desktop?.nativeAudio.command({ type: \"seek\""));
  assert.match(failure, /failedNativeLoadToken\.current = playbackToken;/);
  // A pending choice replaces the source: setPlaying(false) would cancel it.
  assert.match(failure, /if \(live\.hasPendingPlay\(\)\) \{ live\.setPlaybackObserved\(false\); return; \}/);
  assert.ok(failure.indexOf("live.hasPendingPlay()") < failure.indexOf("live.setPlaying(false)"));
  assert.match(failure, /const skipped = live\.playing && live\.skipUnplayableTrack\(\);/);
  assert.match(failure, /if \(!skipped\) live\.setPlaying\(false\);/);
});

test("Play after a video failed to open opens it again; its error text has one prefix (LV02)", () => {
  const app = readAppSource();
  assert.doesNotMatch(app, /setDeviceError\(String\(error\)\)/);
  assert.match(app, /videoOpenFailedToken\.current = token;\s*state\.setPlaying\(false\);/);
  assert.match(app, /\.replace\(\/\^\(\?:Error:\\s\*\)\+\/, ""\)/);
  // Reopened as a new request from the same position: playTrack of the
  // current entry would start from the top and drop its bookmark.
  // (An open that threw and a failure the player reported are handled alike;
  // see video-load-failure.test.cjs.)
  const reopen = app.slice(app.indexOf("if (state.playing && !videoPreparing && (openFailed || playerFailed)"), app.indexOf("if (state.onlineMedia?.playing) {"));
  assert.match(app, /const openFailed = videoOpenFailedToken\.current === token;/);
  assert.match(reopen, /^if \(state\.playing && !videoPreparing && \(openFailed \|\| playerFailed\) && !state\.hasPendingPlay\(\)\) \{\s*if \(startedVideo\) \{\s*videoOpenFailedToken\.current = "";[\s\S]*?state\.reloadCurrentTrack\(\);/);
  assert.doesNotMatch(reopen, /playTrack\(/);
  // Once String(error) of "Error: x" read "Error: Error: x".
  assert.equal(`${new Error("Error: x")}`, "Error: Error: x");
  assert.equal("Error: Error: x".replace(/^(?:Error:\s*)+/, ""), "x");
});

test("reloading the current entry is a new play request from the same position", async () => {
  const { store } = loadPlayerStore({ desktop: { library: { prepare } } });
  const s = () => store.getState();
  s().reloadCurrentTrack();
  assert.equal(s().localPlayRequest, 0, "nothing to reload");
  s().addQueueTracks(["A", "B"].map(music));
  await s().playTrack(1); s().setTiming(73, 200);
  const request = s().localPlayRequest;
  s().reloadCurrentTrack();
  assert.equal(s().localPlayRequest, request + 1);
  assert.equal(s().tracks[s().currentIndex].id, "B");
  assert.equal(s().currentTime, 73);
  assert.equal(s().playing, true);
  // Choosing the current entry again starts it from the top (why LV02 and
  // a lost host reload instead).
  await s().playTrack(s().currentIndex);
  assert.equal(s().currentTime, 0);
});

test(".wv and .tta are imported and prepared like the other decoded formats (LL13)", async () => {
  const { exports } = loadPlayerStore();
  for (const name of ["a.wv", "b.TTA", "c.flac", "d.aiff", "e.eac3"]) assert.match(name, exports.AUDIO_FILE_PATTERN, name);
  for (const name of ["a.mp4", "b.txt", "c.wvx"]) assert.doesNotMatch(name, exports.AUDIO_FILE_PATTERN, name);
  for (const name of ["a.ape", "b.dsf", "c.wma", "d.dts", "e.ac3", "f.eac3", "g.wv", "h.tta", "i.aiff", "j.aif"]) assert.match(name, exports.WEB_DECODED_AUDIO_PATTERN, name);
  for (const name of ["a.flac", "b.mp3", "c.wav"]) assert.doesNotMatch(name, exports.WEB_DECODED_AUDIO_PATTERN, name);
  // The lists match the main process: what it scans, and what prepare decodes.
  const formats = read("electron/library/media/audioFormats.ts");
  const audio = formats.slice(formats.indexOf("AUDIO_EXTENSIONS"), formats.indexOf("]);"));
  for (const extension of audio.match(/\.[a-z0-9]+/g)) assert.match(`x${extension}`, exports.AUDIO_FILE_PATTERN, extension);
  const main = read("electron/main.ts");
  const decoded = main.match(/const ffmpegDecodedExtensions = \[([^\]]+)\]/)[1].match(/\.[a-z0-9]+/g);
  for (const extension of decoded) assert.match(`x${extension}`, exports.WEB_DECODED_AUDIO_PATTERN, extension);
  assert.match(read("src/App.tsx"), /\.eac3,\.wv,\.tta" hidden/);

  const prepared = [];
  const harness = loadPlayerStore({ desktop: { library: { prepare: async source => { prepared.push([source, harness.store.getState().libraryError]); return { ok: true, url: `wav:${source}`, path: `${source}.wav` }; } } } });
  harness.store.getState().addQueueTracks([{ ...music("W"), sourcePath: "C:/W.wv", nativePath: undefined, format: "WV" }]);
  await harness.store.getState().playTrack(0);
  assert.deepEqual(prepared, [["C:/W.wv", "正在准备 HiFi 音源…"]]);
});

test("scan failures are reported by kind and in the selected language (LL01/B03)", () => {
  const { exports } = loadPlayerStore();
  const message = exports.libraryScanMessage;
  const complete = { rootId: "r", path: "D:\\Music", status: "complete", scannedFiles: 3, skippedFiles: 0, unreadableDirectories: [] };
  assert.equal(message({ roots: [complete], failures: [] }), "");
  const failures = [
    { stage: "stat", path: "D:\\Music\\empty.mp3", code: "EMPTY_FILE", message: "" },
    { stage: "stat", path: "D:\\Music\\zero.flac", code: "EMPTY_FILE", message: "" },
    { stage: "metadata", path: "D:\\Music\\garbage.flac", code: "NO_AUDIO_STREAM", message: "" },
    { stage: "metadata", path: "D:\\Music\\odd.mp3", code: "UNKNOWN", message: "" }
  ];
  assert.equal(message({ roots: [{ ...complete, skippedFiles: 2 }], failures }),
    "2 个文件无法读取或是空文件，已跳过；1 个文件没有可读取的音频内容，可能已损坏；1 个文件的标签未能完整读取，旧分类信息已尽量保留");
  // A root that is partial only because a junction leads out of the library.
  const link = { stage: "directory", path: "D:\\Music\\Elsewhere", code: "ELINKOUTSIDE", message: "" };
  const linked = { ...complete, status: "partial", skippedFiles: 1, unreadableDirectories: ["D:\\Music\\Elsewhere"] };
  assert.equal(message({ roots: [linked], failures: [link] }), "1 个链接指向媒体库之外，已跳过");
  // Plus an unreadable folder: that root did not finish.
  const denied = { stage: "directory", path: "D:\\Music\\Locked", code: "EPERM", message: "" };
  assert.equal(message({ roots: [{ ...linked, unreadableDirectories: ["D:\\Music\\Elsewhere", "D:\\Music\\Locked"] }], failures: [link, denied] }),
    "1 个音乐目录未完整扫描，旧曲目已安全保留；1 个链接指向媒体库之外，已跳过");
  // Plus an unreadable file (stat error, not an empty file).
  assert.match(message({ roots: [linked], failures: [link, { stage: "stat", path: "D:\\Music\\a.mp3", code: "EBUSY", message: "" }] }), /^1 个音乐目录未完整扫描/);
  assert.equal(message({ roots: [{ ...complete, status: "offline" }], failures: [{ stage: "root", path: "D:\\Music", code: "ENOENT", message: "" }] }),
    "1 个音乐目录未完整扫描，旧曲目已安全保留");

  const combined = message({ roots: [{ ...linked, unreadableDirectories: ["D:\\Music\\Elsewhere", "D:\\Music\\Locked"] }], failures: [link, denied, ...failures] });
  for (const language of ["en-US", "ja-JP"]) {
    const translated = translator(language).translateMessage(combined);
    assert.doesNotMatch(translated, /[个已旧]/, `${language}: ${translated}`);
    for (const count of ["1", "2"]) assert.ok(translated.includes(count), `${language} keeps the counts`);
  }
  assert.equal(translator("en-US").translateMessage("1 个链接指向媒体库之外，已跳过"), "1 links point outside the media library and were skipped");
  assert.equal(translator("zh-CN").translateMessage(combined), combined);
  assert.equal(translator("en-US").translateMessage("未知；文本"), "未知；文本", "unknown parts are left alone");
});

test("drive roots keep their separator and junction sub-roots are not folded away (B01/B03)", () => {
  const { sanitizeLibraryFolders, libraryFolderPath } = loadModule("src/utils/libraryCoverMerge.ts");
  assert.equal(libraryFolderPath("E:"), "E:\\");
  assert.equal(libraryFolderPath("e:/"), "e:\\");
  assert.equal(libraryFolderPath("D:\\Music\\"), "D:\\Music");
  // The snapshot of a library with a junction kept as its own root.
  assert.deepEqual([...sanitizeLibraryFolders(["D:\\Music", "D:\\Music\\Classical", "E:\\", "d:/music/"])], ["D:\\Music", "D:\\Music\\Classical", "E:\\"]);
  const store = read("src/stores/playerStore.ts");
  assert.match(store, /const libraryFolders = sanitizeLibraryFolders\(Array\.isArray\(library\.folders\) \? library\.folders : \[\]\);/);
  assert.match(store, /const folders = sanitizeLibraryFolders\(get\(\)\.libraryFolders\);/);
});

test("a saved queue that fails to load is kept until the playlist is changed on purpose (P01/S03)", async () => {
  for (const failure of ["load", "openFiles"]) {
    const saves = [];
    const desktop = {
      library: { prepare, openFiles: async paths => {
        if (failure === "openFiles" && paths.length > 1) throw new Error("LIBRARY_INVALID_SCHEMA");
        return { tracks: paths.map(file => music(path.basename(file, ".flac"))).map(track => ({ ...track, sourcePath: `C:/${track.id}.flac` })), errors: [] };
      } },
      queue: { load: async () => { if (failure === "load") throw new Error("queue file unreadable"); return { kind: "music", tracks: ["A", "B"].map(music), selection: {}, bookmarks: {} }; },
        save: snapshot => saves.push(snapshot) }
    };
    const h = loadPlayerStore({ desktop });
    const s = () => h.store.getState();
    h.store.setState({ libraryTracks: [music("L")] });
    const originalError = console.error;
    console.error = () => {};
    let restored;
    try {
      const restoring = s().restoreQueues();
      await s().openExternalFiles(["C:/X.flac"]);
      restored = await restoring;
    } finally { console.error = originalError; }
    assert.equal(restored, false, `${failure}: App shows the notice when restoring reports a failure`);
    assert.equal(s().tracks[s().currentIndex].id, "X", "the opened file plays");
    h.flush(); h.events.beforeunload();
    assert.equal(saves.length, 0, `${failure}: the queue file is not replaced by the opened file`);
    await s().enqueueLibraryTrack("L");
    h.flush();
    assert.deepEqual(saves.at(-1).tracks.map(track => track.id), ["X", "L"], `${failure}: a deliberate change is saved`);
  }
  for (const language of ["en-US", "ja-JP"])
    assert.doesNotMatch(translator(language).translateMessage("上次的播放队列未能恢复，原队列文件已保留；调整播放列表之后才会保存新的队列"), /[队恢]/);
  assert.match(readAppSource(), /restoreQueues\(\)\.then\(restored => \{ if \(!restored\) setDeviceError\(t\("queue\.restoreFailed"\)\); \}\)/);
  // Nothing saved yet is no failure.
  const fresh = loadPlayerStore({ desktop: { library: { prepare }, queue: { load: async () => null, save() {} } } });
  assert.equal(await fresh.store.getState().restoreQueues(), true);
});

function loadVstStore(command, scan, vst = {}) {
  const storage = new Map([["auralis.vst.enabled", "false"]]);
  const module = { exports: {} };
  const calls = { scans: [], racks: 0, editors: 0 };
  vm.runInNewContext(transpile(read("src/stores/vstRackStore.ts")), {
    exports: module.exports, module, require, CustomEvent: class {},
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { clearTimeout() {}, setTimeout() { return 0; }, dispatchEvent() {},
      desktop: {
        nativeAudio: { command: async request => { if (request.type === "rack") calls.racks++; return command(request, calls); } },
        vst: { scan: async retry => { calls.scans.push(retry); return scan(); },
          ...(vst.openEditor ? { openEditor: async (...args) => { calls.editors++; return vst.openEditor(calls, ...args); } } : {}) }
      } }
  });
  return { store: module.exports.useVstRackStore, calls };
}
const emptyCatalog = () => ({ modules: [], descriptors: [], directories: [], quarantines: [], session: null });

test("a rack refused as not scanned is rescanned once and applied again; refusals read as messages (S05)", async () => {
  // The module changed since its scan: one rescan brings the cache up to date.
  const healed = loadVstStore((request, calls) => calls.racks === 1 ? { ok: false, error: "PLUGIN_NOT_SCANNED" } : { ok: true }, emptyCatalog);
  await healed.store.getState().toggleNativeEngine();
  // A changed module misses the scan cache anyway; quarantined modules (that
  // crashed or hung the scanner) are retried only on the user's Rescan.
  assert.deepEqual(healed.calls.scans, [false], "one rescan that leaves quarantined modules alone");
  assert.equal(healed.calls.racks, 2, "the rack is applied again");
  assert.equal(healed.store.getState().runtimeReady, true);
  assert.equal(healed.store.getState().error, "");

  const refused = loadVstStore(() => ({ ok: false, error: "PLUGIN_NOT_SCANNED" }), emptyCatalog);
  await refused.store.getState().toggleNativeEngine();
  assert.deepEqual(refused.calls.scans, [false], "never more than one rescan");
  assert.equal(refused.calls.racks, 2);
  assert.equal(refused.store.getState().runtimeReady, false);
  assert.equal(refused.store.getState().error, "该插件尚未通过扫描，请先重新扫描插件");

  for (const [code, text] of [["PLUGIN_DISABLED", "该插件已被停用或隔离，请在插件列表中恢复后再使用"], ["INVALID_PLUGIN_RACK", "插件机架配置无效"],
    ["PLUGIN_PATH_INVALID", "插件路径无效，已拒绝加载"], ["PLUGIN_FORMAT_UNAVAILABLE", "该插件格式尚未提供可用的原生运行适配器"], ["constructor", "constructor"]]) {
    const rejected = loadVstStore(() => ({ ok: false, error: code }), emptyCatalog);
    await rejected.store.getState().toggleNativeEngine();
    assert.deepEqual(rejected.calls.scans, [], `${code}: no rescan`);
    assert.equal(rejected.store.getState().error, text, code);
  }
  // The standalone editor (Native off) and removing a plug-in read main's
  // refusals as messages too; the editor gets the same single rescan.
  const rackItem = { id: "p1", formatSpecificPluginId: "fx1", stablePluginUid: "u1", moduleFingerprint: "m1", path: "C:/fx.vst3", name: "FX", enabled: true };
  for (const [code, text] of [["PLUGIN_DISABLED", "该插件已被停用或隔离，请在插件列表中恢复后再使用"], ["PLUGIN_PATH_INVALID", "插件路径无效，已拒绝加载"]]) {
    const editor = loadVstStore(() => ({ ok: true }), emptyCatalog, { openEditor: () => ({ ok: false, error: code }) });
    await editor.store.getState().openEditor(rackItem);
    assert.equal(editor.store.getState().error, text, `editor ${code}`);
    assert.deepEqual(editor.calls.scans, [], `editor ${code}: no rescan`);

    const removal = loadVstStore(request => request.type === "state-remove" ? { ok: false, error: code } : { ok: true }, emptyCatalog);
    removal.store.setState({ rack: [rackItem] });
    await removal.store.getState().removeFromRack("p1", false);
    assert.equal(removal.store.getState().error, text, `remove ${code}`);
  }
  // Main sends PLUGIN_NOT_SCANNED for the editor as its text already.
  const unscanned = loadVstStore(() => ({ ok: true }), emptyCatalog,
    { openEditor: calls => calls.editors === 1 ? { ok: false, error: "该插件尚未通过扫描，请先重新扫描插件" } : { ok: true } });
  await unscanned.store.getState().openEditor(rackItem);
  assert.deepEqual(unscanned.calls.scans, [false]);
  assert.equal(unscanned.calls.editors, 2, "opened again after the rescan");
  assert.equal(unscanned.store.getState().error, "");
  const stillUnscanned = loadVstStore(() => ({ ok: true }), emptyCatalog, { openEditor: () => ({ ok: false, error: "PLUGIN_NOT_SCANNED" }) });
  await stillUnscanned.store.getState().openEditor(rackItem);
  assert.deepEqual(stillUnscanned.calls.scans, [false]);
  assert.equal(stillUnscanned.calls.editors, 2);
  assert.equal(stillUnscanned.store.getState().error, "该插件尚未通过扫描，请先重新扫描插件");

  // Every source text has a translation, and the views show them translated.
  for (const language of ["en-US", "ja-JP"]) {
    const { translateMessage } = translator(language);
    for (const text of ["该插件尚未加载到实时处理链", "该插件尚未通过扫描，请先重新扫描插件", "该插件已被停用或隔离，请在插件列表中恢复后再使用", "插件机架配置无效",
      "插件路径无效，已拒绝加载", "该插件格式尚未提供可用的原生运行适配器", "视频插件机架配置无效", "插件链加载失败"])
      assert.notEqual(translateMessage(text), text, `${language}: ${text}`);
  }
  assert.match(read("src/components/VstRack.tsx"), /<span>\{tm\(vst\.error\)\}<\/span>/);
  assert.match(read("src/components/ChannelStripPopover.tsx"), /<span>\{tm\(vst\.error\)\}<\/span>/);
});

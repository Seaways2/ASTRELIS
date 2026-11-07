const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");
function loadPlayerStore({ desktop, parseBlob = async () => ({ common: {} }), initialStorage = [] } = {}) {
  const persisted = new Map(initialStorage);
  const revoked = [];
  let savedCallback = () => {};
  const events = {};
  let objectId = 0;
  const localStorage = {
    getItem: key => persisted.get(key) ?? null,
    setItem: (key, value) => persisted.set(key, value),
    removeItem: key => persisted.delete(key)
  };
  const URL = { createObjectURL: () => `blob:test-${++objectId}`, revokeObjectURL: value => revoked.push(value) };
  const source = fs.readFileSync(path.join(root, "src/stores/playerStore.ts"), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  const helper = { exports: {} };
  Function("exports", "module", ts.transpileModule(fs.readFileSync(path.join(root, "src/utils/videoTrack.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText)(helper.exports, helper);
  if (desktop?.library && !desktop.library.visibility) desktop.library.visibility = async () => ({ok:true,configured:false,unlocked:false,roots:[]});
  const visibilityUtils = { exports: {} }, visibility = { exports: {} };
  Function("exports", ts.transpileModule(fs.readFileSync(path.join(root,"src/utils/folderVisibility.ts"),"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(visibilityUtils.exports);
  Function("exports","require","window",ts.transpileModule(fs.readFileSync(path.join(root,"src/stores/folderVisibilityStore.ts"),"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(visibility.exports, name => name === "../utils/folderVisibility" ? visibilityUtils.exports : require(name), {desktop});
  visibility.exports.applyVisibility({});
  const requireModule = name => name === "./folderVisibilityStore" ? visibility.exports : name === "../utils/videoTrack" ? helper.exports : name === "music-metadata" ? { parseBlob }
    : name.includes("libraryCoverMerge") ? { mergeScannedLibrary: tracks => tracks, sanitizeLibraryFolders: folders => folders }
    : require(name);
  Function("exports", "module", "require", "localStorage", "window", "URL", javascript)(
    module.exports, module, requireModule, localStorage, { desktop, clearTimeout() {}, setTimeout(fn) { savedCallback = fn; return 1; }, addEventListener(name, fn) { events[name] = fn; } }, URL);
  return { store: module.exports.usePlayerStore, persisted, revoked, flush: () => savedCallback(), events };
}
const makeTrack = id => ({
  id, name: id, artist: "Artist", album: "Album", format: "APE", size: 100,
  sourcePath: `${id}.ape`, nativePath: `${id}.ape`, url: `auralis-media://local/${id}`
});
function pendingPlayback() {
  const pending = new Map();
  const { store } = loadPlayerStore({ desktop: { library: {
    prepare: source => new Promise((resolve, reject) => pending.set(source, { resolve, reject }))
  } } });
  const finish = id => pending.get(`${id}.ape`).resolve({ ok: true, url: `prepared-${id}`, path: `${id}.wav` });
  return { store, pending, finish };
}
module.exports = { loadPlayerStore, makeTrack, pendingPlayback };

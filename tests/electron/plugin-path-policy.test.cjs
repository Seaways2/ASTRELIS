// S05: plugin paths named by a renderer reach the unsandboxed native host only
// when the scanner already accepted that exact module.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ScannedPluginPolicy, isUncOrDevicePath } = require("../../dist-electron/security/PluginPathPolicy");
const { PluginScanCache, PluginQuarantineStore } = require("../../dist-electron/pluginScanPersistence");
const { createPluginModule } = require("../../dist-electron/pluginDomain");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-plugin-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cachePath = path.join(directory, "plugin-scan-cache-v1.json"), quarantinePath = path.join(directory, "plugin-quarantine-v1.json");
  const scanned = path.join(directory, "Scanned.vst3"), unscanned = path.join(directory, "Dropped.vst3");
  fs.writeFileSync(scanned, "scanned module"); fs.writeFileSync(unscanned, "attacker module");
  const stat = fs.statSync(scanned);
  const module = createPluginModule(scanned, stat.size, stat.mtimeMs);
  const cache = new PluginScanCache(cachePath);
  cache.putSuccessfulModule(module, [{ id: "plugin-a" }], []);
  cache.save();
  return { directory, cachePath, quarantinePath, scanned, unscanned, module,
    policy: new ScannedPluginPolicy(() => cachePath, () => quarantinePath) };
}

test("only scanned, unchanged, enabled VST3 modules may be loaded", t => {
  const f = fixture(t);
  assert.equal(f.policy.check(f.scanned), undefined);
  assert.equal(f.policy.check(f.scanned.toUpperCase()), undefined, "Windows paths compare case-insensitively");
  assert.equal(f.policy.check(f.unscanned), "PLUGIN_NOT_SCANNED");
  assert.equal(f.policy.check(path.join(f.directory, "missing.vst3")), "PLUGIN_NOT_SCANNED");
  assert.equal(f.policy.check("relative\\x.vst3"), "PLUGIN_PATH_INVALID");
  assert.equal(f.policy.check("\\\\attacker\\share\\x.vst3"), "PLUGIN_PATH_INVALID");
  assert.equal(f.policy.check("//attacker/share/x.vst3"), "PLUGIN_PATH_INVALID");
  assert.equal(f.policy.check("\\\\?\\UNC\\attacker\\share\\x.vst3"), "PLUGIN_PATH_INVALID");
  assert.equal(f.policy.check(path.join(f.directory, "x.dll")), "PLUGIN_FORMAT_UNAVAILABLE");
  assert.equal(f.policy.check(42), "PLUGIN_PATH_INVALID");
  // The module changed on disk after the scan: it must be scanned again.
  fs.writeFileSync(f.scanned, "replaced with a different, longer module");
  assert.equal(f.policy.check(f.scanned), "PLUGIN_NOT_SCANNED");
});

test("a disabled or quarantined module is refused even with a cache entry", t => {
  const f = fixture(t);
  const quarantine = new PluginQuarantineStore(f.quarantinePath);
  quarantine.disable(f.module, { code: "USER_DISABLED", stage: "MODULE_LOAD", modulePath: f.scanned, message: "", elapsedMs: 0 });
  assert.equal(f.policy.check(f.scanned), "PLUGIN_DISABLED");
});

test("rack payloads are checked as a whole", t => {
  const f = fixture(t);
  const entry = { id: "plugin-a", path: f.scanned, enabled: true };
  assert.equal(f.policy.checkRack([]), undefined);
  assert.equal(f.policy.checkRack([entry]), undefined);
  assert.equal(f.policy.checkRack([entry, { id: "b", path: f.unscanned, enabled: true }]), "PLUGIN_NOT_SCANNED");
  // The native host skips disabled entries (PlaybackEngine::loadRack); a stale one must not block the rack.
  assert.equal(f.policy.checkRack([entry, { id: "b", path: f.unscanned, enabled: false }]), undefined);
  assert.equal(f.policy.checkRack([entry, { id: "c", path: path.join(f.directory, "Uninstalled.vst3"), enabled: false }]), undefined);
  assert.equal(f.policy.checkRack([entry, { id: "plugin-a", path: f.unscanned, enabled: false }]), "INVALID_PLUGIN_RACK", "ids stay distinct");
  const native = fs.readFileSync(path.resolve(__dirname, "../../native-host/src/PlaybackEngine.cpp"), "utf8");
  assert.match(native, /if \(object == nullptr \|\| !static_cast<bool>\(object->getProperty\("enabled"\)\)\) continue;/,
    "the exemption relies on loadRack skipping disabled entries");
  assert.equal(f.policy.checkRack([entry, entry]), "INVALID_PLUGIN_RACK");
  assert.equal(f.policy.checkRack([{ ...entry, enabled: "yes" }]), "INVALID_PLUGIN_RACK");
  assert.equal(f.policy.checkRack(Array.from({ length: 33 }, (_, index) => ({ ...entry, id: `p${index}` }))), "INVALID_PLUGIN_RACK");
  assert.equal(f.policy.checkRack("[]"), "INVALID_PLUGIN_RACK");
  assert.equal(f.policy.checkRack(null), "INVALID_PLUGIN_RACK");
});

test("the legacy plugin-folder import is a one-time migration, not a way around the folder dialog", t => {
  const { LegacyDirectoryImportGate } = require("../../dist-electron/security/LegacyDirectoryImportGate");
  const { PluginDirectoryStore } = require("../../dist-electron/pluginDirectories");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-plugin-import-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storeFile = path.join(directory, "plugin-directories-v1.json");
  // First launch with a store: one import, then closed.
  const first = new LegacyDirectoryImportGate(storeFile);
  assert.equal(first.take(), true);
  assert.equal(first.take(), false, "a second call in the same process is refused");
  const store = new PluginDirectoryStore(storeFile, []);
  store.importUserDirectories([path.join(directory, "Legacy")]);
  // The renderer reads the directory list after its migration; nothing more is imported after that.
  const unused = new LegacyDirectoryImportGate(path.join(directory, "missing.json"));
  unused.close();
  assert.equal(unused.take(), false);
  // Every later launch finds the store file and refuses the import.
  assert.equal(new LegacyDirectoryImportGate(storeFile).take(), false);
  const ipc = fs.readFileSync(path.resolve(__dirname, "../../electron/ipc/vstPluginIpc.ts"), "utf8");
  assert.match(ipc, /if \(!trusted\(event\) \|\| !legacyImport\.take\(\)\) return getPluginDirectoryStore\(\)\.list\(\);/);
  assert.match(ipc, /new LegacyDirectoryImportGate\(path\.join\(app\.getPath\("userData"\), "plugin-directories-v1\.json"\)\)/);
  const service = fs.readFileSync(path.resolve(__dirname, "../../electron/pluginScanService.ts"), "utf8");
  assert.match(service, /path\.join\(app\.getPath\("userData"\), "plugin-directories-v1\.json"\)/, "the gate checks the store's own file");
});

test("UNC and device paths are recognised", () => {
  for (const value of ["\\\\server\\share", "//server/share", "\\\\?\\C:\\x.vst3", "\\\\.\\PhysicalDrive0"]) assert.equal(isUncOrDevicePath(value), true, value);
  for (const value of ["C:\\VST3\\x.vst3", "D:/plugins", "\\single\\leading"]) assert.equal(isUncOrDevicePath(value), false, value);
});

test("every renderer route to the native host goes through the policy and checks the sender", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "../../electron/main.ts"), "utf8");
  const editor = main.slice(main.indexOf('ipcMain.handle("vst:open-editor"'), main.indexOf("const handleNativeAudioCommand"));
  assert.match(editor, /if \(!trustedCacheRequest\(event\)\) return \{ ok: false, error: "UNTRUSTED_SENDER" \};/);
  assert.match(editor, /pluginPolicy\.check\(pluginPath\)/);
  assert.ok(editor.indexOf("pluginPolicy.check(pluginPath)") < editor.indexOf("spawn("));
  const command = main.slice(main.indexOf("const handleNativeAudioCommand"), main.indexOf('ipcMain.handle("audio-route:claim"'));
  assert.match(command, /command\.type === "rack" \|\| \(command\.type === "state-remove" && command\.plugins !== undefined\)/);
  assert.match(command, /pluginPolicy\.checkRack\(command\.plugins\)/);
  assert.match(command, /ipcMain\.handle\("native-audio:command", \(event, command[^)]*\) => \{\s*\/\/[^\n]*\n\s*if \(!trustedCacheRequest\(event\)\)/);
  const videoOpen = main.slice(main.indexOf('ipcMain.handle("video:open"'), main.indexOf('ipcMain.on("video:bounds"'));
  assert.match(videoOpen, /pluginPolicy\.checkRack\(rackPlugins\)/);
  const videoControl = main.slice(main.indexOf('ipcMain.handle("video:control"'), main.indexOf('ipcMain.handle("video:subtitle"'));
  assert.match(videoControl, /pluginPolicy\.checkRack\(plugins\)/);
  assert.doesNotMatch(main, /path\.isAbsolute\(plugin\.path\)/, "absolute-path checks alone are gone");
  const ipc = fs.readFileSync(path.resolve(__dirname, "../../electron/ipc/vstPluginIpc.ts"), "utf8");
  for (const channel of ["vst:scan", "vst:scan-control", "vst:quarantine-reset", "vst:directory-import", "vst:directory-add", "vst:directory-remove", "vst:directory-enabled", "vst:choose-folder"]) {
    const start = ipc.indexOf(`ipcMain.handle("${channel}"`);
    assert.ok(start > 0, channel);
    assert.match(ipc.slice(start, ipc.indexOf("ipcMain.handle(", start + 10) > 0 ? ipc.indexOf("ipcMain.handle(", start + 10) : undefined), /trusted\(event\)/, channel);
  }
  // A directory can only be added after the user picked it in the folder dialog.
  assert.match(ipc, /!chosenDirectories\.delete\(directoryKey\(directoryPath\)\)/);
  assert.match(ipc, /if \(chosen\) chosenDirectories\.add\(directoryKey\(chosen\)\);/);
});

// Source-text assertions about the Electron main process used to read only
// electron/main.ts. Code has since been split into focused modules, so this
// helper returns main.ts followed by every module it was split into.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const mainProcessModules = [
  "electron/main.ts",
  "electron/externalOpenPaths.ts",
  "electron/nativeHttpStream.ts",
  "electron/mediaUrls.ts",
  "electron/mediaProtocols.ts",
  "electron/pluginScanService.ts",
  "electron/nativePlaybackEngine.ts",
  "electron/ipc/appearanceIpc.ts",
  "electron/ipc/audioCacheIpc.ts",
  "electron/ipc/libraryIpc.ts",
  "electron/ipc/mediaMetadataIpc.ts",
  "electron/ipc/neteaseIpc.ts",
  "electron/ipc/vstPluginIpc.ts"
];

function readMainProcessSource() {
  return mainProcessModules.map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
}

module.exports = { mainProcessModules, readMainProcessSource };

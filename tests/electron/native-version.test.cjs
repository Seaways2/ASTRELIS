const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "auralis-version.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const compatibility = require(path.join(root, "dist-electron/nativeHostCompatibility.js"));

test("package and shared manifest application versions match", () => {
  assert.equal(pkg.version, manifest.appVersion);
  assert.match(manifest.nativeHostVersion, /^\d+\.\d+\.\d+$/,
    "the independently synchronized Native host version must remain explicit");
});

test("CMake regenerates Native file metadata when the shared manifest changes", () => {
  const cmake = fs.readFileSync(path.join(root, "native-host/CMakeLists.txt"), "utf8");
  assert.match(cmake, /CMAKE_CONFIGURE_DEPENDS/);
  assert.match(cmake, /AURALIS_VERSION_MANIFEST/);
});

test("matching native build is accepted", () => {
  assert.equal(compatibility.nativeHostCompatibilityError(manifest, {
    nativeHostVersion: manifest.nativeHostVersion,
    controlProtocolVersion: manifest.controlProtocolVersion,
    pcmProtocolVersion: manifest.pcmProtocolVersion
  }), null);
});

test("old host and protocol mismatches are rejected", () => {
  assert.match(compatibility.nativeHostCompatibilityError(manifest, {
    nativeHostVersion: "2.3.4",
    controlProtocolVersion: manifest.controlProtocolVersion,
    pcmProtocolVersion: manifest.pcmProtocolVersion
  }), /NATIVE_HOST_VERSION_MISMATCH/);
  assert.match(compatibility.nativeHostCompatibilityError(manifest, {
    nativeHostVersion: manifest.nativeHostVersion,
    controlProtocolVersion: 0,
    pcmProtocolVersion: manifest.pcmProtocolVersion
  }), /NATIVE_CONTROL_PROTOCOL_MISMATCH/);
});

test("development host path no longer points at build-2.2.7", () => {
  const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
  assert.doesNotMatch(main, /native-host\/build-2\.2\.7\/AuralisPluginHost_artefacts/);
  assert.match(main, /native-host\/build\/AuralisPluginHost_artefacts/);
});

test("native output commands use correlated requests, generations, and persisted LKG", () => {
  const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
  const persistence = fs.readFileSync(path.join(root, "electron/nativeOutputPersistence.ts"), "utf8");
  assert.match(main, /const playbackRequests = new Map/);
  assert.match(main, /protocolVersion: manifest\.controlProtocolVersion/);
  assert.match(main, /requestId/);
  assert.match(main, /nativeOutputGeneration/);
  assert.match(persistence, /native-output-v1\.json/);
  assert.match(main, /ensureNativeOutputRestored/);
  assert.match(main, /responseRecord\.lastKnownGood/);
});

test("native host restart is single-instance and process-scoped", () => {
  const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
  assert.match(main, /new SingleProcessGate/);
  assert.match(main, /request\.engine !== engine/);
  assert.match(main, /rejectPlaybackRequestsForEngine/);
  assert.match(main, /clearIfCurrent\(engine\)/);
  assert.match(main, /await waitForPlaybackEngineExit\(engine, 1200\)/);
  assert.match(main, /"taskkill", \["\/PID", String\(processId\), "\/T", "\/F"\]/);
  assert.match(main, /type === "device-apply"\) return 20000/);
  assert.doesNotMatch(main, /playbackRequests\.clear\(\)/);
});

test("tray icon has a packaged asset and an executable fallback", () => {
  const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
  assert.equal(fs.existsSync(path.join(root, "build/icon.png")), true);
  assert.match(main, /resolveAppIconPath/);
  assert.match(main, /nativeImage\.createFromPath/);
  assert.match(main, /app\.getFileIcon\(process\.execPath/);
  assert.match(main, /Tray ready/);
  assert.match(main, /Tray creation failed/);
});

test("library scan and hydration recover artwork from the persistent cache", () => {
  const main = fs.readFileSync(path.join(root, "electron/main.ts"), "utf8");
  const scanner = fs.readFileSync(path.join(root, "electron/library/scanner/LibraryScanner.ts"), "utf8");
  assert.match(main, /function cachedArtworkUrl\(sourcePath: string\)/);
  assert.match(main, /return legacyArtworkUrl\(sourcePath/);
  assert.match(scanner, /return legacyArtworkUrl\(sourcePath/);
  assert.match(scanner, /private cachedArtworkUrl\(sourcePath: string\)/);
  assert.match(scanner, /let coverUrl: string \| undefined = this\.cachedArtworkUrl\(sourcePath\)/);
  assert.match(main, /coverUrl: storedCover \|\|.*cachedArtworkUrl\(track\.sourcePath\)/);
});

test("library metadata scanning uses bounded concurrency and reports failures", () => {
  const scanner = fs.readFileSync(path.join(root, "electron/library/scanner/LibraryScanner.ts"), "utf8");
  assert.match(scanner, /directoryConcurrency = Math\.max\(1/);
  assert.match(scanner, /metadataConcurrency = Math\.max\(1/);
  assert.match(scanner, /pending\.splice\(0, this\.directoryConcurrency\)/);
  assert.match(scanner, /mapWithConcurrency\(observation\.files, this\.metadataConcurrency/);
  assert.doesNotMatch(scanner, /Promise\.all\(observation\.files\.map/);
  assert.match(scanner, /failures\.push\(failure\("stat", sourcePath, error\)\)/);
  assert.match(scanner, /failures\.push\(failure\("metadata", sourcePath, error\)\)/);
  assert.match(scanner, /metadataRead = false/);
});

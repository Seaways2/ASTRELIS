// Library roots, partial scans and unreadable files (full test report B01, B02,
// B03, B05, LL01, LL13, S03).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { LibraryReconciler, sanitizeLibraryRoots } = require(path.join(root, "dist-electron/library/reconcile/LibraryReconciler.js"));
const { toTrackRecord, upgradeLibraryDomain } = require(path.join(root, "dist-electron/library/domain/LibraryDomain.js"));
const { validateLibraryPayloadV2 } = require(path.join(root, "dist-electron/library/validation/LibraryValidator.js"));
const { parseAbsolutePath, parsePathList, parseRescanRequest } = require(path.join(root, "dist-electron/library/validation/LibraryIpcValidator.js"));
const { libraryFolderArgument, rescanCoversRegisteredRoots } = require(path.join(root, "dist-electron/library/libraryPaths.js"));
const { LibraryScanner } = require(path.join(root, "dist-electron/library/scanner/LibraryScanner.js"));
const { AUDIO_EXTENSIONS, FFMPEG_DECODED_AUDIO_EXTENSIONS, needsDecodedAudio } = require(path.join(root, "dist-electron/library/media/audioFormats.js"));

function domainTrack(sourcePath, folders, overrides = {}, input = {}) {
  return toTrackRecord({
    track: {
      id: "legacy", name: "Song", artist: "Artist", album: "Album", genre: "Rock", url: "media:" + sourcePath,
      format: "FLAC", size: 1000, sourcePath, nativePath: sourcePath, folder: path.win32.dirname(sourcePath), ...overrides
    },
    folders,
    mtimeMs: 1,
    ...input
  });
}

function scanResult(roots, tracks) {
  return {
    scanId: "scan", startedAt: new Date(0).toISOString(), completedAt: new Date(1).toISOString(),
    roots: roots.map(([rootPath, status]) => ({ rootId: "r", path: rootPath, status, scannedFiles: 0, skippedFiles: 0, unreadableDirectories: [] })),
    tracks,
    failures: []
  };
}

test("a whole drive keeps its root separator and commits as a valid library root", () => {
  assert.deepEqual(sanitizeLibraryRoots(["E:\\"]), ["E:\\"]);
  assert.deepEqual(sanitizeLibraryRoots(["E:\\\\", "e:/"]), ["E:\\"]);
  // Under an online drive root, a folder that does not exist folds into it.
  const systemDrive = path.parse(os.tmpdir()).root;
  assert.deepEqual(sanitizeLibraryRoots([systemDrive + "\\", path.join(systemDrive, "auralis-missing-" + process.pid, "Album")]), [systemDrive]);
  const roots = sanitizeLibraryRoots(["E:\\"]);
  const track = domainTrack("E:\\Music\\a.flac", roots, {}, { fingerprint: "1".repeat(64) });
  const gone = domainTrack("E:\\Music\\gone.flac", roots, {}, { fingerprint: "2".repeat(64) });
  const result = new LibraryReconciler().reconcile({ tracks: [gone], folders: [] }, scanResult([["E:\\", "complete"]], [track]), roots);
  assert.deepEqual(result.snapshot.folders, ["E:\\"]);
  assert.deepEqual(result.removed, [gone.id], "a missing file under the drive root is removed after a complete scan");
  const payload = upgradeLibraryDomain(result.snapshot);
  assert.doesNotThrow(() => validateLibraryPayloadV2(payload));
  assert.equal(payload.tracks[0].location.rootId, payload.roots[0].rootId);
});

test("adding a folder never claims same-content tracks from roots it did not scan", () => {
  const fingerprint = "a".repeat(64);
  const original = { ...domainTrack("K:\\Music1\\Album\\a.flac", ["K:\\Music1"], {}, { fingerprint }), coverLocked: true, coverUrl: "cover" };
  const copy = domainTrack("K:\\Music2\\copy.flac", ["K:\\Music2"], {}, { fingerprint });
  assert.equal(copy.mediaId, original.mediaId);
  const requested = ["K:\\Music1", "K:\\Music2"];
  const result = new LibraryReconciler().reconcile({ tracks: [original], folders: ["K:\\Music1"] },
    scanResult([["K:\\Music2", "complete"]], [{ ...copy, metadataRead: true }]), requested);
  assert.deepEqual(result.relocated, []);
  assert.equal(result.snapshot.tracks.length, 2);
  const kept = result.snapshot.tracks.find(track => track.sourcePath === original.sourcePath);
  const added = result.snapshot.tracks.find(track => track.sourcePath === copy.sourcePath);
  assert.equal(kept.id, original.id, "the existing track keeps its identity");
  assert.equal(kept.coverLocked, true);
  assert.notEqual(added.id, original.id, "the new copy gets an instance identity of its own");
  const payload = upgradeLibraryDomain(result.snapshot);
  assert.doesNotThrow(() => validateLibraryPayloadV2(payload));
  assert.equal(payload.tracks.find(track => track.sourcePath === original.sourcePath).mediaId, original.mediaId,
    "the domain upgrade does not rename the kept track");
});

test("a track still moves when its old root was scanned completely and the file is gone", () => {
  const fingerprint = "b".repeat(64);
  const original = domainTrack("K:\\Music1\\a.flac", ["K:\\Music1"], {}, { fingerprint });
  const moved = domainTrack("K:\\Music2\\a.flac", ["K:\\Music2"], {}, { fingerprint });
  const requested = ["K:\\Music1", "K:\\Music2"];
  const result = new LibraryReconciler().reconcile({ tracks: [original], folders: requested },
    scanResult([["K:\\Music1", "complete"], ["K:\\Music2", "complete"]], [moved]), requested);
  assert.deepEqual(result.relocated, [original.mediaId]);
  assert.equal(result.snapshot.tracks.length, 1);
  assert.equal(result.snapshot.tracks[0].sourcePath, moved.sourcePath);
});

test("in a partially scanned root a track moves only when its old file is really gone", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-partial-move-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const oldRoot = path.join(directory, "Music1"), newRoot = path.join(directory, "Music2");
  fs.mkdirSync(path.join(oldRoot, "Locked"), { recursive: true }); fs.mkdirSync(newRoot);
  const requested = [oldRoot, newRoot];
  const reconcile = (sourcePath, unreadableDirectories = []) => {
    const fingerprint = "f".repeat(64);
    const original = domainTrack(sourcePath, [oldRoot], {}, { fingerprint });
    const moved = domainTrack(path.join(newRoot, "a.flac"), [newRoot], {}, { fingerprint });
    const scan = scanResult([[oldRoot, "partial"], [newRoot, "complete"]], [moved]);
    scan.roots[0].unreadableDirectories = unreadableDirectories;
    return { original, result: new LibraryReconciler().reconcile({ tracks: [original], folders: requested }, scan, requested) };
  };
  // The old file still exists: the copy in Music2 is a second file.
  const existing = path.join(oldRoot, "a.flac");
  fs.writeFileSync(existing, "synthetic");
  const kept = reconcile(existing).result;
  assert.deepEqual(kept.relocated, []);
  assert.equal(kept.snapshot.tracks.length, 2);
  // Under a folder the scan could not read, a missing file proves nothing.
  const locked = path.join(oldRoot, "Locked", "a.flac");
  const unread = reconcile(locked, [path.join(oldRoot, "Locked")]).result;
  assert.deepEqual(unread.relocated, []);
  assert.equal(unread.snapshot.tracks.length, 2);
  // Moved away in a readable part of the root: it is relocated, not duplicated.
  const { original, result } = reconcile(path.join(oldRoot, "gone.flac"));
  assert.deepEqual(result.relocated, [original.mediaId]);
  assert.equal(result.snapshot.tracks.length, 1);
  assert.equal(result.snapshot.tracks[0].sourcePath, path.join(newRoot, "a.flac"));
});

test("a partial rescan stats only unmatched tracks that have somewhere to move to", t => {
  const musicRoot = "K:\\Music";
  const kept = Array.from({ length: 50 }, (_, index) => domainTrack(`${musicRoot}\\${index}.flac`, [musicRoot], {}, { fingerprint: String(index).padStart(64, "0") }));
  const lonely = domainTrack(`${musicRoot}\\Gone\\lonely.flac`, [musicRoot], {}, { fingerprint: "7".repeat(64) });
  const movedFrom = domainTrack(`${musicRoot}\\Old\\moved.flac`, [musicRoot], {}, { fingerprint: "8".repeat(64) });
  const movedTo = domainTrack(`${musicRoot}\\New\\moved.flac`, [musicRoot], {}, { fingerprint: "8".repeat(64) });
  const scan = scanResult([[musicRoot, "partial"]], [...kept, movedTo]);
  const statted = [];
  const original = fs.statSync;
  fs.statSync = (target, ...rest) => {
    if (String(target).toLowerCase().startsWith("k:\\music\\")) { statted.push(String(target)); return undefined; }
    return original(target, ...rest);
  };
  t.after(() => { fs.statSync = original; });
  const result = new LibraryReconciler().reconcile({ tracks: [...kept, lonely, movedFrom], folders: [musicRoot] }, scan, [musicRoot]);
  fs.statSync = original;
  assert.deepEqual(statted, [movedFrom.sourcePath], "matched tracks and tracks with no candidate are never statted");
  assert.deepEqual(result.relocated, [movedFrom.mediaId]);
  assert.deepEqual(result.unavailable, [lonely.id]);
  assert.equal(result.snapshot.tracks.length, 52);
});

test("a track whose file is momentarily empty is kept as unavailable, not removed", () => {
  // Explorer's overwrite-copy and in-place tag writers truncate the file first;
  // a scan at that moment must not drop the track with its online metadata.
  const previous = { ...domainTrack("K:\\Music\\song.flac", ["K:\\Music"], {}, { fingerprint: "9".repeat(64) }), coverLocked: true, coverUrl: "cover" };
  const scan = scanResult([["K:\\Music", "complete"]], []);
  scan.failures = [{ stage: "stat", path: "k:\\music\\SONG.flac", code: "EMPTY_FILE", message: "The file is empty (0 bytes)" }];
  const result = new LibraryReconciler().reconcile({ tracks: [previous], folders: ["K:\\Music"] }, scan, ["K:\\Music"]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.unavailable, [previous.id]);
  assert.deepEqual(result.snapshot.tracks, [previous]);
  // A same-content copy elsewhere does not take its identity either.
  const copy = { ...domainTrack("K:\\Music\\copy.flac", ["K:\\Music"], {}, { fingerprint: "9".repeat(64) }), metadataRead: true };
  const withCopy = new LibraryReconciler().reconcile({ tracks: [previous], folders: ["K:\\Music"] },
    { ...scanResult([["K:\\Music", "complete"]], [copy]), failures: scan.failures }, ["K:\\Music"]);
  assert.deepEqual(withCopy.relocated, []);
  assert.equal(withCopy.snapshot.tracks.find(track => track.sourcePath === previous.sourcePath).id, previous.id);
  // Without the empty-file report the track is gone, as before.
  assert.deepEqual(new LibraryReconciler().reconcile({ tracks: [previous], folders: ["K:\\Music"] },
    scanResult([["K:\\Music", "complete"]], []), ["K:\\Music"]).removed, [previous.id]);
});

test("a rescan from the renderer matches the registered roots, nested junctions and whole drives included", t => {
  // The renderer re-sanitises the folders it gets: it folds a nested root into
  // its parent and (before its own fix) trimmed "E:\" to "E:". Neither may make
  // "rescan" or "remove folder" fail for roots the main process registered.
  const source = fs.readFileSync(path.join(root, "src/utils/libraryCoverMerge.ts"), "utf8");
  const output = require("typescript").transpileModule(source, { compilerOptions: { module: 1, target: 7 } }).outputText;
  const rendererModule = { exports: {} };
  Function("exports", "module", "require", output)(rendererModule.exports, rendererModule, require);
  const { sanitizeLibraryFolders } = rendererModule.exports;
  const roots = sanitizeLibraryRoots(["E:\\", "D:\\Music"]);
  const sent = sanitizeLibraryFolders(roots);
  const request = parseRescanRequest({ folders: sent, meta: { requestId: "r" } });
  assert.deepEqual(request.folders, ["E:\\", "D:\\Music"]);
  assert.equal(rescanCoversRegisteredRoots(sanitizeLibraryRoots(request.folders), roots), true);
  assert.equal(libraryFolderArgument("E:"), "E:\\");
  assert.equal(parseAbsolutePath(libraryFolderArgument("E:"), "library folder"), "E:\\");
  assert.equal(libraryFolderArgument("E:\\Music"), "E:\\Music");
  assert.equal(libraryFolderArgument(5), 5);
  assert.throws(() => parseAbsolutePath("E:", "library folder"), /invalid/, "plain paths stay strict");
  // Only registered roots, and all of them.
  assert.equal(rescanCoversRegisteredRoots(["D:\\Music", "F:\\Other"], ["D:\\Music"]), false);
  assert.equal(rescanCoversRegisteredRoots(["D:\\Music\\Classical"], ["D:\\Music", "D:\\Music\\Classical"]), false);
  assert.equal(rescanCoversRegisteredRoots([], ["D:\\Music"]), false);
  assert.equal(rescanCoversRegisteredRoots(["D:\\Music"], ["D:\\Music", "E:\\"]), false);
  assert.equal(rescanCoversRegisteredRoots(["D:\\Music"], ["D:\\Music", "D:\\Music\\Classical"]), true, "a nested root is covered by its parent");
  if (process.platform !== "win32") return;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-junction-rescan-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const parent = path.join(directory, "Music"), target = path.join(directory, "Elsewhere");
  fs.mkdirSync(parent); fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(parent, "Classical"), "junction");
  const registered = sanitizeLibraryRoots([parent, path.join(parent, "Classical")]);
  assert.equal(registered.length, 2);
  const folded = sanitizeLibraryRoots(parseRescanRequest({ folders: sanitizeLibraryFolders(registered), meta: { requestId: "r" } }).folders);
  const sameCanonical = (left, right) => fs.realpathSync.native(left) === fs.realpathSync.native(right);
  assert.equal(rescanCoversRegisteredRoots(folded, registered, sameCanonical), true);
});

test("a nested root that was not scanned keeps its tracks when its parent scan is complete", () => {
  const child = domainTrack("D:\\Music\\Classical\\a.flac", ["D:\\Music\\Classical"], {}, { fingerprint: "c".repeat(64) });
  const parent = domainTrack("D:\\Music\\Pop\\b.flac", ["D:\\Music"], {}, { fingerprint: "d".repeat(64) });
  const result = new LibraryReconciler().reconcile({ tracks: [child, parent], folders: [] },
    scanResult([["D:\\Music", "complete"]], [parent]), ["D:\\Music", "D:\\Music\\Classical"]);
  assert.deepEqual(result.removed, []);
  assert.equal(result.snapshot.tracks.length, 2);
});

test("a nested root that is a junction stays a root of its own", { skip: process.platform !== "win32" }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-junction-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const parent = path.join(directory, "Music"), target = path.join(directory, "Elsewhere");
  fs.mkdirSync(parent); fs.mkdirSync(target);
  const link = path.join(parent, "Classical");
  fs.symlinkSync(target, link, "junction");
  fs.mkdirSync(path.join(parent, "Plain"));
  assert.deepEqual(sanitizeLibraryRoots([parent, link, path.join(parent, "Plain")]), [parent, link]);
  // A link at a middle level: the parent's scan never enters "Classical\Sub" either.
  fs.mkdirSync(path.join(target, "Sub"));
  assert.deepEqual(sanitizeLibraryRoots([parent, path.join(link, "Sub")]), [parent, path.join(link, "Sub")]);
  // Below a root that is itself the junction, a plain folder folds as usual.
  assert.deepEqual(sanitizeLibraryRoots([parent, link, path.join(link, "Sub")]), [parent, link]);
});

test("nested roots are kept while their parent cannot be read, and plain ones fold back later", { skip: process.platform !== "win32" }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-offline-root-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const parent = path.join(directory, "Music"), target = path.join(directory, "Elsewhere");
  fs.mkdirSync(path.join(parent, "Plain"), { recursive: true }); fs.mkdirSync(target);
  const link = path.join(parent, "Link");
  fs.symlinkSync(target, link, "junction");
  const registered = sanitizeLibraryRoots([parent, link]);
  assert.deepEqual(registered, [parent, link]);
  // The drive holding the parent is unplugged: nothing can be checked, and a
  // rescan or "add folder" in the meantime must not drop the junction root.
  const unplugged = path.join(directory, "Unplugged");
  fs.renameSync(parent, unplugged);
  assert.deepEqual(sanitizeLibraryRoots(registered), registered);
  assert.deepEqual(sanitizeLibraryRoots([...registered, path.join(parent, "Plain")]), [...registered, path.join(parent, "Plain")]);
  const offline = new LibraryReconciler().reconcile({ tracks: [], folders: registered },
    scanResult([[parent, "offline"], [link, "offline"]], []), registered);
  assert.deepEqual(offline.snapshot.folders, registered);
  // Back online: the junction stays, the plain folder folds into its parent.
  fs.renameSync(unplugged, parent);
  assert.deepEqual(sanitizeLibraryRoots([...registered, path.join(parent, "Plain")]), registered);
});

test("a real junction out of the root is reported and keeps the root partial", { skip: process.platform !== "win32" }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auralis-junction-scan-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const musicRoot = path.join(directory, "Music"), target = path.join(directory, "Elsewhere");
  fs.mkdirSync(path.join(musicRoot, "Plain"), { recursive: true }); fs.mkdirSync(target);
  fs.writeFileSync(path.join(musicRoot, "Plain", "a.flac"), "synthetic");
  fs.writeFileSync(path.join(target, "b.flac"), "synthetic");
  fs.symlinkSync(target, path.join(musicRoot, "Linked"), "junction");
  const scan = rootList => new LibraryScanner({
    artworkDirectory: path.join(directory, "art"), mediaUrl: filePath => "media:" + filePath, audioExtensions: new Set([".flac"]),
    metadataLoader: async () => ({ parseFile: async () => parsed })
  }).scanRoots([musicRoot], undefined, undefined, rootList);
  const alone = await scan([musicRoot]);
  assert.equal(alone.roots[0].status, "partial");
  assert.deepEqual(alone.failures.map(failure => failure.code), ["ELINKOUTSIDE"]);
  assert.deepEqual(alone.tracks.map(track => path.basename(track.sourcePath)), ["a.flac"]);
  // Registered as a root of its own, the junction is that root's business.
  const covered = await scan([musicRoot, path.join(musicRoot, "Linked")]);
  assert.equal(covered.roots[0].status, "complete");
  assert.deepEqual(covered.failures, []);
});

test("tag read failure keeps the previous tags and album instead of wiping them", () => {
  const previous = domainTrack("K:\\Music\\song.flac", ["K:\\Music"], {}, {
    fingerprint: "e".repeat(64), artistNames: ["Artist", "Feat"], albumArtist: "Artist", genres: ["Rock"], trackNumber: 3, discNumber: 1
  });
  const unread = {
    ...domainTrack("K:\\Music\\song.flac", ["K:\\Music"], { name: "song", artist: "未知艺术家", album: "未分类专辑", genre: "未分类" },
      { fingerprint: "e".repeat(64) }),
    metadataRead: false
  };
  assert.deepEqual(unread.tags.artists, []);
  const result = new LibraryReconciler().reconcile({ tracks: [previous], folders: ["K:\\Music"] },
    scanResult([["K:\\Music", "complete"]], [unread]), ["K:\\Music"]);
  const kept = result.snapshot.tracks[0];
  assert.deepEqual(kept.tags, previous.tags);
  assert.equal(kept.albumId, previous.albumId);
  assert.equal(kept.artist, "Artist");
  const payload = upgradeLibraryDomain(result.snapshot);
  assert.doesNotThrow(() => validateLibraryPayloadV2(payload));
  assert.deepEqual(payload.tracks[0].tags.artists.map(artist => artist.name), ["Artist", "Feat"]);
  assert.equal(payload.tracks[0].tags.trackNumber, 3);
  assert.equal(payload.tracks[0].albumId, previous.albumId);
});

const dirent = (name, kind = "file") => ({
  name,
  isDirectory: () => kind === "directory",
  isFile: () => kind === "file",
  isSymbolicLink: () => kind === "link"
});
const directoryStat = { isDirectory: () => true, size: 0 };
const fileStat = size => ({ isDirectory: () => false, size, mtimeMs: 1 });
const parsed = { common: { title: "Song", artist: "Artist", album: "Album", track: {}, disk: {} }, format: { container: "FLAC", duration: 10 } };

function scanner(fileSystem, parseFile = async () => parsed) {
  return new LibraryScanner({
    artworkDirectory: "C:\\Auralis\\artwork", mediaUrl: filePath => "media:" + filePath,
    metadataLoader: async () => ({ parseFile }), audioExtensions: new Set([".flac"]),
    fileFingerprint: async () => undefined, fileSystem
  });
}

test("a drive root scan skips the recycle bin and System Volume Information", async () => {
  const fileSystem = {
    async stat(filePath) { return filePath === "E:\\" || filePath.endsWith("Album") ? directoryStat : fileStat(10); },
    async readdir(directory) {
      if (directory === "E:\\") return [dirent("$RECYCLE.BIN", "directory"), dirent("System Volume Information", "directory"), dirent("Album", "directory")];
      if (directory === "E:\\Album") return [dirent("a.flac")];
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    },
    async mkdir() {}, async writeFile() {}, existsSync: () => false
  };
  const result = await scanner(fileSystem).scanRoots(["E:\\"]);
  assert.equal(result.roots[0].status, "complete");
  assert.deepEqual(result.tracks.map(track => track.sourcePath), ["E:\\Album\\a.flac"]);
  assert.deepEqual(result.failures, []);
});

test("links are followed only when safe; one outside the library makes the root partial", async () => {
  const musicRoot = "K:\\Music";
  const real = {
    "K:\\Music": "K:\\Music",
    "K:\\Music\\Outside": "E:\\Elsewhere",
    "K:\\Music\\Inside": "K:\\Music\\Real",
    "K:\\Music\\Placeholder": "K:\\Music\\Placeholder",
    "K:\\Music\\Registered": "F:\\Classical",
    "K:\\Classical": "F:\\Classical"
  };
  const fileSystem = {
    async stat(filePath) { return filePath.endsWith(".flac") ? fileStat(10) : directoryStat; },
    async readdir(directory) {
      if (directory === musicRoot) return [dirent("Outside", "link"), dirent("Inside", "link"), dirent("Placeholder", "link"), dirent("Registered", "link"), dirent("Real", "directory")];
      if (directory === "K:\\Music\\Placeholder" || directory === "K:\\Music\\Real") return [dirent("song.flac")];
      throw new Error("must not enter " + directory);
    },
    async realpath(filePath) { if (!real[filePath]) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return real[filePath]; },
    async mkdir() {}, async writeFile() {}, existsSync: () => false
  };
  const result = await scanner(fileSystem).scanRoots([musicRoot], undefined, undefined, [musicRoot, "K:\\Classical"]);
  assert.equal(result.roots[0].status, "partial", "an unscanned link must never authorise deletion");
  assert.deepEqual(result.roots[0].unreadableDirectories, ["K:\\Music\\Outside"]);
  assert.deepEqual(result.failures.map(failure => [failure.path, failure.code]), [["K:\\Music\\Outside", "ELINKOUTSIDE"]]);
  assert.deepEqual(result.tracks.map(track => track.sourcePath).sort(), ["K:\\Music\\Placeholder\\song.flac", "K:\\Music\\Real\\song.flac"]);
});

test("Windows compatibility junctions that deny listing do not keep a root partial", async () => {
  // Documents holds "My Music", "My Pictures" and "My Videos": junctions out of
  // the folder whose ACL denies listing. Nothing was ever scanned through them.
  const documents = "C:\\Users\\x\\Documents";
  const real = { [documents]: documents, [documents + "\\My Music"]: "C:\\Users\\x\\Music", [documents + "\\Linked"]: "E:\\Elsewhere" };
  const fileSystem = {
    async stat(filePath) { return filePath.endsWith(".flac") ? fileStat(10) : directoryStat; },
    async readdir(directory) {
      if (directory === documents) return [dirent("My Music", "link"), dirent("Linked", "link"), dirent("a.flac")];
      if (directory === documents + "\\My Music") throw Object.assign(new Error("denied"), { code: "EPERM" });
      if (directory === documents + "\\Linked") return [dirent("b.flac")];
      throw new Error("unexpected " + directory);
    },
    async realpath(filePath) { return real[filePath] || filePath; },
    async mkdir() {}, async writeFile() {}, existsSync: () => false
  };
  const quiet = await scanner({ ...fileSystem, async readdir(directory) {
    if (directory === documents) return [dirent("My Music", "link"), dirent("a.flac")];
    return fileSystem.readdir(directory);
  } }).scanRoots([documents]);
  assert.equal(quiet.roots[0].status, "complete");
  assert.deepEqual(quiet.failures, []);
  assert.deepEqual(quiet.tracks.map(track => track.sourcePath), [documents + "\\a.flac"]);
  // A readable link out of the library is still reported and not followed.
  const mixed = await scanner(fileSystem).scanRoots([documents]);
  assert.equal(mixed.roots[0].status, "partial");
  assert.deepEqual(mixed.failures.map(failure => [failure.path, failure.code]), [[documents + "\\Linked", "ELINKOUTSIDE"]]);
  assert.deepEqual(mixed.tracks.map(track => track.sourcePath), [documents + "\\a.flac"]);
});

test("empty files are reported instead of indexed, and a file with no audio stream is a failure", async () => {
  const fileSystem = {
    async stat(filePath) { return filePath === "K:\\Music" ? directoryStat : fileStat(filePath.endsWith("empty.flac") ? 0 : 10); },
    async readdir() { return [dirent("empty.flac"), dirent("garbage.flac"), dirent("good.flac")]; },
    async mkdir() {}, async writeFile() {}, existsSync: () => false
  };
  const result = await scanner(fileSystem, async filePath => filePath.endsWith("garbage.flac")
    ? { common: { track: {}, disk: {} }, format: {} } : parsed).scanRoots(["K:\\Music"]);
  assert.equal(result.roots[0].status, "complete");
  assert.equal(result.roots[0].skippedFiles, 1);
  assert.deepEqual(result.tracks.map(track => path.win32.basename(track.sourcePath)).sort(), ["garbage.flac", "good.flac"]);
  assert.deepEqual(result.failures.map(failure => [path.win32.basename(failure.path), failure.stage, failure.code]).sort(),
    [["empty.flac", "stat", "EMPTY_FILE"], ["garbage.flac", "metadata", "NO_AUDIO_STREAM"]]);
  assert.equal(result.tracks.find(track => track.sourcePath.endsWith("garbage.flac")).metadataRead, false);
});

test("WavPack and TTA are scanned and marked for ffmpeg decoding", () => {
  for (const extension of [".wv", ".tta"]) {
    assert.ok(AUDIO_EXTENSIONS.has(extension), extension);
    assert.ok(FFMPEG_DECODED_AUDIO_EXTENSIONS.has(extension), extension);
  }
  assert.equal(needsDecodedAudio("D:\\Music\\a.WV"), true);
  assert.equal(needsDecodedAudio("D:\\Music\\a.flac"), false);
  for (const extension of FFMPEG_DECODED_AUDIO_EXTENSIONS) assert.ok(AUDIO_EXTENSIONS.has(extension), extension);
  const externalOpenPaths = fs.readFileSync(path.join(root, "electron/externalOpenPaths.ts"), "utf8");
  assert.match(externalOpenPaths, /export \{ AUDIO_EXTENSIONS, FFMPEG_DECODED_AUDIO_EXTENSIONS, needsDecodedAudio \} from "\.\/library\/media\/audioFormats"/);
});

test("queue restore accepts every queue QueueStore can save", () => {
  const queueStore = fs.readFileSync(path.join(root, "electron/queue/QueueStore.ts"), "utf8");
  const ipc = fs.readFileSync(path.join(root, "electron/ipc/libraryIpc.ts"), "utf8");
  const saved = Number(/const MAX_TRACKS = ([\d_]+);/.exec(queueStore)[1].replace(/_/g, ""));
  const restored = Number(/export const OPEN_FILES_LIMIT = ([\d_]+);/.exec(ipc)[1].replace(/_/g, ""));
  assert.ok(restored >= saved, `open-files accepts ${restored}, the queue saves ${saved}`);
  assert.match(ipc, /parsePathList\(input, "audio paths", OPEN_FILES_LIMIT\)/);
  assert.match(ipc, /mapLimited\(sourcePaths, OPEN_FILES_CONCURRENCY,/);
  const paths = Array.from({ length: 12000 }, (_, index) => `D:\\Music\\${index}.flac`);
  assert.throws(() => parsePathList(paths, "audio paths"), /LIBRARY_INVALID_SCHEMA|invalid/);
  assert.equal(parsePathList(paths, "audio paths", restored).length, 12000);
});

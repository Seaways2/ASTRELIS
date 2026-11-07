const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const { LibraryScanner } = require(path.join(root, "dist-electron/library/scanner/LibraryScanner.js"));

const musicRoot = "K:\\Music";
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const dirent = (name, directory = false) => ({
  name,
  isDirectory: () => directory,
  isFile: () => !directory
});
const directoryStat = { isDirectory: () => true };
const fileStat = { size: 1234, isDirectory: () => false };

test('valid untagged DTS is indexed without a tag error; corrupt audio still reports failure', async () => {
  const scanner = new LibraryScanner({
    artworkDirectory:'C:\\Auralis\\artwork',mediaUrl:p=>'media:'+p,
    audioExtensions:new Set(['.dts','.flac']),
    metadataLoader:async()=>({parseFile:async()=>{throw Error('unsupported tags')}}),
    probeRawAudio:async p=>{if(p.endsWith('bad.dts'))throw Error('invalid audio');return {duration:227.27}},
    fileFingerprint:async()=>undefined,
    fileSystem:{stat:async p=>p===musicRoot?directoryStat:fileStat,readdir:async()=>[dirent('valid.dts'),dirent('bad.dts'),dirent('broken.flac')],mkdir:async()=>{},writeFile:async()=>{},existsSync:()=>false}
  });
  const result=await scanner.scanRoots([musicRoot]);
  assert.equal(result.tracks.length,3);
  assert.equal(result.failures.filter(f=>f.stage==='metadata').length,2);
  const valid=result.tracks.find(t=>t.sourcePath.endsWith('valid.dts'));
  assert.equal(valid.duration,227.27);
  assert.equal(valid.metadataRead,false);
});

function scannerWith(fileSystem, parseFile, options = {}) {
  return new LibraryScanner({
    artworkDirectory: "C:\\Auralis\\artwork",
    mediaUrl: filePath => "media:" + filePath,
    metadataLoader: async () => ({ parseFile }),
    audioExtensions: new Set([".flac"]),
    directoryConcurrency: options.directoryConcurrency || 8,
    metadataConcurrency: options.metadataConcurrency || 4,
    fileFingerprint: options.fileFingerprint,
    fileSystem
  });
}

test("directory traversal has a hard concurrency limit", async () => {
  let activeDirectories = 0;
  let maxDirectories = 0;
  let activeMetadata = 0;
  let maxMetadata = 0;
  const directoryNames = Array.from({ length: 32 }, (_, index) => "dir-" + index);
  const fileSystem = {
    async stat(filePath) {
      return filePath === musicRoot ? directoryStat : fileStat;
    },
    async readdir(directory) {
      activeDirectories++;
      maxDirectories = Math.max(maxDirectories, activeDirectories);
      await delay(2);
      activeDirectories--;
      if (directory === musicRoot) return directoryNames.map(name => dirent(name, true));
      return [dirent("song.flac")];
    },
    async mkdir() {},
    async writeFile() {},
    existsSync() { return false; }
  };
  const scanner = scannerWith(fileSystem, async sourcePath => {
    activeMetadata++;
    maxMetadata = Math.max(maxMetadata, activeMetadata);
    await delay(2);
    activeMetadata--;
    return {
      common: { title: path.win32.basename(sourcePath), artist: "Artist", album: "Album", genre: ["Genre"] },
      format: { duration: 180 }
    };
  });
  const result = await scanner.scanRoots([musicRoot]);
  assert.equal(result.roots[0].status, "complete");
  assert.equal(result.tracks.length, 32);
  assert.ok(maxDirectories <= 8, "directory concurrency exceeded 8");
  assert.ok(maxMetadata <= 4, "metadata concurrency exceeded 4");
});

test("offline and permission-denied roots are reported without rejecting the scan", async () => {
  for (const [code, expected] of [["ENOENT", "offline"], ["EACCES", "permissionDenied"]]) {
    const fileSystem = {
      async stat() { throw Object.assign(new Error(code), { code }); },
      async readdir() { throw new Error("must not enumerate"); },
      async mkdir() {},
      async writeFile() {},
      existsSync() { return false; }
    };
    const result = await scannerWith(fileSystem, async () => ({})).scanRoots([musicRoot]);
    assert.equal(result.roots[0].status, expected);
    assert.equal(result.tracks.length, 0);
    assert.equal(result.failures[0].stage, "root");
    assert.equal(result.failures[0].code, code);
  }
});

test("a NAS disconnect reports the root offline and preserves scan isolation", async () => {
  const fileSystem = {
    async stat() { throw Object.assign(new Error("network share disconnected"), { code: "ECONNRESET" }); },
    async readdir() { throw new Error("must not enumerate an offline NAS"); },
    async mkdir() {},
    async writeFile() {},
    existsSync() { return false; }
  };
  const result = await scannerWith(fileSystem, async () => ({})).scanRoots(["\\\\NAS\\Music"]);
  assert.equal(result.roots[0].status, "offline");
  assert.equal(result.tracks.length, 0);
  assert.equal(result.failures[0].code, "ECONNRESET");
});

test("one disappearing file becomes a ScanFailure and cannot abort the root", async () => {
  const missingPath = path.win32.join(musicRoot, "missing.flac");
  const fileSystem = {
    async stat(filePath) {
      if (filePath === musicRoot) return directoryStat;
      if (filePath === missingPath) throw Object.assign(new Error("gone"), { code: "ENOENT" });
      return fileStat;
    },
    async readdir() { return [dirent("good.flac"), dirent("missing.flac")]; },
    async mkdir() {},
    async writeFile() {},
    existsSync() { return false; }
  };
  const result = await scannerWith(fileSystem, async () => ({
    common: { artist: "Artist", album: "Album" },
    format: { duration: 180 }
  })).scanRoots([musicRoot]);
  assert.equal(result.roots[0].status, "partial");
  assert.equal(result.tracks.length, 1);
  assert.equal(result.failures.some(item => item.stage === "stat" && item.code === "ENOENT"), true);
});

test("one permission-denied subdirectory makes the root partial without hiding readable files", async () => {
  const locked = path.win32.join(musicRoot, "Locked");
  const fileSystem = {
    async stat(filePath) { return filePath === musicRoot ? directoryStat : fileStat; },
    async readdir(directory) {
      if (directory === locked) throw Object.assign(new Error("denied"), { code: "EACCES" });
      return [dirent("good.flac"), dirent("Locked", true)];
    },
    async mkdir() {},
    async writeFile() {},
    existsSync() { return false; }
  };
  const result = await scannerWith(fileSystem, async () => ({
    common: { artist: "Artist", album: "Album" }, format: { duration: 180 }
  })).scanRoots([musicRoot]);
  assert.equal(result.roots[0].status, "partial");
  assert.deepEqual(result.roots[0].unreadableDirectories, [locked]);
  assert.equal(result.tracks.length, 1);
});

test("metadata failure keeps the file observable and does not authorize false deletion", async () => {
  const fileSystem = {
    async stat(filePath) { return filePath === musicRoot ? directoryStat : fileStat; },
    async readdir() { return [dirent("good.flac"), dirent("bad.flac")]; },
    async mkdir() {},
    async writeFile() {},
    existsSync() { return false; }
  };
  const result = await scannerWith(fileSystem, async sourcePath => {
    if (sourcePath.endsWith("bad.flac")) throw Object.assign(new Error("bad tags"), { code: "EBADTAG" });
    return { common: { artist: "Artist", album: "Album" }, format: { duration: 180 } };
  }).scanRoots([musicRoot]);
  assert.equal(result.roots[0].status, "complete");
  assert.equal(result.tracks.length, 2);
  assert.equal(result.tracks.find(item => item.sourcePath.endsWith("bad.flac")).metadataRead, false);
  assert.equal(result.failures.some(item => item.stage === "metadata"), true);
});

test("artwork cache write failure cannot hide an otherwise valid track", async () => {
  const fileSystem = {
    async stat(filePath) { return filePath === musicRoot ? directoryStat : fileStat; },
    async readdir() { return [dirent("cover.flac")]; },
    async mkdir() {},
    async writeFile() { throw Object.assign(new Error("artwork cache denied"), { code: "EACCES" }); },
    existsSync() { return false; }
  };
  const result = await scannerWith(fileSystem, async () => ({
    common: {
      title: "Track with cover",
      artist: "Artist",
      album: "Album",
      track: {},
      disk: {},
      picture: [{ format: "image/jpeg", data: Buffer.from("cover") }]
    },
    format: { duration: 180 }
  })).scanRoots([musicRoot]);
  assert.equal(result.roots[0].status, "complete");
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].name, "Track with cover");
  assert.equal(result.failures.some(item => item.stage === "artwork" && item.code === "EACCES"), true);
});

test("duplicate-content files receive unique deterministic library identities", async () => {
  const fileSystem = {
    async stat(filePath) { return filePath === musicRoot ? directoryStat : fileStat; },
    async readdir() { return [dirent("copy-a.flac"), dirent("copy-b.flac")]; },
    async mkdir() {},
    async writeFile() {},
    existsSync() { return false; }
  };
  const createScanner = () => scannerWith(fileSystem, async () => ({
    common: { title: "Same content", artist: "Artist", album: "Album" },
    format: { duration: 180 }
  }), { fileFingerprint: async () => "d".repeat(64) });
  const first = await createScanner().scanRoots([musicRoot]);
  const repeated = await createScanner().scanRoots([musicRoot]);
  assert.equal(first.tracks.length, 2);
  assert.equal(new Set(first.tracks.map(track => track.mediaId)).size, 2);
  assert.deepEqual(
    first.tracks.map(track => track.mediaId),
    repeated.tracks.map(track => track.mediaId)
  );
});

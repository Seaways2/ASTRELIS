const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DecodedAudioCache, completeFloatWav } = require("../../dist-electron/library/media/DecodedAudioCache.js");
const { cacheArtwork, legacyArtworkUrl } = require("../../dist-electron/library/media/ArtworkCache.js");
const { LibraryScanner } = require("../../dist-electron/library/scanner/LibraryScanner.js");

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-media-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("astrelis-media-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function wave(rf64 = false) {
  const offset = rf64 ? 80 : 44;
  const buffer = Buffer.alloc(offset + 32);
  buffer.write(rf64 ? "RF64" : "RIFF"); buffer.writeUInt32LE(rf64 ? 0xffffffff : buffer.length - 8, 4); buffer.write("WAVE", 8);
  let format = 12;
  if (rf64) {
    buffer.write("ds64", 12); buffer.writeUInt32LE(28, 16);
    buffer.writeBigUInt64LE(BigInt(buffer.length - 8), 20); buffer.writeBigUInt64LE(32n, 28); format = 48;
  }
  buffer.write("fmt ", format); buffer.writeUInt32LE(16, format + 4); buffer.writeUInt16LE(3, format + 8);
  buffer.writeUInt16LE(1, format + 10); buffer.writeUInt32LE(8000, format + 12); buffer.writeUInt32LE(32000, format + 16);
  buffer.writeUInt16LE(4, format + 20); buffer.writeUInt16LE(32, format + 22);
  buffer.write("data", offset - 8); buffer.writeUInt32LE(rf64 ? 0xffffffff : 32, offset - 4);
  return buffer;
}

test("generated float RIFF and RF64 WAVs are checked without accepting truncation", async t => {
  const directory = temporary(t);
  for (const rf64 of [false, true]) {
    const file = path.join(directory, String(rf64) + ".wav");
    fs.writeFileSync(file, wave(rf64)); assert.equal(await completeFloatWav(file), true);
    fs.truncateSync(file, fs.statSync(file).size - 4); assert.equal(await completeFloatWav(file), false);
  }
  const file = path.join(directory, "incomplete.wav");
  fs.writeFileSync(file, "RIFF"); assert.equal(await completeFloatWav(file), false);
});

test("parallel preparations share conversion and publish only a complete WAV", async t => {
  const directory = temporary(t), source = path.join(directory, "song.ape"), cacheDirectory = path.join(directory, "cache");
  fs.writeFileSync(source, "synthetic source");
  let conversions = 0, release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const cache = new DecodedAudioCache(cacheDirectory, async (_source, output) => {
    conversions++; fs.writeFileSync(output, "PARTIAL"); started(); await hold; fs.writeFileSync(output, wave());
  });
  const first = cache.prepare(source); await entered;
  let returnedEarly = false;
  const second = cache.prepare(source).then(result => { returnedEarly = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returnedEarly, false); assert.equal(conversions, 1);
  assert.equal(fs.readdirSync(cacheDirectory).every(name => name.endsWith(".tmp.wav")), true);
  release(); const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b); assert.equal(await completeFloatWav(a), true);
  assert.equal(await cache.prepare(source), a); assert.equal(conversions, 1);
  assert.deepEqual(fs.readdirSync(cacheDirectory), [path.basename(a)]);
});

test("an interrupted old WAV cache is rebuilt and failed conversion never publishes a file", async t => {
  const directory = temporary(t), source = path.join(directory, "song.dsf"), cacheDirectory = path.join(directory, "cache");
  fs.writeFileSync(source, "source"); let conversions = 0, fail = false;
  const cache = new DecodedAudioCache(cacheDirectory, async (_source, output) => {
    conversions++; fs.writeFileSync(output, fail ? "PARTIAL" : wave()); if (fail) throw new Error("interrupted");
  });
  const target = await cache.prepare(source); fs.truncateSync(target, 20);
  fail = true; await assert.rejects(cache.prepare(source), /interrupted/);
  assert.equal(await completeFloatWav(target), false);
  assert.equal(fs.readdirSync(cacheDirectory).some(name => name.endsWith(".tmp.wav")), false);
  fail = false; assert.equal(await cache.prepare(source), target); assert.equal(conversions, 3);
  assert.equal(await completeFloatWav(target), true);
});

test("the actual FFmpeg float-WAV output passes cache completion validation", async t => {
  const directory = temporary(t), source = path.join(directory, "source.wav");
  fs.writeFileSync(source, wave());
  const execute = require("node:util").promisify(require("node:child_process").execFile);
  const cache = new DecodedAudioCache(path.join(directory, "decoded"), (_source, output) => execute(
    path.resolve(__dirname, "../../ffmpeg/ffmpeg.exe"), ["-v", "error", "-nostdin", "-y", "-i", _source,
      "-map", "0:a:0", "-c:a", "pcm_f32le", "-rf64", "auto", "-f", "wav", output],
    { windowsHide: true, timeout: 5000 }));
  const output = await cache.prepare(source);
  assert.equal(await completeFloatWav(output), true);
});

test("content-addressed artwork refreshes changed images and shares identical images", async t => {
  const directory = temporary(t), url = file => file;
  const oldPicture = { format: "image/jpeg", data: Buffer.from("OLD-COVER") };
  const [a, duplicate] = await Promise.all([cacheArtwork(oldPicture, directory, url), cacheArtwork(oldPicture, directory, url)]);
  const b = await cacheArtwork({ ...oldPicture, data: Buffer.from("NEW-COVER") }, directory, url);
  assert.equal(a, duplicate); assert.notEqual(a, b);
  assert.equal(fs.readFileSync(b, "utf8"), "NEW-COVER");
  assert.equal(fs.readdirSync(directory).filter(name => name.endsWith(".tmp")).length, 0);
});

test("legacy artwork fallback retains existing JPEG, PNG and WebP path-addressed caches", () => {
  for (const extension of [".jpg", ".png", ".webp"]) {
    const source = path.resolve("synthetic.flac"), directory = path.resolve("synthetic-artwork");
    const identity = require("node:crypto").createHash("sha1").update(source.toLowerCase()).digest("hex");
    const expected = path.join(directory, identity + extension);
    assert.equal(legacyArtworkUrl(source, directory, file => "media:" + file, file => file === expected), "media:" + expected);
  }
  assert.equal(legacyArtworkUrl(path.resolve("missing.flac"), path.resolve("artwork"), file => file, () => false), undefined);
});

test("rescanning one unchanged path updates its cover URL after embedded artwork changes", async t => {
  const directory = temporary(t), root = path.join(directory, "music"), cache = path.join(directory, "art");
  fs.mkdirSync(root); fs.writeFileSync(path.join(root, "song.flac"), "synthetic");
  let picture = "OLD";
  const scanner = new LibraryScanner({ artworkDirectory: cache, mediaUrl: file => file, audioExtensions: new Set([".flac"]),
    metadataLoader: async () => ({ parseFile: async () => ({ common: { title: "Song", artist: "Artist", album: "Album", track: {}, disk: {},
      picture: [{ format: "image/jpeg", data: Buffer.from(picture) }] }, format: { duration: 1 } }) }) });
  const old = (await scanner.scanRoots([root])).tracks[0]; picture = "NEW";
  const fresh = (await scanner.scanRoots([root])).tracks[0];
  assert.notEqual(old.coverUrl, fresh.coverUrl); assert.equal(fs.readFileSync(fresh.coverUrl, "utf8"), "NEW");
});

test("the default scanner publishes artwork with a temporary file and rename", async t => {
  const directory = temporary(t), root = path.join(directory, "music"), cache = path.join(directory, "art");
  fs.mkdirSync(root); fs.writeFileSync(path.join(root, "song.flac"), "synthetic");
  const originalRename = fs.promises.rename.bind(fs.promises); let publications = 0;
  t.mock.method(fs.promises, "rename", async (from, to) => {
    if (path.dirname(to) === cache) {
      publications++;
      assert.ok(from.endsWith(".tmp")); assert.equal(fs.existsSync(to), false);
      assert.equal(fs.readFileSync(from, "utf8"), "COMPLETE-COVER");
    }
    return originalRename(from, to);
  });
  const scanner = new LibraryScanner({ artworkDirectory: cache, mediaUrl: file => file, audioExtensions: new Set([".flac"]),
    metadataLoader: async () => ({ parseFile: async () => ({ common: { title: "Song", artist: "Artist", album: "Album", track: {}, disk: {},
      picture: [{ format: "image/jpeg", data: Buffer.from("COMPLETE-COVER") }] }, format: { duration: 1 } }) }) });
  const result = await scanner.scanRoots([root]);
  assert.equal(publications, 1); assert.equal(fs.readFileSync(result.tracks[0].coverUrl, "utf8"), "COMPLETE-COVER");
  assert.equal(fs.readdirSync(cache).some(name => name.endsWith(".tmp")), false);
});

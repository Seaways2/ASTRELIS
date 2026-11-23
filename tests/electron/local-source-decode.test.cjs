// LA03: formats Chromium cannot decode (AIFF, ALAC in .m4a, WavPack, TTA,
// alongside APE/DSF/WMA/DTS/AC-3) go through the ffmpeg decode cache;
// AAC .m4a and the formats Chromium plays stay direct.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { WavCodecProbe } = require("../../dist-electron/library/media/WavCodecProbe");

const mainSource = fs.readFileSync(path.resolve(__dirname, "../../electron/main.ts"), "utf8");
const start = mainSource.indexOf("  const audioStreamReport =");
const end = mainSource.indexOf("  const prepareHdmiSource =", start);

function harness(t) {
  assert.ok(start > 0 && end > start);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "astrelis-decode-route-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const probes = [], decoded = [];
  const codecOf = file => /alac/i.test(path.basename(file)) ? "alac (alac / 0x63616C61), 44100 Hz, stereo, s32p (24 bit)"
    : /dts/i.test(path.basename(file)) ? "dts (DTS), 48000 Hz, 5.1(side), fltp" : /broken/i.test(path.basename(file)) ? null
      : path.extname(file) === ".wav" ? "pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s"
        : "aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 256 kb/s";
  const context = vm.createContext({
    path, fs, WavCodecProbe, findFfmpeg: () => "ffmpeg.exe",
    execFileAsync: async (_executable, args) => {
      const file = args[args.indexOf("-i") + 1];
      probes.push(path.basename(file));
      const codec = codecOf(file);
      if (!codec) throw Object.assign(new Error("ffmpeg failed"), { stderr: "Invalid data found" });
      return { stdout: "", stderr: `Input #0, x, from '${file}':\n  Stream #0:0[0x1](und): Audio: ${codec} (default)\n` };
    },
    DirectAudioCache: class {}, app: { getPath: () => directory }, writeLog() {},
    decodedAudioCache: { prepare: async source => { decoded.push(path.basename(source)); return `${source}.decoded.wav`; } },
    parseAbsolutePath: value => value, AUDIO_EXTENSIONS: new Set(), localMediaAccess: undefined
  });
  vm.runInContext(ts.transpileModule(`${mainSource.slice(start, end)}\nglobalThis.prepareLocalSource = prepareLocalSource;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, context);
  const file = name => { const target = path.join(directory, name); fs.writeFileSync(target, name); return target; };
  return { prepare: source => context.prepareLocalSource(source), file, probes, decoded };
}

test("AIFF, WavPack, TTA and the existing ffmpeg formats are decoded without probing", async t => {
  const h = harness(t);
  for (const name of ["a.aiff", "b.AIF", "c.wv", "d.tta", "e.ape", "f.dsf", "g.wma", "h.dts", "i.ac3", "j.eac3"]) {
    const source = h.file(name);
    assert.equal(await h.prepare(source), `${source}.decoded.wav`, name);
  }
  assert.deepEqual(h.probes, []);
});

test("an .m4a is probed: ALAC is decoded, AAC plays directly, an unprobeable file is left to Chromium", async t => {
  const h = harness(t);
  const alac = h.file("alac.m4a"), aac = h.file("aac.m4a"), broken = h.file("broken.m4a");
  assert.equal(await h.prepare(alac), `${alac}.decoded.wav`);
  assert.equal(await h.prepare(aac), aac);
  assert.equal(await h.prepare(broken), broken);
  // The codec is probed once per file version.
  await h.prepare(alac); await h.prepare(aac);
  assert.deepEqual(h.probes, ["alac.m4a", "aac.m4a", "broken.m4a"]);
  assert.deepEqual(h.decoded, ["alac.m4a", "alac.m4a"]);
});

test("formats Chromium plays stay direct; a DTS stream in a .wav is still decoded", async t => {
  const h = harness(t);
  for (const name of ["a.mp3", "b.flac", "c.ogg", "d.opus", "e.aac", "f.wav"]) {
    const source = h.file(name);
    assert.equal(await h.prepare(source), source, name);
  }
  const dts = h.file("dts.wav");
  assert.equal(await h.prepare(dts), `${dts}.decoded.wav`);
});

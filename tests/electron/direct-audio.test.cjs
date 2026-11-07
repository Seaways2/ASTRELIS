const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { DirectAudioCache, directFormatFromReport, validateDirectFile } = require('../../dist-electron/library/media/DirectAudioCache');
const exec = promisify(execFile);
const ffmpeg = path.resolve(__dirname, '../../ffmpeg/ffmpeg.exe');
const report = text => 'Stream #0:0: Audio: ' + text;

test('direct policy preserves precision/layout and rejects unsupported HD/DSD rather than dropping extensions', () => {
  const pcm = directFormatFromReport(report('flac, 96000 Hz, 5.1(side), s32 (24 bit)'));
  assert.equal(pcm.sampleRate, 96000); assert.equal(pcm.channels, 6); assert.equal(pcm.channelMask, 1551);
  assert.equal(pcm.validBits, 24); assert.equal(pcm.bits, 32);
  assert.equal(directFormatFromReport(report('mp3, 44100 Hz, stereo, fltp')).codec, 'pcm');
  assert.equal(directFormatFromReport(report('dts (DTS), 44100 Hz, 5.0(side), fltp')).codec, 'dts');
  for (const codec of ['dts (DTS-HD MA)', 'truehd', 'dsd_lsbf'])
    assert.throws(() => directFormatFromReport(report(`${codec}, 48000 Hz, stereo, s32`)), /尚未/);
  assert.throws(() => directFormatFromReport(report('flac, 96000 Hz, 6 channels (unknown), s32')), /布局/);
});

test('FFmpeg direct cache preserves 24-bit PCM samples, reuses cache and emits validated AC3/EAC3 bursts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astrelis-direct-'));
  try {
    const run = async args => (await exec(ffmpeg, args, { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 })).stderr;
    const source = path.join(root, '中文 source.flac');
    const raw = Buffer.alloc(4410 * 2 * 3);
    for (let i = 0; i < raw.length / 3; i++) raw.writeIntLE(((i * 737) % 0xffffff) - 0x800000, i * 3, 3);
    const input = path.join(root, 'source.s24'); fs.writeFileSync(input, raw);
    await run(['-y', '-f', 's24le', '-ar', '44100', '-ac', '2', '-i', input, '-c:a', 'flac', source]);
    let calls = 0;
    const cache = new DirectAudioCache(path.join(root, 'cache'), async args => { calls++; return run(args); });
    const prepared = await cache.prepare(source);
    assert.equal(prepared.validBits, 24);
    const bytes = fs.readFileSync(prepared.path);
    assert.equal(bytes.length, raw.length / 3 * 4);
    for (let i = 0; i < raw.length / 3; i++) assert.equal(bytes.readInt32LE(i * 4), raw.readIntLE(i * 3, 3) * 256);
    const oldCalls = calls; assert.equal((await cache.prepare(source)).path, prepared.path); assert.equal(calls, oldCalls);
    fs.unlinkSync(prepared.path);
    const regenerated = await cache.prepare(source);
    assert.ok(fs.existsSync(regenerated.path), 'manual cache cleanup must not leave a stale in-memory hit');
    assert.deepEqual(fs.readFileSync(regenerated.path), bytes);
    for (const codec of ['ac3', 'eac3', 'dts']) {
      const encoded = path.join(root, `source.${codec}`);
      await run(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.3', '-c:a', codec === 'dts' ? 'dca' : codec, '-strict', '-2', '-b:a', '768k', encoded]);
      const stream = await cache.prepare(encoded);
      assert.equal(stream.codec, codec);
      assert.equal(stream.burstBytes, codec === 'ac3' ? 6144 : codec === 'dts' ? 2048 : 24576);
      assert.equal(stream.sampleRate, codec === 'eac3' ? 192000 : 48000);
      const damaged = fs.readFileSync(stream.path); damaged[0] = 0; fs.writeFileSync(stream.path, damaged);
      await assert.rejects(validateDirectFile(stream.path, stream), /同步/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

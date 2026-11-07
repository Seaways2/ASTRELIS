const test = require('node:test');
const assert = require('node:assert/strict');
const { WavCodecProbe } = require('../../dist-electron/library/media/WavCodecProbe.js');

test('DTS probe recognizes the payload codec rather than WAV container tag and coalesces requests', async () => {
  let calls = 0;
  const probe = new WavCodecProbe(async () => {
    calls++;
    return 'Stream #0:0: Audio: dts (dca) (DTS) ([1][0][0][0] / 0x0001), 44100 Hz';
  });
  assert.deepEqual(await Promise.all([probe.isDts(__filename), probe.isDts(__filename)]), [true, true]);
  assert.equal(calls, 1);
});

test('PCM WAV is not routed through DTS conversion', async () => {
  const probe = new WavCodecProbe(async () => 'Stream #0:0: Audio: pcm_s16le, 44100 Hz');
  assert.equal(await probe.isDts(__filename), false);
});

test('unrecognized probe output fails closed and can be retried', async () => {
  let calls = 0;
  const probe = new WavCodecProbe(async () => ++calls === 1 ? '' : 'Stream #0:0: Audio: dts, 44100 Hz');
  await assert.rejects(probe.isDts(__filename));
  assert.equal(await probe.isDts(__filename), true);
});

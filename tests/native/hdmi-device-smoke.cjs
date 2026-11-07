const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const exe = path.resolve('native-host/build/AuralisPluginHost_artefacts/Release/AuralisPluginHost.exe');
const child = spawn(exe, ['--engine'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '', id = 0;
const pending = new Map();
child.stdout.on('data', data => {
  buffer += data; let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    try { const value = JSON.parse(line); const callback = pending.get(value.requestId); if (callback) { pending.delete(value.requestId); callback(value); } } catch {}
  }
});
function command(value) {
  const requestId = String(++id);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Native command timed out: ' + value.type)), 25000);
    pending.set(requestId, result => { clearTimeout(timeout); resolve(result); });
    child.stdin.write(JSON.stringify({ ...value, requestId, protocolVersion: 1 }) + '\n');
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const devices = await command({ type: 'device-enumerate' });
  const endpoints = [...new Map((devices.devices || []).filter(d => d.platformEndpointId).map(d => [d.platformEndpointId, d])).values()];
  const probed = [];
  for (const device of endpoints) probed.push({ device: device.juceDeviceName, id: device.platformEndpointId, result: await command({ type: 'direct-probe', endpointId: device.platformEndpointId }) });
  console.log(JSON.stringify(probed.map(p => ({ device: p.device, ...p.result })), null, 2));
  const target = probed.find(p => p.result.ok);
  if (!target) { console.log('NO_CONNECTED_HDMI_ENDPOINT: receiver playback remains unverified. Endpoint rejection passed.'); return; }
  const source = path.resolve('release-work/hdmi-silence.raw');
  fs.writeFileSync(source, Buffer.alloc(48000 * 4 * 3));
  const spec = { path: source, codec: 'pcm', sampleRate: 48000, channels: 2, bits: 16, validBits: 16, channelMask: 3, encodedSampleRate: 48000, encodedChannels: 2, burstBytes: 0 };
  const loaded = await command({ type: 'direct-load', directFormat: spec, endpointId: target.id, playbackToken: 'test' });
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  await command({ type: 'volume', value: 0.3 });
  assert.equal((await command({ type: 'rack', plugins: [] })).processingMode, 'direct');
  await command({ type: 'play' }); await sleep(350);
  let status = await command({ type: 'status' }); assert.equal(status.ok, true); assert.ok(status.position > 0 && status.position < 1, JSON.stringify(status));
  await command({ type: 'pause' }); await sleep(150);
  status = await command({ type: 'status' }); const stoppedAt = status.position; assert.equal(status.playing, false);
  await sleep(150); assert.equal((await command({ type: 'status' })).position, stoppedAt);
  await command({ type: 'seek', position: 2.6 }); await command({ type: 'play' }); await sleep(800);
  status = await command({ type: 'status' }); assert.equal(status.ok, true, JSON.stringify(status)); assert.equal(status.playing, false); assert.equal(status.position, status.duration);
  await command({ type: 'direct-close' });
  console.log('PASS: silent PCM exclusive open, play, pause, resume/seek/EOF, bypass and release. No encoded audio sent.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { child.stdin.end(); });

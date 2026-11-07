const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { onlineOutputSetupScript } = require('../../dist-electron/onlineMediaOutput.js');
function outputFixture(sinkId, reject = false) {
  const calls = [], listeners = {}, pending = [];
  class Media { constructor() { this.sinkId = sinkId; } setSinkId(id) { calls.push(id); return reject ? Promise.reject(Error('unavailable')) : new Promise(resolve => pending.push(resolve)); } }
  const media = new Media();
  const context = vm.createContext({ window: {}, HTMLMediaElement: Media, Element: Media,
    MutationObserver: class { observe() {} },
    document: { documentElement: {}, querySelector: () => media, querySelectorAll: () => [media], addEventListener: (name, cb) => listeners[name] = cb }
  });
  return { calls, media, context, release: () => pending.shift()?.(), fire: () => listeners.loadedmetadata({target: media}) };
}
test('default sink alias never reopens the audio device', async () => {
  const f = outputFixture('');
  vm.runInContext(onlineOutputSetupScript('default'), f.context);
  f.fire(); await Promise.resolve(); assert.equal(f.calls.length, 0);
});
test('pending or rejected output changes do not retry on every track event', async () => {
  for (const reject of [false, true]) {
    const f = outputFixture('', reject);
    vm.runInContext(onlineOutputSetupScript('device-a'), f.context);
    for (let i = 0; i < 10; i++) f.fire();
    await new Promise(resolve => setImmediate(resolve));
    f.fire(); await Promise.resolve(); assert.deepEqual(f.calls, ['device-a']);
    vm.runInContext(onlineOutputSetupScript('device-b'), f.context);
    if (!reject) {
      assert.deepEqual(f.calls, ['device-a']);
      f.release();
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.calls, ['device-a', 'device-b']);
  }
});
test('explicit device failure reports error and preserves the previous target', async () => {
  const f = outputFixture('',true);
  const result = await vm.runInContext(onlineOutputSetupScript('unavailable',true),f.context);
  assert.equal(result.ok,false);
  assert.equal(result.error,'unavailable');
  assert.equal(f.context.window.__auralisOutputTarget,'default');
  assert.equal(f.media.sinkId,'');
});

test('output selection is accepted before YouTube creates a media element', async () => {
  const context = vm.createContext({
    window: {}, HTMLMediaElement: class {}, Element: class {},
    MutationObserver: class { observe() {} },
    document: { documentElement: {}, querySelector: () => null, addEventListener() {} }
  });
  const result = await vm.runInContext(onlineOutputSetupScript('device-a', true), context);
  assert.equal(result.ok, true);
  assert.equal(result.deferred, true);
  assert.equal(context.window.__auralisOutputTarget, 'device-a');
});

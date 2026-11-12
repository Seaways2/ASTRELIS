const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

test('preload subscriptions forward only payloads and unsubscribe independently', () => {
  const ipc = new EventEmitter();
  let desktop;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../dist-electron/preload.js'),'utf8'), {
    exports: {},
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, api) => { desktop = api; } },
      ipcRenderer: ipc, webUtils: {}
    })
  });
  const subscriptions = [
    [desktop.preferences.onChanged,'desktop-preferences:changed'],
    [desktop.onClickThrough,'window:click-through-state'],
    [desktop.onMediaKey,'media-key'],
    [desktop.onMaximized,'window:maximized-state'],
    [desktop.onCaptionPointerDown,'window:caption-pointerdown'],
    [desktop.onPresentationState,'window:presentation-state'],
    [desktop.externalOpen.onFiles,'external-open-files'],
    [desktop.library.onScanProgress,'library:scan-progress'],
    [desktop.nativeAudio.onSafetyFallback,'audio:safety-fallback'],
    [desktop.vst.onScanProgress,'vst:scan-progress'],
    [desktop.browser.onState,'browser:state'],
    [desktop.browser.onMedia,'browser:media']
  ];
  for (const [subscribe,channel] of subscriptions) {
    const received=[], peer=[];
    const off=subscribe((...args)=>received.push(args));
    const otherOff=subscribe(value=>peer.push(value));
    const payload={value:channel};
    ipc.emit(channel,{sender:'must not escape'},payload);
    assert.deepEqual(received,[[payload]]);
    off();off();
    ipc.emit(channel,{},payload);
    assert.equal(received.length,1);
    assert.equal(peer.length,2);
    otherOff();assert.equal(ipc.listenerCount(channel),0);
  }
});

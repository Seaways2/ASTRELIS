const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const fail of [false, true]) test(`exit waits for editor cleanup/state save (failure=${fail})`, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../electron/main.ts'), 'utf8');
  const body = source.slice(source.indexOf('app.on("before-quit",'), source.indexOf('app.on("will-quit",'));
  const commands = [], order = [];
  let handler, settle;
  const context = {
    isQuitting: false, pluginStateFlushStarted: false,
    playbackEngineGate: {current: () => ({killed:false,stdin:{end:()=>order.push('stdin-end')}})},
    schedulerExperiment: null,
    sendPlaybackCommand: c => {commands.push(c);return new Promise((resolve,reject)=>{settle=()=>fail?reject(Error('failure')):resolve({ok:true})})},
    vstStateDirectory: () => 'test-state', writeLog: () => {},
    app: {on: (_, cb) => {handler=cb}, quit:()=>order.push('quit')}
  };
  vm.runInNewContext(body, context);
  handler({preventDefault:()=>order.push('prevent')});
  assert.equal(commands[0].closeEditors, true);
  assert.equal(commands[0].type, 'state-save');
  assert.deepEqual(order, ['prevent']);
  settle();await new Promise(setImmediate);
  assert.deepEqual(order, ['prevent','stdin-end','quit']);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { AudioCacheMaintenance } = require('../../dist-electron/audioCacheMaintenance.js');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astrelis-cache-maintenance-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('astrelis-cache-maintenance-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (name, bytes = 16) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes)); return file; };
  return { root, write, cache: new AudioCacheMaintenance(root) };
}
test('clear removes only generated unpinned audio and preserves library, covers, music and unknown files', async t => {
  const {cache,write} = fixture(t);
  const unused = write('decoded-audio/' + 'a'.repeat(40) + '.wav');
  const current = write('direct-audio/' + 'b'.repeat(64) + '.raw', 32);
  const retained = ['library-v2/library.json','artwork-cache/cover.png','decoded-audio/my-song.wav','decoded-audio/nested/'+ 'c'.repeat(40)+'.wav'].map(f=>write(f));
  cache.protect('playing', [current]);
  assert.equal((await cache.inspect()).bytes,48);
  const result=await cache.clear();
  assert.equal(result.removedBytes,16); assert.equal(result.skippedBytes,32);
  assert.equal(fs.existsSync(unused),false);
  for(const file of [current,...retained]) assert.ok(fs.existsSync(file));
});
test('cleanup rejects preparation in flight and accepts a retry after completion', async t => {
  const {cache,write}=fixture(t); write('decoded-audio/'+'a'.repeat(40)+'.wav');
  let finish;
  const busy=cache.use(()=>new Promise(resolve=>{finish=resolve;}));
  assert.equal((await cache.clear()).ok,false);
  finish(); await busy;
  assert.equal((await cache.clear()).removedBytes,16);
});
test('preparation waits for cleanup and publishes its protected file before yielding', async t => {
  const {cache,write}=fixture(t);
  write('decoded-audio/'+'a'.repeat(40)+'.wav');
  const clear=cache.clear(); let prepared=false;
  const work=cache.use(async()=> { const file=write('decoded-audio/'+'b'.repeat(40)+'.wav'); cache.protect('next',[file]); prepared=true; });
  assert.equal(prepared,false);
  await clear; await work;
  assert.equal((await cache.inspect()).protectedBytes,16);
  assert.equal((await cache.clear()).removedBytes,0);
});
test('cache directory junction never permits deleting external audio', async t => {
  const {root,cache,write}=fixture(t);
  const external=write('external/'+'a'.repeat(40)+'.wav');
  fs.symlinkSync(path.dirname(external),path.join(root,'decoded-audio'),'junction');
  assert.equal((await cache.inspect()).bytes,0);
  assert.equal((await cache.clear()).removedBytes,0);
  assert.ok(fs.existsSync(external));
});

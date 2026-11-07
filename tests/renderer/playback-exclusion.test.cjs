const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../src/utils/playbackExclusion.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};Function('exports',code)(mod.exports);const {PlaybackExclusion}=mod.exports;
test('new source waits until other outputs pause',async()=>{
 const gate=new PlaybackExclusion();let release,started=false;
 const task=gate.run(()=>true,()=>new Promise(r=>release=r),async()=>{started=true});
 await new Promise(setImmediate);assert.equal(started,false);release();await task;assert.equal(started,true);
});
test('YouTube invalidates a pending local start',async()=>{
 const gate=new PlaybackExclusion();let release,started=false;
 const task=gate.run(()=>true,()=>new Promise(r=>release=r),async()=>{started=true});
 await new Promise(setImmediate);gate.cancel();release();await task;assert.equal(started,false);
});
test('latest platform wins queued starts',async()=>{
 const gate=new PlaybackExclusion(),starts=[];let release;
 const a=gate.run(()=>true,()=>new Promise(r=>release=r),async()=>{starts.push('local')});
 await new Promise(setImmediate);
 const b=gate.run(()=>true,async()=>{},async()=>{starts.push('netease')});
 release();await Promise.all([a,b]);assert.deepEqual(starts,['netease']);
});
test('pause failure blocks start but does not poison later requests',async()=>{
 const gate=new PlaybackExclusion();let starts=0;
 await assert.rejects(gate.run(()=>true,async()=>{throw Error('pause failed')},async()=>{starts++}));
 await gate.run(()=>true,async()=>{},async()=>{starts++});assert.equal(starts,1);
});
test('cancelled playback state cannot restart after a slow pause',async()=>{
 const gate=new PlaybackExclusion();let valid=true,release,started=false;
 const task=gate.run(()=>valid,()=>new Promise(r=>release=r),async()=>{started=true});
 await new Promise(setImmediate);valid=false;release();await task;assert.equal(started,false);
});

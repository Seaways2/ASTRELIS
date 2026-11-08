const { readAppSource } = require("./helpers/appSource.cjs");
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const exportsForTest = {};
const videoExports={};
Function('exports',ts.transpileModule(fs.readFileSync(path.join(root,'src/utils/videoTrack.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(videoExports);
Function('exports','require', ts.transpileModule(fs.readFileSync(path.join(root,'src/utils/playbackResources.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exportsForTest,()=>videoExports);
const {prefetchTarget} = exportsForTest;
const tracks=[{id:'a',sourcePath:'a.dts',format:'DTS'},{id:'b',sourcePath:'b.flac',format:'FLAC'}];
test('mixed video queues do not predecode videos as music',()=>{
 const video={id:'v',sourcePath:'movie.mkv',format:'MKV',mediaKind:'video'};
 assert.equal(prefetchTarget([tracks[0],video],0,true,false,false,'all'),undefined);
 assert.equal(prefetchTarget([video,tracks[0]],0,true,false,false,'all'),undefined);
 assert.equal(videoExports.isVideoTrack({format:'mp4'}),true);
 assert.equal(videoExports.isVideoTrack({format:'DTS'}),false);
});
test('prefetch selects only the deterministic next local file and respects queue end/repeat',()=>{
  assert.equal(prefetchTarget(tracks,0,true,false,false,'off'),tracks[1]);
  assert.equal(prefetchTarget(tracks,1,true,false,false,'all'),tracks[0]);
  assert.equal(prefetchTarget(tracks,1,true,false,false,'off'),undefined);
  assert.equal(prefetchTarget(tracks,0,true,false,false,'one'),undefined);
  for(const [playing,online,shuffle] of [[false,false,false],[true,true,false],[true,false,true]])
    assert.equal(prefetchTarget(tracks,0,playing,online,shuffle,'all'),undefined);
  assert.equal(prefetchTarget([tracks[0]],0,true,false,false,'all'),undefined);
  assert.equal(prefetchTarget([tracks[0],{id:'online',format:'NETEASE',sourcePath:'remote'}],0,true,false,false,'all'),undefined);
});
test('hidden status retains transport polling without FFT; hidden canvas stops its animation loop',()=>{
  const app=readAppSource();
  assert.match(app,/type: "status", analysis: analysisNeeded/);
  assert.match(app,/analysisNeeded \? 50 : 500/);
  assert.match(app,/enabled: analysisNeeded/);
  assert.match(app,/!analysisNeeded \|\| \(statusTicks/);
  const canvas=fs.readFileSync(path.join(root,'src/visualizers/VisualizerCanvas.tsx'),'utf8');
  assert.match(canvas,/if \(!canvas \|\| !visible\) return/);
});

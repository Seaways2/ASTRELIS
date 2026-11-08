const { readAppSource } = require("../renderer/helpers/appSource.cjs");
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {VideoPlayer,videoArguments,validateVideoFile,videoExtensions}=require('../../dist-electron/videoPlayer.js');
test('video paths accept local Unicode files and reject URLs/directories/other extensions',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-video-'));
  try {
    const file=path.join(dir,'视频 测试.mkv');fs.writeFileSync(file,'fixture');
    assert.equal(validateVideoFile(file),fs.realpathSync(file));
    const wmv=path.join(dir,'测试 视频.WMV');fs.writeFileSync(wmv,'fixture');
    assert.equal(validateVideoFile(wmv),fs.realpathSync(wmv));
    assert.throws(()=>validateVideoFile('https://example.com/video.mkv'));
    assert.throws(()=>validateVideoFile('--script=evil.lua'));
    assert.throws(()=>validateVideoFile(dir));
    assert.throws(()=>validateVideoFile(path.join(dir,'test.exe')));
  } finally {fs.rmSync(dir,{recursive:true});}
});
test('video formats stay available in the renderer and file picker',()=>{
  const ts=require('typescript'),root=path.resolve(__dirname,'../..'),renderer={};
  const source=fs.readFileSync(path.join(root,'src/utils/videoTrack.ts'),'utf8');
  Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(renderer);
  const app=readAppSource();
  const accept=app.match(/type="file" multiple accept="([^"]+)"/)?.[1].split(',')||[];
  for(const ext of videoExtensions){
    assert.equal(renderer.isVideoFile('film.'+ext.toUpperCase()),true,ext);
    assert.ok(accept.includes('.'+ext),'file picker: '+ext);
  }
  assert.equal(renderer.isVideoFile('film.exe'),false);
});
test('video engine isolates config, scripts, audio output and optional encoded passthrough',()=>{
  const normal=videoArguments('pipe',false,'log');
  assert.ok(normal.includes('--no-config'));assert.ok(normal.includes('--load-scripts=no'));
  assert.ok(normal.includes('--audio-spdif='));assert.ok(normal.includes('--audio-exclusive=no'));
  const direct=videoArguments('pipe',true,'log');
  assert.ok(direct.includes('--audio-spdif=ac3,dts,eac3'));assert.ok(direct.includes('--audio-exclusive=yes'));
  assert.ok(direct.includes('--audio-fallback-to-null=no'));
  const embedded=videoArguments('pipe',false,'log','1234');
  assert.ok(embedded.includes('--wid=1234'));assert.ok(embedded.includes('--osc=no'));
  assert.ok(embedded.includes('--pause=yes'));assert.ok(embedded.includes('--drag-and-drop=no'));
});
test('renderer controls cannot send arbitrary mpv commands, invalid tracks or nonfinite seeks',async()=>{
  const player=new VideoPlayer('unused','unused',()=>{}),commands=[];
  player.state.active=true;player.state.duration=100;player.state.tracks=[{id:2,type:'audio'},{id:3,type:'sub'}];
  player.request=async command=>commands.push(command);
  await assert.rejects(player.control('run','cmd'));
  await assert.rejects(player.control('seek',NaN));
  await assert.rejects(player.control('audio',3));
  await player.control('seek',150);assert.deepEqual(commands.pop(),['seek',100,'absolute+exact']);
  await player.control('audio',2);assert.deepEqual(commands.pop(),['set_property','aid',2]);
  await player.control('subtitle','no');assert.deepEqual(commands.pop(),['set_property','sid','no']);
  player.state.direct=true;await assert.rejects(player.control('volume',50));
  player.state.ended=true;await player.control('toggle');
  assert.deepEqual(commands.slice(-2),[['seek',0,'absolute+exact'],['set_property','pause',false]]);
});
test('missing runtime fails without acquiring a playback session',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-video-'));
  try {const file=path.join(dir,'test.mp4');fs.writeFileSync(file,'x');
    const player=new VideoPlayer(path.join(dir,'missing.exe'),path.join(dir,'log'),()=>{});
    await assert.rejects(player.open(file,false),/VIDEO_ENGINE_MISSING/);assert.equal(player.state.active,false);
  }finally{fs.rmSync(dir,{recursive:true});}
});

test('video device selection is constrained to enumerated devices',async()=>{
 const player=new VideoPlayer('unused','unused',()=>{}),commands=[];
 player.state.active=true;player.state.audioDevices=[{name:'auto',description:'Default'},{name:'wasapi/test',description:'HDMI'}];
 player.request=async command=>commands.push(command);
 await assert.rejects(player.control('device','unknown'),/VIDEO_DEVICE_INVALID/);
 await player.control('device','wasapi/test');
 assert.deepEqual(commands.pop(),['set_property','audio-device','wasapi/test']);
});

test('subtitle sync constrains timing and aligns only a selected subtitle',async()=>{
 const player=new VideoPlayer('unused','unused',()=>{}),commands=[];
 player.state.active=true;player.request=async command=>commands.push(command);
 await assert.rejects(player.control('subtitleDelay',Infinity),/VIDEO_VALUE_INVALID/);
 await assert.rejects(player.control('subtitleDelay',121),/VIDEO_VALUE_INVALID/);
 await assert.rejects(player.control('subtitleSpeed',.4),/VIDEO_VALUE_INVALID/);
 await assert.rejects(player.control('subtitleAlign',0),/VIDEO_TRACK_INVALID/);
 player.state.tracks=[{id:3,type:'sub',selected:true}];
 await player.control('subtitleDelay',-.5);
 await player.control('subtitleSpeed',1.042);
 await player.control('subtitleAlign',0);
 assert.deepEqual(commands,[['set_property','sub-delay',-.5],['set_property','sub-speed',1.042],['sub-step',0]]);
 player.message({event:'property-change',name:'sub-delay',data:-.5});
 player.message({event:'property-change',name:'sub-speed',data:1.042});
 assert.equal(player.state.subtitleDelay,-.5);assert.equal(player.state.subtitleSpeed,1.042);
});

test('AAC packet diagnostics do not latch a playback failure or pause a healthy session',()=>{
 const changes=[],p=new VideoPlayer('unused','unused',s=>changes.push(s));
 p.state.active=true;p.state.ready=true;p.state.paused=false;
 p.message({event:'log-message',prefix:'ffmpeg/audio',level:'error',text:'aac: env_facs_q 255 is invalid'});
 p.message({event:'property-change',name:'time-pos',data:12});
 assert.equal(p.state.error,'');assert.equal(p.state.paused,false);assert.equal(p.state.ready,true);assert.equal(p.state.position,12);
 assert.ok(changes.every(s=>!s.error));
 p.message({event:'end-file',reason:'error',file_error:'decoding failed'});
 assert.equal(p.state.ready,false);assert.equal(p.state.paused,true);assert.equal(p.state.error,'decoding failed');
});

const { readAppSource } = require("../renderer/helpers/appSource.cjs");
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {VideoPlayer,videoArguments,videoStandaloneArguments,validateVideoFile,videoExtensions,videoExitPatch,emptyVideoState,amplitudePercentToMpvVolume}=require('../../dist-electron/videoPlayer.js');
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
  assert.ok(normal.includes('--sub-font=Microsoft YaHei'));
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

function rehostPlayer(saved){
 const commands=[],player=new VideoPlayer('unused','unused',()=>{});
 player.sourceFile='C:\\video.mkv';
 player.state={...emptyVideoState(),active:true,ready:true,paused:false,position:42,duration:100,volume:72,...saved};
 player.request=async command=>{commands.push(command);};
 player.close=async()=>{};
 player.open=async(file,direct,parent,token,standalone)=>{player.state={...emptyVideoState(),active:true,ready:true,standalone,direct};};
 return {player,commands};
}
test('a mute set in standalone fullscreen does not keep the embedded player silent',async()=>{
 const {player,commands}=rehostPlayer({standalone:true,muted:true});
 await player.rehost(false);
 // The fullscreen mute comes back as silence the renderer's volume can lift.
 assert.deepEqual(commands.find(c=>c[1]==='mute'),['set_property','mute',false]);
 assert.deepEqual(commands.find(c=>c[1]==='volume'),['set_property','volume',0]);
 assert.equal(player.state.muted,false);assert.equal(player.state.volume,0);
 commands.length=0;
 await player.control('volume',72);
 assert.deepEqual(commands,[['set_property','volume',amplitudePercentToMpvVolume(72)]]);
});
test('embedded volume lifts any mpv mute; standalone keeps its own mute',async()=>{
 const embedded=rehostPlayer({standalone:false,muted:true});
 await embedded.player.control('volume',50);
 assert.deepEqual(embedded.commands,[['set_property','volume',amplitudePercentToMpvVolume(50)],['set_property','mute',false]]);
 assert.equal(embedded.player.state.muted,false);
 const standalone=rehostPlayer({standalone:true,muted:true});
 await standalone.player.control('volume',0);
 assert.deepEqual(standalone.commands,[],'a muted fullscreen player is already silent');
 await standalone.player.control('volume',40);
 assert.deepEqual(standalone.commands,[['set_property','volume',amplitudePercentToMpvVolume(40)]]);
 assert.equal(standalone.player.state.muted,true);
});
test('entering standalone fullscreen keeps the mpv mute and volume as they were',async()=>{
 const {player,commands}=rehostPlayer({standalone:false,muted:true,volume:30});
 await player.rehost(true);
 assert.deepEqual(commands.find(c=>c[1]==='mute'),['set_property','mute',true]);
 assert.deepEqual(commands.find(c=>c[1]==='volume'),['set_property','volume',amplitudePercentToMpvVolume(30)]);
 assert.equal(player.state.muted,true);assert.equal(player.state.volume,30);
});

test('closing an engine whose file never loaded keeps the failure for the surface',()=>{
 const failed={...emptyVideoState(),active:true,ready:false,error:'unrecognized file format'};
 // main's video:open closes the engine after mpv reports end-file/error.
 assert.equal(videoExitPatch(failed,true,'').error,'unrecognized file format');
 assert.equal(videoExitPatch(failed,true,'VIDEO_ENGINE_EXIT_2').error,'unrecognized file format','exit codes do not mask the reason');
 assert.equal(videoExitPatch(failed,true).active,false);
 const playing={...emptyVideoState(),active:true,ready:true,error:''};
 assert.equal(videoExitPatch(playing,true,'VIDEO_ENGINE_EXIT_1').error,'','a deliberate close of a playable video is clean');
 assert.equal(videoExitPatch({...playing,error:'VIDEO_PCM_STATUS_FAILED'},true).error,'');
 assert.equal(videoExitPatch(playing,false,'VIDEO_ENGINE_EXIT_1').error,'VIDEO_ENGINE_EXIT_1','a crash is still reported');
 const standalone=videoExitPatch({...playing,standalone:true,paused:false},false);
 assert.equal(standalone.returnRequested,true);assert.equal(standalone.paused,false);
 assert.equal(videoExitPatch({...playing,standalone:true},true).returnRequested,false);
});

test('a queue advance in standalone fullscreen reopens fullscreen at the carried volume',()=>{
 const carried=videoArguments('pipe',false,'log',undefined,false,{volume:27,muted:true});
 assert.ok(carried.includes('--volume='+Number(amplitudePercentToMpvVolume(27).toFixed(3))));
 assert.ok(carried.includes('--mute=yes'));
 assert.ok(!carried.includes('--volume=50'));
 const direct=videoArguments('pipe',true,'log',undefined,false,{volume:27,muted:true});
 assert.ok(direct.includes('--volume=100'));assert.ok(!direct.includes('--mute=yes'));
 assert.ok(videoArguments('pipe',false,'log').includes('--volume=50'));
 const main=fs.readFileSync(path.join(__dirname,'../../electron/main.ts'),'utf8');
 const close=main.slice(main.indexOf('else if (action === "close")'),main.indexOf('else if (action === "editor")'));
 assert.match(close,/const carry = wasDetached && videoPlayer\?\.state\.standalone/);
 assert.match(close,/videoStandaloneCarry = carry;/);
 assert.doesNotMatch(close,/^\s*if \(wasDetached\) mainWindow\?\.show\(\);/m,'the main window waits for the next video:open');
 assert.match(close,/\} else if \(wasDetached\) mainWindow\?\.show\(\);/);
 assert.match(main,/const standalone = videoStandaloneCarry;/);
 assert.match(main,/videoPlayer!\.open\(file, direct, standalone \? undefined : parent, playbackToken, Boolean\(standalone\), standalone\?\.language \?\? "zh-CN", requestedRack, standalone\)/);
});

test('a queue advance carried into standalone fullscreen keeps playing',()=>{
 // App.tsx copies a standalone engine's paused state into the store, so a
 // carried advance that started paused would stop the playlist.
 const resumed=videoStandaloneArguments('C:\\engine',true);
 assert.ok(resumed.includes('--pause=no'));assert.ok(!resumed.includes('--pause=yes'));
 assert.ok(resumed.includes('--fullscreen=yes'));
 assert.ok(resumed.includes('--script='+path.join('C:\\engine','astrelis-controls.lua')));
 assert.ok(videoStandaloneArguments('C:\\engine').includes('--pause=yes'),'an explicit F11 still waits for the restored position');
 const player=fs.readFileSync(path.join(__dirname,'../../electron/videoPlayer.ts'),'utf8');
 assert.match(player,/videoStandaloneArguments\(path\.dirname\(this\.executable\), Boolean\(initialAudio\) && !rackAudio\)/);
 // The rack engine starts paused; main resumes it before video:open returns.
 const main=fs.readFileSync(path.join(__dirname,'../../electron/main.ts'),'utf8');
 const open=main.slice(main.indexOf('ipcMain.handle("video:open"'),main.indexOf('ipcMain.on("video:bounds"'));
 const resume=open.indexOf('if (standalone && videoPlayer!.state.paused)');
 assert.ok(resume>open.indexOf('VIDEO_PREPARE_TIMEOUT')&&resume<open.indexOf('return { ok: true };'));
 assert.match(open.slice(resume),/^if \(standalone && videoPlayer!\.state\.paused\) \{\s*await videoPlayer!\.control\("play"\);/);
});

test('entering standalone fullscreen while the embedded player is muted keeps the level and the mute',async()=>{
 const {player,commands}=rehostPlayer({standalone:false,muted:false});
 // The embedded renderer sends its level, then 0 when the viewer mutes.
 await player.control('volume',72);await player.control('volume',0);
 player.state.volume=0;commands.length=0;
 await player.rehost(true);
 assert.deepEqual(commands.find(c=>c[1]==='mute'),['set_property','mute',true]);
 assert.deepEqual(commands.find(c=>c[1]==='volume'),['set_property','volume',amplitudePercentToMpvVolume(72)]);
 assert.equal(player.state.muted,true);assert.equal(player.state.volume,72);
 // Unmuted embedded playback enters fullscreen at its own level.
 const audible=rehostPlayer({standalone:false,muted:false,volume:40});
 await audible.player.control('volume',40);await audible.player.rehost(true);
 assert.equal(audible.player.state.muted,false);assert.equal(audible.player.state.volume,40);
 // Bitstream output has no software volume or mute to carry.
 const direct=rehostPlayer({standalone:false,muted:false,volume:0,direct:true});
 await direct.player.rehost(true);
 assert.equal(direct.player.state.muted,false);
});

test('every load failure is reported with its playback token',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-video-'));
 try {
  const changes=[],player=new VideoPlayer(process.execPath,path.join(dir,'log'),s=>changes.push(s));
  player.state={...emptyVideoState(),title:'previous.mkv',playbackToken:'old:1'};
  // A file removed or on an unplugged drive fails before any engine starts.
  await assert.rejects(player.open(path.join(dir,'gone.mkv'),false,undefined,'track:2'),/ENOENT/);
  assert.equal(player.state.active,false);assert.equal(player.state.ready,false);
  assert.equal(player.state.playbackToken,'track:2');assert.match(player.state.error,/ENOENT/);
  assert.equal(player.state.title,'');assert.equal(changes.at(-1).playbackToken,'track:2');
  const file=path.join(dir,'test.mp4');fs.writeFileSync(file,'x');
  const missing=new VideoPlayer(path.join(dir,'missing.exe'),path.join(dir,'log'),()=>{});
  await assert.rejects(missing.open(file,false,undefined,'track:3'),/VIDEO_ENGINE_MISSING/);
  assert.equal(missing.state.error,'VIDEO_ENGINE_MISSING');assert.equal(missing.state.playbackToken,'track:3');
  // Failures main detects after the engine was ready (no audio track for the
  // rack, prepare timeout) survive the close that follows them.
  const ready=new VideoPlayer('unused','unused',()=>{});
  ready.state={...emptyVideoState(),active:true,ready:true,playbackToken:'track:4'};
  ready.state={...ready.state,...videoExitPatch(ready.state,true)};
  ready.fail('track:4','VIDEO_PCM_AUDIO_TRACK_UNAVAILABLE');
  assert.equal(ready.state.error,'VIDEO_PCM_AUDIO_TRACK_UNAVAILABLE');assert.equal(ready.state.playbackToken,'track:4');
  assert.equal(ready.state.ready,false);assert.equal(ready.state.active,false);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('a failed video:open leaves its reason on the surface and returns the plain code',()=>{
 // LV02: the renderer wraps the reply in its own Error, so main returns the
 // message, and records the failure against the play request after close().
 const main=fs.readFileSync(path.join(__dirname,'../../electron/main.ts'),'utf8');
 const open=main.slice(main.indexOf('ipcMain.handle("video:open"'),main.indexOf('ipcMain.on("video:bounds"'));
 const failure=open.slice(open.lastIndexOf('} catch (error) {'));
 assert.match(failure,/const message = error instanceof Error \? error\.message : String\(error\);/);
 assert.match(failure,/return \{ ok: false, error: message \};/);
 assert.doesNotMatch(failure,/error: String\(error\)/,'no doubled "Error:" prefix');
 assert.ok(failure.indexOf('videoPlayer?.fail(openingFile ? playbackToken : undefined, message)')>failure.indexOf('await videoPlayer?.close()'),'the failure outlives the close');
 // A carried fullscreen advance that fails before the engine starts still brings the main window back.
 assert.match(failure,/if \(standalone\) \{ videoDetached = false; if \(mainWindow && !mainWindow\.isDestroyed\(\)\) mainWindow\.show\(\); \}/);
 // Refusals before any engine work are shown too, but never on a live video.
 assert.match(main,/const refuseVideoOpen = \(playbackToken: unknown, error: string\) => \{\s*if \(typeof playbackToken === "string" && playbackToken && !videoPlayer\?\.state\.active\) videoPlayer\?\.fail\(undefined, error\);/);
 assert.match(open,/return refuseVideoOpen\(playbackToken, "VIDEO_FILE_NOT_AUTHORIZED"\);/);
 assert.match(open,/return refuseVideoOpen\(playbackToken, "VIDEO_RACK_INVALID"\);/);
 assert.match(open,/if \(videoReserved\) return \{ ok: false, error: "VIDEO_ALREADY_ACTIVE" \};/);
});

test('only a failure of the file or its engine is shown as an unplayable video',()=>{
 // The surface reads a failure carrying the play request's token as "this
 // video can't be played: the file may be damaged" with Retry. Refusals of
 // the path or the plugin rack, and failures of the rack, the plugins or the
 // native host before the engine opens the file, carry no token, so the
 // surface shows their reason and Play opens the item again.
 const main=fs.readFileSync(path.join(__dirname,'../../electron/main.ts'),'utf8');
 const open=main.slice(main.indexOf('ipcMain.handle("video:open"'),main.indexOf('ipcMain.on("video:bounds"'));
 const body=open.slice(open.indexOf('let openingFile = false;'),open.lastIndexOf('} catch (error) {'));
 const fileCheck=body.indexOf('const rackFile = validateVideoFile(file);');
 assert.ok(fileCheck>0 && body.lastIndexOf('openingFile = true;',fileCheck)>0 && body.indexOf('openingFile = false;',fileCheck)>fileCheck,'checking the file blames the file');
 const afterCheck=body.indexOf('openingFile = false;',fileCheck);
 for(const step of ['await ensureNativeOutputRestored();','await switchVstProfile("video");','"VIDEO_RACK_LOAD_FAILED"','"VST_STATE_SAVE_FAILED"'])
  assert.ok(body.indexOf(step)>afterCheck && body.indexOf(step)<body.indexOf('openingFile = true;',afterCheck),`${step} does not blame the file`);
 assert.ok(body.indexOf('openingFile = true;',afterCheck)<body.indexOf('await videoPlayer!.open('),'the engine opening the file does');
 assert.match(body,/videoRackFile = rackFile;/);
 // A refused rack names the policy's reason in the log.
 assert.match(open,/const rejected = direct \? "DIRECT_OUTPUT_HAS_NO_RACK" : pluginPolicy\.checkRack\(rackPlugins\);\s*if \(rejected\) \{\s*writeLog\("VST", `video rack refused: \$\{rejected\}`\);\s*return refuseVideoOpen\(playbackToken, "VIDEO_RACK_INVALID"\);/);
 // The player publishes a failure without a token as no play request's.
 const player=new VideoPlayer('unused','unused',()=>{});
 player.state={...emptyVideoState(),playbackToken:'track:1'};
 player.fail(undefined,'VIDEO_RACK_LOAD_FAILED');
 assert.equal(player.state.error,'VIDEO_RACK_LOAD_FAILED');assert.equal(player.state.playbackToken,undefined);
});

test('a failure without an engine is no longer fullscreen and asks for no return',()=>{
 const changes=[],player=new VideoPlayer('unused','unused',s=>changes.push(s));
 player.state={...emptyVideoState(),standalone:true,returnRequested:true,playbackToken:'old:1'};
 player.fail('track:5','VIDEO_RACK_LOAD_FAILED');
 assert.equal(player.state.standalone,false);assert.equal(player.state.returnRequested,false);
 assert.equal(player.state.error,'VIDEO_RACK_LOAD_FAILED');assert.equal(player.state.playbackToken,'track:5');
 assert.equal(changes.length,1);
});
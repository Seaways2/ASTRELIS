const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {VideoPlayer}=require('../../dist-electron/videoPlayer');
const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(root,'release-work/video-dsp-'));
const source=path.join(dir,'tracks.mkv'),settings=path.join(dir,'video-dsp.json');
execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-f','lavfi','-i','anullsrc=r=48000:cl=5.1','-t','4','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-c:a','pcm_s16le',source],{windowsHide:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){for(let n=0;n<100;n++){if(fn())return;await wait(50);}throw Error('timeout');}
const make=()=>new VideoPlayer(path.join(root,'video-engine/mpv.exe'),path.join(dir,'mpv.log'),()=>{},settings);
let p=make();
(async()=>{try{
 await p.open(source,false,undefined,'dsp',true);await until(()=>p.state.ready&&p.state.sourceChannels===2);
 await p.control('dsp',JSON.stringify({enabled:true,compare:false,spatial:65,dialogue:25}));
 assert.equal(p.state.dspStatus,'active');assert.equal((await p.request(['get_property','af']))[0].label,'astrelis_dsp');
 await p.control('audio',2);await until(()=>p.state.sourceChannels===6);assert.equal(p.state.outputChannels,2);assert.equal(p.state.dspStatus,'active');assert.equal((await p.request(['get_property','af']))[0].label,'astrelis_dsp');
 await p.control('audio',1);try{await until(()=>p.state.sourceChannels===2);}catch(e){console.error('track return state',p.state,'raw',await p.request(['get_property','audio-params']));throw e;}assert.equal(p.state.dspStatus,'active');
 await p.control('dsp',JSON.stringify({...p.state.dsp,compare:true}));assert.equal((await p.request(['get_property','af'])).length,0);
 await p.close();p=make();await p.open(source,false,undefined,'dsp',true);await until(()=>p.state.ready&&p.state.sourceChannels===2);
 assert.equal(p.state.dsp.spatial,65);assert.equal(p.state.dsp.compare,false);assert.equal((await p.request(['get_property','af']))[0].label,'astrelis_dsp');
 await p.control('dsp',JSON.stringify({...p.state.dsp,enabled:false}));assert.equal((await p.request(['get_property','af'])).length,0);
 console.log('mpv stereo / multichannel track switching, live filters, bypass and restart settings PASS',dir);
 }finally{await p.close();}})().catch(e=>{console.error(e);p.dispose();process.exitCode=1;});

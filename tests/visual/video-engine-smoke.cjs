const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {VideoPlayer}=require('../../dist-electron/videoPlayer.js');
const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(root,'release-work/video-smoke-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label){for(let i=0;i<160;i++){if(predicate())return;await wait(100);}throw Error('Timeout: '+label);}
const player=new VideoPlayer(path.join(root,'video-engine/mpv.exe'),path.join(dir,'mpv.log'),()=>{});
(async()=>{
  for(const codec of ['aac','dca']){
    const file=path.join(dir,`视频 ${codec}.mkv`);
    execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-af','volume=0.01','-c:a',codec,...(codec==='dca'?['-strict','-2']:[]),file],{windowsHide:true});
    await player.open(file,false);
    await until(()=>player.state.ready&&player.state.position>.3,'play '+codec);
    assert.equal(player.state.error,'');assert.ok(player.state.output,JSON.stringify(player.state));
    await player.control('toggle');await until(()=>player.state.paused,'pause');
    await player.control('seek',4);await until(()=>Math.abs(player.state.position-4)<.3,'seek');
    const sub=path.join(dir,`${codec}.srt`);fs.writeFileSync(sub,'1\n00:00:00,000 --> 00:00:10,000\nASTRELIS subtitle test\n');
    await player.addSubtitle(sub);await until(()=>player.state.tracks.some(t=>t.type==='sub'),'subtitle');
    await player.control('subtitle','no');
    await player.control('fullscreen');await player.control('fullscreen');
    await player.control('toggle');await until(()=>!player.state.paused&&player.state.position>4.3,'resume');
    console.log(codec,JSON.stringify(player.state));
    await player.close();assert.equal(player.state.active,false);
  }
  const multi=path.join(dir,'multi-audio.mkv');
  execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-v','error','-i',path.join(dir,'视频 aac.mkv'),'-map','0:v:0','-map','0:a:0','-map','0:a:0','-c','copy',multi],{windowsHide:true});
  await player.open(multi,false);await until(()=>player.state.ready&&player.state.tracks.filter(t=>t.type==='audio').length===2,'two audio tracks');
  await player.control('audio',2);await until(()=>player.state.tracks.some(t=>t.type==='audio'&&t.id===2&&t.selected),'audio track switch');
  await player.control('seek',11.5);await until(()=>player.state.ended,'end of file');
  await player.control('toggle');await until(()=>!player.state.ended&&player.state.position<2&&!player.state.paused,'restart after end');
  await player.close();
  const hevc=path.join(dir,'HEVC.mp4');
  execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','3','-c:v','libx265','-preset','ultrafast','-x265-params','log-level=error',hevc],{windowsHide:true});
  await player.open(hevc,false);await until(()=>player.state.ready&&player.state.position>.2,'HEVC video');
  assert.equal(player.state.videoCodec,'hevc');await player.close();
  const wmv=path.join(dir,'测试 WMV.wmv');
  execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','3','-c:v','wmv2','-c:a','wmav2',wmv],{windowsHide:true});
  await player.open(wmv,false);await until(()=>player.state.ready&&player.state.position>.2,'WMV video');
  assert.equal(player.state.videoCodec,'wmv2');assert.equal(player.state.audioCodec,'wmav2');await player.close();
  const bad=path.join(dir,'broken.mp4');fs.writeFileSync(bad,'not a video');await player.open(bad,false);
  await until(()=>!!player.state.error,'invalid file error');await player.close();
  console.log('H264/HEVC/WMV2, AAC/DTS/WMA PCM output, seek, pause, audio track switch, subtitles, EOF restart, fullscreen, close/reopen and decode error: PASS',dir);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>player.dispose());

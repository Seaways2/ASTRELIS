const { ffmpeg: ffmpegExecutable } = require("./helpers/ffmpeg.cjs");
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {VideoPcmBridge,videoPcmArguments}=require('../../dist-electron/videoPcmBridge.js');
const {videoArguments,VideoPlayer}=require('../../dist-electron/videoPlayer.js');
const root=path.resolve(__dirname,'../..'),ffmpeg=ffmpegExecutable;

test('video rack isolates mpv output and rejects encoded passthrough',async()=>{
  const args=videoArguments('pipe',false,'log',undefined,true);
  assert.ok(args.includes('--ao=null'));assert.ok(args.includes('--audio-spdif='));
  assert.ok(!args.includes('--ao=wasapi'));
  assert.ok(!videoPcmArguments(path.resolve('video.mp4'),0,0).includes('-re'));
  await assert.rejects(new VideoPlayer('unused','unused',()=>{}).open('unused',true,undefined,undefined,false,'zh-CN',true),/VIDEO_RACK_DIRECT_CONFLICT/);
  assert.throws(()=>videoPcmArguments('relative.mp4',0,0),/VIDEO_PCM_SOURCE_INVALID/);
  assert.throws(()=>videoPcmArguments(path.resolve('video.mp4'),-1,0),/VIDEO_PCM_SOURCE_INVALID/);
});

test('ffmpeg stereo packets reach the native PCM contract; stop and restart discard the old stream',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-video-pcm-'));
  const file=path.join(dir,'测试 音频.wav'),commands=[],packets=[],failures=[];
  let startedAt=Date.now(),sessionPackets=0,sessionCount=0;
  execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-ac','2',file],{windowsHide:true});
  const bridge=new VideoPcmBridge(ffmpeg,async command=>{
    commands.push(command);
    if(command.type==='pcm-start'){startedAt=Date.now();sessionPackets=0;sessionCount++;}
    if(command.type==='status')return {ok:true,captureConsumedFrames:Math.min(sessionPackets*1024,Math.floor((Date.now()-startedAt)*48)),pluginLatencySamples:sessionCount===2?4800:0,sampleRate:48000};
    return {ok:true};
  },packet=>{
    assert.equal(packet.sampleRate,48000);assert.equal(packet.channels,2);assert.equal(packet.frames,1024);
    assert.equal(packet.pcm.length,8192);packets.push(packet);sessionPackets++;return true;
  },error=>failures.push(error));
  try {
    await bridge.start(file,0,0,0.4);
    assert.equal(bridge.running,true);
    // start() resolves when the playback clock advances, not at a fixed packet count.
    const packetDeadline=Date.now()+3000;
    while(packets.length<6 && !failures.length && Date.now()<packetDeadline)
      await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(failures.length,0);assert.ok(packets.length>=6,"PCM packets continue after clock startup");
    assert.ok(commands.some(command=>command.type==='pcm-start'));
    assert.ok(commands.some(command=>command.type==='volume'&&command.value===0.4));
    await bridge.withStatusPaused(async()=>{
      const before=commands.filter(command=>command.type==='status').length;
      await new Promise(resolve=>setTimeout(resolve,240));
      assert.equal(commands.filter(command=>command.type==='status').length,before,
        'a slow plugin command must not queue short-timeout status requests behind it');
    });
    const resumedAt=commands.filter(command=>command.type==='status').length;
    await new Promise(resolve=>setTimeout(resolve,180));
    assert.ok(commands.filter(command=>command.type==='status').length>resumedAt,'status polling resumes after plugin command');
    await bridge.stop();assert.equal(bridge.running,false);
    const firstSession=packets[0].mediaSessionId;
    await bridge.start(file,0,1.5,0.7);
    assert.ok(bridge.clock>=1.5&&bridge.clock<1.7,`VST latency compensated clock: ${bridge.clock}`);
    assert.ok(packets.some(packet=>packet.mediaSessionId!==firstSession&&packet.sequence===1));
    await bridge.stop();assert.equal(failures.length,0);
    assert.equal(commands.filter(command=>command.type==='pcm-stop').length,2);
  }finally{await bridge.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

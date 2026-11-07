const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {VideoPcmBridge}=require('../../dist-electron/videoPcmBridge.js');
const {VideoPlayer}=require('../../dist-electron/videoPlayer.js');
const root=path.resolve(__dirname,'../..');
const dir=fs.mkdtempSync(path.join(root,'release-work/video-vst-'));
const file=path.join(dir,'测试 视频 VST.mp4');
execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-y','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','24','-c:v','libx264','-preset','ultrafast',
  '-af','volume=0.001','-c:a','aac',file],{windowsHide:true});
const engine=spawn(path.join(root,'native-host/build/AuralisPluginHost_artefacts/Release/AuralisPluginHost.exe'),['--engine'],
  {windowsHide:true,stdio:['pipe','pipe','pipe']});
const player=new VideoPlayer(path.join(root,'video-engine/mpv.exe'),path.join(dir,'mpv.log'),()=>{});
let buffer='',id=0;
const pending=new Map();
engine.stdout.on('data',data=>{
  buffer+=data;let end;
  while((end=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    try {const response=JSON.parse(line),item=pending.get(response.requestId);
      if(item){pending.delete(response.requestId);clearTimeout(item.timer);item.resolve(response);}}
    catch(error){console.error(error);}
  }
});
function command(value){return new Promise((resolve,reject)=>{
  const requestId=String(++id),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Native timeout: '+value.type));},10000);
  pending.set(requestId,{resolve,timer});engine.stdin.write(JSON.stringify({...value,requestId,protocolVersion:1})+'\n');
});}
function packet(value){
  if(!engine.stdin.writable||engine.stdin.writableLength>4*1024*1024)return false;
  const {pcm,...meta}=value;
  engine.stdin.write(JSON.stringify({type:'pcm-data',...meta,data:pcm.toString('base64')})+'\n');
  return true;
}
const bridge=new VideoPcmBridge(path.join(root,'ffmpeg/ffmpeg.exe'),command,packet,error=>console.error(error));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){for(let i=0;i<150;i++){if(predicate())return;await wait(40);}throw Error('Timeout: '+label);}
(async()=>{
  const plugin=process.env.ASTRELIS_TEST_PLUGIN_PATH&&process.env.ASTRELIS_TEST_PLUGIN_ID
    ?[{id:process.env.ASTRELIS_TEST_PLUGIN_ID,path:process.env.ASTRELIS_TEST_PLUGIN_PATH,enabled:true}]:[];
  const rack=await command({type:'rack',plugins:plugin});assert.equal(rack.ok,true,JSON.stringify(rack));
  await player.open(file,false,undefined,'video-vst-smoke',false,'zh-CN',true);
  await until(()=>player.state.ready&&player.state.tracks.some(track=>track.type==='audio'),'video ready');
  await player.control('pause');await until(()=>player.state.paused,'paused');
  await player.control('seek',0);
  await bridge.start(file,0,0,0.2);
  await player.control('play');
  const samples=[];
  for(let i=0;i<6;i++){
    await wait(2500);
    if(i===2&&Number(process.env.ASTRELIS_TEST_STALL_MS)>0)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Number(process.env.ASTRELIS_TEST_STALL_MS));
    const status=await command({type:'status'});
    assert.equal(status.ok,true,JSON.stringify(status));
    assert.ok(status.pcmPacketsAccepted>10,JSON.stringify(status));
    assert.equal(status.source,'browser-pcm');
    assert.equal(status.processingMode,plugin.length?'vst':'dry');
    const audioTime=Number(status.captureConsumedFrames)/48000;
    const drift=player.state.position-audioTime;
    samples.push({video:player.state.position,audio:audioTime,drift,buffer:status.captureBufferFrames,underruns:status.captureUnderruns,pluginLatency:status.pluginLatencySamples});
  }
  assert.ok(samples.every(s=>Math.abs(s.drift)<0.35),JSON.stringify(samples));
  assert.ok(samples.at(-1).underruns<=samples[0].underruns+1,JSON.stringify(samples));
  console.log('Video VST PCM native stream PASS',JSON.stringify(samples));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await player.close().catch(()=>{});await bridge.stop().catch(()=>{});
  player.dispose();engine.stdin.end();engine.kill();
});

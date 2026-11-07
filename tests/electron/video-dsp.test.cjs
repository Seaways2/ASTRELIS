const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {defaultVideoDsp,parseVideoDsp,videoDspFilter,videoDspStatus}=require('../../dist-electron/videoDsp');
const {VideoPlayer}=require('../../dist-electron/videoPlayer');
const effect={enabled:true,spatial:80,dialogue:30};
test('DSP validation, passthrough and legacy settings migration',()=>{
 for(const bad of [null,{}, {...effect,spatial:NaN},{...effect,dialogue:101},{...effect,enabled:1}])assert.throws(()=>parseVideoDsp(bad));
 assert.equal(videoDspFilter(effect,true,2),'');
 assert.deepEqual(parseVideoDsp({...effect,compare:true}),effect);
 assert.equal(videoDspFilter(defaultVideoDsp(),false,2),'');
 assert.equal(videoDspStatus(effect,false,6),'multichannel');
 assert.equal(videoDspStatus(effect,true,2),'direct');
});
function render(input, channels, dsp, rate=48000) {
 const f=videoDspFilter(dsp,false,2),graph=f.slice(f.indexOf('[')+1,-1);
 const r=spawnSync(path.resolve('ffmpeg/ffmpeg.exe'),['-v','error','-f','f32le','-ar',String(rate),'-ac',String(channels),'-i','pipe:0','-af',graph,'-f','f32le','pipe:1'],{input,maxBuffer:8*1024*1024});
 assert.equal(r.status,0,r.stderr.toString());assert.equal(r.stdout.length,input.length/channels*2);return r.stdout;
}
function signal(channels, sample, rate=48000) {
 const b=Buffer.alloc(rate*channels*4);for(let n=0;n<rate;n++)for(let c=0;c<channels;c++)b.writeFloatLE(sample(n,c,rate),4*(n*channels+c));return b;
}
function rms(b, from=0) {let e=0;for(let n=from;n<b.length;n+=4)e+=b.readFloatLE(n)**2;return Math.sqrt(e/((b.length-from)/4));}
test('only a stereo PCM endpoint receives a filter; its graph downmixes first',()=>{
 for(const channels of [0,1,6,8])assert.equal(videoDspFilter(effect,false,channels),'');
 assert.match(videoDspFilter(effect,false,2),/aformat=channel_layouts=stereo,asplit/);
 for(const sourceChannels of [1,6,8]){
  const source=signal(sourceChannels,(n,c)=>c===2?0.15:0);
  const out=render(source,sourceChannels,{...effect,spatial:0,dialogue:100});
  assert.equal(out.length,source.length/sourceChannels*2);
  if(sourceChannels>2) assert.ok(rms(out)>0.02,'centre channel must survive downmix');
 }
});
test('spatial effect creates measurable delayed stereo reflections on centered audio',()=>{
 const input=signal(2,n=>n===0?0.5:0);
 const result=render(input,2,{...effect,spatial:100,dialogue:0});
 assert.ok(rms(result,480*2*4)>0.001,'there must be a reflection tail after the dry impulse');
 let difference=0;for(let n=0;n<result.length;n+=8)difference+=Math.abs(result.readFloatLE(n)-result.readFloatLE(n+4));
 assert.ok(difference>0.1,'mono-compatible input must gain spatial differences');
});
test('dialogue preset measurably raises a quiet centered voice band, not side-only sound',()=>{
 const centre=signal(2,(n,c,r)=>0.02*Math.sin(2*Math.PI*1600*n/r));
 const side=signal(2,(n,c,r)=>0.02*Math.sin(2*Math.PI*1600*n/r)*(c?-1:1));
 const preset={...effect,spatial:0,dialogue:100};
 const gain=rms(render(centre,2,preset),8000)/rms(centre,8000);
 assert.ok(gain>2,`voice-band amplitude gain ${gain} must exceed 6 dB`);
 const sideGain=rms(render(side,2,preset),8000)/rms(side,8000);assert.ok(Math.abs(sideGain-1)<0.001);
});
test('strong settings remain bounded and finite at common sample rates',()=>{
 for(const rate of [44100,48000,96000])for(const [spatial,dialogue] of [[100,0],[0,100],[100,100]]){
  const input=signal(2,(n,c)=>Math.sin(n*0.113+c*0.2)*0.99,rate);
  const result=render(input,2,{...effect,spatial,dialogue},rate);
  for(let n=0;n<result.length;n+=4){const v=result.readFloatLE(n);assert.ok(Number.isFinite(v)&&Math.abs(v)<=0.92001,`peak ${v}`);}
 }
});
test('settings persist without retired comparison and failure does not commit config',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-dsp-')),file=path.join(dir,'settings.json');
 try {
  const p=new VideoPlayer('unused','unused',()=>{},file);p.state.active=true;p.state.sourceChannels=2;p.state.outputChannels=2;p.child={};p.request=async()=>{};
  await p.control('dsp',JSON.stringify({...effect,compare:true}));
  const restored=new VideoPlayer('unused','unused',()=>{},file);assert.equal(restored.state.dsp.compare,undefined);assert.equal(restored.state.dsp.spatial,80);
  p.request=async()=>{throw Error('filter failed');};await assert.rejects(p.control('dsp',JSON.stringify({...effect,spatial:20})));assert.equal(p.state.dsp.spatial,80);
  assert.equal(JSON.parse(fs.readFileSync(file)).spatial,80);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('space and dialogue no longer cancel each other',()=>{
 const combined={...effect,spatial:100,dialogue:80};
 assert.ok(videoDspFilter(combined,false,2));assert.equal(videoDspStatus(combined,false,2),'active');
 const input=signal(2,(n,c,r)=>0.02*Math.sin(2*Math.PI*1600*n/r));
 assert.ok(rms(render(input,2,combined))>rms(input)*1.5);
});

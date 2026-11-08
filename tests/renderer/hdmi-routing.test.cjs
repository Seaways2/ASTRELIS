const { readAppSource } = require("./helpers/appSource.cjs");
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadPlayerStore, makeTrack} = require('./helpers/player-store-harness.cjs');
test('DTS and Dolby files survive import even without readable tags',async()=>{
  const prepared=[];
  const {store}=loadPlayerStore({parseBlob:async()=>{throw Error('No tags')},desktop:{getFilePath:f=>'K:/music/'+f.name,library:{prepare:async p=>{prepared.push(p);return {ok:true,path:p+'.wav',url:'converted'}}}}});
  const files=['track.DTS','track.ac3','track.eac3','notes.txt'].map(name=>({name,size:10,lastModified:1}));
  await store.getState().addTracks(files);
  assert.equal(store.getState().tracks.length,3);
  assert.equal(prepared.length,3);
  store.setState(s=>({tracks:[],uiSettings:{...s.uiSettings,hdmiDirectEnabled:true,hdmiEndpointId:'endpoint'}}));
  await store.getState().addTracks(files);
  assert.equal(store.getState().tracks.length,3);
  assert.equal(prepared.length,3);
  assert.ok(store.getState().tracks.every(t=>t.sourcePath===t.nativePath));
});
test('HDMI preserves the source file and does not apply ordinary PCM preparation to encoded input', async () => {
  let prepared = 0;
  const {store} = loadPlayerStore({desktop:{library:{prepare:async()=>{prepared++;return{ok:true,path:'converted.wav',url:'converted'};}}}});
  store.setState(s=>({tracks:[{...makeTrack('dts'),sourcePath:'original.wav',nativePath:'original.wav'}],uiSettings:{...s.uiSettings,hdmiDirectEnabled:true,hdmiEndpointId:'endpoint'}}));
  await store.getState().playTrack(0);
  assert.equal(prepared,0);assert.equal(store.getState().tracks[0].sourcePath,'original.wav');
  store.getState().setUiSetting('hdmiDirectEnabled',false);
  await store.getState().playTrack(0);assert.equal(prepared,1);
});
test('online routes stay Web Direct for every local preference; HDMI always bypasses VST',()=>{
  const app=readAppSource();
  const expression=name=>app.match(new RegExp('const '+name+' = (.*);'))[1];
  const evaluate=Function('state','current','onlineDirectSource','nativeReadable','vstControlRequested',
    `const videoActive=false,videoRackEnabled=false,videoDirect=false,isVideoTrack=()=>false;const hdmiDirect=${expression('hdmiDirect')}; return {native:${expression('nativePlayback')},vst:${expression('vstControlActive')}};`);
  for(const nativeOutputEnabled of [false,true])for(const hdmiDirectEnabled of [false,true])for(const online of [false,true]){
    const state={uiSettings:{nativeOutputEnabled,hdmiDirectEnabled}};
    const actual=evaluate(state,{sourcePath:'file.flac'},online,true,true);
    assert.equal(actual.native,!online&&(nativeOutputEnabled||hdmiDirectEnabled));
    assert.equal(actual.vst,!online&&!hdmiDirectEnabled&&nativeOutputEnabled);
    if (hdmiDirectEnabled && !online) assert.equal(evaluate(state,{},false,false,true).native,true,'missing local path must fail in the native route, never fall back to Web playback');
  }
});

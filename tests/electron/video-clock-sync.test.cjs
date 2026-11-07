const {test}=require('node:test');
const assert=require('node:assert/strict');
const {videoClockCorrection}=require('../../dist-electron/videoClockSync.js');
const {VideoPlayer}=require('../../dist-electron/videoPlayer.js');
test('audio clock compensates startup stalls and latency changes in both directions',()=>{
 assert.deepEqual(videoClockCorrection(10,13),{speed:1,seek:10});
 assert.deepEqual(videoClockCorrection(13,10),{speed:1,seek:13});
 assert.equal(videoClockCorrection(10.1,10).speed,1.03);
 assert.equal(videoClockCorrection(9.9,10).speed,.97);
 assert.deepEqual(videoClockCorrection(10.02,10),{speed:1});
 assert.deepEqual(videoClockCorrection(NaN,10),{speed:1});
});
test('clock correction cannot seek after pause or affect non-rack playback',async()=>{
 const player=new VideoPlayer('unused','unused',()=>{}),commands=[];
 Object.assign(player.state,{active:true,ready:true,paused:false,rackAudio:true});
 let release;
 player.request=async command=>{commands.push(command);if(command[0]==='get_property')return new Promise(r=>release=r)};
 const pending=player.synchronizeAudioClock(10);
 await player.control('pause');player.state.paused=true;release(14);await pending;
 assert.equal(commands.some(c=>c[0]==='seek'),false);
 player.state.rackAudio=false;player.state.paused=false;commands.length=0;
 await player.synchronizeAudioClock(10);assert.equal(commands.length,0);
});
test('large clock error seeks video without restarting PCM',async()=>{
 const player=new VideoPlayer('unused','unused',()=>{}),commands=[];
 Object.assign(player.state,{active:true,ready:true,paused:false,rackAudio:true});
 player.request=async c=>{commands.push(c);return c[0]==='get_property'?14:undefined};
 await player.synchronizeAudioClock(10);
 assert.deepEqual(commands.at(-1),['seek',10,'absolute+exact']);
 await player.synchronizeAudioClock(10);assert.equal(commands.length,3);
});

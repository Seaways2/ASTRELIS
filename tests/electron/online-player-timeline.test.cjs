const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { onlinePlayerTimelineScript, onlinePlayerSeekScript } = require('../../dist-electron/onlinePlayerTimeline');
test('29 seconds of stream data uses the full 115 second song for display and seek', () => {
  for (const staleResponse of [false, true]) {
    const messages = [], calls = [];
    const player = {getCurrentTime:()=>6,getDuration:()=>29,
      getVideoData:()=>({video_id:'current'}),
      getPlayerResponse:()=>({videoDetails:{videoId:staleResponse?'previous':'current',lengthSeconds:staleResponse?'300':'115'}}),
      seekTo:position=>calls.push(position)};
    const context = vm.createContext({
      window:{postMessage:m=>messages.push(m.state)},location:{origin:'https://music.youtube.com'},
      document:{getElementById:()=>player,querySelector:selector=>selector.includes('.time-info')?{textContent:'0:06 / 1:55'}:null,
        querySelectorAll:()=>[],addEventListener(){}},
      navigator:{},setInterval(){},queueMicrotask
    });
    vm.runInContext(onlinePlayerTimelineScript(),context);
    assert.equal(messages[0].duration,115);
    assert.equal(messages[0].currentTime,6);
    vm.runInContext('(() => {'+onlinePlayerSeekScript(110)+'})()',context);
    assert.deepEqual(calls,[110]);
  }
});
test('seek near end then automatic advance uses song time on a continuous media timeline', () => {
  let songTime = 36, songDuration = 264, songId = 'first';
  const calls = [], messages = [], timers = [];
  const media = {currentTime:36,duration:264,paused:false,ended:false,readyState:4};
  const player = {getCurrentTime:()=>songTime,getDuration:()=>songDuration,getVideoData:()=>({video_id:songId}),
    getPlayerResponse:()=>({videoDetails:{videoId:songId,lengthSeconds:String(songDuration)}}),
    seekTo:(position,allow)=>{calls.push([position,allow]);songTime=position;media.currentTime=position;}};
  const context = vm.createContext({
    window:{postMessage:m=>messages.push(m.state)},location:{origin:'https://music.youtube.com'},
    document:{getElementById:()=>player,querySelector:()=>media,querySelectorAll:()=>[media],addEventListener(){}},
    navigator:{mediaSession:{metadata:{title:'First'}}},setInterval:cb=>timers.push(cb),queueMicrotask
  });
  vm.runInContext(onlinePlayerTimelineScript(),context);
  vm.runInContext('(() => {'+onlinePlayerSeekScript(261)+'})()',context);
  timers[0]();
  // The same media element continues its MSE clock when the next song begins.
  media.currentTime=264;media.duration=330;songTime=0;songDuration=180;songId='second';
  timers[0]();
  media.currentTime=265;songTime=1;timers[0]();
  assert.deepEqual(messages.map(m=>m.currentTime),[36,261,0,1]);
  assert.equal(messages[2].duration,180);
  assert.equal(messages[2].rawPosition,264);
  // The metadata title is still "First", but waveform identity has changed.
  assert.deepEqual(messages.map(m=>m.trackId),['first','first','second','second']);
  assert.deepEqual(calls,[[261,true]]);
  vm.runInContext('(() => {'+onlinePlayerSeekScript(10)+'})()',context);
  assert.deepEqual(calls.at(-1),[10,true]);
});
test('missing player seek API cannot write directly to the raw media timeline', () => {
  const context = vm.createContext({document:{getElementById:()=>null}});
  const result=vm.runInContext('(() => {'+onlinePlayerSeekScript(200)+'})()',context);
  assert.equal(result.ok,false);
});
test('timeline installation is idempotent and tolerates player appearing later', () => {
  let player=null;const timers=[],messages=[];
  const context=vm.createContext({window:{postMessage:m=>messages.push(m)},location:{origin:'https://music.youtube.com'},
    document:{getElementById:()=>player,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},
    navigator:{},setInterval:cb=>timers.push(cb),queueMicrotask});
  vm.runInContext(onlinePlayerTimelineScript(),context);vm.runInContext(onlinePlayerTimelineScript(),context);
  assert.equal(timers.length,1);
  player={getCurrentTime:()=>0,getDuration:()=>180};timers[0]();
  assert.equal(messages.length,1);
});

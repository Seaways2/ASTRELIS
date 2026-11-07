const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {onlineVolumeScript}=require('../../dist-electron/onlineVolume');
test('repeated timeline reports do not reapply volume or mute',()=>{
 const calls=[];
 const player={setVolume:v=>calls.push(['volume',v]),mute:()=>calls.push(['mute']),unMute:()=>calls.push(['unmute'])};
 const context=vm.createContext({window:{},document:{getElementById:()=>player}});
 vm.runInContext(onlineVolumeScript(.5,false),context);
 for(let i=0;i<100;i++)context.window.__astrelisFlushVolume();
 assert.deepEqual(calls,[['volume',50],['unmute']]);
 vm.runInContext(onlineVolumeScript(.5,false),context);
 assert.equal(calls.length,2);
 vm.runInContext(onlineVolumeScript(.25,true),context);
 assert.deepEqual(calls.slice(2),[['volume',25],['mute']]);
});
test('latest volume is applied once when the player appears or is replaced',()=>{
 let player=null;const calls=[];
 const make=()=>({setVolume:v=>calls.push(v),mute(){},unMute(){}});
 const context=vm.createContext({window:{},document:{getElementById:()=>player}});
 vm.runInContext(onlineVolumeScript(.8,false),context);
 vm.runInContext(onlineVolumeScript(.3,false),context);
 player=make();context.window.__astrelisFlushVolume();context.window.__astrelisFlushVolume();
 assert.deepEqual(calls,[30]);
 player=make();context.window.__astrelisFlushVolume();
 assert.deepEqual(calls,[30,30]);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('online preload keeps direct playback and analyses only its current media element',()=>{
 const source=fs.readFileSync(require.resolve('../../dist-electron/online-preload.js'),'utf8');
 assert.ok(source.includes('captureStream'));
 assert.ok(source.includes('querySelectorAll("video, audio")'));
 assert.ok(source.includes('silent.gain.value = 0'));
 assert.ok(source.includes('online:analysis-frame'));
 assert.ok(!source.includes('getDisplayMedia'));
 assert.ok(!source.includes('createMediaElementSource'));
});
test('volume uses player API while custom output and native capture remain disabled',async()=>{
 const source=fs.readFileSync(require.resolve('../../dist-electron/main.js'),'utf8').replaceAll('electron_1.ipcMain','ipcMain');
 const callbacks={};
 const ipcMain={on:(name,cb)=>callbacks[name]=cb,handle:(name,cb)=>callbacks[name]=cb};
 const from=source.indexOf('ipcMain.on("browser:volume"');
 const to=source.indexOf('ipcMain.handle("browser:media-action"',from);
 const scripts=[];
 vm.runInNewContext(source.slice(from,to),{ipcMain,onlineVolume:1,onlineMuted:false,
 onlineView:{webContents:{isDestroyed:()=>false,executeJavaScript:async code=>scripts.push(code)}},
 onlineVolume_1:require('../../dist-electron/onlineVolume')});
 callbacks['browser:volume']({},0,true);
 assert.equal(scripts.length,1);
 assert.ok(scripts[0].includes('__astrelisVolumeRequest'));
 assert.equal(typeof callbacks['browser:set-output'],'function');
 assert.ok(source.includes('实验性 Native/VST 捕获已移除'));
});

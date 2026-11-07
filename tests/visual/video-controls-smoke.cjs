const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {VideoPlayer}=require('../../dist-electron/videoPlayer.js');
const root=path.resolve(__dirname,'../..'),dir=fs.mkdtempSync(path.join(root,'release-work/video-controls-'));
const source=process.argv[2]&&path.resolve(process.argv[2]);if(!source)throw Error('Pass a test video');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const p=new VideoPlayer(path.join(root,'video-engine/mpv.exe'),path.join(dir,'mpv.log'),()=>{});
(async()=>{for(const language of ['zh-CN','en-US','ja-JP']){
 await p.open(source,false,undefined,'test',true,language);
 for(let n=0;n<100&&!p.state.ready;n++)await wait(100);
 assert.ok(p.state.ready);await wait(450);assert.equal(p.state.error,'');
 await p.request(['keypress','RIGHT']);await wait(350);
 assert.ok(p.state.position>=9,'seek shortcut applies');
 await p.request(['keypress','UP']);await wait(150);assert.equal(p.state.volume,55);
 await p.request(['screenshot-to-file',path.join(dir,language+'.png'),'window']);
 await p.control('fullscreen');await wait(150);assert.equal(p.state.returnRequested,true);
 await p.close();
 }
 await p.open(source,false,undefined,'test',true,'zh-CN');for(let n=0;n<100&&!p.state.ready;n++)await wait(100);
 p.child.kill();for(let n=0;n<100&&!p.state.returnRequested;n++)await wait(50);assert.equal(p.state.returnRequested,true);
 console.log('Localized standalone controls and return event PASS',dir);
})().catch(e=>{console.error(e);p.dispose();process.exitCode=1;});

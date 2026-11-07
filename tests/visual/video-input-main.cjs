const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),profile=process.env.ASTRELIS_VIDEO_TEST_PROFILE;
if(!profile||path.dirname(profile)!==path.join(root,'release-work'))throw Error('Isolated profile required');
app.setAppPath(root);app.getVersion=()=>require("../../package.json").version;app.setPath('userData',profile);app.setPath('sessionData',profile);delete process.env.VITE_DEV_SERVER_URL;
const source=path.join(profile,'input-test.mp4');
execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=size=320x180:rate=5','-t','180','-c:v','libx264','-preset','ultrafast',source],{windowsHide:true});
 const music=path.join(profile,'music-input.wav');
 execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-v','error','-f','lavfi','-i','sine=frequency=220','-af','volume=0.01','-t','180',music],{windowsHide:true});

let win,socket;const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=s=>win.webContents.executeJavaScript(s,true);
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await wait(100)}throw Error(label)}
const deadline=setTimeout(()=>app.exit(1),90000);require('../../dist-electron/main.js');
(async()=>{
 await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading()},'window');
 await until(()=>js(`Boolean(document.querySelector('.sidebar'))`),'ready');
 // Audit every sidebar page, including text in body portals; input selection remains available.
 const titles=await js(`[...document.querySelectorAll('.sidebar nav button')].map(b=>b.title)`);
 for(const title of titles){
  await js(`[...document.querySelectorAll('.sidebar nav button')].find(b=>b.title===${JSON.stringify(title)}).click()`);await wait(300);
  const selectable=await js(`[...document.querySelectorAll('#root *')].filter(e=>e.getClientRects().length&&!e.closest('input,textarea,[contenteditable="true"]')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&getComputedStyle(e).userSelect!=='none').map(e=>e.tagName+':'+e.textContent.slice(0,60))`);
  assert.deepEqual(selectable,[],title+' non-editable text');
 }
 win.webContents.debugger.attach('1.3');
 const {root:doc}=await win.webContents.debugger.sendCommand('DOM.getDocument');
 const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:doc.nodeId,selector:'input[type=file]'});
 await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[source,music]});
 await js(`document.querySelector('input[type=file]').dispatchEvent(new Event('change',{bubbles:true}))`);
 await until(async()=>{const s=await js('window.desktop.video.state()');return s.ready&&!s.paused},'video loaded');
 const key=async(key,type='keydown')=>js(`document.body.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`);
 await key(' ');await until(async()=>(await js('window.desktop.video.state()')).paused,'space pauses without focus');
 await js('window.desktop.video.control("seek",20)');await wait(600);
 await key('ArrowRight');await key('ArrowRight','keyup');
 await until(async()=>Math.abs((await js('window.desktop.video.state()')).position-25)<.2,'right 5s');
 await wait(600);await key('ArrowLeft');await key('ArrowLeft','keyup');
 await until(async()=>Math.abs((await js('window.desktop.video.state()')).position-20)<.2,'left 5s');
 await wait(600);await key('ArrowRight');await wait(2650);await key('ArrowRight','keyup');await wait(350);
 const held=(await js('window.desktop.video.state()')).position;assert.ok(held>=65,'hold accelerates after 2s');
 await wait(450);assert.equal((await js('window.desktop.video.state()')).position,held,'release stops');
 let volume=(await js('window.desktop.video.state()')).volume;
 await key('ArrowDown');await until(async()=>(await js('window.desktop.video.state()')).volume===volume-5,'global volume');
 await js(`document.body.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}))`);
 await until(async()=>(await js('window.desktop.video.state()')).volume===volume,'global wheel');
 assert.equal(await js(`getComputedStyle(document.querySelector('.waveform-timeline')).outlineStyle`),'none','seek does not focus canvas');
 await js(`(()=>{const input=document.createElement('input');input.id='editable-test';document.body.append(input);input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}))})()`);
 assert.ok((await js('window.desktop.video.state()')).paused,'editing does not toggle');
 assert.equal(await js(`getComputedStyle(document.querySelector('#editable-test')).userSelect`),'text');
 await js(`document.querySelector('#editable-test').remove()`);
 // Talk to the real mpv input layer (same bindings used by native embedded and fullscreen HWNDs).
 async function connect(){
  const processes=JSON.parse(execFileSync('powershell',['-NoProfile','-Command',"Get-CimInstance Win32_Process -Filter \"name = 'mpv.exe'\" | Select-Object CommandLine,ParentProcessId | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true}));
  const proc=(Array.isArray(processes)?processes:[processes]).find(p=>p.ParentProcessId===process.pid);
  const pipe=proc.CommandLine.match(/--input-ipc-server=([^" ]+)/)[1];
  socket=net.createConnection(pipe);await new Promise((r,j)=>{socket.once('connect',r);socket.once('error',j)});
 }
 const command=(...command)=>socket.write(JSON.stringify({command})+'\n');
 await connect();command('keypress','LEFT');await wait(600);
 assert.ok(Math.abs((await js('window.desktop.video.state()')).position-(held-5))<.2,'embedded native input forwarded');
 socket.destroy();
 assert.ok((await js(`window.desktop.video.control('detach','zh-CN')`)).ok);
 await until(async()=>(await js('window.desktop.video.state()')).standalone,'fullscreen');await connect();
 const before=(await js('window.desktop.video.state()')).position;command('keypress','RIGHT');await wait(600);
 assert.ok(Math.abs((await js('window.desktop.video.state()')).position-before-5)<.2,'fullscreen right 5s');
 volume=(await js('window.desktop.video.state()')).volume;command('keypress','WHEEL_DOWN');await wait(400);
 assert.equal((await js('window.desktop.video.state()')).volume,volume-5,'fullscreen wheel');
 command('keydown','LEFT');await wait(2600);command('keyup','LEFT');await wait(300);
 const stopped=(await js('window.desktop.video.state()')).position;assert.ok(stopped<before-30,'fullscreen held acceleration');await wait(400);assert.equal((await js('window.desktop.video.state()')).position,stopped);
 command('keypress','SPACE');await until(async()=>!(await js('window.desktop.video.state()')).paused,'fullscreen space');
 command('keypress','ESC');socket.destroy();await until(async()=>win.isVisible()&&!(await js('window.desktop.video.state()')).standalone,'return before music');await js('window.desktop.video.control("close")');
 console.log('Video input and selection audit PASS');clearTimeout(deadline);app.exit(0);
})().catch(async e=>{console.error(e);if(win&&!win.isDestroyed())console.error(await js(`({title:document.querySelector('.play')?.title, duration:document.querySelector('.waveform-timeline')?.getAttribute('aria-valuemax'),text:document.body.innerText.slice(-1500)})`));socket?.destroy();clearTimeout(deadline);app.exit(1)});

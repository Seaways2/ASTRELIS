const {app,BrowserWindow,ipcMain}=require('electron');
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
 win.webContents.debugger.attach('1.3');
 const key=async(key,type='keydown')=>js(`document.body.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`);
 for(const native of [process.env.ASTRELIS_TEST_NATIVE === "1"]) {
  await js(`localStorage.removeItem('astrelis.queues.v1');localStorage.setItem('auralis.ui.settings',JSON.stringify({...JSON.parse(localStorage.getItem('auralis.ui.settings')||'{}'),nativeOutputEnabled:${native}}));location.reload()`);
  await wait(1200);await until(()=>js(`Boolean(document.querySelector('input[type=file]'))`),'music reload');

  const {root:doc}=await win.webContents.debugger.sendCommand('DOM.getDocument');
  const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:doc.nodeId,selector:'input[type=file]'});
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[music]});
  await js(`document.querySelector('input[type=file]').dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(600);
  await js(`document.querySelector('.sidebar nav button[title="播放列表"]').click()`);
  await until(()=>js(`Boolean(document.querySelector('.queue-type-tabs button'))`),'music playlist');
  await js(`document.querySelector('.queue-type-tabs button:first-child').click()`);
  await until(()=>js(`[...document.querySelectorAll('.playlist-table .table-row')].some(r=>r.textContent.includes('music'))`),'music queued');
  await js(`[...document.querySelectorAll('.playlist-table .table-row')].find(r=>r.textContent.includes('music')).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  await until(()=>js(`!document.querySelector('.embedded-video') && Number(document.querySelector('.waveform-timeline')?.getAttribute('aria-valuemax'))>170`),'music ready');
  if(await js(`document.querySelector('.play').title==='播放'`)) await key(' ');
  await until(()=>js(`document.querySelector('.play')?.title==='暂停' && Number(document.querySelector('.waveform-timeline')?.getAttribute('aria-valuemax'))>170`),'music playing '+native);
  await until(()=>js(`Number(document.querySelector('.waveform-timeline').getAttribute('aria-valuenow'))>.3`),'music transport running '+native);
  await key(' ');await until(()=>js(`document.querySelector('.play').title==='播放'`),'music pause');await wait(400);
  const pos=()=>js(`Number(document.querySelector('.waveform-timeline').getAttribute('aria-valuenow'))`);
  await wait(1200);
  const initial=await pos();
  await key('ArrowRight');await key('ArrowRight','keyup');await until(async()=>Math.abs(await pos()-initial-5)<.4,'music forward');
  await wait(600);await key('ArrowLeft');await key('ArrowLeft','keyup');await until(async()=>Math.abs(await pos()-initial)<.4,'music backward');
  await wait(600);await key('ArrowRight');await wait(2600);await key('ArrowRight','keyup');await wait(300);
  const end=await pos();assert.ok(end-initial>=45,'music held acceleration');await wait(400);assert.ok(Math.abs(await pos()-end)<.2,'music release');
  const volume=()=>js(`Number(document.querySelector('.volume-popover-trigger').title.match(/(\\d+)%/)[1])/100`);
  const old=await volume();await key('ArrowDown');await until(async()=>Math.abs(await volume()-old+.05)<.001,'music volume keys');
  await js(`document.querySelector('.transport').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}))`);await until(async()=>Math.abs(await volume()-old)<.001,'music volume wheel');
  await js(`document.querySelector('.visualizer-transition-layer').dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}))`);await wait(200);assert.equal(await volume(),old,'visualizer wheel leaves volume unchanged');
  assert.equal(await js(`getComputedStyle(document.querySelector('.waveform-timeline')).outlineStyle`),'none');
 }
 console.log('Isolated music shortcuts PASS',process.env.ASTRELIS_TEST_NATIVE);clearTimeout(deadline);app.exit(0);
})().catch(async e=>{console.error(e);console.error(await js(`document.body.innerText.slice(-1800)`));clearTimeout(deadline);app.exit(1)});

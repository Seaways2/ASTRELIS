const {app,BrowserWindow,dialog,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),profile=process.env.ASTRELIS_MEDIA_TEST_PROFILE;
if(!profile||path.dirname(profile)!==path.join(root,'release-work'))throw Error('Isolated profile required');
delete process.env.VITE_DEV_SERVER_URL;app.setAppPath(root);app.setPath('userData',profile);app.setPath('sessionData',profile);app.getVersion=()=>require('../../package.json').version;

const folder=path.join(profile,'Media');fs.mkdirSync(folder);
const seed=path.join(profile,'seed.wav');
execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-v','error','-f','lavfi','-i','sine=frequency=200','-t','0.1',seed],{windowsHide:true});
for(let i=0;i<30;i++){const sub=path.join(folder,'Folder '+String(i).padStart(2,'0'));fs.mkdirSync(sub);fs.copyFileSync(seed,path.join(sub,'Song.wav'));}
let scanIndex=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(folder,"Folder "+String(scanIndex++).padStart(2,"0"))]});
let win;const js=s=>win.webContents.executeJavaScript(s,true),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await wait(100)}throw Error(label)}
setTimeout(()=>app.exit(2),90000);require('../../dist-electron/main.js');

const click = async selector => {
 await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e.closest(":popover-open"))e.scrollIntoView({block:"nearest"})})()`);await wait(150);
 const r=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,hit:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}})()`);
 assert.ok(r.hit,'hit target '+selector);const z=win.webContents.getZoomFactor();
 win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(r.x*z),y:Math.round(r.y*z),button:'left',clickCount:1});
 win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(r.x*z),y:Math.round(r.y*z),button:'left',clickCount:1});await wait(150);
};
const toolsOpen=async()=>{if(await js(`(()=>{const e=document.querySelector('.library-tools-toggle');return getComputedStyle(e).display!=='none'&&e.getAttribute('aria-expanded')==='false'})()`))await click('.library-tools-toggle')};
const openMenu=async()=>{await toolsOpen();await click('.library-management .library-menu-trigger');await until(()=>js(`document.querySelector('.library-management .library-menu-popup').matches(':popover-open')`),'menu opens')};
(async()=>{
 await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading()},'window');
 await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title="媒体库"]'))`),'ready');
 await click('.sidebar nav button[title="媒体库"]');await until(()=>js(`Boolean(document.querySelector('.scan-action'))`),'library');
 for(let i=0;i<6;i++){console.log('scan root',i);await openMenu();await click('.scan-action');await until(()=>js(`!document.querySelector('.scan-action').disabled&&document.querySelectorAll('.library-folder-entry').length>0`),'scan');}
 for(const [view,w,h] of [['flow',1500,940],['flow',960,640],['cards',960,640],['details',960,640]]){
  await toolsOpen();await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.dataset.value===${JSON.stringify(view)}).click()`);
  win.setSize(w,h);await wait(1800);await openMenu();
  await click('.library-management .library-menu-trigger');assert.equal(await js(`document.querySelector('.library-management .library-menu-popup').matches(':popover-open')`),false,'trigger toggles closed');await openMenu();
  fs.writeFileSync(path.join(profile,'menu-'+view+'-'+w+'.png'),(await win.webContents.capturePage()).toPNG());
  assert.ok(await js(`(()=>{const b=[...document.querySelectorAll('.library-management .library-menu-popup button')].map(e=>e.getBoundingClientRect());return b.every(r=>Math.abs(r.height-b[0].height)<1&&Math.abs(r.width-b[0].width)<1)&&b.slice(1).every((r,i)=>Math.abs(r.top-b[i].bottom-6)<1)})()`),'uniform management buttons');
  await click('.folder-manager-action');await until(()=>js(`Boolean(document.querySelector('.library-folder-dialog[open]'))`),'folder dialog');
  assert.equal(await js(`document.querySelectorAll('.library-folder-dialog .library-managed-folder').length`),6);
  fs.writeFileSync(path.join(profile,'folders-'+view+'-'+w+'.png'),(await win.webContents.capturePage()).toPNG());
  await click('.library-folder-dialog .library-managed-folder:last-of-type > button');
  await click('.library-folder-dialog .library-managed-folder:last-of-type > div button:last-child');
  await click('.library-folder-dialog > header button');await until(()=>js(`!document.querySelector('.library-folder-dialog')`),'closed');
  await openMenu();await click('.library-management .icon-action');await until(()=>js(`!document.querySelector('.scan-action').disabled`),'rescan');
  await openMenu();await click('.library-batch-trigger');await until(()=>js(`Boolean(document.querySelector('.batch-match-dialog,.music-match-dialog'))`),'batch');
  await click('.batch-match-dialog header button, .music-match-dialog header button');
  // Cover flow has no sort menu; the grid views keep it.
  if (view !== 'flow') {
  await toolsOpen();await click('.library-sort-controls .library-menu-trigger');await click('.library-sort-controls .library-menu-popup button');
  await js(`document.querySelector('.library-sort-controls .library-menu-popup').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await js(`document.querySelector('.library-sort-controls .library-menu-popup').matches(':popover-open')`),false);
  }
  fs.writeFileSync(path.join(profile,'overlay-'+view+'-'+w+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 console.log('PASS: populated library, six roots, real mouse hit targets, folder modal, rescan/batch/sort, equal button sizes, flow/grid/list');app.exit(0);
})().catch(async e=>{console.error(e);if(win)fs.writeFileSync(path.join(profile,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1)});

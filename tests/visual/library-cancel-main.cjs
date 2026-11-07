const {app,BrowserWindow,dialog,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),profile=process.env.ASTRELIS_MEDIA_TEST_PROFILE;
if(!profile||path.dirname(profile)!==path.join(root,'release-work'))throw Error('Isolated profile required');
delete process.env.VITE_DEV_SERVER_URL;app.setAppPath(root);app.setPath('userData',profile);app.setPath('sessionData',profile);app.getVersion=()=>require('../../package.json').version;

const folder=path.join(profile,'Media');fs.mkdirSync(folder);
const seed=path.join(profile,'seed.wav');
execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-v','error','-f','lavfi','-i','sine=frequency=200','-t','0.1',seed],{windowsHide:true});
for(let i=0;i<30;i++){const sub=path.join(folder,'Folder '+String(i).padStart(2,'0'));fs.mkdirSync(sub);fs.copyFileSync(seed,path.join(sub,'Song.wav'));}
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});
let win;const js=s=>win.webContents.executeJavaScript(s,true),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await wait(100)}throw Error(label)}
let metadataCalls=0;
const {LibraryScanner}=require('../../dist-electron/library/scanner/LibraryScanner');
const originalScan=LibraryScanner.prototype.scanRoots;
LibraryScanner.prototype.scanRoots=async function(roots,progress,signal){
 const loader=this.options.metadataLoader;
 if(signal)this.options.metadataLoader=async()=>{const module=await loader();return {...module,parseFile:async(...args)=>{metadataCalls++;await wait(1000);return module.parseFile(...args)}}};
 try{return await originalScan.call(this,roots,progress,signal)}finally{this.options.metadataLoader=loader}
};
setTimeout(()=>app.exit(2),60000);require('../../dist-electron/main.js');

const click=async selector=>{
 const r=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,hit:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}})()`);
 assert.ok(r.hit,'click target '+selector);const z=win.webContents.getZoomFactor();
 win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(r.x*z),y:Math.round(r.y*z),button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(r.x*z),y:Math.round(r.y*z),button:'left',clickCount:1});await wait(50);
};
(async()=>{
 await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading()},'window');
 await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title="媒体库"]'))`),'ready');
 await click('.sidebar nav button[title="媒体库"]');await until(()=>js(`Boolean(document.querySelector('.scan-action'))`),'library');
 await click('.library-management .library-menu-trigger');await click('.scan-action');
 await until(()=>js(`!document.querySelector('.scan-action').disabled&&Boolean(document.querySelector('.library-folder-entry'))`),'initial scan');
 const before=await js('window.desktop.library.load()');assert.equal(before.tracks.length,30);
 await click('.library-management .library-menu-trigger');
 assert.ok(await js(`(()=>{const b=[...document.querySelectorAll('.library-management .library-menu-popup button')].map(e=>getComputedStyle(e));return b.every(c=>c.color===b[0].color&&c.backgroundColor===b[0].backgroundColor&&c.borderColor===b[0].borderColor)})()`),'uniform button palette');
 await click('.library-management .icon-action');await until(()=>metadataCalls>0,'metadata in flight');
 assert.equal((await js(`window.desktop.library.cancelScan('stale-request')`)).ok,false);
 assert.ok(await js(`(()=>{const p=document.querySelector('.scan-track').getBoundingClientRect(),b=document.querySelector('.library-scan-cancel').getBoundingClientRect();return b.left>=p.right&&b.right<=innerWidth})()`),'cancel is to the right of progress');
 await wait(350);
 fs.writeFileSync(path.join(profile,'scan-progress.png'),(await win.webContents.capturePage()).toPNG());
 await click('.library-scan-cancel');
 await until(()=>js(`!document.querySelector('.library-scan-cancel')&&!document.querySelector('.scan-action').disabled`),'cancel settled');
 const after=await js('window.desktop.library.load()');assert.equal(after.revision,before.revision,'cancel does not commit');assert.deepEqual(after.tracks,before.tracks,'cancel preserves media');
 assert.ok(metadataCalls<30,'queued metadata work stops');
 assert.ok(await js(`document.querySelector('.library-status').textContent.includes('扫描已取消')`),'localized cancellation status');
 await click('.library-management .library-menu-trigger');await click('.library-management .icon-action');
 await until(()=>js(`!document.querySelector('.scan-action').disabled&&!document.querySelector('.library-scan-cancel')`),'restart completed');
 assert.equal((await js('window.desktop.library.load()')).tracks.length,30);
 console.log('PASS actual rescan cancellation, stale request rejection, no commit/data loss, pending work stopped, restart, button palette');app.exit(0);
})().catch(async e=>{console.error(e);if(win)fs.writeFileSync(path.join(profile,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exit(1)});

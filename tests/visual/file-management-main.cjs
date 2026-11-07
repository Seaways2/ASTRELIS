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
setTimeout(()=>app.exit(2),45000);require('../../dist-electron/main.js');
(async()=>{
 await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading()},'window');
 await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title="媒体库"]'))`),'ready');
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.scan-action'))`),'scan ready');await js(`document.querySelector('.scan-action').click()`);
 await until(()=>js(`!document.querySelector('.scan-action').disabled&&Boolean(document.querySelector('.library-folder-entry'))`),'scanned');

 assert.equal(await js(`document.querySelectorAll('.library-hidden-indicator').length`),0,'ordinary items have no hidden indicator');
 const original=await js('window.desktop.library.load()');const target=original.tracks[0],other=original.tracks[1];
 assert.ok((await js(`window.desktop.library.visibility({action:'hide-file',id:${JSON.stringify(target.id)},password:'1234'})`)).ok);
 assert.equal((await js(`window.desktop.library.fileAction(${JSON.stringify(target.id)},'remove')`)).ok,false,'locked file cannot be removed through IPC');
 assert.equal((await js(`window.desktop.library.fileAction('not-in-library','reveal')`)).ok,false,'unknown file denied');
 const hidden=await js(`window.desktop.library.visibility({action:'status'})`);assert.deepEqual(hidden.roots,[target.sourcePath]);
 assert.ok(fs.existsSync(target.sourcePath)&&fs.existsSync(other.sourcePath));
 assert.ok((await js(`window.desktop.library.visibility({action:'unlock',password:'1234'})`)).ok);
 await js('location.reload()');await wait(1000);
 await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title="媒体库"]'))`),'reload');
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);await wait(300);
 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.textContent==="列表").click()`);await wait(300);
 await js(`document.querySelector('.library-folder-entry').click()`);await wait(300);
 await js(`document.querySelector('.library-folder-entry').click()`);await wait(300);
 await until(()=>js(`Boolean(document.querySelector('.library-track-entry'))`),'file card');
 assert.equal(await js(`document.querySelector('.library-track-entry .library-hidden-indicator')?.tagName`),'SPAN','unlocked hidden file has passive indicator');
 await js(`document.querySelector('.library-track-entry').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:250}))`);await wait(150);
 await js(`Array.from(document.querySelectorAll('.folder-protection-menu button')).find(b=>b.textContent.includes('取消隐藏')).click()`);
 await until(()=>js(`!document.querySelector('.library-hidden-indicator')`),'unhide clears indicator');
 await js(`document.querySelector('.library-track-entry').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:250}))`);await wait(150);
 const menu=await js(`document.querySelector('.folder-protection-menu').textContent`);
 assert.match(menu,/隐藏文件并设密码/);assert.match(menu,/封面管理/);assert.match(menu,/打开所在位置/);
 await js(`Array.from(document.querySelectorAll('.folder-protection-menu button')).find(b=>b.textContent.includes('从媒体库移除')).click()`);await wait(150);
 await js(`document.querySelector('.folder-protection-dialog').requestSubmit()`);
 await until(()=>js(`!document.querySelector('.folder-protection-dialog')`),'removed');
 const after=await js('window.desktop.library.load()');assert.equal(after.tracks.length,original.tracks.length-1);
 const removed=original.tracks.find(t=>!after.tracks.some(a=>a.id===t.id));assert.ok(fs.existsSync(removed.sourcePath),'original media untouched');
 console.log('PASS: file context menu, exact-file password policy, locked IPC denied, library removal preserves original');app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});

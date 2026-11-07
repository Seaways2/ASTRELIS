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

 await js(`document.querySelector('.sidebar nav button[title="外观设置"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.appearance-section select'))`),'appearance settings');
 await js(`(()=>{const e=document.querySelector('.appearance-section select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'light');e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await until(()=>js(`document.querySelector('.app-shell').classList.contains('theme-light')`),'light theme');
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-folder-entry'))`),'library in light mode');
 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.textContent==="3D 封面流").click()`);await wait(200);

 const folderSurface=await js(`getComputedStyle(document.querySelector('.media-flow-item.selected .library-folder-entry .cover-tile')).backgroundColor`);
 assert.equal(folderSurface,'rgb(228, 240, 245)','light empty folder matches pale audio cover');
 await wait(300);
 fs.writeFileSync(path.join(profile,'folder-cover-light.png'),(await win.webContents.capturePage()).toPNG());

 await js(`document.querySelector('.library-management > .library-menu-trigger').click()`);await wait(200);
 const menuTheme=await js(`(()=>{const p=document.querySelector('.library-management .library-menu-popup');return {open:p.matches(':popover-open'),bg:getComputedStyle(p).backgroundColor,button:getComputedStyle(p.querySelector('button')).color}})()`);
 assert.ok(menuTheme.open);assert.equal(menuTheme.bg,'rgba(226, 237, 242, 0.96)');assert.notEqual(menuTheme.button,'rgb(57, 217, 233)');
 fs.writeFileSync(path.join(profile,'management-menu-light.png'),(await win.webContents.capturePage()).toPNG());
 await js(`document.querySelector('.library-management > .library-menu-trigger').click()`);
 await js(`document.querySelector('.media-flow-item.selected .library-folder-entry').click()`);
 await until(()=>js(`document.querySelector('.media-flow-slider')?.max==='29'`),'parent folders');
 await js(`(()=>{const s=document.querySelector('.media-flow-slider');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,'15');s.dispatchEvent(new Event('change',{bubbles:true}));s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await until(()=>js(`document.querySelector('.media-flow-slider').value==='15'`),'selected 15');
 await js(`document.querySelector('.media-flow-item.selected .library-folder-entry').click()`);await wait(300);
 await js(`document.querySelector('.folder-breadcrumb button[title]').click()`);await wait(350);
 assert.equal(await js(`document.querySelector('.media-flow-slider').value`),'15','parent flow restores selected card');
 for(const view of ['列表','网格']){
 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.textContent==="${view}").click()`);await wait(350);

 const rail=await js(`(()=>{const e=document.querySelector('.page-content');return {width:getComputedStyle(e,'::-webkit-scrollbar').width,display:getComputedStyle(e,'::-webkit-scrollbar').display,color:getComputedStyle(e).scrollbarColor}})()`);
 assert.equal(rail.display,'block');assert.equal(rail.width,'12px');assert.notEqual(rail.color,'auto');
 fs.writeFileSync(path.join(profile,'scroll-'+view+'-light.png'),(await win.webContents.capturePage()).toPNG());
 await js(`document.querySelector('.page-content').scrollTop=600`);await wait(300);
 const top=await js(`document.querySelector('.page-content').scrollTop`);assert.ok(top>100);
 await js(`document.querySelector('.library-folder-entry').click()`);await wait(300);
 await js(`document.querySelector('.folder-breadcrumb button[title]').click()`);await wait(450);
 assert.ok(Math.abs((await js(`document.querySelector('.page-content').scrollTop`))-top)<2,view+' parent scroll restores');
 }
 console.log('PASS: parent card index 15 and list/grid scroll restoration');app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});

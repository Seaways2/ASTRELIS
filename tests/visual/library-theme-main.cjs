const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),profile=process.env.ASTRELIS_FIT_TEST_PROFILE;
if(!profile||path.dirname(profile)!==path.join(root,'release-work'))throw Error('Isolated profile required');
app.setAppPath(root);app.setPath('userData',profile);app.setPath('sessionData',profile);delete process.env.VITE_DEV_SERVER_URL;
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win;
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await wait(100)}throw Error(label)}
const js=s=>win.webContents.executeJavaScript(s,true);
setTimeout(()=>app.exit(2),60000);require('../../dist-electron/main.js');

const click=async selector=>{
 const r=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,hit:e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}})()`);assert.ok(r.hit,selector);const z=win.webContents.getZoomFactor();
 win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(r.x*z),y:Math.round(r.y*z),button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(r.x*z),y:Math.round(r.y*z),button:'left',clickCount:1});await wait(150);
};
(async()=>{
 await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading()},'window');await until(()=>js(`Boolean(document.querySelector('.sidebar'))`),'ready');
 await click('.sidebar nav button[title="媒体库"]');await until(()=>js(`Boolean(document.querySelector('.library-management'))`),'library');
 for(const theme of ['dark','light'])for(const width of [1280,720]){
  win.setSize(width,720);await wait(1800);
  await js(`(()=>{const a=document.querySelector('.app-shell');a.classList.toggle('theme-light',${theme==='light'});a.style.setProperty('--accent','#9b79e8')})()`);
  let surface;
  for(const name of ['library-media-filter','library-view-select','library-management','library-sort-controls']){
   if(name==='library-sort-controls'&&!(await js(`Boolean(document.querySelector('.library-sort-controls'))`)))continue; // hidden in cover flow
   await click('.'+name+' > .library-menu-trigger');
   const style=await js(`(()=>{const p=document.querySelector('.${name} .library-menu-popup'),r=p.getBoundingClientRect(),c=getComputedStyle(p);return {bg:c.backgroundColor,text:c.color,border:c.borderColor,visible:p.matches(':popover-open'),fits:r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}})()`);
   assert.ok(style.visible&&style.fits,JSON.stringify(style));if(surface)assert.deepEqual([style.bg,style.text,style.border],surface);else surface=[style.bg,style.text,style.border];
   fs.writeFileSync(path.join(profile,theme+'-'+width+'-'+name+'.png'),(await win.webContents.capturePage()).toPNG());
   if(name==='library-media-filter'){
    await click('.library-media-filter [data-value="audio"]');assert.equal(await js(`document.querySelector('.library-media-filter [aria-selected="true"]').dataset.value`),'audio');
   }else if(name==='library-view-select'){
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'End'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});await wait(100);win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await wait(150);assert.equal(await js(`document.querySelector('.library-view-select [aria-selected="true"]').dataset.value`),'details');
   }else await click('.'+name+' > .library-menu-trigger');
  }
 }
 console.log('PASS shared floating palette, dark/light themes, narrow/normal bounds, mouse selection and keyboard navigation');app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});

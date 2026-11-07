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

 for(const width of [1280,720]) {
  win.setSize(width,800);await wait(1000);
  for(const page of ['系统设置','外观设置','音频设备','插件管理']) {
   await click('.sidebar nav button[title="'+page+'"]');await wait(400);
   const headings=await js(`Array.from(document.querySelectorAll('.page-content h3.section-heading')).map(h=>{const i=h.querySelector('svg'),s=h.querySelector('span'),r=i.getBoundingClientRect(),t=s.getBoundingClientRect();return {text:s.textContent,width:r.width,height:r.height,gap:t.left-r.right,visible:r.left>=0&&t.right<=innerWidth+1,accent:getComputedStyle(i).color}})`);
   assert.ok(headings.length>0,page);
   for(const h of headings){assert.ok(Math.abs(h.width-18)<1);assert.ok(Math.abs(h.height-18)<1);assert.ok(Math.abs(h.gap-10)<1,JSON.stringify(h));assert.ok(h.visible,JSON.stringify(h));}
   fs.writeFileSync(path.join(profile,'heading-'+width+'-'+page+'.png'),(await win.webContents.capturePage()).toPNG());
  }
 }
 console.log('PASS section heading icons, spacing and bounds across four pages at normal/narrow widths');app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});

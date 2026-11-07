const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),profile=process.env.ASTRELIS_FIT_TEST_PROFILE;
if(!profile||path.dirname(profile)!==path.join(root,'release-work'))throw Error('Isolated profile required');
app.setAppPath(root);app.setPath('userData',profile);app.setPath('sessionData',profile);delete process.env.VITE_DEV_SERVER_URL;
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win;
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await wait(100)}throw Error(label)}
const js=s=>win.webContents.executeJavaScript(s,true);
setTimeout(()=>app.exit(2),60000);require('../../dist-electron/main.js');
(async()=>{
 await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading()},'window');
 for(const [locale,title] of [['zh-CN','媒体库'],['en-US','Media Library'],['ja-JP','ライブラリ']]){
  await until(()=>js(`Boolean(document.querySelector('.sidebar'))`),'ready');
  await js(`localStorage.setItem('auralis.ui.language',${JSON.stringify(locale)})`);win.webContents.reload();await wait(500);
  await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title=${JSON.stringify(title)}]'))`),'language');
  await js(`document.querySelector('.sidebar nav button[title=${JSON.stringify(title)}]').click()`);
  for(const [w,h] of [[1280,850],[640,480]]){
   win.setSize(w,h);await wait(1800);
   await js(`(()=>{const t=document.querySelector('.library-tools-toggle');if(t&&getComputedStyle(t).display!=='none'&&t.getAttribute('aria-expanded')==='false')t.click()})()`);
   await js(`document.querySelector('.library-management .library-menu-trigger').click()`);
   const fit=await js(`(()=>{const menu=document.querySelector('.library-management'),b=menu.querySelector('.library-batch-trigger'),r=b.getBoundingClientRect();return {open:menu.querySelector('.library-menu-popup').matches(':popover-open'),left:r.left,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,hit:b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}})()`);
   assert.ok(fit.open&&fit.left>=0&&fit.right<=fit.w+1&&fit.bottom<=fit.h&&fit.hit,JSON.stringify({locale,w,fit}));
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(100);
   assert.equal(await js(`document.querySelector('.library-management .library-menu-popup').matches(':popover-open')`),false);
   assert.ok(await js(`(()=>{const r=document.querySelector('.library-search').getBoundingClientRect();return r.width>100&&r.right<=innerWidth})()`),'usable search');
   fs.writeFileSync(path.join(profile,'toolbar-'+locale+'-'+w+'.png'),(await win.webContents.capturePage()).toPNG());
  }
 }
 console.log('PASS library toolbar: three languages, narrow/normal windows, menu hit targets and Escape');app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});

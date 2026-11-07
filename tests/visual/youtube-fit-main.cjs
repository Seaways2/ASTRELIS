const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),profile=process.env.ASTRELIS_FIT_TEST_PROFILE;
if(!profile||path.dirname(profile)!==path.join(root,'release-work'))throw Error('Isolated profile required');
app.setAppPath(root);app.setPath('userData',profile);app.setPath('sessionData',profile);delete process.env.VITE_DEV_SERVER_URL;
const wait=ms=>new Promise(r=>setTimeout(r,ms));let win;
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await wait(100)}throw Error(label)}
const js=s=>win.webContents.executeJavaScript(s,true);
// Isolated fixture uses a real WebContentsView without network/login dependence.
app.whenReady().then(()=>require('electron').session.fromPartition('persist:auralis-online').protocol.handle('https',()=>new Response('<html><body style="margin:0"><header style="height:60px">Web header</header><main style="position:absolute;inset:60px 0 0;background:#234">Content<div style="position:absolute;bottom:0">Bottom controls</div></main></body></html>',{headers:{'content-type':'text/html'}})));
setTimeout(()=>app.exit(2),60000);require('../../dist-electron/main.js');
(async()=>{
 await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading()},'window');
 await until(()=>js(`Boolean(document.querySelector('.sidebar'))`),'ready');
 await js(`document.querySelector('.sidebar nav button[title="在线音乐"]').click()`);
 await until(()=>win.contentView.children.length>0,'native web view');
 const view=win.contentView.children[0];
 for(const [width,height] of [[960,540],[640,400],[1120,720]]){
  win.setSize(width,height);await wait(1800);
  const zoom=win.webContents.getZoomFactor();assert.ok(Math.abs(view.webContents.getZoomFactor()-zoom)<.002,'web zoom follows app');
  const rect=await js(`(()=>{const r=document.querySelector('.browser-surface').getBoundingClientRect(),f=document.querySelector('footer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,footer:f.top}})()`);
  const controls=await js(`(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}};return {tabs:box('.online-provider-tabs'),buttons:[...document.querySelectorAll('.online-provider-tabs button')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom}}),toolbar:box('.browser-toolbar'),surface:box('.browser-surface')}})()`);
  for(const button of controls.buttons){
   assert.ok(button.top>=controls.tabs.top && button.bottom<=controls.tabs.bottom+1,'provider buttons fit their row '+JSON.stringify(controls));
   assert.ok(button.bottom<=controls.toolbar.top+1,'provider buttons do not overlap navigation '+JSON.stringify(controls));
  }
  assert.ok(controls.toolbar.bottom<=controls.surface.top+1,'navigation does not overlap web content');
  const bounds=view.getBounds();for(const key of ['x','y','width','height'])assert.ok(Math.abs(bounds[key]-rect[key]*zoom)<=2,JSON.stringify({rect,bounds,zoom}));
  assert.ok(rect.height>=170,'usable web content height '+rect.height);
  assert.ok(bounds.y+bounds.height<=rect.footer*zoom+2,'web does not cover transport');
  const web=await view.webContents.executeJavaScript('({w:innerWidth,h:innerHeight})');assert.ok(Math.abs(web.h-rect.height)<=3,'web viewport matches placeholder');
 }
 fs.writeFileSync(path.join(profile,'youtube-fit.png'),(await win.webContents.capturePage()).toPNG());
 console.log('PASS: embedded web zoom, bounds, usable height and bottom controls at DPI '+process.env.ASTRELIS_FIT_TEST_DPI);app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});

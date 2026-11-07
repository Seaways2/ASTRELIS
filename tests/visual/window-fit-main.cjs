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
 await until(()=>js(`Boolean(document.querySelector('.sidebar'))`),'ready');
 const work=require('electron').screen.getDisplayMatching(win.getBounds()).workArea;
 const initial=win.getBounds();assert.ok(initial.width<=work.width+2&&initial.height<=work.height+2,'startup inside work area '+JSON.stringify({initial,work}));
 for(const [w,h] of [[960,540],[640,400],[1120,720]]){
  win.setSize(Math.min(w,work.width),Math.min(h,work.height));await wait(1500);
  const [cw,ch]=win.getContentSize(),expected=Math.max(.8,Math.min(1,cw/1120,ch/720));
  assert.ok(Math.abs(win.webContents.getZoomFactor()-expected)<.002,'proportional zoom');
  for(const title of ['媒体库','音频设备','外观设置']){
   await js(`document.querySelector('.sidebar nav button[title="${title}"]').click()`);await wait(120);
   const state=await js(`(()=>{const r=document.querySelector('.app-shell').getBoundingClientRect(),f=document.querySelector('footer').getBoundingClientRect();return {width:innerWidth,height:innerHeight,right:r.right,bottom:r.bottom,footer:f.bottom,top:f.top}})()`);
   assert.ok(state.width>=cw/expected-2&&state.height>=ch/expected-2,JSON.stringify(state));
   assert.ok(state.right<=state.width+2&&state.bottom<=state.height+2&&state.footer<=state.height+2&&state.top>=0,JSON.stringify(state));
   const clipped=await js(`Array.from(document.querySelectorAll('.transport button,.window-actions button')).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left<0||r.top<0||r.right>innerWidth+2||r.bottom>innerHeight+2)}).map(e=>e.title||e.textContent)`);
   assert.deepEqual(clipped,[],'window and playback controls stay reachable');
   const rail=await js(`(()=>{const e=document.querySelector('.sidebar');return {client:e.clientHeight,scroll:e.scrollHeight,bar:getComputedStyle(e).scrollbarWidth}})()`);
   assert.equal(rail.bar,'none');assert.ok(rail.scroll<=rail.client+2,'navigation fits without scrolling '+JSON.stringify(rail));
   const meterOverflow=await js(`(()=>{const e=document.querySelector('.meters');if(!e)return [];const r=e.getBoundingClientRect();return [...e.querySelectorAll('.energy-ring,.readouts,.data-panel')].filter(c=>c.getBoundingClientRect().right>r.right+1).map(c=>c.className)})()`);
   assert.deepEqual(meterOverflow,[],'diagnostics stay inside right column');
   if(w===640&&title==='外观设置')fs.writeFileSync(path.join(profile,'small.png'),(await win.webContents.capturePage()).toPNG());
  }
 }

 // A display-id transition during a drag must never call setBounds.
 if(process.env.ASTRELIS_FIT_TEST_DPI==='1'){
 const screen=require('electron').screen,matching=screen.getDisplayMatching.bind(screen),bounds=win.getBounds.bind(win),setBounds=win.setBounds.bind(win);
 const display=matching(bounds());let relocations=0;
 screen.getDisplayMatching=()=>({...display,id:display.id+100,workArea:{x:-960,y:0,width:960,height:540}});
 win.getBounds=()=>({...bounds(),x:-600});
 win.setBounds=(...args)=>{relocations++;return setBounds(...args)};
 win.emit('move');await wait(180);
 assert.equal(relocations,0,'cross-monitor move does not clamp the HWND beneath the cursor');
 win.setBounds=setBounds;win.getBounds=bounds;screen.getDisplayMatching=matching;
 }
 // Work-area injection is a separate 100% simulation; real forced-DPI geometry is tested above.
 if(process.env.ASTRELIS_FIT_TEST_DPI==='1'){
 const screen=require('electron').screen,originalMatching=screen.getDisplayMatching.bind(screen);
 const display=originalMatching(win.getBounds());
 screen.getDisplayMatching=()=>({...display,workArea:{...display.workArea,width:800,height:500}});
 screen.emit('display-metrics-changed',{},display,['workArea']);await wait(1500);
 assert.ok(win.getBounds().width<=802&&win.getBounds().height<=502,'smaller work area fits');
 screen.getDisplayMatching=originalMatching;
 screen.emit('display-metrics-changed',{},display,['workArea']);await wait(1500);
 assert.ok(Math.abs(win.getBounds().width-Math.min(1500,work.width))<=4,'larger work area restores desired width');
 assert.ok(Math.abs(win.getBounds().height-Math.min(940,work.height))<=4,'larger work area restores desired height');
 }
 await js('window.desktop.setCompact(true)');await wait(1500);assert.equal(win.webContents.getZoomFactor(),1,'compact stays unscaled');
 await js('window.desktop.setCompact(false)');await wait(1500);
 const restored=win.getContentSize();assert.ok(Math.abs(win.webContents.getZoomFactor()-Math.max(.8,Math.min(1,restored[0]/1120,restored[1]/720)))<.002,'restore fit');
 fs.writeFileSync(path.join(profile,'fit.png'),(await win.webContents.capturePage()).toPNG());
 console.log('PASS window fit at DPI '+process.env.ASTRELIS_FIT_TEST_DPI);app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});

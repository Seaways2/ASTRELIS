const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),profile=process.env.ASTRELIS_VIDEO_VST_TEST_PROFILE;
const pluginPath=process.env.ASTRELIS_TEST_PLUGIN_PATH,pluginId=process.env.ASTRELIS_TEST_PLUGIN_ID;
const secondPath=process.env.ASTRELIS_TEST_SECOND_PLUGIN_PATH,secondId=process.env.ASTRELIS_TEST_SECOND_PLUGIN_ID;
const pluginCatalog=pluginPath&&pluginId?{
  modules:[{moduleFingerprint:'video-sidebar-plugin',modulePath:pluginPath},...(secondPath&&secondId?[{moduleFingerprint:'video-sidebar-second',modulePath:secondPath}]:[])],
  descriptors:[{moduleFingerprint:'video-sidebar-plugin',stablePluginUid:pluginId,formatSpecificPluginId:pluginId,
    name:'FabFilter Micro',vendor:'FabFilter',compatibility:{eligible:true,reasons:[]} },
    ...(secondPath&&secondId?[{moduleFingerprint:'video-sidebar-second',stablePluginUid:secondId,formatSpecificPluginId:secondId,
      name:'FabFilter Pro-Q 3',vendor:'FabFilter',compatibility:{eligible:true,reasons:[]} }]:[])],
  directories:[],quarantines:[],session:null
}:{modules:[],descriptors:[],directories:[],quarantines:[],session:null};
if(!profile||path.dirname(profile)!==path.join(root,'release-work'))throw Error('Isolated profile required');
delete process.env.VITE_DEV_SERVER_URL;app.setAppPath(root);app.setPath('userData',profile);app.setPath('sessionData',profile);
app.getVersion=()=>require('../../package.json').version;
const realHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>realHandle(channel,channel==='vst:scan'?async()=>pluginCatalog:handler);
const file=path.join(profile,'测试视频机架.mp4');
execFileSync(path.join(root,'ffmpeg/ffmpeg.exe'),['-y','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=25',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','15','-c:v','libx264','-preset','ultrafast',
  '-af','volume=0.001','-c:a','aac',file],{windowsHide:true});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){for(let i=0;i<200;i++){if(await predicate())return;await wait(100);}throw Error('Timeout '+label);}
let win;const js=script=>win.webContents.executeJavaScript(script,true),deadline=setTimeout(()=>app.exit(1),90000);
require('../../dist-electron/main.js');
(async()=>{
  await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading();},'window');
  await until(()=>js('Boolean(document.querySelector("input[type=file]"))'),'file picker');
  if(pluginPath&&pluginId){
    await js(`localStorage.setItem('auralis.vst.rack',JSON.stringify([{
      id:${JSON.stringify(pluginId)},stablePluginUid:${JSON.stringify(pluginId)},
      formatSpecificPluginId:${JSON.stringify(pluginId)},moduleFingerprint:'video-sidebar-plugin',
      path:${JSON.stringify(pluginPath)},name:'FabFilter Micro',enabled:true
    }]));location.reload()`);
    await until(()=>js('Boolean(document.querySelector("input[type=file]"))'),'rack profile reload');
    await until(()=>js(`localStorage.getItem('auralis.vst.rack')?.includes(${JSON.stringify(pluginId)})`),'rack restored');
  }
  win.webContents.debugger.attach('1.3');const {root:doc}=await win.webContents.debugger.sendCommand('DOM.getDocument');
  const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:doc.nodeId,selector:'input[type=file]'});
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[file]});
  await js(`document.querySelector('input[type=file]').dispatchEvent(new Event('change',{bubbles:true}))`);
  await until(async()=>{const s=await js('window.desktop.video.state()');return s.ready&&s.position>.3;},'ordinary video starts');
  await js(`Array.from(document.querySelectorAll('.embedded-video-controls label')).find(l=>l.textContent.includes('VST 机架')).querySelector('input').click()`);
  await until(async()=>{const s=await js('window.desktop.video.state()');return s.ready&&s.rackAudio&&s.position>1;},'video VST mode starts');
  let state=await js('window.desktop.video.state()');
  assert.equal(state.dspStatus,'off');
  assert.equal((await js(`window.desktop.video.control('dsp','{}')`)).ok,false);
  assert.equal((await js(`window.desktop.video.control('device','auto')`)).ok,false);
  assert.equal(await js(`document.body.textContent.includes('VIDEO · VST BETA')`),true);
  await js(`document.querySelector('.video-queue-trigger').click()`);
  await until(()=>js(`Boolean(document.querySelector('.video-queue-drawer .queue-list'))`),'video queue');
  assert.equal(await js(`Boolean(document.querySelector('.video-queue-drawer .video-sidebar-strip'))`),false);
  fs.writeFileSync(path.join(profile,'video-queue.png'),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.video-volume-trigger').click()`);
  await until(()=>js(`Boolean(document.querySelector('.video-volume-drawer .channel-fader-track'))`),'video volume drawer');
  assert.equal(await js(`Boolean(document.querySelector('.video-queue-drawer,.video-volume-drawer .queue-list'))`),false);
  const layout=await js(`(() => {
    const sidebar=document.querySelector('.video-volume-drawer');
    const strip=sidebar.querySelector('.video-sidebar-strip').getBoundingClientRect();
    const fader=sidebar.querySelector('.channel-fader-track').getBoundingClientRect();
    return {drawerHeight:sidebar.getBoundingClientRect().height,stripTop:strip.top,faderHeight:fader.height};
  })()`);
  assert.ok(layout.drawerHeight>350&&layout.faderHeight>150,JSON.stringify(layout));
  const before=await js(`Number(document.querySelector('.video-volume-drawer .channel-fader-track').getAttribute('aria-valuenow'))`);
  await js(`document.querySelector('.video-volume-drawer .channel-fader-track').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
  await until(()=>js(`Number(document.querySelector('.video-volume-drawer .channel-fader-track').getAttribute('aria-valuenow'))<${before}`),'video fader updates');
  assert.equal((await js(`window.desktop.video.control('editor','unloaded-plugin')`)).ok,false);
  if(pluginPath&&pluginId){
    await until(()=>js(`Boolean(document.querySelector('.video-volume-drawer .channel-rack-slot'))`),'loaded plugin in video sidebar');
    const editor=await js(`window.desktop.video.control('editor',${JSON.stringify(pluginId)})`);
    assert.equal(editor.ok,true,JSON.stringify(editor));
    await js(`document.querySelector('.video-volume-drawer .channel-slot-power').click()`);
    await until(()=>js(`document.querySelector('.video-volume-drawer .channel-rack-slot')?.classList.contains('bypassed')`),'video plugin bypassed');
    assert.equal((await js(`window.desktop.video.control('editor',${JSON.stringify(pluginId)})`)).ok,false,'bypassed plugin is absent from live chain');
    await js(`document.querySelector('.video-volume-drawer .channel-slot-power').click()`);
    await until(()=>js(`document.querySelector('.video-volume-drawer .channel-rack-slot')?.classList.contains('enabled')`),'video plugin re-enabled');
    assert.equal((await js(`window.desktop.video.control('editor',${JSON.stringify(pluginId)})`)).ok,true,'plugin returns to live chain');
    if(secondPath&&secondId){
      await js(`(()=>{const input=document.querySelector('.video-volume-drawer .channel-plugin-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Pro-Q');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until(()=>js(`Boolean(document.querySelector('.video-volume-drawer .channel-plugin-results button'))`),'second plugin search result');
      await js(`document.querySelector('.video-volume-drawer .channel-plugin-results button').click()`);
      await until(()=>js(`document.querySelectorAll('.video-volume-drawer .channel-rack-slot').length===2`),'second plugin added');
      await js(`(()=>{const slots=document.querySelectorAll('.video-volume-drawer .channel-rack-slot'),dataTransfer=new DataTransfer();slots[1].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));slots[0].dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer}));slots[0].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));})()`);
      await until(()=>js(`document.querySelector('.video-volume-drawer .channel-rack-slot .channel-slot-name')?.textContent.includes('Pro-Q 3')`),'video rack reordered');
      assert.equal(JSON.parse(await js(`localStorage.getItem('auralis.vst.rack')`))[0].formatSpecificPluginId,secondId);
      assert.equal((await js(`window.desktop.video.control('editor',${JSON.stringify(secondId)})`)).ok,true,'reordered plugin remains in live chain');
    }
  }
  fs.writeFileSync(path.join(profile,'video-sidebar.png'),(await win.webContents.capturePage()).toPNG());
  const fullBounds=win.getBounds();
  for (const height of [720, 640, 560]) {
    win.setMinimumSize(640, 480);win.setSize(1024,height);await wait(350);
    const layout=await js(`(() => {
      const strip=document.querySelector('.video-sidebar-strip');strip.scrollTop=0;
      const box=s=>document.querySelector(s).getBoundingClientRect();
      const fader=box('.video-channel-fader-section'),footer=box('.video-channel-footer'),rack=box('.video-channel-inserts');
      const ticks=[...document.querySelectorAll('.video-channel-fader-section .channel-fader-scale span')].map(n=>n.getBoundingClientRect());
      return {faderTop:fader.top,faderBottom:fader.bottom,footerTop:footer.top,rackBottom:rack.bottom,ticksBottom:Math.max(...ticks.map(r=>r.bottom)),trackHeight:box('.video-channel-fader-section .channel-fader-track').height};
    })()`);
    assert.ok(layout.rackBottom<=layout.faderTop+1 && layout.faderBottom<=layout.footerTop+1 && layout.ticksBottom<layout.footerTop && layout.trackHeight>=70,JSON.stringify({height,...layout}));
    await js(`(()=>{const strip=document.querySelector('.video-sidebar-strip');strip.scrollTop=strip.scrollHeight})()`);
    assert.ok(await js(`(()=>{const b=document.querySelector('.video-channel-footer .channel-mute').getBoundingClientRect(),d=document.querySelector('.video-volume-drawer').getBoundingClientRect();return b.top>=d.top&&b.bottom<=d.bottom})()`),'mute remains reachable');
    fs.writeFileSync(path.join(profile,`video-volume-${height}.png`),(await win.webContents.capturePage()).toPNG());
  }
  win.setBounds(fullBounds);await wait(250);
  let result=await js(`window.desktop.video.control('pause')`);assert.equal(result.ok,true,JSON.stringify(result));
  result=await js(`window.desktop.video.control('seek',5)`);assert.equal(result.ok,true,JSON.stringify(result));
  result=await js(`window.desktop.video.control('play')`);assert.equal(result.ok,true,JSON.stringify(result));
  await until(async()=>{const s=await js('window.desktop.video.state()');return !s.paused&&s.position>5.4;},'seek and resume');
  result=await js(`window.desktop.video.control('detach','zh-CN')`);assert.equal(result.ok,true,JSON.stringify(result));
  await until(async()=>{const s=await js('window.desktop.video.state()');return s.ready&&s.standalone&&s.rackAudio&&!s.paused;},'standalone rack playback');
  result=await js(`window.desktop.video.control('return')`);assert.equal(result.ok,true,JSON.stringify(result));
  await until(async()=>{const s=await js('window.desktop.video.state()');return s.ready&&!s.standalone&&s.rackAudio&&!s.paused;},'embedded rack playback restored');
  state=await js('window.desktop.video.state()');assert.equal(state.rackAudio,true);
  const logs=fs.readFileSync(path.join(profile,'logs','auralis.log'),'utf8');
  assert.match(logs,/Native host started/);
  console.log('Video VST opt-in UI, DSP bypass, pause/seek/resume, fullscreen rehost and native host: PASS');
  clearTimeout(deadline);await js(`window.desktop.video.control('close')`);app.quit();
})().catch(async error=>{console.error(error);clearTimeout(deadline);
  if(win&&!win.isDestroyed()){fs.writeFileSync(path.join(profile,'failure.png'),(await win.webContents.capturePage()).toPNG());
    console.error(await js('window.desktop.video.state()'));await js(`window.desktop.video.control('close')`);}
  app.exit(1);
});


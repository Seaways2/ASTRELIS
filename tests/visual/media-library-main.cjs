const {app,BrowserWindow,dialog,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),profile=process.env.ASTRELIS_MEDIA_TEST_PROFILE;
if(!profile||path.dirname(profile)!==path.join(root,'release-work'))throw Error('Isolated profile required');
delete process.env.VITE_DEV_SERVER_URL;app.setAppPath(root);app.setPath('userData',profile);app.setPath('sessionData',profile);app.getVersion=()=>require('../../package.json').version;
const folder=path.join(profile,'Media');fs.mkdirSync(folder);
const ffmpeg=path.join(root,'ffmpeg/ffmpeg.exe');
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=480x270:rate=24','-f','lavfi','-i','sine=frequency=400','-t','5','-c:v','libx264','-threads','1','-c:a','aac',path.join(folder,'Movie 01.mp4')],{windowsHide:true});
for(let i=2;i<=12;i++)fs.copyFileSync(path.join(folder,'Movie 01.mp4'),path.join(folder,`Movie ${String(i).padStart(2,'0')}.mp4`));
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=200','-t','1',path.join(folder,'Music.flac')],{windowsHide:true});
const manualCover=path.join(profile,'manual.png');
execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=320x480','-frames:v','1','-threads','1',manualCover],{windowsHide:true});
dialog.showOpenDialog=async(...args)=>({canceled:false,filePaths:[args.at(-1)?.filters?.[0]?.extensions?.includes('jpg')?manualCover:folder]});
// Only the isolated test process replaces TMDB network responses.
let batchFailure = false;
const originalFetch=global.fetch;
global.fetch=async(url, options)=>{const u=new URL(url);if(u.hostname==='image.tmdb.org')return new Response(fs.readFileSync(manualCover));if(u.hostname==='api.themoviedb.org'){if(batchFailure && u.searchParams.get('query')==='Movie Retry'){batchFailure=false;return new Response('',{status:503})} if(u.pathname.includes('/search/'))await new Promise(r=>setTimeout(r,500));const movie={id:42,title:'测试电影',original_title:'Fixture Movie',release_date:'2024-01-01',overview:'这是用于验证资料匹配与持久保存的测试简介。',poster_path:'/fixture.jpg',genres:[{name:'科幻'}],credits:{cast:[{name:'测试演员'}]}};return Response.json(u.pathname.includes('/search/')?{results:u.searchParams.get('query')==='Movie 07'?[]:u.searchParams.get('query')?.startsWith('Movie ')&&u.searchParams.get('query')!=='Movie 01'&&u.searchParams.get('query')!=='Movie 06'?[movie,{...movie,id:43,title:'另一个候选',release_date:'2023-01-01'}]:[movie]}:movie)}return originalFetch(url,options)};
const realHandle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(c,h)=>realHandle(c,c==='vst:scan'?async()=>({modules:[],descriptors:[],directories:[],quarantines:[],session:null}):h);
let win;const js=s=>win.webContents.executeJavaScript(s,true).catch(error=>{console.error("Renderer test expression:",s);throw error}),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<400;i++){if(await fn())return;await wait(100)}throw Error('Timeout '+label)}
const deadline=setTimeout(()=>app.exit(1),120000);require('../../dist-electron/main.js');
(async()=>{
 await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading()},'window');
 await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title="媒体库"]'))`),'library nav');
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.scan-action'))`),'library');
 await js(`document.querySelector('.library-management .library-menu-trigger').click()`);
 assert.equal(await js(`document.querySelector('.library-management .library-menu-popup').matches(':popover-open')`),true);
 assert.ok(await js(`(()=>{const b=document.querySelector('.scan-action').getBoundingClientRect();return b.width>0&&b.right<=innerWidth})()`),'management action is visible');
 await js(`document.querySelector('.scan-action').click()`);
 assert.equal(await js(`document.querySelector('.library-management .library-menu-popup').matches(':popover-open')`),false);
 await until(()=>js(`!document.querySelector('.scan-action').disabled && document.querySelectorAll('.library-folder-entry').length>0`),'scan');
 await js(`document.querySelector('.library-folder-entry').click()`);
 await until(()=>js(`document.querySelectorAll('.library-track-entry').length>0`),'tracks');
 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.dataset.value==="flow").click()`);
 await until(()=>js(`Boolean(document.querySelector('.media-flow-item.selected'))`),'flow');
 assert.ok(await js(`document.querySelectorAll('.media-flow-item').length<=9`));
 await js(`document.querySelector('.media-flow').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
 await wait(500);assert.ok(await js(`document.querySelector('.media-flow-navigation span').textContent.startsWith('2 /')`));
 await js(`document.querySelector('.media-flow').dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}))`);
 await until(()=>js(`document.querySelector('.media-flow-navigation span').textContent.startsWith('3 /')`),'one wheel notch');
 await js(`(()=>{const el=document.querySelector('.media-flow');for(let i=0;i<3;i++)el.dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}))})()`);
 await until(()=>js(`parseInt(document.querySelector('.media-flow-navigation span').textContent)>3 && parseInt(document.querySelector('.media-flow-navigation span').textContent)<=6`),'wheel burst accelerates without dropped events');

 await until(()=>js(`document.querySelectorAll('.media-flow img').length>0 && [...document.querySelectorAll('.media-flow img')].some(i=>i.naturalWidth>0)`),'visible video thumbnail');
 await js(`(()=>{const slider=document.querySelector('.media-flow-slider');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'10');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await until(()=>js(`document.querySelector('.media-flow-navigation span').textContent.startsWith('11 /')`),'slider selection');
 await until(()=>js(`Boolean(document.querySelector('.media-flow-item.selected img')?.naturalWidth)`),'shuttle thumbnail');
 await wait(450);
 fs.writeFileSync(path.join(profile,'media-flow.png'),(await win.webContents.capturePage()).toPNG());
 const beforeBounds=win.getBounds();win.setSize(1024,720);await wait(400);
 await js(`document.querySelector(".media-flow").scrollIntoView({block:"nearest"})`);await wait(200);
 assert.ok(await js(`document.querySelectorAll('.media-flow-item').length<=9`));
 fs.writeFileSync(path.join(profile,'media-flow-720.png'),(await win.webContents.capturePage()).toPNG());
 win.setBounds(beforeBounds);
 for(const zoom of [1.25,1.5,2]) {
   win.webContents.setZoomFactor(zoom); await wait(350);
   assert.ok(await js(`(()=>{const s=document.querySelector('.media-flow-slider').getBoundingClientRect(),p=document.querySelector('.page-content').getBoundingClientRect();return s.top>=p.top&&s.bottom<=p.bottom+1&&s.bottom<=document.querySelector('.transport').getBoundingClientRect().top&&s.width>0})()`),'slider visible at zoom '+zoom);
   await js(`document.querySelector('.library-tools-toggle').click()`);await wait(250);
   assert.ok(await js(`(()=>{const h=document.querySelector('.library-header'),r=h.getBoundingClientRect(),p=document.querySelector('.page-content').getBoundingClientRect();return getComputedStyle(h).display!=='none'&&r.top>=p.top&&r.height>0&&r.bottom<=p.bottom+1})()`),'tools accessible at zoom '+zoom);
   fs.writeFileSync(path.join(profile,'flow-zoom-'+zoom+'.png'),(await win.webContents.capturePage()).toPNG());
   await js(`document.querySelector('.library-tools-toggle').click()`);
 }
 win.webContents.setZoomFactor(1); await wait(300);

 // Direct Flow -> Grid must attach measurements to the newly mounted grid.
 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.dataset.value==="cards").click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-view-cards .library-virtual-row'))`),'direct grid');
 await wait(250);
 assert.ok(await js(`(()=>{const row=document.querySelector('.library-virtual-row');const width=row.clientWidth;return getComputedStyle(row).gridTemplateColumns.split(' ').length===Math.max(1,Math.floor((width+12)/332))})()`),'grid columns measured after direct flow switch');
 await js(`document.querySelector('.page-content').scrollTop=0`);await wait(200);
 fs.writeFileSync(path.join(profile,'media-grid.png'),(await win.webContents.capturePage()).toPNG());
 await js(`document.querySelector('.library-track-entry .library-artwork-trigger').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-artwork-dialog'))`),'artwork dialog');
 await js(`document.querySelector('.library-artwork-actions button').click()`);
 await until(()=>js(`document.querySelector('.library-artwork-actions button:last-child').textContent.includes('解除锁定')`),'manual cover locked');
 const manualSnapshot=await js(`window.desktop.library.load()`),manualTrack=manualSnapshot.tracks.find(t=>t.coverLocked);
 assert.ok(manualTrack);assert.match(manualTrack.coverUrl,/manual-/);
 fs.writeFileSync(path.join(profile,'artwork-dialog.png'),(await win.webContents.capturePage()).toPNG());

 await js(`document.querySelector('.library-artwork-dialog header button').click()`);
 await js(`document.querySelector('.library-track-entry .library-artwork-trigger').click()`);
 assert.equal(await js(`document.querySelectorAll('.artwork-tabs').length`),0);
 await js(`document.querySelector('.artwork-navigation button').click()`);
 assert.equal(await js(`document.querySelector('.library-artwork-dialog > header b').textContent`),'在线影视资料');
 assert.equal(await js(`document.querySelectorAll('.library-film-match header b').length`),0);

 await until(()=>js(`!document.querySelector('.film-search-row input').disabled && !document.querySelector('.film-search-row input').closest('fieldset').disabled`),'TMDB configured');
 await js(`document.querySelector('.film-search-row button').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-api-settings'))`),'first search opens global API settings');
 // Portalled API settings must inherit theme tokens and heading layout.
 for(const light of [false,true]) {
   const style=await js(`(()=>{const shell=document.querySelector('.app-shell');shell.classList.toggle('theme-light',${light});shell.style.setProperty('--accent','#9b79e8');const dialog=document.querySelector('.library-api-settings'),title=dialog.querySelector('header b'),icon=title.querySelector('svg'),label=title.querySelector('span'),c=getComputedStyle(dialog);return {inside:!!dialog.closest('.app-shell'),bg:c.backgroundColor,text:c.color,icon:getComputedStyle(icon).color,gap:label.getBoundingClientRect().left-icon.getBoundingClientRect().right,muted:getComputedStyle(dialog.querySelector('p')).color}})()`);
   assert.ok(style.inside,'API dialog inherits the app theme');
   assert.equal(style.icon,'rgb(155, 121, 232)');
   assert.ok(style.gap>=7.5,'API heading icon has spacing');
   assert.equal(style.text,light?'rgb(0, 0, 0)':'rgb(220, 231, 237)');
   assert.equal(style.bg,light?'rgba(226, 237, 242, 0.96)':'rgba(8, 16, 19, 0.94)');
   assert.equal(style.muted,light?'rgb(51, 51, 51)':'rgb(174, 190, 199)');
   fs.writeFileSync(path.join(profile,'api-theme-'+(light?'light':'dark')+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 await js(`(()=>{const shell=document.querySelector('.app-shell');shell.classList.remove('theme-light');shell.style.removeProperty('--accent')})()`);

 await js(`(()=>{const el=document.querySelector('.library-api-settings input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'fixture-token');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await js(`document.querySelector('.library-api-settings button[type=submit]').click()`);
 await until(()=>js(`document.querySelectorAll('.film-results button').length===1`),'TMDB candidates');
 await js(`document.querySelector('.film-results button').click()`);
 await until(()=>js(`Boolean(document.querySelector('.film-preview strong'))`),'TMDB detail');
 await until(()=>js(`!document.querySelector('.film-preview button').closest('fieldset').disabled`),'TMDB idle');
 assert.equal(await js(`document.querySelector('.film-preview input').checked`),false,'locked cover preserved by default');
 await js(`document.querySelector('.film-preview button').click()`);
 await until(()=>js(`document.querySelector('.library-film-match [role=status]').textContent.includes('已保存')`),'TMDB commit');
 const matched=(await js(`window.desktop.library.load()`)).tracks.find(t=>t.id===manualTrack.id);
 assert.equal(matched.name,'测试电影');assert.equal(matched.onlineMetadata.id,42);assert.equal(matched.coverUrl,manualTrack.coverUrl);
 await js(`document.querySelector('.film-preview').scrollIntoView({block:'center'})`);
 fs.writeFileSync(path.join(profile,'film-match.png'),(await win.webContents.capturePage()).toPNG());

 await js(`document.querySelector('.library-artwork-dialog header button').click();document.querySelector('.library-management .icon-action').click()`);
 await until(()=>js(`!document.querySelector('.scan-action').disabled`),'rescan with locked artwork');
 const rescanned=await js(`window.desktop.library.load()`);assert.equal(rescanned.tracks.find(t=>t.id===manualTrack.id).coverUrl,manualTrack.coverUrl);
 assert.equal(rescanned.tracks.find(t=>t.id===manualTrack.id).onlineMetadata.id,42);assert.equal(rescanned.tracks.find(t=>t.id===manualTrack.id).name,'测试电影');
 assert.equal((await js(`window.desktop.library.tmdb({action:'apply',trackId:${JSON.stringify(manualTrack.id)},type:'movie',id:42,replaceCover:true})`)).ok,true);
 const posterTrack=(await js(`window.desktop.library.load()`)).tracks.find(t=>t.id===manualTrack.id);assert.match(posterTrack.coverUrl,/tmdb-/);assert.equal(posterTrack.coverLocked,true);
 assert.equal(fs.readFileSync(path.join(profile,'tmdb-credential.bin')).includes(Buffer.from('fixture-token')),false,'credential encrypted on disk');
 const frameReply=await js(`window.desktop.library.artwork(${JSON.stringify(manualTrack.id)},'frame')`);assert.equal(frameReply.ok,true);
 const afterFrame=await js(`window.desktop.library.load()`);const framed=afterFrame.tracks.find(t=>t.id===manualTrack.id);assert.notEqual(framed.coverUrl,manualTrack.coverUrl);assert.equal(framed.coverLocked,true);
 assert.equal((await js(`window.desktop.library.artwork(${JSON.stringify(manualTrack.id)},'unlock')`)).ok,true);



 await js(`document.querySelector('.sidebar nav button[title="外观设置"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.appearance-section select'))`),'appearance settings');
 await js(`(()=>{const e=document.querySelector('.appearance-section select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'light');e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await until(()=>js(`document.querySelector('.app-shell').classList.contains('theme-light')`),'light theme');
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-batch-trigger'))`),'library in light mode');
 // Batch selection, cancellation, automatic exact match, review and retry.
 await js(`document.querySelector('.library-batch-trigger').click()`);
 await until(()=>js(`Boolean(document.querySelector('.batch-match-dialog'))`),'batch dialog');
 const batchTheme=await js(`(()=>{const d=document.querySelector('.batch-match-dialog'),b=d.querySelector('.batch-api-settings'),i=d.querySelector('select');return {surface:getComputedStyle(d).backgroundColor,text:getComputedStyle(d).color,button:getComputedStyle(b).color,field:getComputedStyle(i).backgroundColor}})()`);
 assert.equal(batchTheme.surface,'rgba(226, 237, 242, 0.96)');
 assert.equal(batchTheme.text,'rgb(0, 0, 0)');
 assert.notEqual(batchTheme.button,'rgb(57, 217, 233)','light theme uses readable tinted ink');
 await wait(900);
 fs.writeFileSync(path.join(profile,'batch-light.png'),(await win.webContents.capturePage()).toPNG());

 assert.equal(await js(`document.querySelectorAll('.batch-job').length`),11,'already matched track skipped');
 await until(()=>js(`!document.querySelector('.batch-actions button').disabled`),'batch ready');
 await js(`document.querySelector('.batch-api-settings').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-api-settings'))`),'batch global settings');
 assert.match(await js(`document.querySelector('.library-api-settings input').value`),/^•{16}$/,'configured credentials show a fixed mask');
 assert.equal(await js(`document.querySelector('.library-api-settings button[type=submit]').disabled`),true,'mask cannot be saved');
 await js(`document.querySelector('.library-api-settings form').requestSubmit()`);
 assert.equal((await js(`window.desktop.library.tmdb({action:'status'})`)).configured,true,'submitting unchanged mask preserves credentials');
 await js(`document.querySelector('.library-api-settings input').click()`);
 await until(()=>js(`document.querySelector('.library-api-settings input').value===''`),'focus starts replacement without exposing credential');
 await js(`document.querySelector('.library-api-settings input').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);
 await until(()=>js(`document.querySelector('.library-api-settings input').value==='••••••••••••••••'`),'empty edit restores saved mask');

 await js(`[...document.querySelectorAll('.library-api-settings button')].find(b=>b.textContent==='清除凭据').click()`);
 await until(()=>js(`document.querySelector('.library-api-settings [role=status]').textContent==='尚未配置'`),'cleared credentials');
 await js(`document.querySelector('.library-api-settings header button').click()`);
 assert.equal(await js(`document.querySelectorAll('.batch-job').length`),11,'settings preserves jobs');
 await js(`document.querySelector('.batch-actions button').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-api-settings'))`),'unconfigured batch start opens settings');
 await js(`(()=>{const el=document.querySelector('.library-api-settings input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'fixture-token');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await js(`document.querySelector('.library-api-settings button[type=submit]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.batch-job.searching'))`),'batch automatically resumes after save');
 await js(`document.querySelector('.match-background-button').click()`);
 await until(()=>js(`Boolean(document.querySelector('.match-task-dock'))&&!document.querySelector('.batch-match-dialog')`),'video matching minimized');
 const dockTheme=await js(`(()=>{const d=document.querySelector('.match-task-dock');return {surface:getComputedStyle(d).backgroundColor,text:getComputedStyle(d).color,button:getComputedStyle(d.querySelector('button')).color}})()`);
 assert.equal(dockTheme.surface,'rgba(226, 237, 242, 0.96)');
 assert.equal(dockTheme.text,'rgb(0, 0, 0)');
 assert.notEqual(dockTheme.button,'rgb(57, 217, 233)');
 fs.writeFileSync(path.join(profile,'dock-light.png'),(await win.webContents.capturePage()).toPNG());

 await js(`document.querySelector('.sidebar nav button[title="系统设置"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('#system-language'))`),'video matching permits navigation');
 await js(`document.querySelector('.match-task-dock button').click()`);
 await until(()=>js(`Boolean(document.querySelector('.batch-match-dialog'))`),'video matching restored');

 await js(`[...document.querySelectorAll('.batch-actions button')].find(b=>b.textContent.includes('停止')).click()`);
 await until(()=>js(`!document.querySelector('.batch-match-dialog header button').disabled`),'batch stopped');
 assert.ok(await js(`document.querySelectorAll('.batch-job.pending').length>0`));
 await js(`(()=>{const row=document.querySelector('.batch-job.pending');const inputs=row.querySelectorAll('.film-search-row input');const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};set(inputs[0],'测试电影');set(inputs[1],'2024')})()`);
 await js(`(()=>{const input=[...document.querySelectorAll('.batch-job.pending .film-search-row input[aria-label="批量片名"]')].find(el=>el.value==='Movie 12');if(!input)throw Error('retry fixture missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Movie Retry');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 batchFailure=true;
 await js(`document.querySelector('.batch-actions button').click()`);
 await until(()=>js(`!document.querySelector('.batch-match-dialog header button').disabled`),'batch done');
 assert.equal(await js(`document.querySelectorAll('.batch-job.saved').length`),0,'automatic results hidden');
 await js(`document.querySelector('.batch-saved-toggle input').click()`);
 assert.equal(await js(`document.querySelectorAll('.batch-job.saved').length`),2,'single candidate without exact title auto saved');
 assert.equal(await js(`document.querySelectorAll('.batch-job.missing').length`),1,'no result separate from review');
 assert.ok(await js(`document.querySelectorAll('.batch-job.error').length===1`),'request failure shown');
 await js(`document.querySelector('.batch-actions button').click()`);
 await until(()=>js(`!document.querySelector('.batch-match-dialog header button').disabled`),'retry done');
 assert.equal(await js(`document.querySelectorAll('.batch-job.error').length`),0);
 await js(`document.querySelector('.batch-job.review input[type=radio]').click()`);
 await js(`[...document.querySelectorAll('.batch-actions button')].find(b=>b.textContent.includes('确认所选')).click()`);
 await until(()=>js(`!document.querySelector('.batch-match-dialog header button').disabled`),'batch confirmation');
 assert.equal(await js(`document.querySelectorAll('.batch-job.saved').length`),3);
 fs.writeFileSync(path.join(profile,'batch-match.png'),(await win.webContents.capturePage()).toPNG());
 await js(`document.querySelector('.batch-match-dialog header button').click()`);
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.music-library'))`),'library after background task');
 const remaining=(await js(`window.desktop.library.load()`)).tracks.filter(t=>t.sourcePath.endsWith('.mp4')&&!t.onlineMetadata).slice(0,2);
 assert.equal((await js(`window.desktop.library.artwork(${JSON.stringify(remaining[0].id)},'lock')`)).ok,true);
 fs.copyFileSync(manualCover,path.join(path.dirname(remaining[1].sourcePath),'local-portrait.png'));
 assert.equal((await js(`window.desktop.library.tmdb({action:'batchApply',trackIds:${JSON.stringify(remaining.map(t=>t.id))},type:'tv',id:42,replaceCover:true})`)).ok,true);
 const grouped=(await js(`window.desktop.library.load()`)).tracks;
 assert.match(grouped.find(t=>t.id===remaining[1].id).coverUrl,/video-cover-/,'folder portrait fallback wins over online poster');
 assert.equal(grouped.find(t=>t.id===remaining[1].id).coverLocked,false,'local source stays refreshable');
 for(const item of remaining){const after=grouped.find(t=>t.id===item.id);assert.equal(after.name,item.name,'series episode name preserved');assert.equal(after.onlineMetadata.mediaType,'tv');}
 assert.equal(grouped.find(t=>t.id===remaining[0].id).coverUrl,remaining[0].coverUrl,'batch preserves locked cover');
 const firstBefore=grouped.find(t=>t.id===manualTrack.id);
 assert.equal((await js(`window.desktop.library.tmdb({action:'batchApply',trackIds:[${JSON.stringify(manualTrack.id)}],type:'movie',id:99,replaceCover:true})`)).ok,true);
 assert.equal((await js(`window.desktop.library.load()`)).tracks.find(t=>t.id===manualTrack.id).onlineMetadata.id,firstBefore.onlineMetadata.id,'batch skips matched records in main process');

 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.dataset.value==="flow").click()`);

 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.dataset.value==="details").click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-view-details .library-track-entry'))`),'list');
 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.dataset.value==="cards").click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-view-cards .library-track-entry'))`),'grid');
 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.dataset.value==="flow").click()`);
 await js(`[...document.querySelectorAll('.library-media-filter [role=option]')].find(o=>o.dataset.value==="video").click()`);
 await js(`document.querySelector('.media-flow-item.selected .library-folder-entry').click()`);
 await until(()=>js(`document.querySelector('.media-flow-navigation span').textContent.endsWith('/ 12')`),'video filter');
 await wait(300);
 assert.ok(await js(`(()=>{const s=document.querySelector('.media-flow-slider').getBoundingClientRect(),p=document.querySelector('.page-content').getBoundingClientRect();return s.top>=p.top&&s.bottom<=p.bottom})()`),'nested folder slider visible');
 await js(`(()=>{const slider=document.querySelector('.media-flow-slider');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'5');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await until(()=>js(`document.querySelector('.media-flow-slider').value==='5'`),'remembered video selection');
 const videoFolder=await js(`document.querySelector('.folder-breadcrumb > span').textContent`);
 await js(`document.querySelector('.media-flow-item.selected .library-track-entry').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
 await until(async()=>{const s=await js('window.desktop.video.state()');return s.ready&&!s.paused},'library video playback');
 await until(()=>js(`Boolean(document.querySelector('.embedded-video'))`),'video mode visible');
 await js(`document.querySelector('.sidebar nav button[title="播放列表"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.playlist-table .table-row'))`),'video playlist');
 assert.ok(await js(`document.querySelector('.queue-type-tabs button:last-child').getAttribute('aria-pressed')==='true'`),'video queue selected');
 await js(`document.querySelector('.playlist-table .table-row').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
 await until(()=>js(`Boolean(document.querySelector('.embedded-video'))`),'playlist double click enters video mode');
 await wait(500);
 fs.writeFileSync(path.join(profile,'video-controls.png'),(await win.webContents.capturePage()).toPNG());
 await js(`document.querySelector('.video-queue-trigger').click()`);
 await until(()=>js(`Boolean(document.querySelector('.video-queue-drawer .queue-list'))`),'video queue drawer');
 const checkQueue=async()=>assert.ok(await js(`(()=>{const d=document.querySelector('.video-queue-drawer'),list=d.querySelector('.queue-list').getBoundingClientRect(),tabs=d.querySelector('.queue-type-tabs').getBoundingClientRect(),summary=d.querySelector('.video-sidebar-current')?.getBoundingClientRect(),row=d.querySelector('.queue-row')?.getBoundingClientRect();return (!summary||summary.height<90)&&Math.abs(list.top-(summary?.bottom||tabs.bottom))<3&&(!row||row.top-list.top<14)&&list.bottom<=d.getBoundingClientRect().bottom+1&&list.height>50})()`),'compact summary, rows at top and list fits drawer');
 await checkQueue();
 await js(`document.querySelector('.video-queue-drawer .queue-type-tabs button:first-child').click()`);
 assert.equal(await js(`document.querySelectorAll('.video-queue-drawer .video-sidebar-current').length`),0,'music tab does not display video summary');await checkQueue();
 assert.ok((await js('window.desktop.video.state()')).active,'browsing music keeps video active');
 await js(`document.querySelector('.video-queue-drawer .queue-type-tabs button:last-child').click()`);await checkQueue();
 for(const zoom of [1.25,1.5]){win.webContents.setZoomFactor(zoom);await wait(300);await checkQueue();}
 win.webContents.setZoomFactor(1);await wait(400);
 fs.writeFileSync(path.join(profile,'video-queue.png'),(await win.webContents.capturePage()).toPNG());
 // Return from video restores the same library folder, filter and cover selection.
 await js(`document.querySelector('.video-navigation button').click()`);
 await until(()=>js(`Boolean(document.querySelector('.media-flow-slider'))`),'video return to library');
 assert.equal(await js(`document.querySelector('.folder-breadcrumb > span').textContent`),videoFolder);
 assert.equal(await js(`document.querySelector('.media-flow-slider').value`),'5');
 assert.equal(await js(`document.querySelector('.library-media-filter [aria-selected="true"]').dataset.value === 'video'`),true);
 // Grid/list scroll survives a page unmount, including virtual body reconstruction.
 await js(`[...document.querySelectorAll('.library-view-select [role=option]')].find(o=>o.dataset.value==="details").click()`);
 await until(()=>js(`document.querySelector('.library-virtual-body')?.clientHeight>600`),'list height');
 await js(`document.querySelector('.page-content').scrollTop=300`);await wait(250);
 const scrollTop=await js(`document.querySelector('.page-content').scrollTop`);assert.ok(scrollTop>0);
 await js(`document.querySelector('.sidebar nav button[title="播放列表"]').click()`);
 await until(()=>js(`!document.querySelector('.music-library')`),'leave library');
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-virtual-body'))`),'restore list');await wait(400);
 assert.ok(Math.abs(await js(`document.querySelector('.page-content').scrollTop`)-scrollTop)<2,'list scroll restored');
 // Music playback uses the same session memory, including a search filter.
 await js(`[...document.querySelectorAll('.library-media-filter [role=option]')].find(o=>o.dataset.value==="audio").click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-folder-entry'))`),'music root');
 await js(`document.querySelector('.library-folder-entry').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-track-entry'))`),'music folder');
 const musicFolder=await js(`document.querySelector('.folder-breadcrumb > span').textContent`);
 await js(`(()=>{const input=document.querySelector('.library-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Music');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await wait(300);
 await js(`document.querySelector('.library-track-entry').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
 await until(()=>js(`!document.querySelector('.music-library')`),'music playing page');
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-search input'))`),'music return');
 assert.equal(await js(`document.querySelector('.library-search input').value`),'Music');
 assert.ok(await js(`document.querySelector('.library-media-filter [aria-selected="true"]').dataset.value === 'audio'`));
 await js(`(()=>{const input=document.querySelector('.library-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await until(()=>js(`Boolean(document.querySelector('.folder-breadcrumb > span'))`),'remembered music directory');
 assert.equal(await js(`document.querySelector('.folder-breadcrumb > span').textContent`),musicFolder);
 // A new renderer session keeps settings but discards the browse location.
 win.webContents.reload();await wait(800);
 await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title="媒体库"]'))`),'fresh renderer');
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-folder-entry'))`),'fresh session library');
 assert.equal(await js(`document.querySelectorAll('.folder-breadcrumb > span').length`),0);
 assert.ok(await js(`document.querySelector('.library-media-filter [aria-selected="true"]').dataset.value === 'all'`));
 // API settings remain accessible when the whole scope is already matched.
 const allVideoIds=(await js(`window.desktop.library.load()`)).tracks.filter(t=>t.sourcePath.endsWith('.mp4')).map(t=>t.id);
 assert.equal((await js(`window.desktop.library.tmdb({action:'batchApply',trackIds:${JSON.stringify(allVideoIds)},type:'movie',id:42,replaceCover:false})`)).ok,true);
 win.webContents.reload();await wait(800);
 await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title="媒体库"]'))`),'API empty scope reload');
 await js(`document.querySelector('.sidebar nav button[title="媒体库"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-batch-trigger'))`),'empty scope batch entry');
 await js(`document.querySelector('.library-batch-trigger').click()`);
 await until(()=>js(`Boolean(document.querySelector('.batch-api-settings'))`),'empty scope API entry');
 assert.equal(await js(`document.querySelectorAll('.batch-job').length`),0);
 assert.equal(await js(`document.querySelector('.batch-api-settings').disabled`),false);
 await js(`document.querySelector('.batch-api-settings').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-api-settings'))`),'empty scope global settings');
 await js(`document.querySelector('.library-api-settings input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 await until(()=>js(`Boolean(document.querySelector('.batch-match-dialog'))`),'Escape returns to existing batch');
 // Exercise the real built UI in each locale, including short Japanese sidebar actions.
 for(const [locale,library,api,batch] of [['en-US','Media Library','API settings','Batch film matching'],['ja-JP','ライブラリ','API設定','作品一括照合'],['zh-CN','媒体库','API 设置','批量匹配影视资料']]) {
   await js(`localStorage.setItem('auralis.ui.language',${JSON.stringify(locale)})`);
   win.webContents.reload();await wait(800);
   await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title='+${JSON.stringify(JSON.stringify(library))}+']'))`),'localized sidebar '+locale);
   await js(`document.querySelector('.sidebar nav button[title='+${JSON.stringify(JSON.stringify(library))}+']').click()`);
   await until(()=>js(`Boolean(document.querySelector('.library-batch-trigger'))`),'localized library');
   await js(`document.querySelector('.library-batch-trigger').click()`);
   await until(()=>js(`Boolean(document.querySelector('.batch-api-settings'))`),'localized batch');
   assert.equal(await js(`document.querySelector('.batch-api-settings').textContent`),api);
   assert.equal(await js(`document.querySelector('.batch-match-dialog').getAttribute('aria-label')`),batch);
   await js(`document.querySelector('.batch-api-settings').click()`);
   await until(()=>js(`Boolean(document.querySelector('.library-api-settings'))`),'localized API');
   const apiText=await js(`document.querySelector('.library-api-settings').textContent`);
   if(locale==='en-US')assert.ok(!/[\u4e00-\u9fff]/.test(apiText),'English API has no Chinese text');
   if(locale==='ja-JP'){
     assert.ok(apiText.includes('保存'));
     for(const zoom of [1,1.25,1.5,2]){
       win.webContents.setZoomFactor(zoom);await wait(150);
       assert.equal(await js(`getComputedStyle(document.querySelector('.sidebar .file-import-button')).whiteSpace`),'nowrap');
       assert.equal(await js(`document.querySelector('.sidebar .file-import-button').textContent.trim()`),'読込');
       assert.ok(await js(`(()=>{const r=document.querySelector('.library-api-settings').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})()`),'API dialog fits at '+zoom);
     }
     win.webContents.setZoomFactor(1);
   }
   fs.writeFileSync(path.join(profile,'api-'+locale+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 console.log('Media library, global API flows, three-language UI, Japanese scaling and navigation: PASS');
 clearTimeout(deadline);app.exit(0);
})().catch(async error=>{console.error(error);if(win)fs.writeFileSync(path.join(profile,'failure.png'),(await win.webContents.capturePage()).toPNG());clearTimeout(deadline);app.exit(1)});

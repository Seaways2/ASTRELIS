const {app,BrowserWindow,dialog,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),profile=process.env.ASTRELIS_MEDIA_TEST_PROFILE;
if(!profile||path.dirname(profile)!==path.join(root,'release-work'))throw Error('Isolated profile required');
delete process.env.VITE_DEV_SERVER_URL;app.setAppPath(root);app.setPath('userData',profile);app.setPath('sessionData',profile);app.getVersion=()=>require('../../package.json').version;

const folder=path.join(profile,'Media');fs.mkdirSync(folder);
const ffmpeg=path.join(root,'ffmpeg/ffmpeg.exe');
for(let i=1;i<=3;i++)execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=200','-t','0.1','-metadata',i===3?'album=Second':'album=Album','-metadata','artist=Artist','-metadata','album_artist=Artist',path.join(folder,'Song '+i+'.flac')],{windowsHide:true});
const cover=path.join(profile,'cover.png');execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=500x600','-frames:v','1','-threads','1',cover],{windowsHide:true});
const id='12345678-1234-1234-1234-123456789abc';let queries=0,images=0;let signalNext;const nextSearch=new Promise(resolve=>signalNext=resolve);
global.fetch=async(url,options)=>{
 const u=new URL(url);assert.equal(options.headers.Authorization,undefined,'music requests never receive TMDB credentials');
 if(u.hostname==='musicbrainz.org'){queries++;if(queries===2)signalNext();return Response.json({'release-groups':[{id,title:u.searchParams.get('query').includes('Second')?'Second':'Album','artist-credit':[{name:'Artist'}]}]});}
 if(u.hostname==='coverartarchive.org'){images++;if(images===1)await Promise.race([nextSearch,new Promise((_,reject)=>setTimeout(()=>reject(Error('next search did not overlap cover download')),4000))]);return new Response(fs.readFileSync(cover));}
 throw Error('unexpected service '+u.hostname);
};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});
let win;const js=s=>win.webContents.executeJavaScript(s,true),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<250;i++){if(await fn())return;await wait(100)}throw Error(label)}
setTimeout(()=>app.exit(2),90000);require('../../dist-electron/main.js');
(async()=>{
 await app.whenReady();await until(()=>{win=BrowserWindow.getAllWindows()[0];return win&&!win.webContents.isLoading()},'window');
 await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title="媒体中心"]'))`),'ready');
 await js(`document.querySelector('.sidebar nav button[title="媒体中心"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.scan-action'))`),'scan ready');await js(`document.querySelector('.scan-action').click()`);
 await until(()=>js(`!document.querySelector('.scan-action').disabled&&Boolean(document.querySelector('.library-folder-entry'))`),'scanned');
 const original=await js('window.desktop.library.load()'),target=original.tracks[0];assert.equal(original.tracks.length,3);
 const before=fs.readFileSync(target.sourcePath);
 assert.ok((await js(`window.desktop.library.tmdb({action:'credentials',token:'fixture-token'})`)).ok);
 assert.ok((await js(`window.desktop.library.visibility({action:'hide-file',id:${JSON.stringify(target.id)},password:'1234'})`)).ok);
 assert.equal((await js(`window.desktop.library.musicbrainz({action:'apply',trackIds:[${JSON.stringify(target.id)}],kind:'release-group',id:'${id}'})`)).ok,false,'locked file rejected before downloading');assert.equal(images,0);
 assert.ok((await js(`window.desktop.library.visibility({action:'unlock',password:'1234'})`)).ok);
 assert.ok((await js(`window.desktop.library.visibility({action:'unhide',folder:${JSON.stringify(target.sourcePath)}})`)).ok);
 win.webContents.reload();await wait(700);
 await until(()=>js(`Boolean(document.querySelector('.sidebar nav button[title="媒体中心"]'))`),'reload');await js(`document.querySelector('.sidebar nav button[title="媒体中心"]').click()`);
 await until(()=>js(`Boolean(document.querySelector('.library-batch-trigger'))`),'batch');
 await js(`document.querySelector('.library-batch-trigger').click()`);
 await until(()=>js(`Boolean(document.querySelector('.match-service-control select'))`),'service selector');
 await js(`(()=>{const s=document.querySelector('.match-service-control select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'musicbrainz');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await until(()=>js(`Boolean(document.querySelector('.music-match-dialog'))`),'music dialog');assert.equal(await js(`document.querySelectorAll('.batch-job').length`),2,'album tracks grouped once');
 await js(`document.querySelector('.batch-api-settings').click()`);
 await until(()=>js(`Boolean(document.querySelector('.api-service-select'))`),'shared API settings');assert.equal(await js(`document.querySelector('.api-service-select').value`),'musicbrainz');assert.equal(await js(`document.querySelectorAll('.library-api-settings input[type=password]').length`),0,'MusicBrainz needs no key');
 await js(`(()=>{const s=document.querySelector('.api-service-select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'tmdb');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await until(()=>js(`Boolean(document.querySelector('.library-api-settings input[type=password]'))`),'TMDB credentials still available');assert.match(await js(`document.querySelector('.library-api-settings input').value`),/^•{16}$/);
 await js(`document.querySelector('.library-api-settings header button').click()`);
 await until(()=>js(`Boolean(document.querySelector('.music-match-dialog'))`),'return');await js(`document.querySelector('.batch-actions button').click()`);
 await until(()=>js(`document.querySelector('.music-match-phase')?.textContent.includes('下载')`),'download phase is visible while next search runs');
 assert.equal(await js(`document.querySelector('.music-match-progress progress').max`),2);
 await until(()=>js(`Boolean(document.querySelector('.batch-job.saved'))`),'cover saved');
 await until(()=>js(`!document.querySelector('.music-match-dialog header button').disabled`),'idle');
 const after=await js('window.desktop.library.load()');assert.equal(queries,2);assert.equal(images,2);assert.equal(await js(`document.querySelector('.music-match-progress progress').value`),2);assert.equal(new Set(after.tracks.map(t=>t.coverUrl)).size,1);assert.ok(after.tracks.every(t=>t.coverLocked&&t.coverUrl.includes('musicbrainz-')));
 assert.deepEqual(fs.readFileSync(target.sourcePath),before,'original music unchanged');
 const png=fs.readdirSync(path.join(profile,'artwork-cache')).find(f=>f.startsWith('musicbrainz-'));const bytes=fs.readFileSync(path.join(profile,'artwork-cache',png));assert.equal(Math.max(bytes.readUInt32BE(16),bytes.readUInt32BE(20)),256);
 assert.ok((await js(`window.desktop.library.musicbrainz({action:'apply',trackIds:[${JSON.stringify(target.id)}],kind:'release-group',id:'${id}'})`)).skipped);assert.equal(images,2,'existing locked cover not downloaded or overwritten');
 fs.writeFileSync(path.join(profile,'music-progress.png'),(await win.webContents.capturePage()).toPNG());
 console.log('PASS: next album search overlaps cover download; live phases and completed progress; privacy and original files preserved');app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});

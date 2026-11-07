const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {restoreVisibleLibrary}=require('../../dist-electron/library/migration/RestoreVisibleLibrary.js');
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-restore-'));return {directory,legacy:path.join(directory,'private-library.bin')}}
test('retired records merge once, preserve metadata and originals, restore cover access',async()=>{
 const {directory,legacy}=fixture();try{
 const media=path.join(directory,'Media');fs.mkdirSync(media);const file=path.join(media,'movie.mp4');fs.writeFileSync(file,'original');
 const cover=path.join(directory,'private-artwork','cover.png');fs.mkdirSync(path.dirname(cover));fs.writeFileSync(cover,'image');
 const record={id:'movie',sourcePath:file,privateMedia:true,coverUrl:'auralis-media://local/'+encodeURIComponent(cover),onlineMetadata:{title:'Matched film'}};
 fs.writeFileSync(legacy,JSON.stringify({roots:[],items:[record]}));
 let commits=0,payload;
 const service={getSnapshot:async()=>({status:'ready',snapshot:{revision:4,tracks:[{id:'audio',sourcePath:path.join(media,'music.flac')}],folders:[media]}}),commitLegacySnapshot:async(data,meta)=>{commits++;payload=data;assert.equal(meta.expectedRevision,4);return {status:'committed'}}};
 const scanner={scanRoots:async()=>{throw Error('individual transfer must not rescan')}};
 assert.equal(await restoreVisibleLibrary(directory,b=>b.toString(),service,scanner),2);
 assert.equal(payload.tracks.length,2);assert.deepEqual(payload.folders,[media]);const restored=payload.tracks.find(t=>t.id==='movie');assert.equal(restored.privateMedia,undefined);assert.equal(restored.onlineMetadata.title,'Matched film');
 assert.equal(fs.readFileSync(decodeURIComponent(restored.coverUrl.slice('auralis-media://local/'.length)),'utf8'),'image');assert.equal(fs.readFileSync(file,'utf8'),'original');
 assert.equal(fs.existsSync(legacy),false);assert.ok(fs.readdirSync(directory).some(n=>n.startsWith('private-library.bin.retired-')));
 assert.equal(await restoreVisibleLibrary(directory,b=>b.toString(),service,scanner),0);assert.equal(commits,1);
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('legacy directory registration is scanned once and duplicates preserve current metadata',async()=>{
 const {directory,legacy}=fixture();try{
 const file=path.join(directory,'movie.mp4');fs.writeFileSync(legacy,JSON.stringify({roots:[directory],items:[]}));let payload;
 const service={getSnapshot:async()=>({status:'ready',snapshot:{revision:2,tracks:[{sourcePath:file,name:'current title'}],folders:[directory]}}),commitLegacySnapshot:async p=>{payload=p;return {status:'committed'}}};
 await restoreVisibleLibrary(directory,b=>b.toString(),service,{scanRoots:async roots=>{assert.deepEqual(roots,[directory]);return {tracks:[{sourcePath:file,name:'scanned title'}]}}});
 assert.equal(payload.tracks.length,1);assert.equal(payload.tracks[0].name,'current title');
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});
test('failed restore retains legacy backup for retry',async()=>{
 const {directory,legacy}=fixture();try{
 fs.writeFileSync(legacy,JSON.stringify({roots:[],items:[]}));const service={getSnapshot:async()=>({status:'empty'}),commitLegacySnapshot:async()=>({status:'conflict'})};
 await assert.rejects(restoreVisibleLibrary(directory,b=>b.toString(),service,{scanRoots:async()=>({tracks:[]})}),/未保存/);assert.ok(fs.existsSync(legacy));
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
});

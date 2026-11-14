const { ffmpeg: ffmpegExecutable } = require("./helpers/ffmpeg.cjs");
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {VideoLibraryProbe}=require('../../dist-electron/library/media/VideoLibraryProbe');
const {LibraryScanner}=require('../../dist-electron/library/scanner/LibraryScanner');
test('mixed scanner indexes video without music tag parser; changed/offline source keeps clear errors',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-media-'));const cache=path.join(root,'cache'),file=path.join(root,'movie.mkv');
 try {
  const ffmpeg=ffmpegExecutable;
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','2','-c:v','libx264','-threads','1',file],{windowsHide:true});
  const probe=new VideoLibraryProbe(ffmpeg,cache,p=>'media:'+p);
  const scanner=new LibraryScanner({artworkDirectory:cache,mediaUrl:p=>'media:'+p,audioExtensions:new Set(['.flac']),videoExtensions:new Set(['.mkv']),probeVideo:p=>probe.probe(p),metadataLoader:async()=>({parseFile:async()=>{throw Error('must not parse video as music')}})});
  const first=await scanner.scanRoots([root]);assert.equal(first.tracks.length,1);assert.equal(first.failures.length,0);
  const video=first.tracks[0];assert.equal(video.mediaKind,'video');assert.ok(video.duration>=1.9);assert.match(video.videoInfo,/320x180/);assert.ok(video.coverUrl);
  const frame=video.coverUrl.slice(6),mtime=fs.statSync(frame).mtimeMs;
  const second=await scanner.scanRoots([root]);assert.equal(second.tracks[0].id,video.id);assert.equal(fs.statSync(frame).mtimeMs,mtime,'cache reused');
  const refreshed=await probe.probe(file,true);assert.notEqual(refreshed.coverUrl,video.coverUrl);assert.ok(fs.existsSync(refreshed.coverUrl.slice(6)));
  fs.copyFileSync(frame,path.join(root,'poster.jpg'));const poster=await probe.probe(file);assert.match(poster.coverUrl,/video-cover-/);
  const sameName=path.join(root,'movie.png');
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=80x120','-frames:v','1','-threads','1',sameName],{windowsHide:true});
  const local=await probe.probe(file);assert.notEqual(local.coverUrl,poster.coverUrl,'same name beats poster.jpg');assert.equal(local.coverUrl,await probe.localCover(file,true));
  execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=red:s=80x120','-frames:v','1','-threads','1',sameName],{windowsHide:true});
  assert.notEqual((await probe.probe(file)).coverUrl,local.coverUrl,'changed image invalidates cover cache without changing video');
  fs.writeFileSync(path.join(root,'movie.jpg'),'not an image');assert.match(await probe.localCover(file,true),/\.png$/,'invalid first choice skipped');
  const refreshedAgain=await probe.probe(file,true);assert.doesNotMatch(refreshedAgain.coverUrl,/video-cover-/);
  fs.writeFileSync(path.join(root,'bad.mkv'),'broken');const broken=await scanner.scanRoots([root]);assert.equal(broken.tracks.length,2);assert.equal(broken.failures.length,1);
  const offline=await scanner.scanRoots([path.join(root,'missing')]);assert.equal(offline.roots[0].status,'offline');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('folder artwork prefers portraits, then landscape; exact name wins and thumbnails never enlarge originals',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-covers-')),cache=path.join(root,'cache'),ffmpeg=ffmpegExecutable,file=path.join(root,'Film.mkv');
 const make=(name,size,color)=>{const dest=path.join(root,name);execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i',`color=c=${color}:s=${size}`,'-frames:v','1','-threads','1',dest],{windowsHide:true});return dest};
 const dimensions=url=>{const b=fs.readFileSync(url.slice(6));return [b.readUInt32BE(16),b.readUInt32BE(20)]};
 try{
 const probe=new VideoLibraryProbe(ffmpeg,cache,p=>'media:'+p);
 const wide=make('poster.jpg','1000x500','blue'),portrait=make('z-portrait.png','600x900','red');make('square.png','300x300','green');
 const before=fs.readFileSync(portrait);const picked=await probe.localCover(file);const d=dimensions(picked);assert.equal(d[1],512,'covers are 512 px thumbnails');assert.ok(d[0]<d[1]);assert.deepEqual(fs.readFileSync(portrait),before,'source untouched');assert.equal(await probe.localCover(file),picked,'cache reused');
 fs.unlinkSync(portrait);assert.deepEqual(dimensions(await probe.localCover(file)),[512,256],'landscape ahead of square');
 make('FILM.PNG','120x80','white');assert.deepEqual(dimensions(await probe.localCover(file)),[120,80],'case insensitive exact name wins, no upscale');
 fs.writeFileSync(path.join(root,'FILM.PNG'),'corrupt');assert.deepEqual(dimensions(await probe.localCover(file)),[512,256],'corrupt same-name image falls back');
 fs.unlinkSync(wide);fs.unlinkSync(path.join(root,'square.png'));assert.equal(await probe.localCover(file),undefined);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

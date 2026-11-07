const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {validateVideoFile}=require('../../dist-electron/videoPlayer.js');

const root=path.resolve(__dirname,'../..');
const dir=fs.mkdtempSync(path.join(root,'release-work/video-formats-'));
const ffmpeg=path.join(root,'ffmpeg/ffmpeg.exe');
const mpv=path.join(root,'video-engine/mpv.exe');
const cases=[
  ['asf','wmv2','asf'],['flv','flv','flv'],['ogv','libtheora','ogv'],
  ['3gp','h263','3gp'],['3g2','h263','3g2'],['f4v','libx264','f4v'],
  ['vob','mpeg2video','vob'],['mxf','mpeg2video','mxf'],
  ['rm','rv20','rm'],['rmvb','rv20','rm'],
  ['mts','mpeg2video','mpegts'],['m2t','mpeg2video','mpegts'],
  ['m1v','mpeg1video','mpeg1video'],['m2v','mpeg2video','mpeg2video'],
  ['divx','mpeg4','avi'],['mpe','mpeg2video','mpeg'],['m2p','mpeg2video','mpeg'],
  ['qt','mpeg4','mov'],['tp','mpeg2video','mpegts'],['trp','mpeg2video','mpegts'],
  ['vro','mpeg2video','mpeg'],['mpv','mpeg2video','mpeg2video']
];
for(const [ext,codec,container] of cases){
  const file=path.join(dir,'测试视频.'+ext);
  const size=ext==='3gp'||ext==='3g2'?'176x144':'320x180';
  execFileSync(ffmpeg,['-y','-v','error','-f','lavfi','-i',`testsrc2=size=${size}:rate=24`,'-t','1','-c:v',codec,'-f',container,file],{windowsHide:true});
  assert.equal(validateVideoFile(file),fs.realpathSync(file),ext);
  const output=execFileSync(mpv,['--no-config','--vo=null','--ao=null','--frames=1',file],{windowsHide:true,encoding:'utf8'});
  assert.match(output,/VO: \[null\]/,`mpv decoded frame: ${ext}`);
  console.log(ext,'decoded');
}
console.log('Additional video formats: PASS',dir);

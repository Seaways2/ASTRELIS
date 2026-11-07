const {test}=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm');
const output={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/musicCoverMatch.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:output.exports,module:output,require});
const {groupMusicCovers,confidentMusicCover}=output.exports;
test('music matching groups album artists, skips protected covers and separates unknown albums',()=>{
 const base={album:'Album',artist:'Singer',name:'Song',tags:{albumArtist:'Album Artist'}};
 const jobs=groupMusicCovers([{...base,id:'1'},{...base,id:'2',artist:'Guest'},{...base,id:'3',coverUrl:'local.png'},{...base,id:'4',coverLocked:true},{...base,id:'5',album:'未识别专辑'},{...base,id:'6',album:'未识别专辑'}]);
 assert.equal(jobs.length,3);assert.equal(jobs[0].ids.join(','),'1,2');assert.equal(jobs[0].artist,'Album Artist');assert.equal(jobs[1].album,'');
});
test('only unique exact album and artist matches save automatically',()=>{
 const candidate={id:'id',title:'Album',artist:'Artist'};
 assert.equal(confidentMusicCover('album','Artist',[candidate]),candidate);
 assert.equal(confidentMusicCover('','Artist',[candidate]),undefined);
 assert.equal(confidentMusicCover('Album','',[candidate]),undefined);
 assert.equal(confidentMusicCover('Album','Artist',[candidate,{...candidate,id:'other'}]),undefined);
 assert.equal(confidentMusicCover('Album','Other',[candidate]),undefined);
});

test('Jay matches the official artist alias despite unrelated partial search hits',()=>{
 const jay={id:'jay',title:'Jay',artist:'周杰倫',artistNames:['周杰倫','周杰伦','Jay Chou']};
 const live={...jay,id:'live',title:'周杰伦地表最强世界巡回演唱会 (Jay Chou the Invincible Concert Tour)'};
 assert.equal(confidentMusicCover('Jay','周杰伦',[live,jay]),jay);
 assert.equal(confidentMusicCover('Jay','Jay Chou',[jay,live]),jay);
 assert.equal(confidentMusicCover('Jay','周杰倫',[jay,live]),jay);
 assert.equal(confidentMusicCover('Jay','Other',[jay,live]),undefined);
 assert.equal(confidentMusicCover('Jay','周杰伦',[jay,{...jay,id:'other-edition'}]),undefined);
 assert.equal(confidentMusicCover('Jay','周杰伦',[{...jay,artist:'周杰倫 / Guest',artistNames:['周杰倫 / Guest']}]),undefined);
});

test('unique exact album accepts an officially credited collaborator, but never a different singer or ambiguous album',()=>{
 const candidate={id:'black',title:'黃俊郎的黑',artist:'周杰倫 / 楊瑞代',artistCredits:[['周杰倫','周杰伦'],['楊瑞代','杨瑞代']]};
 assert.equal(confidentMusicCover('黃俊郎的黑','周杰伦',[candidate]),candidate);
 assert.equal(confidentMusicCover('黃俊郎的黑','杨瑞代',[candidate]),candidate);
 assert.equal(confidentMusicCover('黃俊郎的黑','Other',[candidate]),undefined);
 assert.equal(confidentMusicCover('黃俊郎的黑','周杰伦',[candidate,{...candidate,id:'other'}]),undefined);
 assert.equal(confidentMusicCover('Other album','周杰伦',[candidate]),undefined);
});

test('album comparison handles simplified and traditional Chinese without changing source labels',()=>{
 const candidate={id:'aiyo',title:'哎呦，不錯哦',artist:'周杰倫'};
 assert.equal(confidentMusicCover('哎呦，不错哦','周杰伦',[candidate]),candidate);
 assert.equal(confidentMusicCover('哎呦，不錯哦','周杰倫',[{...candidate,title:'哎呦，不错哦'}]).id,'aiyo');
 assert.equal(confidentMusicCover('哎呦，不错哦 Live','周杰伦',[candidate]),undefined);
 assert.equal(confidentMusicCover('哎呦，不错哦','Other',[candidate]),undefined);
 assert.equal(confidentMusicCover('哎呦，不错哦','周杰伦',[candidate,{...candidate,id:'edition'}]),undefined);
 assert.equal(candidate.title,'哎呦，不錯哦');
 for(const [simple,traditional] of [['黄俊郎的黑','黃俊郎的黑'],['大灌篮 电影原声带','大灌籃 電影原聲帶'],['范特西PLUS','范特西PLUS']]){
  const item={id:'test',title:traditional,artist:'周杰倫'};
  assert.equal(confidentMusicCover(simple,'周杰伦',[item]),item);
 }
});

test('album lead can match a track credit with guests, but ambiguity and guest-only matches need review',()=>{
 const item={id:'era',title:'跨時代',artist:'周杰倫'};
 assert.equal(confidentMusicCover('跨时代','周杰伦&杨瑞代',[item]),item);
 assert.equal(confidentMusicCover('跨时代','周杰伦 feat. 杨瑞代',[item]),item);
 assert.equal(confidentMusicCover('跨时代','杨瑞代&周杰伦',[item]),undefined);
 assert.equal(confidentMusicCover('跨时代','周杰伦&杨瑞代',[item,{...item,id:'other'}]),undefined);
 const band={id:'band',title:'Album',artist:'A&B'};assert.equal(confidentMusicCover('Album','A&B',[band]),band);
});

test('official release title identifies differently named parent album',()=>{
 const item={id:'opus',title:'12新作',titleNames:['十二新作'],artist:'周杰倫'};
 assert.equal(confidentMusicCover('十二新作','周杰伦&袁咏琳',[item]),item);
 assert.equal(confidentMusicCover('十三新作','周杰伦&袁咏琳',[item]),undefined);
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const {MusicBrainzClient}=require('../../dist-electron/library/media/MusicBrainzClient');
const id='12345678-1234-1234-1234-123456789abc';
const group={id,title:'Album','artist-credit':[{name:'Artist'}],'first-release-date':'2020-01-01'};
test('MusicBrainz album search uses public API, escaped fields, normalized results and bounded cached copies',async()=>{
 let count=0;const c=new MusicBrainzClient('2.17.3',async(url,options)=>{count++;assert.match(url.searchParams.get('query'),/^releasegroup:/);assert.equal(options.headers.Authorization,undefined);assert.match(options.headers['User-Agent'],/^ASTRELIS\/2.17.3/);return Response.json({'release-groups':[group]});},0);
 const first=await c.search('Album','Artist');assert.equal(first[0].year,'2020');first[0].title='changed';assert.equal((await c.search('Album','Artist'))[0].title,'Album');assert.equal(count,1);
 await assert.rejects(c.search('',''),/music.invalidQuery/);
});
test('song fallback deduplicates release candidates and concurrent requests respect spacing',async()=>{
 const times=[];const c=new MusicBrainzClient('test',async(url)=>{times.push(Date.now());assert.equal(url.pathname,'/ws/2/recording/');return Response.json({recordings:[{'artist-credit':[{name:'Artist'}],releases:[group,group]}]});},80);
 const results=await Promise.all([c.search('','Artist','Song'),c.search('','Artist','Other')]);assert.equal(results[0].length,1);assert.equal(results[0][0].kind,'release');assert.ok(times[1]-times[0]>=70);
});
test('cover request follows only allowed archive redirects and separates missing covers from failures',async()=>{
 const seen=[];const c=new MusicBrainzClient('test',async(url)=>{seen.push(url.href);return seen.length===1?new Response(null,{status:307,headers:{location:'https://archive.org/download/mbid/image.jpg'}}):new Response('image');});assert.equal((await c.cover('release-group',id)).toString(),'image');assert.match(seen[0],/front-500$/);
 const unsafe=new MusicBrainzClient('test',async()=>new Response(null,{status:307,headers:{location:'http://127.0.0.1/private'}}));await assert.rejects(unsafe.cover('release',id),/music.unsafeUrl/);
 const missing=new MusicBrainzClient('test',async()=>new Response(null,{status:404}));await assert.rejects(missing.cover('release',id),/music.noCover/);
 await assert.rejects(missing.cover('release','../../secret'),/music.invalidId/);
 const large=new MusicBrainzClient('test',async()=>new Response(Buffer.alloc(8*1024*1024+1)));await assert.rejects(large.cover('release',id),/music.responseLarge/);
 const offline=new MusicBrainzClient('test',async()=>{throw Error('offline')});await assert.rejects(offline.search('Album','Artist'),/music.networkError/);
});

test('same album shares an in-flight lookup across song titles and reuses its result',async()=>{
 let count=0;const c=new MusicBrainzClient('test',async()=>{count++;await new Promise(r=>setTimeout(r,20));return Response.json({'release-groups':[group]});},0);
 const results=await Promise.all([c.search('Album','Artist','Song A'),c.search(' album ','artist','Song B')]);
 assert.equal(count,1);assert.equal(results[0][0].title,'Album');results[0][0].title='modified';assert.equal(results[1][0].title,'Album');
 assert.equal((await c.search('Album','Artist','Song C'))[0].title,'Album');assert.equal(count,1);
});
test('failed in-flight lookup is removed so a later retry can succeed',async()=>{
 let count=0;const c=new MusicBrainzClient('test',async()=>{if(++count===1)throw Error('offline');return Response.json({'release-groups':[group]});},0);
 await assert.rejects(c.search('Album','Artist'),/networkError/);assert.equal((await c.search('Album','Artist'))[0].title,'Album');assert.equal(count,2);
});

test('artist aliases survive search, but a collaborator alias never identifies the whole credit',async()=>{
 const artist={name:'周杰倫',aliases:[{name:'周杰伦',type:'Artist name'},{name:'Jay Chou',type:'Artist name'}]};
 const c=new MusicBrainzClient('test',async()=>Response.json({'release-groups':[
  {...group,title:'Jay','artist-credit':[{name:'周杰倫',artist}]},
  {...group,id:'22345678-1234-1234-1234-123456789abc','artist-credit':[{name:'周杰倫',artist},{name:'Guest'}]}
 ]}),0);
 const results=await c.search('Jay','周杰伦');
 assert.ok(results[0].artistNames.includes('周杰伦'));assert.ok(results[0].artistNames.includes('Jay Chou'));
 assert.equal(results[0].artist,'周杰倫');assert.deepEqual(results[1].artistNames,['周杰倫 / Guest']);assert.ok(results[1].artistCredits[0].includes('周杰伦'));assert.deepEqual(results[1].artistCredits[1],['Guest']);
});

test('combined track singers fall back to album lead only after empty search, without masking failures',async()=>{
 const queries=[];const c=new MusicBrainzClient('test',async url=>{queries.push(url.searchParams.get('query'));return Response.json({'release-groups':queries.length===1?[]:[group]});},0);
 assert.equal((await c.search('跨时代','周杰伦&杨瑞代')).length,1);
 assert.equal(queries.length,2);assert.match(queries[1],/artist:"周杰伦"/);
 await c.search('跨时代','周杰伦&杨瑞代');assert.equal(queries.length,2);
 let calls=0;const failed=new MusicBrainzClient('test',async()=>{calls++;throw Error('offline');},0);
 await assert.rejects(failed.search('Album','A&B'),/networkError/);assert.equal(calls,1);
});

test('localized release title finds its parent album when group search has no result',async()=>{
 const paths=[];const c=new MusicBrainzClient('test',async url=>{paths.push(url.pathname);return Response.json(url.pathname==='/ws/2/release/'?{releases:[{title:'十二新作','release-group':{id,title:'12新作'},'artist-credit':[{name:'周杰倫'}]}]}:{'release-groups':[]});},0);
 const result=await c.search('十二新作','周杰伦&袁咏琳');assert.equal(paths.length,3);assert.equal(result[0].kind,'release-group');assert.deepEqual(result[0].titleNames,['十二新作']);assert.equal(result[0].title,'12新作');
});

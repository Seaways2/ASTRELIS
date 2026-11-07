const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TmdbClient,validFilmMetadata}=require('../../dist-electron/library/media/TmdbClient');
const fixture={id:42,title:'星际穿越',original_title:'Interstellar',release_date:'2014-11-07',overview:'探索宇宙',poster_path:'/poster.jpg',genres:[{name:'科幻'}],credits:{cast:[{name:'Matthew'}]}};
test('TMDB search encodes query, excludes adult results and maps details',async()=>{
 const calls=[];const client=new TmdbClient(()=> 'private-token',async(url,init)=>{calls.push({url:new URL(url),init});return Response.json(url.pathname.includes('search')?{results:[fixture]}:fixture)});
 const found=await client.search('星际 & 宇宙','movie','2014');assert.equal(found[0].title,'星际穿越');assert.equal(calls[0].url.searchParams.get('query'),'星际 & 宇宙');assert.equal(calls[0].url.searchParams.get('include_adult'),'false');assert.equal(calls[0].init.headers.Authorization,'Bearer private-token');
 const details=await client.details('movie',42);assert.deepEqual(details.cast,['Matthew']);assert.ok(validFilmMetadata(details));
});
test('TMDB accepts API keys and TV year filters',async()=>{const client=new TmdbClient(()=> 'a'.repeat(32),async(url,init)=>{assert.equal(url.searchParams.get('api_key'),'a'.repeat(32));assert.equal(url.searchParams.get('first_air_date_year'),'2020');assert.equal(init.headers.Authorization,undefined);return Response.json({results:[{id:9,name:'剧集',first_air_date:'2020-01-01'}]})});assert.equal((await client.search('剧集','tv','2020'))[0].mediaType,'tv')});
test('TMDB rejects bad ids, credential errors, remote image paths and oversized responses',async()=>{
 const client=new TmdbClient(()=> 'token',async()=>new Response('',{status:401}));await assert.rejects(client.details('movie',1),/凭据无效/);await assert.rejects(client.details('movie',-1),/无效/);await assert.rejects(client.poster('//evil.test/x.jpg'),/无效/);
 const oversized=new TmdbClient(()=> 'token',async()=>new Response('a'.repeat(2*1024*1024+1)));await assert.rejects(oversized.search('x','movie'),/过大/);
 const missing=new TmdbClient(()=> '');await assert.rejects(missing.search('x','movie'),/配置/);assert.equal(validFilmMetadata({...fixture,provider:'tmdb'}),false);
});

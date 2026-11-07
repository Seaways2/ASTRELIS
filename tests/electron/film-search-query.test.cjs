const {test}=require('node:test');
const assert=require('node:assert/strict');
const {filmSearchQueries}=require('../../dist-electron/library/media/filmSearchQuery');
const {TmdbClient}=require('../../dist-electron/library/media/TmdbClient');
test('release tags preserve bracketed title and produce bounded subtitle fallback',()=>{
 assert.deepEqual(filmSearchQueries('[DBD-Raws][指环王1：护戒使者][加长版]'),['指环王1:护戒使者','护戒使者','指环王']);
 assert.deepEqual(filmSearchQueries('1917'),['1917']);
 assert.deepEqual(filmSearchQueries('[Up]'),['Up']);
 assert.deepEqual(filmSearchQueries('Movie.Name.1080p.BluRay.x264.mkv'),['Movie.Name']);
});
test('single and batch search share fallback and stop at first nonempty result',async()=>{
 const queries=[];
 const client=new TmdbClient(()=> 'token', async url=>{
  queries.push(url.searchParams.get('query'));
  assert.equal(url.searchParams.get('primary_release_year'),'2001');
  return new Response(JSON.stringify({results: queries.length===1?[]:[{id:1,title:'指环王1：护戒使者',release_date:'2001-01-01'},{id:2,title:'护戒使者',release_date:'2001-01-01'}]}));
 });
 const result=await client.search('[DBD-Raws][指环王1：护戒使者][加长版]','movie','2001');
 assert.deepEqual(queries,['指环王1:护戒使者','护戒使者']);assert.equal(result.length,2);
});
test('ordinary hits make one request and errors are not masked by fallback retries',async()=>{
 let calls=0;const client=new TmdbClient(()=> 'token',async()=>{calls++;return new Response(JSON.stringify({results:[{id:1,title:'Film'}]}));});
 await client.search('Film','movie');assert.equal(calls,1);
 let failed=0;const broken=new TmdbClient(()=> 'token',async()=>{failed++;throw Error('offline')});
 await assert.rejects(()=>broken.search('Film: Subtitle','movie'),/TMDB/);assert.equal(failed,1);
});


test('bilingual release names remove group/site/edition tags without losing English title numbers',()=>{
 assert.deepEqual(filmSearchQueries('[ViPHD]太空救援（大陆公映双语） Salyut 7'),['太空救援 Salyut 7','Salyut 7','太空救援']);
 assert.deepEqual(filmSearchQueries('[www lieqiwang com]白蛇 缘起 White Snake'),['白蛇 缘起 White Snake','White Snake','白蛇 缘起']);
 assert.deepEqual(filmSearchQueries('[www.lieqiwang.com]白蛇 缘起 White Snake'),['白蛇 缘起 White Snake','White Snake','白蛇 缘起']);
 assert.deepEqual(filmSearchQueries('Salyut 7'),['Salyut 7']);
 assert.deepEqual(filmSearchQueries('White Snake'),['White Snake']);
 assert.deepEqual(filmSearchQueries('[Up] (2009)'),['Up (2009)']);
});

test('mixed-language names retry with English title when the combined query is empty',async()=>{
 for(const [query,title] of [['[ViPHD]太空救援（大陆公映双语） Salyut 7','Salyut 7'],['[www lieqiwang com]白蛇 缘起 White Snake','White Snake']]) {
  const tried=[];const client=new TmdbClient(()=> 'token',async url=>{
   const q=url.searchParams.get('query');tried.push(q);
   return new Response(JSON.stringify({results:q===title?[{id:10,title,original_title:title}]:[]}));
  });
  const result=await client.search(query,'movie');assert.equal(result[0].title,title);
  assert.equal(tried.length,2);assert.equal(tried[1],title);
 }
});

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {groupFilmMatches,confidentFilmMatch}=require('../../dist-electron/library/media/filmMatchBatch');
test('groups episodes only within the same folder and skips matched files',()=>{
 const source=(id,name,folder='C:/TV')=>({id,name,sourcePath:folder+'/'+id+'.mkv'});
 const groups=groupFilmMatches([source('a','Example S01E01'),source('b','Example S01E02'),source('c','Example S01E03','C:/Other'),source('d','Movie'),{...source('e','Done'),onlineMetadata:{id:1}}]);
 assert.equal(groups.length,3);assert.deepEqual(groups[0].ids,['a','b']);assert.equal(groups[0].type,'tv');assert.equal(groups[0].query,'Example');assert.equal(groups[2].type,'movie');
});
test('single candidate is automatic; ambiguous candidates need an exact title and year',()=>{
 const group={query:'The Movie',year:'2024',type:'movie'};const candidate={id:1,title:'本地化片名',originalTitle:'The.Movie',year:2024,mediaType:'movie'};
 assert.equal(confidentFilmMatch(group,[candidate]),candidate);
 for(const candidates of [[candidate,{...candidate,id:2}],[{...candidate,mediaType:'tv'}]])assert.equal(confidentFilmMatch(group,candidates),undefined);
 assert.equal(confidentFilmMatch({...group,year:''},[candidate]),candidate);
 assert.equal(confidentFilmMatch(group,[{...candidate,originalTitle:'Other title',year:2023}]).id,1);
 assert.equal(confidentFilmMatch(group,[]),undefined);
});

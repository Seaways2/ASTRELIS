const {test}=require('node:test');const assert=require('node:assert/strict');
const {videoDisplayName}=require('../../dist-electron/library/media/videoDisplayName');
test('release cleanup keeps movie titles and selects final release year',()=>{
 assert.deepEqual(videoDisplayName('The.Legend.of.1900.1998.BD1080P.x265.mkv'),{name:'The Legend of 1900',year:1998});
 assert.deepEqual(videoDisplayName('Oppenheimer.2023.1080p.WEB-DL.AAC.mkv'),{name:'Oppenheimer',year:2023});
 assert.deepEqual(videoDisplayName('1917.mkv'),{name:'1917'});
 assert.deepEqual(videoDisplayName('Movie.S01E02.1080p.mkv'),{name:'Movie S01E02'});
 assert.deepEqual(videoDisplayName('流浪地球2 (2023).mkv'),{name:'流浪地球2',year:2023});
});

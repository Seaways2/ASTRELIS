const {test}=require('node:test');const assert=require('node:assert/strict');
const {loadPlayerStore,makeTrack}=require('./helpers/player-store-harness.cjs');
const music=id=>({...makeTrack(id),sourcePath:`C:/${id}.flac`,format:'FLAC'});
const video=id=>({...makeTrack(id),sourcePath:`C:/${id}.mkv`,format:'MKV',mediaKind:'video'});
const incoming=[music('m1'),video('v1'),music('m2'),video('v2')];
const desktop={library:{prepare:async path=>({ok:true,url:'prepared:'+path,path}),openFiles:async paths=>({tracks:incoming.filter(t=>paths.includes(t.sourcePath)),errors:[]})}};
test('mixed import separates order; queue switch pauses and preserves positions; clearing is scoped',async()=>{
 const {store}=loadPlayerStore({desktop});const s=()=>store.getState();
 s().addQueueTracks(incoming);assert.deepEqual(s().tracks.map(t=>t.id),['m1','m2']);assert.deepEqual(s().inactiveTracks.map(t=>t.id),['v1','v2']);
 await s().playTrack(1);s().setTiming(32,200);s().switchQueue('video');assert.equal(s().playing,false);
 await s().playTrack(1);assert.equal(s().activePage,'nowPlaying');s().setTiming(65,500);
 s().switchQueue('music');assert.equal(s().tracks[s().currentIndex].id,'m2');assert.equal(s().currentTime,32);
 s().clearTracks();assert.equal(s().inactiveTracks.length,2);
 s().switchQueue('video');assert.equal(s().tracks[s().currentIndex].id,'v2');assert.equal(s().currentTime,65);
});
test('background library enqueue never interrupts the other queue; restart restores both',async()=>{
 const h=loadPlayerStore({desktop}),s=()=>h.store.getState();h.store.setState({libraryTracks:incoming});
 await s().enqueueLibraryTrack('m1',true);s().setTiming(22,200);
 await s().enqueueLibraryTrack('v1');assert.equal(s().queueKind,'music');assert.equal(s().playing,true);assert.equal(s().tracks.length,1);
 h.flush();const restarted=loadPlayerStore({desktop,initialStorage:[...h.persisted]});await restarted.store.getState().restoreQueues();
 assert.equal(restarted.store.getState().currentTime,22);assert.equal(restarted.store.getState().inactiveTracks[0].id,'v1');assert.equal(restarted.store.getState().playing,false);
});
test('external mixed files start the first media in the matching queue',async()=>{
 const {store}=loadPlayerStore({desktop});await store.getState().openExternalFiles(['C:/v1.mkv','C:/m2.flac']);
 // openFiles fixture returns music first, so that item determines active queue.
 assert.equal(store.getState().queueKind,'video');assert.equal(store.getState().activePage,'nowPlaying');
 assert.ok(store.getState().tracks.every(t=>t.mediaKind==='video'));assert.equal(store.getState().inactiveTracks.length,1);
});

test('restart on video retains the inactive music selection and progress',async()=>{
 const h=loadPlayerStore({desktop});h.store.getState().addQueueTracks(incoming);
 await h.store.getState().playTrack(1);h.store.getState().setTiming(40,200);h.store.getState().switchQueue('video');
 await h.store.getState().playTrack(1);h.store.getState().setTiming(80,500);h.flush();
 const restored=loadPlayerStore({desktop,initialStorage:[...h.persisted]}).store;
 await restored.getState().restoreQueues();assert.equal(restored.getState().currentTime,80);
 restored.getState().switchQueue('music');assert.equal(restored.getState().tracks[restored.getState().currentIndex].id,'m2');assert.equal(restored.getState().currentTime,40);
});

test('browsing and editing video queue does not pause music; double click switches playback',async()=>{
 const {store}=loadPlayerStore({desktop});const s=()=>store.getState();s().addQueueTracks(incoming);
 await s().playTrack(0);s().setTiming(25,200);const generation=s().localPlayRequest;
 s().viewQueue('video');assert.equal(s().queueKind,'music');assert.equal(s().playing,true);assert.equal(s().currentTime,25);assert.equal(s().localPlayRequest,generation);
 s().removeTrack('v2');assert.equal(s().inactiveTracks.length,1);assert.equal(s().playing,true);
 await s().playQueuedTrack('v1');assert.equal(s().queueKind,'video');assert.equal(s().playing,true);assert.equal(s().activePage,'nowPlaying');assert.equal(s().queueBookmarks.m1,25);
 s().viewQueue('music');assert.equal(s().queueKind,'video');assert.equal(s().playing,true);
 await s().playQueuedTrack('m1');assert.equal(s().queueKind,'music');assert.equal(s().currentTime,25);
});

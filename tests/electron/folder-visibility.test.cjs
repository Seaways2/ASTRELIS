const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {FolderVisibility}=require('../../dist-electron/FolderVisibility.js');
const {LocalMediaAccessPolicy}=require('../../dist-electron/security/ElectronSecurity.js');
const encode=s=>Buffer.from(s),decode=b=>b.toString();
test('folder state hides descendants and future files without moving files or storing media records',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-visibility-'));try{
 const folder=path.join(dir,'movies'),file=path.join(folder,'a.mp4');fs.mkdirSync(folder);fs.writeFileSync(file,'original');
 const config=path.join(dir,'state.bin'),v=new FolderVisibility(config,encode,decode);await assert.rejects(v.hide(folder,'123'),/至少 4/);await v.hide(folder,'0123');
 assert.ok(v.blocked(file));assert.ok(v.blocked(path.join(folder,'new','future.mp4')));assert.equal(v.blocked(folder+'-other/a.mp4'),false);
 assert.equal(fs.readFileSync(file,'utf8'),'original');const stored=fs.readFileSync(config,'utf8');assert.ok(!stored.includes('0123'));assert.ok(!stored.includes('a.mp4'));
 await v.unlock('0123');assert.equal(v.blocked(file),false);v.lock();assert.ok(v.blocked(file));
 const restarted=new FolderVisibility(config,encode,decode);assert.equal(restarted.status().unlocked,false);assert.ok(restarted.blocked(file));await restarted.unlock('0123');restarted.unhide(folder);assert.equal(restarted.status().roots.length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('duplicate hide preserves protection, wrong passwords fail, parent rule absorbs descendants',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-visibility-'));try{
 const v=new FolderVisibility(path.join(dir,'state'),encode,decode),child=path.join(dir,'child');
 await v.hide(child,'1234');await v.hide(child,'1234');assert.deepEqual(v.status().roots,[child]);await v.hide(dir,'1234');assert.deepEqual(v.status().roots,[dir]);await v.hide(child,'1234');assert.deepEqual(v.status().roots,[dir]);
 await v.change('1234','5678');await v.unlock('5678');v.lock();await assert.rejects(v.unlock('9999'),/不正确/);assert.equal(v.status().unlocked,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('damaged config fails closed and access policy denies already registered paths',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-visibility-'));try{
 const config=path.join(dir,'state');fs.writeFileSync(config,'bad');const v=new FolderVisibility(config,encode,decode);assert.equal(v.status().broken,true);
 const policy=new LocalMediaAccessPolicy();policy.registerRoot(dir);assert.ok(policy.isAllowed(path.join(dir,'a.mp4')));policy.blocked=file=>v.blocked(file);assert.equal(policy.isAllowed(path.join(dir,'a.mp4')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

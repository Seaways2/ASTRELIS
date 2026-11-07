const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {VstStateProfiles}=require('../../dist-electron/vstStateProfiles');
test('music/video parameters migrate once, save before unloading, and remain isolated',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-profiles-'));
 try {
  fs.writeFileSync(path.join(root,'same.vststate'),'music');
  const p=new VstStateProfiles(root),commands=[];
  const send=async c=>{commands.push(c);return {ok:true}};
  await p.switchTo('video',true,send);
  assert.deepEqual(commands.map(c=>c.type),['pause','state-save','rack']);
  assert.equal(commands[1].stateDirectory,root);assert.equal(commands[1].closeEditors,true);
  assert.deepEqual(commands[2].plugins,[]);assert.equal(commands[2].stateDirectory,root);
  assert.equal(fs.readFileSync(path.join(p.directory(),'same.vststate'),'utf8'),'music');
  fs.writeFileSync(path.join(p.directory(),'same.vststate'),'video');
  commands.length=0;await p.switchTo('music',true,send);
  assert.equal(commands[1].stateDirectory,path.join(root,'video'));
  assert.equal(fs.readFileSync(path.join(p.directory(),'same.vststate'),'utf8'),'music');
  await p.switchTo('video',true,send);
  assert.equal(fs.readFileSync(path.join(p.directory(),'same.vststate'),'utf8'),'video');
  const before=commands.length;await p.switchTo('video',true,send);assert.equal(commands.length,before);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('failed save never changes active namespace or unloads plugins',async()=>{
 const p=new VstStateProfiles('unused');let calls=0;
 await assert.rejects(p.switchTo('video',true,async c=>{calls++;return {ok:c.type!=='state-save',error:'SAVE_FAILED'}}),/SAVE_FAILED/);
 assert.equal(p.directory(),'unused');assert.equal(calls,2);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
test('folder import sorts images, ignores subfolders and preserves originals; cancellation preserves cache',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-bg-test-')),source=path.join(root,'source'),cache=path.join(root,'cache');
 try {
  fs.mkdirSync(source);fs.mkdirSync(cache);fs.mkdirSync(path.join(source,'sub'));
  fs.writeFileSync(path.join(source,'10.jpg'),'ten');fs.writeFileSync(path.join(source,'2.png'),'two');fs.writeFileSync(path.join(source,'notes.txt'),'ignore');fs.writeFileSync(path.join(cache,'old.png'),'old');
  const main=fs.readFileSync(path.join(__dirname,'../../electron/ipc/appearanceIpc.ts'),'utf8');
  const body=main.slice(main.indexOf('  ipcMain.handle("appearance:background-folder"'),main.indexOf('  ipcMain.handle("appearance:background-remove"'));
  let handler,cancel=false;
  vm.runInNewContext(ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{ipcMain:{handle:(_,fn)=>handler=fn},getMainWindow:()=>({}),dialog:{showOpenDialog:async()=>({canceled:cancel,filePaths:[source]})},fs,path,crypto,customBackgroundDirectory:()=>cache,customBackgroundExtensions:new Set(['.png','.jpg']),mediaUrl:p=>'auralis-media://local/'+p});
  const result=await handler();assert.equal(result.ok,true);assert.equal(result.images.length,2);
  assert.equal(fs.readFileSync(result.images[0].path,'utf8'),'two');assert.equal(fs.readFileSync(result.images[1].path,'utf8'),'ten');assert.equal(fs.existsSync(path.join(cache,'old.png')),false);assert.equal(fs.readFileSync(path.join(source,'2.png'),'utf8'),'two');
  cancel=true;assert.equal((await handler()).canceled,true);assert.equal(fs.readdirSync(cache).length,2);
 }finally {assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});

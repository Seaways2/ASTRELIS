const {test}=require('node:test');const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('src/stores/vstRackStore.ts','utf8');
const item={id:'a',stablePluginUid:'a',formatSpecificPluginId:'a',moduleFingerprint:'a',path:'C:/a.vst3',enabled:true};
const storage=new Map([['auralis.vst.rack',JSON.stringify([item])]]);
function load(){
 const module={exports:{}};
 const context={exports:module.exports,module,require,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},CustomEvent:class{},window:{clearTimeout(){},setTimeout(){return 0},dispatchEvent(){},desktop:{nativeAudio:{command:async()=>({ok:true})},video:{control:async()=>({ok:true})}}}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 return module.exports.useVstRackStore;
}
test('video and music lists, bypass and order survive independently across restart',async()=>{
 let store=load();store.getState().toggleRackItem('a');
 assert.equal(store.getState().rack[0].enabled,false);
 assert.equal(store.getState().videoRack[0].enabled,true);
 await store.getState().updateVideoRack(r=>[{...item,id:'b',stablePluginUid:'b',formatSpecificPluginId:'b'},...r]);
 assert.equal(store.getState().rack.length,1);assert.equal(store.getState().videoRack.length,2);
 store=load();assert.equal(store.getState().rack[0].enabled,false);
 assert.equal(store.getState().videoRack[0].formatSpecificPluginId,'b');
 await store.getState().updateVideoRack(()=>[]);
 assert.equal(store.getState().rack.length,1);assert.equal(load().getState().videoRack.length,0);
});

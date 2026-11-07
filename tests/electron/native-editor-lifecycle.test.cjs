const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('cold editor gets a bounded startup budget without relaxing playback deadlines',()=>{
 const src=fs.readFileSync(path.join(root,'electron/main.ts'),'utf8');
 const fn=src.slice(src.indexOf('function nativeCommandTimeoutMs'),src.indexOf('\nasync function sendPlaybackCommand')).replace(': unknown','');
 const timeout=Function(fn+';return nativeCommandTimeoutMs')();
 assert.equal(timeout('editor'),30000);assert.equal(timeout('status'),5000);assert.equal(timeout('rack'),12000);
});
test('concurrent editor clicks are deduplicated and failure releases the guard',async()=>{
 const src=fs.readFileSync(path.join(root,'src/stores/vstRackStore.ts'),'utf8');
 const body=src.slice(src.indexOf('openEditor: async item => {')+'openEditor: '.length,src.indexOf('    setPerformanceSuspended:')).trim().replace(/,$/,'');
 const calls=[],errors=[];let release;
 const window={desktop:{nativeAudio:{command:async c=>{calls.push(c.type);if(c.type==='rack')return new Promise(r=>release=r);throw Error('editor failure');}}}};
 const open=Function('window','get','set','reportError','nativeRackPayload','nativeErrorText','let editorOpening=false;return '+body)(window,()=>({nativeEnabled:true}),()=>{},e=>errors.push(e),()=>[],e=>e);
 const first=open({formatSpecificPluginId:'x'});await open({formatSpecificPluginId:'x'});assert.deepEqual(calls,['rack']);
 release({ok:true});await first;assert.deepEqual(calls,['rack','editor']);assert.equal(errors[0],'editor failure');
 const retry=open({formatSpecificPluginId:'x'});release({ok:true});await retry;assert.equal(calls.filter(c=>c==='editor').length,2);
});

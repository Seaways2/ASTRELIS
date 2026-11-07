const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const e={};Function('exports',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../src/utils/nativeStatusReady.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(e);
const valid={cancelled:false,ready:true,native:true,video:false,expected:'music:2',backend:'music:2',current:'music:2'};
test('native status waits for restored music route and rejects stale responses',()=>{
 assert.equal(e.nativeStatusReady(valid),true);
 for(const change of [{ready:false},{cancelled:true},{native:false},{video:true},{backend:'video:1'},{current:'music:3'},{expected:''}]) assert.equal(e.nativeStatusReady({...valid,...change}),false,JSON.stringify(change));
});

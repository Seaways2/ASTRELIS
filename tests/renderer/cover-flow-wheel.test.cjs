const {test}=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm');
const exportsObject={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/coverFlowWheel.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject});
const {CoverFlowWheel}=exportsObject;
test('slow notches move one; fast bursts accelerate, reverse and idle reset',()=>{const wheel=new CoverFlowWheel();assert.equal(wheel.step(100,0,0),1);assert.equal(wheel.step(100,0,300),1);assert.ok(wheel.step(100,0,330)>1);assert.equal(wheel.step(-100,0,350),-1);assert.equal(wheel.step(100,0,1000),1)});
test('small touchpad deltas accumulate; line/page units and large bursts are bounded',()=>{const wheel=new CoverFlowWheel();assert.equal(wheel.step(1,0,0),0);let total=0;for(let i=1;i<80;i++)total+=wheel.step(1,0,i*10);assert.ok(total>0&&total<5);assert.equal(new CoverFlowWheel().step(3,1,0),1);assert.ok(Math.abs(wheel.step(10000,0,401))<=5);assert.equal(wheel.step(0,0,402),0)});

test('sustained fast wheel is capped instead of racing through the library',()=>{const wheel=new CoverFlowWheel();let total=0;for(let t=0;t<1000;t+=5){const step=wheel.step(120,0,t);assert.ok(step<=2);total+=step;}assert.ok(total<=13);assert.equal(wheel.step(100,0,1500),1)});

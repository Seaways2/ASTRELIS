const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),engine=path.join(root,'video-engine/mpv.exe');
for(const [language,label] of [['zh-CN','音轨'],['en-US','Audio'],['ja-JP','音声']]) {
 test('fullscreen controls follow '+language+' and only show on bottom hover',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-overlay-'));
  try {
   const script=path.join(dir,'overlay-test.lua');
   fs.writeFileSync(script,`
local real=require 'mp'
require 'mp.options'
require 'mp.assdraw'
local keys, observers, messages={}, {}, {}
local x,y=100,100
local visible=false
local overlay={data='',update=function() visible=true end,remove=function() visible=false end}
local fake={
 get_osd_size=function() return 1280,720 end,
 get_mouse_pos=function() return x,y end,
 get_time=function() return 10 end,
 get_property_number=function(name,default) return default end,
 get_property_bool=function() return false end,
 get_property_native=function(name,default) return default end,
 create_osd_overlay=function() return overlay end,
 commandv=function() end,set_property_bool=function() end,
 add_forced_key_binding=function(key,name,fn) keys[key]=fn end,
 observe_property=function(name,kind,fn) observers[name]=fn end,
 register_script_message=function(name,fn) messages[name]=fn end,
 add_periodic_timer=function(_,fn) fake_draw=fn end
}
package.loaded['mp']=fake
local ok,err=pcall(function()
 dofile(${JSON.stringify(path.join(root,'video-engine/astrelis-controls.lua').replace(/\\/g,'/'))})
 fake_draw();assert(not visible,'hidden on entry')
 observers.pause(nil,true);observers.volume(nil,60);fake_draw();assert(not visible,'property changes do not reveal controls')
 keys.mouse_move();assert(not visible,'middle hover stays hidden')
 y=700;keys.mouse_move();assert(visible,'bottom hover immediate')
 assert(overlay.data:find(${JSON.stringify(label)},1,true),'language propagated')
 y=100;keys.mouse_move();assert(not visible,'leave bottom immediate')
 y=700;keys.mouse_move();messages['astrelis-keyboard']();assert(not visible,'keyboard hides controls')
 observers.pause(nil,false);fake_draw();assert(not visible,'keyboard changes stay hidden even with cursor at bottom')
 keys.mouse_move();assert(visible,'next movement restores hover')
 keys.mouse_leave();assert(not visible,'window leave immediate');fake_draw();assert(not visible)
end)
if not ok then real.msg.error(err) end
package.loaded['mp']=real
real.add_timeout(.2,function() real.commandv('quit',ok and 0 or 1) end)
`);
   const result=spawnSync(engine,['--no-config','--load-scripts=no','--idle=yes','--vo=null','--ao=null','--script='+script,'--script-opts=astrelis-input-embedded=no,astrelis-input-direct=no,astrelis-controls-language='+language+',astrelis-controls-direct=no'],{encoding:'utf8',windowsHide:true,timeout:10000});
   assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
 });
}

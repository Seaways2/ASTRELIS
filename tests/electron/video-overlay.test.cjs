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
test('fullscreen controls keep their logical size at 4K / 300% and hide when the mouse idles',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-overlay-'));
 try {
  const script=path.join(dir,'overlay-dpi-test.lua');
  fs.writeFileSync(script,`
local real=require 'mp'
require 'mp.options'
require 'mp.assdraw'
local keys, commands={}, {}
local x,y,now=900,600,10
local visible=false
local overlay={data='',res_x=0,res_y=0,update=function() visible=true end,remove=function() visible=false end}
local fake={
 get_osd_size=function() return 3840,2160 end,
 get_mouse_pos=function() return x,y end,
 get_time=function() return now end,
 get_property_number=function(name,default) if name=='display-hidpi-scale' then return 3 end return default end,
 get_property_bool=function() return false end,
 get_property_native=function(name,default) return default end,
 create_osd_overlay=function() return overlay end,
 commandv=function(...) commands[#commands+1]=table.concat({...},' ') end,set_property_bool=function() end,
 add_forced_key_binding=function(key,name,fn) keys[key]=fn end,
 observe_property=function() end,
 register_script_message=function() end,
 add_periodic_timer=function(_,fn) fake_draw=fn end
}
package.loaded['mp']=fake
local ok,err=pcall(function()
 dofile(${JSON.stringify(path.join(root,'video-engine/astrelis-controls.lua').replace(/\\/g,'/'))})
 keys.mouse_move();assert(not visible,'physical y 600 is logical 200: middle of the screen')
 -- Physical 2100 / 3 = logical 700 of 720: inside the 180 DIP bar.
 y=2100;keys.mouse_move();assert(visible,'bottom hover in physical pixels')
 assert(overlay.res_x==1280 and overlay.res_y==720,'canvas in logical pixels: '..overlay.res_x..'x'..overlay.res_y)
 assert(overlay.data:find('\\\\fs22',1,true),'fonts keep their logical size')
 -- First button (play/pause) spans logical y 654..698 from x 20.
 x,y=90,2040;keys.MBTN_LEFT();assert(commands[#commands]=='cycle pause','button hit test uses logical coordinates: '..tostring(commands[#commands]))
 now=now+2.9;fake_draw();assert(visible,'still visible before the idle timeout')
 now=now+0.2;fake_draw();assert(not visible,'hidden after 3 s without mouse activity')
 local count=#commands
 keys.MBTN_LEFT();assert(visible,'a click on the hidden bar reveals it');assert(#commands==count,'the revealing click does not act')
 now=now+1;keys.mouse_move();now=now+2.5;fake_draw();assert(visible,'movement restarts the idle timer')
end)
if not ok then real.msg.error(err) end
package.loaded['mp']=real
real.add_timeout(.2,function() real.commandv('quit',ok and 0 or 1) end)
`);
  const result=spawnSync(engine,['--no-config','--load-scripts=no','--idle=yes','--vo=null','--ao=null','--script='+script,'--script-opts=astrelis-controls-language=en-US,astrelis-controls-direct=no'],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('fullscreen controls use a whole-number canvas at fractional scaling such as 4K / 225%',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astrelis-overlay-'));
 try {
  const script=path.join(dir,'overlay-fraction-test.lua');
  fs.writeFileSync(script,`
local real=require 'mp'
require 'mp.options'
require 'mp.assdraw'
local keys, commands={}, {}
local x,y=900,600
local visible=false
local overlay={data='',res_x=0,res_y=0,update=function() visible=true end,remove=function() visible=false end}
local fake={
 get_osd_size=function() return 3840,2160 end,
 get_mouse_pos=function() return x,y end,
 get_time=function() return 10 end,
 get_property_number=function(name,default) if name=='display-hidpi-scale' then return 2.25 end return default end,
 get_property_bool=function() return false end,
 get_property_native=function(name,default) return default end,
 create_osd_overlay=function() return overlay end,
 commandv=function(...) commands[#commands+1]=table.concat({...},' ') end,set_property_bool=function() end,
 add_forced_key_binding=function(key,name,fn) keys[key]=fn end,
 observe_property=function() end,
 register_script_message=function() end,
 add_periodic_timer=function(_,fn) fake_draw=fn end
}
package.loaded['mp']=fake
local ok,err=pcall(function()
 dofile(${JSON.stringify(path.join(root,'video-engine/astrelis-controls.lua').replace(/\\/g,'/'))})
 -- Logical 916 of 960 is inside the bar: 916*2160/960 = 2061 physical.
 y=2061;keys.mouse_move();assert(visible,'bottom hover at 225%')
 assert(overlay.res_x==1707 and overlay.res_y==960,'rounded logical canvas: '..overlay.res_x..'x'..overlay.res_y)
 assert(overlay.res_x==math.floor(overlay.res_x) and overlay.res_y==math.floor(overlay.res_y),'whole-number canvas')
 -- The real osd-overlay command rejects a fractional res_x/res_y.
 local result,failure=real.command_native({name='osd-overlay',id=77,format='ass-events',data=overlay.data,res_x=overlay.res_x,res_y=overlay.res_y,z=0,hidden=true})
 assert(result,'osd-overlay accepts the canvas: '..tostring(failure))
 -- First button spans logical x 20.. and y 894..938: 90*3840/1707 = 202.5 physical.
 x,y=202,2061;keys.MBTN_LEFT();assert(commands[#commands]=='cycle pause','hit test uses the same ratio: '..tostring(commands[#commands]))
end)
if not ok then real.msg.error(err) end
package.loaded['mp']=real
real.add_timeout(.2,function() real.commandv('quit',ok and 0 or 1) end)
`);
  const result=spawnSync(engine,['--no-config','--load-scripts=no','--idle=yes','--vo=null','--ao=null','--script='+script,'--script-opts=astrelis-controls-language=en-US,astrelis-controls-direct=no'],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

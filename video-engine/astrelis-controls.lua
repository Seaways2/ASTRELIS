local mp = require 'mp'
local assdraw = require 'mp.assdraw'
local options = {language='zh-CN', direct='no'}
require('mp.options').read_options(options, 'astrelis-controls')
local words = {
 ['zh-CN']={'播放','暂停','后退 5 秒','前进 5 秒','音轨','字幕','静音','音量 −','音量 +','返回星律','直通：功放调音量'},
 ['en-US']={'Play','Pause','Back 5s','Forward 5s','Audio','Subtitles','Mute','Volume −','Volume +','Return','Bitstream: receiver volume'},
 ['ja-JP']={'再生','一時停止','5秒戻る','5秒進む','音声','字幕','ミュート','音量 −','音量 +','戻る','音量はアンプで調整'}
}
local t=words[options.language] or words['en-US']
local overlay=mp.create_osd_overlay('ass-events')
local mouse_active=false
local buttons={}
local feedback, feedback_until='',0
local function clamp_volume(value) return math.max(0,math.min(100,value)) end
local function mpv_to_amplitude(value) return math.pow(clamp_volume(value)/100,3)*100 end
local function amplitude_to_mpv(value) return math.pow(clamp_volume(value)/100,1/3)*100 end
local detail = {
 ['zh-CN']={'已暂停','正在播放','已静音','已取消静音','关闭','点击切换音轨','点击切换字幕','点击进度条跳转','返回内嵌播放','跳转至'},
 ['en-US']={'Paused','Playing','Muted','Unmuted','Off','Click to cycle audio','Click to cycle subtitles','Click timeline to seek','Return to embedded player','Seek to'},
 ['ja-JP']={'一時停止中','再生中','ミュート中','ミュート解除','オフ','音声を切替','字幕を切替','クリックでシーク','埋め込み再生に戻る','移動先'}
}
local d=detail[options.language] or detail['en-US']
local function clock(n) return string.format('%02d:%02d:%02d',math.floor(n/3600),math.floor(n/60)%60,math.floor(n%60)) end
local function track(kind)
 for _,v in ipairs(mp.get_property_native('track-list',{})) do
  if v.type==kind and v.selected then return '#'..v.id..' '..(v.title or v.lang or v.codec or '') end
 end
 return d[5]
end
local function notify(message) feedback=message;feedback_until=mp.get_time()+.8 end
local function seek(n) mp.commandv('seek',n,'relative');notify((n<0 and t[3] or t[4])) end
local function vol(n)
 if options.direct=='yes' then notify(t[11]);return end
 local current=mp.get_property_bool('mute') and 0 or mpv_to_amplitude(mp.get_property_number('volume',0))
 mp.set_property_bool('mute',false)
 mp.set_property_number('volume',amplitude_to_mpv(current+n))
end
local function back() mp.set_property_bool('fullscreen',false) end
local function text(a,x,y,label,size)
 a:new_event();a:pos(x,y);a:append('{\\an7\\fs'..(size or 18)..'\\bord1\\shad0\\1c&HFFFFFF&}'..label)
end
local function rect(a,x1,y1,x2,y2,color)
 a:new_event();a:pos(0,0);a:append('{\\an7\\bord0\\shad0\\1c&H'..color..'&\\1a&H10&}');a:draw_start();a:rect_cw(x1,y1,x2,y2);a:draw_stop()
end
local function draw()
 local w,h=mp.get_osd_size(); if w==0 or h==0 then return end
 local mx,my=mp.get_mouse_pos()
 if not mouse_active or mx<0 or mx>w or my<h-180 or my>h then buttons={};overlay:remove();return end
 local a=assdraw.ass_new()
 rect(a,0,h-180,w,h,'181818')
 local pos=mp.get_property_number('time-pos',0);local dur=mp.get_property_number('duration',0)
 rect(a,24,h-160,w-24,h-150,'666666')
 if dur>0 then rect(a,24,h-160,24+(w-48)*pos/dur,h-150,'DDCC66') end
 text(a,24,h-137,clock(pos)..' / '..clock(dur),22)
 text(a,300,h-137,t[5]..': '..track('audio')..'    '..t[6]..': '..track('sub'),20)
 if my>=h-168 and my<=h-142 then
  text(a,math.max(24,math.min(w-250,mx)),h-206,d[10]..' '..clock(math.max(0,math.min(1,(mx-24)/(w-48)))*dur),22)
 elseif mp.get_time()<feedback_until then text(a,24,h-215,feedback,26) end
 local actions={function() mp.commandv('cycle','pause') end,function() seek(-5) end,function() seek(5) end,function() mp.commandv('cycle','aid') end,function() mp.commandv('cycle','sid') end,function() if options.direct~='yes' then mp.commandv('cycle','mute') end end,function() vol(-5) end,function() vol(5) end,back}
 local labels={mp.get_property_bool('pause') and t[1] or t[2],t[3],t[4],t[5],t[6],mp.get_property_bool('mute') and d[4] or t[7],t[8],t[9],t[10]}
 local width=(w-40)/#labels;buttons={}
 for i,label in ipairs(labels) do
  local x=20+(i-1)*width
  buttons[i]={x=x,y=h-66,w=width-8,height=44,action=actions[i]}
  local hover=mx>=x and mx<x+width-8 and my>=h-66 and my<=h-22
  rect(a,x,h-66,x+width-8,h-22,hover and '786044' or '343434')
  text(a,x+10,h-58,label,math.min(22,width/6))
  if hover then text(a,24,h-96,({t[1]..' / '..t[2]..' [Space]',t[3]..' [←]',t[4]..' [→]',d[6],d[7],t[7],t[8]..' [↓]',t[9]..' [↑]',d[9]..' [Esc]'})[i],18) end
 end
 text(a,w-280,h-96,options.direct=='yes' and t[11] or (t[8]:gsub(' −','')..' '..math.floor(mpv_to_amplitude(mp.get_property_number('volume',0)))..'%'),16)
 overlay.res_x=w;overlay.res_y=h;overlay.data=a.text;overlay:update()
end
local function hide()
 mouse_active=false;buttons={};feedback_until=0;overlay:remove()
end
mp.add_forced_key_binding('mouse_move','astrelis-mouse',function() mouse_active=true;draw() end)
mp.add_forced_key_binding('mouse_leave','astrelis-mouse-leave',hide)
mp.register_script_message('astrelis-keyboard',hide)
mp.observe_property('focused','bool',function(_,focused) if focused==false then hide() end end)
mp.add_forced_key_binding('MBTN_LEFT','astrelis-click',function()
 local x,y=mp.get_mouse_pos();local w,h=mp.get_osd_size()
 if not mouse_active or y<h-180 then return end
 if y>h-168 and y<h-142 then local target=math.max(0,math.min(1,(x-24)/(w-48)))*mp.get_property_number('duration',0);mp.commandv('seek',target,'absolute+exact');notify(d[10]..' '..clock(target))
 else for _,b in ipairs(buttons) do if x>=b.x and x<b.x+b.w and y>=b.y and y<=b.y+b.height then b.action();break end end end
 draw()
end)
mp.add_forced_key_binding('ESC','astrelis-return',back)
mp.add_forced_key_binding('f','astrelis-fullscreen',back)
mp.add_forced_key_binding('F11','astrelis-fullscreen2',back)
mp.add_forced_key_binding('q','astrelis-exit',back)
mp.observe_property('pause','bool',function(_,v) notify(v and d[1] or d[2]) end)
mp.observe_property('volume','number',function(_,v) if v then notify(t[8]:gsub(' −','')..' '..math.floor(mpv_to_amplitude(v))..'%') end end)
mp.observe_property('mute','bool',function(_,v) notify(v and d[3] or d[4]) end)
mp.observe_property('aid','native',function() notify(t[5]..': '..track('audio')) end)
mp.observe_property('sid','native',function() notify(t[6]..': '..track('sub')) end)
mp.add_periodic_timer(.1,draw)

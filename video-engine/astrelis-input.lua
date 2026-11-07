local mp = require 'mp'
local options = {embedded='no', direct='no'}
require('mp.options').read_options(options, 'astrelis-input')
local function clamp_volume(value) return math.max(0, math.min(100, value)) end
local function mpv_to_amplitude(value) return math.pow(clamp_volume(value) / 100, 3) * 100 end
local function amplitude_to_mpv(value) return math.pow(clamp_volume(value) / 100, 1 / 3) * 100 end
local function act(action, amount)
 if options.embedded == 'yes' then
  mp.commandv('script-message', 'astrelis-input', action, tostring(amount or 0))
 elseif action == 'toggle' then mp.commandv('cycle', 'pause')
 elseif action == 'seek' then mp.commandv('seek', amount, 'relative+exact')
 elseif action == 'volume' and options.direct ~= 'yes' then
  local volume = mp.get_property_bool('mute') and 0 or mpv_to_amplitude(mp.get_property_number('volume', 0))
  mp.set_property_bool('mute', false)
  mp.set_property_number('volume', amplitude_to_mpv(volume + amount))
 elseif action == 'volumeDb' and options.direct ~= 'yes' then
  local volume = mp.get_property_bool('mute') and 0 or mpv_to_amplitude(mp.get_property_number('volume', 0))
  local step = volume > 0 and math.max(1, math.min(60, math.floor(60 + 20 * math.log(volume / 100) / math.log(10) + 0.5))) or 0
  local next_step = math.max(0, math.min(60, step + amount))
  mp.set_property_bool('mute', next_step == 0)
  local amplitude = next_step == 0 and 0 or math.pow(10, (next_step - 60) / 20) * 100
  mp.set_property_number('volume', amplitude_to_mpv(amplitude))
 end
end
local function keyboard_act(action, amount)
 mp.commandv('script-message','astrelis-keyboard')
 act(action, amount)
end
local held, started, last_step = nil, 0, 0
local function bind_seek(key, direction)
 mp.add_forced_key_binding(key, 'astrelis-seek-'..key, function(e)
  if e.event == 'up' then if held == key then held = nil end; return end
  if e.event == 'down' or e.event == 'press' then
   held = e.event == 'down' and key or nil
   started = mp.get_time(); last_step = started
   keyboard_act('seek', direction * 5)
  end
 end, {complex=true})
end
bind_seek('LEFT', -1); bind_seek('RIGHT', 1)
mp.add_periodic_timer(.05, function()
 if not held then return end
 local now = mp.get_time(); local fast = now - started >= 2
 if now - last_step >= (fast and .2 or .5) then
  last_step = now; keyboard_act('seek', (held == 'RIGHT' and 1 or -1) * (fast and 10 or 5))
 end
end)
mp.observe_property('focused', 'bool', function(_, focused) if focused == false then held = nil end end)
mp.add_forced_key_binding('SPACE', 'astrelis-input-pause', function() keyboard_act('toggle') end)
mp.add_forced_key_binding('UP', 'astrelis-input-up', function() keyboard_act('volumeDb', 5) end, {repeatable=false})
mp.add_forced_key_binding('DOWN', 'astrelis-input-down', function() keyboard_act('volumeDb', -5) end, {repeatable=false})
mp.add_forced_key_binding('WHEEL_UP', 'astrelis-input-wheel-up', function() act('volume', 5) end)
mp.add_forced_key_binding('WHEEL_DOWN', 'astrelis-input-wheel-down', function() act('volume', -5) end)

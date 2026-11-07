/** Video-only early reflections and parallel dialogue enhancement. */
export interface VideoDsp { enabled: boolean; spatial: number; dialogue: number }
export const defaultVideoDsp = (): VideoDsp => ({ enabled: false, spatial: 0, dialogue: 0 });
export function parseVideoDsp(value: unknown): VideoDsp {
  const v = value as VideoDsp | undefined;
  if (!v || typeof v.enabled !== "boolean" ||
    ![v.spatial, v.dialogue].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100))
    throw new Error("VIDEO_DSP_INVALID");
  return { enabled: v.enabled, spatial: Math.round(v.spatial), dialogue: Math.round(v.dialogue) };
}
export function videoDspFilter(dsp: VideoDsp, direct: boolean, outputChannels = 0): string {
  if (direct || outputChannels !== 2 || !dsp.enabled || (!dsp.spatial && !dsp.dialogue)) return "";
  const spatial = dsp.spatial / 100, dialogue = dsp.dialogue / 100;
  const branches = ["dry", ...(spatial ? ["room"] : []), ...(dialogue ? ["voice"] : [])];
  // The output endpoint was measured as stereo without our filter. Downmix
  // here, before effects; mpv's ordinary output conversion happens too late.
  // FFmpeg uses the input layout, including centre and surround channels.
  const graph = [
    "aformat=channel_layouts=stereo,asplit=" + branches.length + branches.map(b => `[${b}]`).join("")
  ];
  if (spatial) graph.push(`[room]adelay=17|29:all=1,aecho=1:0.7:37|71|113:0.5|0.32|0.18,volume=${(spatial * 0.85).toFixed(4)}[roomWet]`);
  if (dialogue) graph.push(`[voice]aeval=exprs='if(eq(nb_in_channels,2),(val(0)+val(1))/2,0)':c=same,highpass=f=120,lowpass=f=6000,equalizer=f=2200:t=q:w=0.8:g=5,acompressor=threshold=0.08:ratio=4:attack=8:release=100:makeup=2.5:knee=2,volume=${(dialogue * 1.4).toFixed(4)}[voiceWet]`);
  graph.push("[dry]" + (spatial ? "[roomWet]" : "") + (dialogue ? "[voiceWet]" : "") +
    `amix=inputs=${branches.length}:normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.92:level=false:attack=5:release=80:latency=true`);
  return `@astrelis_dsp:lavfi=[${graph.join(";")}]`;
}
export function videoDspStatus(dsp: VideoDsp, direct: boolean, outputChannels: number) {
  if (direct) return "direct";
  if (!outputChannels) return "waiting";
  if (outputChannels !== 2) return "multichannel";
  if (!dsp.enabled) return "off";
  if ((!dsp.spatial && !dsp.dialogue)) return "original";
  return "active";
}

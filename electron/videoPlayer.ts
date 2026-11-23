import { videoClockCorrection } from "./videoClockSync";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { defaultVideoDsp, parseVideoDsp, videoDspFilter, videoDspStatus, type VideoDsp } from "./videoDsp";

export interface VideoState {
  rackAudio?: boolean;
  dsp?: VideoDsp; dspStatus?: string; dspError?: string; sourceChannels?: number; outputChannels?: number;
  playbackToken?: string;
  standalone?: boolean; returnRequested?: boolean; muted?: boolean;
  audioDevice?: string; audioDevices?: { name: string; description: string }[];
  active: boolean; ready: boolean; paused: boolean; ended: boolean;
  title: string; position: number; duration: number; volume: number;
  direct: boolean; error: string; audioCodec: string; videoCodec: string;
  output: string; hwdec: string; tracks: VideoTrack[];
  subtitleDelay: number; subtitleSpeed: number;
}
export interface VideoTrack { id: number; type: string; title: string; lang: string; selected: boolean }
export const emptyVideoState = (): VideoState => ({ active: false, ready: false, paused: true, ended: false,
  title: "", position: 0, duration: 0, volume: 50, direct: false, error: "", audioCodec: "", videoCodec: "",
  output: "", hwdec: "", tracks: [], subtitleDelay: 0, subtitleSpeed: 1 });
const clampVolumePercent = (value: number) => Math.max(0, Math.min(100, Number(value) || 0));
// mpv's soft volume is cubic. Keep VideoState and the UI in linear amplitude
// percent, converting only at the mpv boundary so dB attenuation matches audio.
export function mpvVolumeToAmplitudePercent(value: number) {
  return Math.pow(clampVolumePercent(value) / 100, 3) * 100;
}
export function amplitudePercentToMpvVolume(value: number) {
  return Math.cbrt(clampVolumePercent(value) / 100) * 100;
}
export const videoExtensions = ["mp4", "mkv", "mov", "m4v", "webm", "avi", "ts", "m2ts", "mpg", "mpeg", "wmv",
  "asf", "flv", "ogv", "3gp", "3g2", "f4v", "vob", "mxf", "rm", "rmvb", "mts", "m2t", "m1v", "m2v", "divx",
  "mpe", "m2p", "qt", "tp", "trp", "vro", "mpv"];
export function validateVideoFile(file: unknown) {
  if (typeof file !== "string" || !path.isAbsolute(file) || !videoExtensions.includes(path.extname(file).slice(1).toLowerCase()))
    throw new Error("VIDEO_FILE_INVALID");
  const real = fs.realpathSync(file);
  if (!fs.statSync(real).isFile()) throw new Error("VIDEO_FILE_INVALID");
  return real;
}
export interface VideoInitialAudio { volume: number; muted: boolean }
// Standalone fullscreen owns the transport; the renderer copies its paused
// state. A queue advance carried into fullscreen (resume) must therefore not
// start paused, or the first ready state reads as the viewer pausing.
export function videoStandaloneArguments(scriptDirectory: string, resume = false) {
  return ["--fullscreen=yes", "--pause=" + (resume ? "no" : "yes"), "--osc=no", "--osd-level=0", "--input-default-bindings=no", "--drag-and-drop=no", "--osd-font=Microsoft YaHei",
    "--script=" + path.join(scriptDirectory, "astrelis-controls.lua")];
}
export function videoArguments(pipe: string, direct: boolean, log: string, parent?: string, rackAudio = false, audio?: VideoInitialAudio) {
  // A playlist advance inside standalone fullscreen starts the next engine at
  // the level the viewer left, so the first state does not reset the store.
  const volume = direct ? "--volume=100" : audio ? "--volume=" + Number(amplitudePercentToMpvVolume(audio.volume).toFixed(3)) : "--volume=50";
  return ["--no-config", "--load-scripts=no", "--ytdl=no", "--idle=yes", "--keep-open=yes", "--force-window=yes",
    "--title=ASTRELIS · Video", "--autofit=85%x85%", "--hwdec=auto-safe", rackAudio ? "--ao=null" : "--ao=wasapi",
    "--audio-fallback-to-null=no", volume, ...(audio?.muted && !direct ? ["--mute=yes"] : []), "--volume-max=100", "--save-position-on-quit=no", "--input-media-keys=no",
    "--sub-font=Microsoft YaHei", "--input-ipc-server=" + pipe, "--log-file=" + log,
    ...(parent ? ["--wid="+parent,"--osc=no","--osd-level=0","--input-default-bindings=no","--input-vo-keyboard=yes","--input-cursor=yes","--drag-and-drop=no","--pause=yes"] : []),
    ...(direct ? ["--audio-spdif=ac3,dts,eac3", "--audio-exclusive=yes"] : ["--audio-spdif=", "--audio-exclusive=no"])];
}
// State published when the engine process ends. Closing a session that never
// became playable (a corrupt or unsupported file) keeps the load failure, so
// the surface can say why instead of waiting forever; closing a playable
// session clears it, and process exit codes never mask mpv's own reason.
export function videoExitPatch(state: VideoState, closing: boolean, error = ""): Partial<VideoState> {
  return { active: false, ready: false, paused: state.standalone && !closing ? state.paused : true,
    returnRequested: Boolean(state.standalone && !closing),
    error: closing ? (state.ready ? "" : state.error) : error || state.error };
}

// Owns one independent video engine. Commands are constrained here, never raw renderer IPC.
export class VideoPlayer {
  onInput?: (input: { action: "toggle" | "seek" | "volume" | "volumeDb"; amount: number }) => void;
  state = emptyVideoState();
  private child?: ChildProcess;
  private socket?: Socket;
  private sequence = 0;
  private pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private closing = false;
  private selectedAudioDevice = "auto";
  private sourceFile = "";
  private switching = false;
  private embeddedParent?: string;
  // The embedded renderer sends 0 while muted. Right before it detaches into
  // fullscreen it states the level it would unmute to (its store volume), so
  // the mute carries over at that level; undefined when it is not muted.
  private embeddedMutedVolume?: number;
  private externalSubtitles: string[] = [];
  private dsp = defaultVideoDsp();
  private dspQueue: Promise<void> = Promise.resolve();
  private appliedDspFilter = "";
  private routeChanging = false;
  constructor(private executable: string, private log: string, private changed: (state: VideoState) => void, private dspFile?: string) {
    try { if (dspFile) this.dsp = parseVideoDsp(JSON.parse(fs.readFileSync(dspFile, "utf8"))); } catch { /* Missing/invalid settings use safe defaults. */ }
    this.state.dsp = { ...this.dsp };
  }
  private dspState() {
    this.publish({ dsp: { ...this.dsp }, dspStatus: this.state.rackAudio ? "off" : videoDspStatus(this.dsp, this.state.direct, this.state.outputChannels || 0) });
  }
  private syncDsp() {
    const child = this.child;
    const update = this.dspQueue.catch(() => undefined).then(async () => {
      if (!child || this.child !== child || this.closing) return;
      const next = this.state.rackAudio || this.routeChanging || !this.state.sourceChannels ? "" : videoDspFilter(this.dsp, this.state.direct, this.state.outputChannels || 0);
      if (next === this.appliedDspFilter) return;
      await this.request(["set_property", "af", next]);
      this.appliedDspFilter = next;
    });
    this.dspQueue = update;
    return update;
  }
  private async changeAudioRoute(command?: unknown[]) {
    this.routeChanging = true;
    this.publish({ outputChannels: 0 }); this.dspState();
    try {
      await this.syncDsp();
      if (command) await this.request(command);
      if (!this.child || this.closing) return;
      // WASAPI can briefly report the property as unavailable while reopening
      // the selected endpoint. Its property-change event will finish the route.
      const params = await this.request(["get_property", "audio-out-params"]).catch(() => undefined) as Record<string, unknown> | undefined;
      this.routeChanging = false;
      if (params) this.setOutputParams(params);
      else if (this.state.outputChannels) void this.syncDsp().catch(error => this.publish({ dspError: String(error) }));
    } finally { this.routeChanging = false; }
  }
  private setOutputParams(params: Record<string, unknown> | undefined) {
    const count = Number(params?.["channel-count"]) || 0;
    this.publish({ outputChannels: count, output: params ? `${params.format || ""} · ${params.samplerate || ""} Hz · ${params.channels || ""}` : "" });
    this.dspState();
    void this.syncDsp().catch(error => this.publish({ dspError: String(error) }));
  }
  private async setDsp(value: unknown) {
    if (typeof value !== "string" || value.length > 512) throw new Error("VIDEO_DSP_INVALID");
    const next = parseVideoDsp(JSON.parse(value)), previous = this.dsp;
    this.dsp = next;
    try {
      await this.syncDsp();
      if (this.dspFile) {
        fs.mkdirSync(path.dirname(this.dspFile), { recursive: true });
        fs.writeFileSync(this.dspFile + ".tmp", JSON.stringify(next), "utf8");
        fs.renameSync(this.dspFile + ".tmp", this.dspFile);
      }
      this.publish({ dspError: "" }); this.dspState();
    } catch (error) {
      this.dsp = previous;
      await this.syncDsp().catch(() => undefined);
      this.publish({ dspError: String(error) }); this.dspState();
      throw error;
    }
  }
  private publish(patch: Partial<VideoState>) { this.state = { ...this.state, ...patch }; if (!this.switching) this.changed(this.state); }
  private rejectPending() {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error("VIDEO_CONNECTION_CLOSED")); }
    this.pending.clear();
  }
  private async request(command: unknown[]) {
    if (!this.socket || this.socket.destroyed) throw new Error("VIDEO_NOT_READY");
    const id = ++this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("VIDEO_COMMAND_TIMEOUT")); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(JSON.stringify({ command, request_id: id }) + "\n");
    });
  }
  private message(message: Record<string, unknown>) {
    if (message.event === "client-message" && Array.isArray(message.args) && message.args[0] === "astrelis-input" && !this.state.standalone) {
      const [, action, raw] = message.args, amount = Number(raw || 0);
      if ((action === "toggle" || action === "seek" || action === "volume" || action === "volumeDb") && Number.isFinite(amount) && Math.abs(amount) <= 10)
        this.onInput?.({ action, amount });
    }
    const pending = this.pending.get(Number(message.request_id));
    if (pending) {
      this.pending.delete(Number(message.request_id)); clearTimeout(pending.timer);
      if (message.error === "success") pending.resolve(message.data);
      else pending.reject(new Error(String(message.error || "VIDEO_COMMAND_FAILED")));
    }
    if (message.event === "file-loaded") this.publish({ ready: true, error: "" });
    if (message.event === "end-file" && message.reason === "error")
      this.publish({ ready: false, paused: true, error: String(message.file_error || "VIDEO_DECODE_FAILED") });
    // Decoder diagnostics can describe a recoverable bad packet. The mpv log
    // retains them; only end-file/error or process/IPC failure stops playback.
    // Publishing a diagnostic as state.error creates a permanent pause loop
    // in the renderer on every subsequent time-pos update.
    if (message.event !== "property-change") return;
    const value = message.data;
    switch (message.name) {
      case "fullscreen": if (this.state.standalone && value === false) this.publish({ returnRequested: true }); break;
      case "audio-device": this.publish({ audioDevice: String(value || "auto") }); break;
      case "audio-device-list": this.publish({ audioDevices: Array.isArray(value) ? value.filter(d => typeof d.name === "string" && (d.name === "auto" || d.name.startsWith("wasapi/"))).map(d => ({ name: d.name, description: String(d.description || d.name) })) : [] }); break;
      case "mute": this.publish({muted:Boolean(value)}); break;
      case "pause": this.publish({ paused: Boolean(value) }); break;
      case "eof-reached": this.publish({ ended: Boolean(value) }); break;
      case "time-pos": this.publish({ position: Number(value) || 0 }); break;
      case "duration": this.publish({ duration: Number(value) || 0 }); break;
      case "volume": this.publish({ volume: mpvVolumeToAmplitudePercent(Number(value) || 0) }); break;
      case "sub-delay": this.publish({ subtitleDelay: Number(value) || 0 }); break;
      case "sub-speed": this.publish({ subtitleSpeed: Number(value) || 1 }); break;
      case "audio-codec-name": this.publish({ audioCodec: String(value || "") }); break;
      case "video-format": this.publish({ videoCodec: String(value || "") }); break;
      case "hwdec-current": this.publish({ hwdec: String(value || "") }); break;
      case "audio-params": {
        const p = value as Record<string, unknown> | undefined;
        const count = Number(p?.["channel-count"]) || (p?.channels === "stereo" ? 2 : 0);
        if (count !== this.state.sourceChannels) {
          this.publish({ sourceChannels: count });
          // A new track can change the endpoint negotiation. Remove our stereo
          // conversion before measuring it again.
          if (this.appliedDspFilter) void this.changeAudioRoute().catch(error => this.publish({ dspError: String(error) }));
          else { this.dspState(); void this.syncDsp().catch(error => this.publish({ dspError: String(error) })); }
        }
        break;
      }
      case "audio-out-params": this.setOutputParams(value as Record<string, unknown> | undefined); break;
      case "track-list": this.publish({ tracks: Array.isArray(value) ? value.map(t => ({ id: Number(t.id), type: String(t.type),
        title: String(t.title || ""), lang: String(t.lang || ""), selected: Boolean(t.selected) })) : [] }); break;
    }
  }
  async open(file: string, direct: boolean, parent?: string, playbackToken?: string, standalone = false, language = "zh-CN", rackAudio = false, initialAudio?: VideoInitialAudio) {
    if (direct && rackAudio) throw new Error("VIDEO_RACK_DIRECT_CONFLICT");
    if (this.child) throw new Error("VIDEO_ALREADY_ACTIVE");
    try {
      file = validateVideoFile(file);
      if (!fs.existsSync(this.executable)) throw new Error("VIDEO_ENGINE_MISSING");
    } catch (error) {
      // A moved file or an unplugged drive fails before any engine starts;
      // report it against this request so the surface does not wait forever.
      this.fail(playbackToken, error instanceof Error ? error.message : String(error));
      throw error;
    }
    if (file !== this.sourceFile) this.externalSubtitles=[];
    this.sourceFile = file;
    if (parent) this.embeddedParent = parent;
    fs.mkdirSync(path.dirname(this.log), { recursive: true });
    const pipe = `\\\\.\\pipe\\astrelis-video-${process.pid}-${randomUUID()}`;
    this.closing = false;
    this.state = emptyVideoState();
    const audio = initialAudio && !direct ? { volume: clampVolumePercent(initialAudio.volume), muted: Boolean(initialAudio.muted) } : undefined;
    this.publish({ active: true, title: path.basename(file), direct, rackAudio, error: "", playbackToken, standalone, ...audio });
    const args = videoArguments(pipe, direct, this.log, parent, rackAudio, audio);
    args.push("--script=" + path.join(path.dirname(this.executable), "astrelis-input.lua"),
      "--script-opts=astrelis-input-embedded=" + (parent ? "yes" : "no") + ",astrelis-input-direct=" + (direct ? "yes" : "no")
      + ",astrelis-controls-language=" + language + ",astrelis-controls-direct=" + (direct ? "yes" : "no"));
    this.appliedDspFilter = "";
    this.dspState();
    // initialAudio on a standalone open is a queue advance carried into
    // fullscreen; the rack still starts paused until its PCM bridge is primed.
    if (standalone) args.push(...videoStandaloneArguments(path.dirname(this.executable), Boolean(initialAudio) && !rackAudio));
    const child = spawn(this.executable, args, { windowsHide: true, stdio: "ignore" });
    this.child = child;
    const finish = (error = "") => {
      if (this.child !== child) return;
      this.child = undefined; this.socket?.destroy(); this.socket = undefined; this.rejectPending();
      this.publish(videoExitPatch(this.state, this.closing, error));
    };
    child.once("error", error => finish(error.message));
    child.once("exit", code => finish(code ? `VIDEO_ENGINE_EXIT_${code}` : ""));
    try {
      const deadline = Date.now() + 10000;
      while (!this.socket) {
        if (this.child !== child || this.closing) throw new Error(this.state.error || "VIDEO_START_CANCELLED");
        if (Date.now() >= deadline) throw new Error("VIDEO_START_TIMEOUT");
        try {
          this.socket = await new Promise<Socket>((resolve, reject) => {
            const socket = createConnection(pipe);
            const fail = (e: Error) => { socket.destroy(); reject(e); };
            socket.once("error", fail);
            socket.once("connect", () => { socket.removeListener("error", fail); resolve(socket); });
          });
        } catch { await new Promise(resolve => setTimeout(resolve, 75)); }
      }
      let buffer = "";
      this.socket.setEncoding("utf8");
      this.socket.on("data", chunk => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) { void this.close(); return; }
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try { this.message(JSON.parse(line)); } catch { /* Non-JSON diagnostic line. */ }
        }
      });
      this.socket.on("error", error => { this.publish({ error: error.message }); void this.close(); });
      this.socket.on("close", () => { this.rejectPending(); if (this.child && !this.closing) { if (this.state.standalone) this.publish({returnRequested:true}); else void this.close(); } });
      await this.request(["request_log_messages", "error"]);
      for (const [index, property] of ["audio-device", "audio-device-list", "fullscreen", "mute", "pause", "eof-reached", "time-pos", "duration", "volume", "sub-delay", "sub-speed", "audio-codec-name", "video-format", "hwdec-current", "audio-out-params", "audio-params", "track-list"].entries())
        await this.request(["observe_property", index + 1, property]);
      const devices = await this.request(["get_property", "audio-device-list"]) as { name: string }[];
      if (!devices.some(d => d.name === this.selectedAudioDevice)) this.selectedAudioDevice = "auto";
      await this.request(["set_property", "audio-device", this.selectedAudioDevice]);
      await this.request(["loadfile", file, "replace"]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.close(); this.publish({ error: message }); throw error;
    }
  }
  async rehost(standalone: boolean, language = "zh-CN") {
    if (this.switching) throw new Error("VIDEO_WINDOW_BUSY");
    const saved = { ...this.state }, file = this.sourceFile;
    if (!file || (!saved.ready && !saved.returnRequested)) throw new Error("VIDEO_NOT_READY");
    this.switching = true;
    try {
      await this.close();
      await this.open(file, saved.direct, standalone ? undefined : this.embeddedParent, saved.playbackToken, standalone, language, saved.rackAudio);
      const deadline = Date.now()+10000;
      while (!this.state.ready) {
        if (!this.state.active || this.state.error || Date.now()>deadline) throw new Error(this.state.error || "VIDEO_START_TIMEOUT");
        await new Promise(resolve=>setTimeout(resolve,40));
      }
      await this.request(["seek",saved.position,"absolute+exact"]);
      await this.request(["set_property","sub-delay",saved.subtitleDelay]);
      await this.request(["set_property","sub-speed",saved.subtitleSpeed]);
      for (const subtitle of this.externalSubtitles) await this.request(["sub-add",subtitle,"auto"]);
      for (const kind of ["audio","sub"]) {
        const track=saved.tracks.find(t=>t.type===kind&&t.selected);
        if (track) await this.request(["set_property",kind==="audio"?"aid":"sid",track.id]);
        else if (kind==="sub") await this.request(["set_property","sid","no"]);
      }
      // Standalone fullscreen owns mpv's mute. The embedded player is driven by
      // the renderer, which only sends a volume (0 while muted) and never mute,
      // so carry a fullscreen mute back as silence it can lift, and carry an
      // embedded silence into fullscreen as a mute of the last audible level.
      // The renderer's statement is used once, for the switch it preceded.
      const mutedLevel = this.embeddedMutedVolume;
      this.embeddedMutedVolume = undefined;
      const silenced = standalone && !saved.standalone && !saved.direct && !saved.muted && mutedLevel !== undefined;
      const muted = standalone && (Boolean(saved.muted) || silenced);
      const volume = silenced ? mutedLevel! : !standalone && saved.muted ? 0 : saved.volume;
      if (!saved.direct) await this.request(["set_property","volume",amplitudePercentToMpvVolume(volume)]);
      await this.request(["set_property","mute",muted]);
      await this.request(["set_property","pause",saved.rackAudio ? true : saved.paused]);
      this.state={...this.state,position:saved.position,paused:saved.rackAudio ? true : saved.paused,volume:saved.direct ? saved.volume : volume,muted,returnRequested:false};
    } finally { this.switching=false;this.publish({}); }
  }
  private clockSyncEpoch = 0;
  private clockSyncBusy = false;
  private clockSyncAt = 0;
  async synchronizeAudioClock(audio: number) {
    if (this.clockSyncBusy || !this.state.rackAudio || !this.state.ready || this.state.paused || Date.now() - this.clockSyncAt < 350) return;
    const epoch = this.clockSyncEpoch;
    this.clockSyncBusy = true;
    this.clockSyncAt = Date.now();
    try {
      const video = Number(await this.request(["get_property", "time-pos"]));
      if (epoch !== this.clockSyncEpoch || this.state.paused || !this.state.active) return;
      const correction = videoClockCorrection(audio, video);
      await this.request(["set_property", "speed", correction.speed]);
      if (epoch === this.clockSyncEpoch && correction.seek !== undefined && this.state.active && !this.state.paused) {
        await this.request(["seek", correction.seek, "absolute+exact"]);
        this.clockSyncAt = Date.now() + 650;
      }
    } finally { this.clockSyncBusy = false; }
  }
  async control(action: unknown, value?: unknown) {
    ++this.clockSyncEpoch;
    if (!this.state.active) throw new Error("VIDEO_NOT_ACTIVE");
    switch (action) {
      case "dsp": if (this.state.rackAudio) throw new Error("VIDEO_DSP_BYPASSED_BY_VST"); await this.setDsp(value); break;
      case "device":
        if (this.state.rackAudio) throw new Error("VIDEO_DEVICE_MANAGED_BY_VST");
        if (typeof value !== "string" || !this.state.audioDevices?.some(d => d.name === value)) throw new Error("VIDEO_DEVICE_INVALID");
        await this.changeAudioRoute(["set_property", "audio-device", value]);
        this.selectedAudioDevice = value; break;
      case "play":
        if(this.state.ended) await this.request(["seek",0,"absolute+exact"]);
        await this.request(["set_property","pause",false]); break;
      case "pause": await this.request(["set_property","pause",true]); break;
      case "toggle":
        if (this.state.ended) { await this.request(["seek", 0, "absolute+exact"]); await this.request(["set_property", "pause", false]); }
        else await this.request(["cycle", "pause"]);
        break;
      case "fullscreen": await this.request(["cycle", "fullscreen"]); break;
      case "seek":
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("VIDEO_VALUE_INVALID");
        await this.request(["seek", Math.max(0, Math.min(this.state.duration, value)), "absolute+exact"]); break;
      case "volume":
        if (typeof value !== "number" || !Number.isFinite(value) || this.state.direct) throw new Error("VIDEO_VALUE_INVALID");
        // Standalone: mpv owns mute, and a muted player is already silent.
        if (this.state.standalone && this.state.muted && value === 0) break;
        await this.request(["set_property", "volume", amplitudePercentToMpvVolume(value)]);
        // Embedded: the renderer's volume is authoritative (0 while muted), so
        // no mpv mute may outlive it.
        if (!this.state.standalone && this.state.muted) { await this.request(["set_property", "mute", false]); this.publish({ muted: false }); }
        break;
      case "mutedVolume":
        // Sent by the renderer right before "detach": its volume while muted,
        // or a negative value when it is not muted. Inferring it from earlier
        // volume commands went stale across fullscreen changes and new files.
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("VIDEO_VALUE_INVALID");
        this.embeddedMutedVolume = value >= 0 && !this.state.standalone ? clampVolumePercent(value) : undefined;
        break;
      case "subtitleDelay":
        if (typeof value !== "number" || !Number.isFinite(value) || value < -120 || value > 120) throw new Error("VIDEO_VALUE_INVALID");
        await this.request(["set_property", "sub-delay", value]); break;
      case "subtitleSpeed":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0.5 || value > 2) throw new Error("VIDEO_VALUE_INVALID");
        await this.request(["set_property", "sub-speed", value]); break;
      case "subtitleAlign":
        if (value !== 0 && value !== 1 && value !== -1) throw new Error("VIDEO_VALUE_INVALID");
        if (!this.state.tracks.some(t => t.type === "sub" && t.selected)) throw new Error("VIDEO_TRACK_INVALID");
        await this.request(["sub-step", value]); break;
      case "audio": case "subtitle": {
        const type = action === "audio" ? "audio" : "sub";
        if (!(action === "subtitle" && value === "no") && !this.state.tracks.some(t => t.type === type && t.id === value))
          throw new Error("VIDEO_TRACK_INVALID");
        if (type === "audio") await this.changeAudioRoute(["set_property", "aid", value]);
        else await this.request(["set_property", "sid", value]); break;
      }
      default: throw new Error("VIDEO_ACTION_INVALID");
    }
  }
  async addSubtitle(file: string) {
    if (!path.isAbsolute(file) || !/\.(srt|ass|ssa|vtt|sub)$/i.test(file) || !fs.statSync(file).isFile()) throw new Error("SUBTITLE_FILE_INVALID");
    await this.request(["sub-add", file, "select"]);
    if (!this.externalSubtitles.includes(file)) this.externalSubtitles.push(file);
  }
  async close() {
    ++this.clockSyncEpoch;
    const child = this.child;
    if (!child) return;
    this.closing = true;
    await this.dspQueue.catch(() => undefined);
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    try { await this.request(["quit"]); } catch { /* quit commonly closes IPC before its reply. */ }
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 800))]);
    if (this.child === child) child.kill();
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1500))]);
    if (this.child === child) throw new Error("VIDEO_STOP_TIMEOUT");
  }
  reportError(error: string) { this.publish({ error, paused: true }); }
  // A load that failed before (or after) the engine ran: publish the reason
  // with the request's token so the surface shows it instead of "preparing".
  // Without an engine nothing is fullscreen any more and nothing may ask the
  // main window to take the video back.
  fail(playbackToken: string | undefined, error: string) {
    if (this.child) { this.publish({ error, paused: true }); return; }
    this.publish({ active: false, ready: false, paused: true, ended: false, title: "", position: 0, duration: 0, tracks: [], error, playbackToken,
      standalone: false, returnRequested: false });
  }
  dispose() { this.closing = true; this.socket?.destroy(); this.child?.kill(); }
}

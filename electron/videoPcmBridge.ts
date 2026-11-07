import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export const videoPcmRate = 48000;
export const videoPcmFrames = 1024;
const packetBytes = videoPcmFrames * 2 * Float32Array.BYTES_PER_ELEMENT;
const bufferedHighFrames = videoPcmRate * 0.55;
const bufferedLowFrames = videoPcmRate * 0.38;

export function videoPcmArguments(file: string, audioIndex: number, position: number) {
  if (!path.isAbsolute(file) || !Number.isInteger(audioIndex) || audioIndex < 0 || !Number.isFinite(position) || position < 0)
    throw new Error("VIDEO_PCM_SOURCE_INVALID");
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(position), "-i", file,
    "-map", `0:a:${audioIndex}`, "-vn", "-sn", "-dn", "-ac", "2", "-ar", String(videoPcmRate),
    "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"];
}

type NativeReply = { ok?: boolean; error?: string; captureConsumedFrames?: number; captureUnderruns?: number;
  pluginLatencySamples?: number; sampleRate?: number };
type PcmPacket = { protocolVersion: number; mediaSessionId: number; sequence: number;
  sourceFrameCounter: number; producerTimestamp: number; sampleRate: number; channels: number; frames: number; pcm: Buffer };

/** Experimental local-video PCM producer. The native host owns the clock and VST output. */
export class VideoPcmBridge {
  private child?: ChildProcess;
  private generation = 0;
  private session = 0;
  private active = false;
  private statusTimer?: ReturnType<typeof setInterval>;
  private statusRequest?: Promise<NativeReply>;
  private statusPaused = false;
  private consumedFrames = 0;
  private clockStart = 0;
  private clockReady = false;
  private sentFrames = 0;
  private underruns = 0;
  private pluginLatencySeconds = 0;
  constructor(private ffmpeg: string,
    private nativeCommand: (command: Record<string, unknown>) => Promise<NativeReply>,
    private packet: (packet: PcmPacket) => boolean,
    private failed: (error: Error) => void,
    private clockUpdated?: (clock: number) => void) {}

  async start(file: string, audioIndex: number, position: number, volume: number) {
    const args = videoPcmArguments(file, audioIndex, position);
    await this.stop();
    const generation = ++this.generation;
    const started = await this.nativeCommand({ type: "pcm-start" });
    if (!started.ok) throw new Error(started.error || "VIDEO_PCM_HOST_START_FAILED");
    this.active = true;
    this.clockStart = position;
    this.clockReady = false;
    this.consumedFrames = this.sentFrames = this.underruns = 0;
    this.pluginLatencySeconds = 0;
    await this.setVolume(volume);
    const session = ++this.session;
    let sequence = 0, frames = 0, pending = Buffer.alloc(0), stderr = "";
    const child = spawn(this.ffmpeg, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    try {
      await new Promise<void>((resolve, reject) => {
        let done = false, failed = false, polling = false;
        const settle = (error?: Error) => {
          if (done) return;
          done = true; clearTimeout(timer);
          if (error) reject(error); else resolve();
        };
        const abort = (error: Error) => {
          if (failed || generation !== this.generation) return;
          failed = true;
          if (done) this.failed(error); else settle(error);
          child.kill();
        };
        const timer = setTimeout(() => abort(new Error("VIDEO_PCM_PREPARE_TIMEOUT")), 12000);
        const pump = () => {
          if (failed || generation !== this.generation) return;
          while (pending.length >= packetBytes && this.sentFrames - this.consumedFrames < bufferedHighFrames) {
            const pcm = pending.subarray(0, packetBytes);
            pending = pending.subarray(packetBytes);
            sequence++; frames += videoPcmFrames;
            if (!this.packet({ protocolVersion: 1, mediaSessionId: session, sequence,
              sourceFrameCounter: frames, producerTimestamp: Date.now() * 1000,
              sampleRate: videoPcmRate, channels: 2, frames: videoPcmFrames, pcm })) {
              abort(new Error("VIDEO_PCM_HOST_UNAVAILABLE")); return;
            }
            this.sentFrames = frames;
          }
          if (this.sentFrames - this.consumedFrames >= bufferedHighFrames) child.stdout?.pause();
          else if (this.sentFrames - this.consumedFrames <= bufferedLowFrames) child.stdout?.resume();
        };
        const poll = async () => {
          if (polling || this.statusPaused || failed || generation !== this.generation) return;
          polling = true;
          try {
            const request = this.nativeCommand({ type: "status" });
            this.statusRequest = request;
            const status = await request;
            if (generation !== this.generation) return;
            if (!status.ok) throw new Error(status.error || "VIDEO_PCM_STATUS_FAILED");
            const consumed = Number(status.captureConsumedFrames);
            if (!Number.isFinite(consumed) || consumed < 0) throw new Error("VIDEO_PCM_CLOCK_UNAVAILABLE");
            this.consumedFrames = consumed;
            this.underruns = Number(status.captureUnderruns) || 0;
            const outputRate = Number(status.sampleRate) || videoPcmRate;
            this.pluginLatencySeconds = Math.max(0, Number(status.pluginLatencySamples) || 0) / outputRate;
            if (consumed / videoPcmRate > this.pluginLatencySeconds) { this.clockReady = true; settle(); }
            pump();
            if (this.clock !== undefined) this.clockUpdated?.(this.clock);
          } catch (error) { abort(error instanceof Error ? error : new Error(String(error))); }
          finally { if (generation === this.generation) this.statusRequest = undefined; polling = false; }
        };
        this.statusTimer = setInterval(() => { void poll(); }, 60);
        child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-1200); });
        child.stdout?.on("data", chunk => {
          if (generation !== this.generation) return;
          pending = Buffer.concat([pending, chunk]);
          pump();
        });
        child.once("error", error => abort(error));
        child.once("exit", (code, signal) => {
          if (generation !== this.generation) return;
          if (this.child === child) this.child = undefined;
          if (code && signal == null) abort(new Error(`VIDEO_PCM_DECODE_FAILED: ${stderr || code}`));
          else if (!done && frames === 0) abort(new Error(`VIDEO_PCM_DECODE_FAILED: ${stderr || code || signal || "no audio"}`));
        });
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async setVolume(value: number) {
    const response = await this.nativeCommand({ type: "volume", value: Math.max(0, Math.min(1, value)) });
    if (!response.ok) throw new Error(response.error || "VIDEO_PCM_VOLUME_FAILED");
  }

  async withStatusPaused<T>(work: () => Promise<T>): Promise<T> {
    this.statusPaused = true;
    try {
      // Native control commands share the host's message thread. Drain the
      // current status request before a plugin editor or rack load occupies it.
      await this.statusRequest?.catch(() => undefined);
      return await work();
    } finally {
      this.statusPaused = false;
    }
  }

  async stop() {
    ++this.generation;
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = undefined;
    this.clockReady = false;
    const child = this.child; this.child = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); child.removeListener("exit", done); resolve(); };
        const timer = setTimeout(done, 1500);
        child.once("exit", done);
        child.kill();
      });
    }
    if (!this.active) return;
    this.active = false;
    const response = await this.nativeCommand({ type: "pcm-stop" });
    if (!response.ok) throw new Error(response.error || "VIDEO_PCM_HOST_STOP_FAILED");
  }

  get running() { return this.active && this.clockReady; }
  get clock() { return this.active && this.clockReady
    ? this.clockStart + this.consumedFrames / videoPcmRate - this.pluginLatencySeconds : undefined; }
  get underrunCount() { return this.underruns; }
}

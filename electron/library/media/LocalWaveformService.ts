import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const WAVEFORM_BINS = 720;
export const WAVEFORM_SAMPLE_RATE = 8000;
const MAX_WAVEFORM_DURATION_SECONDS = 7 * 24 * 60 * 60;
const MIN_PLAUSIBLE_AUDIO_BITRATE = 1_000;
export type LocalWaveformResult = { ok: boolean; peaks?: number[]; error?: string };

function plausibleDuration(duration: number | undefined, fileSize: number) {
  if (!duration || !Number.isFinite(duration) || duration <= 0 || duration > MAX_WAVEFORM_DURATION_SECONDS)
    return undefined;
  // Some APE headers are reported by metadata readers as multi-year tracks.
  // Reject durations that imply an impossible average bitrate and let the
  // progressive accumulator derive its own sampling stride from decoded PCM.
  return fileSize * 8 / duration >= MIN_PLAUSIBLE_AUDIO_BITRATE ? duration : undefined;
}

/** Keeps 720 peaks and at most three trailing bytes, regardless of song length. */
export class WaveformPeakAccumulator {
  private readonly bins = new Float32Array(WAVEFORM_BINS);
  private stride: number;
  private frames = 0;
  private remainder = Buffer.alloc(0);

  constructor(duration?: number) {
    this.stride = duration && Number.isFinite(duration) && duration > 0
      ? Math.max(1, Math.ceil(duration * WAVEFORM_SAMPLE_RATE / WAVEFORM_BINS)) : 64;
  }

  push(chunk: Buffer) {
    const bytes = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
    const complete = bytes.length - bytes.length % 4;
    for (let offset = 0; offset < complete; offset += 4) {
      if (this.frames >= this.stride * WAVEFORM_BINS) {
        for (let index = 0; index < WAVEFORM_BINS / 2; index++)
          this.bins[index] = Math.max(this.bins[index * 2], this.bins[index * 2 + 1]);
        this.bins.fill(0, WAVEFORM_BINS / 2);
        this.stride *= 2;
      }
      const value = Math.abs(bytes.readFloatLE(offset));
      const bin = Math.floor(this.frames++ / this.stride);
      if (Number.isFinite(value)) this.bins[bin] = Math.max(this.bins[bin], value);
    }
    this.remainder = Buffer.from(bytes.subarray(complete));
  }

  finish() {
    if (!this.frames || this.remainder.length) throw new Error("波形音频数据不完整");
    const peaks = Array<number>(WAVEFORM_BINS).fill(0);
    let maximum = 0;
    for (let index = 0; index < WAVEFORM_BINS; index++) {
      const first = Math.floor(index * this.frames / WAVEFORM_BINS / this.stride);
      const last = Math.min(WAVEFORM_BINS, Math.max(first + 1, Math.ceil((index + 1) * this.frames / WAVEFORM_BINS / this.stride)));
      for (let bin = first; bin < last; bin++) peaks[index] = Math.max(peaks[index], this.bins[bin]);
      maximum = Math.max(maximum, peaks[index]);
    }
    return maximum ? peaks.map(value => value / maximum) : peaks;
  }
}

const cancelled = (signal?: AbortSignal) => signal?.reason instanceof Error ? signal.reason : new Error("波形生成已取消");

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelled(signal));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(cancelled(signal)); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

export function streamWaveform(executable: string, sourcePath: string, duration: number | undefined, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(cancelled(signal));
  return new Promise<number[]>((resolve, reject) => {
    const peaks = new WaveformPeakAccumulator(duration);
    const child = spawn(executable, ["-v", "error", "-nostdin", "-threads", "1", "-i", sourcePath,
      "-map", "0:a:0", "-vn", "-sn", "-dn", "-ac", "1", "-ar", String(WAVEFORM_SAMPLE_RATE),
      "-c:a", "pcm_f32le", "-threads", "1", "-f", "f32le", "pipe:1"],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let failure: Error | undefined;
    let diagnostics = "";
    const stop = (error: Error) => { failure ||= error; child.kill(); };
    const abort = () => stop(cancelled(signal));
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop(new Error("波形生成超时")), 120_000);
    child.stdout.on("data", (chunk: Buffer) => { if (!failure) peaks.push(chunk); });
    child.stderr.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4096); });
    child.once("error", error => { failure ||= error; });
    // Wait for close after cancellation so the next song never overlaps a decoder.
    child.once("close", code => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (failure || code !== 0) { reject(failure || new Error(diagnostics.trim() || "FFmpeg 无法生成波形")); return; }
      try { resolve(peaks.finish()); } catch (error) { reject(error); }
    });
    if (signal.aborted) abort();
  });
}

export interface LocalWaveformOptions {
  executable: () => string;
  duration: (sourcePath: string) => Promise<number | undefined>;
  cacheSize?: number;
  timeoutMs?: number;
  run?: (sourcePath: string, duration: number | undefined, signal: AbortSignal) => Promise<number[]>;
}

export class LocalWaveformService {
  private readonly cache = new Map<string, number[]>();
  private tail: Promise<unknown> = Promise.resolve();
  private active?: { sourcePath: string; consumers: Set<string>; controller: AbortController; promise: Promise<LocalWaveformResult> };
  constructor(private readonly options: LocalWaveformOptions) {}

  request(sourcePath: string, requestId = "default"): Promise<LocalWaveformResult> {
    const normalized = path.resolve(sourcePath);
    if (this.active?.sourcePath === normalized && !this.active.controller.signal.aborted) {
      this.active.consumers.add(requestId);
      return this.active.promise;
    }
    this.active?.controller.abort();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("波形生成超时")), this.options.timeoutMs || 120_000);
    const promise = this.tail.catch(() => undefined).then(() => this.generate(normalized, controller.signal));
    this.active = { sourcePath: normalized, consumers: new Set([requestId]), controller, promise };
    this.tail = promise;
    void promise.then(() => { clearTimeout(timeout); if (this.active?.promise === promise) this.active = undefined; });
    return promise;
  }

  cancel(sourcePath?: string, requestId?: string) {
    if (!this.active || (sourcePath && this.active.sourcePath !== path.resolve(sourcePath))) return;
    if (requestId !== undefined) {
      if (!this.active.consumers.delete(requestId) || this.active.consumers.size) return;
    }
    this.active.controller.abort();
  }

  private async generate(sourcePath: string, signal: AbortSignal): Promise<LocalWaveformResult> {
    try {
      if (signal.aborted) throw cancelled(signal);
      const stat = await abortable(fs.promises.stat(sourcePath), signal);
      if (signal.aborted) throw cancelled(signal);
      if (!stat.isFile()) throw new Error("波形源文件不存在");
      const key = `${sourcePath}|${stat.size}|${stat.mtimeMs}`;
      const cached = this.cache.get(key);
      if (cached) {
        this.cache.delete(key); this.cache.set(key, cached);
        return { ok: true, peaks: cached.slice() };
      }
      // Header metadata is enough for common formats. Unknown durations use a
      // bounded, progressively coarser envelope and are normalized after EOF.
      const metadataDuration = await abortable(this.options.duration(sourcePath).catch(() => undefined), signal);
      const duration = plausibleDuration(metadataDuration, stat.size);
      if (signal.aborted) throw cancelled(signal);
      const values = await (this.options.run
        ? this.options.run(sourcePath, duration, signal)
        : streamWaveform(this.options.executable(), sourcePath, duration, signal));
      if (signal.aborted) throw cancelled(signal);
      if (values.length !== WAVEFORM_BINS || values.some(value => !Number.isFinite(value) || value < 0 || value > 1))
        throw new Error("波形峰值无效");
      const after = await abortable(fs.promises.stat(sourcePath), signal);
      if (signal.aborted) throw cancelled(signal);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("音频文件已改变");
      this.cache.set(key, values.slice());
      const limit = Math.min(96, Math.max(1, this.options.cacheSize || 96));
      while (this.cache.size > limit) this.cache.delete(this.cache.keys().next().value!);
      return { ok: true, peaks: values };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "波形生成失败" };
    }
  }
}

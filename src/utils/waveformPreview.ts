// Waveform previews are optional: playback must never wait for these jobs.
const CACHE_LIMIT = 96;
const cache = new Map<string, Float32Array>();
let pending: Promise<unknown> = Promise.resolve();

export function cachedWaveform(key: string) {
  const value = cache.get(key);
  if (value) { cache.delete(key); cache.set(key, value); }
  return value;
}

export function cacheWaveform(key: string, peaks: Float32Array) {
  cache.delete(key);
  cache.set(key, peaks);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export function scheduleWaveform<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T | undefined> {
  // An in-flight decode cannot be aborted. Wait for it before starting another.
  const job = pending.then(() => signal.aborted ? undefined : task());
  pending = job.catch(() => undefined);
  return job;
}

export async function readPreviewBytes(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.ok) throw new Error("Preview request failed");
  if (!response.body) throw new Error("Preview stream unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes.buffer;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function keyboardSeek(key: string, current: number, duration: number, accelerated = false): number | null {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) return null;
  const step = accelerated ? 30 : 5;
  const target = key === "Home" ? 0 : key === "End" ? duration
    : key === "ArrowRight" || key === "ArrowUp" ? current + step
    : key === "ArrowLeft" || key === "ArrowDown" ? current - step : null;
  return target === null ? null : Math.max(0, Math.min(duration, target));
}

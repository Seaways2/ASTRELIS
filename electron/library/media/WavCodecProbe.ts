import fs from "node:fs";

/** WAV headers can advertise PCM while their payload contains a DTS bitstream. */
export class WavCodecProbe {
  private readonly cache = new Map<string, Promise<boolean>>();
  constructor(private readonly inspect: (source: string) => Promise<string>) {}

  async isDts(source: string): Promise<boolean> {
    const stat = await fs.promises.stat(source);
    const key = `${source}|${stat.size}|${stat.mtimeMs}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    const job = this.inspect(source).then(report => {
      const codec = report.match(/Stream #0:\d+[^\r\n]*Audio:\s*(\w+)/)?.[1];
      if (!codec) throw new Error("无法识别 WAV 音频编码，已停止播放");
      return codec === "dts";
    });
    this.cache.set(key, job);
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
    job.catch(() => { if (this.cache.get(key) === job) this.cache.delete(key); });
    return job;
  }
}

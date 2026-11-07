import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface DirectAudioFormat {
  codec: "pcm" | "pcm-float" | "dts" | "ac3" | "eac3";
  sampleRate: number; channels: number; bits: number; validBits: number;
  channelMask: number; encodedSampleRate: number; encodedChannels: number;
  burstBytes: number;
}
const layouts: Record<string, [number, number]> = {
  mono: [1, 4], stereo: [2, 3], "1 channels": [1, 4], "2 channels": [2, 3],
  "2.1": [3, 11], "3.0": [3, 7], "4.0": [4, 263], quad: [4, 51],
  "5.0": [5, 55], "5.0(side)": [5, 1543], "5.1": [6, 63],
  "5.1(side)": [6, 1551], "6.1": [7, 1807], "7.1": [8, 1599]
};

export function directFormatFromReport(report: string): DirectAudioFormat {
  const line = report.split(/\r?\n/).find(line => /Stream #0:\d+.*Audio:/.test(line));
  const match = line?.match(/Audio:\s*(\w+).*?,\s*(\d+) Hz,\s*([^,]+)/);
  if (!match) throw new Error("无法识别原始音频编码，已停止直通");
  const [, codec, rateText, layout] = match;
  const sampleRate = Number(rateText);
  const channels = layouts[layout.trim()];
  if (!channels || sampleRate < 8000 || sampleRate > 384000) throw new Error("直通暂不支持此采样率或声道布局");
  if (/DTS-HD|TrueHD|MLP/i.test(line!) || /^(truehd|mlp|dsd)/.test(codec))
    throw new Error("此编码尚未实现直通，请使用普通播放；不会自动丢弃高清扩展或降混");
  if (codec === "dts" || codec === "ac3" || codec === "eac3") {
    if (![32000, 44100, 48000].includes(sampleRate)) throw new Error("编码直通不支持此采样率");
    return { codec, sampleRate: codec === "eac3" ? sampleRate * 4 : sampleRate,
      channels: 2, bits: 16, validBits: 16, channelMask: 3,
      encodedSampleRate: sampleRate, encodedChannels: channels[0], burstBytes: 0 };
  }
  const integer = line!.match(/\bs(16|32)p?(?:\s*\((\d+) bit\))?/);
  const sourceBits = integer ? Number(integer[2] || integer[1]) : 24;
  const float = /^pcm_f(32|64)/.test(codec);
  if (codec === "pcm_f64le" || codec === "pcm_f64be") throw new Error("64 位浮点 PCM 暂不支持原样输出");
  const bits = sourceBits <= 16 && !float ? 16 : 32;
  return { codec: float ? "pcm-float" : "pcm", sampleRate, channels: channels[0], bits,
    validBits: float ? 32 : Math.min(sourceBits, 32), channelMask: channels[1],
    encodedSampleRate: sampleRate, encodedChannels: channels[0], burstBytes: 0 };
}

/** Validate every burst, not just a sync word: malformed data must never reach an endpoint. */
export async function validateDirectFile(file: string, format: DirectAudioFormat) {
  const handle = await fs.promises.open(file, "r");
  try {
    const size = (await handle.stat()).size;
    if (!size || size % (format.channels * format.bits / 8)) throw new Error("直通缓存不完整");
    if (format.codec.startsWith("pcm")) return 0;
    let offset = 0, burstBytes = 0;
    const header = Buffer.alloc(8);
    while (offset < size) {
      if ((await handle.read(header, 0, 8, offset)).bytesRead !== 8
          || header.readUInt16LE(0) !== 0xf872 || header.readUInt16LE(2) !== 0x4e1f)
        throw new Error("IEC 61937 帧同步校验失败");
      const info = header.readUInt16LE(4);
      const type = info & 0x7f;
      if (info & 0x80) throw new Error("IEC 61937 帧携带错误标志");
      const bytes = format.codec === "ac3" && type === 1 ? 6144
        : format.codec === "eac3" && type === 21 ? 24576
        : format.codec === "dts" ? ({ 11: 2048, 12: 4096, 13: 8192 } as Record<number, number>)[type] : 0;
      const payload = header.readUInt16LE(6) / (format.codec === "eac3" ? 1 : 8);
      if (!bytes || !payload || payload > bytes - 8 || offset + bytes > size || (burstBytes && bytes !== burstBytes))
        throw new Error("不支持或不完整的 IEC 61937 数据帧");
      burstBytes = bytes;
      offset += bytes;
    }
    return burstBytes;
  } finally { await handle.close(); }
}

export class DirectAudioCache {
  private pending = new Map<string, Promise<DirectAudioFormat & { path: string }>>();
  constructor(private directory: string, private run: (args: string[]) => Promise<string>) {}
  async prepare(source: string): Promise<DirectAudioFormat & { path: string }> {
    const stat = await fs.promises.stat(source);
    if (!stat.isFile()) throw new Error("音频文件不可用");
    const key = crypto.createHash("sha256").update(`direct-v1|${source}|${stat.size}|${stat.mtimeMs}`).digest("hex");
    const pending = this.pending.get(key);
    if (pending) {
      const prepared = await pending;
      if (fs.existsSync(prepared.path)) return prepared;
      // A user may have cleared this completed disk cache since the last play.
      this.pending.delete(key);
      return this.prepare(source);
    }
    const task = this.prepareFile(source, key, stat);
    this.pending.set(key, task);
    task.then(() => { if (this.pending.size > 64) this.pending.delete(this.pending.keys().next().value!); }, () => this.pending.delete(key));
    return task;
  }
  private async prepareFile(source: string, key: string, before: fs.Stats) {
    const format = directFormatFromReport(await this.run([
      "-hide_banner", "-nostdin", "-i", source, "-map", "0:a:0", "-c:a", "copy", "-frames:a", "1", "-f", "null", "-"
    ]));
    await fs.promises.mkdir(this.directory, { recursive: true });
    const destination = path.join(this.directory, `${key}.raw`);
    if (fs.existsSync(destination)) {
      try { format.burstBytes = await validateDirectFile(destination, format); return { ...format, path: destination }; }
      catch { /* Incomplete cache is regenerated below. */ }
    }
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
      const pcm = format.codec.startsWith("pcm");
      const encoder = format.codec === "pcm-float" ? "pcm_f32le" : format.bits === 16 ? "pcm_s16le" : "pcm_s32le";
      const muxer = format.codec === "pcm-float" ? "f32le" : format.bits === 16 ? "s16le" : "s32le";
      // No -ar, -ac, volume, filters or lossy encoder: source rate and layout stay intact.
      await this.run(["-hide_banner", "-nostdin", "-y", "-i", source, "-map", "0:a:0", "-vn",
        "-threads", "1", "-c:a", pcm ? encoder : "copy", "-f", pcm ? muxer : "spdif", temporary]);
      format.burstBytes = await validateDirectFile(temporary, format);
      const after = await fs.promises.stat(source);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("音源已改变，请重新播放");
      await fs.promises.rename(temporary, destination);
      return { ...format, path: destination };
    } finally { await fs.promises.rm(temporary, { force: true }).catch(() => undefined); }
  }
}

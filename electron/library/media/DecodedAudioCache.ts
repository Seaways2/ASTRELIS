import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Validate generated float WAV headers without reading the audio into memory. */
export async function completeFloatWav(filePath: string) {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(filePath, "r");
    const stat = await handle.stat();
    const header = Buffer.alloc(12);
    if (stat.size < 44 || (await handle.read(header, 0, 12, 0)).bytesRead !== 12
      || header.toString("ascii", 8, 12) !== "WAVE") return false;
    const rf64 = header.toString("ascii", 0, 4) === "RF64";
    if (!rf64 && (header.toString("ascii", 0, 4) !== "RIFF" || header.readUInt32LE(4) + 8 !== stat.size)) return false;
    let offset = 12, blockAlign = 0, largeDataSize: number | undefined, largeRiffValid = false;
    for (let chunks = 0; chunks < 128 && offset + 8 <= stat.size; chunks++) {
      const chunk = Buffer.alloc(8);
      if ((await handle.read(chunk, 0, 8, offset)).bytesRead !== 8) return false;
      const type = chunk.toString("ascii", 0, 4);
      let size = chunk.readUInt32LE(4);
      if (type === "data" && rf64 && size === 0xffffffff) size = largeDataSize ?? -1;
      if (size < 0 || !Number.isSafeInteger(size) || offset + 8 + size > stat.size) return false;
      if (type === "ds64" && rf64 && size >= 28) {
        const data = Buffer.alloc(28);
        if ((await handle.read(data, 0, 28, offset + 8)).bytesRead !== 28) return false;
        largeRiffValid = data.readBigUInt64LE(0) + 8n === BigInt(stat.size);
        largeDataSize = Number(data.readBigUInt64LE(8));
      }
      if (type === "fmt " && size >= 16) {
        const format = Buffer.alloc(Math.min(size, 40));
        if ((await handle.read(format, 0, format.length, offset + 8)).bytesRead !== format.length) return false;
        const encoding = format.readUInt16LE(0);
        const float = encoding === 3 || (encoding === 0xfffe && size >= 40 && format.readUInt16LE(24) === 3);
        const channels = format.readUInt16LE(2);
        blockAlign = float && channels > 0 && format.readUInt32LE(4) > 0
          && format.readUInt16LE(14) === 32 && format.readUInt16LE(12) === channels * 4 ? channels * 4 : 0;
      }
      if (type === "data") return blockAlign > 0 && size > 0 && size % blockAlign === 0 && (!rf64 || largeRiffValid);
      offset += 8 + size + (size % 2);
    }
    return false;
  } catch { return false; }
  finally { await handle?.close(); }
}

export class DecodedAudioCache {
  private readonly pending = new Map<string, Promise<string>>();
  constructor(private readonly directory: string,
    private readonly convert: (sourcePath: string, outputPath: string) => Promise<unknown>) {}

  async cached(sourcePath: string) {
    const stat = await fs.promises.stat(sourcePath);
    const key = crypto.createHash("sha1").update(`${sourcePath}|${stat.size}|${stat.mtimeMs}`).digest("hex");
    const destination = path.join(this.directory, key + ".wav");
    return await completeFloatWav(destination) ? destination : undefined;
  }
  async prepare(sourcePath: string) {
    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile()) throw new Error("音频源文件不存在");
    const key = crypto.createHash("sha1").update(`${sourcePath}|${stat.size}|${stat.mtimeMs}`).digest("hex");
    const current = this.pending.get(key);
    if (current) return current;
    const job = (async () => {
      const destination = path.join(this.directory, `${key}.wav`);
      if (await completeFloatWav(destination)) return destination;
      await fs.promises.mkdir(this.directory, { recursive: true });
      const temporary = path.join(this.directory, `${key}.${crypto.randomUUID()}.tmp.wav`);
      try {
        await this.convert(sourcePath, temporary);
        if (!await completeFloatWav(temporary)) throw new Error("解码后的 WAV 不完整，请重试");
        const after = await fs.promises.stat(sourcePath);
        if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error("音频文件已改变，请重新播放");
        await fs.promises.rename(temporary, destination);
        return destination;
      } finally {
        await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      }
    })();
    this.pending.set(key, job);
    const clear = () => { if (this.pending.get(key) === job) this.pending.delete(key); };
    job.then(clear, clear);
    return job;
  }
}

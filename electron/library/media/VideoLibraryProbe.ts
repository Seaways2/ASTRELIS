import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export interface VideoLibraryInfo { duration?: number; coverUrl?: string; videoInfo?: string }
const isDvdSpread = (width: number, height: number) => {
  const ratio = width / Math.max(1, height);
  return ratio >= 1.35 && ratio <= 1.7;
};
/** A single bounded worker; cached results are invalidated by source size/mtime. */
export class VideoLibraryProbe {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private ffmpeg: string, private directory: string, private mediaUrl: (file: string) => string) {}
  probe(file: string, refresh = false): Promise<VideoLibraryInfo> {
    const task = this.queue.catch(() => undefined).then(() => this.read(file, refresh));
    this.queue = task; return task;
  }
  /** Read only the video's own directory. Same-name artwork always wins. */
  async localCover(file: string, sameNameOnly = false): Promise<string | undefined> {
    await fs.promises.mkdir(this.directory, { recursive: true });
    const directory = path.dirname(file), stem = path.parse(file).name.toLowerCase();
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { return undefined; }
    const names = entries.filter(e => e.isFile() && /\.(jpe?g|png|webp)$/i.test(e.name)).map(e => e.name)
      .sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase(), "en") || a.localeCompare(b, "en"));
    const named = names.filter(name => path.parse(name).name.toLowerCase() === stem);
    for (const name of named) {
      const image = await this.imageThumbnail(path.join(directory, name));
      if (image) return this.coverUrlFor(image);
    }
    if (sameNameOnly) return undefined;
    const candidates: Array<{ file: string; source: string; width: number; height: number; name: string }> = [];
    for (const name of names.filter(name => !named.includes(name))) {
      const image = await this.imageThumbnail(path.join(directory, name));
      if (image) candidates.push({ ...image, name });
    }
    const orientation = (i: { width: number; height: number }) => i.height > i.width ? 0 : i.width > i.height ? 1 : 2;
    const preferred = (name: string) => ["poster", "cover", "folder"].indexOf(path.parse(name).name.toLowerCase());
    candidates.sort((a,b) => orientation(a) - orientation(b) || (preferred(a.name) < 0 ? 3 : preferred(a.name)) - (preferred(b.name) < 0 ? 3 : preferred(b.name)) || a.name.localeCompare(b.name, "en"));
    const selected = candidates[0];
    return selected ? this.coverUrlFor(selected) : undefined;
  }
  private async coverUrlFor(image: { file: string; source: string; width: number; height: number }) {
    if (isDvdSpread(image.width, image.height)) return this.mediaUrl(image.source);
    const coverThumbnail = await this.imageThumbnail(image.source, 512);
    return this.mediaUrl(coverThumbnail?.file || image.file);
  }
  private async imageThumbnail(source: string, size: 256 | 512 = 256): Promise<{ file: string; source: string; width: number; height: number } | undefined> {
    let temporary: string | undefined;
    try {
      const stat = await fs.promises.stat(source);
      if (!stat.isFile() || !stat.size) return undefined;
      const hash = crypto.createHash("sha256").update(`${size}-v1:${source}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`).digest("hex");
      const target = path.join(this.directory, `video-cover-${hash}.png`);
      if (!fs.existsSync(target)) {
        temporary = path.join(this.directory, `cover-work-${crypto.randomUUID()}.png`);
        await run(this.ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1", "-max_alloc", "268435456", "-i", source,
          "-map", "0:v:0", "-frames:v", "1", "-vf", `scale=w='min(${size},iw)':h='min(${size},ih)':force_original_aspect_ratio=decrease`, "-filter_threads", "1", "-threads", "1", temporary],
          { windowsHide: true, timeout: 12000, maxBuffer: 256 * 1024 });
        await fs.promises.rename(temporary, target); temporary = undefined;
      }
      const image = await fs.promises.readFile(target);
      if (image.length < 24 || !image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return undefined;
      const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
      return width > 0 && height > 0 && Math.max(width,height) <= size ? { file: target, source, width, height } : undefined;
    } catch { return undefined; }
    finally { if (temporary) await fs.promises.rm(temporary, { force: true }).catch(() => undefined); }
  }
  private async read(file: string, refresh: boolean): Promise<VideoLibraryInfo> {
    const stat = await fs.promises.stat(file);
    const id = crypto.createHash("sha256").update(file + stat.size + ":" + stat.mtimeMs).digest("hex");
    await fs.promises.mkdir(this.directory, { recursive: true });
    const cache = path.join(this.directory, `video-${id}.json`);
    const frame = path.join(this.directory, `video-${id}-frame-512${refresh ? "-" + crypto.randomUUID() : ""}.jpg`);
    let info: VideoLibraryInfo;
    try { info = JSON.parse(await fs.promises.readFile(cache, "utf8")); }
    catch {
      let log = "";
      try { const result = await run(this.ffmpeg, ["-hide_banner", "-nostdin", "-i", file], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 }); log = result.stderr; }
      catch (error) { log = String((error as { stderr?: string }).stderr || ""); }
      const video = /Video:\s*([^\r\n]+)/.exec(log)?.[1];
      if (!video) throw new Error("VIDEO_METADATA_UNAVAILABLE");
      const time = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
      info = { duration: time ? +time[1] * 3600 + +time[2] * 60 + +time[3] : undefined, videoInfo: video.slice(0, 300) };
      await fs.promises.writeFile(cache, JSON.stringify(info));
    }
    const localCover = refresh ? undefined : await this.localCover(file);
    if (localCover) return { ...info, coverUrl: localCover };
    if (!fs.existsSync(frame)) {
      for (const fraction of refresh ? [0.1 + Math.random() * .7, .4, .65] : [0.15, 0.4, 0.65]) {
        try {
          await run(this.ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1", "-ss", String((info.duration || 0) * fraction), "-t", "3", "-i", file,
            "-map", "0:v:0", "-an", "-sn", "-vf", "blackframe=amount=0:threshold=32,metadata=select:key=lavfi.blackframe.pblack:value=90:function=less,thumbnail=12,scale=w='min(512,iw)':h='min(512,ih)':force_original_aspect_ratio=decrease", "-filter_threads", "1", "-frames:v", "1", "-threads", "1", frame],
            { windowsHide: true, timeout: 12000, maxBuffer: 512 * 1024 });
          if (fs.existsSync(frame) && (await fs.promises.stat(frame)).size > 0) break;
        } catch { await fs.promises.rm(frame, { force: true }).catch(() => undefined); }
      }
    }
    return { ...info, coverUrl: fs.existsSync(frame) ? this.mediaUrl(frame) : undefined };
  }
}


import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface ArtworkFileSystem {
  mkdir(directory: string): Promise<unknown>;
  writeFile(filePath: string, data: Uint8Array): Promise<unknown>;
  existsSync(filePath: string): boolean;
}

const pendingWrites = new Map<string, Promise<void>>();
const pendingThumbnailWrites = new Map<string, Promise<void>>();

/** Keep the original for playback; library cards use this persistent small image. */
export function cacheArtworkThumbnail(source: string, data?: Uint8Array): Promise<void> {
  const destination = `${source}.thumb-256.png`;
  const existing = pendingThumbnailWrites.get(destination);
  if (existing) return existing;
  const task = (async () => {
    if (fs.existsSync(destination)) return;
    const { nativeImage } = await import("electron");
    // Plain Node test runners do not expose Electron's native image API.
    if (!nativeImage) return;
    const image = nativeImage.createFromBuffer(Buffer.from(data ?? await fs.promises.readFile(source)));
    if (image.isEmpty()) return;
    const size = image.getSize();
    const scale = Math.min(1, 256 / Math.max(size.width, size.height));
    const small = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: "good" });
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporary, small.toPNG(), { flag: "wx" });
      await fs.promises.rename(temporary, destination);
    } finally { await fs.promises.rm(temporary, { force: true }); }
  })();
  pendingThumbnailWrites.set(destination, task);
  const clear = () => { if (pendingThumbnailWrites.get(destination) === task) pendingThumbnailWrites.delete(destination); };
  task.then(clear, clear);
  return task;
}

/** Remove only generated thumbnail sidecars for artwork owned by the application cache. */
export async function removeArtworkThumbnailFiles(sourceUrl: string, artworkDirectory: string) {
  let parsed: URL;
  try { parsed = new URL(sourceUrl); }
  catch { return; }
  if (parsed.protocol !== "auralis-media:" || parsed.hostname !== "local" || parsed.search || parsed.hash) return;
  const source = path.resolve(decodeURIComponent(parsed.pathname.slice(1)));
  const root = path.resolve(artworkDirectory);
  const relative = path.relative(root, source);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
  await Promise.all([256, 512, 1024].map(size => fs.promises.rm(`${source}.thumb-${size}.png`, { force: true })));
}

/** Content identities refresh changed covers and share identical album artwork. */
export async function cacheArtwork(
  picture: { format: string; data: Uint8Array }, directory: string,
  mediaUrl: (filePath: string) => string, fileSystem?: ArtworkFileSystem
) {
  if (!picture.data.length || picture.data.length >= 8 * 1024 * 1024) return undefined;
  const extension = picture.format.includes("png") ? ".png" : picture.format.includes("webp") ? ".webp" : ".jpg";
  const identity = crypto.createHash("sha256").update(picture.data).digest("hex");
  const destination = path.join(directory, `content-${identity}${extension}`);
  let pending = pendingWrites.get(destination);
  if (!pending) {
    pending = (async () => {
      if (fileSystem) {
        if (fileSystem.existsSync(destination)) return;
        await fileSystem.mkdir(directory);
        await fileSystem.writeFile(destination, picture.data);
        return;
      }
      if (fs.existsSync(destination)) return;
      await fs.promises.mkdir(directory, { recursive: true });
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.promises.writeFile(temporary, picture.data, { flag: "wx" });
        await fs.promises.rename(temporary, destination);
      } finally {
        await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      }
    })();
    pendingWrites.set(destination, pending);
    const clear = () => { if (pendingWrites.get(destination) === pending) pendingWrites.delete(destination); };
    pending.then(clear, clear);
  }
  await pending;
  if (!fileSystem) {
    try { await cacheArtworkThumbnail(destination, picture.data); }
    catch (error) { console.warn("Artwork thumbnail generation failed", error); }
  }
  return mediaUrl(destination);
}

/** Read old path-addressed artwork without changing a user's existing library. */
export function legacyArtworkUrl(sourcePath: string, directory: string, mediaUrl: (filePath: string) => string,
  exists: (filePath: string) => boolean = fs.existsSync) {
  const identity = crypto.createHash("sha1").update(sourcePath.toLowerCase()).digest("hex");
  for (const extension of [".jpg", ".png", ".webp"]) {
    const candidate = path.join(directory, identity + extension);
    if (exists(candidate)) return mediaUrl(candidate);
  }
  return undefined;
}

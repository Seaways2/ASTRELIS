import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pathIsContained } from "../../security/ElectronSecurity";
import type { LibraryService } from "../LibraryService";
import type { LibraryScanner } from "../scanner/LibraryScanner";

/** One-time recovery of records from the retired feature. No playback/scanning gate remains. */
export async function restoreVisibleLibrary(directory: string, decode: (data: Buffer) => string,
  service: LibraryService, scanner: Pick<LibraryScanner, "scanRoots">) {
  const legacy = path.join(directory, "private-library.bin");
  if (!fs.existsSync(legacy)) return 0;
  const data = JSON.parse(decode(await fs.promises.readFile(legacy)));
  if (!Array.isArray(data.roots) || data.roots.some((p: unknown) => typeof p !== "string" || !path.isAbsolute(p))
    || (data.items !== undefined && (!Array.isArray(data.items) || data.items.some((item: Record<string, unknown>) => !item || typeof item.sourcePath !== "string" || !path.isAbsolute(item.sourcePath)))))
    throw new Error("旧媒体记录格式无效，原始备份已保留");
  const current = await service.getSnapshot();
  if (current.status === "error") throw new Error("普通媒体库暂时无法读取，尚未恢复旧媒体记录");
  const scanned = data.roots.length ? (await scanner.scanRoots(data.roots)).tracks : [];
  const key = (item: unknown) => String((item as {sourcePath?: string})?.sourcePath || "").replace(/\\/g, "/").toLowerCase();
  // Prefer current metadata, then saved matched records, then fresh scanner metadata.
  const merged = new Map<string, unknown>([...scanned, ...(data.items || []), ...(current.snapshot?.tracks || [])].map(item => [key(item), item]));
  const folders: string[] = [...(current.snapshot?.folders || [])];
  for (const folder of [...data.roots, ...(data.items || []).map((item: {sourcePath: string}) => path.dirname(item.sourcePath))]) {
    if (!folders.some(root => pathIsContained(folder, root))) folders.push(folder);
  }
  const tracks = await Promise.all([...merged.values()].map(async raw => {
    const item = { ...(raw as Record<string, unknown>) };
    delete item.privateMedia;
    if (typeof item.coverUrl === "string") {
      const prefix = "auralis-media://local/";
      const cover = item.coverUrl.startsWith(prefix) ? decodeURIComponent(item.coverUrl.slice(prefix.length))
        : item.coverUrl.startsWith("file:") ? fileURLToPath(item.coverUrl) : undefined;
      if (cover && pathIsContained(cover, path.join(directory, "private-artwork")) && fs.existsSync(cover)) {
        const target = path.join(directory, "artwork-cache", "restored-" + crypto.createHash("sha256").update(cover).digest("hex") + path.extname(cover));
        await fs.promises.mkdir(path.dirname(target), {recursive:true});
        await fs.promises.copyFile(cover, target);
        item.coverUrl = prefix + encodeURIComponent(target);
      }
    }
    return item;
  }));
  const result = await service.commitLegacySnapshot({tracks, folders}, {
    requestId: "restore-visible-library-" + crypto.createHash("sha256").update(await fs.promises.readFile(legacy)).digest("hex"),
    expectedRevision: current.snapshot?.revision
  });
  if (result.status !== "committed" && result.status !== "noop") throw new Error("恢复记录未保存，原始备份已保留");
  await fs.promises.rename(legacy, legacy + ".retired-" + Date.now());
  return tracks.length;
}

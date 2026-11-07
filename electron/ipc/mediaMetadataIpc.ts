import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { app, ipcMain, nativeImage, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { MusicBrainzClient } from "../library/media/MusicBrainzClient";
import { TmdbClient } from "../library/media/TmdbClient";
import type { LibraryService } from "../library/LibraryService";
import type { VideoLibraryProbe } from "../library/media/VideoLibraryProbe";
import type { LocalMediaAccessPolicy } from "../security/ElectronSecurity";
import { videoExtensions } from "../videoPlayer";

export interface MediaMetadataIpcDeps {
  libraryService: LibraryService;
  videoLibraryProbe: VideoLibraryProbe;
  trustedCacheRequest(event: IpcMainInvokeEvent): boolean;
  getLocalMediaAccess(): LocalMediaAccessPolicy | undefined;
  mediaUrl(filePath: string): string;
  writeLog(level: string, message: string): void;
}

/** MusicBrainz cover lookup and TMDB film/TV matching for the media library. */
export function registerMediaMetadataIpc({
  libraryService, videoLibraryProbe, trustedCacheRequest, getLocalMediaAccess, mediaUrl, writeLog
}: MediaMetadataIpcDeps) {
  const musicBrainz = new MusicBrainzClient(app.getVersion());
  ipcMain.handle("library:musicbrainz", async (event, request: unknown) => {
    if (!trustedCacheRequest(event) || !request || typeof request !== "object") return {ok:false,error:"music.invalidRequest"};
    const r = request as Record<string, unknown>;
    try {
      if (r.action === "search") return {ok:true, results:await musicBrainz.search(String(r.album || ""),String(r.artist || ""),String(r.title || ""))};
      if (r.action !== "apply" || !Array.isArray(r.trackIds) || !r.trackIds.length || r.trackIds.length>1000 || r.trackIds.some(id=>typeof id!=="string")) throw Error("music.invalidRequest");
      const ids = new Set(r.trackIds);
      const snapshot = async () => {
        const current = await libraryService.getSnapshot();
        if (!current.snapshot) throw Error("music.libraryUnavailable");
        const tracks = current.snapshot.tracks as Array<Record<string,unknown>>;
        const targets = tracks.filter(item=>ids.has(item.id));
        if (targets.length !== ids.size || targets.some(item=>!getLocalMediaAccess()?.isAllowed(String(item.sourcePath || "")) || videoExtensions.includes(path.extname(String(item.sourcePath || "")).slice(1).toLowerCase()))) throw Error("music.accessDenied");
        return {current:current.snapshot, tracks, targets};
      };
      let state = await snapshot();
      if (state.targets.every(item=>item.coverLocked || item.coverUrl)) return {ok:true,skipped:true};
      const image = nativeImage.createFromBuffer(await musicBrainz.cover(r.kind as "release"|"release-group",String(r.id || "")));
      if (image.isEmpty()) throw Error("music.invalidImage");
      const size=image.getSize();
      const thumb = Math.max(size.width,size.height)>256 ? image.resize(size.width>=size.height?{width:256}:{height:256}) : image;
      const png=thumb.toPNG(),directory=path.join(app.getPath("userData"),"artwork-cache");
      const target=path.join(directory,`musicbrainz-${crypto.createHash("sha256").update(png).digest("hex")}.png`);
      // Recheck privacy and cover locks after network I/O, before committing current state.
      state = await snapshot();
      await fs.promises.mkdir(directory,{recursive:true}); await fs.promises.writeFile(target,png);
      const result=await libraryService.commitLegacySnapshot({tracks:state.tracks.map(item=>ids.has(item.id) && !item.coverLocked && !item.coverUrl ? {...item,coverUrl:mediaUrl(target),coverLocked:true} : item),folders:state.current.folders},{requestId:crypto.randomUUID(),expectedRevision:state.current.revision});
      if(result.status!=="committed" && result.status!=="noop")throw Error("music.conflict");
      return {ok:true};
    } catch(error) { return {ok:false,error:error instanceof Error?error.message:"music.requestFailed"}; }
  });
  const credentialPath = path.join(app.getPath("userData"), "tmdb-credential.bin");
  const readTmdbToken = () => { try { return safeStorage.decryptString(fs.readFileSync(credentialPath)); } catch { return ""; } };
  const tmdb = new TmdbClient(readTmdbToken);
  ipcMain.handle("library:tmdb", async (event, request: unknown) => {
    if (!trustedCacheRequest(event) || !request || typeof request !== "object") return { ok: false, error: "无效请求" };
    const r = request as Record<string, unknown>;
    const matchStarted = performance.now();
    try {
      if (r.action === "status") return { ok: true, configured: !!readTmdbToken() };
      if (r.action === "credentials") {
        if (typeof r.token !== "string" || r.token.length > 4096) throw new Error("无效凭据");
        const token = r.token.trim();
        if (!token) { await fs.promises.rm(credentialPath, { force: true }); return { ok: true, configured: false }; }
        if (!/^[a-zA-Z0-9._-]+$/.test(token)) throw new Error("请填写 API Key 或 API Read Access Token");
        if (!safeStorage.isEncryptionAvailable()) throw new Error("本机安全存储暂不可用");
        await fs.promises.writeFile(credentialPath + ".tmp", safeStorage.encryptString(token));
        await fs.promises.rename(credentialPath + ".tmp", credentialPath);
        return { ok: true, configured: true };
      }
      if (r.action === "account") { await shell.openExternal("https://www.themoviedb.org/settings/api"); return { ok: true }; }
      if (r.action === "search") return { ok: true, results: await tmdb.search(String(r.query || ""), r.type as "movie" | "tv", String(r.year || "")) };
      if (r.action === "details") {
        const metadata = await tmdb.details(r.type as "movie" | "tv", Number(r.id));
        let posterPreview: string | undefined;
        if (metadata.posterPath) { try { const image = nativeImage.createFromBuffer(await tmdb.poster(metadata.posterPath)); if (!image.isEmpty()) posterPreview = image.resize({ height: 240 }).toDataURL(); } catch { /* Text remains available when image CDN is unreachable. */ } }
        return { ok: true, metadata, posterPreview };
      }
      if (r.action !== "apply" && r.action !== "batchApply") throw new Error("无效操作");
      const current = await libraryService.getSnapshot();
      if (!current.snapshot) throw new Error("媒体库不可用");
      const tracks = current.snapshot.tracks as Array<Record<string, unknown>>;
      const batch = r.action === "batchApply";
      const ids = batch ? r.trackIds : [r.trackId];
      if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== "string")) throw new Error("无效的批量范围");
      const targets = tracks.filter(item => ids.includes(item.id));
      if (targets.length !== new Set(ids).size || targets.some(item => !videoExtensions.includes(path.extname(String(item.sourcePath || "")).slice(1).toLowerCase()))) throw new Error("部分视频已移出媒体库，请刷新后重试");
      if (targets.some(item=>!getLocalMediaAccess()?.isAllowed(String(item.sourcePath || "")))) throw Error("music.accessDenied");
      const eligible = targets.filter(item => !batch || !item.onlineMetadata);
      if (!eligible.length) return { ok: true };
      const track = eligible[0];
      const localCovers = new Map<unknown, string>();
      if (batch && r.replaceCover === true) {
        for (const item of eligible) {
          if (item.coverLocked) continue;
          const cover = await videoLibraryProbe.localCover(String(item.sourcePath));
          if (cover) localCovers.set(item.id, cover);
        }
      }
      const metadata = await tmdb.details(r.type as "movie" | "tv", Number(r.id));
      let coverUrl = track.coverUrl, coverLocked = track.coverLocked;
      if (r.replaceCover === true && metadata.posterPath && (!batch || eligible.some(item => !item.coverLocked && !localCovers.has(item.id)))) {
        const bytes = await tmdb.poster(metadata.posterPath);
        const image = nativeImage.createFromBuffer(bytes);
        if (image.isEmpty()) throw new Error("海报无法读取，未更改媒体资料");
        const png = image.toPNG(), directory = path.join(app.getPath("userData"), "artwork-cache");
        await fs.promises.mkdir(directory, { recursive: true });
        const target = path.join(directory, `tmdb-${crypto.createHash("sha256").update(png).digest("hex")}.png`);
        await fs.promises.writeFile(target, png); coverUrl = mediaUrl(target); coverLocked = true;
      }
      if (targets.some(item=>!getLocalMediaAccess()?.isAllowed(String(item.sourcePath || "")))) throw Error("music.accessDenied");
      const changes = new Map(eligible.map(item => {
        const replace = r.replaceCover === true && metadata.posterPath && (!batch || !item.coverLocked);
        return [item.id, { ...item, name: batch && metadata.mediaType === "tv" ? item.name : metadata.title, year: metadata.year, genre: metadata.genres.join(" / "), onlineMetadata: metadata, coverUrl: localCovers.get(item.id) || (replace ? coverUrl : item.coverUrl), coverLocked: localCovers.has(item.id) ? false : replace ? coverLocked : item.coverLocked }];
      }));
      const result = await libraryService.commitLegacySnapshot({ tracks: tracks.map(item => changes.get(item.id) || item), folders: current.snapshot.folders }, { requestId: crypto.randomUUID(), expectedRevision: current.snapshot.revision });
      if (result.status !== "committed" && result.status !== "noop") throw new Error("媒体库在操作期间发生变化，请重试");
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "影视匹配失败" }; }
    finally { writeLog("MATCH", JSON.stringify({ action: String(r.action), durationMs: Math.round(performance.now() - matchStarted), packaged: app.isPackaged })); }
  });
}

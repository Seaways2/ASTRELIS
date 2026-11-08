import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { app, dialog, ipcMain, nativeImage, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { videoExtensions } from "../videoPlayer";
import type { LibraryCommandMeta } from "../library/types";
import { cacheArtwork, removeArtworkThumbnailFiles } from "../library/media/ArtworkCache";
import { sanitizeLibraryRoots } from "../library/reconcile/LibraryReconciler";
import { parseAbsolutePath, parseCommandMeta, parseLegacyMutation, parsePathList, parseRescanRequest } from "../library/validation/LibraryIpcValidator";
import { sameCanonicalPath, type LocalMediaAccessPolicy } from "../security/ElectronSecurity";
import { AUDIO_EXTENSIONS, externalAudioPaths } from "../externalOpenPaths";
import { cachedArtworkUrl, hydrateLibraryTracks, mediaUrl } from "../mediaUrls";
import type { FolderVisibility } from "../FolderVisibility";
import type { LibraryDerivedIndexCache } from "../library/derived/LibraryDerivedIndexCache";
import type { LibraryService } from "../library/LibraryService";
import type { VideoLibraryProbe } from "../library/media/VideoLibraryProbe";
import type { LibraryScanner } from "../library/scanner/LibraryScanner";
import type { AudioCacheMaintenance } from "../audioCacheMaintenance";

export interface LibraryIpcDeps {
  getMainWindow(): BrowserWindow | null;
  localMediaAccess: LocalMediaAccessPolicy;
  folderVisibility: FolderVisibility;
  libraryService: LibraryService;
  libraryScanner: LibraryScanner;
  libraryDerivedIndexCache: LibraryDerivedIndexCache;
  videoLibraryProbe: VideoLibraryProbe;
  audioCache: AudioCacheMaintenance;
  importMusicMetadata(): Promise<typeof import("music-metadata")>;
  trustedCacheRequest(event: IpcMainInvokeEvent): boolean;
  authorisedAudio(input: unknown): string;
  prepareLocalSource(source: string): Promise<string>;
  writeLog(level: string, message: string): void;
  /** Settles once the persisted library folders are registered as roots. */
  libraryRootsReady: Promise<void>;
}

/** Media library scanning, persistence, file actions and artwork. */
export function registerLibraryIpc({
  getMainWindow, localMediaAccess, folderVisibility, libraryService, libraryScanner, libraryDerivedIndexCache,
  videoLibraryProbe, audioCache, importMusicMetadata, trustedCacheRequest, authorisedAudio, prepareLocalSource, writeLog, libraryRootsReady
}: LibraryIpcDeps) {
  ipcMain.on("library:authorize-dropped-file", (event, input: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) return;
    try {
      const filePath = parseAbsolutePath(input, "dropped audio file");
      if ((AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || videoExtensions.includes(path.extname(filePath).slice(1).toLowerCase())) && fs.statSync(filePath).isFile())
        localMediaAccess?.authorizeFile(filePath);
    } catch { /* Ignore forged or stale drag payloads. */ }
  });
  const scanCompatibilityResult = async (event: Electron.IpcMainInvokeEvent, roots: string[]) => {
    roots.forEach(root => localMediaAccess?.registerRoot(root));
    const scan = await libraryScanner.scanRoots(roots, progress => event.sender.send("library:scan-progress", progress));
    const root = scan.roots[0];
    return {
      ...scan,
      folder: root?.path || roots[0] || "",
      skipped: root?.skippedFiles || 0,
      errors: scan.failures.slice(0, 50).map(item => `${path.basename(item.path)}: ${item.message}`),
      metadataFailures: scan.failures.filter(item => item.stage === "metadata").length
    };
  };
  const activeLibraryScans = new Map<string, { senderId: number; controller: AbortController }>();
  const scanAndCommit = async (
    event: Electron.IpcMainInvokeEvent,
    scannedRoots: string[],
    requestedRoots: string[],
    meta: LibraryCommandMeta,
    signal?: AbortSignal
  ) => {
    requestedRoots.forEach(root => localMediaAccess?.registerRoot(root));
    const scan = await libraryScanner.scanRoots(scannedRoots, progress => { if (!event.sender.isDestroyed()) event.sender.send("library:scan-progress", progress); }, signal);
    if (signal?.aborted) return null;
    activeLibraryScans.delete(meta.requestId);
    writeLog("LIBRARY", JSON.stringify({
      action: "library.scan.complete",
      scanId: scan.scanId,
      roots: scan.roots.map(root => ({ rootId: root.rootId, status: root.status, scannedFiles: root.scannedFiles })),
      failures: scan.failures.length
    }));
    const applied = await libraryService.applyScan(scan, requestedRoots, meta);
    const authoritative = await libraryService.getSnapshot();
    if (authoritative.status === "error")
      throw new Error(`${authoritative.error?.code || "LIBRARY_UNKNOWN_ERROR"}: ${authoritative.error?.message || "音乐库加载失败"}`);
    return {
      mutation: applied.mutation,
      reconcile: applied.reconcile,
      scan,
      status: authoritative.status,
      revision: authoritative.snapshot?.revision || 0,
      tracks: hydrateLibraryTracks(authoritative.snapshot?.tracks || []),
      folders: authoritative.snapshot?.folders || []
    };
  };
  ipcMain.handle("library:choose-folder", async (event, meta: unknown) => {
    const safeMeta = parseCommandMeta(meta);
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: "选择音乐库目录",
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const current = await libraryService.getSnapshot();
    if (current.status === "error")
      throw new Error(`${current.error?.code || "LIBRARY_UNKNOWN_ERROR"}: ${current.error?.message || "音乐库加载失败"}`);
    const selectedRoot = result.filePaths[0];
    const requestedRoots = sanitizeLibraryRoots([...(current.snapshot?.folders || []), selectedRoot]);
    return scanAndCommit(event, [selectedRoot], requestedRoots, safeMeta);
  });
  ipcMain.handle("library:scan", async (event, folder: unknown) =>
    scanCompatibilityResult(event, [parseAbsolutePath(folder, "scan folder")])
  );
  ipcMain.handle("library:remove-folder", async (_, folder: unknown, meta: unknown) => {
    const root = parseAbsolutePath(folder, "library folder");
    const command = parseCommandMeta(meta);
    const current = await libraryService.getSnapshot();
    if (current.status === "error" || !current.snapshot) throw new Error("Library snapshot unavailable");
    const { removeLibraryFolder } = await import("../library/removeLibraryFolder");
    const updated = removeLibraryFolder(current.snapshot, root);
    const trackCoverUrl = (track: unknown) => {
      if (!track || typeof track !== "object" || Array.isArray(track)) return undefined;
      const coverUrl = (track as { coverUrl?: unknown }).coverUrl;
      return typeof coverUrl === "string" ? coverUrl : undefined;
    };
    const retainedCovers = new Set(updated.tracks.map(trackCoverUrl).filter((url): url is string => typeof url === "string"));
    const removedCovers = [...new Set(current.snapshot.tracks.map(trackCoverUrl)
      .filter((url): url is string => typeof url === "string" && !retainedCovers.has(url)))];
    const result = await libraryService.commitLegacySnapshot(updated, {
      ...command, expectedRevision: command.expectedRevision ?? current.snapshot.revision
    });
    if (result.status === "committed") {
      const artworkDirectory = path.join(app.getPath("userData"), "artwork-cache");
      await Promise.all(removedCovers.map(async coverUrl => {
        try { await removeArtworkThumbnailFiles(coverUrl, artworkDirectory); }
        catch (error) { writeLog("LIBRARY", `Thumbnail cleanup failed: ${String(error)}`); }
      }));
    }
    return result;
  });
  ipcMain.handle("library:rescan", async (event, payload: unknown) => {
    if (!trustedCacheRequest(event)) throw new Error("UNTRUSTED_SENDER");
    const request = parseRescanRequest(payload);
    if (activeLibraryScans.size) throw new Error("LIBRARY_SCAN_BUSY");
    const controller = new AbortController();
    const stopOnClose = () => controller.abort();
    event.sender.once("destroyed", stopOnClose);
    activeLibraryScans.set(request.meta.requestId, { senderId: event.sender.id, controller });
    try {
    if (request.folders.length === 0)
      throw new Error("LIBRARY_INVALID_SCHEMA: 音乐库扫描目录无效");
    const roots = sanitizeLibraryRoots(request.folders);
    const current = await libraryService.getSnapshot();
    if (current.status === "error")
      throw new Error(`${current.error?.code || "LIBRARY_UNKNOWN_ERROR"}: ${current.error?.message || "音乐库加载失败"}`);
    const authoritativeRoots = sanitizeLibraryRoots(current.snapshot?.folders || []);
    authoritativeRoots.forEach(root => localMediaAccess?.registerRoot(root));
    if (roots.length !== authoritativeRoots.length
      || roots.some(root => !authoritativeRoots.some(authoritative => sameCanonicalPath(root, authoritative))))
      throw new Error("LIBRARY_INVALID_SCHEMA: 只能重新扫描已登记的音乐库目录");
    return await scanAndCommit(event, roots, roots, request.meta, controller.signal);
    } finally { activeLibraryScans.delete(request.meta.requestId); event.sender.removeListener("destroyed", stopOnClose); }
  });
  ipcMain.handle("library:cancel-scan", (event, requestId: unknown) => {
    if (!trustedCacheRequest(event) || typeof requestId !== "string") return { ok: false };
    const active = activeLibraryScans.get(requestId);
    if (!active || active.senderId !== event.sender.id) return { ok: false };
    active.controller.abort();
    return { ok: true };
  });
  ipcMain.handle("library:open-files", async (_, input: unknown) => {
    const visiblePaths = parsePathList(input, "audio paths").filter(file => !folderVisibility.blocked(file));
    // Paths without a grant (e.g. queue entries saved before grants were
    // persisted) are skipped and reported, so one stale entry no longer
    // fails the whole batch. Nothing about them is read or returned.
    // Queue restore can arrive before startup finished registering the
    // library folders (slow disk); wait for that instead of rejecting them.
    await libraryRootsReady;
    const unauthorized = visiblePaths.filter(sourcePath => !localMediaAccess?.isAllowed(sourcePath));
    const rejected = new Set(unauthorized);
    const requestedPaths = visiblePaths.filter(sourcePath => !rejected.has(sourcePath));
    if (unauthorized.length) writeLog("LIBRARY", `open-files skipped ${unauthorized.length} path(s) without an access grant`);
    const sourcePaths = externalAudioPaths(requestedPaths);
    const metadataModule = await importMusicMetadata();
    const errors: string[] = [];
    const tracks = await Promise.all(sourcePaths.map(async sourcePath => {
      const stat = await fs.promises.stat(sourcePath);
      if (videoExtensions.includes(path.extname(sourcePath).slice(1).toLowerCase())) return {
        id: crypto.createHash("sha1").update(sourcePath.toLowerCase()).digest("hex"),
        mediaKind: "video", name: path.basename(sourcePath), artist: "本地视频", album: "", format: path.extname(sourcePath).slice(1).toUpperCase(),
        size: stat.size, sourcePath, url: mediaUrl(sourcePath)
      };
      let name = path.basename(sourcePath, path.extname(sourcePath));
      let artist = "未知艺术家", album = "未分类专辑", genre = "未分类";
      let duration: number | undefined, year: number | undefined, coverUrl: string | undefined = cachedArtworkUrl(sourcePath);
      try {
        const metadata = await metadataModule.parseFile(sourcePath, { duration: true });
        name = metadata.common.title || name;
        artist = metadata.common.artist || artist;
        album = metadata.common.album || album;
        genre = metadata.common.genre?.[0] || genre;
        year = metadata.common.year;
        duration = metadata.format.duration;
        const picture = metadata.common.picture?.[0];
        if (picture && picture.data.length < 8 * 1024 * 1024) {
          const artworkDirectory = path.join(app.getPath("userData"), "artwork-cache");
          coverUrl = await cacheArtwork(picture, artworkDirectory, mediaUrl) || coverUrl;
        }
      } catch (error) {
        errors.push(`${path.basename(sourcePath)}: ${error instanceof Error ? error.message : "标签读取失败"}`);
      }
      return {
        id: crypto.createHash("sha1").update(sourcePath.toLowerCase()).digest("hex"),
        name, artist, album, genre, year, duration, coverUrl,
        format: path.extname(sourcePath).slice(1).toUpperCase(), size: stat.size,
        sourcePath, nativePath: /\.(ape|dsf|wma)$/i.test(sourcePath) ? undefined : sourcePath,
        url: mediaUrl(sourcePath), folder: path.dirname(sourcePath)
      };
    }));
    return { tracks, errors: errors.slice(0, 20), unauthorized };
  });
  ipcMain.handle("library:file-action", async (event, id: unknown, action: unknown) => {
    if (!trustedCacheRequest(event) || typeof id !== "string" || !["remove", "reveal"].includes(String(action))) return {ok:false,error:"INVALID_FILE_ACTION"};
    try {
      const current = await libraryService.getSnapshot();
      const track = (current.snapshot?.tracks as Array<Record<string, unknown>> | undefined)?.find(item => item.id === id);
      const file = track && typeof track.sourcePath === "string" ? track.sourcePath : "";
      if (!current.snapshot || !file || !localMediaAccess?.isAllowed(file)) throw Error("文件不存在于可访问的媒体库");
      if (action === "reveal") { shell.showItemInFolder(file); return {ok:true}; }
      const result = await libraryService.commitLegacySnapshot({tracks:current.snapshot.tracks.filter(item => (item as Record<string, unknown>).id !== id),folders:current.snapshot.folders},
        {requestId:crypto.randomUUID(),expectedRevision:current.snapshot.revision});
      if (result.status !== "committed" && result.status !== "noop") throw Error("媒体库已变化，请重试");
      return {ok:true};
    } catch (error) { return {ok:false,error:error instanceof Error ? error.message : String(error)}; }
  });
  ipcMain.handle("library:artwork", async (event, id: unknown, action: unknown) => {
    if (!trustedCacheRequest(event) || typeof id !== "string" || !["choose", "frame", "lock", "unlock"].includes(String(action))) return { ok: false, error: "INVALID_ARTWORK_REQUEST" };
    try {
      const current = await libraryService.getSnapshot();
      if (!current.snapshot) throw new Error("媒体库不可用");
      const tracks = current.snapshot.tracks as Array<Record<string, unknown>>;
      const track = tracks.find(item => item.id === id);
      if (!track) throw new Error("媒体已不在库中，请刷新后重试");
      let coverUrl = track.coverUrl;
      if (action === "choose") {
        const picked = await dialog.showOpenDialog(getMainWindow()!, { title: "选择媒体封面", properties: ["openFile"], filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp"] }] });
        if (picked.canceled || !picked.filePaths[0]) return { ok: true, canceled: true };
        const file = picked.filePaths[0];
        if ((await fs.promises.stat(file)).size > 8 * 1024 * 1024) throw new Error("请选择小于 8 MB 的图片");
        const source = nativeImage.createFromPath(file);
        if (source.isEmpty()) throw new Error("无法读取这张图片");
        const size = source.getSize();
        const image = source.resize({ width: Math.min(1200, size.width), quality: "best" }).toPNG();
        const directory = path.join(app.getPath("userData"), "artwork-cache");
        await fs.promises.mkdir(directory, { recursive: true });
        const target = path.join(directory, `manual-${crypto.createHash("sha256").update(image).digest("hex")}.png`);
        await fs.promises.writeFile(target, image); coverUrl = mediaUrl(target);
      } else if (action === "frame") {
        const file = String((track as { sourcePath?: string })?.sourcePath || "");
        if (!videoExtensions.includes(path.extname(file).slice(1).toLowerCase()) || !localMediaAccess?.isAllowed(file)) throw new Error("无法为该文件截取视频封面");
        coverUrl = (await videoLibraryProbe.probe(file, true)).coverUrl;
        if (!coverUrl) throw new Error("未能生成封面，请重试或选择本地图片");
      }
      if (action === "lock" && !coverUrl) throw new Error("请先设置封面");
      const updated = { ...track, coverUrl, coverLocked: action !== "unlock" };
      const result = await libraryService.commitLegacySnapshot({ tracks: tracks.map(item => item.id === id ? updated : item), folders: current.snapshot.folders }, { requestId: crypto.randomUUID(), expectedRevision: current.snapshot.revision });
      if (result.status !== "committed" && result.status !== "noop") throw new Error("媒体库在操作期间发生变化，请重试");
      return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle("library:load", async () => {
    const result = await libraryService.getSnapshot();
    (result.snapshot?.folders || []).forEach(folder => localMediaAccess?.registerRoot(folder));
    const tracks = hydrateLibraryTracks(result.snapshot?.tracks || []);
    return {
      status: result.status,
      schemaVersion: result.snapshot?.schemaVersion || 2,
      revision: result.snapshot?.revision || 0,
      recoveredFromRevision: result.recoveredFromRevision,
      error: result.error,
      tracks,
      folders: result.snapshot?.folders || []
    };
  });
  ipcMain.handle("library:derived-index-load", async (_, revision: unknown) => {
    if (!Number.isSafeInteger(revision) || Number(revision) < 0) return null;
    return libraryDerivedIndexCache.load(Number(revision));
  });
  ipcMain.handle("library:derived-index-save", async (_, revision: unknown, snapshot: unknown) => {
    if (!Number.isSafeInteger(revision) || Number(revision) < 0) return { ok: false };
    return libraryDerivedIndexCache.save(Number(revision), snapshot);
  });
  ipcMain.handle("library:save", async (_, payload: unknown) => {
    const value = parseLegacyMutation(payload);
    return libraryService.commitLegacySnapshot(
      { tracks: value.tracks, folders: value.folders },
      value.meta
    );
  });
  ipcMain.handle("library:import-legacy-state", async (_, payload: unknown) => {
    const value = parseLegacyMutation(payload);
    return libraryService.importLegacyState(
      { tracks: value.tracks, folders: value.folders },
      value.meta
    );
  });
  ipcMain.handle("library:prepare", async (_, input: unknown) => {
    try {
      return await audioCache.use(async () => {
        const outputPath = await prepareLocalSource(authorisedAudio(input));
        audioCache.protect("prepared", [outputPath]);
        return { ok: true, path: outputPath, url: mediaUrl(outputPath) };
      });
    } catch (error) { return { ok: false, error: String(error) }; }
  });
}

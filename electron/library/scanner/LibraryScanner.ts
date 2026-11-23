import { videoDisplayName } from "../media/videoDisplayName";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { disambiguateMediaIds, toTrackRecord } from "../domain/LibraryDomain";
import { cacheArtwork, legacyArtworkUrl } from "../media/ArtworkCache";
import { libraryPathKey, libraryPathWithin } from "../libraryPaths";
import { needsDecodedAudio } from "../media/audioFormats";
import type {
  LibraryScanResult,
  RootScanResult,
  RootScanStatus,
  ScanFailure,
  ScannedTrack,
  TrackRecord
} from "../types";

export interface LibraryScanProgress {
  phase: "discovering" | "metadata" | "complete";
  completed: number;
  total: number;
  current: string;
}

export interface LibraryScannerOptions {
  artworkDirectory: string;
  mediaUrl: (filePath: string) => string;
  metadataLoader: () => Promise<typeof import("music-metadata")>;
  audioExtensions: ReadonlySet<string>;
  videoExtensions?: ReadonlySet<string>;
  probeVideo?: (file: string) => Promise<{ duration?: number; coverUrl?: string; videoInfo?: string }>;
  ensureCoverThumbnail?: (coverUrl: string) => Promise<void>;
  probeRawAudio?: (filePath: string) => Promise<{ duration?: number }>;
  directoryConcurrency?: number;
  metadataConcurrency?: number;
  isCancelled?: () => boolean;
  fileSystem?: LibraryScannerFileSystem;
  fileFingerprint?: (filePath: string, size: number) => Promise<string | undefined>;
}

export interface LibraryScannerFileSystem {
  stat(filePath: string): Promise<fs.Stats>;
  readdir(directory: string): Promise<fs.Dirent[]>;
  /** Resolves junctions and symbolic links; without it a link is never followed. */
  realpath?(filePath: string): Promise<string>;
  mkdir(directory: string): Promise<unknown>;
  writeFile(filePath: string, data: Uint8Array): Promise<unknown>;
  existsSync(filePath: string): boolean;
}

type DirectoryObservation =
  | { directory: string; entries: fs.Dirent[] }
  | { directory: string; error: unknown };

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code || "UNKNOWN")
    : "UNKNOWN";
}

function failure(stage: ScanFailure["stage"], filePath: string, error: unknown): ScanFailure {
  return {
    stage,
    path: filePath,
    code: errorCode(error),
    message: error instanceof Error ? error.message : String(error || "Unknown scan failure")
  };
}

export function libraryRootId(rootPath: string) {
  return crypto.createHash("sha256").update(libraryPathKey(rootPath)).digest("hex");
}

// Volume bookkeeping folders found at a drive root: the recycle bin would index
// deleted files ($R*.mp3), and System Volume Information always denies access,
// which would keep a whole-drive root partial forever.
const SYSTEM_DIRECTORIES = new Set(["$recycle.bin", "system volume information"]);

function scanError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

export class LibraryScanner {
  readonly directoryConcurrency: number;
  readonly metadataConcurrency: number;
  private readonly fileSystem: LibraryScannerFileSystem;

  constructor(private readonly options: LibraryScannerOptions) {
    this.directoryConcurrency = Math.max(1, Math.floor(options.directoryConcurrency || 8));
    this.metadataConcurrency = Math.max(1, Math.floor(options.metadataConcurrency || 8));
    this.fileSystem = options.fileSystem || {
      stat: filePath => fs.promises.stat(filePath),
      readdir: directory => fs.promises.readdir(directory, { withFileTypes: true }),
      // The native call, like the access policy (ElectronSecurity canonical()).
      realpath: filePath => new Promise<string>((resolve, reject) =>
        fs.realpath.native(filePath, (error, resolved) => error ? reject(error) : resolve(resolved))),
      mkdir: directory => fs.promises.mkdir(directory, { recursive: true }),
      writeFile: (filePath, data) => fs.promises.writeFile(filePath, data),
      existsSync: filePath => fs.existsSync(filePath)
    };
  }

  private cancelled() {
    return Boolean(this.options.isCancelled?.());
  }

  private supported(filePath: string) {
    const extension = path.extname(filePath).toLowerCase();
    return this.options.audioExtensions.has(extension) || Boolean(this.options.videoExtensions?.has(extension));
  }

  private async listingDenied(directory: string) {
    try { await this.fileSystem.readdir(directory); return false; }
    catch (error) { const code = errorCode(error); return code === "EPERM" || code === "EACCES"; }
  }

  private async realKey(filePath: string) {
    if (!this.fileSystem.realpath) throw scanError("ENOTSUP", "Links cannot be resolved here");
    return libraryPathKey(await this.fileSystem.realpath(filePath));
  }

  /**
   * Junctions and symbolic links (libuv reports every reparse point as a link).
   * One that resolves to itself (a cloud placeholder, say) is an ordinary entry.
   * One into this root, or into another library root, is skipped: that content
   * is scanned at its real location, so following it would only add duplicates
   * or loops. Anything else cannot be played (the access policy checks real
   * paths) and is not followed, but it is reported and makes the root partial,
   * so the tracks behind it are never treated as deleted.
   */
  private async classifyLink(linkPath: string, rootKey: () => Promise<string>, coveredKeys: () => Promise<string[]>) {
    const stat = await this.fileSystem.stat(linkPath);
    const directory = stat.isDirectory();
    if (!directory && !this.supported(linkPath)) return "ignore" as const;
    const target = await this.realKey(linkPath);
    const parent = await this.realKey(path.dirname(linkPath));
    // Keys have no trailing separator ("e:" for a drive root), so join by hand.
    if (target === `${parent}\\${path.basename(linkPath).toLocaleLowerCase()}`) return directory ? "directory" as const : "file" as const;
    if (libraryPathWithin(target, await rootKey()) || (await coveredKeys()).some(key => libraryPathWithin(target, key))) return "ignore" as const;
    // Windows' compatibility junctions ("My Music" in Documents, "Application
    // Data" in a profile) deny listing to everyone: nothing was ever scanned
    // through them, so they are not unscanned library content.
    if (directory && await this.listingDenied(linkPath)) return "ignore" as const;
    throw scanError("ELINKOUTSIDE", "Linked folder or file points outside the music library roots; it was not scanned");
  }

  private async enumerateRoot(rootPath: string, failures: ScanFailure[], isCancelled = () => this.cancelled(),
    coveredKeys: () => Promise<string[]> = async () => []) {
    const files: string[] = [];
    const unreadableDirectories: string[] = [];
    let status: RootScanStatus = "complete";

    try {
      const rootStat = await this.fileSystem.stat(rootPath);
      if (!rootStat.isDirectory()) throw Object.assign(new Error("Music root is not a directory"), { code: "ENOTDIR" });
    } catch (error) {
      const code = errorCode(error);
      const rootStatus: RootScanStatus = code === "EACCES" || code === "EPERM" ? "permissionDenied" : "offline";
      failures.push(failure("root", rootPath, error));
      return { files, unreadableDirectories: [rootPath], status: rootStatus };
    }

    let rootKey: Promise<string> | undefined;
    const resolvedRootKey = () => rootKey ??= this.realKey(rootPath).catch(() => libraryPathKey(rootPath));
    const pending = [rootPath];
    while (pending.length) {
      if (isCancelled()) return { files, unreadableDirectories, status: "cancelled" as RootScanStatus };
      const batch = pending.splice(0, this.directoryConcurrency);
      const observations = await Promise.all(batch.map(async (directory): Promise<DirectoryObservation> => {
        try {
          return { directory, entries: await this.fileSystem.readdir(directory) };
        } catch (error) {
          return { directory, error };
        }
      }));
      for (const observation of observations) {
        if ("error" in observation) {
          const code = errorCode(observation.error);
          status = observation.directory === rootPath && (code === "EACCES" || code === "EPERM")
            ? "permissionDenied"
            : observation.directory === rootPath && (code === "ENOENT" || code === "ENOTDIR")
              ? "offline"
              : "partial";
          unreadableDirectories.push(observation.directory);
          failures.push(failure("directory", observation.directory, observation.error));
          continue;
        }
        const links: string[] = [];
        for (const entry of observation.entries) {
          const fullPath = path.join(observation.directory, entry.name);
          if (entry.isDirectory()) { if (!SYSTEM_DIRECTORIES.has(entry.name.toLowerCase())) pending.push(fullPath); }
          else if (entry.isFile()) { if (this.supported(entry.name)) files.push(fullPath); }
          else if (entry.isSymbolicLink?.()) links.push(fullPath);
        }
        for (const linkPath of links) {
          try {
            const kind = await this.classifyLink(linkPath, resolvedRootKey, coveredKeys);
            if (kind === "directory") pending.push(linkPath);
            else if (kind === "file") files.push(linkPath);
          } catch (error) {
            if (status === "complete") status = "partial";
            unreadableDirectories.push(linkPath);
            failures.push(failure("directory", linkPath, error));
          }
        }
      }
    }
    files.sort((left, right) => left.toLocaleLowerCase().localeCompare(right.toLocaleLowerCase()));
    return { files, unreadableDirectories, status };
  }

  private cachedArtworkUrl(sourcePath: string) {
    return legacyArtworkUrl(sourcePath, this.options.artworkDirectory, this.options.mediaUrl,
      filePath => this.fileSystem.existsSync(filePath));
  }

  private async fingerprint(sourcePath: string, size: number) {
    if (this.options.fileFingerprint) return this.options.fileFingerprint(sourcePath, size);
    if (this.options.fileSystem) return undefined;
    const sampleSize = 64 * 1024;
    const handle = await fs.promises.open(sourcePath, "r");
    try {
      const firstSize = Math.min(sampleSize, size);
      const lastSize = Math.min(sampleSize, Math.max(0, size - firstSize));
      const first = Buffer.alloc(firstSize);
      const last = Buffer.alloc(lastSize);
      if (firstSize) await handle.read(first, 0, firstSize, 0);
      if (lastSize) await handle.read(last, 0, lastSize, Math.max(firstSize, size - lastSize));
      return crypto.createHash("sha256").update(String(size)).update(first).update(last).digest("hex");
    } finally {
      await handle.close();
    }
  }

  async scanRoots(
    roots: string[],
    onProgress?: (progress: LibraryScanProgress) => void,
    signal?: AbortSignal,
    /** Every registered library root: a link into one of them is not an unscanned folder. */
    libraryRoots: string[] = roots
  ): Promise<LibraryScanResult> {
    const isCancelled = () => Boolean(signal?.aborted) || this.cancelled();
    const scanId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const rootResults: RootScanResult[] = [];
    const tracks: ScannedTrack[] = [];
    const failures: ScanFailure[] = [];
    let coveredKeys: Promise<string[]> | undefined;
    const libraryRootKeys = () => coveredKeys ??= Promise.all([...new Set([...roots, ...libraryRoots])]
      .map(root => this.realKey(root).catch(() => libraryPathKey(root))));

    for (const rootPath of roots) {
      if (isCancelled()) break;
      onProgress?.({ phase: "discovering", completed: 0, total: 0, current: rootPath });
      const observation = await this.enumerateRoot(rootPath, failures, isCancelled, libraryRootKeys);
      const rootResult: RootScanResult = {
        rootId: libraryRootId(rootPath),
        path: rootPath,
        status: observation.status,
        scannedFiles: 0,
        skippedFiles: observation.unreadableDirectories.length,
        unreadableDirectories: observation.unreadableDirectories
      };
      rootResults.push(rootResult);
      if (observation.status === "offline" || observation.status === "permissionDenied" || observation.status === "cancelled") continue;

      onProgress?.({ phase: "metadata", completed: 0, total: observation.files.length, current: rootPath });
      let metadataModule: typeof import("music-metadata") | undefined;
      try {
        metadataModule = await this.options.metadataLoader();
      } catch (error) {
        rootResult.status = "partial";
        failures.push(failure("metadata", rootPath, error));
      }
      let completed = 0;
      const scanned = await mapWithConcurrency(observation.files, this.metadataConcurrency, async sourcePath => {
        if (isCancelled()) {
          rootResult.status = "cancelled";
          return undefined;
        }
        let stat: fs.Stats;
        try {
          stat = await this.fileSystem.stat(sourcePath);
        } catch (error) {
          rootResult.status = "partial";
          rootResult.skippedFiles++;
          failures.push(failure("stat", sourcePath, error));
          completed++;
          onProgress?.({ phase: "metadata", completed, total: observation.files.length, current: path.basename(sourcePath) });
          return undefined;
        }
        if (stat.size === 0) {
          // An empty file (an interrupted download or copy) holds no media at all.
          // It is reported, not indexed as a playable track that silently fails.
          rootResult.skippedFiles++;
          failures.push(failure("stat", sourcePath, scanError("EMPTY_FILE", "The file is empty (0 bytes)")));
          completed++;
          onProgress?.({ phase: "metadata", completed, total: observation.files.length, current: path.basename(sourcePath) });
          return undefined;
        }

        let name = path.basename(sourcePath, path.extname(sourcePath));
        let artist = "未知艺术家";
        let album = "未分类专辑";
        let genre = "未分类";
        let duration: number | undefined;
        let year: number | undefined;
        let coverUrl: string | undefined = this.cachedArtworkUrl(sourcePath);
        let metadataRead = false;
        let artistNames: string[] | undefined;
        let albumArtist: string | undefined;
        let genres: string[] | undefined;
        let trackNumber: number | undefined;
        let discNumber: number | undefined;
        let compilation: boolean | undefined;
        const video = this.options.videoExtensions?.has(path.extname(sourcePath).toLowerCase());
        let videoInfo: string | undefined;
        if (video) {
          const display = videoDisplayName(sourcePath); name = display.name; year = display.year;
          artist = "本地视频"; album = "视频"; genre = "视频";
          try {
            const result = await this.options.probeVideo?.(sourcePath);
            duration = result?.duration; coverUrl = result?.coverUrl || coverUrl; videoInfo = result?.videoInfo;
            metadataRead = Boolean(result);
          } catch (error) { failures.push(failure("metadata", sourcePath, error)); }
        } else if (metadataModule) {
          try {
            const metadata = await metadataModule.parseFile(sourcePath, { duration: true });
            // music-metadata "succeeds" on some unreadable files without finding
            // any container or stream; that is no audio, not a file without tags.
            if (!metadata.format?.container && !metadata.format?.codec && !metadata.format?.duration)
              throw scanError("NO_AUDIO_STREAM", "No readable audio stream was found");
            metadataRead = true;
            name = metadata.common.title || name;
            artist = metadata.common.artist || artist;
            album = metadata.common.album || album;
            genre = metadata.common.genre?.[0] || genre;
            artistNames = metadata.common.artists;
            albumArtist = metadata.common.albumartist;
            genres = metadata.common.genre;
            trackNumber = metadata.common.track.no || undefined;
            discNumber = metadata.common.disk.no || undefined;
            compilation = metadata.common.compilation;
            year = metadata.common.year;
            duration = metadata.format.duration;
            const picture = metadata.common.picture?.[0];
            if (picture && picture.data.length < 8 * 1024 * 1024) {
              try {
                coverUrl = await cacheArtwork(picture, this.options.artworkDirectory, this.options.mediaUrl,
                  this.options.fileSystem) || coverUrl;
              } catch (error) {
                failures.push(failure("artwork", sourcePath, error));
              }
            }
          } catch (error) {
            if (/\.(dts|ac3|eac3)$/i.test(sourcePath) && this.options.probeRawAudio) {
              try {
                const probe = await this.options.probeRawAudio(sourcePath);
                duration = probe.duration;
                // Valid raw audio need not carry tags. Keep metadataRead=false so
                // rescanning never erases previously supplied names/classification.
              } catch (probeError) { failures.push(failure("metadata", sourcePath, probeError)); }
            } else failures.push(failure("metadata", sourcePath, error));
          }
        }
        if (coverUrl && this.options.ensureCoverThumbnail) {
          try { await this.options.ensureCoverThumbnail(coverUrl); }
          catch (error) { failures.push(failure("artwork", sourcePath, error)); }
        }
        if (isCancelled()) { rootResult.status = "cancelled"; return undefined; }
        let fingerprint: string | undefined;
        try { fingerprint = await this.fingerprint(sourcePath, stat.size); }
        catch (error) { failures.push(failure("stat", sourcePath, error)); }
        const legacyTrack = {
          id: crypto.createHash("sha1").update(sourcePath.toLowerCase()).digest("hex"),
          name,
          artist,
          album,
          genre,
          year,
          duration,
          coverUrl,
          metadataRead,
          mediaKind: video ? "video" as const : "audio" as const,
          videoInfo,
          format: path.extname(sourcePath).slice(1).toUpperCase(),
          size: stat.size,
          sourcePath,
          nativePath: needsDecodedAudio(sourcePath) ? undefined : sourcePath,
          url: this.options.mediaUrl(sourcePath),
          folder: path.dirname(sourcePath)
        };
        const track: ScannedTrack = {
          ...toTrackRecord({
            track: legacyTrack,
            folders: [rootPath],
            fingerprint,
            mtimeMs: stat.mtimeMs,
            artistNames,
            albumArtist,
            genres,
            trackNumber,
            discNumber,
            compilation
          }),
          metadataRead
        };
        completed++;
        rootResult.scannedFiles++;
        onProgress?.({ phase: "metadata", completed, total: observation.files.length, current: path.basename(sourcePath) });
        return track;
      });
      tracks.push(...scanned.filter((track): track is ScannedTrack => Boolean(track)));
    }

    // Every scanner result is created by toTrackRecord above; ScannedTrack keeps
    // its domain fields optional only so older reconciliation fixtures stay valid.
    const uniqueTracks = disambiguateMediaIds(tracks as Array<ScannedTrack & TrackRecord>);
    onProgress?.({ phase: "complete", completed: uniqueTracks.length, total: uniqueTracks.length, current: roots.join(" | ") });
    return {
      scanId,
      startedAt,
      completedAt: new Date().toISOString(),
      roots: rootResults,
      tracks: uniqueTracks,
      failures
    };
  }
}

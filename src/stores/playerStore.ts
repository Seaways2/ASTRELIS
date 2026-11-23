import { loadFolderVisibility, isFolderLocked } from "./folderVisibilityStore";
import { create } from "zustand";
import { isVideoFile, isVideoTrack } from "../utils/videoTrack";
import { parseBlob } from "music-metadata";
import { mergeScannedLibrary, sanitizeLibraryFolders } from "../utils/libraryCoverMerge";
import { refreshLibraryThumbnails } from "../utils/libraryThumbnailRefresh";
import { SOURCE_MISSING, relocateMissingTrack } from "../utils/relocateTrack";
import type { PageId, RepeatMode, Track, VisualizerMode, VisualizerSettings } from "../types/audio";
import { DEFAULT_VISUALIZER_MODE, normalizeVisualizerMode } from "../utils/visualizerMode";
import type { LibraryDerivedIndexSnapshot } from "../library/LibraryQueryService";
import type { GpuVisualQuality } from "../visualizers/gpuVisualRuntime";

export const defaultVisualizerSettings: VisualizerSettings = {
  fftSize: 2048,
  smoothing: .76,
  sensitivity: 1,
  barCount: 90,
  barOpacity: 1,
  lineWidth: 1.5,
  animationSpeed: 1,
  decaySpeed: 1,
  peakHoldMs: 650,
  torusParticleCount: 80000,
  torusRadius: .61,
  torusThickness: .205,
  torusFlowSpeed: 1,
  torusNoiseStrength: 1,
  torusLowResponse: 1,
  torusMidResponse: 1,
  torusHighResponse: 1,
  torusShockSpeed: 1,
  torusTrailStrength: .35,
  torusColorScheme: "ice",
  ringTilt: .82,
  holeSize: .48,
  ringThicknessVariation: .55,
  tangentialFlowSpeed: 1,
  curlNoiseStrength: 1,
  particleStretch: .72,
  densityFalloff: 1.7,
  asymmetry: .55,
  impulsePropagationSpeed: 1,
  bloomThreshold: .68,
  pointerInteraction: true,
  flashStrength: 1,
  glintAmount: 1,
  accentShare: .65,
  pointerStrength: 1
};

/** Ranges of the tuning sliders; a stored value outside them falls back to the default. */
export const VISUAL_TUNING_RANGES = {
  flashStrength: [0, 2], glintAmount: [0, 2], accentShare: [.3, .95], pointerStrength: [.25, 2]
} as const;

const storedVisualizerSettings = (() => {
  try {
    const raw = localStorage.getItem("auralis.visual.settings");
    const parsed: unknown = JSON.parse(raw || "{}");
    const stored = { ...defaultVisualizerSettings };
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Only supported parameters survive upgrades. Removed controls must not
      // come back through a stale profile or be persisted again by a later edit.
      for (const key of Object.keys(defaultVisualizerSettings) as Array<keyof VisualizerSettings>) {
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
          Object.assign(stored, { [key]: (parsed as Record<string, unknown>)[key] });
        }
      }
    }
    // Undo the short-lived compact decay-range migration if it reached this
    // profile before the feature was rolled back.
    const compactDecay = localStorage.getItem("auralis.visual.decay-range-v2") === "1";
    if (compactDecay && parsed && typeof parsed === "object" && "decaySpeed" in parsed) {
      const compactDecaySpeed = Number(parsed.decaySpeed);
      if (Number.isFinite(compactDecaySpeed)) {
        stored.decaySpeed = .2 + (Math.min(2, Math.max(.05, compactDecaySpeed)) - .05) / 1.95 * 4.8;
      }
    }
    if (typeof stored.pointerInteraction !== "boolean") stored.pointerInteraction = defaultVisualizerSettings.pointerInteraction;
    for (const [key, [minimum, maximum]] of Object.entries(VISUAL_TUNING_RANGES) as Array<[keyof typeof VISUAL_TUNING_RANGES, readonly [number, number]]>) {
      const value = Number(stored[key]);
      stored[key] = Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : defaultVisualizerSettings[key];
    }
    const storedDecaySpeed = Number(stored.decaySpeed);
    stored.decaySpeed = Number.isFinite(storedDecaySpeed)
      ? Math.min(1, Math.max(.05, storedDecaySpeed))
      : defaultVisualizerSettings.decaySpeed;
    const sanitized = JSON.stringify(stored);
    try {
      if (raw !== null && raw !== sanitized) localStorage.setItem("auralis.visual.settings", sanitized);
      if (compactDecay) localStorage.removeItem("auralis.visual.decay-range-v2");
    } catch { /* Read-only storage must not discard the loaded user parameters. */ }
    return stored;
  } catch {
    return defaultVisualizerSettings;
  }
})();

const FAVORITES_STORAGE_KEY = "auralis.library.favorites.v1";
const FAVORITES_V2_STORAGE_KEY = "auralis.library.favorites.v2";
const validMediaFavoriteKey = (value: string) => /^media:[a-f0-9]{64}$/.test(value);

const legacyFavoriteTrackKey = (track: Pick<Track, "sourcePath" | "nativePath" | "format">) => {
  const localPath = track.sourcePath || (!/^(NETEASE|STREAM)$/i.test(track.format) ? track.nativePath : "");
  if (!localPath) return "";
  return `path:${localPath.trim().replace(/\//g, "\\").toLowerCase()}`;
};

export const favoriteTrackKey = (track: Pick<Track, "mediaId" | "sourcePath" | "nativePath" | "format">) =>
  track.mediaId ? `media:${track.mediaId}` : legacyFavoriteTrackKey(track);

const storedFavoriteTrackKeys = (() => {
  try {
    const currentRaw = localStorage.getItem(FAVORITES_V2_STORAGE_KEY);
    const legacyRaw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    // Once v2 exists it is authoritative. Re-merging the read-only v1 backup here
    // would resurrect favorites that the user has explicitly removed from v2.
    const stored = JSON.parse(currentRaw !== null ? currentRaw : (legacyRaw || "[]"));
    return Array.from(new Set((Array.isArray(stored) ? stored : []).filter((item): item is string => typeof item === "string"
      && (item.startsWith("path:") || validMediaFavoriteKey(item)))));
  } catch {
    return [];
  }
})();

const migrateFavoriteTrackKeys = (tracks: Track[], keys: string[]) => {
  const mediaByLegacyPath = new Map(tracks
    .filter(track => track.mediaId)
    .map(track => [legacyFavoriteTrackKey(track), `media:${track.mediaId}`] as const)
    .filter(([legacy]) => legacy));
  const migrated = Array.from(new Set(keys.map(key => mediaByLegacyPath.get(key) || key)));
  localStorage.setItem(FAVORITES_V2_STORAGE_KEY, JSON.stringify(migrated.filter(validMediaFavoriteKey)));
  return migrated;
};

interface PlayerState {
  tracks: Track[];
  inactiveTracks: Track[];
  queueKind: "music" | "video";
  viewedQueueKind: "music" | "video";
  viewQueue(kind: "music" | "video"): void;
  playQueuedTrack(id: string): Promise<void>;
  queueSelection: Partial<Record<"music" | "video", string>>;
  queueBookmarks: Record<string, number>;
  switchQueue(kind: "music" | "video"): void;
  addQueueTracks(tracks: Track[]): void;
  /** Resolves false when the saved queue could not be loaded (it is then kept on disk). */
  restoreQueues(): Promise<boolean>;
  libraryTracks: Track[];
  libraryDerivedIndexCache: LibraryDerivedIndexSnapshot | null;
  favoriteTrackKeys: string[];
  currentIndex: number;
  localPlayRequest: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  visualizer: VisualizerMode;
  visualSettings: VisualizerSettings;
  activePage: PageId;
  nativeOutputGuideRequest: number;
  youtubeVstLabGuideRequest: number;
  accent: string;
  uiSettings: UiSettings;
  obsMode: boolean;
  onlineMedia: OnlineMediaState | null;
  fadeMs: number;
  libraryFolders: string[];
  libraryRevision: number;
  libraryScanning: boolean;
  libraryScanRequestId: string;
  libraryScanCancelling: boolean;
  cancelLibraryScan: () => Promise<void>;
  libraryError: string;
  libraryScanProgress: LibraryScanProgress | null;
  hydrateLibrary: () => Promise<void>;
  addTracks: (files: File[]) => Promise<void>;
  openExternalFiles: (paths: string[]) => Promise<void>;
  importLibraryFolder: () => Promise<void>;
  removeLibraryFolder: (folder: string) => Promise<void>;
  rescanLibrary: () => Promise<void>;
  /**
   * Plays a queue entry. `skipMissing` lets automatic advancement move past
   * that many entries whose files are gone instead of stopping on the first.
   * `keepPosition` prepares the entry that is already current in place: it
   * keeps its play request and position (see awaitsDecodedSource).
   */
  playTrack: (index: number, options?: { navigateToNowPlaying?: boolean; skipMissing?: number; keepPosition?: boolean }) => Promise<void>;
  cancelPendingPlay: () => void;
  hasPendingPlay: () => boolean;
  /**
   * The current entry cannot be decoded. Moves on when its play request was
   * allowed to skip entries (automatic advancement, Next) and it is playing;
   * a playing entry that may not skip stops. A paused entry stays where it is
   * and keeps its budget. Returns whether another entry is being started.
   */
  skipUnplayableTrack: () => boolean;
  /**
   * Loads the current entry again as a new play request, from the position it
   * has now (its backend was lost, e.g. the native host exited).
   */
  reloadCurrentTrack: () => void;
  enqueueLibraryTrack: (id: string, playNow?: boolean) => Promise<void>;
  enqueueLibraryTracks: (ids: string[]) => void;
  enqueueStreamTrack: (track: Track, playNow?: boolean) => Promise<void>;
  enqueueStreamTracks: (tracks: Track[]) => void;
  toggleFavoriteTrack: (track: Track) => void;
  removeTrack: (id: string) => void;
  clearTracks: () => void;
  setCurrentIndex: (index: number) => void;
  setPlaying: (playing: boolean) => void;
  setPlaybackObserved: (playing: boolean) => void;
  setTiming: (currentTime: number, duration: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setShuffle: (shuffle: boolean) => void;
  cycleRepeat: () => void;
  setVisualizer: (mode: VisualizerMode) => void;
  setVisualSetting: <K extends keyof VisualizerSettings>(key: K, value: VisualizerSettings[K]) => void;
  resetVisualSettings: () => void;
  setActivePage: (page: PageId) => void;
  requestNativeOutputForVst: () => boolean;
  requestYoutubeVstLabGuide: () => void;
  setAccent: (accent: string) => void;
  setUiSetting: <K extends keyof UiSettings>(key: K, value: UiSettings[K]) => void;
  setObsMode: (enabled: boolean) => void;
  setOnlineMedia: (media: OnlineMediaState) => void;
  setFadeMs: (fadeMs: number) => void;
}

export type StartupPage = "nowPlaying" | "playlist" | "library" | "online";
const normalizeStartupPage = (value: unknown): StartupPage =>
  value === "playlist" || value === "library" || value === "online" ? value : "nowPlaying";

export interface UiSettings {
  startupPage: StartupPage;
  colorMode: "dark" | "light" | "system";
  windowOpacity: number;
  blurStrength: number;
  glassMaterial: "mica" | "acrylic" | "none";
  glowStrength: number;
  animations: boolean;
  visualTransition: "dissolve" | "fade" | "zoom" | "slide" | "scan";
  lowPerformanceMode: boolean;
  gpuAccelerationEnabled: boolean;
  gpuQuality: GpuVisualQuality;
  gpuAutoQuality: boolean;
  nativeOutputEnabled: boolean;
  hdmiDirectEnabled: boolean;
  hdmiEndpointId: string;
  hdmiDeviceName: string;
  youtubeVstLabEnabled: boolean;
  youtubeProcessLoopbackEnabled: boolean;
  customBackgroundPath: string;
  customBackgroundUrl: string;
  backgroundImages: {path:string;url:string}[];
  backgroundFolder: string;
  backgroundInterval: number;
}

const defaultUiSettings: UiSettings = {
  startupPage: "nowPlaying",
  colorMode: "dark",
  windowOpacity: .94,
  blurStrength: 18,
  glassMaterial: "mica",
  glowStrength: 1,
  animations: true,
  visualTransition: "dissolve",
  lowPerformanceMode: false,
  gpuAccelerationEnabled: true,
  gpuQuality: "standard",
  gpuAutoQuality: true,
  nativeOutputEnabled: false,
  hdmiDirectEnabled: false,
  hdmiEndpointId: "",
  hdmiDeviceName: "",
  youtubeVstLabEnabled: false,
  youtubeProcessLoopbackEnabled: false,
  customBackgroundPath: "",
  customBackgroundUrl: "",
  backgroundImages: [],
  backgroundFolder: "",
  backgroundInterval: 0
};

const storedUiSettings = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem("auralis.ui.settings") || "{}");
    const glassMaterial = stored.glassMaterial === "none" || stored.glassMaterial === "acrylic"
      ? stored.glassMaterial
      : "mica";
    const colorMode = stored.colorMode === "light" || stored.colorMode === "system" ? stored.colorMode : "dark";
    const visualTransition = stored.visualTransition === "fade" || stored.visualTransition === "zoom"
      || stored.visualTransition === "slide" || stored.visualTransition === "scan"
      ? stored.visualTransition : "dissolve";
    const gpuQuality: GpuVisualQuality = stored.gpuQuality === "eco" || stored.gpuQuality === "cosmic"
      ? stored.gpuQuality : "standard";
    return {
      ...defaultUiSettings,
      ...stored,
      startupPage: normalizeStartupPage(stored.startupPage),
      colorMode,
      glassMaterial,
      visualTransition,
      lowPerformanceMode: stored.lowPerformanceMode === true,
      gpuAccelerationEnabled: stored.gpuAccelerationEnabled !== false,
      gpuQuality,
      gpuAutoQuality: stored.gpuAutoQuality !== false,
      hdmiDirectEnabled: stored.hdmiDirectEnabled === true && typeof stored.hdmiEndpointId === "string" && !!stored.hdmiEndpointId,
      hdmiEndpointId: typeof stored.hdmiEndpointId === "string" ? stored.hdmiEndpointId : "",
      hdmiDeviceName: typeof stored.hdmiDeviceName === "string" ? stored.hdmiDeviceName : "",
      nativeOutputEnabled: stored.nativeOutputEnabled === true
        || (stored.nativeOutputEnabled === undefined && localStorage.getItem("auralis.vst.enabled") === "true"),
      // Stable online mode is intentionally non-configurable.  Ignore values
      // left by experimental builds so an upgrade can never reactivate the
      // YouTube Native/VST capture path from localStorage.
      youtubeVstLabEnabled: false,
      youtubeProcessLoopbackEnabled: false,
      customBackgroundPath: typeof stored.customBackgroundPath === "string" ? stored.customBackgroundPath : "",
      backgroundImages: Array.isArray(stored.backgroundImages) ? stored.backgroundImages.filter((item: {path?:unknown;url?:unknown}) => typeof item?.path === "string" && typeof item?.url === "string" && item.url.startsWith("auralis-media://local/")) : [],
      backgroundFolder: typeof stored.backgroundFolder === "string" ? stored.backgroundFolder : "",
      backgroundInterval: [0,15,30,60,300,600,1800].includes(stored.backgroundInterval) ? stored.backgroundInterval : 0,
      customBackgroundUrl: typeof stored.customBackgroundUrl === "string" && stored.customBackgroundUrl.startsWith("auralis-media://local/")
        ? stored.customBackgroundUrl : "",
      windowOpacity: Number(stored.windowOpacity ?? stored.panelOpacity ?? defaultUiSettings.windowOpacity)
    };
  } catch {
    return defaultUiSettings;
  }
})();

const extension = (name: string) => name.split(".").pop()?.toUpperCase() ?? "AUDIO";
// Audio the player accepts: electron/library/media/audioFormats.ts AUDIO_EXTENSIONS.
export const AUDIO_FILE_PATTERN = /\.(mp3|wav|flac|aac|ogg|m4a|ape|dsf|aiff|aif|opus|wma|dts|ac3|eac3|wv|tta)$/i;
// Audio Chromium cannot play, which library.prepare decodes with ffmpeg first
// (main.ts prepareLocalSource): FFMPEG_DECODED_AUDIO_EXTENSIONS plus AIFF.
export const WEB_DECODED_AUDIO_PATTERN = /\.(ape|dsf|wma|dts|ac3|eac3|wv|tta|aiff|aif)$/i;
/**
 * A queued entry of such a format whose playable source is still the original
 * file: it became current without playTrack (a restored queue, an entry added
 * to an empty queue, the next entry after removing the current one), so it was
 * never prepared. Chromium cannot play it; prepared entries point at the
 * decoded cache file instead (nativePath is that file, not sourcePath).
 */
export const awaitsDecodedSource = (track: Track | undefined) => Boolean(track?.sourcePath
  && WEB_DECODED_AUDIO_PATTERN.test(track.sourcePath)
  && (!track.nativePath || track.nativePath === track.sourcePath));
const cleanName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
const libraryCommandMeta = (expectedRevision: number): LibraryCommandMeta => ({
  requestId: typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  expectedRevision
});
/**
 * What a scan could not do, one source text per kind (translateMessage maps
 * each, joined by "；"): folders it could not finish, links leading out of the
 * library, files it skipped (unreadable or empty), files without a readable
 * audio stream, and files whose tags could not be read.
 */
export const libraryScanMessage = (scan: Pick<LibraryScanCommitResponse["scan"], "roots" | "failures">) => {
  const failures = scan.failures || [];
  const outsideLinks = failures.filter(failure => failure.code === "ELINKOUTSIDE");
  const pathKey = (value: string) => value.replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
  const linkKeys = new Set(outsideLinks.map(failure => pathKey(failure.path)));
  const within = (value: string, root: string) => pathKey(value) === pathKey(root) || pathKey(value).startsWith(`${pathKey(root)}\\`);
  // A root whose only gaps are links out of the library is reported as those
  // links, not as a folder that failed to scan. Unreadable files (stat) and a
  // metadata reader that failed to load also make a root partial.
  const onlyOutsideLinks = (root: LibraryRootScanResult) => root.status === "partial"
    && root.unreadableDirectories.length > 0
    && root.unreadableDirectories.every(directory => linkKeys.has(pathKey(directory)))
    && !failures.some(failure => within(failure.path, root.path)
      && ((failure.stage === "stat" && failure.code !== "EMPTY_FILE") || (failure.stage === "metadata" && pathKey(failure.path) === pathKey(root.path))));
  const incompleteRoots = scan.roots.filter(root => root.status !== "complete" && !onlyOutsideLinks(root));
  const skippedFiles = failures.filter(failure => failure.stage === "stat").length;
  const noAudio = failures.filter(failure => failure.stage === "metadata" && failure.code === "NO_AUDIO_STREAM").length;
  const tagFailures = failures.filter(failure => failure.stage === "metadata" && failure.code !== "NO_AUDIO_STREAM").length;
  return [
    incompleteRoots.length ? `${incompleteRoots.length} 个音乐目录未完整扫描，旧曲目已安全保留` : "",
    outsideLinks.length ? `${outsideLinks.length} 个链接指向媒体库之外，已跳过` : "",
    skippedFiles ? `${skippedFiles} 个文件无法读取或是空文件，已跳过` : "",
    noAudio ? `${noAudio} 个文件没有可读取的音频内容，可能已损坏` : "",
    tagFailures ? `${tagFailures} 个文件的标签未能完整读取，旧分类信息已尽量保留` : ""
  ].filter(Boolean).join("；");
};

const LEGACY_LIBRARY_TRACKS_KEY = "auralis.library.tracks";
const LEGACY_LIBRARY_FOLDERS_KEY = "auralis.library.folders";
const LEGACY_LIBRARY_IMPORTED_KEY = "auralis.library.legacy-import.v2";

const readLegacyLibraryState = () => {
  const tracksRaw = localStorage.getItem(LEGACY_LIBRARY_TRACKS_KEY);
  const foldersRaw = localStorage.getItem(LEGACY_LIBRARY_FOLDERS_KEY);
  if (!tracksRaw && !foldersRaw) return null;
  const tracks = tracksRaw ? JSON.parse(tracksRaw) : [];
  const folders = foldersRaw ? JSON.parse(foldersRaw) : [];
  if (!Array.isArray(tracks) || !Array.isArray(folders) || !folders.every(folder => typeof folder === "string")) {
    throw new Error("旧音乐库浏览器数据格式无效，原始数据已保留");
  }
  return { tracks, folders };
};

const importLegacyLibraryState = async (force = false) => {
  if (!window.desktop) return "";
  const legacy = readLegacyLibraryState();
  if (!legacy || (!legacy.tracks.length && !legacy.folders.length)) return "";
  if (!force && localStorage.getItem(LEGACY_LIBRARY_IMPORTED_KEY)) return "";
  const result = await window.desktop.library.importLegacyState(legacy.tracks, legacy.folders, {
    requestId: typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`
  });
  if (result.status === "conflict") throw new Error(result.error?.message || "旧音乐库导入时发生版本冲突");
  localStorage.setItem(LEGACY_LIBRARY_IMPORTED_KEY, JSON.stringify({
    sourceHash: result.sourceHash,
    revision: result.revision,
    importedAt: new Date().toISOString()
  }));
  return result.status === "imported" ? "旧音乐库数据已安全导入" : "";
};

let playTrackRequestGeneration = 0;
let pendingPlayTrackId = "";
const cancelPendingPlay = () => {
  playTrackRequestGeneration++;
  pendingPlayTrackId = "";
};

// How many unplayable entries the current play request may still skip, and
// which play request (localPlayRequest) that budget belongs to.
let playbackSkip = { request: -1, remaining: 0 };
// Past the end only with repeat-all, as when a song ends normally.
const skipTargetIndex = (index: number, count: number, repeat: RepeatMode) =>
  index + 1 < count ? index + 1 : repeat === "all" ? 0 : -1;

// Queue bookmarks resume the selected entry of a queue after a music/video
// queue switch or a restart, and let a video continue where it was left. A song
// chosen, or reached by Next, Previous or auto-advance, starts from the top.
// `resumeTrackId` names the entry a switch or restore positioned on its bookmark.
let resumeTrackId = "";
const withoutBookmarks = (bookmarks: Record<string, number>, ids: Set<string>) =>
  Object.fromEntries(Object.entries(bookmarks).filter(([id]) => !ids.has(id)));
const leavePosition = (bookmarks: Record<string, number>, track: Track | undefined, time: number, duration: number) => {
  if (!track) return bookmarks;
  const rest = withoutBookmarks(bookmarks, new Set([track.id]));
  const finished = duration > 0 && time >= duration - .5;
  return isVideoTrack(track) && time > 0 && !finished ? { ...rest, [track.id]: time } : rest;
};
const entryPosition = (track: Track | undefined, bookmarks: Record<string, number>) =>
  track && isVideoTrack(track) ? bookmarks[track.id] || 0 : 0;

// Episodes of a series share a folder and their file names sort naturally
// (S01E02 before S01E10). Only names with an episode marker form a run, so a
// folder of unrelated films is never queued as a series.
const EPISODE_MARKER = /(?:^|[^a-z0-9])(?:s\d{1,2}[\s._-]*e\d{1,4}|ep?[\s._-]?\d{1,4}|第\s*\d{1,4}\s*[集话話])(?!\d)|\[\d{1,3}(?:v\d)?\]|\s-\s\d{1,3}(?:v\d)?(?=[\s[(.]|$)/i;
const splitMediaPath = (path: string) => {
  const normal = path.replace(/\//g, "\\");
  const cut = normal.lastIndexOf("\\");
  return { folder: normal.slice(0, cut + 1).toLowerCase(), name: normal.slice(cut + 1) };
};
const episodeOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** The series name before the episode marker ("Breaking.Bad.S01E02" -> "breakingbad"), or null without a marker. */
const seriesName = (name: string) => {
  const marker = EPISODE_MARKER.exec(name);
  return marker ? name.slice(0, marker.index).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") : null;
};
/** The episode and the ones after it of the same series in its folder; just the item when it is not an episode. */
const followingEpisodes = (source: Track, library: Track[]) => {
  if (!source.sourcePath) return [source];
  const origin = splitMediaPath(source.sourcePath);
  // A folder such as Downloads can hold several series side by side.
  const series = seriesName(origin.name);
  if (series === null) return [source];
  const season = library
    .filter(track => track.sourcePath && isVideoTrack(track))
    .map(track => ({ track, path: splitMediaPath(track.sourcePath!) }))
    .filter(({ path }) => path.folder === origin.folder && seriesName(path.name) === series)
    .sort((a, b) => episodeOrder.compare(a.path.name, b.path.name))
    .map(({ track }) => track);
  const start = season.findIndex(track => track.id === source.id);
  return start < 0 ? [source] : season.slice(start);
};
/** Puts the entries `ids` together in that order where the first one was queued, or at the end. */
const placeRun = (list: Track[], ids: string[]) => {
  const wanted = new Set(ids);
  const run = ids.flatMap(id => list.filter(track => track.id === id));
  const at = list.findIndex(track => track.id === ids[0]);
  const rest = list.filter(track => !wanted.has(track.id));
  const insertAt = at < 0 ? rest.length : list.slice(0, at).filter(track => !wanted.has(track.id)).length;
  return [...rest.slice(0, insertAt), ...run, ...rest.slice(insertAt)];
};

const QUEUE_STORAGE_KEY = "astrelis.queues.v1";
let queuesRestored = false;
// While the saved queue is loading, a snapshot would replace it on disk with
// whatever was queued in the meantime (an external open, say).
let queueRestore: Promise<boolean> | undefined;
let queueRestoreInFlight = false;
let queueRestoreFailed = false;
// The saved queue could not be loaded: it stays on disk until the user changes
// the playlist on purpose (add, remove, clear). Opening a file from Explorer
// or restoring does not count, so neither replaces the queue that failed.
const acceptUserQueueEdit = () => {
  if (!queueRestoreFailed) return;
  queueRestoreFailed = false;
  queuesRestored = true;
};

// A fader drag changes the volume on every pointermove; persist only the value
// it settles on instead of writing localStorage synchronously each time.
const VOLUME_PERSIST_DELAY_MS = 250;
let pendingPersistedVolume: number | undefined;
let volumePersistTimer: ReturnType<typeof setTimeout> | undefined;
const flushPersistedVolume = () => {
  if (volumePersistTimer !== undefined) clearTimeout(volumePersistTimer);
  volumePersistTimer = undefined;
  if (pendingPersistedVolume === undefined) return;
  const value = pendingPersistedVolume;
  pendingPersistedVolume = undefined;
  try { localStorage.setItem("auralis.volume", String(value)); } catch { /* Storage can be unavailable. */ }
};
const persistVolume = (volume: number) => {
  pendingPersistedVolume = volume;
  if (volumePersistTimer !== undefined) clearTimeout(volumePersistTimer);
  volumePersistTimer = setTimeout(flushPersistedVolume, VOLUME_PERSIST_DELAY_MS);
};
if (typeof window !== "undefined") {
  // beforeunload also runs when Electron closes the window for quit.
  window.addEventListener?.("beforeunload", flushPersistedVolume);
  window.addEventListener?.("pagehide", flushPersistedVolume);
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  tracks: [],
  inactiveTracks: [],
  queueKind: "music",
  viewedQueueKind: "music",
  viewQueue: viewedQueueKind => set({ viewedQueueKind }),
  playQueuedTrack: async id => {
    const state = get();
    const track = [...state.tracks, ...state.inactiveTracks].find(item => item.id === id);
    if (!track) return;
    get().switchQueue(isVideoTrack(track) ? "video" : "music");
    set({ viewedQueueKind: get().queueKind });
    await get().playTrack(get().tracks.findIndex(item => item.id === id));
  },
  queueSelection: {},
  queueBookmarks: {},
  switchQueue: kind => {
    const state = get();
    if (state.queueKind === kind) return;
    cancelPendingPlay();
    const current = state.tracks[state.currentIndex];
    const queueBookmarks = { ...state.queueBookmarks, ...(current ? { [current.id]: state.duration > 0 && state.currentTime >= state.duration - .5 ? 0 : state.currentTime } : {}) };
    const queueSelection = { ...state.queueSelection, ...(current ? { [state.queueKind]: current.id } : {}) };
    const tracks = state.inactiveTracks;
    const index = tracks.findIndex(track => track.id === queueSelection[kind]);
    const currentIndex = index >= 0 ? index : tracks.length ? 0 : -1;
    resumeTrackId = tracks[currentIndex]?.id || "";
    set({ tracks, inactiveTracks: state.tracks, queueKind: kind, viewedQueueKind: kind, queueBookmarks, queueSelection,
      currentIndex, currentTime: queueBookmarks[tracks[currentIndex]?.id] || 0, duration: 0, playing: false,
      localPlayRequest: state.localPlayRequest + 1 });
  },
  addQueueTracks: incoming => set(state => {
    incoming = incoming.filter(track => !isFolderLocked(track.sourcePath));
    // Adding an entry that is already queued refreshes its metadata. Its
    // playable url and native path stay: playback may have replaced them with
    // a decoded cache file (APE/DSF/WMA…) that the current track is using. A
    // missing or moved entry takes the new copy, which is how it is repaired.
    const refresh = (queued: Track, added: Track) => queued.missing || queued.sourcePath !== added.sourcePath
      ? added : { ...added, url: queued.url, nativePath: queued.nativePath };
    const merge = (existing: Track[], added: Track[]) => {
      const byId = new Map(added.map(track => [track.id, track]));
      return [...existing.map(track => byId.has(track.id) ? refresh(track, byId.get(track.id)!) : track), ...[...byId.values()].filter(track => !existing.some(item => item.id === track.id))];
    };
    const active = incoming.filter(track => (isVideoTrack(track) ? "video" : "music") === state.queueKind);
    const inactive = incoming.filter(track => (isVideoTrack(track) ? "video" : "music") !== state.queueKind);
    const tracks = merge(state.tracks, active);
    const selectsFirst = state.currentIndex < 0 && tracks.length > 0;
    return { tracks, inactiveTracks: merge(state.inactiveTracks, inactive), currentIndex: selectsFirst ? 0 : state.currentIndex,
      ...(selectsFirst ? { currentTime: entryPosition(tracks[0], state.queueBookmarks), duration: 0 } : {}) };
  }),
  restoreQueues: () => queueRestore ||= (async () => {
    if (get().tracks.length || get().inactiveTracks.length || !window.desktop) { queuesRestored = true; return; }
    queueRestoreInFlight = true;
    try {
      // Main-owned store first; localStorage is the pre-migration location
      // (the first save after restoring moves it into the main store).
      // A load that throws is a failed restore (catch below), not "nothing
      // saved": treating it as empty let the next save replace the queue file.
      const fromMain = window.desktop.queue ? await window.desktop.queue.load() : null;
      const saved = fromMain ?? JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "null");
      if (!saved || !Array.isArray(saved.tracks)) return;
      await loadFolderVisibility();
      const files = saved.tracks.filter((track: Track) => typeof track?.sourcePath === "string" && !isFolderLocked(track.sourcePath));
      const result = files.length ? await window.desktop.library.openFiles(files.map((track: Track) => track.sourcePath!)) : { tracks: [] };
      // Entries the main process skipped (no access grant, missing file) keep
      // their saved form: restoring must never shrink the persisted queue.
      const restored: Track[] = files.flatMap((track: Track) => {
        const fresh = (result.tracks as Track[]).find(item => item.sourcePath === track.sourcePath);
        return fresh ? [{ ...fresh, id: track.id }] : [track];
      });
      const restoredIds = new Set(restored.map(track => track.id));
      const queueBookmarks = Object.fromEntries(Object.entries(saved.bookmarks || {}).filter(([id, value]) => restoredIds.has(id) && typeof value === "number" && Number.isFinite(value) && value >= 0)) as Record<string, number>;
      const kindOf = (track: Track) => isVideoTrack(track) ? "video" : "music";
      const live = get();
      if (live.tracks.length || live.inactiveTracks.length) {
        // Something was queued while the saved queue was loading (a file
        // opened from Explorer at a cold start). Keep it, and what it is
        // playing, after the saved entries instead of discarding either.
        const combine = (savedTracks: Track[], added: Track[]) => [...savedTracks.filter(track => !added.some(item => item.id === track.id)), ...added];
        const tracks = combine(restored.filter(track => kindOf(track) === live.queueKind), live.tracks);
        const inactiveTracks = combine(restored.filter(track => kindOf(track) !== live.queueKind), live.inactiveTracks);
        const current = live.tracks[live.currentIndex];
        set({ tracks, inactiveTracks, currentIndex: current ? tracks.findIndex(track => track.id === current.id) : tracks.length ? 0 : -1,
          queueSelection: { ...(saved.selection || {}), ...live.queueSelection }, queueBookmarks: { ...queueBookmarks, ...live.queueBookmarks } });
        return;
      }
      const kind = saved.kind === "video" ? "video" : "music";
      const tracks = restored.filter(track => kindOf(track) === kind);
      const inactiveTracks = restored.filter(track => kindOf(track) !== kind);
      const currentIndex = tracks.findIndex((track: Track) => track.id === saved.selection?.[kind]);
      resumeTrackId = tracks[currentIndex]?.id || "";
      set({ tracks, inactiveTracks, queueKind: kind, viewedQueueKind: kind, queueSelection: saved.selection || {}, queueBookmarks,
        currentIndex, currentTime: queueBookmarks[tracks[currentIndex]?.id] || 0 });
    } catch (error) {
      // Keep the saved queues intact if a source is unavailable: this session
      // never saves over the queue it could not load.
      queueRestoreFailed = true;
      console.error("[queue] restoring the saved queue failed", error);
      set({ libraryError: "上次的播放队列未能恢复，原队列文件已保留；调整播放列表之后才会保存新的队列" });
    } finally {
      queueRestoreInFlight = false;
      if (!queueRestoreFailed) {
        queuesRestored = true;
        // Saves were held back while loading; write what is queued now.
        if (get().tracks.length || get().inactiveTracks.length) saveQueues();
      }
    }
  })().then(() => !queueRestoreFailed),
  libraryTracks: [],
  libraryDerivedIndexCache: null,
  favoriteTrackKeys: storedFavoriteTrackKeys,
  currentIndex: -1,
  localPlayRequest: 0,
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: Number(localStorage.getItem("auralis.volume") ?? 0.72),
  muted: false,
  shuffle: false,
  repeat: "all",
  // A saved retired mode (the removed overview, waterfall, levels) opens the galaxy.
  visualizer: localStorage.getItem("auralis.visualizer.layout-v2")
    ? normalizeVisualizerMode(localStorage.getItem("auralis.visualizer"))
    : DEFAULT_VISUALIZER_MODE,
  visualSettings: storedVisualizerSettings,
  activePage: storedUiSettings.startupPage,
  nativeOutputGuideRequest: 0,
  youtubeVstLabGuideRequest: 0,
  accent: localStorage.getItem("auralis.accent") || "#d7dde2",
  uiSettings: storedUiSettings,
  obsMode: false,
  onlineMedia: null,
  fadeMs: Number(localStorage.getItem("auralis.fx.fadeMs") || 350),
  libraryFolders: [],
  libraryRevision: 0,
  libraryScanRequestId: "",
  libraryScanCancelling: false,
  libraryScanning: false,
  libraryError: "",
  libraryScanProgress: null,
  hydrateLibrary: async () => {
    if (!window.desktop) return;
    try {
      await loadFolderVisibility();
      let importMessage = "";
      try { importMessage = await importLegacyLibraryState(); }
      catch (error) { importMessage = error instanceof Error ? error.message : "旧音乐库导入失败，原始数据已保留"; }
      let library = await window.desktop.library.load();
      if ((library.status === "empty" || library.status === "error")
        && localStorage.getItem(LEGACY_LIBRARY_IMPORTED_KEY)) {
        try {
          const recoveredMessage = await importLegacyLibraryState(true);
          importMessage = recoveredMessage || importMessage;
          library = await window.desktop.library.load();
        } catch (error) {
          importMessage = error instanceof Error ? error.message : "旧音乐库恢复导入失败，原始数据已保留";
        }
      }
      if (library.status === "error") {
        set({ libraryError: importMessage || `${library.error?.code || "LIBRARY_UNKNOWN_ERROR"}: ${library.error?.message || "音乐库索引加载失败"}` });
        return;
      }
      const loadedTracks = Array.isArray(library.tracks) ? library.tracks as Track[] : [];
      const libraryTracks = mergeScannedLibrary(loadedTracks, []);
      const favoriteTrackKeys = migrateFavoriteTrackKeys(libraryTracks, get().favoriteTrackKeys);
      const libraryFolders = sanitizeLibraryFolders(Array.isArray(library.folders) ? library.folders : []);
      let libraryDerivedIndexCache: LibraryDerivedIndexSnapshot | null = null;
      try {
        libraryDerivedIndexCache = await window.desktop.library.loadDerivedIndex(library.revision) as LibraryDerivedIndexSnapshot | null;
      } catch { /* A derived cache failure must never block the canonical library snapshot. */ }
      set({
        libraryTracks,
        libraryDerivedIndexCache,
        favoriteTrackKeys,
        libraryFolders,
        libraryRevision: library.revision,
        libraryError: importMessage || (library.status === "recovered"
          ? `音乐库已恢复到有效版本 ${library.recoveredFromRevision || library.revision}`
          : "")
      });
    } catch (error) { set({ libraryError: error instanceof Error ? error.message : "音乐库索引加载失败" }); }
  },
  addTracks: async (files) => {
      acceptUserQueueEdit();
      await loadFolderVisibility();
      if (window.desktop) files = files.filter(file => !isFolderLocked(window.desktop!.getFilePath(file)));
      if (files.some(file => isVideoFile(file.name)) && window.desktop) {
        const paths = files.map(file => window.desktop!.getFilePath(file)).filter(Boolean);
        await get().openExternalFiles(paths);
        get().setActivePage("nowPlaying");
        return;
      }
      const audioFiles = files.filter((file) => AUDIO_FILE_PATTERN.test(file.name));
      const added = await Promise.all(audioFiles.map(async (file) => {
        let name = cleanName(file.name), artist = "本地音频", album = "未识别专辑", coverUrl: string | undefined;
        try {
          const metadata = await parseBlob(file, { duration: true });
          name = metadata.common.title || name;
          artist = metadata.common.artist || artist;
          album = metadata.common.album || album;
          const picture = metadata.common.picture?.[0];
          if (picture) coverUrl = URL.createObjectURL(new Blob([new Uint8Array(picture.data)], { type: picture.format }));
        } catch { /* Unsupported metadata never blocks playback. */ }
        const sourcePath = window.desktop?.getFilePath(file) || undefined;
        const prepared = sourcePath && !get().uiSettings.hdmiDirectEnabled ? await window.desktop?.library.prepare(sourcePath) : undefined;
        return {
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name, artist, album, coverUrl,
        url: prepared?.ok && prepared.url ? prepared.url : URL.createObjectURL(file),
        nativePath: prepared?.ok ? prepared.path : sourcePath,
        sourcePath,
        format: extension(file.name),
        size: file.size
      };
      }));
      get().addQueueTracks(added);
    },
  openExternalFiles: async (paths) => {
    if (!window.desktop?.library || !paths.length) return;
    try {
      // At a cold start folder visibility may still be loading; until it is,
      // every path counts as locked and the opened file would be dropped.
      await loadFolderVisibility();
      const result = await window.desktop.library.openFiles(paths);
      const incoming = Array.isArray(result.tracks) ? result.tracks as Track[] : [];
      if (!incoming.length) {
        set({ libraryError: "没有找到可播放的音频文件" });
        return;
      }
      const firstId = incoming[0].id;
      get().addQueueTracks(incoming);
      get().switchQueue(isVideoTrack(incoming[0]) ? "video" : "music");
      set({ libraryError: result.errors.length ? `${result.errors.length} 个文件读取失败` : "" });
      const firstIndex = get().tracks.findIndex(track => track.id === firstId);
      if (firstIndex >= 0) await get().playTrack(firstIndex);
    } catch (error) {
      set({ libraryError: error instanceof Error ? error.message : "无法打开外部音频文件" });
    }
  },
  importLibraryFolder: async () => {
    if (get().libraryScanning) return;
    if (!window.desktop) return;
    set({ libraryScanning: true, libraryError: "", libraryScanProgress: { phase: "discovering", completed: 0, total: 0, current: "等待选择目录" } });
    const stopProgress = window.desktop.library.onScanProgress(libraryScanProgress => set({ libraryScanProgress }));
    try {
      const state = get();
      const result = await window.desktop.library.chooseFolder(libraryCommandMeta(state.libraryRevision));
      if (!result) { set({ libraryScanning: false, libraryScanProgress: null }); return; }
      if (result.mutation.status === "conflict") {
        await get().hydrateLibrary();
        throw new Error(result.mutation.error?.message || "音乐库已在其他操作中更新，请重试");
      }
      refreshLibraryThumbnails(result.scan.tracks.flatMap(track => track.coverUrl ? [track.coverUrl] : []));
      const libraryTracks = mergeScannedLibrary(result.tracks as Array<Track & { metadataRead?: boolean }>, state.libraryTracks);
      set({ libraryTracks, libraryDerivedIndexCache: null, libraryFolders: result.folders, libraryRevision: result.revision, libraryScanning: false, libraryScanProgress: null,
        libraryError: libraryScanMessage(result.scan) });
    } catch (error) { set({ libraryScanning: false, libraryScanProgress: null, libraryError: error instanceof Error ? error.message : "目录扫描失败" }); }
    finally { stopProgress(); }
  },
  rescanLibrary: async () => {
    if (get().libraryScanning) return;
    const folders = sanitizeLibraryFolders(get().libraryFolders);
    if (!window.desktop || !folders.length) return;
    const meta = libraryCommandMeta(get().libraryRevision);
    set({ libraryScanRequestId: meta.requestId, libraryScanCancelling: false, libraryScanning: true, libraryError: "", libraryScanProgress: { phase: "discovering", completed: 0, total: 0, current: folders[0] } });
    const stopProgress = window.desktop.library.onScanProgress(libraryScanProgress => set({ libraryScanProgress }));
    try {
      const result = await window.desktop.library.rescan(folders, meta);
      if (!result) { set({ libraryScanning: false, libraryScanProgress: null, libraryError: "media.scanCancelled" }); return; }
      if (result.mutation.status === "conflict") {
        await get().hydrateLibrary();
        throw new Error(result.mutation.error?.message || "音乐库已在其他操作中更新，请重试");
      }
      refreshLibraryThumbnails(result.scan.tracks.flatMap(track => track.coverUrl ? [track.coverUrl] : []));
      const libraryTracks = mergeScannedLibrary(result.tracks as Array<Track & { metadataRead?: boolean }>, get().libraryTracks);
      set({ libraryTracks, libraryDerivedIndexCache: null, libraryFolders: result.folders, libraryRevision: result.revision, libraryScanning: false, libraryScanProgress: null,
        libraryError: libraryScanMessage(result.scan) });
    } catch (error) { set({ libraryScanning: false, libraryScanProgress: null, libraryError: error instanceof Error ? error.message : "重新扫描失败" }); }
    finally { stopProgress(); set({ libraryScanRequestId: "", libraryScanCancelling: false }); }
  },
  cancelLibraryScan: async () => {
    const requestId = get().libraryScanRequestId;
    if (!window.desktop || !requestId || get().libraryScanCancelling) return;
    set({ libraryScanCancelling: true });
    try {
      const result = await window.desktop.library.cancelScan(requestId);
      if (get().libraryScanRequestId === requestId && !result.ok) set({ libraryScanCancelling: false });
    } catch {
      if (get().libraryScanRequestId === requestId) set({ libraryScanCancelling: false, libraryError: "media.scanCancelFailed" });
    }
  },
  removeLibraryFolder: async (folder) => {
    if (!window.desktop || get().libraryScanning) return;
    set({ libraryScanning: true, libraryError: "" });
    try {
      const result = await window.desktop.library.removeFolder(folder, libraryCommandMeta(get().libraryRevision));
      await get().hydrateLibrary();
      if (result.status !== "committed") throw new Error(result.error?.message || "Library update failed");
    } catch (error) {
      set({ libraryError: error instanceof Error ? error.message : "Library update failed" });
    } finally { set({ libraryScanning: false }); }
  },
  playTrack: async (index, options) => {
    const requestGeneration = ++playTrackRequestGeneration;
    const track = get().tracks[index];
    pendingPlayTrackId = "";
    if (!track || isFolderLocked(track.sourcePath)) return;
    pendingPlayTrackId = track.id;
    set({ viewedQueueKind: get().queueKind });
    const requestIsCurrent = () => requestGeneration === playTrackRequestGeneration
      && get().tracks.some(item => item.id === track.id);
    // An automatic or Next request (it carries a skip budget) moves past an
    // entry that cannot be prepared, and stops when it cannot: the previous
    // track has ended, so "playing" would stay on without sound. A track the
    // user chose only reports the failure.
    const skipPastFailure = () => {
      const remaining = options?.skipMissing;
      // A chosen entry only reports: what was playing is still audible (the
      // current entry changes only once the new one is ready).
      if (remaining === undefined) return;
      const count = get().tracks.length;
      const next = remaining > 0 && count > 1 ? skipTargetIndex(index, count, get().repeat) : -1;
      pendingPlayTrackId = "";
      if (next >= 0) void get().playTrack(next, { ...options, skipMissing: Math.min(remaining, count) - 1 });
      else get().setPlaying(false);
    };
    try {
      if (get().onlineMedia?.playing) {
        // Direct playback has no native PCM source to release. Pause the page
        // before preparing local audio, preserving its position for later.
        const stopped = await window.desktop?.browser.mediaAction("pause");
        if (!requestIsCurrent()) return;
        if (!stopped?.ok) {
          set({ libraryError: stopped?.error || "无法暂停 YouTube，已取消本地播放" });
          return;
        }
        set(state => ({
          onlineMedia: state.onlineMedia ? { ...state.onlineMedia, playing: false } : null
        }));
      }
      if (track.sourcePath && !isVideoTrack(track) && !get().uiSettings.hdmiDirectEnabled) {
        if (WEB_DECODED_AUDIO_PATTERN.test(track.sourcePath)) set({ libraryError: "正在准备 HiFi 音源…" });
        let prepared = await window.desktop?.library.prepare(track.sourcePath);
        if (!requestIsCurrent()) return;
        if (prepared?.code === SOURCE_MISSING) {
          // The file moved (a tagging tool reorganised the folders, say): the
          // rescanned library knows where. The entry keeps its id, so the
          // queue position and the current index stay as they are.
          const moved = relocateMissingTrack(track, get().libraryTracks);
          if (moved?.sourcePath && !isFolderLocked(moved.sourcePath)) {
            prepared = await window.desktop?.library.prepare(moved.sourcePath);
            if (!requestIsCurrent()) return;
            if (prepared?.ok) set(state => ({ tracks: state.tracks.map(item => item.id === track.id ? { ...moved, id: track.id } : item) }));
          }
          if (!prepared?.ok) {
            set(state => ({
              tracks: state.tracks.map(item => item.id === track.id ? { ...item, missing: true } : item),
              libraryError: `${prepared?.error || "找不到音频文件。"}重新扫描所在文件夹后，可从媒体中心再次加入。`
            }));
            skipPastFailure();
            return;
          }
        }
        if (!prepared?.ok || !prepared.url) { set({ libraryError: prepared?.error || "HiFi 音源解码失败" }); skipPastFailure(); return; }
        const ready = prepared;
        set(state => {
          const tracks = state.tracks.map(item => item.id === track.id ? { ...item, url: ready.url!, nativePath: ready.path, missing: undefined } : item);
          return { tracks, libraryError: "" };
        });
      }
      if (!requestIsCurrent()) return;
      if (options?.navigateToNowPlaying !== false) get().setActivePage("nowPlaying");
      const position = get().tracks.findIndex(item => item.id === track.id);
      // An entry prepared in place keeps its request and position: its new
      // url makes App load the decoded file and seek to the position.
      if (!options?.keepPosition || position !== get().currentIndex) get().setCurrentIndex(position);
      playbackSkip = { request: get().localPlayRequest, remaining: options?.skipMissing ?? 0 };
      get().setPlaying(true);
    } catch (error) {
      if (requestIsCurrent()) { set({ libraryError: error instanceof Error ? error.message : "音频准备失败" }); skipPastFailure(); }
    } finally {
      if (requestGeneration === playTrackRequestGeneration) pendingPlayTrackId = "";
    }
  },
  cancelPendingPlay,
  hasPendingPlay: () => Boolean(pendingPlayTrackId),
  skipUnplayableTrack: () => {
    const state = get();
    // A paused entry (an automatic advance the user paused, say) reports the
    // failure only: moving on would start the next track against the pause.
    if (!state.playing) return false;
    const remaining = playbackSkip.request === state.localPlayRequest ? playbackSkip.remaining : 0;
    playbackSkip = { request: -1, remaining: 0 };
    const count = state.tracks.length;
    // The budget shrinks with every skip, so a queue of broken files stops.
    const next = remaining > 0 && count > 1 && state.currentIndex >= 0 ? skipTargetIndex(state.currentIndex, count, state.repeat) : -1;
    if (next < 0) {
      get().setPlaying(false);
      return false;
    }
    void get().playTrack(next, { navigateToNowPlaying: false, skipMissing: Math.min(remaining, count) - 1 });
    return true;
  },
  reloadCurrentTrack: () => set(state => state.tracks[state.currentIndex]
    ? { localPlayRequest: state.localPlayRequest + 1 } : state),
  enqueueLibraryTrack: async (id, playNow = false) => {
    const source = get().libraryTracks.find(track => track.id === id);
    if (!source || isFolderLocked(source.sourcePath)) return;
    acceptUserQueueEdit();
    if (playNow && isVideoTrack(source)) {
      // Playing an episode queues the rest of its season after it, in order,
      // so the next episode follows instead of an unrelated queued video.
      const run = followingEpisodes(source, get().libraryTracks).filter(track => !isFolderLocked(track.sourcePath));
      get().addQueueTracks(run);
      const ids = run.map(track => track.id);
      set(state => {
        if (state.queueKind !== "video") return { inactiveTracks: placeRun(state.inactiveTracks, ids) };
        const current = state.tracks[state.currentIndex];
        const tracks = placeRun(state.tracks, ids);
        return { tracks, currentIndex: current ? tracks.findIndex(track => track.id === current.id) : state.currentIndex };
      });
    } else get().addQueueTracks([source]);
    if (playNow) {
      get().switchQueue(isVideoTrack(source) ? "video" : "music");
      await get().playTrack(get().tracks.findIndex(track => track.id === source.id));
    }
  },
  enqueueLibraryTracks: ids => {
    acceptUserQueueEdit();
    const byId = new Map(get().libraryTracks.flatMap(track => [[track.id, track] as const, ...(track.mediaId ? [[track.mediaId, track] as const] : [])]));
    get().addQueueTracks(ids.map(id => byId.get(id)).filter((track): track is Track => Boolean(track)));
  },
  enqueueStreamTrack: async (track, playNow = true) => {
    acceptUserQueueEdit();
    get().addQueueTracks([track]);
    if (playNow) {
      get().switchQueue(isVideoTrack(track) ? "video" : "music");
      await get().playTrack(get().tracks.findIndex(item => item.id === track.id));
    }
  },
  enqueueStreamTracks: tracks => { acceptUserQueueEdit(); get().addQueueTracks(tracks); },
  toggleFavoriteTrack: (track) => {
    const key = favoriteTrackKey(track);
    if (!key) return;
    set(state => {
      const favorites = new Set(state.favoriteTrackKeys);
      if (favorites.has(key)) favorites.delete(key);
      else favorites.add(key);
      const favoriteTrackKeys = Array.from(favorites);
      localStorage.setItem(FAVORITES_V2_STORAGE_KEY, JSON.stringify(favoriteTrackKeys));
      return { favoriteTrackKeys };
    });
  },
  removeTrack: (id) =>
    set((state) => {
      acceptUserQueueEdit();
      if (pendingPlayTrackId === id) cancelPendingPlay();
      if (resumeTrackId === id) resumeTrackId = "";
      const queueBookmarks = withoutBookmarks(state.queueBookmarks, new Set([id]));
      const target = state.tracks.find((track) => track.id === id);
      if (!target) {
        const removed = state.inactiveTracks.find(track => track.id === id);
        if (!removed) return state;
        if (removed.url.startsWith("blob:")) URL.revokeObjectURL(removed.url);
        if (removed.coverUrl?.startsWith("blob:")) URL.revokeObjectURL(removed.coverUrl);
        return { inactiveTracks: state.inactiveTracks.filter(track => track.id !== id), queueBookmarks };
      }
      if (target) {
        URL.revokeObjectURL(target.url);
        if (target.coverUrl) URL.revokeObjectURL(target.coverUrl);
      }
      const index = state.tracks.findIndex((track) => track.id === id);
      const tracks = state.tracks.filter((track) => track.id !== id);
      let currentIndex = state.currentIndex;
      if (!tracks.length) currentIndex = -1;
      else if (index < currentIndex) currentIndex--;
      else if (currentIndex >= tracks.length) currentIndex = tracks.length - 1;
      if (index !== state.currentIndex) return { tracks, currentIndex, queueBookmarks, playing: tracks.length ? state.playing : false };
      // Removing the current entry moves to the one in its place like any track
      // change: from that entry's own start, as a new play request, and still
      // playing when it was playing.
      const next = tracks[currentIndex];
      return { tracks, currentIndex, queueBookmarks, currentTime: entryPosition(next, queueBookmarks), duration: 0,
        localPlayRequest: state.localPlayRequest + 1, queueSelection: { ...state.queueSelection, [state.queueKind]: next?.id },
        playing: tracks.length ? state.playing : false };
    }),
  clearTracks: () => set(state => {
    cancelPendingPlay();
    acceptUserQueueEdit();
    const cleared = new Set(state.tracks.map(track => track.id));
    if (cleared.has(resumeTrackId)) resumeTrackId = "";
    state.tracks.forEach(track => {
      if (track.url.startsWith("blob:")) URL.revokeObjectURL(track.url);
      if (track.coverUrl?.startsWith("blob:")) URL.revokeObjectURL(track.coverUrl);
    });
    return { tracks: [], currentIndex: -1, playing: false, currentTime: 0, duration: 0, localPlayRequest: state.localPlayRequest + 1,
      queueBookmarks: withoutBookmarks(state.queueBookmarks, cleared) };
  }),
  setCurrentIndex: currentIndex => set(state => {
    const old = state.tracks[state.currentIndex];
    const track = state.tracks[currentIndex];
    const queueSelection = { ...state.queueSelection, ...(track ? { [state.queueKind]: track.id } : {}) };
    // The entry a queue switch or restart positioned on its bookmark resumes there.
    const resume = Boolean(track && track.id === resumeTrackId);
    resumeTrackId = "";
    if (resume) return { currentIndex, queueSelection, localPlayRequest: state.localPlayRequest + 1 };
    let queueBookmarks = leavePosition(state.queueBookmarks, old, state.currentTime, state.duration);
    // Choosing the entry that is already current plays it again from the top.
    if (track && track.id === old?.id) queueBookmarks = withoutBookmarks(queueBookmarks, new Set([track.id]));
    return { currentIndex, queueBookmarks, currentTime: entryPosition(track, queueBookmarks), duration: 0, queueSelection,
      localPlayRequest: state.localPlayRequest + 1 };
  }),
  setPlaying: (playing) => {
    if (!playing) cancelPendingPlay();
    // Once playback starts, the restored position is in use; a later choice
    // of the same entry starts it again.
    else resumeTrackId = "";
    set({ playing });
  },
  // Media events describe the old source; they must not cancel an accepted
  // user selection that is still being decoded.
  setPlaybackObserved: (playing) => set({ playing }),
  setTiming: (currentTime, duration) => set({ currentTime, duration }),
  setVolume: (volume) => {
    persistVolume(volume);
    set({ volume });
  },
  setMuted: (muted) => set({ muted }),
  setShuffle: (shuffle) => set({ shuffle }),
  cycleRepeat: () => set((state) => ({ repeat: state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off" })),
  setVisualizer: (mode) => {
    const visualizer = normalizeVisualizerMode(mode);
    localStorage.setItem("auralis.visualizer", visualizer);
    localStorage.setItem("auralis.visualizer.layout-v2", "1");
    set({ visualizer });
  },
  setVisualSetting: (key, value) => set((state) => {
    if (!Object.prototype.hasOwnProperty.call(defaultVisualizerSettings, key)) return state;
    const nextValue = key === "decaySpeed" && typeof value === "number"
      ? Math.min(1, Math.max(.05, value))
      : value;
    const visualSettings = { ...state.visualSettings, [key]: nextValue };
    localStorage.setItem("auralis.visual.settings", JSON.stringify(visualSettings));
    return { visualSettings };
  }),
  resetVisualSettings: () => {
    localStorage.setItem("auralis.visual.settings", JSON.stringify(defaultVisualizerSettings));
    set({ visualSettings: { ...defaultVisualizerSettings } });
  },
  setActivePage: (activePage) => set({ activePage }),
  requestYoutubeVstLabGuide: () => set(state => ({
    activePage: "settings",
    youtubeVstLabGuideRequest: state.youtubeVstLabGuideRequest + 1
  })),
  requestNativeOutputForVst: () => {
    if (get().uiSettings.nativeOutputEnabled) return true;
    set(state => ({
      activePage: "devices",
      nativeOutputGuideRequest: state.nativeOutputGuideRequest + 1
    }));
    return false;
  },
  setAccent: (accent) => {
    localStorage.setItem("auralis.accent", accent);
    set({ accent });
  },
  setUiSetting: (key, value) => set((state) => {
    const stableValue = key === "youtubeVstLabEnabled" || key === "youtubeProcessLoopbackEnabled"
      ? false
      : key === "startupPage" ? normalizeStartupPage(value) : value;
    const uiSettings = { ...state.uiSettings, [key]: stableValue };
    localStorage.setItem("auralis.ui.settings", JSON.stringify(uiSettings));
    return { uiSettings };
  }),
  setObsMode: (obsMode) => set((state) => ({
    obsMode,
    activePage: obsMode ? "nowPlaying" : state.activePage
  })),
  setOnlineMedia: (onlineMedia) => set({ onlineMedia }),
  setFadeMs: (fadeMs) => {
    localStorage.setItem("auralis.fx.fadeMs", String(fadeMs));
    set({ fadeMs });
  }
}));

// Persist only durable local sources; never persist session blob URLs or streams.
let queueSaveTimer = 0;
const saveQueues = () => {
  const state = usePlayerStore.getState(), current = state.tracks[state.currentIndex];
  const tracks = [...state.tracks, ...state.inactiveTracks].filter(track => track.sourcePath);
  // Until the saved queue has been restored, an empty queue is only "not
  // loaded yet"; saving it (e.g. closing during startup) would replace it.
  // While it is loading, nothing queued meanwhile may replace it either.
  if (queueRestoreInFlight || queueRestoreFailed || (!queuesRestored && !tracks.length)) return;
  const queued = new Set(tracks.map(track => track.id));
  const bookmarks = { ...state.queueBookmarks, ...(current ? { [current.id]: state.duration > 0 && state.currentTime >= state.duration - .5 ? 0 : state.currentTime } : {}) };
  const snapshot: SavedQueueSnapshot = {
    kind: state.queueKind,
    tracks: tracks as unknown as SavedQueueSnapshot["tracks"],
    selection: { ...state.queueSelection, ...(current ? { [state.queueKind]: current.id } : {}) },
    // Only entries still queued; removed ones must not come back mid-song.
    bookmarks: Object.fromEntries(Object.entries(bookmarks).filter(([id]) => queued.has(id)))
  };
  try {
    if (window.desktop?.queue) window.desktop.queue.save(snapshot);
    else localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch { /* Storage failure must not interrupt playback. */ }
};
usePlayerStore.subscribe((state, previous) => {
  if (state.tracks !== previous.tracks || state.inactiveTracks !== previous.inactiveTracks || state.queueKind !== previous.queueKind) {
    window.clearTimeout(queueSaveTimer); queueSaveTimer = window.setTimeout(saveQueues, 400);
  } else if (Math.floor(state.currentTime / 5) !== Math.floor(previous.currentTime / 5)) saveQueues();
});
window.addEventListener("beforeunload", saveQueues);

import { loadFolderVisibility, isFolderLocked } from "./folderVisibilityStore";
import { create } from "zustand";
import { isVideoFile, isVideoTrack } from "../utils/videoTrack";
import { parseBlob } from "music-metadata";
import { mergeScannedLibrary, sanitizeLibraryFolders } from "../utils/libraryCoverMerge";
import { refreshLibraryThumbnails } from "../utils/libraryThumbnailRefresh";
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
  bloomThreshold: .68
};

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
  restoreQueues(): Promise<void>;
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
  playTrack: (index: number, options?: { navigateToNowPlaying?: boolean }) => Promise<void>;
  cancelPendingPlay: () => void;
  hasPendingPlay: () => boolean;
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
const cleanName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
const libraryCommandMeta = (expectedRevision: number): LibraryCommandMeta => ({
  requestId: typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  expectedRevision
});
const libraryScanMessage = (scan: LibraryScanCommitResponse["scan"]) => {
  const incompleteRoots = scan.roots.filter(root => root.status !== "complete");
  if (incompleteRoots.length) return `${incompleteRoots.length} 个音乐目录未完整扫描，旧曲目已安全保留`;
  const metadataFailures = scan.failures.filter(failure => failure.stage === "metadata").length;
  return metadataFailures ? `${metadataFailures} 个文件的标签未能完整读取，旧分类信息已尽量保留` : "";
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

const QUEUE_STORAGE_KEY = "astrelis.queues.v1";
let queuesRestored = false;

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
    set({ tracks, inactiveTracks: state.tracks, queueKind: kind, viewedQueueKind: kind, queueBookmarks, queueSelection,
      currentIndex, currentTime: queueBookmarks[tracks[currentIndex]?.id] || 0, duration: 0, playing: false,
      localPlayRequest: state.localPlayRequest + 1 });
  },
  addQueueTracks: incoming => set(state => {
    incoming = incoming.filter(track => !isFolderLocked(track.sourcePath));
    const merge = (existing: Track[], added: Track[]) => {
      const byId = new Map(added.map(track => [track.id, track]));
      return [...existing.map(track => byId.get(track.id) || track), ...[...byId.values()].filter(track => !existing.some(item => item.id === track.id))];
    };
    const active = incoming.filter(track => (isVideoTrack(track) ? "video" : "music") === state.queueKind);
    const inactive = incoming.filter(track => (isVideoTrack(track) ? "video" : "music") !== state.queueKind);
    const tracks = merge(state.tracks, active);
    return { tracks, inactiveTracks: merge(state.inactiveTracks, inactive), currentIndex: state.currentIndex < 0 && tracks.length ? 0 : state.currentIndex };
  }),
  restoreQueues: async () => {
    if (get().tracks.length || get().inactiveTracks.length || !window.desktop) { queuesRestored = true; return; }
    try {
      // Main-owned store first; localStorage is the pre-migration location
      // (the first save after restoring moves it into the main store).
      const saved = (await window.desktop.queue?.load().catch(() => null)) ?? JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "null");
      if (!saved || !Array.isArray(saved.tracks)) return;
      await loadFolderVisibility();
      const files = saved.tracks.filter((track: Track) => typeof track?.sourcePath === "string" && !isFolderLocked(track.sourcePath));
      const result = files.length ? await window.desktop.library.openFiles(files.map((track: Track) => track.sourcePath!)) : { tracks: [] };
      if (get().tracks.length || get().inactiveTracks.length) return;
      // Entries the main process skipped (no access grant, missing file) keep
      // their saved form: restoring must never shrink the persisted queue.
      const restored = files.flatMap((track: Track) => {
        const fresh = (result.tracks as Track[]).find(item => item.sourcePath === track.sourcePath);
        return fresh ? [{ ...fresh, id: track.id }] : [track];
      });
      const queueBookmarks = Object.fromEntries(Object.entries(saved.bookmarks || {}).filter(([,value]) => typeof value === "number" && Number.isFinite(value) && value >= 0)) as Record<string, number>;
      const kind = saved.kind === "video" ? "video" : "music";
      const tracks = restored.filter((track: Track) => (isVideoTrack(track) ? "video" : "music") === kind);
      const inactiveTracks = restored.filter((track: Track) => (isVideoTrack(track) ? "video" : "music") !== kind);
      const currentIndex = tracks.findIndex((track: Track) => track.id === saved.selection?.[kind]);
      set({ tracks, inactiveTracks, queueKind: kind, viewedQueueKind: kind, queueSelection: saved.selection || {}, queueBookmarks,
        currentIndex, currentTime: queueBookmarks[tracks[currentIndex]?.id] || 0 });
    } catch { /* Keep the saved queues intact if a source is unavailable. */ }
    finally { queuesRestored = true; }
  },
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
      await loadFolderVisibility();
      if (window.desktop) files = files.filter(file => !isFolderLocked(window.desktop!.getFilePath(file)));
      if (files.some(file => isVideoFile(file.name)) && window.desktop) {
        const paths = files.map(file => window.desktop!.getFilePath(file)).filter(Boolean);
        await get().openExternalFiles(paths);
        get().setActivePage("nowPlaying");
        return;
      }
      const audioFiles = files.filter((file) => /\.(mp3|wav|flac|aac|ogg|m4a|ape|dsf|aiff|aif|opus|wma|dts|ac3|eac3)$/i.test(file.name));
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
        if (/\.(ape|dsf)$/i.test(track.sourcePath)) set({ libraryError: "正在准备 HiFi 音源…" });
        const prepared = await window.desktop?.library.prepare(track.sourcePath);
        if (!requestIsCurrent()) return;
        if (!prepared?.ok || !prepared.url) { set({ libraryError: prepared?.error || "HiFi 音源解码失败" }); return; }
        set(state => {
          const tracks = state.tracks.map(item => item.id === track.id ? { ...item, url: prepared.url!, nativePath: prepared.path } : item);
          return { tracks, libraryError: "" };
        });
      }
      if (!requestIsCurrent()) return;
      if (options?.navigateToNowPlaying !== false) get().setActivePage("nowPlaying");
      get().setCurrentIndex(get().tracks.findIndex(item => item.id === track.id));
      get().setPlaying(true);
    } catch (error) {
      if (requestIsCurrent()) set({ libraryError: error instanceof Error ? error.message : "音频准备失败" });
    } finally {
      if (requestGeneration === playTrackRequestGeneration) pendingPlayTrackId = "";
    }
  },
  cancelPendingPlay,
  hasPendingPlay: () => Boolean(pendingPlayTrackId),
  enqueueLibraryTrack: async (id, playNow = false) => {
    const source = get().libraryTracks.find(track => track.id === id);
    if (!source || isFolderLocked(source.sourcePath)) return;
    get().addQueueTracks([source]);
    if (playNow) {
      get().switchQueue(isVideoTrack(source) ? "video" : "music");
      await get().playTrack(get().tracks.findIndex(track => track.id === source.id));
    }
  },
  enqueueLibraryTracks: ids => {
    const byId = new Map(get().libraryTracks.flatMap(track => [[track.id, track] as const, ...(track.mediaId ? [[track.mediaId, track] as const] : [])]));
    get().addQueueTracks(ids.map(id => byId.get(id)).filter((track): track is Track => Boolean(track)));
  },
  enqueueStreamTrack: async (track, playNow = true) => {
    get().addQueueTracks([track]);
    if (playNow) {
      get().switchQueue(isVideoTrack(track) ? "video" : "music");
      await get().playTrack(get().tracks.findIndex(item => item.id === track.id));
    }
  },
  enqueueStreamTracks: tracks => get().addQueueTracks(tracks),
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
      if (pendingPlayTrackId === id) cancelPendingPlay();
      const target = state.tracks.find((track) => track.id === id);
      if (!target) {
        const removed = state.inactiveTracks.find(track => track.id === id);
        if (!removed) return state;
        if (removed.url.startsWith("blob:")) URL.revokeObjectURL(removed.url);
        if (removed.coverUrl?.startsWith("blob:")) URL.revokeObjectURL(removed.coverUrl);
        return { inactiveTracks: state.inactiveTracks.filter(track => track.id !== id) };
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
      return { tracks, currentIndex, playing: tracks.length ? state.playing : false };
    }),
  clearTracks: () => set(state => {
    cancelPendingPlay();
    state.tracks.forEach(track => {
      if (track.url.startsWith("blob:")) URL.revokeObjectURL(track.url);
      if (track.coverUrl?.startsWith("blob:")) URL.revokeObjectURL(track.coverUrl);
    });
    return { tracks: [], currentIndex: -1, playing: false, currentTime: 0, duration: 0, localPlayRequest: state.localPlayRequest + 1 };
  }),
  setCurrentIndex: currentIndex => set(state => {
    const old = state.tracks[state.currentIndex];
    const track = state.tracks[currentIndex];
    const queueBookmarks = { ...state.queueBookmarks, ...(old ? { [old.id]: state.duration > 0 && state.currentTime >= state.duration - .5 ? 0 : state.currentTime } : {}) };
    return { currentIndex, queueBookmarks, currentTime: track ? queueBookmarks[track.id] || 0 : 0,
      queueSelection: { ...state.queueSelection, ...(track ? { [state.queueKind]: track.id } : {}) },
      localPlayRequest: state.localPlayRequest + 1 };
  }),
  setPlaying: (playing) => {
    if (!playing) cancelPendingPlay();
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
  if (!queuesRestored && !tracks.length) return;
  const snapshot: SavedQueueSnapshot = {
    kind: state.queueKind,
    tracks: tracks as unknown as SavedQueueSnapshot["tracks"],
    selection: { ...state.queueSelection, ...(current ? { [state.queueKind]: current.id } : {}) },
    bookmarks: { ...state.queueBookmarks, ...(current ? { [current.id]: state.duration > 0 && state.currentTime >= state.duration - .5 ? 0 : state.currentTime } : {}) }
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

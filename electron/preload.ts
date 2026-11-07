import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopPreferences } from "./desktopPreferences";

// Only payloads cross the bridge; renderer callbacks never receive IPC events.
function subscribe<T>(channel: string, listener: (payload: T) => void) {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("desktop", {
  video: {
    choose: () => ipcRenderer.invoke("video:choose"),
    open: (file: string, direct: boolean, token: string, rackPlugins?: { id: string; path: string; enabled: boolean }[] | null) => ipcRenderer.invoke("video:open", file, direct, token, rackPlugins),
    bounds: (bounds: { x: number; y: number; width: number; height: number; visible: boolean }) => ipcRenderer.send("video:bounds", bounds),
    state: () => ipcRenderer.invoke("video:state"),
    control: (action: string, value?: number | string) => ipcRenderer.invoke("video:control", action, value),
    subtitle: () => ipcRenderer.invoke("video:subtitle"),
    onInput: (listener: (input: unknown) => void) => subscribe("video:input", listener),
    onState: (listener: (state: unknown) => void) => subscribe("video:state", listener)
  },
  setDisplayLanguage: (language: string) => ipcRenderer.send("window:display-language", language),
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  setImmersive: (enabled: boolean) => ipcRenderer.send("window:immersive", enabled),
  beginResize: (edge: string) => ipcRenderer.send("window:resize-start", edge),
  resizeTo: () => ipcRenderer.send("window:resize-move"),
  endResize: () => ipcRenderer.send("window:resize-end"),
  close: () => ipcRenderer.send("window:close"),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.send("window:always-on-top", enabled),
  preferences: {
    get: () => ipcRenderer.invoke("desktop-preferences:get"),
    update: (patch: Partial<DesktopPreferences>) => ipcRenderer.invoke("desktop-preferences:update", patch),
    onChanged: (listener: (preferences: DesktopPreferences) => void) => subscribe("desktop-preferences:changed", listener)
  },
  setWindowGlass: (material: "acrylic" | "mica" | "none") => ipcRenderer.send("window:glass", material),
  setColorTheme: (theme: "dark" | "light" | "system") => ipcRenderer.send("window:theme", theme),
  setCompact: (enabled: boolean) => ipcRenderer.send("window:compact", enabled),
  setClickThrough: (enabled: boolean) => ipcRenderer.send("window:click-through", enabled),
  setClickThroughBypass: (bypassed: boolean) => ipcRenderer.send("window:click-through-bypass", bypassed),
  onClickThrough: (listener: (enabled: boolean) => void) => subscribe("window:click-through-state", listener),
  onMediaKey: (listener: (action: "toggle" | "previous" | "next" | "stop") => void) => subscribe("media-key", listener),
  onMaximized: (listener: (maximized: boolean) => void) => subscribe("window:maximized-state", listener),
  onPresentationState: (listener: (state: { minimized: boolean; trayConcealed: boolean }) => void) => subscribe("window:presentation-state", listener),
  confirmPluginRemoval: (name: string) => ipcRenderer.invoke("dialog:confirm-plugin-removal", name),
  appearance: {
    chooseBackground: () => ipcRenderer.invoke("appearance:background-choose"),
    chooseBackgroundFolder: () => ipcRenderer.invoke("appearance:background-folder"),
    removeBackground: () => ipcRenderer.invoke("appearance:background-remove")
  },
  getFilePath: (file: File) => {
    const filePath = webUtils.getPathForFile(file);
    if (filePath) ipcRenderer.send("library:authorize-dropped-file", filePath);
    return filePath;
  },
  externalOpen: {
    ready: () => ipcRenderer.invoke("external-open:ready"),
    report: (opened: number, playing: boolean) => ipcRenderer.send("external-open:result", opened, playing),
    onFiles: (listener: (paths: string[]) => void) => subscribe("external-open-files", listener)
  },
  cache: {
    inspect: () => ipcRenderer.invoke("cache:inspect"),
    clear: () => ipcRenderer.invoke("cache:clear"),
    protect: (files: string[]) => ipcRenderer.invoke("cache:protect", files)
  },
  library: {
    visibility: (request: Record<string, unknown>) => ipcRenderer.invoke("library:visibility", request),
    musicbrainz: (request: Record<string, unknown>) => ipcRenderer.invoke("library:musicbrainz", request),
    tmdb: (request: Record<string, unknown>) => ipcRenderer.invoke("library:tmdb", request),
    fileAction: (id: string, action: "remove" | "reveal") => ipcRenderer.invoke("library:file-action", id, action),
    artwork: (id: string, action: "choose" | "frame" | "lock" | "unlock") => ipcRenderer.invoke("library:artwork", id, action),
    prefetch: (filePath: string, direct: boolean) => ipcRenderer.invoke("library:prefetch", filePath, direct),
    removeFolder: (folder: string, meta: { requestId: string; expectedRevision?: number }) => ipcRenderer.invoke("library:remove-folder", folder, meta),
    load: () => ipcRenderer.invoke("library:load"),
    loadDerivedIndex: (revision: number) => ipcRenderer.invoke("library:derived-index-load", revision),
    saveDerivedIndex: (revision: number, snapshot: unknown) => ipcRenderer.invoke("library:derived-index-save", revision, snapshot),
    chooseFolder: (meta: { requestId: string; expectedRevision?: number }) => ipcRenderer.invoke("library:choose-folder", meta),
    cancelScan: (requestId: string) => ipcRenderer.invoke("library:cancel-scan", requestId),
    rescan: (folders: string[], meta: { requestId: string; expectedRevision?: number }) =>
      ipcRenderer.invoke("library:rescan", { folders, meta }),
    importLegacyState: (tracks: unknown[], folders: string[], meta: { requestId: string; expectedRevision?: number }) =>
      ipcRenderer.invoke("library:import-legacy-state", { tracks, folders, meta }),
    openFiles: (paths: string[]) => ipcRenderer.invoke("library:open-files", paths),
    prepare: (filePath: string) => ipcRenderer.invoke("library:prepare", filePath),
    prepareDirect: (filePath: string) => ipcRenderer.invoke("library:prepare-direct", filePath),
    waveform: (filePath: string, requestId?: string) => ipcRenderer.invoke("library:waveform", filePath, requestId),
    cancelWaveform: (filePath: string, requestId?: string) => ipcRenderer.send("library:waveform-cancel", filePath, requestId),
    onScanProgress: (listener: (progress: unknown) => void) => subscribe("library:scan-progress", listener)
  },
  nativeAudio: {
    command: (command: Record<string, unknown>) => ipcRenderer.invoke("native-audio:command", command),
    pushPcm: (packet: { sampleRate: number; channels: number; frames: number; pcm: ArrayBuffer }) =>
      ipcRenderer.send("native-audio:pcm-data", packet),
    onSafetyFallback: (listener: (event: Record<string, unknown>) => void) => subscribe("audio:safety-fallback", listener)
  },
  audioRoute: {
    claim: (source: "local" | "netease" | "youtube" | "web-direct", sessionId: string) => ipcRenderer.invoke("audio-route:claim", source, sessionId),
    release: (source: "local" | "netease" | "youtube" | "web-direct", sessionId: string) => ipcRenderer.invoke("audio-route:release", source, sessionId),
    status: () => ipcRenderer.invoke("audio-route:status")
  },
  netease: {
    search: (query: string) => ipcRenderer.invoke("netease:search", query),
    prepare: (id: number) => ipcRenderer.invoke("netease:prepare", id),
    loginStatus: () => ipcRenderer.invoke("netease:login-status"),
    logout: () => ipcRenderer.invoke("netease:logout"),
    playlists: () => ipcRenderer.invoke("netease:playlists"),
    playlistTracks: (id: number) => ipcRenderer.invoke("netease:playlist-tracks", id),
    createQr: () => ipcRenderer.invoke("netease:qr-create"),
    checkQr: (key: string) => ipcRenderer.invoke("netease:qr-check", key)
  },
  vst: {
    scan: (retryFailures = false) => ipcRenderer.invoke("vst:scan", retryFailures),
    controlScan: (action: "skip" | "disable", normalizedPath: string) => ipcRenderer.invoke("vst:scan-control", action, normalizedPath),
    resetQuarantine: (normalizedPath: string) => ipcRenderer.invoke("vst:quarantine-reset", normalizedPath),
    directories: () => ipcRenderer.invoke("vst:directories"),
    importDirectories: (directories: string[]) => ipcRenderer.invoke("vst:directory-import", directories),
    addDirectory: (directoryPath: string) => ipcRenderer.invoke("vst:directory-add", directoryPath),
    removeDirectory: (id: string) => ipcRenderer.invoke("vst:directory-remove", id),
    setDirectoryEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("vst:directory-enabled", id, enabled),
    chooseFolder: () => ipcRenderer.invoke("vst:choose-folder"),
    engineStatus: () => ipcRenderer.invoke("vst:engine-status"),
    openEditor: (pluginPath: string, pluginId: string) => ipcRenderer.invoke("vst:open-editor", pluginPath, pluginId),
    onScanProgress: (listener: (progress: unknown) => void) => subscribe("vst:scan-progress", listener)
  },
  browser: {
    show: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.send("browser:show", bounds),
    hide: () => ipcRenderer.send("browser:hide"),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.send("browser:bounds", bounds),
    navigate: (url: string) => ipcRenderer.send("browser:navigate", url),
    back: () => ipcRenderer.send("browser:back"),
    forward: () => ipcRenderer.send("browser:forward"),
    reload: () => ipcRenderer.send("browser:reload"),
    home: () => ipcRenderer.send("browser:home"),
    setVolume: (volume: number, muted: boolean) => ipcRenderer.send("browser:volume", volume, muted),
    setOutput: (label: string, useDefault: boolean) => ipcRenderer.invoke("browser:set-output", label, useDefault),
    getOutput: () => ipcRenderer.invoke("browser:get-output"),
    mediaAction: (action: "toggle" | "play" | "pause" | "stop" | "previous" | "next" | "seek" | "shuffle" | "repeat", value?: number) =>
      ipcRenderer.invoke("browser:media-action", action, value),
    fade: (target: number, durationMs: number, pauseAfter: boolean, fromZero: boolean, restoreVolume: number) =>
      ipcRenderer.invoke("browser:fade", target, durationMs, pauseAfter, fromZero, restoreVolume),
    setAnalysisConfig: (config: { enabled: boolean; fftSize: number; sampleRate: number }) =>
      ipcRenderer.send("browser:analysis-config", config),
    onState: (listener: (state: unknown) => void) => subscribe("browser:state", listener),
    onMedia: (listener: (state: unknown) => void) => subscribe("browser:media", listener),
    onAnalysis: (listener: (frame: unknown) => void) => subscribe("browser:analysis", listener),
    onAnalysisReset: (listener: () => void) => subscribe("browser:analysis-reset", listener),
    onPlayIntent: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("browser:play-intent", handler);
      return () => ipcRenderer.removeListener("browser:play-intent", handler);
    },
    onBoundsSync: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on("browser:sync-bounds", handler);
      return () => ipcRenderer.removeListener("browser:sync-bounds", handler);
    }
  }
});

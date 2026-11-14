import { fillsDisplay, fitWindowBounds, fittedUiZoom } from "./windowFit";
import { WindowStateMachine, type WindowSnapshot } from "./windowStateMachine";
import { FolderVisibility } from "./FolderVisibility";
import { restoreVisibleLibrary } from "./library/migration/RestoreVisibleLibrary";
import { VstStateProfiles } from "./vstStateProfiles";
import { VideoLibraryProbe } from "./library/media/VideoLibraryProbe";
import { AudioCacheMaintenance } from "./audioCacheMaintenance";
import { VideoPlayer, emptyVideoState, videoExtensions, validateVideoFile } from "./videoPlayer";
import { VideoPcmBridge } from "./videoPcmBridge";
import { VideoSurface } from "./videoSurface";
import { DipWindowResize } from "./windowGeometry";
import { onlineOutputSetupScript } from "./onlineMediaOutput";
import { installedDataPath } from "./installedDataPath";
import { matchingBrowserOutputDevice, type BrowserOutputDevice } from "./outputDeviceMatching";
import { applyNativeWindowOutline, setNativeAccentAcrylic, restoreNativeTransparency } from "./nativeWindowOutline";
import { onlineVolumeScript } from "./onlineVolume";
import { onlinePlayerTimelineScript, onlinePlayerSeekScript } from "./onlinePlayerTimeline";
import { app, BrowserWindow, safeStorage, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, protocol, screen, shell, Tray, WebContentsView, type IpcMainEvent, type WebContents } from "electron";
import { configureNeteaseSession } from "./neteaseApi";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { PcmDiagnostics } from "./pcmDiagnostics";
import { pluginFormatAdapterForPath } from "./pluginFormatAdapters";
import { writeNativeOutputState, type NativeOutputCandidate } from "./nativeOutputPersistence";
import { AudioRouteCoordinator, type AudioRouteSource } from "./audioRouteCoordinator";
import { LibraryService } from "./library/LibraryService";
import { WavCodecProbe } from "./library/media/WavCodecProbe";
import { DirectAudioCache } from "./library/media/DirectAudioCache";
import { JsonLibraryRepository } from "./library/repository/JsonLibraryRepository";
import { LibraryScanner } from "./library/scanner/LibraryScanner";
import { cacheArtworkThumbnail } from "./library/media/ArtworkCache";
import { DecodedAudioCache } from "./library/media/DecodedAudioCache";
import { LocalWaveformService } from "./library/media/LocalWaveformService";
import { LibraryMigrator } from "./library/migration/LibraryMigrator";
import { LibraryDerivedIndexCache } from "./library/derived/LibraryDerivedIndexCache";
import { parseAbsolutePath } from "./library/validation/LibraryIpcValidator";
import { LocalMediaAccessPolicy, safeExternalUrl, sameOriginNavigation } from "./security/ElectronSecurity";
import { AuthorizedFileStore } from "./security/AuthorizedFileStore";
import { DesktopMediaKeys, DesktopPreferenceService, defaultDesktopPreferences } from "./desktopPreferences";
import { AUDIO_EXTENSIONS, externalAudioPaths } from "./externalOpenPaths";
import { nativePluginHostPath } from "./pluginScanService";
import { registerNeteaseIpc } from "./ipc/neteaseIpc";
import { registerMediaMetadataIpc } from "./ipc/mediaMetadataIpc";
import { registerVstPluginIpc } from "./ipc/vstPluginIpc";
import { registerAudioCacheIpc } from "./ipc/audioCacheIpc";
import { registerLibraryIpc } from "./ipc/libraryIpc";
import { registerAppearanceIpc, customBackgroundDirectory } from "./ipc/appearanceIpc";
import { registerQueueIpc } from "./ipc/queueIpc";
import { QueueStore } from "./queue/QueueStore";
import { registerMediaProtocols } from "./mediaProtocols";
import {
  assertNativeHostCompatibility,
  configureNativePlaybackEngine,
  ensureNativeOutputRestored,
  pcmTransportStats,
  playbackEngineGate,
  resetNativeRuntimeAfterEngineLoss,
  resetPcmTransportStats,
  sendPlaybackCommand,
  sendPlaybackPcm,
  stopPlaybackEngine
} from "./nativePlaybackEngine";
import { mediaUrl } from "./mediaUrls";

const execFileAsync = promisify(execFile);
// TypeScript rewrites import() to require() in this CommonJS main process,
// while music-metadata v11 is ESM-only. Constructing the native importer keeps
// Node's ESM loader intact in the emitted Electron bundle.
const importMusicMetadata = new Function("return import('music-metadata')") as () => Promise<typeof import("music-metadata")>;
protocol.registerSchemesAsPrivileged([
  { scheme: "auralis-media", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: "auralis-netease", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

let localMediaAccess: LocalMediaAccessPolicy | undefined;
let authorizedFiles: AuthorizedFileStore | undefined;
let queueStore: QueueStore | undefined;

// The source-test build must not share Chromium caches or the single-instance
// lock with an installed production build that may still be running in tray.
if (app.isPackaged) {
  try {
    const profile = installedDataPath(process.execPath);
    app.setPath("userData", profile);
    app.setPath("sessionData", profile);
    app.setPath("logs", path.join(profile, "logs"));
    app.setPath("crashDumps", path.join(profile, "Crashpad"));
  } catch (error) {
    dialog.showErrorBox("ASTRELIS 用户数据目录不可用", String(error));
    app.exit(1);
    throw error;
  }
} else if (process.env.VITE_DEV_SERVER_URL) {
  app.setPath("userData", path.join(app.getPath("appData"), "Auralis Source Test"));
}

function findFfmpeg() {
  const bundled = path.join(process.resourcesPath, "ffmpeg", "ffmpeg.exe");
  if (app.isPackaged && fs.existsSync(bundled)) return bundled;
  const sourceBundled = path.join(app.getAppPath(), "ffmpeg", "ffmpeg.exe");
  if (fs.existsSync(sourceBundled)) return sourceBundled;
  const common = "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe";
  if (fs.existsSync(common)) return common;
  return "ffmpeg";
}

let mainWindow: BrowserWindow | null = null;
let localWaveformService: LocalWaveformService | undefined;
let pendingExternalOpenPaths = externalAudioPaths(process.argv);
let externalOpenTimer: NodeJS.Timeout | undefined;
let rendererAcceptsExternalFiles = false;
const windowResize = new DipWindowResize(() => mainWindow, () => screen.getCursorScreenPoint(),
  () => Boolean(mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()
    && !mainWindow.isMinimized() && immersiveActive && !compactActive && !clickThrough));
let onlineView: WebContentsView | null = null;

let clickThrough = false;
let compactPreviousTop = false;
let compactActive = false;
let trayConcealed = false;
let immersiveActive = false;
let onlineVolume = .72;
let onlineMuted = false;
let onlineOutputDeviceId = "default";
let onlineOutputLabel = "default";
let onlineAnalysisConfig = { enabled: true, fftSize: 2048, sampleRate: 48000 };
let tray: Tray | null = null;
let isQuitting = false;
const desktopMediaKeys = new DesktopMediaKeys(globalShortcut, action => mainWindow?.webContents.send("media-key", action));
const desktopPreferences = new DesktopPreferenceService(path.join(app.getPath("userData"), "desktop-preferences.json"), {
  setAlwaysOnTop(enabled) {
    if (compactActive) {
      compactPreviousTop = enabled;
      mainWindow?.setAlwaysOnTop(true);
    } else mainWindow?.setAlwaysOnTop(enabled);
  },
  setMediaKeysEnabled: enabled => desktopMediaKeys.setEnabled(enabled)
});
let nativeAudioActive = false;
let videoPlayer: VideoPlayer | undefined;

let videoSurface: VideoSurface | undefined;
let videoReserved = false;
let rendererPcmCaptureActive = false;
let pcmDiagnostics: PcmDiagnostics | null = null;
let onlineBoundsSyncTimer: NodeJS.Timeout | undefined;
let pluginStateFlushStarted = false;
let currentWindowGlass: "acrylic" | "mica" | "none" = "mica";
let nativeAudioCommandQueue: Promise<void> = Promise.resolve();
const audioRoutes = new AudioRouteCoordinator();
let nativeOutputGeneration = 0;
configureNativePlaybackEngine({
  writeLog,
  getPcmDiagnostics: () => pcmDiagnostics,
  onEngineLost: () => { nativeAudioActive = false; }
});


function flushExternalOpenPaths() {
  if (externalOpenTimer) clearTimeout(externalOpenTimer);
  externalOpenTimer = undefined;
  if (!rendererAcceptsExternalFiles || !mainWindow || mainWindow.isDestroyed() || !pendingExternalOpenPaths.length) return;
  const files = pendingExternalOpenPaths;
  pendingExternalOpenPaths = [];
  files.forEach(file => localMediaAccess?.authorizeFile(file));
  writeLog("INFO", `External open dispatched: ${files.length} audio file(s)`);
  mainWindow.webContents.send("external-open-files", files);
}

function queueExternalOpenPaths(files: string[]) {
  if (!files.length) return;
  const combined = new Map(pendingExternalOpenPaths.map(file => [file.toLocaleLowerCase(), file]));
  for (const file of files) combined.set(file.toLocaleLowerCase(), file);
  pendingExternalOpenPaths = [...combined.values()];
  if (mainWindow) showMainWindow();
  if (externalOpenTimer) clearTimeout(externalOpenTimer);
  // Explorer can start one secondary process per selected file. A short batch
  // window keeps that operation ordered and starts playback from the first one.
  externalOpenTimer = setTimeout(flushExternalOpenPaths, 120);
}

type ViewBounds = { x: number; y: number; width: number; height: number };
type WindowState = ViewBounds & { maximized: boolean };

function clampOnlineViewBounds(bounds: ViewBounds): ViewBounds | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const zoom=mainWindow.webContents.getZoomFactor();
  bounds={x:bounds?.x*zoom,y:bounds?.y*zoom,width:bounds?.width*zoom,height:bounds?.height*zoom};
  const x = Math.max(0, Math.min(contentWidth - 1, Math.round(Number(bounds?.x) || 0)));
  const y = Math.max(0, Math.min(contentHeight - 1, Math.round(Number(bounds?.y) || 0)));
  const width = Math.max(1, Math.min(contentWidth - x, Math.round(Number(bounds?.width) || 1)));
  const height = Math.max(1, Math.min(contentHeight - y, Math.round(Number(bounds?.height) || 1)));
  return { x, y, width, height };
}

function scheduleOnlineBoundsResync() {
  // WebContentsView is not clipped by the React element that visually owns it.
  // Hide it while Windows is resizing, then ask the renderer for a fresh DOM
  // rectangle after Chromium has completed the responsive layout pass.
  onlineView?.setVisible(false);
  if (onlineBoundsSyncTimer) clearTimeout(onlineBoundsSyncTimer);
  onlineBoundsSyncTimer = setTimeout(() => {
    onlineBoundsSyncTimer = undefined;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("browser:sync-bounds");
  }, 90);
}

function writeLog(level: string, message: string) {
  try {
    const directory = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, "auralis.log"), `${new Date().toISOString()} [${level}] ${message}\n`);
  } catch { /* Logging must never crash the player. */ }
}

function currentOnlineWindowState() {
  const windowAvailable = Boolean(mainWindow && !mainWindow.isDestroyed());
  const onlineViewAvailable = Boolean(onlineView && !onlineView.webContents.isDestroyed());
  return {
    windowAvailable,
    visible: windowAvailable ? mainWindow!.isVisible() : false,
    minimized: windowAvailable ? mainWindow!.isMinimized() : false,
    maximized: windowAvailable ? mainWindow!.isMaximized() : false,
    focused: windowAvailable ? mainWindow!.isFocused() : false,
    mainRendererPid: windowAvailable ? mainWindow!.webContents.getOSProcessId() : 0,
    onlineViewAvailable,
    onlineRendererPid: onlineViewAvailable ? onlineView!.webContents.getOSProcessId() : 0,
    stdinBackpressured: pcmTransportStats().backpressured,
    trayActive: Boolean(tray && !tray.isDestroyed())
  };
}

function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

let vstProfiles: VstStateProfiles | undefined;
function getVstProfiles() { return vstProfiles ??= new VstStateProfiles(path.join(app.getPath("userData"), "vst-states")); }
function vstStateDirectory() { return getVstProfiles().directory(); }
async function switchVstProfile(profile: "music" | "video") {
  const engine = playbackEngineGate?.current();
  await getVstProfiles().switchTo(profile, Boolean(engine && !engine.killed), sendPlaybackCommand);
}

function vstStateFileForPlugin(pluginId: string) {
  // Keep this in sync with PlaybackEngine::stableStateHash. The filename is
  // derived from the JUCE format identifier, so user/plugin text never enters
  // the filesystem path directly.
  const offset = 1469598103934665603n;
  const prime = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  let hash = offset;
  for (const byte of Buffer.from(pluginId, "utf8")) hash = ((hash ^ BigInt(byte)) * prime) & mask;
  return path.join(vstStateDirectory(), `${hash.toString(16).padStart(16, "0")}.vststate`);
}

function libraryIndexPath() {
  return path.join(app.getPath("userData"), "music-library.json");
}

function loadWindowState(): WindowState {
  const fallback = { x: 80, y: 60, width: 1500, height: 940, maximized: false };
  if (!desktopPreferences.get().preferences.rememberWindowState) return fallback;
  try {
    const stored = JSON.parse(fs.readFileSync(windowStatePath(), "utf8")) as Partial<WindowState>;
    const candidate = { ...fallback, ...stored };
    const visible = screen.getAllDisplays().some(({ workArea }) =>
      candidate.x < workArea.x + workArea.width - 80 &&
      candidate.x + candidate.width > workArea.x + 80 &&
      candidate.y < workArea.y + workArea.height - 60 &&
      candidate.y + candidate.height > workArea.y + 60
    );
    return visible ? candidate : fallback;
  } catch {
    return fallback;
  }
}

// Floating, maximized, fullscreen, HTML fullscreen, compact, immersive and tray
// geometry for the main window: what to remember and what to restore.
const windowState = new WindowStateMachine();

function windowSnapshot(window: BrowserWindow): WindowSnapshot {
  const bounds = window.getBounds();
  return {
    bounds, normalBounds: window.getNormalBounds(), display: screen.getDisplayMatching(bounds),
    minimized: window.isMinimized(), maximized: window.isMaximized(), fullScreen: window.isFullScreen(),
    concealed: trayConcealed, compact: compactActive, immersive: immersiveActive
  };
}

/** Maximize, or restore to real floating bounds (titlebar button and caption double-click). */
function toggleMaximize(window: BrowserWindow) {
  if (!window.isMaximized()) { window.maximize(); return; }
  const restore = windowState.restoreBounds(windowSnapshot(window));
  window.unmaximize();
  // unmaximize() resized to the overwritten rectangle and the window still fills the screen.
  if (window.isMaximized()) window.setBounds(restore, false);
}

function emitBrowserState() {
  if (!mainWindow || !onlineView || onlineView.webContents.isDestroyed()) return;
  const contents = onlineView.webContents;

  mainWindow.webContents.send("browser:state", {
    url: contents.getURL(),
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward()
  });
}

async function applyOnlineOutputSelection(contents: WebContents, label: string, useDefault: boolean, explicit: boolean) {
  const browserDevices = useDefault ? [] : await contents.executeJavaScript(`
    (async () => {
      return (await navigator.mediaDevices.enumerateDevices())
        .filter(device => device.kind === 'audiooutput')
        .map(device => ({ deviceId: device.deviceId, label: device.label }));
    })()
  `) as BrowserOutputDevice[];
  const target = useDefault ? "default" : matchingBrowserOutputDevice(browserDevices, label)?.deviceId;
  if (!target) return { ok:false, error:"YouTube 未找到匹配的输出设备，请检查设备连接或改用系统默认" };
  const result = await contents.executeJavaScript(onlineOutputSetupScript(target, explicit));
  if (result?.ok) {
    onlineOutputDeviceId = target;
    onlineOutputLabel = useDefault ? "default" : label;
  }
  return result;
}

function ensureOnlineView() {
  if (!mainWindow) return null;
  if (onlineView && !onlineView.webContents.isDestroyed()) return onlineView;
  onlineView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "online-preload.js"),
      partition: "persist:auralis-online",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  });
  onlineView.webContents.setBackgroundThrottling(false);
  onlineView.setBackgroundColor("#080d10");
  mainWindow.contentView.addChildView(onlineView);
  const contents = onlineView.webContents;
  contents.setZoomFactor(mainWindow.webContents.getZoomFactor());
  // Direct playback keeps the site security policy and audio graph intact.
  contents.setWindowOpenHandler(({ url }) => {
    if (safeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("did-start-loading", emitBrowserState);
  contents.on("did-stop-loading", emitBrowserState);
  contents.on("did-navigate", emitBrowserState);
  contents.on("did-navigate-in-page", emitBrowserState);
  contents.on("page-title-updated", emitBrowserState);
  contents.on("render-process-gone", (_event, details) =>
    writeLog("AUDIO", `YouTube renderer exited: ${details.reason} (${details.exitCode})`));
  contents.on("did-finish-load", () => {
    if(mainWindow&&!mainWindow.isDestroyed())contents.setZoomFactor(mainWindow.webContents.getZoomFactor());
    void applyOnlineOutputSelection(contents, onlineOutputLabel, onlineOutputLabel === "default", false).catch(() => undefined);
    void contents.executeJavaScript(onlineVolumeScript(onlineVolume, onlineMuted)).catch(() => undefined);
    writeLog("AUDIO", `Render owner discovery: mainRendererPid=${mainWindow?.webContents.getOSProcessId() || 0}; onlineRendererPid=${contents.getOSProcessId()}; url=${contents.getURL()}`);
    void contents.executeJavaScript(onlinePlayerTimelineScript()).catch(() => undefined);
    contents.send("online:analysis-config", onlineAnalysisConfig);
  });
  void contents.loadURL("https://music.youtube.com/");
  return onlineView;
}

// Keep Canvas/WebAudio rendering active while OBS covers or backgrounds the window.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
// On Windows, Chromium's native occlusion tracker may demote a renderer that
// is completely covered by another maximized window. The YouTube PCM bridge
// must keep AudioWorklet and page-to-main packet delivery at foreground cadence.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
if (hasSingleInstanceLock) {
  app.on("second-instance", (_event, argv, workingDirectory) => {
    queueExternalOpenPaths(externalAudioPaths(argv, workingDirectory));
    showMainWindow();
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    queueExternalOpenPaths(externalAudioPaths([filePath]));
  });
}
process.on("uncaughtException", (error) => writeLog("ERROR", error.stack || error.message));
process.on("unhandledRejection", (reason) => writeLog("REJECTION", String(reason)));

let windowFitTimer: NodeJS.Timeout | undefined;
let preferredNormalSize: {width:number;height:number} | undefined;
function syncWindowFit(clamp = false, restoreSize = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const work = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
  if (!compactActive && !immersiveActive) {
    mainWindow.setMinimumSize(Math.min(640,work.width),Math.min(400,work.height));
    if(clamp && !mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      const bounds=mainWindow.getBounds(),fit=fitWindowBounds(restoreSize && preferredNormalSize ? {...bounds,...preferredNormalSize} : bounds,work);
      if(Object.keys(fit).some(key=>fit[key as keyof typeof fit]!==bounds[key as keyof typeof fit]))mainWindow.setBounds(fit,false);
    }
  }
  if(windowFitTimer)clearTimeout(windowFitTimer);
  const target=mainWindow;
  // Chromium can overwrite a zoom applied inside the native resize event.
  // Apply after its viewport resize, including when the reported zoom is unchanged.
  windowFitTimer=setTimeout(()=>{
    windowFitTimer=undefined;
    if(target!==mainWindow||target.isDestroyed())return;
    const [width,height]=target.getContentSize();
    const zoom=fittedUiZoom(width,height,compactActive||immersiveActive);
    target.webContents.setZoomFactor(zoom);
    if(onlineView&&!onlineView.webContents.isDestroyed())onlineView.webContents.setZoomFactor(zoom);
    scheduleOnlineBoundsResync();
  },80);
}

function createWindow() {
  const saved = loadWindowState();
  preferredNormalSize={width:saved.width,height:saved.height};
  const workArea = screen.getDisplayMatching(saved).workArea;
  Object.assign(saved,fitWindowBounds(saved,workArea));
  rendererAcceptsExternalFiles = false;
  mainWindow = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: Math.min(640,workArea.width),
    minHeight: Math.min(400,workArea.height),
    frame: false,
    // Avoid the Windows non-client strip above our custom titlebar.
    thickFrame: false,
    hasShadow: false,
    transparent: true,
    roundedCorners: false,
    alwaysOnTop: desktopPreferences.get().preferences.alwaysOnTop,
    backgroundColor: "#00000000",
    icon: resolveAppIconPath() || undefined,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  // Chromium's caption double-click reaches this transparent HWND as
  // WM_SYSCOMMAND / (SC_MAXIMIZE | HTCAPTION), not WM_NCLBUTTONDBLCLK.
  // Windows cannot maximize a thickFrame:false transparent window itself;
  // route only that caption gesture through Electron's transparent-window API.
  const hookedWindow = mainWindow;
  mainWindow.hookWindowMessage(0x0112, wParam => {
    if (wParam.length < 4 || wParam.readUInt32LE(0) !== 0xF032) return;
    setImmediate(() => {
      if (mainWindow !== hookedWindow || hookedWindow.isDestroyed() || compactActive) return;
      toggleMaximize(hookedWindow);
    });
  });

  // A cancelled pointer gesture must never survive focus, mode or renderer changes.
  mainWindow.on("blur", () => windowResize.end());
  mainWindow.on("minimize", () => windowResize.end());
  mainWindow.on("close", () => windowResize.end());
  mainWindow.on("closed", () => windowResize.end());
  mainWindow.webContents.on("did-start-loading", () => windowResize.end());
  mainWindow.webContents.on("render-process-gone", () => windowResize.end());
  refreshWindowOutline();
  // DWM rounds the floating window; a screen-filling window must be square.
  const syncWindowOutline = () => {
    try { refreshWindowOutline(); }
    catch (error) { writeLog("WINDOW", `Window outline update failed: ${error instanceof Error ? error.message : String(error)}`); }
  };
  mainWindow.on("enter-full-screen", syncWindowOutline);
  mainWindow.on("leave-full-screen", syncWindowOutline);
  mainWindow.on("restore", syncWindowOutline);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const productionUrl = pathToFileURL(path.join(__dirname, "../dist/index.html")).toString();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (safeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = devUrl ? sameOriginNavigation(url, devUrl) : url === productionUrl;
    if (allowed) return;
    event.preventDefault();
    if (safeExternalUrl(url)) void shell.openExternal(url);
  });
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  windowState.reset(windowSnapshot(mainWindow));
  windowState.observe(windowSnapshot(mainWindow));
  if (saved.maximized) mainWindow.maximize();
  let saveTimer: NodeJS.Timeout | undefined;
  const saveWindowState = () => {
    if (!mainWindow) return;
    if (trayConcealed) return;
    if (saveTimer) clearTimeout(saveTimer);
    if (!desktopPreferences.get().preferences.rememberWindowState) return;
    saveTimer = setTimeout(() => {
      if (!mainWindow || !desktopPreferences.get().preferences.rememberWindowState) return;
      fs.writeFileSync(windowStatePath(), JSON.stringify(windowState.persisted(windowSnapshot(mainWindow))));
    }, 180);
  };
  const refreshMaximizedAppearance = (maximized: boolean) => {
    mainWindow?.webContents.send("window:maximized-state", maximized);
    setWindowGlass(currentWindowGlass);
  };
  // Electron fires no maximize/unmaximize event when the emulated state changes
  // through setBounds (restoring overwritten bounds, a manual resize or snap),
  // and HTML fullscreen (library preview) reports neither state, so the
  // square/rounded contour and the titlebar icon follow the real size.
  const observeWindow = () => {
    if (!mainWindow) return;
    const { filling, changed } = windowState.observe(windowSnapshot(mainWindow));
    if (!changed) return;
    syncWindowOutline();
    refreshMaximizedAppearance(filling);
  };
  const maximizedChanged = (maximized: boolean) => {
    windowResize.end();
    syncWindowOutline();
    saveWindowState();
    refreshMaximizedAppearance(maximized);
    scheduleOnlineBoundsResync();
    if (mainWindow) windowState.observe(windowSnapshot(mainWindow));
  };
  mainWindow.on("maximize", () => maximizedChanged(true));
  mainWindow.on("unmaximize", () => maximizedChanged(false));
  mainWindow.on("resize", () => {
    observeWindow();
    syncWindowFit();
    saveWindowState();
    scheduleOnlineBoundsResync();
  });
  let activeDisplay=screen.getDisplayMatching(mainWindow.getBounds()).id;
  mainWindow.on("move", () => {
    if(!mainWindow)return;
    const id=screen.getDisplayMatching(mainWindow.getBounds()).id;
    const changed=id!==activeDisplay;activeDisplay=id;
    // Crossing a monitor boundary happens during the drag. Clamping here
    // moves the HWND beneath the cursor and makes it stick to the new edge.
    // Only display topology changes (below) are allowed to reposition it.
    if (changed) syncWindowFit();
    observeWindow();
    saveWindowState();
  });
  const displayChanged = () => syncWindowFit(true,true);
  screen.on("display-metrics-changed",displayChanged);
  screen.on("display-removed",displayChanged);
  mainWindow.on("closed",()=>{
    if(windowFitTimer)clearTimeout(windowFitTimer);
    windowFitTimer=undefined;
    screen.removeListener("display-metrics-changed",displayChanged);
    screen.removeListener("display-removed",displayChanged);
  });
  const emitPresentationState = () => mainWindow?.webContents.send("window:presentation-state", {
    minimized: Boolean(mainWindow?.isMinimized()),
    trayConcealed
  });
  mainWindow.on("minimize", emitPresentationState);
  mainWindow.on("restore", emitPresentationState);
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (desktopPreferences.get().preferences.closeBehavior === "quit") {
      setImmediate(() => app.quit());
      return;
    }
    if (!mainWindow || trayConcealed) return;
    // BrowserWindow.hide() demotes the child YouTube WebContentsView on
    // Windows even with backgroundThrottling disabled. Conceal the UI while
    // keeping the renderer logically visible so tab-capture audio stays at
    // realtime cadence in tray mode.
    trayConcealed = true;
    emitPresentationState();
    mainWindow.setIgnoreMouseEvents(true);
    mainWindow.setFocusable(false);
    mainWindow.setSkipTaskbar(true);
    mainWindow.setOpacity(0);
    mainWindow.blur();
  });
  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow) return;
    // Fit the whole interface in DIP space, without applying Windows DPI twice.
    syncWindowFit(true);
    mainWindow.webContents.send("window:maximized-state", windowState.fillsScreen);
    emitPresentationState();
    setWindowGlass(currentWindowGlass);
  });
  mainWindow.webContents.on("did-start-loading", () => { rendererAcceptsExternalFiles = false; });
  mainWindow.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    if (!mainWindow || !desktopPreferences.get().preferences.rememberWindowState) return;
    fs.writeFileSync(windowStatePath(), JSON.stringify(windowState.persisted(windowSnapshot(mainWindow))));
  });
}

function showMainWindow() {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (trayConcealed) {
    mainWindow.setOpacity(1);
    mainWindow.setSkipTaskbar(false);
    mainWindow.setFocusable(true);
    mainWindow.setIgnoreMouseEvents(false);
    trayConcealed = false;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("window:presentation-state", { minimized: false, trayConcealed: false });
}

function resolveAppIconPath() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "tray-icon.png"), path.join(process.resourcesPath, "build", "icon.png")]
    : [path.join(__dirname, "../build/icon.png"), path.join(app.getAppPath(), "build", "icon.png")];
  return candidates.find(candidate => fs.existsSync(candidate)) || "";
}

let displayLanguage = "en-US";
let installNameUpdate: Promise<void> = Promise.resolve();
let lastInstallLanguage = "";
function updateInstallDisplayName(language: string) {
  if (!app.isPackaged || process.platform !== "win32" || lastInstallLanguage === language) return;
  lastInstallLanguage = language;
  installNameUpdate = installNameUpdate.then(async () => {
    try {
      await promisify(execFile)(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(process.resourcesPath, "localize-install.ps1"), "-Executable", process.execPath, "-Language", language],
        { windowsHide: true, timeout: 15000 });
    } catch (error) {
      lastInstallLanguage = "";
      writeLog("WINDOW", "Install display-name update failed: " + String(error));
    }
  });
}
const displayName = () => displayLanguage === "zh-CN" ? "星律" : displayLanguage === "ja-JP" ? "アストレリス" : "ASTRELIS";
function refreshDisplayName() {
  mainWindow?.setTitle(displayName());
  if (!tray) return;
  tray.setToolTip(displayName());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: (displayLanguage === "zh-CN" ? "显示 " : displayLanguage === "ja-JP" ? "表示 " : "Show ") + displayName(), click: showMainWindow },
    { type: "separator" },
    { label: displayLanguage === "zh-CN" ? "完全退出" : displayLanguage === "ja-JP" ? "終了" : "Quit", click: () => { isQuitting = true; app.quit(); } }
  ]));
}
async function createTray() {
  if (tray) return;
  try {
    const iconPath = resolveAppIconPath();
    let trayIcon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    if (trayIcon.isEmpty()) {
      writeLog("INFO", `Tray icon asset unavailable at ${iconPath || "all configured paths"}; using executable icon fallback`);
      trayIcon = await app.getFileIcon(process.execPath, { size: "small" });
    }
    if (trayIcon.isEmpty()) throw new Error("TRAY_ICON_UNAVAILABLE");
    tray = new Tray(trayIcon.resize({ width: 32, height: 32, quality: "best" }));
    refreshDisplayName();
    tray.on("click", showMainWindow);
    tray.on("double-click", showMainWindow);
    writeLog("INFO", `Tray ready: ${iconPath || "executable fallback"}`);
  } catch (error) {
    tray = null;
    writeLog("ERROR", `Tray creation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function mainWindowHandle() {
  if (!mainWindow) return 0;
  const handle = mainWindow.getNativeWindowHandle();
  return Number(handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0)));
}

function setClickThrough(enabled: boolean) {
  windowResize.end();
  clickThrough = enabled;
  mainWindow?.setIgnoreMouseEvents(enabled, { forward: true });
  mainWindow?.webContents.send("window:click-through-state", enabled);
}

function refreshWindowOutline() {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== "win32") return;
  mainWindow.setHasShadow(false);
  const bounds = mainWindow.getBounds();
  applyNativeWindowOutline(mainWindow, fillsDisplay(bounds, screen.getDisplayMatching(bounds)));
}

function setWindowGlass(material: "acrylic" | "mica" | "none") {
  currentWindowGlass = material;
  if (!mainWindow || process.platform !== "win32") return;
  try {
    refreshWindowOutline();
    if (material === "acrylic") {
      // Desktop Acrylic has a known black flash on maximized frameless
      // Electron windows. Use Win32 Accent Acrylic for this option instead.
      mainWindow.setBackgroundMaterial("none");
      setNativeAccentAcrylic(mainWindow, true);
    } else {
      setNativeAccentAcrylic(mainWindow, false);
      mainWindow.setBackgroundMaterial(material);
      if (material === "none") restoreNativeTransparency(mainWindow);
    }
  } catch {
    writeLog("WINDOW", "Native Acrylic is unavailable; using CSS glass fallback");
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  const desktopPreferencesStartup = desktopPreferences.initialize();
  if (!desktopPreferencesStartup.ok) writeLog("SETTINGS", desktopPreferencesStartup.error || "Desktop preferences unavailable");
  localMediaAccess = new LocalMediaAccessPolicy();
  localMediaAccess.registerApplicationDirectory(path.join(app.getPath("userData"), "artwork-cache"));
  localMediaAccess.registerApplicationDirectory(path.join(app.getPath("userData"), "decoded-audio"));
  localMediaAccess.registerApplicationDirectory(customBackgroundDirectory());
  // Restore explicit file grants before the renderer restores its saved queue,
  // so queued files outside library roots stay readable across restarts.
  const grantedMediaPolicy = localMediaAccess;
  authorizedFiles = new AuthorizedFileStore(path.join(app.getPath("userData"), "authorized-files-v1.json"));
  const restorableGrants = authorizedFiles.load().filter(file =>
    AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()) || videoExtensions.includes(path.extname(file).slice(1).toLowerCase()));
  restorableGrants.forEach(file => grantedMediaPolicy.authorizeFile(file));
  // Keep grants for files that are missing right now (e.g. a USB drive that
  // is not plugged in yet); authorizeFile re-validates them on each launch.
  authorizedFiles.reset(restorableGrants);
  grantedMediaPolicy.onFileAuthorized = file => authorizedFiles?.record(file);
  pcmDiagnostics = new PcmDiagnostics(message => writeLog("AUDIO", message), currentOnlineWindowState);
  pcmDiagnostics.start();
  configureNeteaseSession(path.join(app.getPath("userData"), "netease-session.json"));
  const folderVisibility = new FolderVisibility(path.join(app.getPath("userData"), "folder-visibility.bin"),
    text => { if (!safeStorage.isEncryptionAvailable()) throw Error("系统密码保护不可用"); return safeStorage.encryptString(text); }, bytes => safeStorage.decryptString(bytes));
  localMediaAccess.blocked = file => folderVisibility.blocked(file);
  let visibilityQueue: Promise<unknown> = Promise.resolve();
  ipcMain.handle("library:visibility", (event, request: Record<string, unknown>) => {
    if (!trustedCacheRequest(event)) return {ok:false,error:"UNTRUSTED_SENDER"};
    const operation = visibilityQueue.catch(() => undefined).then(async () => {
      try {
        switch (request?.action) {
          case "status": break;
          case "hide": {
            const folder = parseAbsolutePath(request.folder, "folder");
            if (!localMediaAccess?.isAllowed(folder) && !folderVisibility.blocked(folder)) throw Error("请先扫描该文件夹");
            await folderVisibility.hide(folder, request.password); break;
          }
          case "hide-file": {
            const snapshot = await libraryService.getSnapshot();
            const track = (snapshot.snapshot?.tracks as Array<Record<string, unknown>> | undefined)?.find(item => item.id === request.id);
            const file = track && typeof track.sourcePath === "string" ? track.sourcePath : "";
            if (!file || !localMediaAccess?.isAllowed(file)) throw Error("文件不存在于可访问的媒体库");
            await folderVisibility.hide(file, request.password); break;
          }
          case "unlock": await folderVisibility.unlock(request.password); break;
          case "lock": folderVisibility.lock(); break;
          case "unhide": folderVisibility.unhide(parseAbsolutePath(request.folder,"folder")); break;
          case "change": await folderVisibility.change(request.password,request.nextPassword); break;
          default: throw Error("未知操作");
        }
        return {ok:true,...folderVisibility.status()};
      } catch (error) { return {ok:false,error:error instanceof Error ? error.message : String(error)}; }
    });
    visibilityQueue = operation; return operation;
  });
  const libraryStorageDirectory = path.join(app.getPath("userData"), "library-v2");
  const libraryDerivedIndexCache = new LibraryDerivedIndexCache(libraryStorageDirectory);
  const libraryRepository = new JsonLibraryRepository({
    storageDirectory: libraryStorageDirectory,
    legacyPath: libraryIndexPath(),
    retentionCount: 5,
    failpoint(point) {
      if (process.env.AURALIS_LIBRARY_FAILPOINT === "AFTER_TMP_WRITE" && point === "after-temp-sync") {
        throw new Error("Simulated library migration interruption at AFTER_TMP_WRITE");
      }
    }
  });
  const libraryMigrator = new LibraryMigrator(libraryRepository, {
    storageDirectory: libraryStorageDirectory,
    legacyPath: libraryIndexPath()
  });
  const libraryService = new LibraryService(
    libraryRepository,
    event => writeLog("LIBRARY", JSON.stringify(event)),
    undefined,
    libraryMigrator
  );
  // Register the persisted library folders at startup. Until now they were
  // registered only by the renderer's library:load, so anything that ran
  // earlier (queue restore, media protocol, waveform) saw library files as
  // unauthorised.
  const libraryRootsReady: Promise<void> = libraryService.getSnapshot()
    .then(result => { (result.snapshot?.folders || []).forEach(folder => localMediaAccess?.registerRoot(folder)); })
    .catch(error => writeLog("LIBRARY", `Startup root registration failed: ${error instanceof Error ? error.message : String(error)}`));
  const videoLibraryProbe = new VideoLibraryProbe(findFfmpeg(), path.join(app.getPath("userData"), "artwork-cache"), mediaUrl);
  const libraryScanner = new LibraryScanner({
    videoExtensions: new Set(videoExtensions.map(ext => "." + ext)),
    probeVideo: file => videoLibraryProbe.probe(file),
    ensureCoverThumbnail: async coverUrl => {
      const parsed = (() => { try { return new URL(coverUrl); } catch { return undefined; } })();
      if (!parsed) return;
      if (parsed.protocol !== "auralis-media:" || parsed.hostname !== "local" || parsed.search || parsed.hash) return;
      const coverPath = decodeURIComponent(parsed.pathname.slice(1));
      if (path.isAbsolute(coverPath) && fs.existsSync(coverPath)) await cacheArtworkThumbnail(coverPath);
    },
    artworkDirectory: path.join(app.getPath("userData"), "artwork-cache"),
    mediaUrl,
    metadataLoader: importMusicMetadata,
    probeRawAudio: async sourcePath => {
      const { stderr } = await execFileAsync(findFfmpeg(), ["-hide_banner", "-nostdin", "-i", sourcePath,
        "-map", "0:a:0", "-c:a", "copy", "-frames:a", "1", "-f", "null", "-"],
      { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
      if (!/Stream #0:\d+.*Audio:\s*(dts|ac3|eac3)\b/i.test(stderr)) throw new Error("未识别到有效的 DTS/Dolby 音频流");
      const time = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      return { duration: time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : undefined };
    },
    audioExtensions: AUDIO_EXTENSIONS,
    directoryConcurrency: 8,
    metadataConcurrency: 8
  });
  try {
    await restoreVisibleLibrary(app.getPath("userData"), bytes => safeStorage.decryptString(bytes), libraryService, libraryScanner);
  } catch (error) {
    writeLog("LIBRARY", "Legacy visibility recovery: " + String(error));
    dialog.showErrorBox("媒体记录恢复未完成", "原文件和旧记录已保留，可重新扫描原目录恢复显示。\n" + String(error));
  }
  const audioCache = new AudioCacheMaintenance(app.getPath("userData"));
  let directGeneration = 0;
  const decodedAudioCache = new DecodedAudioCache(path.join(app.getPath("userData"), "decoded-audio"),
    (sourcePath, outputPath) => execFileAsync(findFfmpeg(), ["-v", "error", "-nostdin", "-y", "-i", sourcePath,
      "-map", "0:a:0", "-threads", "1", "-c:a", "pcm_f32le", "-rf64", "auto", "-f", "wav", outputPath],
    { windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }));
  const wavCodecProbe = new WavCodecProbe(async sourcePath => {
    const result = await execFileAsync(findFfmpeg(), ["-hide_banner", "-nostdin", "-i", sourcePath,
      "-map", "0:a:0", "-c:a", "copy", "-frames:a", "1", "-f", "null", "-"],
      { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
    return result.stderr;
  });
  const directAudioCache = new DirectAudioCache(path.join(app.getPath("userData"), "direct-audio"), async args => {
    try {
      const result = await execFileAsync(findFfmpeg(), args, { windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
      return result.stderr;
    } catch (error) {
      const failure = error as Error & { code?: string | number; signal?: string; stderr?: string };
      const details = String(failure.stderr || failure.message || error).slice(-12000);
      writeLog("AUDIO", `HDMI_PREPARATION_FAILED ${JSON.stringify({ code: failure.code, signal: failure.signal, args, details })}`);
      throw new Error(`HDMI_PREPARATION_FAILED: 音频准备失败（${failure.code ?? failure.signal ?? "unknown"}），请查看 auralis.log 中的详细原因。`);
    }
  });
  const authorisedAudio = (input: unknown) => {
    const source = parseAbsolutePath(input, "audio source");
    if (!AUDIO_EXTENSIONS.has(path.extname(source).toLowerCase()) || !localMediaAccess?.isAllowed(source))
      throw new Error("音源未授权 / Audio source is not authorised");
    return source;
  };
  const prepareLocalSource = async (source: string) => {
    const extension = path.extname(source).toLowerCase();
    const dtsWav = extension === ".wav" && await wavCodecProbe.isDts(source);
    if (!dtsWav && ![".ape", ".dsf", ".wma", ".dts", ".ac3", ".eac3"].includes(extension)) return source;
    return decodedAudioCache.prepare(source);
  };
  const prepareHdmiSource = async (source: string) => {
    const direct = await directAudioCache.prepare(source);
    const analysisPath = direct.codec.startsWith("pcm") ? undefined : await decodedAudioCache.cached(source);
    return { ...direct, analysisPath };
  };
  const trustedCacheRequest = (event: Electron.IpcMainInvokeEvent) => event.sender === mainWindow?.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame;
  let videoDetached = false, videoReturning = false;
  let videoRackAudio = false, videoRackFile = "", videoRackAudioIndex = 0;
  let videoRackPluginIds = new Set<string>();
  let videoRackKnownIds = new Set<string>();
  let videoClockCorrecting = false;
  let videoRackLastPaused = true, videoRackLastPosition = 0, videoRackLastLevel = -1, videoRackTransition = false;
  let videoPcm: VideoPcmBridge | undefined;
  let videoPcmQueue: Promise<unknown> = Promise.resolve();
  const enqueueVideoPcm = <T>(task: () => Promise<T>) => {
    const next = videoPcmQueue.catch(() => undefined).then(task);
    videoPcmQueue = next.catch(() => undefined);
    return next;
  };
  const startVideoPcm = async (position: number) => {
    if (!videoPcm || !videoPlayer?.state.ready) throw new Error("VIDEO_PCM_NOT_READY");
    const state = videoPlayer.state;
    if (!state.tracks.some(track => track.type === "audio")) throw new Error("VIDEO_PCM_NO_AUDIO_TRACK");
    await videoPcm.start(videoRackFile, videoRackAudioIndex, Math.max(0, position), state.muted ? 0 : state.volume / 100);
  };
  const resyncVideoPcm = (position: number) => enqueueVideoPcm(async () => {
    if (!videoRackAudio || !videoPcm || !videoPlayer?.state.active) return;
    videoRackTransition = true;
    try {
      const wasPlaying = !videoPlayer.state.paused;
      if (wasPlaying) await videoPlayer.control("pause");
      await videoPcm.stop();
      if (wasPlaying) { await startVideoPcm(position); await videoPlayer.control("play"); }
      videoRackLastPaused = !wasPlaying;
      videoRackLastPosition = position;
    } finally { videoRackTransition = false; }
  });
  let videoWindowQueue: Promise<unknown> = Promise.resolve();
  const switchVideoWindow = (detached: boolean, language = "zh-CN") => {
    const task = videoWindowQueue.catch(()=>undefined).then(async()=>{
      try {
        // An explicit seek may still be priming PCM while detach is requested.
        // Observe the final playback state only after that lane has settled.
        if (videoRackAudio) await enqueueVideoPcm(async () => undefined);
        const resumeRack = videoRackAudio && videoPlayer!.state.ready && !videoPlayer!.state.paused;
        const resumePosition = videoPlayer!.state.position;
        writeLog("VIDEO", `rehost ${detached ? "standalone" : "embedded"}: ready=${videoPlayer!.state.ready} paused=${videoPlayer!.state.paused} pcm=${videoPcm?.running} resume=${resumeRack}`);
        if (videoRackAudio) {
          videoRackTransition = true;
          const bridge = videoPcm;
          if (bridge) await enqueueVideoPcm(() => bridge.stop());
        }
        await videoPlayer!.rehost(detached,language);
        if (resumeRack) {
          await enqueueVideoPcm(() => startVideoPcm(resumePosition));
          await videoPlayer!.control("play");
          const deadline = Date.now() + 2000;
          while (videoPlayer!.state.paused && Date.now() < deadline)
            await new Promise(resolve => setTimeout(resolve, 20));
          if (videoPlayer!.state.paused) throw new Error("VIDEO_REHOST_RESUME_FAILED");
        }
        videoRackLastPaused = !resumeRack;
        videoRackLastPosition = resumePosition;
        videoRackTransition = false;
        if (videoRackAudio && mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("video:state", videoPlayer!.state);
        videoDetached=detached;
        if (detached) { videoSurface?.hide();mainWindow?.hide(); }
        else { mainWindow?.show();mainWindow?.focus(); }
      } catch(error) { videoRackTransition=false;videoDetached=false;mainWindow?.show();throw error; }
    });
    videoWindowQueue=task;return task;
  };
  videoPlayer = new VideoPlayer(
    path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "video-engine", "mpv.exe"),
    path.join(app.getPath("userData"), "logs", "video-player.log"),
    state => {
      if (state.standalone && (state.returnRequested || (!state.active && videoDetached)) && !videoReturning && !isQuitting) {
        videoReturning=true;
        void switchVideoWindow(false).catch(error=>writeLog("VIDEO",String(error))).finally(()=>{videoReturning=false;});
        return;
      }
      if (!state.active) {
        videoSurface?.hide();
        if (videoPcm) {
          const bridge = videoPcm; videoPcm = undefined; videoRackAudio = false; videoRackPluginIds.clear(); videoRackKnownIds.clear();
          void enqueueVideoPcm(() => bridge.stop()).finally(() => { videoReserved = false; });
        } else videoReserved = false;
      } else if (videoRackAudio && state.ready && !videoRackTransition) {
        const selected = state.tracks.filter(track => track.type === "audio").findIndex(track => track.selected);
        const trackChanged = selected >= 0 && selected !== videoRackAudioIndex;
        const pauseChanged = state.paused !== videoRackLastPaused;
        const jumped = !videoClockCorrecting && !state.paused && Math.abs(state.position - videoRackLastPosition) > 3 && videoRackLastPosition > 0;
        if (trackChanged) videoRackAudioIndex = selected;
        videoRackLastPaused = state.paused;
        if (state.paused && pauseChanged) {
          const bridge = videoPcm;
          if (bridge) void enqueueVideoPcm(() => bridge.stop()).catch(error => writeLog("VIDEO", String(error)));
        }
        else if (!state.paused && (trackChanged || jumped || (pauseChanged && !videoPcm?.running)))
          void resyncVideoPcm(state.position).catch(error => {
            writeLog("VIDEO", String(error)); videoPlayer?.reportError(String(error));
            void videoPlayer?.control("pause").catch(() => undefined);
          });
        videoRackLastPosition = state.position;
        const level = state.muted ? 0 : state.volume / 100;
        if (videoPcm?.running && level !== videoRackLastLevel) {
          videoRackLastLevel = level;
          void videoPcm.setVolume(level).catch(error => writeLog("VIDEO", String(error)));
        }
      }
      if (mainWindow && !mainWindow.isDestroyed() && !(videoRackAudio && videoRackTransition))
        mainWindow.webContents.send("video:state", state);
    }, path.join(app.getPath("userData"), "video-dsp.json"));
  ipcMain.handle("video:choose", async event => {
    if (!trustedCacheRequest(event)) return { ok: false, error: "UNTRUSTED_SENDER" };
    const picked = await dialog.showOpenDialog(mainWindow!, { properties: ["openFile"], filters: [{ name: "Video", extensions: videoExtensions }] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: true, canceled: true };
    try {
      const file = validateVideoFile(picked.filePaths[0]);
      localMediaAccess?.authorizeFile(file);
      return { ok: true, path: file };
    } catch (error) { return { ok: false, error: String(error) }; }
  });
  videoPlayer.onInput = input => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("video:input", input);
  };
  ipcMain.handle("video:state", event => trustedCacheRequest(event) ? videoPlayer?.state : emptyVideoState());
  ipcMain.handle("video:open", async (event, file: unknown, direct: unknown, playbackToken: unknown, rackPlugins: unknown) => {
    if (!trustedCacheRequest(event)) return { ok: false, error: "UNTRUSTED_SENDER" };
    if (videoReserved) return { ok: false, error: "VIDEO_ALREADY_ACTIVE" };
    if (typeof file !== "string" || (!localMediaAccess?.isAllowed(file)) || typeof direct !== "boolean" || typeof playbackToken !== "string") return { ok: false, error: "VIDEO_FILE_NOT_AUTHORIZED" };
    const requestedRack = rackPlugins !== null && rackPlugins !== undefined;
    if (requestedRack && (direct || !Array.isArray(rackPlugins) || rackPlugins.length > 32 || rackPlugins.some(plugin =>
      !plugin || typeof plugin.id !== "string" || typeof plugin.path !== "string" || !path.isAbsolute(plugin.path) || typeof plugin.enabled !== "boolean")))
      return { ok: false, error: "VIDEO_RACK_INVALID" };
    videoReserved = true;
    ++directGeneration; // Invalidate an outstanding music analysis decode before retiring its host.
    try {
      // Drain earlier native work; prevent later requests from reopening WASAPI.
      await nativeAudioCommandQueue.catch(() => undefined);
      if (requestedRack) {
        await ensureNativeOutputRestored();
        await sendPlaybackCommand({ type: "pause" });
        await switchVstProfile("video");
        const loaded = await sendPlaybackCommand({ type: "rack", plugins: rackPlugins, stateDirectory: vstStateDirectory() }) as { ok?: boolean; error?: string };
        if (!loaded.ok) throw new Error(loaded.error || "VIDEO_RACK_LOAD_FAILED");
        videoRackPluginIds = new Set((rackPlugins as { id: string; enabled: boolean }[]).filter(plugin => plugin.enabled).map(plugin => plugin.id));
        videoRackKnownIds = new Set((rackPlugins as { id: string }[]).map(plugin => plugin.id));
        videoRackAudio = true; videoRackFile = validateVideoFile(file);
        videoRackAudioIndex = 0; videoRackLastPaused = true; videoRackLastPosition = 0; videoRackLastLevel = -1;
        videoPcm = new VideoPcmBridge(
          findFfmpeg(),
          async command => await sendPlaybackCommand(command) as { ok?: boolean; error?: string },
          packet => sendPlaybackPcm(packet),
          error => { writeLog("VIDEO", String(error)); videoPlayer?.reportError(error.message); void videoPlayer?.control("pause"); },
          clock => {
            if (videoRackTransition || videoClockCorrecting || !videoPlayer || videoPlayer.state.paused) return;
            videoClockCorrecting = true;
            void videoPlayer.synchronizeAudioClock(clock).catch(error => writeLog("VIDEO_CLOCK", String(error)))
              .finally(() => { videoRackLastPosition = videoPlayer?.state.position || 0; videoClockCorrecting = false; });
          }
        );
      } else {
        const engine = playbackEngineGate?.current();
        if (engine && !engine.killed) {
          const saved = await sendPlaybackCommand({ type: "state-save", stateDirectory: vstStateDirectory(), closeEditors: true }) as { ok?: boolean; error?: string };
          if (!saved.ok) throw new Error(saved.error || "VST_STATE_SAVE_FAILED");
          await stopPlaybackEngine(engine);
          playbackEngineGate?.clearIfCurrent(engine);
          resetNativeRuntimeAfterEngineLoss();
        }
      }
      rendererPcmCaptureActive = false;
      videoSurface ??= new VideoSurface(mainWindow!);
      await videoPlayer!.open(file, direct, videoSurface.attach(), playbackToken, false, "zh-CN", requestedRack);
      {
        const deadline = Date.now() + 10000;
        while (!videoPlayer!.state.ready || (requestedRack && !videoPlayer!.state.tracks.some(track => track.type === "audio"))) {
          if (!videoPlayer!.state.active || videoPlayer!.state.error || Date.now() > deadline)
            throw new Error(videoPlayer!.state.error || (requestedRack ? "VIDEO_PCM_AUDIO_TRACK_UNAVAILABLE" : "VIDEO_PREPARE_TIMEOUT"));
          await new Promise(resolve => setTimeout(resolve, 40));
        }
      }
      return { ok: true };
    } catch (error) {
      if (videoPcm) { await videoPcm.stop().catch(() => undefined); videoPcm = undefined; }
      videoRackAudio = false; videoRackPluginIds.clear(); videoRackKnownIds.clear();
      await videoPlayer?.close().catch(() => undefined);
      videoReserved = false;
      writeLog("VIDEO", String(error));
      return { ok: false, error: String(error) };
    }
  });
  ipcMain.on("video:bounds", (event, bounds: unknown) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return;
    try { if (videoDetached) return; videoSurface ??= new VideoSurface(mainWindow); videoSurface.set(bounds); }
    catch (error) { writeLog("VIDEO", String(error)); }
  });
  ipcMain.handle("video:control", async (event, action: unknown, value: unknown) => {
    if (!trustedCacheRequest(event)) return { ok: false, error: "UNTRUSTED_SENDER" };
    try {
      if (action === "detach") {
        if (!["zh-CN","en-US","ja-JP"].includes(String(value))) throw new Error("VIDEO_VALUE_INVALID");
        await switchVideoWindow(true,String(value));
      } else if (action === "return") await switchVideoWindow(false);
      else if (action === "close") {
        await videoWindowQueue.catch(()=>undefined);
        const wasDetached=videoDetached;videoDetached=false;
        const bridge = videoPcm;
        if (bridge) await enqueueVideoPcm(() => bridge.stop());
        videoPcm = undefined; videoRackAudio = false; videoRackPluginIds.clear(); videoRackKnownIds.clear();
        await videoPlayer?.close();
        if (wasDetached) mainWindow?.show();
      } else if (action === "editor") {
        if (!videoRackAudio || !videoPlayer?.state.active || !videoPlayer.state.ready || videoPlayer.state.standalone)
          throw new Error("VIDEO_RACK_EDITOR_UNAVAILABLE");
        if (typeof value !== "string" || !videoRackPluginIds.has(value)) throw new Error("PLUGIN_NOT_IN_LIVE_CHAIN");
        await enqueueVideoPcm(async () => {
          if (!videoRackAudio || !videoPcm || !videoRackPluginIds.has(value)) throw new Error("VIDEO_RACK_EDITOR_UNAVAILABLE");
          const result = await videoPcm.withStatusPaused(() => sendPlaybackCommand({ type: "editor", id: value, owner: mainWindowHandle() })) as { ok?: boolean; error?: string };
          if (!result.ok) throw new Error(result.error || "VIDEO_RACK_EDITOR_FAILED");
        });
      } else if (action === "rack") {
        if (!videoRackAudio || !videoPlayer?.state.active || !videoPlayer.state.ready || videoPlayer.state.standalone)
          throw new Error("VIDEO_RACK_UNAVAILABLE");
        if (typeof value !== "string" || value.length > 131072) throw new Error("VIDEO_RACK_INVALID");
        const request: unknown = JSON.parse(value);
        if (!request || typeof request !== "object") throw new Error("VIDEO_RACK_INVALID");
        const { plugins, removedId } = request as { plugins?: unknown; removedId?: unknown };
        if (!Array.isArray(plugins) || plugins.length > 32 || plugins.some(plugin =>
          !plugin || typeof plugin.id !== "string" || !plugin.id || plugin.id.length > 4096 ||
          typeof plugin.path !== "string" || !path.isAbsolute(plugin.path) || typeof plugin.enabled !== "boolean") ||
          new Set(plugins.map(plugin => plugin.id)).size !== plugins.length ||
          (removedId !== undefined && (typeof removedId !== "string" || !videoRackKnownIds.has(removedId) || plugins.some(plugin => plugin.id === removedId))))
          throw new Error("VIDEO_RACK_INVALID");
        await enqueueVideoPcm(async () => {
          if (!videoRackAudio || !videoPlayer?.state.active || !videoPlayer.state.ready) throw new Error("VIDEO_RACK_UNAVAILABLE");
          if (!videoPcm) throw new Error("VIDEO_RACK_UNAVAILABLE");
          const result = await videoPcm.withStatusPaused(() => sendPlaybackCommand({ type: "rack", plugins, stateDirectory: vstStateDirectory() })) as { ok?: boolean; error?: string };
          if (!result.ok) throw new Error(result.error || "VIDEO_RACK_UPDATE_FAILED");
          videoRackPluginIds = new Set(plugins.filter(plugin => plugin.enabled).map(plugin => plugin.id));
          videoRackKnownIds = new Set(plugins.map(plugin => plugin.id));
          if (typeof removedId === "string") fs.rmSync(vstStateFileForPlugin(removedId), { force: true });
        });
      } else if (videoRackAudio && ["play", "pause", "toggle", "seek", "audio", "volume"].includes(String(action))) {
        await enqueueVideoPcm(async () => {
          const player = videoPlayer!;
          const resume = action === "play" || (action === "toggle" && (player.state.paused || player.state.ended));
          const suspend = action === "pause" || (action === "toggle" && !resume);
          videoRackTransition = true;
          try {
            if (resume) {
              if (!player.state.paused && videoPcm?.running) return;
              const position = player.state.ended ? 0 : player.state.position;
              await startVideoPcm(position);
              await player.control("play");
              videoRackLastPaused = false; videoRackLastPosition = position;
            } else if (suspend) {
              await player.control("pause"); await videoPcm?.stop();
              videoRackLastPaused = true;
            } else if (action === "seek" || action === "audio") {
              const wasPlaying = !player.state.paused;
              if (wasPlaying) await player.control("pause");
              await videoPcm?.stop();
              await player.control(action, value);
              if (action === "audio") videoRackAudioIndex = player.state.tracks.filter(track => track.type === "audio").findIndex(track => track.id === value);
              const position = action === "seek" ? Math.max(0, Math.min(player.state.duration, Number(value))) : player.state.position;
              videoRackLastPosition = position;
              if (wasPlaying) { await startVideoPcm(position); await player.control("play"); }
              videoRackLastPaused = !wasPlaying;
            } else if (action === "volume") {
              const level = player.state.muted ? 0 : Number(value) / 100;
              videoRackLastLevel = level;
              await player.control("volume", value);
              if (videoPcm?.running) await videoPcm.setVolume(level);
            }
          } catch (error) {
            await videoPcm?.stop().catch(() => undefined);
            await player.control("pause").catch(() => undefined);
            throw error;
          } finally { videoRackTransition = false; }
        });
      } else await videoPlayer?.control(action, value);
      return { ok: true };
    } catch (error) { return { ok: false, error: String(error) }; }
  });
  ipcMain.handle("video:subtitle", async event => {
    if (!trustedCacheRequest(event) || !videoPlayer?.state.ready) return { ok: false, error: "VIDEO_NOT_READY" };
    const picked = await dialog.showOpenDialog(mainWindow!, { properties: ["openFile"], filters: [{ name: "Subtitles", extensions: ["srt", "ass", "ssa", "vtt", "sub"] }] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: true, canceled: true };
    try { await videoPlayer.addSubtitle(picked.filePaths[0]); return { ok: true }; }
    catch (error) { return { ok: false, error: String(error) }; }
  });
  registerAudioCacheIpc({
    audioCache, decodedAudioCache, trustedCacheRequest, authorisedAudio, prepareLocalSource, prepareHdmiSource
  });
  localWaveformService = new LocalWaveformService({
    executable: findFfmpeg,
    duration: async sourcePath => {
      const metadata = await importMusicMetadata();
      return (await metadata.parseFile(sourcePath, { duration: false, skipCovers: true })).format.duration;
    }
  });
  registerMediaProtocols({ localMediaAccess, writeLog });
  writeLog("INFO", `ASTRELIS ${app.getVersion()} started`);
  globalShortcut.register("CommandOrControl+Shift+L", () => setClickThrough(!clickThrough));
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => { if (mainWindow) toggleMaximize(mainWindow); });
  ipcMain.on("window:immersive", (_, enabled: boolean) => {
    windowResize.end();
    if (!mainWindow) return;
    if (enabled && !immersiveActive) {
      windowState.enterMode("immersive", windowSnapshot(mainWindow));
      immersiveActive = true;
      mainWindow.setMinimumSize(640, 360);
      syncWindowFit();
      return;
    }
    if (!enabled && immersiveActive) {
      immersiveActive = false;
      mainWindow.setMinimumSize(640, 400);
      const restore = windowState.leaveMode("immersive");
      if (!mainWindow.isMaximized() && restore) mainWindow.setBounds(restore, true);
      syncWindowFit(true);
    }
  });
  const trustedWindowSender = (event: IpcMainEvent) => Boolean(mainWindow
    && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame);
  ipcMain.on("window:resize-start", (event, edge: string) => {
    if (trustedWindowSender(event)) windowResize.begin(edge);
  });
  ipcMain.on("window:resize-move", event => {
    if (trustedWindowSender(event)) {
      windowResize.update();
      if(mainWindow&&!compactActive&&!immersiveActive&&!mainWindow.isMaximized()) {
        const {width,height}=mainWindow.getBounds();preferredNormalSize={width,height};
      }
    }
  });
  ipcMain.on("window:resize-end", event => {
    if (trustedWindowSender(event)) windowResize.end();
  });
  ipcMain.on("window:close", () => mainWindow?.close());
  const trustedPreferencesSender = (event: Electron.IpcMainInvokeEvent | IpcMainEvent) => Boolean(
    mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame
  );
  const publishDesktopPreferences = () => {
    mainWindow?.webContents.send("desktop-preferences:changed", desktopPreferences.get().preferences);
  };
  ipcMain.handle("desktop-preferences:get", event => trustedPreferencesSender(event)
    ? desktopPreferences.get()
    : { ok: false, preferences: { ...defaultDesktopPreferences }, error: "不允许访问桌面设置" });
  ipcMain.handle("desktop-preferences:update", (event, patch: unknown) => {
    if (!trustedPreferencesSender(event))
      return { ok: false, preferences: { ...defaultDesktopPreferences }, error: "不允许更改桌面设置" };
    const result = desktopPreferences.update(patch);
    publishDesktopPreferences();
    return result;
  });
  ipcMain.on("window:always-on-top", (event, enabled: unknown) => {
    if (!trustedPreferencesSender(event)) return;
    const result = desktopPreferences.update({ alwaysOnTop: enabled });
    if (!result.ok) writeLog("SETTINGS", result.error || "Always-on-top update failed");
    publishDesktopPreferences();
  });
  ipcMain.handle("external-open:ready", event => {
    if (event.sender === mainWindow?.webContents) {
      rendererAcceptsExternalFiles = true;
      flushExternalOpenPaths();
    }
    return { ok: true };
  });
  ipcMain.on("external-open:result", (_, opened: number, playing: boolean) => {
    writeLog("INFO", `External open completed: ${Math.max(0, Number(opened) || 0)} audio file(s), playing=${Boolean(playing)}`);
  });
  const trustedOnlineIpcSender = (event: IpcMainEvent) => {
    if (event.sender !== onlineView?.webContents) return false;
    const senderFrame = event.senderFrame;
    if (!senderFrame) return false;
    try { return new URL(senderFrame.url).origin === "https://music.youtube.com"; }
    catch { return false; }
  };
  let lastOnlineTrackSignature = "";
  let lastOnlinePosition = 0;
  ipcMain.on("online:media-state", (event, media: Record<string, unknown>) => {
    if (!trustedOnlineIpcSender(event) || !mainWindow || !media || typeof media !== "object") return;
    const signature = JSON.stringify([media.title, media.artist, media.mediaIndex]);
    const position = Number(media.currentTime) || 0;
    if (signature !== lastOnlineTrackSignature || Math.abs(position - lastOnlinePosition) > 2) {
      writeLog("AUDIO", `YouTube timeline boundary; position=${position}; previous=${lastOnlinePosition}; duration=${Number(media.duration) || 0}; element=${Number(media.mediaIndex)} / ${Number(media.mediaCount)}; readyState=${Number(media.readyState) || 0}; playerTimeline=${media.timelineSource === "youtube-player"}; rawPosition=${Number(media.rawPosition) || 0}`);
    }
    lastOnlineTrackSignature = signature;
    lastOnlinePosition = position;
    if (["seeking", "seeked", "waiting", "stalled", "emptied"].includes(String(media.mediaEvent))) {
      writeLog("AUDIO", `YouTube media event=${media.mediaEvent}; position=${Number(media.currentTime) || 0}; duration=${Number(media.duration) || 0}; readyState=${Number(media.readyState) || 0}; playing=${Boolean(media.playing)}`);
    }
    const duration = Number(media.duration);
    const currentTime = Number(media.currentTime);
    const playing = Boolean(media.playing);
    mainWindow.webContents.send("browser:media", {
      title: typeof media.title === "string" ? media.title : "",
      trackId: typeof media.trackId === "string" ? media.trackId : "",
      artist: typeof media.artist === "string" ? media.artist : "",
      album: typeof media.album === "string" ? media.album : "YouTube Music",
      artwork: typeof media.artwork === "string" ? media.artwork : "",
      playing,
      currentTime: Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0,
      duration: Number.isFinite(duration) ? Math.max(0, duration) : 0
    });
  });
  ipcMain.on("online:play-intent", event => {
    if (!trustedOnlineIpcSender(event) || !mainWindow) return;
    mainWindow.webContents.send("browser:play-intent");
  });
  ipcMain.on("browser:analysis-config", (event, next: Record<string, unknown>) => {
    if (event.sender !== mainWindow?.webContents || !next || typeof next !== "object") return;
    const requestedFft = Number(next.fftSize);
    const requestedRate = Number(next.sampleRate);
    onlineAnalysisConfig = {
      enabled: next.enabled !== false,
      fftSize: [512, 1024, 2048, 4096, 8192].includes(requestedFft) ? requestedFft : 2048,
      sampleRate: Number.isFinite(requestedRate) && requestedRate >= 8000 && requestedRate <= 192000
        ? Math.round(requestedRate) : 48000
    };
    if (onlineView && !onlineView.webContents.isDestroyed())
      onlineView.webContents.send("online:analysis-config", onlineAnalysisConfig);
  });
  ipcMain.on("online:analysis-frame", (event, frame: Record<string, unknown>) => {
    if (!trustedOnlineIpcSender(event) || !mainWindow || !frame || typeof frame !== "object") return;
    const sampleRate = Number(frame.sampleRate);
    const fftSize = Number(frame.fftSize);
    const frequency = frame.frequency;
    const left = frame.left;
    const right = frame.right;
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000
      || ![512, 1024, 2048, 4096, 8192].includes(fftSize)
      || !ArrayBuffer.isView(frequency) || frequency.byteLength !== fftSize / 2
      || !ArrayBuffer.isView(left) || !ArrayBuffer.isView(right)
      || left.byteLength !== 4096 || right.byteLength !== 4096) return;
    mainWindow.webContents.send("browser:analysis", { sampleRate, fftSize, frequency, left, right });
  });
  ipcMain.on("online:analysis-reset", event => {
    if (!trustedOnlineIpcSender(event) || !mainWindow) return;
    mainWindow.webContents.send("browser:analysis-reset");
  });
  ipcMain.on("native-audio:pcm-data", (event, packet) => {
    if (event.sender !== mainWindow?.webContents || !rendererPcmCaptureActive) return;
    sendPlaybackPcm(packet || {});
  });
  registerNeteaseIpc({ writeLog });
  registerLibraryIpc({
    getMainWindow: () => mainWindow, localMediaAccess, folderVisibility, libraryService, libraryScanner,
    libraryDerivedIndexCache, videoLibraryProbe, audioCache, importMusicMetadata, trustedCacheRequest,
    authorisedAudio, prepareLocalSource, writeLog, libraryRootsReady
  });
  registerMediaMetadataIpc({
    libraryService, videoLibraryProbe, trustedCacheRequest, mediaUrl, writeLog,
    getLocalMediaAccess: () => localMediaAccess
  });
  ipcMain.handle("library:waveform", async (event, input: unknown, requestId?: unknown) => {
    try {
      const sourcePath = parseAbsolutePath(input, "waveform source");
      if (event.sender !== mainWindow?.webContents || !AUDIO_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())
        || !localMediaAccess?.isAllowed(sourcePath)) return { ok: false, error: "波形源文件未授权" };
      if (requestId !== undefined && (typeof requestId !== "string" || !requestId || requestId.length > 200))
        return { ok: false, error: "波形请求标识无效" };
      return await localWaveformService!.request(sourcePath, requestId as string | undefined);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "波形生成失败" };
    }
  });
  ipcMain.on("library:waveform-cancel", (event, input: unknown, requestId?: unknown) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (requestId !== undefined && (typeof requestId !== "string" || !requestId || requestId.length > 200)) return;
    try { localWaveformService?.cancel(parseAbsolutePath(input, "waveform source"), requestId as string | undefined); }
    catch { /* Ignore an obsolete or malformed cancellation. */ }
  });
  registerVstPluginIpc({ getMainWindow: () => mainWindow });
  ipcMain.handle("vst:engine-status", async () => {
    const executable = nativePluginHostPath();
    if (!fs.existsSync(executable)) return { available: false, backend: "JUCE HOST NOT INSTALLED", detail: "原生宿主程序不可用。" };
    try {
      assertNativeHostCompatibility(executable);
      const { stdout } = await execFileAsync(executable, ["--engine-info"], { windowsHide: true, timeout: 8000 });
      const info = JSON.parse(stdout) as { ready: boolean; device?: string; type?: string; sampleRate?: number; bufferSize?: number; outputs?: number; error?: string };
      return {
        available: info.ready,
        backend: info.ready ? "JUCE AUDIO DEVICE READY" : "JUCE DEVICE ERROR",
        detail: info.ready
          ? `${info.device} · ${info.sampleRate} Hz · ${info.bufferSize} samples · ${info.outputs} ch；插件图正在接入播放链。`
          : info.error || "Windows 原生音频设备初始化失败。"
      };
    } catch {
      return { available: false, backend: "JUCE HOST OFFLINE", detail: "无法启动原生音频引擎探测。" };
    }
  });
  ipcMain.handle("vst:open-editor", (_, pluginPath: string, pluginId: string) => {
    const executable = nativePluginHostPath();
    if (!fs.existsSync(executable)) return { ok: false, error: "JUCE 原生宿主不可用" };
    const formatAdapter = typeof pluginPath === "string" ? pluginFormatAdapterForPath(pluginPath) : undefined;
    if (typeof pluginPath !== "string" || !path.isAbsolute(pluginPath) || !formatAdapter?.runtimeAvailable) {
      return { ok: false, error: "该插件格式尚未提供可用的原生运行适配器" };
    }
    try {
      const child = spawn(executable, ["--editor", pluginPath, typeof pluginId === "string" ? pluginId : "", String(mainWindowHandle())], { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "插件编辑器启动失败" };
    }
  });
  const handleNativeAudioCommand = async (command: Record<string, unknown>) => {
    if (!command || typeof command !== "object") return { ok: false, error: "无效的原生音频命令" };
    if (command.type === "direct-load" || command.type === "direct-analysis") return { ok: false, error: "DIRECT_LOAD_REQUIRES_AUTHORISED_SOURCE" };
    if (["rack", "state-delete", "state-remove"].includes(String(command.type))) await switchVstProfile("music");
    if (command.type === "state-delete" || command.type === "state-remove") {
      const pluginId = typeof command.id === "string" ? command.id.trim() : "";
      if (!pluginId || pluginId.length > 4096) return { ok: false, error: "INVALID_PLUGIN_STATE_ID" };
      let rackUpdated = false;
      if (command.type === "state-remove" && playbackEngineGate?.current() && !playbackEngineGate.current()?.killed) {
        const plugins = Array.isArray(command.plugins) ? command.plugins : null;
        if (!plugins) return { ok: false, error: "INVALID_PLUGIN_RACK" };
        const rackResult = await sendPlaybackCommand({
          type: "rack",
          plugins,
          stateDirectory: vstStateDirectory()
        }) as { ok?: boolean; error?: string };
        if (!rackResult?.ok) return { ok: false, error: rackResult?.error || "PLUGIN_RACK_REMOVE_FAILED" };
        rackUpdated = true;
      }
      const stateFile = vstStateFileForPlugin(pluginId);
      const existed = fs.existsSync(stateFile);
      try {
        fs.rmSync(stateFile, { force: true });
        writeLog("VST", `Cleared parameter memory for removed plugin ${pluginId}; existed=${existed}; rackUpdated=${rackUpdated}`);
        if (command.type === "state-remove") {
          mainWindow?.focus();
          mainWindow?.webContents.focus();
        }
        return { ok: true, deleted: existed, rackUpdated };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "PLUGIN_STATE_DELETE_FAILED" };
      }
    }
    if (command.type === "enable") {
      nativeAudioActive = Boolean(command.enabled);
      // Disabling the native path must also stop its transport. Otherwise the
      // renderer switches back to Web Audio while JUCE keeps playing invisibly.
      if (!nativeAudioActive && playbackEngineGate?.current() && !playbackEngineGate.current()?.killed) {
        try { await sendPlaybackCommand({ type: "pause" }); }
        catch { /* The engine may already be shutting down. */ }
      }
      return { ok: true, enabled: nativeAudioActive };
    }
    try {
      // Restore the persisted healthy route before evaluating a new intent.
      // The restore command talks directly to the host, so this cannot recurse
      // through the IPC command handler.
      await ensureNativeOutputRestored();
      const generation = ["load", "direct-close", "device-apply", "output"].includes(String(command.type)) ? ++directGeneration : directGeneration;
      let enriched: Record<string, unknown> = command.type === "editor" ? { ...command, owner: mainWindowHandle() } : { ...command };
      if (command.type === "load" && command.direct === true) {
        const source = parseAbsolutePath(command.sourcePath, "direct audio source");
        if (!AUDIO_EXTENSIONS.has(path.extname(source).toLowerCase()) || !localMediaAccess?.isAllowed(source))
          return { ok: false, error: "直通音源未授权" };
        const probe = await sendPlaybackCommand({ type: "direct-probe", endpointId: command.endpointId }) as { ok?: boolean; error?: string };
        if (!probe.ok) return probe;
        // Stop the outgoing source before slow preparation. Never keep stale audio audible.
        await sendPlaybackCommand({ type: "pause" });
        const directFormat = await audioCache.use(async () => {
          const prepared = await prepareHdmiSource(source);
          audioCache.protect("prepared-direct", [prepared.path, ...(prepared.analysisPath ? [prepared.analysisPath] : [])]);
          return prepared;
        });
        enriched = { ...enriched, type: "direct-load", directFormat };
      }
      let streamStopStatus: Record<string, unknown> | undefined;
      if (command.type === "device-apply" || command.type === "output")
        enriched = { ...enriched, generation: ++nativeOutputGeneration };
      if (command.type === "rack" || command.type === "state-save")
        enriched = { ...enriched, stateDirectory: vstStateDirectory() };
      if (["online-start", "online-stop", "process-start", "process-stop"].includes(String(command.type)))
        return { ok: false, error: "YouTube 仅支持网页直出；实验性 Native/VST 捕获已移除" };
      if (command.type === "stream-start") {
        rendererPcmCaptureActive = true;
        enriched = { ...command, type: "pcm-start" };
        resetPcmTransportStats();
        nativeAudioActive = true;
      } else if (command.type === "stream-stop") {
        try { streamStopStatus = await sendPlaybackCommand({ type: "status" }) as Record<string, unknown>; }
        catch { /* Diagnostics must not prevent stopping playback. */ }
        rendererPcmCaptureActive = false;
        nativeAudioActive = false;
        enriched = { ...command, type: "pcm-stop" };
      }
      const response = await sendPlaybackCommand(enriched) as { ok?: boolean; error?: string; [key: string]: unknown };
      if (command.type === "load" && response?.ok) {
        const format = enriched.directFormat as { path: string; codec: string; analysisPath?: string } | undefined;
        audioCache.protect("native", format ? [format.path, ...(format.analysisPath ? [format.analysisPath] : [])] : [String(command.path || "")]);
        if (format && !format.codec.startsWith("pcm") && !format.analysisPath) {
          // Audio is already ready; preparation of visualization never delays the load reply.
          void audioCache.use(async () => {
            const analysisPath = await decodedAudioCache.prepare(String(command.sourcePath));
            if (generation !== directGeneration) return;
            audioCache.protect("native-analysis", [analysisPath]);
            await sendPlaybackCommand({ type: "direct-analysis", playbackToken: command.playbackToken, path: analysisPath });
          }).catch(error => writeLog("AUDIO", "HDMI_ANALYSIS_UNAVAILABLE: " + String(error)));
        }
      }
      if ((command.type === "device-apply" || command.type === "output") && response?.ok
          && Boolean((response as Record<string, unknown>).committed)) {
        const responseRecord = response as Record<string, unknown>;
        const lkg = responseRecord.lastKnownGood as NativeOutputCandidate | undefined;
        const preferred = command.type === "device-apply"
          ? command.candidate as NativeOutputCandidate | undefined : lkg;
        if (lkg?.juceDeviceName) {
          writeNativeOutputState(app.getPath("userData"), {
            schemaVersion: 1,
            preferred: preferred?.juceDeviceName ? preferred : lkg,
            lastKnownGood: lkg,
            updatedAt: new Date().toISOString()
          });
        }
      }
      if (command.type === "stream-start" && !response?.ok) rendererPcmCaptureActive = false;
      if (command.type === "stream-start" && response?.ok)
        writeLog("AUDIO", "Renderer stream PCM engine ready");
      if (command.type === "stream-stop")
        writeLog("AUDIO", `Renderer stream PCM stopped after ${pcmTransportStats().packets} packets / ${pcmTransportStats().frames} frames; transport drops=${pcmTransportStats().transportDrops}; native underruns=${Number(streamStopStatus?.captureUnderruns) || 0}; buffer=${Number(streamStopStatus?.captureBufferFrames) || 0}/${Number(streamStopStatus?.captureTargetFrames) || 0}`);
      if (!response?.ok && ["rack", "load", "play", "editor"].includes(String(command.type)))
        writeLog("VST", `${String(command.type)} failed: ${response?.error || "unknown error"}`);
      return response;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "原生音频引擎通信失败" };
    }
  };
  ipcMain.handle("native-audio:command", (_, command: Record<string, unknown>) => {
    // All source and transport mutations share one ordered lane. Without this,
    // a late stop/enable(false) from the outgoing source can overtake pcm-start
    // or load/play for the incoming source.
    const result = nativeAudioCommandQueue
      .catch(() => undefined)
      .then(async () => {
        if (videoReserved) return { ok: false, error: "VIDEO_OWNS_AUDIO_OUTPUT" };
        if (command.type === "route-status") return { ok: true, route: audioRoutes.snapshot() };
        const source = typeof command.routeSource === "string" ? command.routeSource as AudioRouteSource : undefined;
        const sessionId = typeof command.routeSessionId === "string" ? command.routeSessionId : undefined;
        const action = command.routeAction;
        if (!source || !sessionId || !["local", "netease", "youtube", "web-direct"].includes(source))
          return handleNativeAudioCommand(command);

        if (action === "prepare") {
          const prepared = audioRoutes.prepare(source, sessionId);
          if (!prepared.ok) return prepared;
          const response = await handleNativeAudioCommand(command) as { ok?: boolean; [key: string]: unknown };
          if (prepared.alreadyActive)
            return { ...response, route: audioRoutes.snapshot(), routeGeneration: prepared.generation };
          const transition = response?.ok
            ? audioRoutes.commit(prepared.generation)
            : audioRoutes.abort(prepared.generation);
          return { ...response, route: transition.snapshot, routeGeneration: prepared.generation };
        }
        if (action === "release") {
          if (!audioRoutes.owns(source, sessionId))
            return { ok: true, stale: true, ignored: "STALE_ROUTE_RELEASE", route: audioRoutes.snapshot() };
          const response = await handleNativeAudioCommand(command) as { ok?: boolean; [key: string]: unknown };
          const transition = response?.ok ? audioRoutes.release(source, sessionId) : { snapshot: audioRoutes.snapshot() };
          return { ...response, route: transition.snapshot };
        }
        if (action === "transport" && !audioRoutes.owns(source, sessionId))
          return { ok: true, stale: true, ignored: "STALE_ROUTE_TRANSPORT", route: audioRoutes.snapshot() };
        return handleNativeAudioCommand(command);
      });
    nativeAudioCommandQueue = result.then(() => undefined, () => undefined);
    return result;
  });
  ipcMain.handle("audio-route:claim", (_, source: AudioRouteSource, sessionId: string) => {
    const result = nativeAudioCommandQueue.catch(() => undefined).then(() => {
      if (!["local", "netease", "youtube", "web-direct"].includes(source))
        return { ok: false, error: "INVALID_ROUTE_SOURCE", route: audioRoutes.snapshot() };
      const prepared = audioRoutes.prepare(source, sessionId);
      if (!prepared.ok) return prepared;
      if (prepared.alreadyActive) return { ok: true, route: audioRoutes.snapshot() };
      const committed = audioRoutes.commit(prepared.generation);
      return { ...committed, route: committed.snapshot };
    });
    nativeAudioCommandQueue = result.then(() => undefined, () => undefined);
    return result;
  });
  ipcMain.handle("audio-route:release", (_, source: AudioRouteSource, sessionId: string) => {
    const result = nativeAudioCommandQueue.catch(() => undefined).then(() => {
      const released = audioRoutes.release(source, sessionId);
      return released.ok
        ? { ok: true, route: released.snapshot }
        : { ok: true, stale: true, ignored: released.error, route: released.snapshot };
    });
    nativeAudioCommandQueue = result.then(() => undefined, () => undefined);
    return result;
  });
  ipcMain.handle("audio-route:status", () => ({ ok: true, route: audioRoutes.snapshot() }));
  ipcMain.on("window:glass", (_, material: "acrylic" | "mica" | "none") => setWindowGlass(material));
  ipcMain.handle("dialog:confirm-plugin-removal", async (_, rawName: unknown) => {
    if (!mainWindow) return false;
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 180) : "该插件";
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "移除插件",
      message: `从机架中移除“${name}”？`,
      detail: "删除后会同时清除该插件的参数记忆；以后重新添加时将从插件默认状态开始。",
      buttons: ["删除并清除记忆", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    mainWindow.focus();
    mainWindow.webContents.focus();
    return result.response === 0;
  });
  registerAppearanceIpc({ getMainWindow: () => mainWindow });
  queueStore = new QueueStore(app.getPath("userData"));
  registerQueueIpc({ getMainWindow: () => mainWindow, queueStore, writeLog });
  ipcMain.on("window:display-language", (event, language: unknown) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return;
    if (language !== "zh-CN" && language !== "en-US" && language !== "ja-JP") return;
    displayLanguage = language;
    refreshDisplayName();
    updateInstallDisplayName(language);
  });
  ipcMain.on("window:theme", (_, theme: "dark" | "light" | "system") => {
    nativeTheme.themeSource = theme;
  });
  ipcMain.on("window:compact", (_, enabled: boolean) => {
    windowResize.end();
    if (!mainWindow) return;
    if (enabled) {
      windowState.enterMode("compact", windowSnapshot(mainWindow));
      compactActive = true;
      compactPreviousTop = mainWindow.isAlwaysOnTop();
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      mainWindow.setMinimumSize(380, 110);
      // Resize before disabling manual resizing; Windows can otherwise retain
      // the previous large client bounds on some DPI configurations.
      mainWindow.setSize(420, 124, true);
      mainWindow.setResizable(false);
      mainWindow.setAlwaysOnTop(true);
    } else {
      compactActive = false;
      mainWindow.setResizable(true);
      mainWindow.setMinimumSize(640, 400);
      const restore = windowState.leaveMode("compact");
      if (restore) mainWindow.setBounds(restore, true);
      mainWindow.setAlwaysOnTop(compactPreviousTop);
    }
    syncWindowFit(true);
  });
  ipcMain.on("window:click-through", (_, enabled: boolean) => setClickThrough(enabled));
  ipcMain.on("window:click-through-bypass", (_, bypassed: boolean) => {
    if (!mainWindow || !clickThrough) return;
    mainWindow.setIgnoreMouseEvents(!bypassed, { forward: true });
  });
  ipcMain.on("browser:show", (_, bounds: ViewBounds) => {
    const view = ensureOnlineView();
    if (!view) return;
    const safeBounds = clampOnlineViewBounds(bounds);
    if (!safeBounds) return;
    view.setBounds(safeBounds);
    view.setVisible(true);
    emitBrowserState();
  });
  ipcMain.on("browser:hide", () => onlineView?.setVisible(false));
  ipcMain.on("browser:bounds", (_, bounds: ViewBounds) => {
    const safeBounds = clampOnlineViewBounds(bounds);
    if (safeBounds) onlineView?.setBounds(safeBounds);
  });
  ipcMain.on("browser:navigate", (_, input: string) => {
    const value = input.trim();
    if (!value || !onlineView) return;
    const target = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(target);
      if (parsed.protocol === "https:") void onlineView.webContents.loadURL(parsed.toString());
    } catch { /* Invalid addresses are ignored. */ }
  });
  ipcMain.on("browser:back", () => {
    if (onlineView?.webContents.navigationHistory.canGoBack()) onlineView.webContents.navigationHistory.goBack();
  });
  ipcMain.on("browser:forward", () => {
    if (onlineView?.webContents.navigationHistory.canGoForward()) onlineView.webContents.navigationHistory.goForward();
  });
  ipcMain.on("browser:reload", () => onlineView?.webContents.reload());
  ipcMain.on("browser:home", () => void onlineView?.webContents.loadURL("https://music.youtube.com/"));
  ipcMain.on("browser:volume", (_, volume: number, muted: boolean) => {
    onlineVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    onlineMuted = Boolean(muted);
    if (!onlineView || onlineView.webContents.isDestroyed()) return;
    void onlineView.webContents.executeJavaScript(onlineVolumeScript(onlineVolume, onlineMuted)).catch(() => undefined);
  });
  let youtubeOutputQueue: Promise<unknown> = Promise.resolve();
  ipcMain.handle("browser:get-output", async () => {
    let status;
    try { status = await onlineView?.webContents.executeJavaScript("window.__auralisOutputStatus || null"); } catch {}
    return { label: onlineOutputLabel, deviceId: onlineOutputDeviceId, ...status };
  });
  ipcMain.handle("browser:set-output", (_, label: string, useDefault: boolean) => {
    const run = youtubeOutputQueue.catch(() => undefined).then(async () => {
      const contents = onlineView?.webContents;
      if (!contents || contents.isDestroyed()) {
        onlineOutputLabel = useDefault ? "default" : label;
        if (useDefault) onlineOutputDeviceId = "default";
        return { ok:true, deferred:true };
      }
      try {
        return await applyOnlineOutputSelection(contents, label, useDefault, true);
      } catch (error) { return {ok:false,error:error instanceof Error ? error.message : String(error)}; }
    });
    youtubeOutputQueue = run;
    return run;
  });
  ipcMain.handle("browser:media-action", async (_, action: string, value?: number) => {
    if (!onlineView || onlineView.webContents.isDestroyed()) return { ok: false, error: "在线播放器尚未启动" };
    if (action !== "pause") return { ok: false, error: "请使用 YouTube 网页播放控件" };
    const safeAction = JSON.stringify(action);
    const safeValue = Number.isFinite(value) ? Number(value) : 0;
    try {
      return await onlineView.webContents.executeJavaScript(`
        (async () => {
          const action = ${safeAction};
          const mediaElements = Array.from(document.querySelectorAll('video, audio'));
          const findButton = selectors => {
            for (const selector of selectors) {
              const button = document.querySelector(selector);
              if (button) return button;
            }
            return null;
          };
          const selectMedia = () => {
            const elements = Array.from(document.querySelectorAll('video, audio'));
            return document.querySelector('video.video-stream.html5-main-video')
              || elements.find(item => !item.paused && !item.ended && !item.muted)
              || elements.find(item => Number.isFinite(item.currentTime) && item.currentTime > 0)
              || elements.find(item => Number.isFinite(item.duration) && item.duration > 0)
              || elements[elements.length - 1];
          };
          let media = selectMedia();
          const playPauseButton = () => findButton([
            'ytmusic-player-bar #play-pause-button',
            'ytmusic-player-bar .play-pause-button',
            '#play-pause-button',
            'tp-yt-paper-icon-button[title="Play"]',
            'tp-yt-paper-icon-button[aria-label*="Play"]',
            'tp-yt-paper-icon-button[aria-label*="播放"]'
          ]);
          if (action === 'play') {
            if (media && !media.paused && !media.ended) return { ok: true, playing: true };
            const button = playPauseButton();
            if (button) button.click();
            else if (media) await media.play();
            await new Promise(resolve => setTimeout(resolve, 80));
            media = selectMedia();
            if (!media || media.paused || media.ended) {
              // YouTube can replace its media element while handling the player
              // button. Re-select it and explicitly start the replacement.
              media = selectMedia();
              if (media) {
                try { await media.play(); } catch {}
              }
              await new Promise(resolve => setTimeout(resolve, 40));
              media = selectMedia();
            }
            return media && !media.paused && !media.ended
              ? { ok: true, playing: true }
              : { ok: false, error: 'YOUTUBE_PLAY_NOT_CONFIRMED' };
          }
          if (action === 'pause') {
            if (!media) return { ok: false, error: '没有活动媒体' };
            media.pause();
            return { ok: true, playing: false };
          }
          if (action === 'toggle') {
            if (!media) return { ok: false, error: '没有活动媒体' };
            if (media.paused) await media.play(); else media.pause();
            return { ok: true };
          }
          if (action === 'stop') {
            if (!media) return { ok: false, error: '没有活动媒体' };
            for (const item of mediaElements) {
              item.pause();
              if (Number.isFinite(item.duration)) item.currentTime = 0;
            }
            return { ok: true };
          }
          if (action === 'seek') {
            ${onlinePlayerSeekScript(safeValue)}
          }
          const selectors = {
            previous: [
              'ytmusic-player-bar .previous-button', '#previous-button',
              'tp-yt-paper-icon-button[aria-label*="Previous"]', 'tp-yt-paper-icon-button[aria-label*="上一"]'
            ],
            next: [
              'ytmusic-player-bar .next-button', '#next-button',
              'tp-yt-paper-icon-button[aria-label*="Next"]', 'tp-yt-paper-icon-button[aria-label*="下一"]'
            ],
            shuffle: [
              'ytmusic-player-bar .shuffle', '#shuffle',
              'tp-yt-paper-icon-button[aria-label*="Shuffle"]', 'tp-yt-paper-icon-button[aria-label*="随机"]'
            ],
            repeat: [
              'ytmusic-player-bar .repeat', '#repeat',
              'tp-yt-paper-icon-button[aria-label*="Repeat"]', 'tp-yt-paper-icon-button[aria-label*="循环"]'
            ]
          };
          const keywords = {
            previous: ['previous', '上一', 'vorheriger'],
            next: ['next', '下一', 'nächster'],
            shuffle: ['shuffle', '随机', 'zufällig'],
            repeat: ['repeat', '循环', 'wiederholen']
          };
          const fallback = Array.from(document.querySelectorAll('button, tp-yt-paper-icon-button')).find(item => {
            const label = (item.getAttribute('aria-label') || item.getAttribute('title') || '').toLowerCase();
            return (keywords[action] || []).some(keyword => label.includes(keyword));
          });
          const button = findButton(selectors[action] || []) || fallback;
          if (!button) return { ok: false, error: 'YouTube 当前页面没有找到对应控件' };
          button.click();
          return { ok: true };
        })()
      `);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "在线控制失败" };
    }
  });
  ipcMain.handle("browser:fade", async () => ({ ok: false, error: "YouTube Direct 不支持应用淡入淡出" }));
  // Normally finished by now; never hold the window back on a slow disk.
  await Promise.race([libraryRootsReady, new Promise(resolve => setTimeout(resolve, 1500))]);
  createWindow();
  void createTray();
  setWindowGlass("mica");
  mainWindow?.webContents.on("render-process-gone", (_, details) =>
    writeLog("RENDERER", `${details.reason} (${details.exitCode})`)
  );
  app.on("activate", showMainWindow);
});

app.on("window-all-closed", () => {
  // Closing the window keeps playback alive in the notification area.
});

app.on("before-quit", event => {
  isQuitting = true;
  const engine = playbackEngineGate?.current();
  if (pluginStateFlushStarted) return;
  if (!engine || engine.killed) return;
  event.preventDefault();
  pluginStateFlushStarted = true;
  const saveState = engine && !engine.killed
    ? sendPlaybackCommand({ type: "state-save", stateDirectory: vstStateDirectory(), closeEditors: true })
    : Promise.resolve();
  void saveState
    .catch(error => writeLog("VST", `Final parameter-state save failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      try { engine?.stdin.end(); } catch { /* Engine may already be closing. */ }
      app.quit();
    });
});
app.on("will-quit", () => {
  authorizedFiles?.flush();
  queueStore?.flush();
  videoPlayer?.dispose();
  localWaveformService?.cancel();
  globalShortcut.unregisterAll();
  pcmDiagnostics?.stop();
  pcmDiagnostics = null;
  const engine = playbackEngineGate?.current();
  if (engine) {
    playbackEngineGate?.clearIfCurrent(engine);
    try { engine.kill(); } catch { /* App shutdown will release the process. */ }
  }
  tray?.destroy();
  tray = null;
});

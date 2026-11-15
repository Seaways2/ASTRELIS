import { LibraryMatchTaskHost } from "./components/LibraryMatchTaskHost";
import { usePlaybackShortcuts } from "./hooks/usePlaybackShortcuts";
import { nativeStatusReady } from "./utils/nativeStatusReady";
import { useAtmosphereStore } from "./stores/atmosphereStore";
import { VideoView } from "./components/VideoView";
import { isVideoTrack } from "./utils/videoTrack";
import type { VideoState } from "../electron/videoPlayer";
import { prefetchTarget } from "./utils/playbackResources";
import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import {
  Blend, Blocks, CircleStop, Copy, Disc3, Expand, Import, ListMusic, Lock, Minus,
  Pause, PictureInPicture2, Play, Power, Repeat, Repeat1, Square,
  Shuffle, SkipBack, SkipForward, SlidersHorizontal,
  Film, Volume2, X, Zap
} from "lucide-react";
import { audioEngine } from "./audio/AudioEngine";
import { BackgroundSlideshow } from "./components/BackgroundSlideshow";
import { PlaybackExclusion } from "./utils/playbackExclusion";
import { MeterPanel } from "./components/MeterPanel";
import { QueuePanel } from "./components/QueuePanel";
import { VideoChannelStrip } from "./components/VideoChannelStrip";
import { WorkspacePage } from "./components/WorkspacePage";
import { WaveformTimeline } from "./components/WaveformTimeline";
import { AtmosphereLayer } from "./components/AtmosphereLayer";
import { AmbientBackground } from "./components/AmbientBackground";
import { ChannelStripPopover } from "./components/ChannelStripPopover";
import { VolumeLevelIcon } from "./components/VolumeLevelIcon";
import { usePlayerStore } from "./stores/playerStore";
import { useShallow } from "zustand/react/shallow";
import { WithStoreVolume } from "./components/WithStoreVolume";
import { formatTime, isAudioFileDrag, modes, nav, selectShellState, visualTransitionTimings, waitForAudioTransition } from "./app/appShell";
import { WithDisplayTime } from "./app/WithDisplayTime";
import { useImmersiveMode } from "./app/useImmersiveMode";
import { useVolumeRouting } from "./app/useVolumeRouting";
import { useWindowPresence } from "./app/useWindowPresence";
import { toNativeRackPayload, useVstRackStore } from "./stores/vstRackStore";
import type { OutputDevice, VisualizerMode } from "./types/audio";
import { VisualizerCanvas } from "./visualizers/VisualizerCanvas";
import { resolveVisualizerSettings } from "./utils/visualizerSettings";
import { useI18n } from "./i18n";
import type { PageId } from "./types/audio";
import { contrastPeakColor } from "./utils/color";
import { amplitudeToFaderPercent } from "./utils/volumeFaderScale";
import { nativeStatusCompletesTrack, nextQueueIndex, nextQueueIndexAfterEnd, PlaybackEndLatch } from "./utils/playbackEndLatch";
import {
  probeGpuVisualCapabilities,
  type GpuVisualQuality
} from "./visualizers/gpuVisualRuntime";

export default function App() {
  const state = usePlayerStore(useShallow(selectShellState));
  const { pageVisible, windowBackgrounded, maximized, clickThrough, setClickThrough, systemLight } = useWindowPresence();
  const [videoState, setVideoState] = useState<VideoState>();
  const [videoPreparing, setVideoPreparing] = useState("");
  const [videoWindowBusy, setVideoWindowBusy] = useState(false);
  const [videoDirect, setVideoDirect] = useState(false);
  const [videoRackEnabled, setVideoRackEnabled] = useState(() => localStorage.getItem("astrelis.video.rack") === "true");
  const setVideoRack = (enabled: boolean) => { localStorage.setItem("astrelis.video.rack", String(enabled)); setVideoRackEnabled(enabled); };
  const [videoLanding, setVideoLanding] = useState(false);
  const [lastVideoId, setLastVideoId] = useState<string>();
  const videoBookmarks = useRef(new Map<string, number>());
  const videoTransition = useRef<Promise<unknown>>(Promise.resolve());
  const videoActiveRef = useRef(false);
  const { t, tm, resolvedLanguage } = useI18n();
  const gpuCapabilities = useMemo(probeGpuVisualCapabilities, []);
  const [vstNotice, setVstNotice] = useState("");
  const lightTheme = state.uiSettings.colorMode === "light" || (state.uiSettings.colorMode === "system" && systemLight);
  const lowPerformanceMode = state.uiSettings.lowPerformanceMode;
  const motionEnabled = state.uiSettings.animations && !lowPerformanceMode;
  const effectiveGlowStrength = lowPerformanceMode ? 0 : state.uiSettings.glowStrength;
  const customBackgroundActive = Boolean(
    state.uiSettings.customBackgroundUrl
    && !state.obsMode
    && state.uiSettings.glassMaterial !== "none"
    && !lowPerformanceMode
  );
  const lightSurface = useMemo(() => {
    const mix = Math.max(0, Math.min(1, (state.uiSettings.windowOpacity - .25) / .75));
    const channel = (dim: number, bright: number) => Math.round(dim + (bright - dim) * mix);
    return `rgb(${channel(178, 239)} ${channel(198, 247)} ${channel(202, 248)})`;
  }, [state.uiSettings.windowOpacity]);
  const current = state.tracks[state.currentIndex];
  const onlinePlaybackSession = Boolean(state.onlineMedia && (state.onlineMedia.playing
    || (!state.playing && (state.activePage === "online" || audioEngine.analysisMode === "online"))));
  const videoActive = isVideoTrack(current) && !onlinePlaybackSession;
  useEffect(() => { if (current || onlinePlaybackSession) setVideoLanding(false); }, [current?.id, state.localPlayRequest, onlinePlaybackSession]);
  videoActiveRef.current = videoActive;
  const [backgroundMenu,setBackgroundMenu]=useState<{x:number;y:number}|null>(null);
  const nextBackground=useCallback(()=>{
    const s=usePlayerStore.getState(), images=s.uiSettings.backgroundImages;
    if(images.length<2) return;
    const index=images.findIndex(image=>image.url===s.uiSettings.customBackgroundUrl);
    const image=images[(index+1)%images.length];
    s.setUiSetting("customBackgroundPath",image.path);
    s.setUiSetting("customBackgroundUrl",image.url);
    setBackgroundMenu(null);
  },[]);
  useEffect(()=>{
    if(!customBackgroundActive || state.uiSettings.backgroundImages.length<2 || !state.uiSettings.backgroundInterval) return;
    const timer=window.setInterval(nextBackground,state.uiSettings.backgroundInterval*1000);
    return ()=>clearInterval(timer);
  },[customBackgroundActive,state.uiSettings.backgroundImages,state.uiSettings.backgroundInterval,state.uiSettings.customBackgroundUrl,nextBackground]);
  // Keep playback ownership separate from the control target. Opening the
  // online page must make the footer control YouTube, but it must not tear down
  // a still-playing local VST backend until the user actually starts YouTube.

  const onlineSession = Boolean(state.onlineMedia && (onlinePlaybackSession || state.activePage === "online"));
  const onlinePlaying = Boolean(onlineSession && state.onlineMedia?.playing);
  const displayName = onlineSession ? state.onlineMedia!.title : current?.name;
  const displayArtist = onlineSession ? (state.onlineMedia!.artist || "YouTube Music") : current?.artist ? tm(current.artist) : undefined;
  const displayAlbum = onlineSession ? state.onlineMedia!.album : current?.album;
  const displayCover = onlineSession ? state.onlineMedia!.artwork : current?.coverUrl;
  // Only whether playback has moved off zero matters here; the position itself
  // is rendered by WithDisplayTime so ticks do not re-render the shell.
  const hasPlaybackProgress = usePlayerStore(store => (onlineSession ? store.onlineMedia?.currentTime ?? 0 : store.currentTime) > .05);
  const backendDuration = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : 0;
  const metadataDuration = Number.isFinite(current?.duration) && (current?.duration || 0) > 0 ? current!.duration! : 0;
  const displayDuration = onlineSession ? state.onlineMedia!.duration : backendDuration || metadataDuration;
  const playbackActive = state.playing || onlinePlaying;
  const controlPlaying = onlineSession ? onlinePlaying : state.playing;
  const playbackState = playbackActive ? "playing" : (current || onlineSession) && hasPlaybackProgress ? "paused" : "stopped";
  const fileRef = useRef<HTMLInputElement>(null);
  const previousLocalPlaying = useRef(state.playing);
  const previousOnlinePlaying = useRef(Boolean(state.onlineMedia?.playing));
  const webDirectRouteGeneration = useRef(0);
  const webDirectRouteSession = useRef("");
  const localStopTransition = useRef<Promise<void>>(Promise.resolve());
  const onlineTransportPending = useRef(false);
  const localBackendGeneration = useRef(0);
  const localRouteSession = useRef("");
  const localNativeReady = useRef(false);
  const localPlaybackEndLatch = useRef(new PlaybackEndLatch());
  const completedLocalPlaybackToken = useRef("");
  const localTrackTransitionGeneration = useRef(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const [videoVolumeOpen, setVideoVolumeOpen] = useState(false);
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [deviceId, setDeviceId] = useState(localStorage.getItem("auralis.output") || "default");
  const [deviceError, setDeviceError] = useState("");
  const [directOutputLabel, setDirectOutputLabel] = useState("");
  const restoredOutput = useRef(false);
  const selectedOutputIdRef = useRef(deviceId);
  const selectedOutputLabelRef = useRef(localStorage.getItem("auralis.output.label") || "");
  const outputFallbackTimerRef = useRef<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const lastDragEvent = useRef(0);
  const {
    immersiveMode, setImmersiveMode, immersiveControlsVisible, setImmersiveControlsVisible,
    immersiveSensorHovered, exitImmersiveMode, cancelImmersiveHide, scheduleImmersiveHide
  } = useImmersiveMode({ clickThrough, onEnter: () => { dragDepth.current = 0; setDragging(false); } });
  const [visualSettingsOpen, setVisualSettingsOpen] = useState(false);
  const visualsVisible = pageVisible && !windowBackgrounded && !videoActive;
  const [channelStripOpen, setChannelStripOpen] = useState(false);
  const atmosphere = useAtmosphereStore(store => store.settings);
  const [visualStopped, setVisualStopped] = useState(false);
  const [visualSwitchPhase, setVisualSwitchPhase] = useState<"idle" | "out" | "in">("idle");
  const visualSwitchTimer = useRef<number | undefined>(undefined);
  const visualSwitchGeneration = useRef(0);
  const visualWheelDelta = useRef(0);
  const visualWheelResetTimer = useRef<number | undefined>(undefined);
  const visualWheelLockedUntil = useRef(0);
  const [renderedPage, setRenderedPage] = useState<PageId>(state.activePage);
  const [metersExpanded, setMetersExpanded] = useState(true);
  const showMeters = renderedPage === "nowPlaying" || metersExpanded;
  const [pageSwitchPhase, setPageSwitchPhase] = useState<"idle" | "out" | "in">("idle");
  const renderedPageRef = useRef<PageId>(state.activePage);
  const pageSwitchPhaseRef = useRef<"idle" | "out" | "in">("idle");
  const pageSwitchTimer = useRef<number | undefined>(undefined);
  const pageSwitchGeneration = useRef(0);
  const [compactMode, setCompactMode] = useState(false);
  useEffect(() => {
    if (!videoActive || renderedPage !== "nowPlaying" || compactMode) setVideoVolumeOpen(false);
  }, [videoActive, renderedPage, compactMode]);
  const atmosphereNeedsAudio = !compactMode && !immersiveMode && !state.obsMode && motionEnabled
    && atmosphere.intensity > 0 && atmosphere.glassEdges && atmosphere.response > 0;
  const analysisNeeded = visualsVisible && playbackActive && (
    (!compactMode && (renderedPage === "nowPlaying" || showMeters)) || channelStripOpen || atmosphereNeedsAudio
  );
  const nativeVstEnabled = useVstRackStore(store => store.nativeEnabled);
  const videoRackItems = useVstRackStore(store => store.videoRack);
  const playbackBackend = useRef<{ trackId?: string; native: boolean; playbackToken?: string; format?: string }>({ native: false });
  const gpuEffectsRequested = state.uiSettings.gpuAccelerationEnabled
    && !lowPerformanceMode
    && !state.obsMode;
  const gpuEffectsActive = gpuEffectsRequested && gpuCapabilities.webgl2;
  const gpuEffectsQuality: GpuVisualQuality = state.uiSettings.gpuQuality;
  const switchVisualizer = useCallback((mode: VisualizerMode) => {
    const generation = ++visualSwitchGeneration.current;
    window.clearTimeout(visualSwitchTimer.current);

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!motionEnabled || reducedMotion) {
      setVisualSwitchPhase("idle");
      state.setVisualizer(mode);
      return;
    }
    if (mode === state.visualizer && visualSwitchPhase === "idle") return;

    const timing = visualTransitionTimings[state.uiSettings.visualTransition];
    setVisualSwitchPhase("out");
    visualSwitchTimer.current = window.setTimeout(() => {
      if (visualSwitchGeneration.current !== generation) return;
      state.setVisualizer(mode);
      setVisualSwitchPhase("in");
      visualSwitchTimer.current = window.setTimeout(() => {
        if (visualSwitchGeneration.current === generation) setVisualSwitchPhase("idle");
      }, timing.in);
    }, timing.out);
  }, [state.setVisualizer, motionEnabled, state.uiSettings.visualTransition, state.visualizer, visualSwitchPhase]);
  const handleVisualizerWheel = useCallback((event: ReactWheelEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || (event.target as Element).closest(".visual-settings-panel")) return;
    const rawDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(rawDelta) < .5) return;
    event.preventDefault();

    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? Math.max(240, window.innerHeight * .7) : 1;
    const now = performance.now();
    if (now < visualWheelLockedUntil.current) {
      visualWheelDelta.current = 0;
      return;
    }
    visualWheelDelta.current += rawDelta * unit;
    window.clearTimeout(visualWheelResetTimer.current);
    visualWheelResetTimer.current = window.setTimeout(() => { visualWheelDelta.current = 0; }, 160);
    if (Math.abs(visualWheelDelta.current) < 60) return;

    const currentIndex = Math.max(0, modes.findIndex(mode => mode.id === state.visualizer));
    const direction = visualWheelDelta.current > 0 ? 1 : -1;
    const nextIndex = (currentIndex + direction + modes.length) % modes.length;
    visualWheelDelta.current = 0;
    const timing = visualTransitionTimings[state.uiSettings.visualTransition];
    visualWheelLockedUntil.current = now + timing.out + timing.in + 180;
    switchVisualizer(modes[nextIndex].id);
  }, [state.uiSettings.visualTransition, state.visualizer, switchVisualizer]);
  useEffect(() => {
    if (!motionEnabled) {
      visualSwitchGeneration.current++;
      window.clearTimeout(visualSwitchTimer.current);
      setVisualSwitchPhase("idle");
    }
    return () => {
      visualSwitchGeneration.current++;
      window.clearTimeout(visualSwitchTimer.current);
      window.clearTimeout(visualWheelResetTimer.current);
    };
  }, [motionEnabled]);
  useEffect(() => {
    const target = state.activePage;
    const generation = ++pageSwitchGeneration.current;
    window.clearTimeout(pageSwitchTimer.current);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // Native browser views cannot follow renderer CSS transforms or opacity.
    if (!motionEnabled || reducedMotion || target === "online" || renderedPageRef.current === "online") {
      renderedPageRef.current = target;
      setRenderedPage(target);
      pageSwitchPhaseRef.current = "idle";
      setPageSwitchPhase("idle");
      return;
    }

    const timing = visualTransitionTimings[state.uiSettings.visualTransition];
    if (target === renderedPageRef.current) {
      if (pageSwitchPhaseRef.current === "idle") return;
      pageSwitchPhaseRef.current = "in";
      setPageSwitchPhase("in");
      pageSwitchTimer.current = window.setTimeout(() => {
        if (pageSwitchGeneration.current !== generation) return;
        pageSwitchPhaseRef.current = "idle";
        setPageSwitchPhase("idle");
      }, timing.in);
      return;
    }

    pageSwitchPhaseRef.current = "out";
    setPageSwitchPhase("out");
    pageSwitchTimer.current = window.setTimeout(() => {
      if (pageSwitchGeneration.current !== generation) return;
      renderedPageRef.current = target;
      setRenderedPage(target);
      pageSwitchPhaseRef.current = "in";
      setPageSwitchPhase("in");
      pageSwitchTimer.current = window.setTimeout(() => {
        if (pageSwitchGeneration.current !== generation) return;
        pageSwitchPhaseRef.current = "idle";
        setPageSwitchPhase("idle");
      }, timing.in);
    }, timing.out);
  }, [state.activePage, motionEnabled, state.uiSettings.visualTransition]);
  useEffect(() => () => {
    pageSwitchGeneration.current++;
    window.clearTimeout(pageSwitchTimer.current);
  }, []);
  const mediaKeyHandler = useRef<(action: "toggle" | "previous" | "next" | "stop") => void>(() => undefined);
  const onlinePlayIntentHandler = useRef<() => void>(() => undefined);
  // JUCE's built-in reader must never receive containers it cannot decode
  // (notably WMA). Such tracks are prepared to WAV before native playback.
  const nativeReadable = Boolean(current?.nativePath && /\.(wav|wave|flac|mp3|aiff|aif|ogg)$/i.test(current.nativePath));
  const neteaseOnlineSource = current?.format === "NETEASE";
  const onlineDirectSource = onlinePlaybackSession || neteaseOnlineSource;
  const hdmiDirect = state.uiSettings.hdmiDirectEnabled && !onlineDirectSource;
  const nativePlayback = !isVideoTrack(current) && Boolean((hdmiDirect && current) || (state.uiSettings.nativeOutputEnabled && nativeReadable && !onlineDirectSource));
  const lastAudibleVolume = useVolumeRouting({
    nativePlayback, onlineSession,
    videoFollowsVolume: Boolean(videoActive && videoState?.ready && !videoState.standalone && !videoDirect)
  });
  useEffect(() => {
    void window.desktop?.cache?.protect([current?.nativePath, current?.sourcePath].filter((file): file is string => !!file));
  }, [current?.nativePath, current?.sourcePath]);
  useEffect(() => {
    const nextTrack = prefetchTarget(state.tracks, state.currentIndex, state.playing, onlineDirectSource, state.shuffle, state.repeat);
    if (!nextTrack) return;
    // Only the predictable next local song, after playback has settled.
    let cancelled = false;
    let timer = window.setTimeout(async function prepareNext() {
      try {
        const result = await window.desktop?.library.prefetch(nextTrack.sourcePath!, hdmiDirect);
        if (!cancelled && result?.busy) timer = window.setTimeout(prepareNext, 5000);
      } catch { /* Speculation never changes the current playback or its errors. */ }
    }, 5000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [current?.id, state.tracks, state.currentIndex, state.playing, state.shuffle, state.repeat, onlineDirectSource, hdmiDirect]);
  const previousHdmiDirect = useRef(false);
  useEffect(() => {
    if (previousHdmiDirect.current && !hdmiDirect) void window.desktop?.nativeAudio.command({ type: "direct-close" });
    previousHdmiDirect.current = hdmiDirect;
    setDirectOutputLabel("");
  }, [hdmiDirect, state.uiSettings.hdmiEndpointId]);
  const vstControlLocked = videoActive || lowPerformanceMode || onlineDirectSource || hdmiDirect;
  const vstControlPending = false;
  const vstControlRequested = onlineDirectSource ? false : nativeVstEnabled;
  const vstControlNativeRequired = Boolean(!onlineDirectSource && vstControlRequested && !state.uiSettings.nativeOutputEnabled);
  const vstControlActive = Boolean((videoActive && videoRackEnabled && !videoDirect) || (!videoActive && !hdmiDirect && !onlineDirectSource && vstControlRequested && state.uiSettings.nativeOutputEnabled));
  const vstControlLabel = videoActive ? (videoRackEnabled && !videoDirect ? "VIDEO · VST BETA" : "VIDEO · VST BYPASS") : hdmiDirect ? "HDMI · DIRECT" : onlineDirectSource
    ? "ONLINE · WEB DIRECT"
    : vstControlLocked
      ? "VST · ECO LOCKED"
    : vstControlNativeRequired
      ? "VST · NATIVE OFF"
      : `VST · LOCAL ${vstControlActive ? "ON" : "OFF"}`;
  const vstControlDetail = videoActive && videoRackEnabled && !videoDirect ? t("video.rackHint") : hdmiDirect ? t("device.hdmiHint") : onlineDirectSource
    ? t("vst.onlineWebDirect")
    : vstControlLocked
      ? t("vst.lowPerformanceNotice")
    : vstControlNativeRequired
      ? t("vst.nativeOutputRequiredChannelHint")
      : `${t("vst.localPlayback")} · ${t(vstControlActive ? "vst.processingOn" : "vst.processingOff")}`;
  const toggleContextualVst = useCallback(() => {
    if (videoActive) { setVstNotice(t(videoRackEnabled && !videoDirect ? "video.rackHint" : "video.bypass")); return; }
    if (hdmiDirect) { setVstNotice(t("device.hdmiHint")); return; }
    if (onlineDirectSource) {
      setVstNotice(t("vst.onlineWebDirect"));
      return;
    }
    if (lowPerformanceMode) {
      setVstNotice(t("vst.lowPerformanceNotice"));
      return;
    }
    if (!state.requestNativeOutputForVst()) return;
    void useVstRackStore.getState().toggleNativeEngine();
  }, [videoActive, videoRackEnabled, videoDirect, hdmiDirect, onlineDirectSource, lowPerformanceMode, state.requestNativeOutputForVst, t]);
  const playbackExclusion = useRef(new PlaybackExclusion());
  const playExclusive = useCallback((native: boolean, routeSessionId = "") => {
    const requested = usePlayerStore.getState();
    const token = `${requested.tracks[requested.currentIndex]?.id}:${requested.localPlayRequest}`;
    const valid = () => {
      const s = usePlayerStore.getState();
      return !videoActiveRef.current && s.playing && !s.onlineMedia?.playing && !s.hasPendingPlay()
        && token === `${s.tracks[s.currentIndex]?.id}:${s.localPlayRequest}`
        && (!native || (localNativeReady.current && routeSessionId === localRouteSession.current));
    };
    return playbackExclusion.current.run(valid, async () => {
      if (usePlayerStore.getState().onlineMedia) {
        const result = await window.desktop?.browser.mediaAction("pause");
        if (!result?.ok) throw new Error(result?.error || "无法暂停 YouTube");
      }
      if (native) await audioEngine.pause();
      else if (localRouteSession.current) {
        const result = await window.desktop?.nativeAudio.command({type:"pause", routeSource:"local", routeSessionId:localRouteSession.current, routeAction:"release"});
        if (!result?.ok) throw new Error(result?.error || "无法暂停原生输出");
      }
    }, async () => {
      audioEngine.clearOnlineAnalysis();
      if (native) {
        const result = await window.desktop?.nativeAudio.command({type:"play",routeSource:"local",routeSessionId,routeAction:"transport"});
        if (!result?.ok) throw new Error(result?.error || "原生播放失败");
      } else await audioEngine.play();
    });
  }, []);
  const stopLocalSourceForOnline = useCallback(() => {
    playbackExclusion.current.cancel();
    const latest = usePlayerStore.getState();
    const releasingVideo = isVideoTrack(latest.tracks[latest.currentIndex]);
    const routeSessionId = localRouteSession.current;
    // Invalidate pending loads immediately. Render effects may already have
    // cleared readiness; the route session still identifies the native source.
    localBackendGeneration.current++;
    localNativeReady.current = false;
    latest.cancelPendingPlay();
    latest.setPlaying(false);
    const browserPause = audioEngine.pause();
    const transition = localStopTransition.current
      .catch(() => undefined)
      .then(async () => {
        await videoTransition.current.catch(() => undefined);
        const closed = await window.desktop?.video.control("close");
        if (closed && !closed.ok) throw new Error(closed.error || "视频输出无法停止");
        if (releasingVideo) { await browserPause; return; }
        if (latest.uiSettings.hdmiDirectEnabled) await window.desktop?.nativeAudio.command({ type: "direct-close" });
        if (!routeSessionId) { await browserPause; return; }
        const paused = await window.desktop?.nativeAudio.command({
          type: "pause", routeSource: "local", routeSessionId, routeAction: "release"
        });
        if (paused && !paused.ok) throw new Error(paused.error || "本地 VST 播放器无法停止");
        await browserPause;
      });
    localStopTransition.current = transition;
    return transition;
  }, []);
  useEffect(() => { void usePlayerStore.getState().hydrateLibrary(); }, []);
  useEffect(() => { void useVstRackStore.getState().initialize(); void usePlayerStore.getState().restoreQueues(); }, []);
  useEffect(() => {
    const dispose = window.desktop?.externalOpen.onFiles(paths => {
      void usePlayerStore.getState().openExternalFiles(paths).then(() => {
        const result = usePlayerStore.getState();
        window.desktop?.externalOpen.report(paths.length, result.playing);
      });
    });
    void window.desktop?.externalOpen.ready();
    return dispose;
  }, []);
  useEffect(() => {
    if ((state.activePage as string) === "均衡器") state.setActivePage("plugins");
  }, [state.activePage]);
  const toggleMaximize = () => window.desktop?.maximize();

  const nextLocal = useCallback(() => {
    const latest = usePlayerStore.getState();
    const index = nextQueueIndex(latest.tracks.length, latest.currentIndex, latest.shuffle);
    if (index >= 0) void latest.playTrack(index, { navigateToNowPlaying: false });
  }, []);

  const handleLocalEnded = useCallback((expectedToken?: string) => {
    const latest = usePlayerStore.getState();
    const track = latest.tracks[latest.currentIndex];
    if (!track) return;
    const token = `${track.id}:${latest.localPlayRequest}`;
    if (expectedToken && expectedToken !== token) return;
    // A user-selected track being prepared takes precedence over automatic
    // queue advancement. Mark the exhausted source idle without cancelling it.
    if (latest.hasPendingPlay()) {
      latest.setPlaybackObserved(false);
      return;
    }
    if (!localPlaybackEndLatch.current.claim(token)) return;
    if (isVideoTrack(track) && latest.repeat === "one") { void latest.playTrack(latest.currentIndex, { navigateToNowPlaying: false }); return; }

    if (latest.repeat !== "one") {
      const index = nextQueueIndexAfterEnd(latest.tracks.length, latest.currentIndex, latest.shuffle, latest.repeat);
      if (index >= 0) {
        completedLocalPlaybackToken.current = token;
        void latest.playTrack(index, { navigateToNowPlaying: false });
      } else {
        latest.setPlaying(false);
      }
      return;
    }

    void (async () => {
      const replayRouteSession = localRouteSession.current;
      const nativeReplay = playbackBackend.current.trackId === track.id
        && playbackBackend.current.native
        && localNativeReady.current;
      const replayIsCurrent = () => {
        const now = usePlayerStore.getState();
        const currentTrack = now.tracks[now.currentIndex];
        return currentTrack && `${currentTrack.id}:${now.localPlayRequest}` === token
          && !now.hasPendingPlay()
          && (!nativeReplay || (now.playing && localNativeReady.current
            && localRouteSession.current === replayRouteSession
            && playbackBackend.current.native && playbackBackend.current.trackId === track.id));
      };
      try {
        if (nativeReplay) {
          const seek = await window.desktop?.nativeAudio.command({ type: "seek", position: 0 });
          if (!replayIsCurrent()) return;
          if (seek && !seek.ok) throw new Error(seek.error || "原生播放器无法重置单曲循环");
          await playExclusive(true, replayRouteSession);
          if (!replayIsCurrent()) return;
        } else {
          audioEngine.seek(0);
          await playExclusive(false);
          if (!replayIsCurrent()) return;
        }
        latest.setTiming(0, latest.duration);
      } catch (error) {
        if (!replayIsCurrent()) return;
        usePlayerStore.getState().setPlaying(false);
        setDeviceError(error instanceof Error ? error.message : "单曲循环重新播放失败");
      } finally {
        localPlaybackEndLatch.current.release(token);
      }
    })();
  }, []);

  const rememberedOutputLabel = (id: string) => {
    if (id === "default") return "";
    return devices.find(device => device.id === id)?.label
      || (id === selectedOutputIdRef.current ? selectedOutputLabelRef.current : "");
  };
  const outputLabelKey = (label: string) => label
    .replace(/^(?:default|communications?|默认|通信|通讯)\s*[-–—:]\s*/i, "")
    .trim()
    .toLocaleLowerCase();

  const previousLocal = () => {
    if (!state.tracks.length) return;
    if (usePlayerStore.getState().currentTime > 3) {
      if (nativePlayback) void window.desktop?.nativeAudio.command({ type: "seek", position: 0 });
      else audioEngine.seek(0);
      return;
    }
    void state.playTrack((state.currentIndex - 1 + state.tracks.length) % state.tracks.length, { navigateToNowPlaying: false });
  };

  useEffect(() => {
    if (!current) { setVideoPreparing(""); ++localBackendGeneration.current; videoTransition.current = videoTransition.current.catch(() => undefined).then(async () => { await window.desktop?.video.control("close"); }); return; }
    const backendGeneration = ++localBackendGeneration.current;
    if (videoActive) {
      setVideoPreparing("video.preparing.stop");
      localNativeReady.current = false;
      playbackExclusion.current.cancel();
      const token = `${current.id}:${state.localPlayRequest}`;
      const positionAtSwitch = usePlayerStore.getState().currentTime;
      videoTransition.current = videoTransition.current.catch(() => undefined).then(async () => {
        if (backendGeneration !== localBackendGeneration.current) return;
        const resumePosition = videoState?.playbackToken === token ? videoState.position : positionAtSwitch || videoBookmarks.current.get(current.id) || 0;
        await window.desktop?.video.control("close");
        await audioEngine.pause();
        audioEngine.stopNativePcmCapture(); audioEngine.resetAnalysis();
        if (usePlayerStore.getState().onlineMedia?.playing) await window.desktop?.browser.mediaAction("pause");
        if (backendGeneration !== localBackendGeneration.current) return;
        const vst = useVstRackStore.getState();
        const rackPlugins = videoRackEnabled && !videoDirect ? toNativeRackPayload(vst.videoRack) : null;
        setVideoPreparing(rackPlugins ? "video.preparing.rack" : "video.preparing.open");
        const result = await window.desktop?.video.open(current.sourcePath!, videoDirect, token, rackPlugins);
        if (!result?.ok) throw new Error(result?.error || "视频打开失败");
        if (backendGeneration !== localBackendGeneration.current) return;
        setVideoPreparing("video.preparing.align");
        const prepareControl = async (action: string, value?: number) => {
          if (backendGeneration !== localBackendGeneration.current) throw new Error("VIDEO_PREPARE_SUPERSEDED");
          const reply = await window.desktop?.video.control(action, value);
          if (!reply?.ok) throw new Error(reply?.error || "VIDEO_PREPARE_FAILED");
        };
        if (resumePosition > 0) await prepareControl("seek", resumePosition);
        const latest = usePlayerStore.getState();
        if (!videoDirect) await prepareControl("volume", latest.muted ? 0 : latest.volume * 100);
        await prepareControl(latest.playing ? "play" : "pause");
      }).catch(error => { if (backendGeneration === localBackendGeneration.current) { state.setPlaying(false); setDeviceError(String(error)); } }).finally(() => { if (backendGeneration === localBackendGeneration.current) setVideoPreparing(""); });
      return;
    }
    setVideoPreparing("");
    const previousRouteSession = localRouteSession.current;
    const routeSessionId = `local:${backendGeneration}`;
    const playbackToken = `${current.id}:${state.localPlayRequest}`;
    localNativeReady.current = false;
    const backendSuperseded = () => backendGeneration !== localBackendGeneration.current;
    const previousBackend = playbackBackend.current;
    const switchingTrack = Boolean(previousBackend.trackId && previousBackend.trackId !== current.id);
    const previousTrackCompleted = Boolean(
      switchingTrack
      && previousBackend.playbackToken
      && completedLocalPlaybackToken.current === previousBackend.playbackToken
    );
    if (previousTrackCompleted) completedLocalPlaybackToken.current = "";
    const resumePosition = usePlayerStore.getState().currentTime;
    // Online tracks are deliberately hard-switched in stable mode.  Preserve
    // the configured transition only when both sides of the handoff are local.
    const onlineTransition = current.format === "NETEASE" || previousBackend.format === "NETEASE";
    const effectiveFadeMs = hdmiDirect || lowPerformanceMode || onlineTransition ? 0 : state.fadeMs;
    const trackTransitionWillFade = switchingTrack && !previousTrackCompleted && state.playing && effectiveFadeMs > 0;
    localTrackTransitionGeneration.current = trackTransitionWillFade ? backendGeneration : 0;
    const finishTrackTransition = () => {
      if (localTrackTransitionGeneration.current === backendGeneration) localTrackTransitionGeneration.current = 0;
    };
    playbackBackend.current = { trackId: current.id, native: nativePlayback, playbackToken, format: current.format };
    const fadeOutPreviousTrack = async () => {
      await videoTransition.current.catch(() => undefined);
      await window.desktop?.video.control("close");
      if (backendSuperseded()) return;
      if (usePlayerStore.getState().playing) { audioEngine.resumeAnalysis(); setVisualStopped(false); }
      if (!switchingTrack || previousTrackCompleted || !state.playing || effectiveFadeMs <= 0) return;
      if (previousBackend.native) {
        if (!previousRouteSession) return;
        await window.desktop?.nativeAudio.command({
          type: "pause", routeSource: "local", routeSessionId: previousRouteSession, routeAction: "release"
        });
        if (!backendSuperseded()) await waitForAudioTransition(effectiveFadeMs);
        return;
      }
      await audioEngine.pause();
    };
    if (nativePlayback) {
      localRouteSession.current = routeSessionId;
      void (async () => {
        try {
          await fadeOutPreviousTrack();
          if (backendSuperseded()) return;
          void audioEngine.pause();
          if (hdmiDirect) {
            await window.desktop?.nativeAudio.command({ type: "pause" });
            const probe = await window.desktop?.nativeAudio.command({ type: "direct-probe", endpointId: state.uiSettings.hdmiEndpointId });
            if (!probe?.ok) throw new Error(probe?.error || t("device.hdmiUnavailable"));
            setDeviceError(t("device.hdmiPreparing"));
            const prepared = await window.desktop?.library.prepareDirect(current.sourcePath || current.nativePath!);
            if (backendSuperseded()) return;
            if (!prepared?.ok) throw new Error(prepared?.error || t("device.hdmiUnavailable"));
            setDeviceError("");
          }
          await window.desktop?.nativeAudio.command({ type: "enable", enabled: true });
          if (backendSuperseded()) return;
          const vst = useVstRackStore.getState();
          if (!hdmiDirect) await window.desktop?.nativeAudio.command({ type: "rack", plugins: vst.nativeEnabled ? toNativeRackPayload(vst.rack) : [] });
          if (backendSuperseded()) return;
          const loaded = await window.desktop?.nativeAudio.command({
            type: "load", path: current.nativePath,
            ...(hdmiDirect ? { direct: true, sourcePath: current.sourcePath || current.nativePath, endpointId: state.uiSettings.hdmiEndpointId } : {}),
            playbackToken,
            routeSource: "local", routeSessionId, routeAction: "prepare"
          });
          if (backendSuperseded()) return;
          if (!loaded?.ok) { setDeviceError(loaded?.error || "原生引擎无法加载音频"); state.setPlaying(false); return; }
          if (resumePosition > 0) await window.desktop?.nativeAudio.command({ type: "seek", position: resumePosition });
          if (backendSuperseded()) return;
          {
            const live = usePlayerStore.getState();
            await window.desktop?.nativeAudio.command({ type: "volume", value: live.muted ? 0 : live.volume });
          }
          if (backendSuperseded()) return;
          localNativeReady.current = true;
          if (usePlayerStore.getState().playing) await playExclusive(true, routeSessionId);
          if (backendSuperseded()) return;
          audioEngine.clearOnlineAnalysis();
          audioEngine.useNativeAnalysis();
        } catch (error) {
          if (!backendSuperseded()) {
            usePlayerStore.getState().setPlaying(false);
            setDeviceError(error instanceof Error ? error.message : "声源切换失败");
          }
        } finally {
          finishTrackTransition();
        }
      })();
    } else if (onlinePlaybackSession) {
      // The online capture effect reuses the same JUCE engine. Sending
      // enable(false) here races with pcm-start and can stop the new source.
      void audioEngine.pause();
      finishTrackTransition();
    } else {
      void (async () => {
        try {
          await fadeOutPreviousTrack();
          if (backendSuperseded()) return;
          if (previousBackend.native && previousRouteSession) await window.desktop?.nativeAudio.command({
            type: "pause", routeSource: "local", routeSessionId: previousRouteSession, routeAction: "release"
          });
          if (backendSuperseded()) return;
          await window.desktop?.nativeAudio.command({ type: "enable", enabled: false });
          if (backendSuperseded()) return;
          audioEngine.useLocalAnalysis();
          audioEngine.load(current.url);
          if (resumePosition > 0) {
            const restorePosition = () => audioEngine.seek(resumePosition);
            audioEngine.element.addEventListener("loadedmetadata", restorePosition, { once: true });
          }
          if (usePlayerStore.getState().playing) {
            try { await playExclusive(false); }
            catch { usePlayerStore.getState().setPlaying(false); }
          }
        } finally {
          finishTrackTransition();
        }
      })();
    }
  // Preparing APE/DSF/WMA keeps the track id but replaces its playable URL and
  // native path. Listen to both so the decoded cache file is actually loaded.
  }, [current?.id, current?.url, current?.nativePath, state.localPlayRequest, nativePlayback, onlinePlaybackSession, hdmiDirect, state.uiSettings.hdmiEndpointId, videoActive, videoDirect, videoRackEnabled]);

  useEffect(() => {
    if (!current) return;
    if (videoActive) {
      previousLocalPlaying.current = false;
      const token = `${current.id}:${state.localPlayRequest}`;
      if (!videoPreparing && videoState?.ready && videoState.playbackToken === token)
        void window.desktop?.video.control(state.playing ? "play" : "pause");
      return;
    }
    if (state.onlineMedia?.playing) {
      previousLocalPlaying.current = false;
      return;
    }
    const startedLocal = state.playing && !previousLocalPlaying.current;
    if (startedLocal && state.onlineMedia?.playing) {
      // Keep the browser and both local playback backends mutually exclusive.
      void window.desktop?.browser.mediaAction("pause");
    }
    if (startedLocal && nativePlayback) {
      // Native visualization comes directly from JUCE's post-VST buffer and
      // does not depend on a Windows loopback endpoint.
      audioEngine.clearOnlineAnalysis();
      audioEngine.useNativeAnalysis();
    } else if (startedLocal) {
      audioEngine.clearOnlineAnalysis();
      audioEngine.useLocalAnalysis();
    }
    if (localTrackTransitionGeneration.current === localBackendGeneration.current) {
      previousLocalPlaying.current = state.playing;
      return;
    }
    if (nativePlayback) {
      // Loading owns the initial play decision. Transport effects may only
      // address a backend that has completed enable/rack/load successfully.
      if (localNativeReady.current) {
        if (state.playing) void playExclusive(true, localRouteSession.current).catch(() => state.setPlaying(false));
        else void window.desktop?.nativeAudio.command({type:"pause",routeSource:"local",routeSessionId:localRouteSession.current,routeAction:"transport"});
      }
      previousLocalPlaying.current = state.playing;
      return;
    }
    if (state.playing) {
      playExclusive(false).catch(() => state.setPlaying(false));
    } else audioEngine.pause();
    previousLocalPlaying.current = state.playing;
  }, [state.playing, nativePlayback, state.onlineMedia?.playing, videoActive, videoState?.ready, videoPreparing]);

  useEffect(() => window.desktop?.video.onState(next => {
    setVideoState(next);
    const latest = usePlayerStore.getState(), track = latest.tracks[latest.currentIndex];
    const token = `${track?.id}:${latest.localPlayRequest}`;
    if (!isVideoTrack(track) || next.playbackToken !== token) return;
    if (next.error) { setDeviceError(next.error); latest.setPlaying(false); return; }
    if (!next.ready) return;
    latest.setTiming(next.position, next.duration);
    if (next.standalone) {
      if (latest.playing === next.paused) latest.setPlaying(!next.paused);
      if (!next.direct) { if (Math.abs(latest.volume-next.volume/100)>.001) latest.setVolume(next.volume/100); if (latest.muted!==Boolean(next.muted)) latest.setMuted(Boolean(next.muted)); }
    }
    if (next.ended) handleLocalEnded(token);
  }), [handleLocalEnded]);
  const detachVideo = useCallback(async () => {
    if (videoWindowBusy) return;
    setVideoWindowBusy(true);
    try { const result=await window.desktop?.video.control("detach",resolvedLanguage); if (!result?.ok) setDeviceError(result?.error || t("video.failed")); }
    finally { setVideoWindowBusy(false); }
  }, [videoWindowBusy, resolvedLanguage, t]);

  useEffect(() => {
    if (!videoActive && (state.playing || onlinePlaying)) {
      audioEngine.resumeAnalysis();
      setVisualStopped(false);
    }
  }, [state.playing, onlinePlaying, videoActive]);
  useEffect(() => {
    const fadeMs = lowPerformanceMode || current?.format === "NETEASE" ? 0 : state.fadeMs;
    audioEngine.setFade(fadeMs);
    if (nativePlayback)
      void window.desktop?.nativeAudio.command({ type: "fade", durationMs: fadeMs });
  }, [lowPerformanceMode, state.fadeMs, current?.format, nativePlayback]);
  useEffect(() => {
    audioEngine.setAnalysisDemand(analysisNeeded);
    audioEngine.setAnalysisConfig(lowPerformanceMode ? 512 : state.visualSettings.fftSize, lowPerformanceMode ? .58 : state.visualSettings.smoothing);
    window.desktop?.browser.setAnalysisConfig({
      enabled: analysisNeeded,
      fftSize: lowPerformanceMode ? 512 : state.visualSettings.fftSize,
      sampleRate: audioEngine.analysisSampleRate
    });
  }, [analysisNeeded, lowPerformanceMode, state.visualSettings.fftSize, state.visualSettings.smoothing]);

  useEffect(() => {
    const removeFrame = window.desktop?.browser.onAnalysis(frame => audioEngine.setOnlineAnalysis(frame));
    const removeReset = window.desktop?.browser.onAnalysisReset(() => audioEngine.clearOnlineAnalysis());
    return () => { removeFrame?.(); removeReset?.(); };
  }, []);

  useEffect(() => {
    if (videoActive) return;
    if (nativePlayback) {
      const statusTrackToken = current ? `${current.id}:${state.localPlayRequest}` : "";
      let nativeStatusCancelled = false;
      let statusTicks = 0;
      let statusPending = false;
      let statusFailures = 0;
      const statusStillCurrent = () => {
        const latest = usePlayerStore.getState();
        const track = latest.tracks[latest.currentIndex];
        return nativeStatusReady({
          cancelled: nativeStatusCancelled, ready: localNativeReady.current,
          native: playbackBackend.current.native, video: isVideoTrack(track),
          expected: statusTrackToken, backend: playbackBackend.current.playbackToken,
          current: track ? `${track.id}:${latest.localPlayRequest}` : ""
        });
      };
      const timer = window.setInterval(async () => {
        if (statusPending || !statusStillCurrent()) return;
        statusPending = true;
        const status = await window.desktop?.nativeAudio.command({ type: "status", analysis: analysisNeeded });
        statusPending = false;
        // Clearing an interval cannot cancel a status request that is already
        // in flight.  Once the route changes, never let its late reply switch
        // analysisSource back to a stale Native spectrum.
        if (!statusStillCurrent()) return;
        if (!status?.ok) {
          if (hdmiDirect) {
            usePlayerStore.getState().setPlaying(false);
            setDirectOutputLabel("");
            setDeviceError(`${t("device.hdmiStopped")}: ${status?.error || t("device.hdmiUnavailable")}`);
            return;
          }
          statusFailures++;
          if (statusFailures >= 1) {
            useVstRackStore.getState().markNativeUnavailable();
            setDeviceError("原生音频设备被中断，已保留播放位置并切回安全播放后端");
          }
          return;
        }
        statusFailures = 0;
        if (analysisNeeded) audioEngine.setNativeAnalysis(status);
        // Analysis packets run at ~30 Hz; keep React timing updates near 6 Hz
        // so the canvas remains imperative and the application UI stays calm.
        if (nativePlayback && (!analysisNeeded || (statusTicks++ % 5) === 0)) {
          if (status.directOutput) setDirectOutputLabel(`${status.directCodec?.toUpperCase()} · ${status.sampleRate?.toLocaleString()} Hz · ${status.outputBitDepth} bit · ${status.outputChannels} ch`);
          const latest = usePlayerStore.getState();
          const latestTrack = latest.tracks[latest.currentIndex];
          if (!latestTrack || `${latestTrack.id}:${latest.localPlayRequest}` !== statusTrackToken) return;
          const reportedDuration = typeof status.duration === "number" && Number.isFinite(status.duration) && status.duration > 0 ? status.duration : metadataDuration;
          latest.setTiming(status.position || 0, reportedDuration);
          const backendReadyForTrack = localNativeReady.current
            && playbackBackend.current.native
            && playbackBackend.current.trackId === latestTrack.id;
          if (latest.playing && nativeStatusCompletesTrack(status, statusTrackToken, backendReadyForTrack))
            handleLocalEnded(statusTrackToken);
        }
      }, analysisNeeded ? 50 : 500);
      return () => {
        nativeStatusCancelled = true;
        window.clearInterval(timer);
      };
    }
    const sync = () => {
      const currentTime = audioEngine.element.currentTime;
      const mediaDuration = audioEngine.element.duration;
      const duration = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : metadataDuration;
      state.setTiming(currentTime, duration);
    };
    const cleanups = [
      audioEngine.on("timeupdate", sync), audioEngine.on("loadedmetadata", sync),
      audioEngine.on("ended", () => handleLocalEnded(`${current.id}:${state.localPlayRequest}`)),
      audioEngine.on("play", () => state.setPlaybackObserved(true)),
      audioEngine.on("pause", () => state.setPlaybackObserved(false))
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [handleLocalEnded, nativePlayback, state.localPlayRequest, current?.id, metadataDuration, hdmiDirect, analysisNeeded, videoActive]);

  const onlineAction = async (action: "toggle" | "stop" | "previous" | "next" | "seek" | "shuffle" | "repeat", value?: number) => {
    if (onlineTransportPending.current) return;
    if (action === "toggle") {
      onlineTransportPending.current = true;
      try {
        if (state.onlineMedia?.playing) {
          // Transport commands must take effect immediately. Waiting for a page
          // volume fade made every VST-backed pause feel hundreds of ms late.
          const paused = await window.desktop?.browser.mediaAction("pause");
          if (paused && !paused.ok) setDeviceError(paused.error || "YouTube 暂停失败");
          return;
        }

        // Moving from a local VST source to YouTube is a single transaction:
        // silence both local backends first, then start the browser source.
        await stopLocalSourceForOnline();
        const started = await window.desktop?.browser.mediaAction("play", value);
        if (started && !started.ok) { setDeviceError(started.error || "YouTube 播放失败"); return; }
        return;
      } catch (error) {
        setDeviceError(error instanceof Error ? error.message : "声源切换失败");
        return;
      } finally {
        onlineTransportPending.current = false;
      }
    }
    const result = await window.desktop?.browser.mediaAction(action, value);
    if (result && !result.ok) setDeviceError(result.error || "在线媒体控制失败");
  };
  const next = () => onlineSession ? void onlineAction("next") : nextLocal();
  const previous = () => onlineSession ? void onlineAction("previous") : previousLocal();
  const togglePlayback = () => onlineSession ? void onlineAction("toggle") : state.setPlaying(!state.playing);
  const stopPlayback = () => {
    if (videoActive && !onlineSession) { state.setPlaying(false); void window.desktop?.video.control("pause").then(() => window.desktop?.video.control("seek", 0)); return; }
    if (onlineSession) {
      if (onlinePlaying) void onlineAction("toggle");
      if (onlinePlaying || !state.playing) return;
    }
    audioEngine.resetAnalysis();
    setVisualStopped(true);
    state.setPlaying(false);
    state.setTiming(0, state.duration);
    if (nativePlayback) {
      void window.desktop?.nativeAudio.command({ type: "pause" });
      void window.desktop?.nativeAudio.command({ type: "seek", position: 0 });
    } else audioEngine.stop();
  };
  const seek = (time: number) => videoActive && !onlineSession ? void window.desktop?.video.control("seek", time) : onlineSession ? void onlineAction("seek", time) : nativePlayback ? void window.desktop?.nativeAudio.command({ type: "seek", position: time }) : audioEngine.seek(time);
  usePlaybackShortcuts({
    enabled: Boolean(current) && !onlineSession && state.activePage === "nowPlaying" && !(videoActive && videoState?.standalone),
    video: videoActive, direct: videoActive ? videoDirect : hdmiDirect,
    mediaKey: `${current?.id}:${state.localPlayRequest}`, duration: displayDuration, seek,
    restoreVolume: () => lastAudibleVolume.current
  });
  const toggleShuffle = () => onlineSession ? void onlineAction("shuffle") : state.setShuffle(!state.shuffle);
  const toggleRepeat = () => onlineSession ? void onlineAction("repeat") : state.cycleRepeat();
  mediaKeyHandler.current = (action) => {
    if (action === "toggle") togglePlayback();
    else if (action === "previous") previous();
    else if (action === "next") next();
    else stopPlayback();
  };
  onlinePlayIntentHandler.current = () => { void onlineAction("toggle"); };

  const refreshDevices = useCallback(async () => {
    try { setDevices(await audioEngine.listOutputs()); } catch (error) { setDeviceError((error as Error).message); }
  }, []);
  useEffect(() => {
    void refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    const handleWindowModeKeyDown = (event: KeyboardEvent) => {
      if (videoActiveRef.current && (event.key === "F11" || event.key === "Escape")) {
        event.preventDefault(); if (event.key === "F11") void detachVideo(); return;
      }
      if (event.key === "F11") {
        event.preventDefault();
        if (immersiveMode) {
          exitImmersiveMode();
        } else {
          state.setActivePage("nowPlaying");
          setVisualSettingsOpen(false);
          setImmersiveMode(true);
        }
      } else if (event.key === "Escape" && immersiveMode) {
        exitImmersiveMode();
      } else if (event.key === "Escape" && state.obsMode) {
        state.setObsMode(false);
      }
    };
    window.addEventListener("keydown", handleWindowModeKeyDown);
    return () => window.removeEventListener("keydown", handleWindowModeKeyDown);
  }, [state.obsMode, immersiveMode, setImmersiveMode, exitImmersiveMode, detachVideo]);
  useEffect(() => {
    void useVstRackStore.getState().setPerformanceSuspended(lowPerformanceMode);
  }, [lowPerformanceMode]);
  useEffect(() => {
    // Wallpaper already has an opaque backing. A second DWM material is
    // invisible inside the page but can show through its transparent corners.
    window.desktop?.setWindowGlass(
      state.obsMode || lowPerformanceMode || customBackgroundActive ? "none" : state.uiSettings.glassMaterial
    );
  }, [state.obsMode, lowPerformanceMode, customBackgroundActive, state.uiSettings.glassMaterial]);
  useEffect(() => {
    window.desktop?.setColorTheme(state.uiSettings.colorMode);
    document.documentElement.style.colorScheme = lightTheme ? "light" : "dark";
  }, [state.uiSettings.colorMode, lightTheme]);

  useEffect(() => window.desktop?.browser.onMedia((media) => {
    const latest = usePlayerStore.getState();
    if (media.playing && (!latest.onlineMedia?.playing || latest.playing || latest.hasPendingPlay())) {
      void stopLocalSourceForOnline().catch(error => {
        void window.desktop?.browser.mediaAction("pause");
        setDeviceError(error instanceof Error ? error.message : "无法暂停其他声源");
      });
    }
    latest.setOnlineMedia(media);
  }), [stopLocalSourceForOnline]);
  useEffect(() => window.desktop?.browser.onPlayIntent(() => onlinePlayIntentHandler.current()), []);
  useEffect(() => window.desktop?.onMediaKey((action) => mediaKeyHandler.current(action)), []);
  useEffect(() => {
    const clearDragState = () => {
      dragDepth.current = 0;
      setDragging(false);
    };
    const watchdog = window.setInterval(() => {
      if (dragDepth.current > 0 && performance.now() - lastDragEvent.current > 700) clearDragState();
    }, 250);
    window.addEventListener("blur", clearDragState);
    window.addEventListener("dragend", clearDragState);
    window.addEventListener("drop", clearDragState);
    return () => {
      window.clearInterval(watchdog);
      window.removeEventListener("blur", clearDragState);
      window.removeEventListener("dragend", clearDragState);
      window.removeEventListener("drop", clearDragState);
    };
  }, []);
  useEffect(() => {
    if (!queueOpen && !videoVolumeOpen && !visualSettingsOpen) return;
    const closePopoversOutside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (visualSettingsOpen && !target.closest(".visual-settings-panel") && !target.closest(".visual-settings-trigger")) {
        setVisualSettingsOpen(false);
      }
      if (queueOpen && !target.closest(".queue-drawer") && !target.closest(".playback-queue-button") && !target.closest(".video-queue-trigger")) {
        setQueueOpen(false);
      }
      if (videoVolumeOpen && !target.closest(".video-volume-drawer") && !target.closest(".video-volume-trigger")) {
        setVideoVolumeOpen(false);
      }
    };
    document.addEventListener("pointerdown", closePopoversOutside, true);
    return () => document.removeEventListener("pointerdown", closePopoversOutside, true);
  }, [queueOpen, videoVolumeOpen, visualSettingsOpen]);
  useEffect(() => {
    const onlinePlayingNow = Boolean(state.onlineMedia?.playing);
    if (onlinePlayingNow && !previousOnlinePlaying.current) {
      // YouTube owns playback as soon as it starts. Stop both possible local
      // backends; pausing only the HTMLAudioElement leaves the JUCE/VST path live.
      void stopLocalSourceForOnline().catch(error => {
        setDeviceError(error instanceof Error ? error.message : "本地声源停止失败");
      });
  
      audioEngine.useOnlineAnalysis();
    } else if (!onlinePlayingNow && previousOnlinePlaying.current && state.playing) {
      audioEngine.useLocalAnalysis();
    } else if (!onlinePlayingNow && previousOnlinePlaying.current) {
      audioEngine.clearOnlineAnalysis();
    }
    previousOnlinePlaying.current = onlinePlayingNow;
  }, [state.onlineMedia?.playing, stopLocalSourceForOnline]);

  useEffect(() => {
    const shouldOwnDirectRoute = Boolean(state.onlineMedia?.playing);
    if (shouldOwnDirectRoute && !webDirectRouteSession.current) {
      const generation = ++webDirectRouteGeneration.current;
      const sessionId = `web-direct:${generation}`;
      void stopLocalSourceForOnline().then(() => {
        if (generation !== webDirectRouteGeneration.current
          || !usePlayerStore.getState().onlineMedia?.playing) return;
        webDirectRouteSession.current = sessionId;
        void window.desktop?.audioRoute.claim("web-direct", sessionId);
      }).catch(error => setDeviceError(error instanceof Error ? error.message : "Web Direct 路由切换失败"));
      return () => { webDirectRouteGeneration.current++; };
    }
    if (!shouldOwnDirectRoute && webDirectRouteSession.current) {
      const sessionId = webDirectRouteSession.current;
      webDirectRouteSession.current = "";
      void window.desktop?.audioRoute.release("web-direct", sessionId);
    }
  }, [state.onlineMedia?.playing, stopLocalSourceForOnline]);

  const selectDevice = async (id: string, options: { silent?: boolean } = {}) => {
    if (!options.silent) setDeviceError("");
    const label = rememberedOutputLabel(id);
    const [localResult, onlineResult] = await Promise.allSettled([
      audioEngine.setOutput(id),
      window.desktop?.browser.setOutput(id === "default" ? "default" : label, id === "default")
    ]);
    const localOk = localResult.status === "fulfilled";
    const onlineOk = onlineResult.status === "fulfilled" && (!onlineResult.value || onlineResult.value.ok);
    if (localOk && onlineOk) {
      selectedOutputIdRef.current = id;
      selectedOutputLabelRef.current = label;
      setDeviceId(id);
      localStorage.setItem("auralis.output", id);
      if (id === "default") localStorage.removeItem("auralis.output.label");
      else if (label) localStorage.setItem("auralis.output.label", label);
    } else if (!options.silent) {
      const localMessage = localResult.status === "rejected" ? localResult.reason?.message : "";
      const onlineMessage = onlineResult.status === "rejected" ? onlineResult.reason?.message : onlineResult.value?.error;
      setDeviceError(localMessage || onlineMessage || "输出设备切换失败");
    }
  };

  useEffect(() => {
    if (!devices.length) return;
    const available = deviceId === "default" || devices.some((device) => device.id === deviceId);
    const selected = devices.find(device => device.id === deviceId);
    if (selected?.label) {
      selectedOutputIdRef.current = deviceId;
      selectedOutputLabelRef.current = selected.label;
      localStorage.setItem("auralis.output.label", selected.label);
    }
    window.clearTimeout(outputFallbackTimerRef.current);
    if (!restoredOutput.current) {
      restoredOutput.current = true;
      if (available) void selectDevice(deviceId, { silent: true });
    }
    if (!available) {
      const expectedDeviceId = deviceId;
      // Device endpoints can disappear briefly while the native backend opens
      // the next track. Confirm against a fresh enumeration before changing
      // the user's persistent output selection.
      outputFallbackTimerRef.current = window.setTimeout(async () => {
        const refreshed = await audioEngine.listOutputs().catch(() => [] as OutputDevice[]);
        setDevices(refreshed);
        if (selectedOutputIdRef.current !== expectedDeviceId) return;
        const restored = refreshed.some(device => device.id === expectedDeviceId);
        if (restored) {
          await selectDevice(expectedDeviceId);
          return;
        }
        const rememberedLabel = selectedOutputLabelRef.current;
        const replacement = rememberedLabel
          ? refreshed.find(device => outputLabelKey(device.label) === outputLabelKey(rememberedLabel))
          : undefined;
        if (replacement) {
          await selectDevice(replacement.id);
          return;
        }
        await selectDevice("default");
        setDeviceError("原输出设备已断开，已自动回退到系统默认输出");
      }, 2500);
    }
    return () => window.clearTimeout(outputFallbackTimerRef.current);
  }, [devices, deviceId]);

  const activeError = deviceError || state.libraryError;
  const dismissError = useCallback(() => {
    setDeviceError("");
    usePlayerStore.setState({ libraryError: "" });
  }, []);
  useEffect(() => {
    if (!activeError) return;
    const timer = window.setTimeout(dismissError, 4500);
    return () => window.clearTimeout(timer);
  }, [activeError, dismissError]);
  useEffect(() => {
    if (!vstNotice || windowBackgrounded || !pageVisible) return;
    const timer = window.setTimeout(() => setVstNotice(""), 6500);
    return () => window.clearTimeout(timer);
  }, [vstNotice, windowBackgrounded, pageVisible]);

  const importFiles = (files: File[]) => state.addTracks(files);
  const deviceName = devices.find((device) => device.id === deviceId)?.label || t("common.defaultOutput");
  const effectiveVisualSettings = useMemo(
    () => resolveVisualizerSettings(state.visualSettings, lowPerformanceMode),
    [state.visualSettings, lowPerformanceMode]
  );
  const videoSidebarMode = (videoActive || videoLanding) && renderedPage === "nowPlaying" && !compactMode;
  const videoSidebarControls = useMemo(() => videoSidebarMode
    ? <WithStoreVolume>{(volume, muted) => <VideoChannelStrip direct={videoDirect} rackAudio={Boolean(videoState?.rackAudio)}
        volume={volume} muted={muted} restoreVolume={lastAudibleVolume.current} plugins={videoRackItems}
        onVolume={state.setVolume} onMuted={state.setMuted} />}</WithStoreVolume>
    : undefined,
    [videoSidebarMode, videoDirect, videoState?.rackAudio, videoRackItems, state.setVolume, state.setMuted, lastAudibleVolume]);
  const toggleVideoQueue = () => { setVideoVolumeOpen(false); setVisualSettingsOpen(false); setQueueOpen(open => !open); };
  const toggleVideoVolume = () => { setQueueOpen(false); setVisualSettingsOpen(false); setVideoVolumeOpen(open => !open); };

  // A press on a drag region (the titlebar) is a Windows caption click and never
  // reaches the page, so click-outside handlers cannot see it. While a popover
  // is open the titlebar stops being a drag region; the first press closes the
  // popover and dragging works again right after.
  const transientPopoverOpen = queueOpen || videoVolumeOpen || visualSettingsOpen || channelStripOpen;
  return <main
    className={`app-shell ${videoSidebarMode ? `video-layout ${queueOpen ? "video-queue-open" : ""} ${videoVolumeOpen ? "video-volume-open" : ""}` : ""} ${visualsVisible ? "" : "visuals-suspended"} ${lightTheme ? "theme-light" : "theme-dark"} ${maximized ? "maximized" : ""} ${transientPopoverOpen ? "popover-open" : ""} ${dragging ? "dragging" : ""} ${state.obsMode ? "obs-mode" : ""} ${!state.obsMode && !lowPerformanceMode && state.uiSettings.glassMaterial !== "none" ? (!customBackgroundActive ? "native-glass" : "css-glass") : "glass-off"} ${immersiveMode ? "immersive-mode" : ""} ${compactMode ? "compact-mode" : ""} ${customBackgroundActive ? "has-custom-background" : ""} ${motionEnabled ? "" : "animations-off"} ${lowPerformanceMode ? "low-performance-mode" : ""} ${gpuEffectsActive ? `gpu-effects-on gpu-effects-${gpuEffectsQuality}` : ""}`}
    style={{
      "--accent": state.accent,
      "--meter-peak": contrastPeakColor(state.accent),
      "--window-opacity": lowPerformanceMode ? 1 : state.uiSettings.windowOpacity,
      "--custom-background-brightness": 1,
      "--light-surface": lightSurface,
      "--window-blur": lowPerformanceMode || state.uiSettings.glassMaterial === "none" ? "0px" : `${state.uiSettings.blurStrength}px`,
      "--glow-strength": effectiveGlowStrength,
      "--corner-radius": "0px"
    } as React.CSSProperties}
    onDragEnter={(event) => {
      if (!isAudioFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      if (immersiveMode) {
        dragDepth.current = 0;
        setDragging(false);
        return;
      }
      dragDepth.current += 1;
      lastDragEvent.current = performance.now();
      setDragging(true);
    }}
    onDragOver={(event) => {
      if (!isAudioFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      if (immersiveMode) return;
      lastDragEvent.current = performance.now();
      if (!dragging) setDragging(true);
    }}
    onDragLeave={(event) => {
      if (!isAudioFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      lastDragEvent.current = performance.now();
      if (dragDepth.current === 0) setDragging(false);
    }}
    onDrop={(event) => {
      if (!isAudioFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (immersiveMode) return;
      importFiles(Array.from(event.dataTransfer.files));
    }}
  >
    <AmbientBackground enabled={!state.obsMode && !lowPerformanceMode}
      accent={state.accent} light={lightTheme} lightSurface={lightSurface}
      opacity={state.uiSettings.windowOpacity} customBackground={customBackgroundActive}
      gpu={gpuEffectsActive} quality={gpuEffectsQuality} />
    {customBackgroundActive && <BackgroundSlideshow url={state.uiSettings.customBackgroundUrl} />}
    {backgroundMenu && <div style={{position:"fixed",inset:0,zIndex:9999}} onClick={()=>setBackgroundMenu(null)} onContextMenu={e=>{e.preventDefault();setBackgroundMenu(null);}}>
      <button role="menuitem" autoFocus style={{position:"absolute",left:backgroundMenu.x,top:backgroundMenu.y,padding:"12px 18px",borderRadius:8,background:"#16262e",border:"1px solid #3b535d"}} onKeyDown={e=>{if(e.key==="Escape")setBackgroundMenu(null);}} onClick={nextBackground}>{t("background.next")}</button>
    </div>}
    <AtmosphereLayer accent={state.accent} cover={displayCover} trackKey={`${onlineSession ? displayName : current?.id || ""}|${displayCover || ""}`}
      playing={playbackActive} disabled={videoActive || lowPerformanceMode || state.obsMode || compactMode || immersiveMode}
      motion={motionEnabled} visible={visualsVisible} />

    <header className="titlebar">
      <div className="brand">
        <div className="brand-lockup" role="img" aria-label="ASTRELIS" />
      </div>
      <div className="now-status"><i /><div className="now-status-copy"><span>NOW PLAYING</span><b>{displayName || t("common.waitingAudio")}</b></div></div>
      <div
        className={`titlebar-vst-mode ${vstControlActive ? "active" : ""} ${vstControlPending ? "pending" : ""} ${vstControlLocked ? "locked" : ""} ${vstControlNativeRequired ? "native-required" : ""}`}
        title={vstControlDetail}
        role="status"
        aria-live="polite"
        aria-label={vstControlDetail}
      ><Blocks /><span>{vstControlLabel}</span><i /></div>
      <div className="window-actions">
        <button className={`compact-toggle ${compactMode ? "active" : ""}`} title={t(compactMode ? "common.exitCompactMode" : "common.compactMode")} onDoubleClick={(e) => e.stopPropagation()} onClick={() => {
          const enabled = !compactMode;
          setCompactMode(enabled);
          window.desktop?.setCompact(enabled);
        }}><PictureInPicture2 /></button>
        <button className="window-minimize" title={t("common.minimize")} onDoubleClick={(e) => e.stopPropagation()} onClick={() => window.desktop?.minimize()}><Minus /></button>
        <button className="window-maximize" title={t(maximized ? "common.restore" : "common.maximize")} onDoubleClick={(e) => e.stopPropagation()} onClick={toggleMaximize}>{maximized ? <Copy /> : <Square />}</button>
        <button title={t("common.close")} className="close" onDoubleClick={(e) => e.stopPropagation()} onClick={() => window.desktop?.close()}><X /></button>
      </div>
    </header>
    {immersiveMode && <div
      className="immersive-drag-zone"
      title={t("visual.dragMaxRestore")}
    />}
    {immersiveMode && !maximized && ["n", "ne", "e", "se", "s", "sw", "w", "nw"].map(edge => <div
      key={edge}
      className={`immersive-resize-handle resize-${edge}`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        window.desktop?.beginResize(edge);
      }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        if ((event.buttons & 1) === 0) {
          event.currentTarget.releasePointerCapture(event.pointerId);
          window.desktop?.endResize();
        } else window.desktop?.resizeTo();
      }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); window.desktop?.endResize(); }}
      onPointerCancel={() => window.desktop?.endResize()}
      onLostPointerCapture={() => window.desktop?.endResize()}
    />)}

    <div className={`workspace ${showMeters ? "" : "workspace-focus"}`} onContextMenu={e=>{
      if(renderedPage!=="nowPlaying" || !customBackgroundActive || state.uiSettings.backgroundImages.length<2) return;
      e.preventDefault();setBackgroundMenu({x:Math.max(0,Math.min(e.clientX,window.innerWidth-180)),y:Math.max(0,Math.min(e.clientY,window.innerHeight-50))});
    }}>
      <aside className="sidebar">
        <nav>{nav.map(([Icon, id, key]) => <button className={state.activePage === id ? "active" : ""} onClick={() => {
          if (id === "plugins" && !state.requestNativeOutputForVst()) return;
          state.setActivePage(id as PageId);
        }} key={id} title={t(key)} aria-current={state.activePage === id ? "page" : undefined}><Icon /><span>{t(key)}</span></button>)}</nav>
        <div className="sidebar-bottom">
          <button className="import-button resume-video-button" title={t("video.title")} onClick={() => {
            state.switchQueue("video");
            const tracks = usePlayerStore.getState().tracks;
            const previous = tracks.findIndex(track => track.id === lastVideoId && isVideoTrack(track));
            const index = previous >= 0 ? previous : tracks.findIndex(isVideoTrack);
            closeQueue(); setChannelStripOpen(false); state.setActivePage("nowPlaying");
            if (index >= 0) { setVideoLanding(false); void state.playTrack(index); }
            else { state.setPlaying(false); state.setCurrentIndex(-1); state.setTiming(0, 0); setVideoLanding(true); }
          }}><Film /> {t("video.title")}</button>
          <button className="import-button file-import-button" onClick={() => fileRef.current?.click()}><Import /> {t("common.importFiles")}</button>
          <input ref={fileRef} type="file" multiple accept="audio/*,video/*,.mp4,.mkv,.mov,.m4v,.webm,.avi,.ts,.m2ts,.mpg,.mpeg,.wmv,.asf,.flv,.ogv,.3gp,.3g2,.f4v,.vob,.mxf,.rm,.rmvb,.mts,.m2t,.m1v,.m2v,.divx,.mpe,.m2p,.qt,.tp,.trp,.vro,.mpv,.flac,.m4a,.ape,.dsf,.aiff,.aif,.opus,.wma,.dts,.ac3,.eac3" hidden onChange={(event) => { void importFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
        </div>
      </aside>

      <div className={`workspace-page-transition ${state.activePage === "online" || renderedPage === "online" ? "native-browser-page" : ""} page-transition-${state.uiSettings.visualTransition} ${pageSwitchPhase === "idle" ? "" : `page-switch-${pageSwitchPhase}`}`}>
      {renderedPage === "nowPlaying" ? <section className={`center-stage `} onWheel={videoActive ? undefined : handleVisualizerWheel}>
        <div className="visual-head">
          <div><span className="eyebrow">{videoActive ? "VIDEO PLAYBACK" : "REALTIME ANALYSIS"}</span><b>{t(videoActive ? "video.title" : "visual.title")}</b></div>
          <div className="visual-head-actions" >
            <div className="mode-tabs" style={videoActive ? {display:"none"} : undefined}>{modes.map((mode) => <button className={state.visualizer === mode.id ? "active" : ""} onClick={() => switchVisualizer(mode.id)} key={mode.id}>{t(mode.key)}</button>)}</div>
            <button style={videoActive ? {display:"none"} : undefined} className={`visual-tune-toggle visual-settings-trigger ${visualSettingsOpen ? "active" : ""}`} title={t("visual.tune")} onClick={() => { if (!visualSettingsOpen) setQueueOpen(false); setVisualSettingsOpen(!visualSettingsOpen); }}><SlidersHorizontal /></button>
            <button className="visual-tune-toggle" title={`${t(videoActive ? "video.fullscreen" : "visual.immersive")}（F11）`} onClick={() => { setVisualSettingsOpen(false); if (videoActive) void detachVideo(); else setImmersiveMode(true); }}><Expand /></button>
          </div>
        </div>
        <div className={`visual-area visual-mode-${state.visualizer} visual-transition-${state.uiSettings.visualTransition} ${visualStopped ? "visual-stopped" : ""} ${visualSwitchPhase === "idle" ? "" : `visual-switch-${visualSwitchPhase}`}`}>
          {videoLanding ? <div className="video-empty-mode"><Film /><h2>{t("video.title")}</h2><p>{t("video.empty")}</p><div><button className="import-button" onClick={() => fileRef.current?.click()}><Import />{t("common.importFiles")}</button><button onClick={() => { setVideoLanding(false); closeQueue(); setVideoVolumeOpen(false); state.switchQueue("music"); state.setActivePage("nowPlaying"); }}>{t("video.return")}</button></div></div> : videoActive ? <VideoView preparing={videoPreparing} onFullscreen={()=>void detachVideo()} windowBusy={videoWindowBusy} onBack={() => { if (current) { setLastVideoId(current.id); videoBookmarks.current.set(current.id, videoState?.position || 0); } state.setPlaying(false); closeQueue(); setVideoVolumeOpen(false); state.switchQueue("music"); state.setActivePage("library"); }} state={videoState} direct={videoDirect} setDirect={setVideoDirect} rackEnabled={videoRackEnabled} setRackEnabled={setVideoRack} visible={pageVisible && !windowBackgrounded && !channelStripOpen && !dragging && !compactMode} /> : <div className="visualizer-transition-layer" key={`${state.visualizer}-${immersiveMode}`}>
            <VisualizerCanvas mode={state.visualizer} accent={state.accent} settings={effectiveVisualSettings} glowStrength={effectiveGlowStrength} playbackActive={lowPerformanceMode ? false : playbackActive} visible={visualsVisible} backgroundUrl={customBackgroundActive ? state.uiSettings.customBackgroundUrl : undefined} backgroundBrightness={1} backgroundOpacity={1 - state.uiSettings.windowOpacity} />
          </div>}
          {!videoActive && visualSettingsOpen && <div className="visual-settings-panel panel">
            <div className="visual-settings-title"><div><span className="eyebrow">VISUAL ENGINE</span><b>{t("visual.tune")}</b></div><button onClick={() => setVisualSettingsOpen(false)}><X /></button></div>
            <label><span>{t("visual.fftSize")} <b>{state.visualSettings.fftSize}</b></span><select value={state.visualSettings.fftSize} onChange={(e) => state.setVisualSetting("fftSize", Number(e.target.value) as 512 | 1024 | 2048 | 4096 | 8192)}>{[512, 1024, 2048, 4096, 8192].map((size) => <option key={size}>{size}</option>)}</select></label>
            <label><span>{t("visual.smoothing")} <b>{state.visualSettings.smoothing.toFixed(2)}</b></span><input type="range" min="0" max=".98" step=".01" value={state.visualSettings.smoothing} onDoubleClick={() => state.setVisualSetting("smoothing", .76)} onChange={(e) => state.setVisualSetting("smoothing", Number(e.target.value))} /></label>
            <label><span>{t("visual.sensitivity")} <b>{state.visualSettings.sensitivity.toFixed(2)}×</b></span><input type="range" min=".5" max="2" step=".05" value={state.visualSettings.sensitivity} onDoubleClick={() => state.setVisualSetting("sensitivity", 1)} onChange={(e) => state.setVisualSetting("sensitivity", Number(e.target.value))} /></label>
            <label><span>{t("visual.bars")} <b>{state.visualSettings.barCount}</b></span><input type="range" min="24" max="160" step="2" value={state.visualSettings.barCount} onDoubleClick={() => state.setVisualSetting("barCount", 90)} onChange={(e) => state.setVisualSetting("barCount", Number(e.target.value))} /></label>
            <label><span>{t("visual.barOpacity")} <b>{Math.round(state.visualSettings.barOpacity * 100)}%</b></span><input type="range" min="0" max="1" step=".05" value={state.visualSettings.barOpacity} onDoubleClick={() => state.setVisualSetting("barOpacity", 1)} onChange={(e) => state.setVisualSetting("barOpacity", Number(e.target.value))} /></label>
            <label><span>{t("visual.lineWidth")} <b>{state.visualSettings.lineWidth.toFixed(1)}</b></span><input type="range" min=".5" max="4" step=".1" value={state.visualSettings.lineWidth} onDoubleClick={() => state.setVisualSetting("lineWidth", 1.5)} onChange={(e) => state.setVisualSetting("lineWidth", Number(e.target.value))} /></label>
            <label><span>{t("visual.speed")} <b>{state.visualSettings.animationSpeed.toFixed(2)}×</b></span><input type="range" min=".25" max="2" step=".05" value={state.visualSettings.animationSpeed} onDoubleClick={() => state.setVisualSetting("animationSpeed", 1)} onChange={(e) => state.setVisualSetting("animationSpeed", Number(e.target.value))} /></label>
            <label><span>{t("visual.decay")} <b>{state.visualSettings.decaySpeed.toFixed(2).replace(/0$/, "")}/s</b></span><input type="range" min=".05" max="1" step=".05" value={state.visualSettings.decaySpeed} onDoubleClick={() => state.setVisualSetting("decaySpeed", 1)} onChange={(e) => state.setVisualSetting("decaySpeed", Number(e.target.value))} /></label>
            <label><span>{t("visual.peakHold")} <b>{state.visualSettings.peakHoldMs} ms</b></span><input type="range" min="0" max="2000" step="50" value={state.visualSettings.peakHoldMs} onDoubleClick={() => state.setVisualSetting("peakHoldMs", 650)} onChange={(e) => state.setVisualSetting("peakHoldMs", Number(e.target.value))} /></label>
            {false && <>
              <label><span>{t("visual.particleCount")}<b>{state.visualSettings.torusParticleCount.toLocaleString()}</b></span><input type="range" min="20000" max="120000" step="5000" value={state.visualSettings.torusParticleCount} onDoubleClick={() => state.setVisualSetting("torusParticleCount", 80000)} onChange={(e) => state.setVisualSetting("torusParticleCount", Number(e.target.value))} /></label>
              <label><span>{t("visual.torusSize")}<b>{state.visualSettings.torusRadius.toFixed(2)}</b></span><input type="range" min=".42" max=".78" step=".01" value={state.visualSettings.torusRadius} onDoubleClick={() => state.setVisualSetting("torusRadius", .61)} onChange={(e) => state.setVisualSetting("torusRadius", Number(e.target.value))} /></label>
              <label><span>{t("visual.torusThickness")}<b>{state.visualSettings.torusThickness.toFixed(2)}</b></span><input type="range" min=".08" max=".34" step=".005" value={state.visualSettings.torusThickness} onDoubleClick={() => state.setVisualSetting("torusThickness", .205)} onChange={(e) => state.setVisualSetting("torusThickness", Number(e.target.value))} /></label>
              <label><span>tangentialFlowSpeed <b>{state.visualSettings.tangentialFlowSpeed.toFixed(2)}×</b></span><input type="range" min=".2" max="2.5" step=".05" value={state.visualSettings.tangentialFlowSpeed} onDoubleClick={() => state.setVisualSetting("tangentialFlowSpeed", 1)} onChange={(e) => state.setVisualSetting("tangentialFlowSpeed", Number(e.target.value))} /></label>
              <label><span>curlNoiseStrength <b>{state.visualSettings.curlNoiseStrength.toFixed(2)}×</b></span><input type="range" min="0" max="2.5" step=".05" value={state.visualSettings.curlNoiseStrength} onDoubleClick={() => state.setVisualSetting("curlNoiseStrength", 1)} onChange={(e) => state.setVisualSetting("curlNoiseStrength", Number(e.target.value))} /></label>
              <label><span>{t("visual.lowResponse")}<b>{state.visualSettings.torusLowResponse.toFixed(2)}×</b></span><input type="range" min="0" max="2" step=".05" value={state.visualSettings.torusLowResponse} onDoubleClick={() => state.setVisualSetting("torusLowResponse", 1)} onChange={(e) => state.setVisualSetting("torusLowResponse", Number(e.target.value))} /></label>
              <label><span>{t("visual.midResponse")}<b>{state.visualSettings.torusMidResponse.toFixed(2)}×</b></span><input type="range" min="0" max="2" step=".05" value={state.visualSettings.torusMidResponse} onDoubleClick={() => state.setVisualSetting("torusMidResponse", 1)} onChange={(e) => state.setVisualSetting("torusMidResponse", Number(e.target.value))} /></label>
              <label><span>{t("visual.highResponse")}<b>{state.visualSettings.torusHighResponse.toFixed(2)}×</b></span><input type="range" min="0" max="2" step=".05" value={state.visualSettings.torusHighResponse} onDoubleClick={() => state.setVisualSetting("torusHighResponse", 1)} onChange={(e) => state.setVisualSetting("torusHighResponse", Number(e.target.value))} /></label>
              <label><span>impulsePropagationSpeed <b>{state.visualSettings.impulsePropagationSpeed.toFixed(2)}×</b></span><input type="range" min=".25" max="2.5" step=".05" value={state.visualSettings.impulsePropagationSpeed} onDoubleClick={() => state.setVisualSetting("impulsePropagationSpeed", 1)} onChange={(e) => state.setVisualSetting("impulsePropagationSpeed", Number(e.target.value))} /></label>
              <label><span>{t("visual.trail")}<b>{state.visualSettings.torusTrailStrength.toFixed(2)}</b></span><input type="range" min="0" max="1" step=".05" value={state.visualSettings.torusTrailStrength} onDoubleClick={() => state.setVisualSetting("torusTrailStrength", .35)} onChange={(e) => state.setVisualSetting("torusTrailStrength", Number(e.target.value))} /></label>
              <label><span>ringTilt <b>{state.visualSettings.ringTilt.toFixed(2)}</b></span><input type="range" min=".25" max="1.3" step=".025" value={state.visualSettings.ringTilt} onDoubleClick={() => state.setVisualSetting("ringTilt", .82)} onChange={(e) => state.setVisualSetting("ringTilt", Number(e.target.value))} /></label>
              <label><span>holeSize <b>{state.visualSettings.holeSize.toFixed(2)}</b></span><input type="range" min=".25" max=".7" step=".01" value={state.visualSettings.holeSize} onDoubleClick={() => state.setVisualSetting("holeSize", .48)} onChange={(e) => state.setVisualSetting("holeSize", Number(e.target.value))} /></label>
              <label><span>ringThicknessVariation <b>{state.visualSettings.ringThicknessVariation.toFixed(2)}</b></span><input type="range" min="0" max="1.5" step=".05" value={state.visualSettings.ringThicknessVariation} onDoubleClick={() => state.setVisualSetting("ringThicknessVariation", .55)} onChange={(e) => state.setVisualSetting("ringThicknessVariation", Number(e.target.value))} /></label>
              <label><span>particleStretch <b>{state.visualSettings.particleStretch.toFixed(2)}</b></span><input type="range" min="0" max="1.5" step=".05" value={state.visualSettings.particleStretch} onDoubleClick={() => state.setVisualSetting("particleStretch", .72)} onChange={(e) => state.setVisualSetting("particleStretch", Number(e.target.value))} /></label>
              <label><span>densityFalloff <b>{state.visualSettings.densityFalloff.toFixed(2)}</b></span><input type="range" min=".5" max="3" step=".05" value={state.visualSettings.densityFalloff} onDoubleClick={() => state.setVisualSetting("densityFalloff", 1.7)} onChange={(e) => state.setVisualSetting("densityFalloff", Number(e.target.value))} /></label>
              <label><span>asymmetry <b>{state.visualSettings.asymmetry.toFixed(2)}</b></span><input type="range" min="0" max="1.5" step=".05" value={state.visualSettings.asymmetry} onDoubleClick={() => state.setVisualSetting("asymmetry", .55)} onChange={(e) => state.setVisualSetting("asymmetry", Number(e.target.value))} /></label>
              <label><span>bloomThreshold <b>{state.visualSettings.bloomThreshold.toFixed(2)}</b></span><input type="range" min=".2" max=".95" step=".025" value={state.visualSettings.bloomThreshold} onDoubleClick={() => state.setVisualSetting("bloomThreshold", .68)} onChange={(e) => state.setVisualSetting("bloomThreshold", Number(e.target.value))} /></label>
              <label><span>{t("visual.colors")}</span><select value={state.visualSettings.torusColorScheme} onChange={(e) => state.setVisualSetting("torusColorScheme", e.target.value as "ice" | "cyan" | "violet")}><option value="ice">{t("visual.ice")}</option><option value="cyan">{t("visual.cyan")}</option><option value="violet">{t("visual.violet")}</option></select></label>
            </>}
            <button className="visual-reset" onClick={state.resetVisualSettings}>{t("visual.reset")}</button>
          </div>}
          {immersiveMode && <div
            className="immersive-actions-sensor"
            aria-label={t("visual.sensor")}
            onMouseEnter={() => {
              immersiveSensorHovered.current = true;
              cancelImmersiveHide();
              setImmersiveControlsVisible(true);
              if (clickThrough) window.desktop?.setClickThroughBypass(true);
            }}
            onMouseLeave={() => {
              immersiveSensorHovered.current = false;
              if (clickThrough) window.desktop?.setClickThroughBypass(false);
              scheduleImmersiveHide();
            }}
          >
            {immersiveControlsVisible && <div className="immersive-actions">
              <button
                className={`visual-settings-trigger ${visualSettingsOpen ? "active" : ""}`}
                title={t("visual.tune")}
                onClick={() => {
                  const open = !visualSettingsOpen;
                  setVisualSettingsOpen(open);
                  if (open) setQueueOpen(false);
                  setImmersiveControlsVisible(true);
                  if (open && clickThrough) {
                    setClickThrough(false);
                    window.desktop?.setClickThrough(false);
                  }
                }}
              ><SlidersHorizontal /></button>
              <button className={state.obsMode ? "active" : ""} title={t("visual.obsTransparent")} onClick={() => state.setObsMode(!state.obsMode)}><Blend /></button>
              <button
                className={clickThrough ? "active locked" : ""}
                title={t(clickThrough ? "visual.unlockClickThrough" : "visual.lockClickThrough")}
                onClick={() => {
                  const enabled = !clickThrough;
                  setClickThrough(enabled);
                  setImmersiveControlsVisible(true);
                  window.desktop?.setClickThrough(enabled);
                }}
              ><Lock /></button>
              <button title={t(maximized ? "visual.restore" : "visual.maximize")} onDoubleClick={(event) => event.stopPropagation()} onClick={toggleMaximize}>{maximized ? <Copy /> : <Square />}</button>
              <button title={`${t("visual.exitImmersive")}（Esc / F11）`} onClick={exitImmersiveMode}><X /></button>
            </div>}
          </div>}
        </div>

      </section> : <WorkspacePage
        page={renderedPage}
        devices={devices}
        deviceId={deviceId}
        deviceError={tm(deviceError)}
        onDevice={(id) => void selectDevice(id)}
        onImport={() => fileRef.current?.click()}
      />}
      </div>

      {showMeters && <MeterPanel visible={pageVisible && !windowBackgrounded} lowPerformance={lowPerformanceMode} format={onlineSession ? "STREAM" : current?.format || ""} device={deviceName} coverUrl={displayCover} name={displayName || ""} playbackState={playbackState} />}
      {/* A faint triangle on the meters' edge, shown only when the pointer comes near:
          it folds the meters away, and from the window's right edge brings them back. */}
      {renderedPage !== "nowPlaying" && <button type="button"
        className={`meter-edge-toggle ${metersExpanded ? "expanded" : "collapsed"}`}
        aria-pressed={metersExpanded}
        aria-label={t(metersExpanded ? "layout.hideMeters" : "layout.showMeters")}
        title={t(metersExpanded ? "layout.hideMeters" : "layout.showMeters")}
        onClick={() => setMetersExpanded(value => !value)}><i aria-hidden="true" /></button>}
    </div>

    <footer className="transport">
      <div className="transport-track">
        <div className="transport-art">{displayCover ? <img src={displayCover} alt="" /> : <Disc3 />}</div>
        <div className="transport-track-copy"><span>{onlineSession ? "STREAM" : current?.format || "CURRENT TRACK"}</span><b title={displayName || ""}>{displayName || t("common.waitingAudio")}</b><small title={`${displayArtist || ""} · ${displayAlbum || ""}`}>{displayName ? `${displayArtist} · ${displayAlbum}` : t("common.dropOrLibrary")}</small></div>
      </div>
      <div className="transport-console">
        <div className="controls">
          {onlineSession ? <button style={{ width: "auto", padding: "0 16px", whiteSpace: "nowrap" }} onClick={() => state.setActivePage("online")}>{t("online.openYoutube")}</button> : <>
          <button className={!onlineSession && state.shuffle ? "active" : ""} title={t("common.shuffle")} onClick={toggleShuffle}><Shuffle /></button>
          <button title={t("common.previous")} onClick={previous}><SkipBack /></button>
          <button disabled={!current && !onlineSession} title={t(onlineSession ? "common.pause" : "common.stop")} onClick={stopPlayback}><CircleStop /></button>
          <button className="play" disabled={!current && !onlineSession} title={t(controlPlaying ? "common.pause" : "common.play")} onClick={togglePlayback}>{controlPlaying ? <Pause /> : <Play />}</button>
          <button title={t("common.next")} onClick={next}><SkipForward /></button>
          <button className={!onlineSession && state.repeat !== "off" ? "active" : ""} title={t("common.repeat")} onClick={toggleRepeat}>{!onlineSession && state.repeat === "one" ? <Repeat1 /> : <Repeat />}</button>
          </>}
        </div>
        <div className="transport-progress">
          <WithDisplayTime online={onlineSession}>{displayTime => <>
          <time>{formatTime(displayTime)}</time>
          <div className="timeline transport-timeline"><WaveformTimeline videoHandle={videoActive && !onlineSession} url={onlineSession || videoActive ? undefined : current?.url} sourcePath={onlineSession || videoActive ? undefined : current?.sourcePath || current?.nativePath} liveKey={onlineSession ? state.onlineMedia?.trackId || undefined : undefined} readOnly={onlineSession} livePlaying={onlinePlaying} currentTime={displayTime} duration={displayDuration} accent={state.accent} lowPerformance={lowPerformanceMode} onSeek={seek} /></div>
          </>}</WithDisplayTime>
          <time>{onlineSession && displayDuration <= 0 ? "--:--" : formatTime(displayDuration)}</time>
          {videoSidebarMode || videoActive ? null : (compactMode && !hdmiDirect) ? <WithStoreVolume>{(volume, muted) => <label className="compact-volume" title={`${t("channel.mainVolume")} ${muted ? 0 : Math.round(volume * 100)}%`}>
            <button type="button" disabled={videoActive && videoDirect} aria-label={t(muted ? "common.unmute" : "common.mute")} onClick={() => state.setMuted(!muted)}>
              <VolumeLevelIcon volume={volume} muted={muted} />
            </button>
            <input disabled={videoActive && videoDirect} aria-label={t("channel.mainVolume")} type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={event => {
              const nextVolume = Number(event.target.value);
              state.setVolume(nextVolume);
              state.setMuted(nextVolume <= .001);
            }} />
          </label>}</WithStoreVolume> : <WithStoreVolume>{(volume, muted) => <ChannelStripPopover
            onOpenChange={setChannelStripOpen}
            direct={videoActive ? videoDirect : hdmiDirect}
            directLabel={directOutputLabel}
            onOpenOutput={() => state.setActivePage("devices")}
            visible={pageVisible && !windowBackgrounded}
            volume={volume}
            muted={muted}
            restoreVolume={lastAudibleVolume.current}
            accent={state.accent}
            glowStrength={effectiveGlowStrength}
            windowOpacity={lowPerformanceMode ? 1 : state.uiSettings.windowOpacity}
            lightSurface={lightSurface}
            lowPerformance={lowPerformanceMode}
            light={lightTheme}
            vstModeActive={vstControlActive}
            vstModePending={vstControlPending}
            vstModeLocked={vstControlLocked}
            vstModeLabel={vstControlLabel}
            vstModeDetail={vstControlDetail}
            vstAccessAvailable={!videoActive && !onlineDirectSource && state.uiSettings.nativeOutputEnabled}
            onVolume={state.setVolume}
            onMuted={state.setMuted}
            onToggleVstMode={toggleContextualVst}
            onOpenRack={() => {
              if (onlineDirectSource) {
                setVstNotice(t("vst.onlineWebDirect"));
                return;
              }
              if (!state.requestNativeOutputForVst()) return;
              state.setActivePage("plugins");
            }}
            onRequestVstAccess={() => {
              if (onlineDirectSource) {
                setVstNotice(t("vst.onlineWebDirect"));
                return;
              }
              state.requestNativeOutputForVst();
            }}
          />}</WithStoreVolume>}
        </div>
      </div>
      <div className="transport-actions">
        {videoSidebarMode ? <div className={`transport-status-card video-transport-status ${playbackActive ? "active" : "idle"}`}>
          <i aria-hidden="true" />
          <span className="playback-queue-status"><span>PLAYBACK</span><b>{state.playing ? "RUNNING" : "STANDBY"}</b></span>
          <div className="video-transport-buttons">
            <button type="button" className={`video-queue-trigger ${queueOpen ? "active" : ""}`} title={`${t("nav.playlist")} · ${state.tracks.length}`} aria-label={`${t("nav.playlist")} · ${state.tracks.length}`} aria-expanded={queueOpen} onClick={toggleVideoQueue}><ListMusic /><span>{t("video.sidebar.list")}</span></button>
            <WithStoreVolume>{(volume, muted) => <button type="button" className={`video-volume-trigger ${videoVolumeOpen ? "active" : ""}`} title={`${t("video.sidebar.volume")} · ${muted ? 0 : amplitudeToFaderPercent(volume)}%`} aria-label={t("video.sidebar.volume")} aria-expanded={videoVolumeOpen} onClick={toggleVideoVolume}><VolumeLevelIcon volume={volume} muted={muted} /><span>{t("video.sidebar.volume")}</span></button>}</WithStoreVolume>
          </div>
        </div> : <button className={`transport-status-card playback-queue-button ${playbackActive ? "active" : "idle"}`} title={t("queue.title")} aria-label={`${t("queue.title")} · ${state.tracks.length}`} aria-expanded={queueOpen} onClick={() => { if (!queueOpen) setVisualSettingsOpen(false); setQueueOpen(!queueOpen); }}>
          <i aria-hidden="true" />
          <span className="playback-queue-status"><span>PLAYBACK</span><b>{onlinePlaying ? "STREAMING" : state.playing ? "RUNNING" : "STANDBY"}</b></span>
          <span className="playback-queue-summary"><ListMusic aria-hidden="true" /><span className="playback-queue-count">{state.tracks.length}</span></span>
        </button>}
      </div>
    </footer>

    {queueOpen && <QueuePanel onClose={closeQueue} video={videoSidebarMode} />}
    {videoVolumeOpen && videoSidebarControls && <div className="queue-drawer panel video-volume-drawer">
      <div className="queue-title"><div><Volume2 size={18} /> {t("video.sidebar.volume")}</div><button title={t("common.close")} onClick={() => setVideoVolumeOpen(false)}><X size={18} /></button></div>
      {videoSidebarControls}
    </div>}
    {activeError && <div className="error-toast" role="status" aria-live="polite"><div><b>{t("common.operationFailed")}</b><span>{tm(activeError)}</span></div><button title={t("common.close")} onClick={dismissError}><X /></button></div>}
    {vstNotice && <div className="vst-notice-toast" role="status" aria-live="polite"><Power /><div><b>{t("vst.modeNotice")}</b><span>{vstNotice}</span></div><button title={t("common.close")} onClick={() => setVstNotice("")}><X /></button></div>}
    {dragging && !immersiveMode && <div className="drop-overlay"><div><Zap /><b>{t("drop.releaseImport")}</b><span>{t("drop.addToQueue")}</span></div></div>}
    <LibraryMatchTaskHost/>
  </main>;
}

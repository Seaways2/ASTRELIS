export {};

declare global {
  interface DesktopPreferences {
    alwaysOnTop: boolean;
    rememberWindowState: boolean;
    mediaKeysEnabled: boolean;
    closeBehavior: "tray" | "quit";
  }
  interface DesktopPreferencesResult {
    ok: boolean;
    preferences: DesktopPreferences;
    error?: string;
  }
  interface Window {
    desktop?: {
      video: {
        choose(): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
        open(file: string, direct: boolean, token: string, rackPlugins?: { id: string; path: string; enabled: boolean }[] | null): Promise<{ ok: boolean; error?: string }>;
        bounds(bounds: { x: number; y: number; width: number; height: number; visible: boolean }): void;
        state(): Promise<import("../../electron/videoPlayer").VideoState>;
        control(action: string, value?: number | string): Promise<{ ok: boolean; error?: string }>;
        subtitle(): Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
        onInput(listener: (input: { action: "toggle" | "seek" | "volume" | "volumeDb"; amount: number }) => void): () => void;
        onState(listener: (state: import("../../electron/videoPlayer").VideoState) => void): () => void;
      };
      setDisplayLanguage(language: "zh-CN" | "en-US" | "ja-JP"): void;
      minimize(): void;
      maximize(): void;
      setImmersive(enabled: boolean): void;
      beginResize(edge: string): void;
      resizeTo(): void;
      endResize(): void;
      close(): void;
      setAlwaysOnTop(enabled: boolean): void;
      preferences: {
        get(): Promise<DesktopPreferencesResult>;
        update(patch: Partial<DesktopPreferences>): Promise<DesktopPreferencesResult>;
        onChanged(listener: (preferences: DesktopPreferences) => void): () => void;
      };
      setWindowGlass(material: "acrylic" | "mica" | "none"): void;
      setColorTheme(theme: "dark" | "light" | "system"): void;
      setCompact(enabled: boolean): void;
      setClickThrough(enabled: boolean): void;
      setClickThroughBypass(bypassed: boolean): void;
      onClickThrough(listener: (enabled: boolean) => void): () => void;
      onMediaKey(listener: (action: "toggle" | "previous" | "next" | "stop") => void): () => void;
      onMaximized(listener: (maximized: boolean) => void): () => void;
      onPresentationState(listener: (state: { minimized: boolean; trayConcealed: boolean }) => void): () => void;
      confirmPluginRemoval(name: string): Promise<boolean>;
      appearance: {
        chooseBackgroundFolder(): Promise<{ok:boolean; canceled?:boolean; error?:string; images?:{path:string;url:string}[]; folder?:string}>;
        chooseBackground(): Promise<{ ok: boolean; path?: string; url?: string; name?: string; error?: string; canceled?: boolean }>;
        removeBackground(): Promise<{ ok: boolean; error?: string }>;
      };
      getFilePath(file: File): string;
      externalOpen: {
        ready(): Promise<{ ok: boolean }>;
        report(opened: number, playing: boolean): void;
        onFiles(listener: (paths: string[]) => void): () => void;
      };
      cache: {
        inspect(): Promise<{ ok: boolean; error?: string; path?: string; bytes?: number; decodedBytes?: number; directBytes?: number; protectedBytes?: number; busy?: boolean }>;
        clear(): Promise<{ ok: boolean; error?: string; removedBytes?: number; skippedBytes?: number; failedFiles?: number }>;
        protect(files: string[]): Promise<void>;
      };
      library: {
        visibility(request: Record<string, unknown>): Promise<{ok:boolean;configured?:boolean;unlocked?:boolean;roots?:string[];broken?:boolean;error?:string}>;
        musicbrainz(request: Record<string, unknown>): Promise<{ok:boolean; skipped?:boolean; error?:string; results?:import("../../electron/library/media/MusicBrainzClient").MusicCoverCandidate[]}>;
        tmdb(request: Record<string, unknown>): Promise<{ ok: boolean; configured?: boolean; posterPreview?: string; error?: string; results?: import("../../electron/library/media/TmdbClient").FilmMetadata[]; metadata?: import("../../electron/library/media/TmdbClient").FilmMetadata }>;
        fileAction(id: string, action: "remove" | "reveal"): Promise<{ok:boolean;error?:string}>;
        artwork(id: string, action: "choose" | "frame" | "lock" | "unlock"): Promise<{ ok: boolean; canceled?: boolean; error?: string }>;
        prefetch(path: string, direct: boolean): Promise<{ ok: boolean; busy?: boolean; error?: string }>;
        removeFolder(folder: string, meta: LibraryCommandMeta): Promise<LibraryMutationResult>;
        load(): Promise<LibraryLoadResponse>;
        loadDerivedIndex(revision: number): Promise<unknown | null>;
        saveDerivedIndex(revision: number, snapshot: unknown): Promise<{ ok: boolean }>;
        chooseFolder(meta: LibraryCommandMeta): Promise<LibraryScanCommitResponse | null>;
        rescan(folders: string[], meta: LibraryCommandMeta): Promise<LibraryScanCommitResponse | null>;
        cancelScan(requestId: string): Promise<{ ok: boolean }>;
        importLegacyState(tracks: unknown[], folders: string[], meta: LibraryCommandMeta): Promise<LegacyLibraryImportResult>;
        openFiles(paths: string[]): Promise<{ tracks: LibraryTrackInfo[]; errors: string[] }>;
        prepare(path: string): Promise<{ ok: boolean; url?: string; path?: string; error?: string }>;
        prepareDirect(path: string): Promise<{ ok: boolean; codec?: string; error?: string }>;
        waveform(path: string, requestId?: string): Promise<{ ok: boolean; peaks?: number[]; error?: string }>;
        cancelWaveform(path: string, requestId?: string): void;
        onScanProgress(listener: (progress: LibraryScanProgress) => void): () => void;
      };
        nativeAudio: {
        command(command: NativeDeviceEnumerateCommand): Promise<NativeDeviceEnumerationResponse>;
        command(command: NativeDeviceCapabilitiesCommand): Promise<NativeDeviceCapabilitiesResponse>;
        command(command: NativeDeviceStatusCommand): Promise<NativeDeviceStatusResponse>;
        command(command: NativeDeviceApplyCommand): Promise<NativeDeviceTransactionResponse>;
        command(command: Record<string, unknown>): Promise<NativeAudioStatus>;
        pushPcm(packet: { sampleRate: number; channels: number; frames: number; pcm: ArrayBuffer }): void;
        onSafetyFallback(listener: (event: {
          reason: "realtime-clock-stalled" | "underruns-growing" | "native-callback-stalled" | "capture-stopped";
          stopped: boolean;
          realtimeRatio: number;
          underruns: number;
        }) => void): () => void;
        };
        audioRoute: {
          claim(source: "local" | "netease" | "youtube" | "web-direct", sessionId: string): Promise<{ ok: boolean; stale?: boolean; error?: string }>;
          release(source: "local" | "netease" | "youtube" | "web-direct", sessionId: string): Promise<{ ok: boolean; stale?: boolean; error?: string }>;
          status(): Promise<{ ok: boolean; route?: unknown }>;
        };
      netease: {
        search(query: string): Promise<{ ok: boolean; songs: NeteaseSearchItem[]; error?: string }>;
        prepare(id: number): Promise<{ ok: boolean; url?: string; error?: string }>;
        loginStatus(): Promise<{ loggedIn: boolean; userId: number; nickname: string; avatarUrl: string }>;
        logout(): Promise<{ ok: boolean; loggedOut?: boolean; error?: string }>;
        playlists(): Promise<{ ok: boolean; playlists: NeteasePlaylistItem[]; error?: string }>;
        playlistTracks(id: number): Promise<{ ok: boolean; songs: NeteaseSearchItem[]; error?: string }>;
        createQr(): Promise<{ ok: boolean; key?: string; qrImage?: string; qrUrl?: string; error?: string }>;
        checkQr(key: string): Promise<{ ok: boolean; code: number; message?: string; loggedIn: boolean; error?: string }>;
      };
      vst: {
        scan(retryFailures?: boolean): Promise<PluginScanResult>;
        controlScan(action: "skip" | "disable", normalizedPath: string): Promise<{ ok: boolean }>;
        resetQuarantine(normalizedPath: string): Promise<{ ok: boolean }>;
        directories(): Promise<PluginDirectoryInfo[]>;
        importDirectories(directories: string[]): Promise<PluginDirectoryInfo[]>;
        addDirectory(directoryPath: string): Promise<{ ok: boolean; added?: boolean; directory?: PluginDirectoryInfo; error?: string }>;
        removeDirectory(id: string): Promise<{ ok: boolean }>;
        setDirectoryEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }>;
        chooseFolder(): Promise<string | null>;
        engineStatus(): Promise<VstEngineStatus>;
        openEditor(pluginPath: string, pluginId: string): Promise<{ ok: boolean; error?: string }>;
        onScanProgress(listener: (progress: VstScanProgress) => void): () => void;
      };
      browser: {
        show(bounds: BrowserBounds): void;
        hide(): void;
        setBounds(bounds: BrowserBounds): void;
        navigate(url: string): void;
        back(): void;
        forward(): void;
        reload(): void;
        home(): void;
        setVolume(volume: number, muted: boolean): void;
        setOutput(label: string, useDefault: boolean): Promise<{ ok: boolean; error?: string }>;
        getOutput(): Promise<{ label: string; deviceId: string; ok?: boolean; error?: string }>;
        mediaAction(action: "toggle" | "play" | "pause" | "stop" | "previous" | "next" | "seek" | "shuffle" | "repeat", value?: number): Promise<{ ok: boolean; error?: string }>;
        fade(target: number, durationMs: number, pauseAfter: boolean, fromZero: boolean, restoreVolume: number): Promise<{ ok: boolean }>;
        setAnalysisConfig(config: { enabled: boolean; fftSize: number; sampleRate: number }): void;
        onState(listener: (state: BrowserState) => void): () => void;
        onMedia(listener: (state: OnlineMediaState) => void): () => void;
        onAnalysis(listener: (frame: OnlineAnalysisFrame) => void): () => void;
        onAnalysisReset(listener: () => void): () => void;
        onPlayIntent(listener: () => void): () => void;
        onBoundsSync(listener: () => void): () => void;
      };
    };
  }
  interface AudioContext {
    setSinkId?(sinkId: string): Promise<void>;
    readonly sinkId?: string;
  }
  interface BrowserBounds { x: number; y: number; width: number; height: number }
  interface BrowserState {
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
  }
  interface OnlineMediaState {
    trackId?: string;
    title: string;
    artist: string;
    album: string;
    artwork: string;
    playing: boolean;
    currentTime: number;
    duration: number;
  }
  interface OnlineAnalysisFrame {
    sampleRate: number;
    fftSize: number;
    frequency: Uint8Array | ArrayBuffer;
    left: Float32Array | ArrayBuffer;
    right: Float32Array | ArrayBuffer;
  }
  interface NeteaseSearchItem {
    id: number;
    name: string;
    artist: string;
    album: string;
    coverUrl: string;
    duration: number;
  }
  interface NeteasePlaylistItem {
    id: number;
    name: string;
    coverUrl: string;
    trackCount: number;
    liked: boolean;
  }
  type PluginFormat = "VST3" | "VST2" | "CLAP";
  type PluginBusRole = "main" | "aux" | "sidechain";
  type PluginCompatibilityReason = "FORMAT_NOT_AVAILABLE" | "INSTRUMENT_NOT_SUPPORTED" | "MIDI_EFFECT_NOT_SUPPORTED" | "PLUGIN_HAS_NO_AUDIO_OUTPUT" | "NO_MAIN_AUDIO_INPUT" | "NO_MAIN_AUDIO_OUTPUT" | "MONO_INPUT_ONLY" | "MONO_OUTPUT_ONLY" | "STEREO_INPUT_UNSUPPORTED" | "STEREO_OUTPUT_UNSUPPORTED" | "STEREO_INSERT_UNSUPPORTED" | "REQUIRES_UNSUPPORTED_BUS_LAYOUT" | "ARA_NOT_SUPPORTED" | "ARCHITECTURE_MISMATCH";
  type ScannerStage = "MODULE_LOAD" | "ENUMERATION" | "INSTANTIATION" | "BUS_PROBE" | "PREPARE" | "PROCESS_TEST" | "RELEASE" | "DESTROY";
  type ScannerFailureCode = "SCAN_TIMEOUT" | "PLUGIN_CRASHED" | "NONZERO_EXIT" | "SCAN_PROTOCOL_ERROR" | "ENUMERATION_FAILED" | "INSTANTIATION_FAILED" | "ARCHITECTURE_MISMATCH" | "PLUGIN_PROBE_FAILED" | "USER_SKIPPED" | "USER_DISABLED" | "QUARANTINED";
  type PluginCatalogState = "accepted" | "policy-rejected" | "technically-incompatible" | "transient-failure" | "quarantined" | "user-ignored";
  interface ScannerFailureInfo {
    code: ScannerFailureCode;
    stage: ScannerStage;
    modulePath: string;
    pluginId?: string;
    message: string;
    elapsedMs: number;
    exitCode?: number;
    expectedVersion?: number;
    receivedVersion?: number;
  }
  type PluginDirectoryState = "not-scanned" | "ready" | "missing" | "access-denied" | "no-candidate-modules" | "no-accepted-plugins" | "scanner-error";
  interface PluginModuleInfo {
    format: PluginFormat;
    modulePath: string;
    normalizedPath: string;
    moduleFingerprint: string;
    fileSize: number;
    modifiedTime: number;
    scannerProtocolVersion?: number;
    scanElapsedMs?: number;
    lastScanStage?: ScannerStage;
  }
  interface PluginCapabilitiesInfo {
    audioInputAvailable: boolean;
    audioOutputAvailable: boolean;
    mainInputBuses: number;
    mainOutputBuses: number;
    auxInputBuses: number;
    auxOutputBuses: number;
    sidechainInputBuses: number;
    buses: Array<{
      direction: "input" | "output";
      index: number;
      name: string;
      role: PluginBusRole;
      enabledByDefault: boolean;
      defaultLayout: string;
      supportedLayouts: string[];
    }>;
    supportedChannelLayouts: { mainInput: string[]; mainOutput: string[] };
    midiInput: boolean;
    midiOutput: boolean;
    instrument: boolean;
    category: string;
    formatSpecificFlags: Record<string, string | number | boolean>;
    ara: { supported: boolean; required: boolean; variant: boolean };
  }
  interface AuralisCompatibilityInfo {
    profile: "AURALIS_STEREO_INSERT";
    eligible: boolean;
    reasons: PluginCompatibilityReason[];
    sampleRate: number;
    blockSize: number;
    processBlocks: number;
    policyVersion?: number;
    probeVersion?: number;
  }
  interface PluginDescriptorInfo {
    format: PluginFormat;
    moduleFingerprint: string;
    formatSpecificPluginId: string;
    stablePluginUid: string;
    name: string;
    vendor: string;
    category: string;
    version: string;
    hasARAExtension: boolean;
    capabilities: PluginCapabilitiesInfo;
    compatibility: AuralisCompatibilityInfo;
    catalogState: PluginCatalogState;
    scanFailure?: ScannerFailureInfo;
  }
  interface PluginDirectoryInfo {
    id: string;
    path: string;
    normalizedPath: string;
    source: "standard" | "user";
    enabled: boolean;
    state: PluginDirectoryState;
    candidateModuleCount: number;
    acceptedPluginCount: number;
    message?: string;
  }
  interface PluginScanResult {
    schemaVersion: number;
    modules: PluginModuleInfo[];
    descriptors: PluginDescriptorInfo[];
    directories: PluginDirectoryInfo[];
    failures: ScannerFailureInfo[];
    quarantines: PluginQuarantineInfo[];
    session: PluginScanSessionSummary;
  }
  interface PluginQuarantineInfo {
    normalizedPath: string;
    modulePath: string;
    failureCount: number;
    lastFailureCode: ScannerFailureCode;
    lastFailureStage: ScannerStage;
    lastFailureTime: string;
    quarantined: boolean;
    userDisabled?: boolean;
  }
  interface PluginScanSessionSummary {
    id: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    directoriesScanned: number;
    candidateModules: number;
    modulesEnumerated: number;
    pluginDescriptorsDiscovered: number;
    acceptedPlugins: number;
    policyRejectedPlugins: number;
    failedModules: number;
    failedPlugins: number;
    quarantinedModules: number;
    moduleCacheHits: number;
    pluginCacheHits: number;
  }
  interface VstPluginInfo extends PluginDescriptorInfo {
    id: string;
    path: string;
    manufacturer: string;
    loadable: boolean;
    error?: string;
  }
  interface VstEngineStatus {
    available: boolean;
    backend: string;
    detail: string;
  }
  interface VstScanProgress {
    phase: "discovering" | "cache" | "scanning" | "complete";
    completed: number;
    total: number;
    current: string;
    modulePath?: string;
    normalizedPath?: string;
  }
  type NativeAudioBackend = "wasapi-shared" | "wasapi-shared-low-latency" | "wasapi-exclusive" | "directsound-legacy";
  interface NativeDeviceKey {
    backend: NativeAudioBackend;
    juceTypeName: string;
    juceDeviceName: string;
    identityStatus: "stable-windows-endpoint-id" | "ambiguous-friendly-name" | "unavailable-platform-id";
    platformEndpointId?: string;
  }
  interface NativeOutputDeviceInfo extends NativeDeviceKey {
    defaultForType: boolean;
    active: boolean;
  }
  interface NativeProtocolResponse {
    ok: boolean;
    error?: string;
    requestId?: string;
    responseKind?: "response";
    nativeHostVersion?: string;
    controlProtocolVersion?: number;
    pcmProtocolVersion?: number;
  }
  interface NativeDeviceEnumerateCommand { type: "device-enumerate" }
  interface NativeDeviceCapabilitiesCommand {
    type: "device-capabilities";
    juceTypeName: string;
    juceDeviceName: string;
  }
  interface NativeDeviceStatusCommand { type: "device-status" }
  interface NativeDeviceEnumerationResponse extends NativeProtocolResponse {
    devices: NativeOutputDeviceInfo[];
    identityNote?: string;
  }
  interface NativeDeviceCapabilitiesResponse extends NativeProtocolResponse, Partial<NativeDeviceKey> {
    active?: boolean;
    capabilitiesState?: "active-device" | "reported-unopened" | "unavailable-unopened";
    availableSampleRates?: number[];
    availableBufferSizes?: number[];
    outputChannelNames?: string[];
    defaultBufferSize?: number;
    hasControlPanel?: boolean;
    currentSampleRate?: number;
    currentBufferSize?: number;
    currentBitDepth?: number;
    activeOutputChannels?: number[];
  }
  interface NativeDeviceStatusResponse extends NativeProtocolResponse, Partial<NativeDeviceKey> {
    state?: "active" | "closed";
    sampleRate?: number;
    bufferSize?: number;
    bufferMs?: number;
    bitDepth?: number;
    outputChannelNames?: string[];
    activeOutputChannels?: number[];
    callbackCount?: number;
    callbackMaxGapUs?: number;
    sampleRateMode?: NativeSampleRateMode;
    sampleRatePolicy?: "source-rate-priority" | "continuity-priority" | "fixed-rate" | "system-rate";
  }
  type NativeSampleRateMode = "system" | "follow-source" | "fixed";
  type NativeBufferMode = "auto" | "fixed";
  type NativeExclusiveFallback = "shared-low-latency" | "shared" | "ask";
  interface NativeOutputCandidate {
    backend: Exclude<NativeAudioBackend, "directsound-legacy">;
    juceDeviceName: string;
    platformEndpointId?: string;
    sampleRateMode: NativeSampleRateMode;
    fixedSampleRate?: number;
    bufferMode: NativeBufferMode;
    fixedBufferSize?: number;
    exclusiveFallback: NativeExclusiveFallback;
  }
  interface NativeDeviceApplyCommand { type: "device-apply"; candidate: NativeOutputCandidate }
  interface NativeDeviceTransactionResponse extends NativeProtocolResponse {
    committed?: boolean;
    degraded?: boolean;
    generation?: number;
    recovery?: "none" | "exclusive-profile-fallback" | "previous-route-restored" | "safe-shared-restored" | "recovery-failed";
    requested?: NativeOutputCandidate;
    actual?: NativeDeviceStatusResponse;
    lastKnownGood?: NativeOutputCandidate;
  }
  interface NativeAudioStatus {
    directOutput?: boolean;
    directCodec?: string;
    analysisSampleRate?: number;
    outputChannels?: number;
    outputBitDepth?: number;
    ok: boolean;
    error?: string;
    playing?: boolean;
    position?: number;
    duration?: number;
    playbackToken?: string;
    sampleRate?: number;
    bufferSize?: number;
      plugins?: number;
      processingMode?: "dry" | "vst" | "direct";
      fadeMs?: number;
      sourceRateDecision?: "not-evaluated" | "continuity-resample" | "exclusive-follow-source-reconfigure" | "exclusive-follow-source-resident" | "follow-source-unavailable-resample";
      lastSourceSampleRate?: number;
    pluginIds?: string[];
    device?: string;
    source?: "none" | "local-file" | "process-audio" | "browser-pcm";
    sourceState?: "running" | "stopped";
    sourceSampleRate?: number;
    sourceOutputRate?: number;
    sourceChannels?: number;
    sourceBlockSize?: number;
    sourceDiscontinuities?: number;
    nativeFrequency?: number[];
    nativeLeft?: number[];
    nativeRight?: number[];
    nativePeak?: number;
    nativeLeftPeak?: number;
    nativeRightPeak?: number;
    nativeRms?: number;
    nativeLow?: number;
    nativeMid?: number;
    nativeHigh?: number;
    captureRunning?: boolean;
    capturePeak?: number;
      capturedFrames?: number;
      captureConsumedFrames?: number;
    capturePackets?: number;
    captureFramesPerSecond?: number;
    captureRateRatio?: number;
    capturePacketMaxGapMs?: number;
    captureProcessId?: number;
    captureTargetPid?: number;
    captureTargetPidRole?: string;
    captureSourceRate?: number;
    captureBufferFrames?: number;
    captureFifoFrames?: number;
    captureBufferCapacity?: number;
    captureTargetFrames?: number;
    captureFifoTargetFrames?: number;
    captureMinimumFrames?: number;
    captureMaximumFrames?: number;
    captureRecovering?: boolean;
    captureUnderruns?: number;
    captureOverruns?: number;
    captureDiscontinuities?: number;
    captureSilentPackets?: number;
    captureSilentFrames?: number;
    captureZeroDataPackets?: number;
    captureZeroDataFrames?: number;
    captureTransport?: string;
    captureDriftCorrection?: number;
      captureDriftPpm?: number;
      captureRestartCount?: number;
    captureRawRms?: number;
    inputSampleRate?: number;
    outputSampleRate?: number;
    pluginLatencySamples?: number;
    estimatedTotalLatencyMs?: number;
  }
  interface LibraryTrackInfo {
    id: string; name: string; artist: string; album: string; format: string;
    size: number; sourcePath: string; nativePath?: string; url: string; folder: string;
    duration?: number; year?: number; genre?: string; coverUrl?: string; metadataRead?: boolean;
  }
  type LibraryErrorCode =
    | "LIBRARY_SNAPSHOT_CORRUPT"
    | "LIBRARY_NO_VALID_REVISION"
    | "LIBRARY_WRITE_FAILED"
    | "LIBRARY_REVISION_CONFLICT"
    | "LIBRARY_MIGRATION_FAILED"
    | "LIBRARY_ROOT_OFFLINE"
    | "LIBRARY_PERMISSION_DENIED"
    | "LIBRARY_PARTIAL_SCAN"
    | "LIBRARY_INVALID_SCHEMA"
    | "LIBRARY_UNKNOWN_ERROR";
  interface LibraryError {
    code: LibraryErrorCode;
    message: string;
    recoverable: boolean;
    details?: Record<string, string | number | boolean>;
  }
  interface LibraryCommandMeta { requestId: string; expectedRevision?: number; }
  interface LibraryMutationResult {
    status: "committed" | "noop" | "conflict";
    revision: number;
    requestId: string;
    error?: LibraryError;
  }
  interface LibraryLoadResponse {
    status: "ok" | "recovered" | "empty" | "error";
    schemaVersion: 2;
    revision: number;
    recoveredFromRevision?: number;
    error?: LibraryError;
    tracks: LibraryTrackInfo[];
    folders: string[];
  }
  interface LegacyLibraryImportResult {
    status: "imported" | "alreadyImported" | "noop" | "conflict";
    revision: number;
    requestId: string;
    sourceHash: string;
    error?: LibraryError;
  }
  interface LibraryScanResult {
    scanId: string;
    startedAt: string;
    completedAt: string;
    roots: LibraryRootScanResult[];
    tracks: Array<LibraryTrackInfo & { metadataRead?: boolean }>;
    failures: LibraryScanFailure[];
    folder: string;
    skipped: number;
    errors: string[];
    metadataFailures?: number;
  }
  type LibraryRootScanStatus = "complete" | "partial" | "offline" | "permissionDenied" | "cancelled";
  interface LibraryRootScanResult {
    rootId: string;
    path: string;
    status: LibraryRootScanStatus;
    scannedFiles: number;
    skippedFiles: number;
    unreadableDirectories: string[];
  }
  interface LibraryScanFailure {
    stage: "root" | "directory" | "stat" | "metadata" | "artwork";
    path: string;
    code: string;
    message: string;
  }
  interface LibraryReconcileSummary {
    added: string[];
    updated: string[];
    relocated: string[];
    unavailable: string[];
    removed: string[];
    preserved: string[];
    failures: LibraryScanFailure[];
  }
  interface LibraryScanCommitResponse {
    mutation: LibraryMutationResult;
    reconcile: LibraryReconcileSummary;
    scan: Omit<LibraryScanResult, "folder" | "skipped" | "errors" | "metadataFailures">;
    status: "ok" | "recovered" | "empty";
    revision: number;
    tracks: LibraryTrackInfo[];
    folders: string[];
  }
  interface LibraryScanProgress {
    phase: "discovering" | "metadata" | "complete";
    completed: number; total: number; current: string;
  }
}

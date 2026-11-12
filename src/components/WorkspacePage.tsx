import { SectionHeading } from "./SectionHeading";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines, Blocks, Check, FileAudio, Globe2, ImagePlus, Import, ListMusic, MonitorSpeaker,
  Palette, RefreshCw, Settings, ShieldAlert, Trash2, Layers, Music2, Sparkles, Cable, SlidersHorizontal
} from "lucide-react";
import { usePlayerStore } from "../stores/playerStore";
import { PlaylistTable } from "./PlaylistTable";
import { QueueTabs } from "./QueueTabs";
import type { OutputDevice } from "../types/audio";
import { OnlineBrowser } from "./OnlineBrowser";
import { VstRack } from "./VstRack";
import { MusicLibrary } from "./MusicLibrary";
import { useI18n } from "../i18n";
import { SystemSettings } from "./SystemSettings";
import type { PageId } from "../types/audio";
import { audioEngine } from "../audio/AudioEngine";
import { AtmosphereSettings } from "./AtmosphereSettings";
import { probeGpuVisualCapabilities, type GpuVisualQuality } from "../visualizers/gpuVisualRuntime";

interface Props {
  page: PageId;
  devices: OutputDevice[];
  deviceId: string;
  deviceError: string;
  onDevice(id: string): void;
  onImport(): void;
}

const themes = [
  ["Cyber Cyan", "#39d9e9"], ["Neon Purple", "#8f75ff"], ["Signal Green", "#45e397"],
  ["Amber Console", "#ffb84d"], ["Ice Blue", "#9edcff"], ["Monochrome", "#d7dde2"]
] as const;

type SelectableNativeBackend = Exclude<NativeAudioBackend, "directsound-legacy">;
const nativeOutputModes: Array<{ backend: SelectableNativeBackend; name: string; descriptionKey: string }> = [
  { backend: "wasapi-shared", name: "WASAPI Shared", descriptionKey: "device.modeSharedHint" },
  { backend: "wasapi-shared-low-latency", name: "Shared Low Latency", descriptionKey: "device.modeLowLatencyHint" },
  { backend: "wasapi-exclusive", name: "WASAPI Exclusive", descriptionKey: "device.modeExclusiveHint" }
];

export function WorkspacePage({ page, devices, deviceId, deviceError, onDevice, onImport }: Props) {
  const state = usePlayerStore();
  const { t } = useI18n();
  const lowPerformanceMode = state.uiSettings.lowPerformanceMode;
  const gpuCapabilities = useMemo(probeGpuVisualCapabilities, []);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState("");
  const [nativeDevices, setNativeDevices] = useState<NativeOutputDeviceInfo[]>([]);
  const [nativeDeviceStatus, setNativeDeviceStatus] = useState<NativeDeviceStatusResponse | null>(null);
  const [nativeCapabilities, setNativeCapabilities] = useState<NativeDeviceCapabilitiesResponse | null>(null);
  const [nativeDeviceError, setNativeDeviceError] = useState("");
  const [nativeDeviceLoading, setNativeDeviceLoading] = useState(false);
  const [nativeDeviceRefresh, setNativeDeviceRefresh] = useState(0);
  const [nativeSelectedKey, setNativeSelectedKey] = useState("");
  const [nativeRateChoice, setNativeRateChoice] = useState("system");
  const [nativeBufferChoice, setNativeBufferChoice] = useState("auto");
  const [nativeExclusiveFallback, setNativeExclusiveFallback] = useState<NativeExclusiveFallback>("shared-low-latency");
  const [nativeApplyBusy, setNativeApplyBusy] = useState(false);
  const [nativeSelectionBusy, setNativeSelectionBusy] = useState(false);
  const [nativeToggleBusy, setNativeToggleBusy] = useState(false);
  const [nativeApplyMessage, setNativeApplyMessage] = useState("");
  const [nativeOutputGuideVisible, setNativeOutputGuideVisible] = useState(false);
  const nativeOutputGuideRef = useRef<HTMLElement>(null);
  const handledNativeOutputGuideRequestRef = useRef(0);
  const nativeApplyBusyRef = useRef(false);
  const nativeSelectionBusyRef = useRef(false);
  const nativeToggleBusyRef = useRef(false);
  const nativeToggleTimerRef = useRef<number | undefined>(undefined);

  const chooseCustomBackground = async () => {
    if (!window.desktop?.appearance || backgroundBusy) return;
    setBackgroundBusy(true);
    setBackgroundError("");
    try {
      const result = await window.desktop.appearance.chooseBackground();
      if (result.canceled) return;
      if (!result.ok || !result.path || !result.url) {
        setBackgroundError(result.error || t("appearance.backgroundSaveFailed"));
        return;
      }
      state.setUiSetting("customBackgroundPath", result.path);
      state.setUiSetting("customBackgroundUrl", result.url);
      state.setUiSetting("backgroundImages", []);
      state.setUiSetting("backgroundFolder", "");
    } finally {
      setBackgroundBusy(false);
    }
  };
  const chooseBackgroundFolder = async () => {
    if(backgroundBusy || !window.desktop?.appearance.chooseBackgroundFolder) return;
    setBackgroundBusy(true);setBackgroundError("");
    try {
      const result=await window.desktop.appearance.chooseBackgroundFolder();
      if(result.canceled) return;
      if(!result.ok || !result.images?.length) {setBackgroundError(result.error || t("background.importFailed"));return;}
      state.setUiSetting("backgroundImages",result.images);
      state.setUiSetting("backgroundFolder",result.folder || "");
      state.setUiSetting("customBackgroundPath",result.images[0].path);
      state.setUiSetting("customBackgroundUrl",result.images[0].url);
    } catch(error) {setBackgroundError(error instanceof Error ? error.message : t("background.importFailed"));}
    finally {setBackgroundBusy(false);}
  };
  const removeCustomBackground = async () => {
    if (!window.desktop?.appearance || backgroundBusy) return;
    setBackgroundBusy(true);
    setBackgroundError("");
    try {
      const result = await window.desktop.appearance.removeBackground();
      if (!result.ok) {
        setBackgroundError(result.error || t("appearance.backgroundDeleteFailed"));
        return;
      }
      state.setUiSetting("customBackgroundPath", "");
      state.setUiSetting("customBackgroundUrl", "");
      state.setUiSetting("backgroundImages", []);
      state.setUiSetting("backgroundFolder", "");
    } finally {
      setBackgroundBusy(false);
    }
  };
  const handleCustomBackgroundClick = async () => {
    if (backgroundBusy || !window.desktop?.appearance) return;
    if (!state.uiSettings.customBackgroundUrl) {
      await chooseCustomBackground();
      return;
    }
    if (!window.confirm(t("appearance.clearBackgroundConfirm"))) return;
    await removeCustomBackground();
  };

  useEffect(() => {
    if (page !== "devices") return;
    let cancelled = false;
    const inspectNativeOutput = async () => {
      if (!window.desktop?.nativeAudio) {
        setNativeDeviceError(t("device.engineUnavailable"));
        return;
      }
      setNativeDeviceLoading(true);
      setNativeDeviceError("");
      try {
        const [enumeration, status] = await Promise.all([
          window.desktop.nativeAudio.command({ type: "device-enumerate" }),
          window.desktop.nativeAudio.command({ type: "device-status" })
        ]);
        if (cancelled) return;
        if (!enumeration.ok) throw new Error(enumeration.error || t("device.enumerateFailed"));
        setNativeDevices(enumeration.devices || []);
        if (!status.ok) setNativeDeviceError(status.error || t("device.statusFailed"));
        setNativeDeviceStatus(status);
        const active = (enumeration.devices || []).find(device => device.platformEndpointId === state.uiSettings.hdmiEndpointId)
          || (enumeration.devices || []).find(device => device.active);
        if (active) {
          setNativeSelectedKey(current => (enumeration.devices || []).some(device => nativeDeviceKey(device) === current) ? current : nativeDeviceKey(active));
          const capabilities = await window.desktop.nativeAudio.command({
            type: "device-capabilities",
            juceTypeName: active.juceTypeName,
            juceDeviceName: active.juceDeviceName
          });
          if (!cancelled) setNativeCapabilities(capabilities.ok ? capabilities : null);
        } else {
          setNativeSelectedKey((enumeration.devices || [])[0] ? nativeDeviceKey(enumeration.devices![0]) : "");
          setNativeCapabilities(null);
        }
      } catch (error) {
        if (!cancelled) setNativeDeviceError(error instanceof Error ? error.message : t("device.inspectFailed"));
      } finally {
        if (!cancelled) setNativeDeviceLoading(false);
      }
    };
    void inspectNativeOutput();
    return () => { cancelled = true; };
  }, [page, nativeDeviceRefresh]);

  useEffect(() => {
    if (page !== "devices") {
      setNativeOutputGuideVisible(false);
      return;
    }
    // Keep programmatic guide navigation inside the device page. Chromium's
    // generic element auto-scrolling can also move the hidden root viewport,
    // the custom titlebar off-screen and makes the window controls unreachable.
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    if (state.uiSettings.nativeOutputEnabled) {
      setNativeOutputGuideVisible(false);
      handledNativeOutputGuideRequestRef.current = state.nativeOutputGuideRequest;
      return;
    }
    const explicitVstGuide = state.nativeOutputGuideRequest > handledNativeOutputGuideRequestRef.current;
    handledNativeOutputGuideRequestRef.current = state.nativeOutputGuideRequest;
    setNativeOutputGuideVisible(explicitVstGuide);
    const frame = window.requestAnimationFrame(() => {
      const target = nativeOutputGuideRef.current;
      const pageScroller = target?.closest<HTMLElement>(".page-content");
      if (!target || !pageScroller) return;
      const targetBounds = target.getBoundingClientRect();
      const scrollerBounds = pageScroller.getBoundingClientRect();
      pageScroller.scrollTo({
        top: pageScroller.scrollTop + targetBounds.top - scrollerBounds.top,
        behavior: state.uiSettings.animations && !lowPerformanceMode ? "smooth" : "auto"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [page, state.nativeOutputGuideRequest, state.uiSettings.nativeOutputEnabled]);

  useEffect(() => {
    if (state.uiSettings.nativeOutputEnabled) setNativeOutputGuideVisible(false);
  }, [state.uiSettings.nativeOutputEnabled]);

  useEffect(() => () => {
    window.clearTimeout(nativeToggleTimerRef.current);
  }, []);

  const nativeControlsBusy = nativeDeviceLoading || nativeApplyBusy || nativeSelectionBusy || nativeToggleBusy;
  const handleNativeOutputToggle = (enabled: boolean) => {
    if (nativeDeviceLoading || nativeApplyBusyRef.current || nativeSelectionBusyRef.current || nativeToggleBusyRef.current) return;
    nativeToggleBusyRef.current = true;
    setNativeToggleBusy(true);
    state.setUiSetting("nativeOutputEnabled", enabled);
    window.clearTimeout(nativeToggleTimerRef.current);
    nativeToggleTimerRef.current = window.setTimeout(() => {
      nativeToggleBusyRef.current = false;
      setNativeToggleBusy(false);
    }, 1200);
  };

  const selectNativeDevice = async (device: NativeOutputDeviceInfo) => {
    if (device.backend === "directsound-legacy" || !window.desktop?.nativeAudio || nativeApplyBusyRef.current || nativeSelectionBusyRef.current || nativeToggleBusyRef.current) return;
    nativeSelectionBusyRef.current = true;
    setNativeSelectionBusy(true);
    setNativeSelectedKey(nativeDeviceKey(device));
    setNativeRateChoice("system");
    setNativeBufferChoice("auto");
    setNativeDeviceError("");
    try {
      const capabilities = await window.desktop.nativeAudio.command({
        type: "device-capabilities",
        juceTypeName: device.juceTypeName,
        juceDeviceName: device.juceDeviceName
      });
      if (capabilities.ok) setNativeCapabilities(capabilities);
      else setNativeDeviceError(capabilities.error || t("device.capabilitiesFailed"));
    } catch (error) {
      setNativeDeviceError(error instanceof Error ? error.message : t("device.capabilitiesFailed"));
    } finally {
      nativeSelectionBusyRef.current = false;
      setNativeSelectionBusy(false);
    }
  };

  const selectedNativeDevice = nativeDevices.find(device => nativeDeviceKey(device) === nativeSelectedKey);
  const selectedNativeBackend: SelectableNativeBackend = selectedNativeDevice?.backend !== "directsound-legacy"
    && selectedNativeDevice?.backend ? selectedNativeDevice.backend : "wasapi-shared";
  const selectableNativeDevices = nativeDevices.filter(device => device.backend === selectedNativeBackend);
  const selectNativeBackend = (backend: SelectableNativeBackend) => {
    const sameEndpoint = nativeDevices.find(device => device.backend === backend && (
      selectedNativeDevice?.platformEndpointId
        ? device.platformEndpointId === selectedNativeDevice.platformEndpointId
        : device.juceDeviceName === selectedNativeDevice?.juceDeviceName
    ));
    const candidate = sameEndpoint || nativeDevices.find(device => device.backend === backend && device.defaultForType)
      || nativeDevices.find(device => device.backend === backend);
    if (candidate) void selectNativeDevice(candidate);
  };

  const applyNativeDevice = async () => {
    const selected = nativeDevices.find(device => nativeDeviceKey(device) === nativeSelectedKey);
    if (!selected || selected.backend === "directsound-legacy" || !window.desktop?.nativeAudio || nativeApplyBusyRef.current || nativeSelectionBusyRef.current || nativeToggleBusyRef.current) return;
    nativeApplyBusyRef.current = true;
    const fixedSampleRate = nativeRateChoice.startsWith("fixed:") ? Number(nativeRateChoice.slice(6)) : undefined;
    const fixedBufferSize = nativeBufferChoice.startsWith("fixed:") ? Number(nativeBufferChoice.slice(6)) : undefined;
    const candidate: NativeOutputCandidate = {
      backend: selected.backend,
      juceDeviceName: selected.juceDeviceName,
      platformEndpointId: selected.platformEndpointId,
      sampleRateMode: fixedSampleRate ? "fixed" : nativeRateChoice === "follow-source" ? "follow-source" : "system",
      ...(fixedSampleRate ? { fixedSampleRate } : {}),
      bufferMode: fixedBufferSize ? "fixed" : "auto",
      ...(fixedBufferSize ? { fixedBufferSize } : {}),
      exclusiveFallback: nativeExclusiveFallback
    };
    setNativeApplyBusy(true);
    setNativeApplyMessage("");
    setNativeDeviceError("");
    try {
      const result = await window.desktop.nativeAudio.command({ type: "device-apply", candidate });
      if (result.actual) setNativeDeviceStatus(result.actual);
      if (!result.ok || !result.committed) {
        setNativeDeviceError(`${result.error || t("device.applyFailed")} · ${t(nativeRecoveryKey(result.recovery))}`);
      } else if (result.degraded) {
        setNativeApplyMessage(`${t("device.degraded")}: ${nativeBackendLabel(result.actual?.backend || "wasapi-shared")}`);
      } else {
        setNativeApplyMessage(`${t("device.applied")}: ${nativeBackendLabel(result.actual?.backend || selected.backend)} · ${result.actual?.sampleRate?.toLocaleString()} Hz · ${result.actual?.bufferSize} samples`);
      }
      const enumeration = await window.desktop.nativeAudio.command({ type: "device-enumerate" });
      if (enumeration.ok) setNativeDevices(enumeration.devices);
    } catch (error) {
      setNativeDeviceError(error instanceof Error ? error.message : t("device.transactionFailed"));
    } finally {
      nativeApplyBusyRef.current = false;
      setNativeApplyBusy(false);
    }
  };

  const setHdmiDirect = async (enabled: boolean) => {
    if (nativeApplyBusyRef.current || !window.desktop?.nativeAudio) return;
    const selected = nativeDevices.find(device => nativeDeviceKey(device) === nativeSelectedKey);
    nativeApplyBusyRef.current = true; setNativeApplyBusy(true); setNativeDeviceError(""); setNativeApplyMessage("");
    try {
      if (enabled) {
        if (!selected?.platformEndpointId) throw new Error(t("device.hdmiUnavailable"));
        const probe = await window.desktop.nativeAudio.command({ type: "direct-probe", endpointId: selected?.platformEndpointId });
        if (!probe.ok || !selected?.platformEndpointId) throw new Error(`${t("device.hdmiUnavailable")} · ${probe.error || ""}`);
      }
      await window.desktop.nativeAudio.command({ type: "pause" });
      state.setPlaying(false);
      if (enabled) {
        state.setUiSetting("hdmiEndpointId", selected!.platformEndpointId!);
        state.setUiSetting("hdmiDeviceName", selected!.juceDeviceName);
      } else await window.desktop.nativeAudio.command({ type: "direct-close" });
      state.setUiSetting("hdmiDirectEnabled", enabled);
      setNativeApplyMessage(t(enabled ? "device.hdmiReady" : "device.normalReady"));
    } catch (error) { setNativeDeviceError(String(error)); }
    finally { nativeApplyBusyRef.current = false; setNativeApplyBusy(false); }
  };

  if (page === "online") return <Page title={t("page.online")} code="SECURE WEB PLAYER" icon={<Globe2 />}>
    <OnlineBrowser />
  </Page>;

  if (page === "playlist") return <Page title={t("page.playlist")} code="PLAY QUEUE" icon={<ListMusic />}>
    <section className="workspace-section panel playlist-section">
    {/* One row: the music/video tabs carry the track counts, actions sit on the right. */}
    <div className="page-toolbar"><QueueTabs /><div className="playlist-toolbar-actions"><button className="clear-playlist" disabled={!state.tracks.length} onClick={() => { audioEngine.stop(); state.clearTracks(); }}><Trash2 />{t("library.clearPlaylist")}</button><button className="primary-action" onClick={onImport}><Import /> {t("common.addMusic")}</button></div></div>
    <PlaylistTable />
    {!state.tracks.length && <Empty onImport={onImport} text={t("common.emptyPlaylist")} button={t("common.selectAudio")} />}
    </section>
  </Page>;

  if (page === "library") return <Page title={t("page.library")} code="LOCAL LIBRARY" icon={<FileAudio />}>
    <MusicLibrary />
  </Page>;

  if (page === "devices") return <Page title={t("page.devices")} code="OUTPUT ROUTING" icon={<MonitorSpeaker />}>
    <div className="device-page-grid">
      <section ref={nativeOutputGuideRef} className={`setting-card workspace-section native-output-overview unified-output-config ${nativeOutputGuideVisible ? "vst-guide-active" : ""}`}>
        <header className="native-overview-header">
          <div><SectionHeading icon={Cable}>{t(state.uiSettings.hdmiDirectEnabled ? "device.hdmiDirect" : "device.nativeTitle")}</SectionHeading></div>
          <label className={`native-output-switch ${state.uiSettings.nativeOutputEnabled ? "active" : ""} ${nativeOutputGuideVisible ? "vst-guide-active" : ""} ${nativeToggleBusy ? "busy" : ""}`}>
            <span>{nativeToggleBusy ? t("device.switching") : state.uiSettings.hdmiDirectEnabled ? "HDMI DIRECT" : state.uiSettings.nativeOutputEnabled ? "NATIVE ON" : "WEB FALLBACK"}</span>
            <input disabled={nativeControlsBusy || state.uiSettings.hdmiDirectEnabled} type="checkbox" checked={state.uiSettings.nativeOutputEnabled || state.uiSettings.hdmiDirectEnabled} onChange={event => handleNativeOutputToggle(event.target.checked)} />
          </label>
        </header>

        <div className="unified-output-section">
          <div><SectionHeading icon={MonitorSpeaker}>{t("device.outputDevice")}</SectionHeading></div>
          <div className="native-device-picker">
          <select aria-label={t("device.outputDevice")} value={nativeSelectedKey} disabled={nativeControlsBusy || !selectableNativeDevices.length} onChange={event => {
            const device = nativeDevices.find(item => nativeDeviceKey(item) === event.target.value);
            if (device) void selectNativeDevice(device);
          }}>
            {selectableNativeDevices.map(device => <option value={nativeDeviceKey(device)} key={nativeDeviceKey(device)}>
              {device.juceDeviceName}{device.active ? ` · ${t("device.inUse")}` : device.defaultForType ? ` · ${t("device.default")}` : ""}
            </option>)}
          </select>
          <button className="native-device-refresh" type="button" title={t("device.hdmiRefresh")} aria-label={t("device.hdmiRefresh")} disabled={nativeControlsBusy} onClick={() => setNativeDeviceRefresh(value => value + 1)}><RefreshCw size={16} /></button>
          </div>
        </div>

        <div className="unified-output-section hdmi-output-policy">
          <SectionHeading icon={Music2}>{t("device.playbackPolicy")}</SectionHeading>
          <div className="native-mode-options">
            <button type="button" disabled={nativeControlsBusy} className={!state.uiSettings.hdmiDirectEnabled ? "active" : ""} onClick={() => void setHdmiDirect(false)}><span>{t("device.normalPlayback")}</span></button>
            <button type="button" disabled={nativeControlsBusy} className={state.uiSettings.hdmiDirectEnabled ? "active" : ""} onClick={() => void setHdmiDirect(true)}><span>{t("device.hdmiDirect")}</span></button>
          </div>
          <p>{t("device.hdmiHint")}</p>
          {nativeDeviceError && <p className="error-text" role="alert">{nativeDeviceError}</p>}
          {nativeApplyMessage && <p className="native-apply-message" role="status">{nativeApplyMessage}</p>}
          <small>{t("device.hdmiFormats")}</small>
          {state.uiSettings.hdmiDirectEnabled && <p>{state.uiSettings.hdmiDeviceName} · {t("device.hdmiVolume")}</p>}
        </div>
        <header><SectionHeading icon={AudioLines}>{t("device.outputMode")}</SectionHeading></header>
        <div className="native-mode-options">
          {nativeOutputModes.map(mode => <button
            type="button" key={mode.backend} disabled={nativeControlsBusy || state.uiSettings.hdmiDirectEnabled}
            className={selectedNativeBackend === mode.backend ? "active" : ""}
            onClick={() => selectNativeBackend(mode.backend)}
          ><span>{mode.name}</span><small>{t(mode.descriptionKey)}</small>{selectedNativeBackend === mode.backend && <Check />}</button>)}
        </div>

        <fieldset className="native-configuration-fields" disabled={state.uiSettings.hdmiDirectEnabled}>
        <div className="unified-output-section native-advanced-settings">
          <div><SectionHeading icon={SlidersHorizontal}>{t("device.otherSettings")}</SectionHeading></div>
          <label><span>{t("device.sampleRate")}</span><select disabled={nativeControlsBusy} value={nativeRateChoice} onChange={event => setNativeRateChoice(event.target.value)}>
            <option value="system">System · {t("device.rateSystem")}</option>
            <option value="follow-source">Follow Source · {t("device.rateFollowSource")}</option>
            {(nativeCapabilities?.availableSampleRates || []).map(rate => <option value={`fixed:${rate}`} key={rate}>Fixed · {rate.toLocaleString()} Hz</option>)}
          </select></label>
          <label><span>{t("device.buffer")}</span><select disabled={nativeControlsBusy} value={nativeBufferChoice} onChange={event => setNativeBufferChoice(event.target.value)}>
            <option value="auto">Auto · {t("device.deviceDefault")}</option>
            {(nativeCapabilities?.availableBufferSizes || []).map(buffer => <option value={`fixed:${buffer}`} key={buffer}>Fixed · {buffer} samples{nativeDeviceStatus?.sampleRate ? ` · ${(buffer * 1000 / nativeDeviceStatus.sampleRate).toFixed(2)} ms` : ""}</option>)}
          </select></label>
          {selectedNativeBackend === "wasapi-exclusive" && <label><span>{t("device.exclusiveFallback")}</span><select disabled={nativeControlsBusy} value={nativeExclusiveFallback} onChange={event => setNativeExclusiveFallback(event.target.value as NativeExclusiveFallback)}>
            <option value="shared-low-latency">{t("device.fallbackLowLatency")}</option><option value="shared">{t("device.fallbackShared")}</option><option value="ask">{t("device.fallbackRestore")}</option>
          </select></label>}
        </div>

        <button className="primary-action native-apply-button" disabled={!nativeSelectedKey || nativeControlsBusy} onClick={() => void applyNativeDevice()}>
          {nativeApplyBusy ? t("device.applying") : `${t("device.applyConfiguration")}${selectedNativeDevice ? ` · ${selectedNativeDevice.juceDeviceName}` : ""}`}
        </button>
        </fieldset>
        {nativeOutputGuideVisible && <div className="native-output-vst-guide" role="alert">
          <ShieldAlert /><div><b>{t("vst.nativeOutputRequiredTitle")}</b><span>{t("vst.nativeOutputRequiredGuideHint")}</span></div>
        </div>}
        <div className="native-overview-status">
          <h4>{t("device.guideTitle")}</h4>
          {nativeDeviceLoading ? <em>{t("device.detecting")}</em> : nativeDeviceStatus?.ok ? <em className="ready">{t("device.engineReady")}</em> : <em>{t("device.offline")}</em>}
          {nativeDeviceStatus?.ok && <p>
            {nativeDeviceStatus.juceDeviceName} · {nativeDeviceStatus.sampleRate?.toLocaleString()} Hz · {nativeDeviceStatus.bufferSize} samples / {nativeDeviceStatus.bufferMs?.toFixed(1)} ms · {nativeDeviceStatus.bitDepth}-bit · {nativeDeviceStatus.activeOutputChannels?.length || 0} ch
          </p>}
          {nativeDeviceStatus?.sampleRatePolicy && <small>RATE POLICY · {nativeDeviceStatus.sampleRatePolicy.toUpperCase()} · {nativeDeviceStatus.sampleRateMode?.toUpperCase()}</small>}
          {nativeCapabilities?.ok && <small>
            {t("device.reportedRates")} {nativeCapabilities.availableSampleRates?.join(" / ") || t("device.unknown")} Hz · {t("device.bufferRange")} {nativeCapabilities.availableBufferSizes?.[0] || "?"}–{nativeCapabilities.availableBufferSizes?.at(-1) || "?"} samples
          </small>}
        </div>
        <details className="module-details" open={nativeOutputGuideVisible || undefined}><summary>{t("device.signalPath")}</summary>
        <p className="native-overview-intro">{t("device.guideIntro")}</p>
        <div className="native-signal-flow" aria-label={t("device.signalPath")}>
          <span>{t("device.signalSource")}</span><i>→</i>
          <span>{t("device.signalFade")}</span><i>→</i>
          <span>{t("device.signalEffects")} <small>{t("device.whenEnabled")}</small></span><i>→</i>
          <span>{t("device.signalNative")}</span><i>→</i>
          <span>{t("device.signalDevice")}</span>
        </div>
        <div className="native-guide-grid">
          <article><b>{t("device.guideNativeTitle")}</b><p>{t("device.guideNativeBody")}</p></article>
          <article><b>{t("device.guideVstTitle")}</b><p>{t("device.guideVstBody")}</p></article>
          <article><b>{t("device.guideRateTitle")}</b><p>{t("device.guideRateBody")}</p></article>
          <article><b>{t("device.guideBufferTitle")}</b><p>{t("device.guideBufferBody")}</p></article>
        </div></details>
      </section>
      <section className="setting-card workspace-section unified-output-config">
        <header><SectionHeading icon={Globe2}>{t("device.directTitle")}</SectionHeading></header>
        <p>{t("device.directHint")}</p>
        <div className="unified-output-section chromium-device-setting"><div><label htmlFor="web-output-device">{t("device.webFallback")}</label><small id="web-output-hint">{t("device.webFallbackHint")}</small></div>
        <select id="web-output-device" aria-describedby="web-output-hint" value={deviceId} onChange={(event) => onDevice(event.target.value)}><option value="default">{t("common.defaultOutput")}</option>{devices.filter(d => d.id !== "default").map(device => <option value={device.id} key={device.id}>{device.label}</option>)}</select>
        {deviceError && <p className="error-text">{deviceError}</p>}
        </div>
      </section>
    </div>
  </Page>;

  if (page === "plugins") return <Page title={t("page.plugins")} code="NATIVE PLUGIN HOST" icon={<Blocks />}>
    <VstRack />
  </Page>;

  if (page === "appearance") return <Page title={t("page.appearance")} code="INTERFACE SYSTEM" icon={<Palette />}>
    <div className="appearance-layout">
    <section className="appearance-section panel"><SectionHeading icon={Palette}>{t("appearance.group.theme")}</SectionHeading>
    <div className="appearance-controls">      <label><span><b>{t("appearance.colorMode")}</b><small>{t("appearance.colorModeHint")}</small></span><select value={state.uiSettings.colorMode} onChange={(event) => state.setUiSetting("colorMode", event.target.value as "dark" | "light" | "system")}><option value="dark">{t("appearance.dark")}</option><option value="light">{t("appearance.light")}</option><option value="system">{t("appearance.system")}</option></select><em>{state.uiSettings.colorMode.toUpperCase()}</em></label></div>
    <div className="theme-swatches">{themes.map(([name, color]) => <button aria-label={name} title={name} aria-pressed={state.accent === color} className={`theme-swatch ${state.accent === color ? "active" : ""}`} key={name} onClick={() => state.setAccent(color)}>
      <span style={{ background: color }} /><b>{name}</b>{state.accent === color && <Check />}
    </button>)}
      <label className="theme-card custom-theme"><input type="color" value={state.accent} onChange={(event) => state.setAccent(event.target.value)} /><div><b>{t("appearance.customAccent")}</b><small>{state.accent.toUpperCase()}</small></div></label>
    </div>
      <button
        className={`theme-card custom-background-tile ${state.uiSettings.customBackgroundUrl ? "active" : ""}`}
        disabled={backgroundBusy || !window.desktop?.appearance}
        title={state.uiSettings.customBackgroundUrl ? t("appearance.clearBackgroundConfirm") : t("appearance.chooseBackground")}
        onClick={() => void handleCustomBackgroundClick()}
      >
        <span
          className="custom-background-thumbnail"
          style={state.uiSettings.customBackgroundUrl ? { backgroundImage: `url("${state.uiSettings.customBackgroundUrl.replace(/"/g, "%22")}")` } : undefined}
        >{!state.uiSettings.customBackgroundUrl && <ImagePlus />}</span>
        <div>
          <b>{t("appearance.customBackground")}</b>
          <small className={backgroundError ? "error" : ""}>{backgroundError || (state.uiSettings.customBackgroundPath
            ? state.uiSettings.customBackgroundPath.split(/[\\/]/).pop()
            : t("appearance.chooseBackground"))}</small>
        </div>
        {state.uiSettings.customBackgroundUrl && <Check />}
      </button>
      <div className="appearance-controls">
        <label><span><b>{t("background.folder")}</b><small>{state.uiSettings.backgroundFolder ? `${t("background.count").replace("{count}", String(state.uiSettings.backgroundImages.length))} · ${state.uiSettings.backgroundFolder}` : t("background.folderHint")}</small></span><button disabled={backgroundBusy} onClick={()=>void chooseBackgroundFolder()}>{backgroundBusy ? t("background.importing") : t("background.addFolder")}</button></label>
        <label><span><b>{t("background.auto")}</b><small>{t("background.autoHint")}</small></span><select disabled={state.uiSettings.backgroundImages.length<2} value={state.uiSettings.backgroundInterval} onChange={e=>state.setUiSetting("backgroundInterval",Number(e.target.value))}>{[[0,t("duration.off")],[15,t("duration.s15")],[30,t("duration.s30")],[60,t("duration.m1")],[300,t("duration.m5")],[600,t("duration.m10")],[1800,t("duration.m30")]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      </div>
    </section>
    <section className="appearance-section panel"><SectionHeading icon={Layers}>{t("appearance.group.glass")}</SectionHeading>
    <div className="appearance-controls">
      <label><span><b>{t("appearance.glass")}</b><small>{t("appearance.glassHint")}</small></span><select value={state.uiSettings.glassMaterial} onChange={(event) => state.setUiSetting("glassMaterial", event.target.value as "mica" | "acrylic" | "none")}><option value="mica">{t("appearance.mica")}</option><option value="acrylic">{t("appearance.acrylic")}</option><option value="none">{t("appearance.transparent")}</option></select><em>{state.uiSettings.glassMaterial.toUpperCase()}</em></label>
      <label><span><b>{t("appearance.opacity")}</b><small>{t("appearance.opacityHint")}</small></span><input type="range" min=".20" max="1" step=".01" value={state.uiSettings.windowOpacity} onDoubleClick={() => state.setUiSetting("windowOpacity", .94)} onChange={(event) => state.setUiSetting("windowOpacity", Number(event.target.value))} /><em>{Math.round(state.uiSettings.windowOpacity * 100)}%</em></label>
      <label><span><b>{t("appearance.glow")}</b><small>{t("appearance.glowHint")}</small></span><input type="range" min="0" max="3" step=".05" value={state.uiSettings.glowStrength} onDoubleClick={() => state.setUiSetting("glowStrength", 1)} onChange={(event) => state.setUiSetting("glowStrength", Number(event.target.value))} /><em>{state.uiSettings.glowStrength.toFixed(2)}×</em></label>
    </div>
    <AtmosphereSettings section="glass" lowPerformance={lowPerformanceMode} />
    </section>
    <section className="appearance-section panel"><SectionHeading icon={Music2}>{t("appearance.group.music")}</SectionHeading>
    <AtmosphereSettings section="music" lowPerformance={lowPerformanceMode} />
    </section>
    <section className="appearance-section panel"><SectionHeading icon={Sparkles}>{t("appearance.group.motion")}</SectionHeading>
    <div className="appearance-controls">      <div className={`appearance-animation-module ${state.uiSettings.animations && !state.uiSettings.lowPerformanceMode ? "active" : "disabled"}`}>
        <span><b>{t("appearance.animations")}</b><small>{t("appearance.animationsHint")}</small></span>
        <label className="animation-transition-field"><small>{t("appearance.transition")}</small><select disabled={!state.uiSettings.animations || state.uiSettings.lowPerformanceMode} value={state.uiSettings.visualTransition} onChange={(event) => state.setUiSetting("visualTransition", event.target.value as "dissolve" | "fade" | "zoom" | "slide" | "scan")}><option value="dissolve">{t("appearance.transitionDissolve")}</option><option value="fade">{t("appearance.transitionFade")}</option><option value="zoom">{t("appearance.transitionZoom")}</option><option value="slide">{t("appearance.transitionSlide")}</option><option value="scan">{t("appearance.transitionScan")}</option></select></label>
        <label className="animation-master-switch"><input aria-label={t("appearance.animations")} disabled={state.uiSettings.lowPerformanceMode} type="checkbox" checked={state.uiSettings.animations} onChange={(event) => state.setUiSetting("animations", event.target.checked)} /></label>
      </div>
</div>
    <AtmosphereSettings section="motion" lowPerformance={lowPerformanceMode} />
    <details className="appearance-performance"><summary>{t("appearance.group.performance")}</summary><div className="appearance-controls">
      <div className={`gpu-render-module ${state.uiSettings.gpuAccelerationEnabled && gpuCapabilities.webgl2 ? "active" : ""} ${gpuCapabilities.webgl2 ? "" : "unavailable"}`}>
        <span><b>{t("appearance.gpuAcceleration")}</b><small title={gpuCapabilities.renderer}>{gpuCapabilities.webgl2 ? `${t("appearance.gpuReady")} · ${gpuCapabilities.renderer}` : t("appearance.gpuUnavailable")}</small></span>
        <label className="gpu-quality-field"><small>{t("appearance.gpuQuality")}</small><select aria-label={t("appearance.gpuQuality")} disabled={!state.uiSettings.gpuAccelerationEnabled || !gpuCapabilities.webgl2} value={state.uiSettings.gpuQuality} onChange={(event) => state.setUiSetting("gpuQuality", event.target.value as GpuVisualQuality)}><option value="eco">{t("appearance.gpuEco")}</option><option value="standard">{t("appearance.gpuStandard")}</option><option value="cosmic">{t("appearance.gpuCosmic")}</option></select></label>
        <label className="gpu-master-switch"><input aria-label={t("appearance.gpuAcceleration")} disabled={!gpuCapabilities.webgl2} type="checkbox" checked={state.uiSettings.gpuAccelerationEnabled && gpuCapabilities.webgl2} onChange={(event) => state.setUiSetting("gpuAccelerationEnabled", event.target.checked)} /></label>
      </div>
      <label className={`low-performance-setting ${state.uiSettings.lowPerformanceMode ? "active" : ""}`}><span><b>{t("appearance.lowPerformanceMode")}</b><small>{t("appearance.lowPerformanceModeHint")}</small></span><em>{t(state.uiSettings.lowPerformanceMode ? "appearance.lowPerformanceActive" : "appearance.lowPerformanceFull")}</em><input aria-label={t("appearance.lowPerformanceMode")} type="checkbox" checked={state.uiSettings.lowPerformanceMode} onChange={(event) => state.setUiSetting("lowPerformanceMode", event.target.checked)} /></label>
    </div></details>
    </section>
    </div>
  </Page>;

  return <Page title={t("page.settings")} code="APPLICATION" icon={<Settings />}>
    <SystemSettings />
  </Page>;
}

function Page({ title, code, icon, children }: { title: string; code: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="workspace-page"><header><div className="page-icon">{icon}</div><div><span className="eyebrow">{code}</span><h2>{title}</h2></div><div className="page-header-aside" /></header><div className="page-content">{children}</div></section>;
}

function Empty({ text, button, onImport }: { text: string; button: string; onImport(): void }) {
  return <div className="page-empty"><FileAudio /><b>{text}</b><button onClick={onImport}>{button}</button></div>;
}

function nativeBackendLabel(backend: NativeAudioBackend) {
  if (backend === "wasapi-shared") return "WASAPI SHARED";
  if (backend === "wasapi-shared-low-latency") return "WASAPI LOW LATENCY";
  if (backend === "wasapi-exclusive") return "WASAPI EXCLUSIVE";
  return "DIRECTSOUND LEGACY";
}

function nativeDeviceKey(device: Pick<NativeOutputDeviceInfo, "juceTypeName" | "juceDeviceName">) {
  return `${device.juceTypeName}|${device.juceDeviceName}`;
}

function nativeRecoveryKey(recovery?: NativeDeviceTransactionResponse["recovery"]) {
  if (recovery === "previous-route-restored") return "device.recoveryPrevious";
  if (recovery === "safe-shared-restored") return "device.recoverySafeShared";
  if (recovery === "exclusive-profile-fallback") return "device.recoveryFallback";
  if (recovery === "recovery-failed") return "device.recoveryFailed";
  return "device.recoveryUnchanged";
}

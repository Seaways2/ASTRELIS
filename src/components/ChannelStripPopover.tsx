import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Blocks, ExternalLink, GripVertical, Plus, Power, RefreshCw, Search, ShieldAlert, SkipForward, Trash2, X } from "lucide-react";
import { audioEngine } from "../audio/AudioEngine";
import { useVstPluginSearch } from "../hooks/useVstPluginSearch";
import { useVstRackStore } from "../stores/vstRackStore";
import { contrastPeakColor } from "../utils/color";
import { amplitudeToMeterPosition, dbToMeterPosition, formatFaderScaleTick, METER_DB_TICKS } from "../utils/meterScale";
import { amplitudeToFaderPercent, formatFaderDb } from "../utils/volumeFaderScale";
import { useI18n } from "../i18n";
import { VolumeLevelIcon } from "./VolumeLevelIcon";
import { MainVolumeFader } from "./MainVolumeFader";

interface Props {
  onOpenChange?(open: boolean): void;
  direct?: boolean;
  directLabel?: string;
  onOpenOutput?(): void;
  volume: number;
  muted: boolean;
  restoreVolume: number;
  accent: string;
  glowStrength: number;
  windowOpacity: number;
  lightSurface: string;
  lowPerformance?: boolean;
  visible?: boolean;
  light: boolean;
  vstModeActive: boolean;
  vstModePending: boolean;
  vstModeLocked: boolean;
  vstModeLabel: string;
  vstModeDetail: string;
  vstAccessAvailable: boolean;
  onVolume(value: number): void;
  onMuted(muted: boolean): void;
  onToggleVstMode(): void;
  onOpenRack(): void;
  onRequestVstAccess(): void;
}

const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));

export function ChannelStripPopover({
  direct = false, directLabel = "", onOpenOutput, onOpenChange,
  volume, muted, restoreVolume, accent, glowStrength, windowOpacity, lightSurface, lowPerformance = false, visible = true, light, vstModeActive, vstModePending, vstModeLocked,
  vstModeLabel, vstModeDetail, vstAccessAvailable, onVolume, onMuted, onToggleVstMode, onOpenRack, onRequestVstAccess
}: Props) {
  const vst = useVstRackStore();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); }, [open, onOpenChange]);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [meter, setMeter] = useState({ left: 0, right: 0 });
  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const draggingSlotRef = useRef<number | null>(null);

  useEffect(() => { void vst.initialize(); }, []);

  useEffect(() => {
    if (!open) window.dispatchEvent(new CustomEvent("auralis:native-overlay-block", { detail: { open: false } }));
    return () => {
      if (open) window.dispatchEvent(new CustomEvent("auralis:native-overlay-block", { detail: { open: false } }));
    };
  }, [open]);

  const filteredPlugins = useVstPluginSearch(vst.plugins, query);

  const positionPanel = () => {
    const trigger = openerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const anchor = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = clamp(anchor.right - width, 8, Math.max(8, window.innerWidth - width - 8));
    const above = anchor.top - height - 10;
    const top = above >= 8 ? above : clamp(anchor.bottom + 10, 8, Math.max(8, window.innerHeight - height - 8));
    setPosition({ left, top });
  };

  useLayoutEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(positionPanel);
    const handleViewport = () => positionPanel();
    window.addEventListener("resize", handleViewport);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewport);
    };
  }, [open, query, vst.rack.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const bounds = panelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    window.dispatchEvent(new CustomEvent("auralis:native-overlay-block", {
      detail: {
        open: true,
        bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
      }
    }));
  }, [open, position.left, position.top, query, vst.rack.length]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !openerRef.current?.parentElement?.contains(target)) {
        setQuery("");
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (query) setQuery("");
      else { setOpen(false); openerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    const timer = visible ? window.setInterval(() => {
      const levels = audioEngine.meters();
      const left = clamp(levels.left), right = clamp(levels.right);
      setMeter(previous => previous.left === left && previous.right === right ? previous : { left, right });
    }, lowPerformance ? 240 : 50) : undefined;
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [open, query, lowPerformance, visible]);

  const toggleMute = () => {
    if (muted || volume <= .001) {
      const restored = Math.max(.01, restoreVolume || .72);
      onVolume(restored);
      onMuted(false);
    } else {
      onMuted(true);
    }
  };

  const effectiveVolume = muted ? 0 : volume;
  const db = formatFaderDb(effectiveVolume);
  const enabledCount = vst.rack.filter(item => item.enabled).length;

  return <>
    <div className="volume-trigger-group">
      <button
        ref={openerRef}
        className={`volume-popover-trigger ${open ? "active" : ""} ${muted || volume <= .001 ? "muted" : ""}`}
        title={`${open ? t("common.close") : t("common.open")} · ${t("channel.title")} · ${t("common.current")} ${muted ? t("common.muted") : `${amplitudeToFaderPercent(volume)}%`}`}
        aria-label={`${open ? t("common.close") : t("common.open")} · ${t("channel.title")}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(value => !value)}
      ><VolumeLevelIcon volume={volume} muted={muted} /></button>
    </div>

    {open && openerRef.current?.closest(".app-shell") && createPortal(<div
      ref={panelRef}
      className={`channel-strip-popover ${light ? "light" : ""} ${lowPerformance ? "low-performance" : ""}`}
      role="dialog"
      aria-label={t("channel.title")}
      style={{ left: position.left, top: position.top, "--accent": accent, "--glow-strength": glowStrength, "--window-opacity": windowOpacity, "--light-surface": lightSurface, "--meter-peak": contrastPeakColor(accent) } as React.CSSProperties}
    >
      <header><div><span>CHANNEL STRIP</span><b>{t("channel.masterOutput")}</b></div><button title={t("common.close")} onClick={() => setOpen(false)}><X /></button></header>

      {direct ? <section className="hdmi-output-policy">
        <h3>{t("device.hdmiDirect")}</h3>
        <p>{directLabel || t("device.hdmiAwaiting")}</p>
        <p>{t("device.hdmiVolume")}</p>
        <small>{t("device.hdmiHint")}</small>
        <button type="button" onClick={onOpenOutput}>{t("device.outputOptions")} <ExternalLink /></button>
      </section> : <>
      <section
        className={`channel-inserts ${vstAccessAvailable ? "" : "native-output-required"}`}
        aria-label={t("vst.insertChain")}
        onClickCapture={(event) => {
          if (vstAccessAvailable) return;
          event.preventDefault();
          event.stopPropagation();
          setQuery("");
          setOpen(false);
          onRequestVstAccess();
        }}
      >
        {!vstAccessAvailable && <button className="channel-native-output-guide" type="button" onClick={onRequestVstAccess}>
          <ShieldAlert /><span><b>{t("vst.nativeOutputRequiredTitle")}</b><small>{t("vst.nativeOutputRequiredChannelHint")}</small></span>
        </button>}
        <div className="channel-inserts-title">
          <div><Blocks /><span>INSERT FX</span><b>{enabledCount}/{vst.rack.length}</b></div>
          <div className="channel-inserts-actions">
            <button
              className={`channel-vst-mode ${vstModeActive ? "active" : ""} ${vstModePending ? "pending" : ""} ${vstModeLocked ? "locked" : ""}`}
              title={vstModeDetail}
              aria-pressed={vstModeActive}
              onClick={onToggleVstMode}
            ><Power /><span>{vstModeLabel}</span></button>
            {vst.scanning ? <>
              <button className="channel-scan-control" title={t("vst.skipCurrent")} disabled={!vst.scanProgress.normalizedPath} onClick={() => void vst.controlScan("skip")}><SkipForward /></button>
              <button className="channel-scan-control danger" title={t("vst.disableCurrent")} disabled={!vst.scanProgress.normalizedPath} onClick={() => void vst.controlScan("disable")}><Ban /></button>
            </> : <button title={t("channel.rescan")} onClick={() => void vst.scan()}><RefreshCw /></button>}
          </div>
        </div>
        <label className="channel-plugin-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuery(""); } }} placeholder={t("vst.searchAdd")} />{query ? <b>{filteredPlugins.length}</b> : <Plus />}</label>

        {query && <div className="channel-plugin-results">
          {filteredPlugins.map(plugin => {
            const loaded = vst.rack.some(item => item.id === plugin.id);
            return <button key={plugin.id} disabled={!plugin.loadable || loaded} title={plugin.error || plugin.path} onClick={() => { vst.addToRack(plugin); setQuery(""); }}>
              <Blocks /><span><b>{plugin.name}</b><small>{[plugin.manufacturer, plugin.category, plugin.version].filter(Boolean).join(" · ") || plugin.format}</small><small className="channel-plugin-path">{plugin.path}</small></span><em>{loaded ? "LOADED" : plugin.format}</em>
            </button>;
          })}
          {!vst.scanning && !filteredPlugins.length && <p>{t("vst.noMatched")}</p>}
          {vst.scanning && <p>{t("vst.scanningDatabase")}</p>}
        </div>}

        <div className="channel-rack-list">
          {vst.rack.map((item, index) => <div
            className={`channel-rack-slot ${item.enabled ? "enabled" : "bypassed"}`}
            draggable
            key={item.id}
            title={item.name}
            onDragStart={event => {
              draggingSlotRef.current = index;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-auralis-vst-slot", String(index));
            }}
            onDragOver={event => { if (draggingSlotRef.current === null) return; event.preventDefault(); event.stopPropagation(); }}
            onDrop={event => {
              if (draggingSlotRef.current === null) return;
              event.preventDefault();
              event.stopPropagation();
              vst.reorderRack(draggingSlotRef.current, index);
              draggingSlotRef.current = null;
            }}
            onDragEnd={() => { draggingSlotRef.current = null; }}
          >
            <GripVertical className="channel-slot-grip" />
            <button className="channel-slot-power" title={item.enabled ? t("common.bypass") : t("common.enable")} onClick={() => vst.toggleRackItem(item.id)}><Power /></button>
            <button className="channel-slot-name" title={`${t("common.open")} ${item.name}`} onClick={() => void vst.openEditor(item)}><b>{item.name}</b><small>{item.enabled ? "ACTIVE" : "BYPASSED"}</small></button>
            <button title={t("channel.openPlugin")} onClick={() => void vst.openEditor(item)}><ExternalLink /></button>
            <button title={t("channel.removePlugin")} onClick={() => void vst.removeFromRack(item.id)}><Trash2 /></button>
          </div>)}
          {!vst.rack.length && <div className="channel-rack-empty">{t("vst.noEffects")}</div>}
        </div>

        {vst.error && <div className="channel-vst-error"><span>{vst.error}</span><button onClick={vst.clearError}>×</button></div>}
        <button className="channel-open-rack" onClick={() => { setOpen(false); onOpenRack(); }}><Blocks /><span>{t("vst.openFullRack")}</span><ExternalLink /></button>
      </section>

      <div className="channel-fader-section">
        <MainVolumeFader volume={volume} muted={muted} restoreVolume={restoreVolume} onVolume={onVolume} onMuted={onMuted} />
        <div className="channel-meter" aria-label={t("channel.currentLevel")}>
          <i style={{ "--meter-level": `${amplitudeToMeterPosition(meter.left)}%` } as React.CSSProperties}><span /></i>
          <i style={{ "--meter-level": `${amplitudeToMeterPosition(meter.right)}%` } as React.CSSProperties}><span /></i>
        </div>
        <div className="channel-fader-scale" aria-hidden="true">
          {METER_DB_TICKS.map(tick => <span key={tick} style={{ bottom: `${dbToMeterPosition(tick)}%` }}>{formatFaderScaleTick(tick)}</span>)}
        </div>
      </div>

      <footer>
        <button className={`channel-mute ${muted ? "active" : ""}`} onClick={toggleMute}><Power /><span>{muted ? t("common.unmute") : t("common.mute")}</span></button>
        <div><b>{amplitudeToFaderPercent(effectiveVolume)}%</b><span>{db} dB</span></div>
      </footer>
      </>}
    </div>, openerRef.current.closest(".app-shell")!)}
  </>;
}

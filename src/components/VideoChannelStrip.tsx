import { memo, useEffect, useRef, useState } from "react";
import { Blocks, ExternalLink, GripVertical, Plus, Power, Search, Trash2 } from "lucide-react";
import type { VstRackItem } from "../stores/vstRackStore";
import { useVstRackStore } from "../stores/vstRackStore";
import { useVstPluginSearch } from "../hooks/useVstPluginSearch";
import { dbToMeterPosition, formatFaderScaleTick, METER_DB_TICKS } from "../utils/meterScale";
import { amplitudeToFaderPercent, formatFaderDb } from "../utils/volumeFaderScale";
import { useI18n } from "../i18n";
import { MainVolumeFader } from "./MainVolumeFader";

export const VideoChannelStrip = memo(function VideoChannelStrip({ direct, rackAudio, volume, muted, restoreVolume, plugins, onVolume, onMuted }: {
  direct: boolean; rackAudio: boolean; volume: number; muted: boolean; restoreVolume: number; plugins: VstRackItem[];
  onVolume(value: number): void; onMuted(value: boolean): void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const vst = useVstRackStore();
  const matches = useVstPluginSearch(vst.plugins, query);
  const effective = muted ? 0 : volume;
  const db = formatFaderDb(effective);
  const loaded = rackAudio ? plugins : [];
  const enabledCount = loaded.filter(item => item.enabled).length;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- initialises the rack when rack audio turns on; the store's actions are stable
  useEffect(() => { if (rackAudio) void vst.initialize(true); }, [rackAudio]);

  const toggleMute = () => {
    if (direct) return;
    if (muted || volume <= .001) { onVolume(Math.max(.01, restoreVolume || .72)); onMuted(false); }
    else onMuted(true);
  };
  const openEditor = async (id: string) => {
    setError("");
    try {
      const result = await window.desktop?.video.control("editor", id);
      if (!result?.ok) setError(result?.error || t("video.failed"));
    } catch (error) { setError(String(error)); }
  };
  const updateRack = async (updater: (rack: VstRackItem[]) => VstRackItem[], removedId?: string) => {
    if (!rackAudio || direct || busy) return;
    setBusy(true); setError("");
    try {
      const ok = await vst.updateVideoRack(updater, removedId);
      if (!ok) setError(useVstRackStore.getState().error || t("video.failed"));
    } finally { setBusy(false); }
  };
  const remove = async (item: VstRackItem) => {
    const confirmed = window.desktop?.confirmPluginRemoval
      ? await window.desktop.confirmPluginRemoval(item.name)
      : window.confirm(t("media.removePlugin", {name: item.name}));
    if (confirmed) await updateRack(rack => rack.filter(entry => entry.id !== item.id), item.formatSpecificPluginId);
  };

  return <section className="video-sidebar-strip" aria-label={t("channel.title")}>
    <header><div><span>CHANNEL STRIP</span><b>{t("channel.masterOutput")}</b></div><em>{direct ? "HDMI DIRECT" : rackAudio ? "PCM · VST" : "PCM"}</em></header>
    <section className={`channel-inserts video-channel-inserts ${rackAudio && !direct ? "" : "video-rack-inactive"}`} aria-label={t("vst.insertChain")}>
      <div className="channel-inserts-title"><div><Blocks /><span>INSERT FX</span><b>{enabledCount}/{loaded.length}</b></div></div>
      {rackAudio && !direct ? <>
        <label className="channel-plugin-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setQuery(""); }} placeholder={t("vst.searchAdd")} disabled={busy} />{query ? <b>{matches.length}</b> : <Plus />}</label>
        {query && <div className="channel-plugin-results">{matches.map(plugin => {
          const present = loaded.some(item => item.id === plugin.id);
          return <button key={plugin.id} disabled={busy || !plugin.loadable || present} title={plugin.error || plugin.path} onClick={() => { void updateRack(rack => [...rack, { ...plugin, enabled: true }]); setQuery(""); }}><Blocks /><span><b>{plugin.name}</b><small>{[plugin.manufacturer, plugin.category, plugin.version].filter(Boolean).join(" · ") || plugin.format}</small><small className="channel-plugin-path">{plugin.path}</small></span><em>{present ? "LOADED" : plugin.format}</em></button>;
        })}{!matches.length && <p>{t("vst.noMatched")}</p>}</div>}
        <div className="channel-rack-list">{loaded.map((item, index) => <div key={item.id}
          className={`channel-rack-slot ${item.enabled ? "enabled" : "bypassed"}`} draggable={!busy}
          onDragStart={event => { dragIndex.current = index; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-auralis-vst-slot", String(index)); }}
          onDragOver={event => { if (dragIndex.current !== null) { event.preventDefault(); event.stopPropagation(); } }}
          onDrop={event => { const from = dragIndex.current; dragIndex.current = null; if (from === null || from === index) return; event.preventDefault(); event.stopPropagation(); void updateRack(rack => { const next = [...rack]; const [moved] = next.splice(from, 1); next.splice(index, 0, moved); return next; }); }}
          onDragEnd={() => { dragIndex.current = null; }}>
          <GripVertical className="channel-slot-grip" />
          <button type="button" className="channel-slot-power" disabled={busy} title={item.enabled ? t("common.bypass") : t("common.enable")} onClick={() => void updateRack(rack => rack.map(entry => entry.id === item.id ? { ...entry, enabled: !entry.enabled } : entry))}><Power /></button>
          <button type="button" className="channel-slot-name" disabled={busy || !item.enabled} title={`${t("common.open")} ${item.name}`} onClick={() => void openEditor(item.formatSpecificPluginId)}><b>{item.name}</b><small>{item.enabled ? "ACTIVE" : "BYPASSED"}</small></button>
          <button type="button" disabled={busy || !item.enabled} title={t("channel.openPlugin")} onClick={() => void openEditor(item.formatSpecificPluginId)}><ExternalLink /></button>
          <button type="button" disabled={busy} title={t("channel.removePlugin")} onClick={() => void remove(item)}><Trash2 /></button>
        </div>)}{!loaded.length && <div className="channel-rack-empty">{t("vst.noEffects")}</div>}</div>
      </> : <p>{t(direct ? "video.sidebar.directRack" : "video.sidebar.rackOff")}</p>}
      {error && <div className="channel-vst-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}
    </section>
    <div className="channel-fader-section video-channel-fader-section">
      <MainVolumeFader volume={volume} muted={muted} restoreVolume={restoreVolume} disabled={direct} onVolume={onVolume} onMuted={onMuted} />
      <div className="channel-fader-scale" aria-hidden="true">{METER_DB_TICKS.map(tick => <span key={tick} style={{ bottom: `${dbToMeterPosition(tick)}%` }}>{formatFaderScaleTick(tick)}</span>)}</div>
    </div>
    <footer className="video-channel-footer"><button type="button" disabled={direct} className={`channel-mute ${muted ? "active" : ""}`} onClick={toggleMute}><Power /><span>{t(muted ? "common.unmute" : "common.mute")}</span></button><div><b>{amplitudeToFaderPercent(effective)}%</b><span>{db} dB</span></div></footer>
    {direct && <p className="video-sidebar-direct-hint">{t("device.hdmiVolume")}</p>}
  </section>;
});

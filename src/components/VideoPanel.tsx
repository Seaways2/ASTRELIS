import { useEffect, useRef, useState } from "react";
import { Film, FolderOpen, Maximize, Pause, Play, Subtitles, X } from "lucide-react";
import type { VideoState } from "../../electron/videoPlayer";
import { SubtitleSync } from "./SubtitleSync";
import { useI18n } from "../i18n";
import "./VideoPanel.css";

const time = (value: number) => `${Math.floor(value / 3600).toString().padStart(2, "0")}:${Math.floor(value / 60 % 60).toString().padStart(2, "0")}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
export function VideoPanel({ beforePlay, afterPlay, onClose }: { beforePlay: () => Promise<void>; afterPlay: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<VideoState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [direct, setDirect] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const active = Boolean(state?.active);
  const ready = Boolean(state?.ready);
  const wasActive = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
    const receive = (next: VideoState) => {
      setState(next);
      if (wasActive.current && !next.active) afterPlay();
      wasActive.current = next.active;
    };
    const dispose = window.desktop?.video.onState(receive);
    void window.desktop?.video.state().then(receive);
    return () => { dispose?.(); };
  }, [afterPlay]);
  const run = async (action: string, value?: string | number) => {
    const result = await window.desktop?.video.control(action, value);
    if (!result?.ok) setError(result?.error || t("video.failed"));
    return Boolean(result?.ok);
  };
  const choose = async () => {
    if (busy || active) return;
    setBusy(true); setError("");
    try {
      const picked = await window.desktop?.video.choose();
      if (picked?.canceled) return;
      if (!picked?.ok || !picked.path) throw new Error(picked?.error || t("video.failed"));
      await beforePlay();
      const result = await window.desktop?.video.open(picked.path, direct, "legacy-preview");
      if (!result?.ok) throw new Error(result?.error || t("video.failed"));
    } catch (e) { setError(String(e)); afterPlay(); }
    finally { setBusy(false); }
  };
  const close = async () => {
    if (busy) return;
    setBusy(true);
    try { if (active && !await run("close")) return; afterPlay(); onClose(); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="video-panel" aria-labelledby="video-title" onCancel={event => { event.preventDefault(); void close(); }}>
    <header><div><span className="eyebrow">VIDEO · PREVIEW</span><h2 id="video-title"><Film />{t("video.title")}</h2></div>
      <button disabled={busy} aria-label={t("video.return")} onClick={() => void close()}><X /></button></header>
    <div className="video-summary"><Film size={40} /><h3>{state?.title || t("video.empty")}</h3>
      <p>{t("video.hint")}</p><span className="video-tag">{t("video.bypass")}</span></div>
    <div className="video-actions">
      <button className="video-primary" disabled={busy || active} onClick={() => void choose()}><FolderOpen />{busy ? t("video.loading") : t("video.open")}</button>
      <button disabled={!ready || busy} onClick={() => void run("toggle")}>{state?.paused || state?.ended ? <Play /> : <Pause />}{t(state?.paused || state?.ended ? "common.play" : "common.pause")}</button>
      <button disabled={!active || busy} onClick={() => void run("fullscreen")}><Maximize />{t("video.fullscreen")}</button>
      <button disabled={!active || busy} onClick={async () => { setBusy(true); try { await run("close"); } finally { setBusy(false); } }}>{t("video.stop")}</button>
    </div>
    <label className="video-direct"><input type="checkbox" checked={direct} disabled={active || busy} onChange={e => setDirect(e.target.checked)} />{t("video.direct")}</label>
    <p className="video-help">{t(direct ? "video.directHint" : "video.pcmHint")}</p>
    <div className="video-progress"><span>{time(scrub ?? state?.position ?? 0)}</span><input aria-label={t("video.seek")} type="range" min="0" max={state?.duration || 1} step="0.1"
      disabled={!ready} value={scrub ?? state?.position ?? 0} onChange={e => setScrub(Number(e.target.value))}
      onPointerUp={e => { void run("seek", Number(e.currentTarget.value)); setScrub(null); }}
      onPointerCancel={() => setScrub(null)} onKeyUp={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { void run("seek", Number(e.currentTarget.value)); setScrub(null); } }} />
      <span>{time(state?.duration || 0)}</span></div>
    <div className="video-options">
      <label>{t("video.audio")}<select disabled={!ready} value={state?.tracks.find(track => track.type === "audio" && track.selected)?.id ?? ""} onChange={e => void run("audio", Number(e.target.value))}>
        {state?.tracks.filter(track => track.type === "audio").map(track => <option key={track.id} value={track.id}>{track.id} · {track.title || track.lang || t("video.audio")}</option>)}</select></label>
      <label>{t("video.subtitles")}<select disabled={!ready} value={state?.tracks.find(track => track.type === "sub" && track.selected)?.id ?? "no"} onChange={e => void run("subtitle", e.target.value === "no" ? "no" : Number(e.target.value))}>
        <option value="no">{t("video.subOff")}</option>{state?.tracks.filter(track => track.type === "sub").map(track => <option key={track.id} value={track.id}>{track.id} · {track.title || track.lang || t("video.subtitles")}</option>)}</select></label>
      <button disabled={!ready} onClick={async () => { const result = await window.desktop?.video.subtitle(); if (!result?.ok) setError(result?.error || t("video.failed")); }}><Subtitles />{t("video.addSubtitle")}</button>
      <SubtitleSync state={state} onError={setError} />
    </div>
    <label className="video-volume">{t("video.volume")}<input aria-label={t("video.volume")} type="range" min="0" max="100" disabled={!ready || Boolean(state?.direct)} value={state?.volume ?? 50} onChange={e => void run("volume", Number(e.target.value))} /></label>
    {active && <p className="video-help">{state?.videoCodec} / {state?.audioCodec} · {state?.output || t("video.loading")} · HW: {state?.hwdec || "—"}</p>}
    {(error || state?.error) && <p role="alert" className="video-error">{error || state?.error}</p>}
    <footer>{t("video.keys")}</footer>
  </dialog>;
}

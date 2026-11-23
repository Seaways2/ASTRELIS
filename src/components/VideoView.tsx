import { LoaderCircle, ArrowLeft, Maximize, AudioLines, Subtitles, FolderPlus, Speaker, Blocks, Cable, SlidersHorizontal, TriangleAlert, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { VideoState } from "../../electron/videoPlayer";
import { useI18n } from "../i18n";
import { usePlayerStore } from "../stores/playerStore";
import "./VideoView.css";
import { defaultVideoDsp, type VideoDsp } from "../../electron/videoDsp";
import { SubtitleSync } from "./SubtitleSync";
import { VideoControlSelect } from "./VideoControlSelect";
// Reopening is a new play request for the same queue item; reloadCurrentTrack
// keeps currentTime, so a video that failed at its bookmark reopens there.
const retryCurrentVideo = () => {
  const store = usePlayerStore.getState();
  if (store.currentIndex >= 0) store.reloadCurrentTrack();
};
export function VideoView({ state, visible, direct, setDirect, rackEnabled, setRackEnabled, onFullscreen, windowBusy, onBack, preparing = "" }: { preparing?: string; onFullscreen:()=>void; windowBusy:boolean; onBack:()=>void; state?: VideoState; visible: boolean; direct: boolean; setDirect: (value: boolean) => void; rackEnabled: boolean; setRackEnabled: (value: boolean) => void }) {
  const surface = useRef<HTMLDivElement>(null);
  const { t, tm } = useI18n();
  const [waitSeconds, setWaitSeconds] = useState(0);
  const busy = Boolean(preparing);
  useEffect(() => {
    setWaitSeconds(0);
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setWaitSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const [error,setError] = useState("");
  const errorTimer = useRef<ReturnType<typeof setTimeout>>();
  const reportError = (message: string) => {
    clearTimeout(errorTimer.current);
    errorTimer.current = undefined;
    setError(message);
    if (message) errorTimer.current = setTimeout(() => {
      errorTimer.current = undefined;
      setError(current => current === message ? "" : current);
    }, 5000);
  };
  const clearError = () => reportError("");
  const [dspOpen,setDspOpen] = useState(false);
  const [dspSaving,setDspSaving] = useState(false);
  const [dsp,setDsp] = useState<VideoDsp>(state?.dsp || defaultVideoDsp());
  const dspTimer = useRef<ReturnType<typeof setTimeout>>();
  const dspRevision = useRef(0);
  useEffect(() => { if (state?.dsp && !dspTimer.current) setDsp(state.dsp); },[state?.dsp]);
  useEffect(() => () => { clearTimeout(dspTimer.current); clearTimeout(errorTimer.current); dspRevision.current++; },[]);
  const updateDsp = (next: VideoDsp) => {
    setDsp(next); setDspSaving(true); clearTimeout(dspTimer.current);
    const revision = ++dspRevision.current;
    dspTimer.current = setTimeout(async () => {
      const result = await window.desktop?.video.control("dsp",JSON.stringify(next));
      if (revision !== dspRevision.current) return;
      dspTimer.current = undefined;
      setDspSaving(false);
      if (!result?.ok) { reportError(result?.error || t("video.failed")); }
      else clearError();
    },120);
  };
  const dspBlocked = !state?.ready || Boolean(state?.direct) || Boolean(state?.rackAudio) || state?.outputChannels !== 2;
  // A file mpv cannot load keeps its error on the closed engine. Show it in
  // place of the picture for this play request. Play on it reopens the file
  // in App's transport effect, which stays mounted on every page; this view
  // only offers the explicit retry.
  const playbackToken = usePlayerStore(store => { const track = store.tracks[store.currentIndex]; return track ? `${track.id}:${store.localPlayRequest}` : ""; });
  const failed = !busy && Boolean(state?.error) && !state?.ready && Boolean(playbackToken) && state?.playbackToken === playbackToken;

  useEffect(() => {
    const sync = () => {
      const r=surface.current?.getBoundingClientRect();
      if(r) window.desktop?.video.bounds({x:Math.max(0,r.x),y:Math.max(0,r.y),width:r.width,height:r.height,visible:visible&&!busy&&Boolean(state?.ready)});
    };
    sync();const observer=new ResizeObserver(sync);if(surface.current)observer.observe(surface.current);
    // Also follow page transition transforms and DPI/zoom changes without moving the parent window.
    const timer=window.setInterval(sync,100);
    return()=>{observer.disconnect();clearInterval(timer);window.desktop?.video.bounds({x:0,y:0,width:1,height:1,visible:false});};
  },[visible,state?.ready,busy]);
  const control=async(action:string,value?:number|string)=>{const r=await window.desktop?.video.control(action,value);if(!r?.ok)reportError(r?.error||t("video.failed"));};
  return <div className="embedded-video">
    <div ref={surface} className="embedded-video-surface" aria-busy={busy}>
      {busy ? <div className="video-preparation" role="status" aria-live="polite"><LoaderCircle aria-hidden="true" /><b>{t(preparing)}</b><span>{t("video.preparing.hint")}</span><output aria-live="off">{waitSeconds}s</output></div>
        : failed ? <div className="video-failure" role="alert"><TriangleAlert aria-hidden="true" /><b>{t("video.unplayable")}</b><span>{t("video.unplayable.hint")}</span><code>{tm(state?.error || "")}</code><button type="button" onClick={retryCurrentVideo}><RotateCcw aria-hidden="true" />{t("video.retry")}</button></div>
        : <span>{state?.error ? tm(state.error) : (!state?.ready?t("video.loading"):"")}</span>}
    </div>
    <div className="embedded-video-controls">
      <div className="video-control-group video-navigation"><button onClick={onBack}><ArrowLeft />{t("video.return")}</button>
      <button disabled={busy || windowBusy || dspSaving || !state?.ready} onClick={onFullscreen}><Maximize />{t("video.fullscreen")}</button></div>
      <div className="video-control-group video-tracks">

      <VideoControlSelect className="video-track-select" label={t("video.audio")} icon={<AudioLines />} value={String(state?.tracks.find(v=>v.type==="audio"&&v.selected)?.id ?? "")} emptyLabel={t("video.audio")} disabled={busy || !state?.ready} options={(state?.tracks.filter(v=>v.type==="audio") || []).map(v=>({value:String(v.id),label:`${v.id} · ${v.title||v.lang||t("video.audio")}`}))} onChange={value=>void control("audio",Number(value))} />
      <VideoControlSelect className="video-track-select" label={t("video.subtitles")} icon={<Subtitles />} value={String(state?.tracks.find(v=>v.type==="sub"&&v.selected)?.id ?? "no")} disabled={busy || !state?.ready} options={[{value:"no",label:t("video.subOff")},...(state?.tracks.filter(v=>v.type==="sub") || []).map(v=>({value:String(v.id),label:`${v.id} · ${v.title||v.lang||t("video.subtitles")}`}))]} onChange={value=>void control("subtitle",value==="no"?"no":Number(value))} />
      <button disabled={busy || !state?.ready} onClick={async()=>{const r=await window.desktop?.video.subtitle();if(!r?.ok)reportError(r?.error||t("video.failed"));}} title={t("video.addSubtitle")} aria-label={t("video.addSubtitle")}><FolderPlus /></button>
      <SubtitleSync state={state} disabled={busy} onError={reportError} /></div>
      <div className="video-control-group video-audio-routing">      {!state?.rackAudio && <VideoControlSelect className="video-device-select" label={t("video.device")} icon={<Speaker />} value={state?.audioDevice || "auto"} disabled={busy || !state?.ready} options={(state?.audioDevices?.length ? state.audioDevices : [{name:"auto",description:""}]).map(d=>({value:d.name,label:d.name==="auto"?t("video.defaultDevice"):d.description}))} onChange={value=>void control("device",value)} />}
      {!rackEnabled && <button disabled={busy} aria-expanded={dspOpen} onClick={()=>setDspOpen(!dspOpen)} title={t("video.dsp."+(state?.dspStatus || "waiting"))}><SlidersHorizontal />{t("video.dsp.title")}</button>}
      <label className="embedded-video-direct" title={t("video.rackHint")}><input type="checkbox" disabled={busy || direct} checked={rackEnabled && !direct} onChange={e=>setRackEnabled(e.target.checked)}/><Blocks aria-hidden="true" />{t("video.rackShort")}</label>
      <label className="embedded-video-direct" title={t("video.directHint")}><input type="checkbox" disabled={busy} checked={direct} onChange={e=>setDirect(e.target.checked)}/><Cable aria-hidden="true" />{t("video.directShort")}</label></div>
    </div>
    {dspOpen && !rackEnabled && <section className="video-dsp" aria-label={t("video.dsp.title")}>
      <div className="video-dsp-header"><label><input type="checkbox" disabled={dspBlocked} checked={dsp.enabled} onChange={e=>updateDsp({...dsp,enabled:e.target.checked})}/>{t("video.dsp.enable")}</label><span role="status">{dspSaving?t("video.loading"):t("video.dsp."+(state?.dspStatus || "waiting"))}</span>
      </div>
      <div className="video-dsp-sliders">{(["spatial","dialogue"] as const).map(key=><label key={key}>{t("video.dsp."+key)}<input type="range" min="0" max="100" step="1" aria-label={t("video.dsp."+key)} disabled={dspBlocked || !dsp.enabled} value={dsp[key]} onChange={e=>updateDsp({...dsp,[key]:Number(e.target.value)})}/><output>{dsp[key]}%</output></label>)}</div>
      <p>{t("video.dsp.hint")}</p>
    </section>}
    {(error || state?.dspError) && <div className="video-dsp-error" role="alert">{tm(error || state?.dspError || "")}</div>}
    <small title={t(state?.rackAudio ? "video.rackHint" : "video.deviceHint")}>{t(state?.rackAudio ? "video.rackHint" : "video.deviceHint")} · {error || state?.error || `${state?.rackAudio ? t("video.rack") : t("video.bypass")} · ${state?.videoCodec||""} / ${state?.audioCodec||""} · ${state?.output||""}`}</small>
  </div>;
}

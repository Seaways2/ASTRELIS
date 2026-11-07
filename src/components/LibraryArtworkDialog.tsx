import { MatchTaskDock, type MatchPresentation } from "./MatchTaskDock";
import { LibraryMusicMatch } from "./LibraryMusicMatch";
import { LibraryFilmMatch } from "./LibraryFilmMatch";
import { useEffect, useState } from "react";
import { Camera, ImagePlus, LockKeyhole, RotateCcw, UnlockKeyhole, X } from "lucide-react";
import { createPortal } from "react-dom";
import { usePlayerStore } from "../stores/playerStore";
import { useI18n } from "../i18n";
import { isVideoTrack } from "../utils/videoTrack";
import { getCoverFlowPosition, resetCoverFlowPosition, setCoverFlowPosition } from "../utils/coverFlowFraming";
import type { Track } from "../types/audio";
export function LibraryArtworkDialog({ track, onClose, background, blocked, onBackground, onForeground }: { track: Track; onClose(): void } & MatchPresentation) {
  const { t, tm } = useI18n();
  const [musicOpen, setMusicOpen] = useState(false);
  const [tab, setTab] = useState<"cover" | "film">("cover");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [coverAspect, setCoverAspect] = useState(1);
  const [cropPosition, setCropPosition] = useState(() => track.coverUrl ? getCoverFlowPosition(track.coverUrl, 1) : 50);
  const labels = ["artwork", "chooseCover", "captureFrame", "lockCover", "unlockCover", "coverHint", "working", "close"].map(key => t("media." + key));
  useEffect(() => {
    setCoverAspect(1);
    setCropPosition(track.coverUrl ? getCoverFlowPosition(track.coverUrl, 1) : 50);
  }, [track.coverUrl]);
  const perform = async (action: "choose" | "frame" | "lock" | "unlock") => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await window.desktop?.library.artwork(track.id, action);
      if (!result?.ok) throw new Error(result?.error || "media.coverFailed");
      if (!result.canceled) {
        await usePlayerStore.getState().hydrateLibrary();
        const updated = usePlayerStore.getState().libraryTracks.find(item => item.id === track.id);
        if (updated) usePlayerStore.setState(state => ({
          tracks: state.tracks.map(item => item.id === updated.id ? { ...item, coverUrl: updated.coverUrl, coverLocked: updated.coverLocked } : item),
          inactiveTracks: state.inactiveTracks.map(item => item.id === updated.id ? { ...item, coverUrl: updated.coverUrl, coverLocked: updated.coverLocked } : item)
        }));
      }
    } catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
    finally { setBusy(false); }
  };
  if (musicOpen) return <LibraryMusicMatch tracks={[track]} onClose={()=>background?onClose():setMusicOpen(false)} background={background} blocked={blocked} onBackground={onBackground} onForeground={onForeground}/>;
  return <>{background&&<MatchTaskDock title={t("media.artwork")} busy={busy} done={0} total={0} blocked={blocked} onOpen={onForeground} onClose={onClose}/>}{createPortal(<div className="library-artwork-backdrop" style={background?{display:"none"}:undefined} onKeyDown={e => { if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") {
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary"));
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (!first) { e.preventDefault(); return; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      } }}>
    <section className={`library-artwork-dialog ${tab === "film" ? "film-mode" : ""}`} role="dialog" aria-modal="true" aria-label={tab === "film" ? t("media.onlineInfo") : labels[0]}>
      <header><b>{tab === "film" ? t("media.onlineInfo") : labels[0]}</b><span className="match-dialog-actions"><button autoFocus disabled={busy} aria-label={labels[7]} onClick={onClose}><X /></button>{onBackground&&<button className="match-background-button" onClick={onBackground}>{t("match.background")}</button>}</span></header>
      {isVideoTrack(track) && tab === "cover" && <div className="artwork-navigation"><button disabled={busy} onClick={() => setTab(tab === "cover" ? "film" : "cover")}>{tab === "cover" ? t("media.onlineInfo") : t("media.backToCover")}</button></div>}
      {tab === "cover" && <><strong>{track.name}</strong>
      {track.coverUrl ? <img src={track.coverUrl} alt="" onLoad={event => {
        const image = event.currentTarget;
        const ratio = image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1;
        setCoverAspect(ratio);
        setCropPosition(getCoverFlowPosition(track.coverUrl!, ratio));
      }} /> : <ImagePlus className="artwork-placeholder" />}
      {track.coverUrl && coverAspect > 1.05 && <div className="library-cover-flow-control">
        <div className="library-cover-flow-preview"><img src={track.coverUrl} alt="" style={{ objectPosition: `${cropPosition}% center` }} /></div>
        <div className="library-cover-flow-adjust">
          <div className="library-cover-flow-heading"><label htmlFor={`cover-flow-position-${track.id}`}>{t("media.coverFlowCrop")}</label><button type="button" onClick={() => { resetCoverFlowPosition(track.coverUrl!); setCropPosition(getCoverFlowPosition(track.coverUrl!, coverAspect)); }}><RotateCcw />{t("media.coverFlowCropAuto")}</button></div>
          <input id={`cover-flow-position-${track.id}`} type="range" min="0" max="100" step="1" value={cropPosition} aria-valuetext={`${cropPosition}%`} onChange={event => {
            const next = Number(event.target.value);
            setCropPosition(next);
            setCoverFlowPosition(track.coverUrl!, next);
          }} />
          <div className="library-cover-flow-ends"><span>{t("media.coverFlowCropLeft")}</span><output>{cropPosition}%</output><span>{t("media.coverFlowCropRight")}</span></div>
          <small>{t("media.coverFlowCropHint")}</small>
        </div>
      </div>}
      <div className="library-artwork-actions"><button disabled={busy} onClick={() => void perform("choose")}><ImagePlus />{labels[1]}</button>
      {isVideoTrack(track) && <button disabled={busy} onClick={() => void perform("frame")}><Camera />{labels[2]}</button>}
      <button disabled={busy || (!track.coverUrl && !track.coverLocked)} onClick={() => void perform(track.coverLocked ? "unlock" : "lock")}>{track.coverLocked ? <UnlockKeyhole /> : <LockKeyhole />}{labels[track.coverLocked ? 4 : 3]}</button>
      {!isVideoTrack(track)&&<button disabled={busy} onClick={()=>setMusicOpen(true)}>{t("music.title")}</button>}</div>
      <p>{labels[5]}</p><div role="status">{busy ? labels[6] : tm(error)}</div></>}
      {isVideoTrack(track) && tab === "film" && <LibraryFilmMatch track={track} onBusy={setBusy} onBack={() => setTab("cover")} />}
    </section>
  </div>, document.querySelector(".app-shell") || document.body)}</>;
}

import { useI18n } from "../i18n";
import { LibraryApiSettings } from "./LibraryApiSettings";
import tmdbLogo from "../assets/tmdb.svg";
import { useEffect, useRef, useState } from "react";
import { Search, KeyRound, Check, Film } from "lucide-react";
import type { Track } from "../types/audio";
import type { FilmMetadata } from "../../electron/library/media/TmdbClient";
import { usePlayerStore } from "../stores/playerStore";
export function LibraryFilmMatch({ track, onBusy, onBack }: { track: Track; onBusy(busy: boolean): void; onBack(): void }) {
  const { t, tm } = useI18n();
  const [configured, setConfigured] = useState(false), [settings, setSettings] = useState(false);
  const [query, setQuery] = useState(track.name), [year, setYear] = useState(String(track.year || "")), [type, setType] = useState<"movie" | "tv">(track.onlineMetadata?.mediaType || "movie");
  const [preview, setPreview] = useState(""), [results, setResults] = useState<FilmMetadata[]>([]), [selected, setSelected] = useState<FilmMetadata | undefined>(track.onlineMetadata);
  const [replace, setReplace] = useState(!track.coverLocked), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { let active = true; void window.desktop?.library.tmdb({ action: "status" }).then(r => { if (active) { setConfigured(!!r.configured); } }).catch(() => { if(active)setMessage("media.apiReadError"); }); return () => { active = false; }; }, []);
  const resumeSearch=useRef(false);
  async function run(task: () => Promise<void>) { setBusy(true); onBusy(true); setMessage(""); try { await task(); } catch (e) { setMessage(e instanceof Error ? e.message : t("media.operationFailed")); } finally { setBusy(false); onBusy(false); } }
  async function call(request: Record<string, unknown>) { const result = await window.desktop?.library.tmdb(request); if (!result?.ok) throw new Error(result?.error || t("media.serviceUnavailable")); return result; }
  async function save() {
    if (!selected) return;
    await call({ action: "apply", trackId: track.id, type: selected.mediaType, id: selected.id, replaceCover: replace });
    await usePlayerStore.getState().hydrateLibrary();
    const updated = usePlayerStore.getState().libraryTracks.find(t => t.id === track.id);
    if (updated) usePlayerStore.setState(state => { const patch = (t: Track) => t.id === track.id ? { ...t, name: updated.name, year: updated.year, genre: updated.genre, coverUrl: updated.coverUrl, coverLocked: updated.coverLocked, onlineMetadata: updated.onlineMetadata } : t; return { tracks: state.tracks.map(patch), inactiveTracks: state.inactiveTracks.map(patch) }; });
    setMessage("media.filmSaved");
  }
  const search = () => run(async () => {const r=await call({action:"search",query,year,type});setResults(r.results||[]);setSelected(undefined);setPreview("");if(!r.results?.length)setMessage("media.noCandidates");});
  if(settings)return <LibraryApiSettings configured={configured} onChanged={setConfigured} onClose={()=>{resumeSearch.current=false;setSettings(false);}} onSaved={()=>{setSettings(false);if(resumeSearch.current){resumeSearch.current=false;void search();}}}/>;
  return <div className="library-film-match">
    <header className="film-api-toolbar"><button disabled={busy} onClick={onBack}>{t("media.backToCover")}</button><button disabled={busy} title={t("media.apiGlobal")} onClick={() => {resumeSearch.current=false;setSettings(true);}}><KeyRound />{t("media.apiSettings")}</button></header>

    <fieldset disabled={busy}><div className="film-search-row"><input aria-label={t("media.searchTitle")} value={query} onChange={e => setQuery(e.target.value)} placeholder={t("media.titlePlaceholder")} /><input aria-label={t("media.optionalYear")} className="film-year" value={year} onChange={e => setYear(e.target.value)} placeholder={t("media.year")} maxLength={4} /><select aria-label={t("media.mediaType")} value={type} onChange={e => setType(e.target.value as "movie" | "tv")}><option value="movie">{t("media.movie")}</option><option value="tv">{t("media.series")}</option></select><button title={t("media.searchCandidates")} disabled={!query.trim()} onClick={() => {if(!configured){resumeSearch.current=true;setSettings(true);}else void search();}}><Search /></button></div>
    <div className="film-results">{results.map(item => <button key={item.mediaType + item.id} aria-pressed={selected?.id === item.id && selected.mediaType === item.mediaType} onClick={() => void run(async () => { const r = await call({ action: "details", type: item.mediaType, id: item.id }); setSelected(r.metadata); setPreview(r.posterPreview || ""); })}><Film /><span>{item.title}<small>{item.originalTitle} · {item.year || t("media.unknownYear")}</small></span></button>)}</div>
    {selected && <div className="film-preview">{preview && <img className="film-poster" src={preview} alt={t("media.candidatePoster")} />}<strong>{selected.title} · {selected.year || t("media.unknownYear")}</strong><p>{selected.genres.join(" / ")}</p><p>{selected.overview || t("media.noOverview")}</p>{selected.cast.length > 0 && <p>{t("media.cast")}{selected.cast.join("、")}</p>}<label><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} disabled={!selected.posterPath} />{t("media.usePoster")}{track.coverLocked ? t("media.replaceLocked") : ""}</label><button onClick={() => void run(save)}><Check />{t("media.confirmMatch")}</button></div>}
    </fieldset><div role="status" aria-live="polite">{busy ? t("media.connecting") : tm(message)}</div>
    <details className="film-credits"><summary>{t("media.credits")}</summary><img className="tmdb-logo" src={tmdbLogo} alt="TMDB" /><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>{t("media.providedBy")}</p></details>
  </div>;
}

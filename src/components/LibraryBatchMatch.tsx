import { MatchTaskDock, type MatchPresentation } from "./MatchTaskDock";
import { useI18n } from "../i18n";
import { LibraryApiSettings } from "./LibraryApiSettings";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X, Pause, RotateCcw, Layers, Film, KeyRound } from "lucide-react";
import { groupFilmMatches, confidentFilmMatch, type MatchGroup } from "../../electron/library/media/filmMatchBatch";
import type { FilmMetadata } from "../../electron/library/media/TmdbClient";
import type { Track } from "../types/audio";
import { usePlayerStore } from "../stores/playerStore";
import tmdbLogo from "../assets/tmdb.svg";
type Job = MatchGroup & { status: "pending" | "searching" | "review" | "saved" | "missing" | "error"; candidates: FilmMetadata[]; chosen?: number; error?: string };
export function LibraryBatchMatch({ tracks, scope, onClose, serviceControl, background, blocked, onBackground, onForeground }: { tracks: Track[]; scope: string; onClose(): void; serviceControl?: ReactNode } & MatchPresentation) {
  const { t, tm } = useI18n();
  const [initialSkipped] = useState(() => tracks.filter(t => t.onlineMetadata).length);
  const [jobs, setJobs] = useState<Job[]>(() => groupFilmMatches(tracks).map(g => ({ ...g, status: "pending", candidates: [] })));
  const [selected, setSelected] = useState(() => new Set(groupFilmMatches(tracks).map(g => g.key)));
  const [busy, setBusy] = useState(false), [configured, setConfigured] = useState(false), [notice, setNotice] = useState("");
  const [settingsOpen,setSettingsOpen]=useState(false);
  const resumeAfterSettings=useRef(false);
  const [showSaved, setShowSaved] = useState(false);
  const [posters, setPosters] = useState(true);
  const stop = useRef(false), active = useRef(false);
  useEffect(() => { void window.desktop?.library.tmdb({ action: "status" }).then(r => setConfigured(!!r.configured)).catch(() => setNotice("media.apiReadError")); return () => { stop.current = true; }; }, []);
  useEffect(()=>{if(blocked)stop.current=true;},[blocked]);
  const patch = (key: string, change: Partial<Job>) => setJobs(all => all.map(j => j.key === key ? { ...j, ...change } : j));
  async function call(request: Record<string, unknown>) { const r = await window.desktop?.library.tmdb(request); if (!r?.ok) throw new Error(r?.error || t("media.serviceUnavailable")); return r; }
  async function refresh() {
    await usePlayerStore.getState().hydrateLibrary();
    const byId = new Map(usePlayerStore.getState().libraryTracks.map(t => [t.id, t]));
    const update = (t: Track) => { const v = byId.get(t.id); return v ? { ...t, name: v.name, year: v.year, genre: v.genre, coverUrl: v.coverUrl, coverLocked: v.coverLocked, onlineMetadata: v.onlineMetadata } : t; };
    usePlayerStore.setState(s => ({ tracks: s.tracks.map(update), inactiveTracks: s.inactiveTracks.map(update) }));
  }
  async function save(job: Job, match: FilmMetadata) {
    await call({ action: "batchApply", trackIds: job.ids, type: match.mediaType, id: match.id, replaceCover: posters });
    patch(job.key, { status: "saved", query: match.title, error: undefined });
  }
  async function run(targets: Job[], confirm = false) {
    if (active.current || blocked) return;
    active.current = true; stop.current = false; setBusy(true); setNotice("");
    // Fetch at most two searches ahead; commits remain ordered to avoid revision conflicts.
    const searchJob = async (job: Job) => {
      try { return { result: await call({ action: "search", query: job.query, year: job.year, type: job.type }), error: undefined }; }
      catch (error) { return { result: undefined, error }; }
    };
    const searches = new Map<number, ReturnType<typeof searchJob>>();
    const prepare = (index: number) => {
      if (!confirm && !stop.current && targets[index]) searches.set(index, searchJob(targets[index]));
    };
    try {
      prepare(0); prepare(1);
      for (let index = 0; index < targets.length; index++) {
        const job = targets[index];
        if (stop.current) break;
        patch(job.key, { status: "searching", error: undefined });
        try {
          if (confirm) { const candidate = job.candidates.find(c => c.id === job.chosen); if (candidate) await save(job, candidate); else patch(job.key, { status: "review" }); }
          else {
            const searched = await searches.get(index)!;
            searches.delete(index);
            prepare(index + 2);
            if (!searched.result) throw searched.error;
            const r = searched.result;
            if (stop.current) { patch(job.key, { status: "pending" }); break; }
            const candidates = r.results || [], match = confidentFilmMatch(job, candidates);
            patch(job.key, { candidates, chosen: undefined });
            if (match) await save(job, match);
            else patch(job.key, { status: candidates.length ? "review" : "missing", error: candidates.length ? t("media.chooseCandidate") : t("media.noResults") });
          }
        } catch (e) { patch(job.key, { status: "error", error: e instanceof Error ? e.message : t("media.matchFailed") }); }
      }
    } finally {
      await Promise.all(searches.values());
      try { await refresh(); } catch { setNotice("media.refreshFailed"); }
      if (stop.current) setNotice("media.stopped");
      active.current = false; setBusy(false);
    }
  }
  const pending = jobs.filter(j => selected.has(j.key) && (j.status === "pending" || j.status === "error"));
  const reviews = jobs.filter(j => selected.has(j.key) && j.status === "review" && j.chosen);
  const processed = jobs.filter(j => ["saved", "review", "missing", "error"].includes(j.status)).length;
  const labels = { pending: t("media.pending"), searching: t("media.working"), review: t("media.review"), saved: t("media.saved"), missing: t("media.missing"), error: "media.failed" };
  if(background)return <MatchTaskDock title={t("media.batchTitle")} busy={busy} done={processed} total={jobs.length} blocked={blocked} onOpen={onForeground} onStop={()=>{stop.current=true;setNotice("media.stopping");}} onClose={onClose}/>;
  if(settingsOpen)return <LibraryApiSettings configured={configured} onChanged={setConfigured}
    onClose={()=>{resumeAfterSettings.current=false;setSettingsOpen(false);}}
    onSaved={()=>{setSettingsOpen(false);if(resumeAfterSettings.current){resumeAfterSettings.current=false;if(pending.length)void run(pending);}}}/>;
  return createPortal(<div className="library-artwork-backdrop" onKeyDown={e => { if (e.key === "Escape" && !busy) onClose(); if (e.key === "Tab") { const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),summary")]; const first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }}>
    <section className="library-artwork-dialog batch-match-dialog" role="dialog" aria-modal="true" aria-label={t("media.batchTitle")}><header><b><Layers /> {t("media.batchTitle")}</b><span className="match-dialog-actions"><button autoFocus disabled={busy} aria-label={t("media.batchClose")} onClick={onClose}><X /></button>{onBackground&&<button className="match-background-button" onClick={onBackground}>{t("match.background")}</button>}</span></header>
    <fieldset disabled={busy} className="match-service-control">{serviceControl}</fieldset>
    <p className="batch-scope" title={scope}>{t("media.batchScope", {scope, count: tracks.length, skipped: initialSkipped})}</p>
    {!configured && <p>{t("media.apiFirst")}</p>}
    <p>{t("media.batchHint")}</p>
    <div className="batch-actions"><label><input type="checkbox" disabled={busy} checked={jobs.length > 0 && selected.size === jobs.length} onChange={e => setSelected(new Set(e.target.checked ? jobs.map(j => j.key) : []))} />{t("media.selectAll")}</label><label><input type="checkbox" disabled={busy} checked={posters} onChange={e => setPosters(e.target.checked)} />{t("media.fillCovers")}</label>
      <button disabled={busy || (configured && !pending.length)} onClick={() => { if (!configured) { resumeAfterSettings.current=true;setSettingsOpen(true); } else void run(pending); }}><Search />{t("media.batchStart", {count: pending.length})}</button>
      {busy && <button onClick={() => { stop.current = true; setNotice("media.stopping"); }}><Pause />{t("media.stop")}</button>}
      <button disabled={busy || !configured || !reviews.length} onClick={() => void run(reviews, true)}><Check />{t("media.batchConfirm", {count: reviews.length})}</button><button className="batch-api-settings" disabled={busy} onClick={()=>{resumeAfterSettings.current=false;setSettingsOpen(true);}}><KeyRound />{t("media.apiSettings")}</button></div>
    <progress max={jobs.length || 1} value={processed} /><div role="status" aria-live="polite">{t("media.batchProgress", {done: processed, total: jobs.length, saved: jobs.filter(j => j.status === "saved").length, review: jobs.filter(j => j.status === "review").length, missing: jobs.filter(j => j.status === "missing").length, failed: jobs.filter(j => j.status === "error").length})} {tm(notice)}</div>
    <label className="batch-saved-toggle"><input type="checkbox" checked={showSaved} onChange={e => setShowSaved(e.target.checked)} />{t("media.showSaved")}</label>
    <div className="batch-jobs">{jobs.filter(job => showSaved || job.status !== "saved").sort((a,b) => (a.status === "review" ? -1 : 0) - (b.status === "review" ? -1 : 0)).map(job => <article key={job.key} className={`batch-job ${job.status}`}><div className="batch-job-title"><input aria-label={t("media.selectJob", {title: job.query})} type="checkbox" checked={selected.has(job.key)} disabled={busy || job.status === "saved"} onChange={e => setSelected(s => { const next = new Set(s); if (e.target.checked) next.add(job.key); else next.delete(job.key); return next; })} /><strong title={job.query}>{job.query}</strong><small>{t("media.jobFiles", {count: job.ids.length, status: labels[job.status]})}</small></div>
      {job.status !== "saved" && <><div className="film-search-row"><input aria-label={t("media.batchQuery")} disabled={busy} value={job.query} onChange={e => patch(job.key, { query: e.target.value, candidates: [], chosen: undefined })} /><input className="film-year" aria-label={t("media.batchYear")} maxLength={4} disabled={busy} value={job.year} onChange={e => patch(job.key, { year: e.target.value, candidates: [], chosen: undefined })} placeholder={t("media.year")} /><select aria-label={t("media.batchType")} disabled={busy} value={job.type} onChange={e => patch(job.key, { type: e.target.value as "movie" | "tv", candidates: [], chosen: undefined })}><option value="movie">{t("media.movie")}</option><option value="tv">{t("media.series")}</option></select><button disabled={busy || !configured || !job.query.trim()} title={t("media.retryGroup")} onClick={() => void run([job])}><RotateCcw /></button></div>
      {job.candidates.length > 1 && <div className="batch-candidates" role="radiogroup" aria-label={t("media.candidates", {title: job.query})}>{job.candidates.map(c => <label key={c.id} className={job.chosen === c.id ? "chosen" : ""}><input type="radio" name={`match-${job.key}`} disabled={busy} checked={job.chosen === c.id} onChange={() => { patch(job.key, { chosen: c.id, status: "review", error: undefined }); setSelected(s => new Set([...s, job.key])); }} /><span className="batch-candidate-poster"><Film />{c.posterPath && <img src={`https://image.tmdb.org/t/p/w500${c.posterPath}`} alt={c.title} loading="lazy" onError={e => { e.currentTarget.style.visibility = "hidden"; }} />}</span><span className="batch-candidate-info"><strong>{c.title} · {c.year || t("media.unknownYear")}</strong><small>{c.originalTitle}</small><p>{c.overview || t("media.noOverview")}</p></span></label>)}</div>}
      {job.error && <p>{tm(job.error)}</p>}</>}
    </article>)}</div>{jobs.length > 0 && jobs.every(j => j.status === "saved") && <p>{t("media.allMatched")}</p>}{!jobs.length && <p>{t("media.emptyScope")}</p>}
    <details className="film-credits"><summary>{t("media.credits")}</summary><img className="tmdb-logo" src={tmdbLogo} alt="TMDB" /><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p></details></section>
  </div>, document.querySelector(".app-shell") || document.body);
}

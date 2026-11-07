import { MatchTaskDock, type MatchPresentation } from "./MatchTaskDock";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Music2, KeyRound, X, Search } from "lucide-react";
import { LibraryApiSettings } from "./LibraryApiSettings";
import { useI18n } from "../i18n";
import { usePlayerStore } from "../stores/playerStore";
import { groupMusicCovers, confidentMusicCover } from "../utils/musicCoverMatch";
import type { Track } from "../types/audio";
import type { MusicCoverCandidate } from "../../electron/library/media/MusicBrainzClient";
type Job=ReturnType<typeof groupMusicCovers>[number] & {status:"pending"|"working"|"review"|"saved"|"missing"|"noCover"|"failed";candidates:MusicCoverCandidate[];chosen?:string;error?:string};
export function LibraryMusicMatch({tracks,onClose,serviceControl,background,blocked,onBackground,onForeground}:{tracks:Track[];onClose():void;serviceControl?:ReactNode} & MatchPresentation) {
  const {t,tm}=useI18n();
  const [jobs,setJobs]=useState<Job[]>(()=>groupMusicCovers(tracks).map(group=>({...group,status:"pending",candidates:[]})));
  const [busy,setBusy]=useState(false),[settings,setSettings]=useState(false),[configured,setConfigured]=useState(false),[notice,setNotice]=useState("");
  const [progress,setProgress]=useState({done:0,total:jobs.length,current:"",phase:"music.searching"});
  const stop=useRef(false),running=useRef(false);
  useEffect(()=>{let alive=true;void window.desktop?.library.tmdb({action:"status"}).then(r=>{if(alive)setConfigured(!!r.configured);}).catch(()=>{if(alive)setNotice("media.apiReadError");});return()=>{alive=false;stop.current=true;};},[]);
  useEffect(()=>{if(blocked)stop.current=true;},[blocked]);
  const patch=(key:string,value:Partial<Job>)=>setJobs(all=>all.map(job=>job.key===key?{...job,...value}:job));
  async function call(request:Record<string,unknown>){const r=await window.desktop?.library.musicbrainz(request);if(!r?.ok)throw Error(r?.error||"media.serviceUnavailable");return r;}
  async function run(targets:Job[],confirm=false){
    if(running.current||blocked)return;running.current=true;stop.current=false;setBusy(true);setNotice("");
    setProgress({done:0,total:targets.length,current:"",phase:"music.searching"});
    // Fetch only one album ahead. The main-process rate limiter still spaces searches;
    // cover downloads and commits remain serial to avoid library revision conflicts.
    const searches=new Map<number,Promise<{results:MusicCoverCandidate[];error?:string}>>();
    const prepare=(index:number)=>{
      if(confirm||stop.current||!targets[index]||searches.has(index))return;
      const job=targets[index];
      searches.set(index,call({action:"search",album:job.album,artist:job.artist,title:job.title})
        .then(r=>({results:r.results||[]})).catch(error=>({results:[],error:error instanceof Error?error.message:"music.requestFailed"})));
    };
    try {
      prepare(0);
      for(let index=0;index<targets.length;index++){
        const job=targets[index];
        if(stop.current)break;patch(job.key,{status:"working",error:undefined});
        setProgress(value=>({...value,current:job.album||job.title,phase:confirm?"music.saving":"music.searching"}));
        prepare(index+1);
        let completed=true;
        try {
          let candidate=confirm?job.candidates.find(c=>c.id===job.chosen):undefined;
          if(!confirm){
            const fetched=await searches.get(index)!;searches.delete(index);
            if(stop.current){completed=false;patch(job.key,{status:"pending"});break;}
            if(fetched.error)throw Error(fetched.error);
            const results=fetched.results;
            candidate=confidentMusicCover(job.album,job.artist,results);
            patch(job.key,{candidates:results,chosen:undefined});
            if(!candidate){patch(job.key,{status:results.length?"review":"missing"});continue;}
          }
          if(!candidate){patch(job.key,{status:"review"});continue;}
          patch(job.key,{chosen:candidate.id});
          setProgress(value=>({...value,phase:"music.saving"}));
          await call({action:"apply",trackIds:job.ids,kind:candidate.kind,id:candidate.id});
          patch(job.key,{status:"saved"});
        }catch(error){const message=error instanceof Error?error.message:"music.requestFailed";patch(job.key,{status:message==="music.noCover"?"noCover":"failed",error:message});}
        finally{if(completed)setProgress(value=>({...value,done:value.done+1}));}
      }
    }finally{
      setProgress(value=>({...value,phase:stop.current?"media.stopping":"music.refreshing"}));
      await Promise.all(searches.values());
      try {
        await usePlayerStore.getState().hydrateLibrary();
        const byId=new Map(usePlayerStore.getState().libraryTracks.map(track=>[track.id,track]));
        const update=(track:Track)=>{const item=byId.get(track.id);return item?{...track,coverUrl:item.coverUrl,coverLocked:item.coverLocked}:track;};
        usePlayerStore.setState(state=>({tracks:state.tracks.map(update),inactiveTracks:state.inactiveTracks.map(update)}));
      }catch{setNotice("media.refreshFailed");}
      if(stop.current)setNotice("media.stopped");running.current=false;setBusy(false);
    }
  }
  if(background)return <MatchTaskDock title={t("music.title")} busy={busy} done={progress.done} total={progress.total} blocked={blocked} onOpen={onForeground} onStop={()=>{stop.current=true;setNotice("media.stopping");}} onClose={onClose}/>;
  if(settings)return <LibraryApiSettings initialService="musicbrainz" configured={configured} onChanged={setConfigured} onClose={()=>setSettings(false)} onSaved={()=>setSettings(false)}/>;
  const pending=jobs.filter(job=>["pending","failed","missing","noCover"].includes(job.status));
  const reviews=jobs.filter(job=>job.status==="review"&&job.chosen);
  return createPortal(<div className="library-artwork-backdrop" onKeyDown={e=>{
    e.stopPropagation();if(e.key==="Escape"&&!busy)onClose();
    if(e.key==="Tab"){const items=[...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled)")],first=items[0],last=items.at(-1);if(!first)e.preventDefault();else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  }}><section className="library-artwork-dialog batch-match-dialog music-match-dialog" role="dialog" aria-modal="true" aria-label={t("music.title")}>
    <header><b><Music2/>{t("music.title")}</b><span className="match-dialog-actions"><button autoFocus disabled={busy} aria-label={t("media.close")} onClick={onClose}><X/></button>{onBackground&&<button className="match-background-button" onClick={onBackground}>{t("match.background")}</button>}</span></header>
    <fieldset disabled={busy} className="match-service-control">{serviceControl}</fieldset>
    <p>{t("music.hint")}</p>
    <div className="batch-actions"><button disabled={busy||!pending.length} onClick={()=>void run(pending)}><Search/>{t("media.batchStart",{count:pending.length})}</button>
      <button disabled={busy||!reviews.length} onClick={()=>void run(reviews,true)}>{t("media.batchConfirm",{count:reviews.length})}</button>
      {busy&&<button onClick={()=>{stop.current=true;setNotice("media.stopping");}}>{t("media.stop")}</button>}
      <button disabled={busy} className="batch-api-settings" onClick={()=>setSettings(true)}><KeyRound/>{t("media.apiSettings")}</button></div>
    <div className="music-match-progress" aria-busy={busy}>
      <progress aria-label={t("music.matchProgress")} max={progress.total||1} value={progress.done}/>
      <p role="status" aria-live="polite">{t("music.processed",{done:progress.done,total:progress.total})}
        {busy&&<span className="music-match-phase"><Search aria-hidden="true"/>{t(progress.phase)}{progress.current&&` · ${progress.current}`}</span>}
      </p>
    </div>
    <p role="status">{t("music.progress",{saved:jobs.filter(j=>j.status==="saved").length,total:jobs.length})} {tm(notice)}</p>
    {!jobs.length&&<p>{t("music.empty")}</p>}
    <div className="batch-jobs">{jobs.map(job=><article className={`batch-job ${job.status}`} key={job.key}>
      <div className="batch-job-title"><strong>{job.album||job.title}</strong><small>{t("media.jobFiles",{count:job.ids.length,status:t(job.status==="noCover"?"music.noCover":"media."+job.status)})}</small></div>
      {job.status!=="saved"&&<><div className="film-search-row">
        <input disabled={busy} aria-label={t("music.album")} placeholder={t("music.album")} value={job.album} onChange={e=>patch(job.key,{album:e.target.value,status:"pending",chosen:undefined,candidates:[],error:undefined})}/>
        <input disabled={busy} aria-label={t("music.artist")} placeholder={t("music.artist")} value={job.artist} onChange={e=>patch(job.key,{artist:e.target.value,status:"pending",chosen:undefined,candidates:[],error:undefined})}/>
        {!job.album&&<input disabled={busy} aria-label={t("music.song")} value={job.title} onChange={e=>patch(job.key,{title:e.target.value,status:"pending",chosen:undefined,candidates:[],error:undefined})}/>}
      </div>
      {job.status==="noCover"&&job.chosen&&<p className="music-matched-candidate">{job.candidates.filter(c=>c.id===job.chosen).map(c=>`${c.title} · ${c.artist} · ${c.year}`).join("")}</p>}
      {job.status!=="noCover"&&job.candidates.length>0&&<select disabled={busy} aria-label={t("music.candidate")} value={job.chosen||""} onChange={e=>patch(job.key,{chosen:e.target.value,status:"review"})}>
        <option value="">{t("media.chooseCandidate")}</option>{job.candidates.map(c=><option key={c.id} value={c.id}>{c.title} · {c.artist} · {c.year}</option>)}</select>}
      {job.error&&<p role="alert">{tm(job.error)}</p>}</>}
    </article>)}</div><p>MusicBrainz · Cover Art Archive</p>
  </section></div>,document.querySelector(".app-shell")||document.body);
}

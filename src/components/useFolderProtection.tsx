import { useI18n } from "../i18n";
import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, LockKeyhole, X, Trash2, FolderOpen, ImagePlus } from "lucide-react";
import { applyVisibility, isFolderLocked, loadFolderVisibility, useFolderVisibility } from "../stores/folderVisibilityStore";
import { withinFolder } from "../utils/folderVisibility";
import { usePlayerStore } from "../stores/playerStore";
import { audioEngine } from "../audio/AudioEngine";
import type { Track } from "../types/audio";
import "./FolderProtection.css";
async function removeLockedQueueItems() {
  let s = usePlayerStore.getState(), current = s.tracks[s.currentIndex];
  s.cancelPendingPlay();
  if (current && isFolderLocked(current.sourcePath)) {
    audioEngine.stop(); s.setPlaying(false);
    await window.desktop?.video.control("close");
    await window.desktop?.nativeAudio.command({type:"pause"});
  }
  // Output shutdown is asynchronous; preserve queue edits made while it completes.
  s = usePlayerStore.getState(); current = s.tracks[s.currentIndex];
  const tracks = s.tracks.filter(t => !isFolderLocked(t.sourcePath));
  const ids = new Set([...s.tracks,...s.inactiveTracks].filter(t => isFolderLocked(t.sourcePath)).map(t => t.id));
  usePlayerStore.setState({tracks,inactiveTracks:s.inactiveTracks.filter(t => !isFolderLocked(t.sourcePath)),
    currentIndex:current ? tracks.findIndex(t => t.id===current.id) : -1,
    queueBookmarks:Object.fromEntries(Object.entries(s.queueBookmarks).filter(([id])=>!ids.has(id))),
    queueSelection:Object.fromEntries(Object.entries(s.queueSelection).filter(([,id])=>!ids.has(id))),
    ...(current && isFolderLocked(current.sourcePath) ? {playing:false,currentTime:0,duration:0,localPlayRequest:s.localPlayRequest+1} : {})});
}
export function useFolderProtection(onArtwork?: (id: string) => void) {
  const { t, tm } = useI18n();
  const state=useFolderVisibility();
  const [menu,setMenu]=useState<{x:number;y:number;folder?:string;track?:Track}|null>(null);
  const [form,setForm]=useState<{action:"hide"|"hide-file"|"unlock"|"change";folder?:string;id?:string}|null>(null);
  const [password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[next,setNext]=useState("");
  const [removing,setRemoving]=useState<Track|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{void loadFolderVisibility().catch(e=>setError(String(e)));},[]);
  useEffect(()=>{const close=()=>setMenu(null);const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){close();if(!busy){setForm(null);setRemoving(null);}}};window.addEventListener("click",close);window.addEventListener("resize",close);window.addEventListener("keydown",key);return()=>{window.removeEventListener("click",close);window.removeEventListener("resize",close);window.removeEventListener("keydown",key);};},[busy]);
  const request=async(action:string,payload:Record<string,unknown>={})=>{
    const result=await window.desktop!.library.visibility({action,...payload});
    if(!result.ok)throw Error(result.error);
    applyVisibility(result);
    if(action==="hide"||action==="hide-file"||action==="lock")await removeLockedQueueItems();
  };
  const run=async(action:string,folder?:string)=>{setBusy(true);setError("");setMenu(null);try{await request(action,{folder});}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  function open(action:"hide"|"hide-file"|"unlock"|"change",folder?:string,id?:string){setMenu(null);setError("");setPassword("");setConfirm("");setNext("");setForm({action,folder,id});}
  function context(e:MouseEvent,folder?:string,track?:Track){e.preventDefault();e.stopPropagation();setMenu({folder:track?.sourcePath || folder,track,x:Math.max(8,Math.min(e.clientX,window.innerWidth-240)),y:Math.max(8,Math.min(e.clientY,window.innerHeight-310))});}
  const owner=menu?.folder?state.roots.find(root=>withinFolder(menu.folder!,root)):undefined;
  const overlays=createPortal(<>
    {menu&&<div className="folder-protection-menu" role="menu" style={{left:menu.x,top:menu.y}}>
      {menu.folder&&!menu.track&&!owner&&<button disabled={busy} role="menuitem" onClick={()=>open("hide",menu.folder)}><EyeOff/>{t("media.hideProtect")}</button>}
      {menu.track&&<>
        <button role="menuitem" disabled={busy} onClick={()=>{onArtwork?.(menu.track!.id);setMenu(null);}}><ImagePlus/>{t("media.artwork")}</button>
        <button role="menuitem" disabled={busy} onClick={()=>{const id=menu.track!.id;setMenu(null);void window.desktop!.library.fileAction(id,"reveal").then(r=>{if(!r.ok)setError(r.error||t("media.revealFailed"));}).catch(e=>setError(String(e)));}}><FolderOpen/>{t("media.reveal")}</button>
        {!owner&&<button role="menuitem" disabled={busy} onClick={()=>open("hide-file",undefined,menu.track!.id)}><EyeOff/>{t("media.hideFileProtect")}</button>}
        <button role="menuitem" disabled={busy} onClick={()=>{setRemoving(menu.track!);setMenu(null);setError("");}}><Trash2/>{t("media.remove")}</button>
      </>}
      {owner&&state.unlocked&&<button disabled={busy} role="menuitem" onClick={()=>void run("unhide",owner)}><Eye/>{t("media.unhide")}{owner!==menu.folder?t("media.parentFolder"):""}</button>}
      {state.roots.length>0&&<button disabled={busy} role="menuitem" onClick={()=>state.unlocked?void run("lock"):open("unlock")}><LockKeyhole/>{state.unlocked?t("media.relock"):t("media.unlock")}</button>}
      {state.configured&&state.unlocked&&<button disabled={busy} role="menuitem" onClick={()=>open("change")}><LockKeyhole/>{t("media.changePassword")}</button>}
      {!menu.folder&&!state.roots.length&&<span>{t("media.noHidden")}</span>}
    </div>}
    {removing&&<div className="folder-protection-overlay"><form className="folder-protection-dialog" onSubmit={async e=>{
      e.preventDefault();setBusy(true);setError("");try{
        const result=await window.desktop!.library.fileAction(removing.id,"remove");if(!result.ok)throw Error(result.error);
        await usePlayerStore.getState().hydrateLibrary();setRemoving(null);
      }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
    }}><header><Trash2/><h3>{t("media.remove")}</h3><button type="button" disabled={busy} onClick={()=>setRemoving(null)}><X/></button></header>
    <p>{removing.name}</p><p>{t("media.removeHint")}</p>
    {error&&<p role="alert">{tm(error)}</p>}<button type="submit" disabled={busy}>{busy?t("media.working"):t("media.confirmRemove")}</button></form></div>}
    {form&&<div className="folder-protection-overlay"><form className="folder-protection-dialog" onSubmit={async e=>{
      e.preventDefault();setBusy(true);setError("");try{
        if((!state.configured&&password!==confirm)||(form.action==="change"&&next!==confirm))throw Error(t("media.passwordMismatch"));
        await request(form.action,{folder:form.folder,id:form.id,password,nextPassword:next});setForm(null);setPassword("");setConfirm("");setNext("");
      }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
    }}><header><LockKeyhole/><h3>{form.action==="hide-file"?t("media.hideFile"):form.action==="hide"?t("media.hideFolder"):form.action==="change"?t("media.changePassword"):t("media.unlock")}</h3><button type="button" aria-label={t("media.close")} disabled={busy} onClick={()=>setForm(null)}><X/></button></header>
      <p>{form.action==="hide-file"?t("media.hideFileHint"):form.action==="hide"?t("media.hideFolderHint"):t("media.unlockHint")}</p>
      <label>{t("media.password")}<input autoFocus type="password" minLength={4} maxLength={128} required autoComplete={state.configured?"current-password":"new-password"} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {form.action==="change"&&<label>{t("media.newPassword")}<input type="password" minLength={4} maxLength={128} required autoComplete="new-password" value={next} onChange={e=>setNext(e.target.value)}/></label>}
      {(!state.configured||form.action==="change")&&<label>{t("media.confirmPassword")}<input type="password" minLength={4} maxLength={128} required autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}
      {error&&<p role="alert">{tm(error)}</p>}<button type="submit" disabled={busy}>{busy?t("media.working"):t("media.confirm")}</button>
    </form></div>}
  </>,document.querySelector(".app-shell") || document.body);
  return {state,context,overlays,error:form||removing?"":tm(error)};
}

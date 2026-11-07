import { create } from "zustand";
import { hiddenByFolders } from "../utils/folderVisibility";
export const useFolderVisibility = create<{ready:boolean;configured:boolean;unlocked:boolean;roots:string[];broken:boolean}>(() => ({ready:false,configured:false,unlocked:false,roots:[],broken:false}));
let loading: Promise<void> | undefined;
export function loadFolderVisibility() { return loading ||= (async () => {
  if (!window.desktop) { useFolderVisibility.setState({ready:true}); return; }
  const result = await window.desktop.library.visibility({action:"status"});
  if (!result.ok) throw Error(result.error);
  applyVisibility(result);
})().catch(error => { loading = undefined; throw error; }); }
export function applyVisibility(result: {configured?:boolean;unlocked?:boolean;roots?:string[];broken?:boolean}) { useFolderVisibility.setState({ready:true,configured:!!result.configured,unlocked:!!result.unlocked,roots:result.roots || [],broken:!!result.broken}); }
export function isFolderLocked(file?: string) { if (!file) return false; const state=useFolderVisibility.getState(); return !state.ready || state.broken || !state.unlocked && hiddenByFolders(file,state.roots); }

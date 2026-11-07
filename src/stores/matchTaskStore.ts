import { create } from "zustand";
import type { Track } from "../types/audio";
export type MatchTask = { id:number; kind:"batch"|"artwork"; tracks:Track[]; scope:string; initialMusic?:boolean };
let sequence=0;
export const useMatchTask = create<{
  task:MatchTask|null; background:boolean;
  open(task:Omit<MatchTask,"id">):void; hide():void; show():void; close():void;
}>(set=>({
  task:null,background:false,
  // One task owns writes at a time. Opening another entry reveals the existing task.
  open:task=>set(state=>state.task?{background:false}:{task:{...task,tracks:[...task.tracks],id:++sequence},background:false}),
  hide:()=>set({background:true}),show:()=>set({background:false}),close:()=>set({task:null,background:false})
}));

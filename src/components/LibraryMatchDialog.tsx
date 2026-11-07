import type { MatchPresentation } from "./MatchTaskDock";
import { useState } from "react";
import { LibraryBatchMatch } from "./LibraryBatchMatch";
import { LibraryMusicMatch } from "./LibraryMusicMatch";
import { useI18n } from "../i18n";
import { isVideoTrack } from "../utils/videoTrack";
import type { Track } from "../types/audio";
export function LibraryMatchDialog({tracks,scope,onClose,initialMusic=false,...presentation}:{tracks:Track[];scope:string;onClose():void;initialMusic?:boolean} & MatchPresentation) {
  const {t}=useI18n();const [music,setMusic]=useState(initialMusic);
  const serviceControl=<label>{t("music.service")} <select aria-label={t("music.service")} value={music?"musicbrainz":"tmdb"} onChange={e=>setMusic(e.target.value==="musicbrainz")}><option value="tmdb">{t("music.tmdb")}</option><option value="musicbrainz">{t("music.musicbrainz")}</option></select></label>;
  return music ? <LibraryMusicMatch tracks={tracks.filter(track=>!isVideoTrack(track))} onClose={onClose} serviceControl={serviceControl} {...presentation}/> : <LibraryBatchMatch tracks={tracks.filter(isVideoTrack)} scope={scope} onClose={onClose} serviceControl={serviceControl} {...presentation}/>;
}

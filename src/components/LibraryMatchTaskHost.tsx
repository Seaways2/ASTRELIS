import { usePlayerStore } from "../stores/playerStore";
import { useEffect } from "react";
import { useMatchTask } from "../stores/matchTaskStore";
import { useFolderVisibility, loadFolderVisibility } from "../stores/folderVisibilityStore";
import { hiddenByFolders } from "../utils/folderVisibility";
import { LibraryMatchDialog } from "./LibraryMatchDialog";
import { LibraryArtworkDialog } from "./LibraryArtworkDialog";
/** App-level lifetime: navigating away from the library never unmounts active work. */
export function LibraryMatchTaskHost() {
  const {task,background,hide,show,close}=useMatchTask();
  const privacy=useFolderVisibility();
  const artwork=usePlayerStore(state=>task?.kind==="artwork"?state.libraryTracks.find(track=>track.id===task.tracks[0]?.id):undefined);
  useEffect(()=>{void loadFolderVisibility().catch(()=>{/* Unknown privacy state stays blocked. */});},[]);
  if(!task)return null;
  const blocked=!privacy.ready||privacy.broken||!privacy.unlocked&&task.tracks.some(track=>hiddenByFolders(track.sourcePath,privacy.roots));
  const presentation={background:background||blocked,blocked,onBackground:hide,onForeground:show};
  return task.kind==="artwork" ? <LibraryArtworkDialog key={task.id} track={artwork||task.tracks[0]} onClose={close} {...presentation}/> : <LibraryMatchDialog key={task.id} tracks={task.tracks} scope={task.scope} initialMusic={task.initialMusic} onClose={close} {...presentation}/>;
}

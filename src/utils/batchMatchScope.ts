import { hiddenByFolders, withinFolder } from "./folderVisibility";
import type { Track } from "../types/audio";

// Batch matching works on the place the user is looking at, never on other
// folders of the library: the open folder (subfolders included), or at the top
// level the folder cover flow has centred. Only the top level with nothing
// focused covers the whole library.
export function batchMatchFolder(openFolder: string, focusedFolder?: string) {
  return openFolder || focusedFolder || "";
}

export function batchMatchTracks(input: {
  tracks: readonly Track[];
  hiddenFolders: readonly string[];
  folder: string;
  // The visible list (search hits or a category) when it is narrower than the folder.
  listIds?: ReadonlySet<string> | null;
}) {
  return input.tracks.filter(track => {
    const file = track.sourcePath || "";
    if (hiddenByFolders(file, input.hiddenFolders)) return false;
    if (input.folder && !withinFolder(file, input.folder)) return false;
    return !input.listIds || input.listIds.has(track.id);
  });
}

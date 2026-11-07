import path from "node:path";
import type { LegacyLibraryPayload, LegacyTrackRecord } from "./types";

const canonical = (value: string) => path.win32.resolve(value).toLowerCase().replace(/[\\/]+$/, "");
const inside = (file: string, root: string) => {
  const source = canonical(file), directory = canonical(root);
  return source === directory || source.startsWith(directory + "\\");
};

/** Remove library membership only; never change files or the playback queue. */
export function removeLibraryFolder(payload: LegacyLibraryPayload, folder: string): LegacyLibraryPayload {
  if (!payload.folders.some(root => canonical(root) === canonical(folder))) throw new Error("Library folder is not registered");
  const folders = payload.folders.filter(root => canonical(root) !== canonical(folder));
  const tracks = payload.tracks.filter(track => {
    const item = track as LegacyTrackRecord;
    const source = item.sourcePath || item.location?.sourcePath || item.nativePath;
    return !source || !inside(source, folder) || folders.some(root => inside(source, root));
  });
  return { tracks, folders };
}

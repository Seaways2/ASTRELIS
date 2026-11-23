import { libraryPathKey, libraryPathWithin, libraryRootCovers } from "./libraryPaths";
import type { LegacyLibraryPayload, LegacyTrackRecord } from "./types";

/** The deepest registered root holding `sourceKey`, as its key. */
function owningRootKey(sourceKey: string, rootKeys: string[]) {
  return rootKeys.filter(key => libraryPathWithin(sourceKey, key)).sort((left, right) => right.length - left.length)[0];
}

/**
 * Remove library membership only; never change files or the playback queue.
 * A track goes when the removed folder is the deepest root holding it, as in
 * the domain and the reconciler. It stays only when another root still covers
 * it: a deeper root of its own, or a parent root whose scan enters the removed
 * folder (a plain subfolder). A nested junction or symbolic link is not
 * entered by its parent's scan, so its tracks go with it; otherwise they would
 * stay unplayable and keep the parent partial with no way to remove them.
 */
export function removeLibraryFolder(payload: LegacyLibraryPayload, folder: string): LegacyLibraryPayload {
  const removedKey = libraryPathKey(folder);
  if (!payload.folders.some(root => libraryPathKey(root) === removedKey)) throw new Error("Library folder is not registered");
  const folders = payload.folders.filter(root => libraryPathKey(root) !== removedKey);
  const rootKeys = [...new Set([...folders.map(libraryPathKey), removedKey])];
  const coveredByParent = folders.some(root => libraryPathWithin(removedKey, libraryPathKey(root)) && libraryRootCovers(root, folder));
  const tracks = payload.tracks.filter(track => {
    const item = track as LegacyTrackRecord;
    const source = item.sourcePath || item.location?.sourcePath || item.nativePath;
    if (!source) return true;
    return owningRootKey(libraryPathKey(source), rootKeys) !== removedKey || coveredByParent;
  });
  return { tracks, folders };
}

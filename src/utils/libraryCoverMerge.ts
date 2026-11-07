import type { Track } from "../types/audio";

export type ScannedTrack = Track & { metadataRead?: boolean };

const normalizedPath = (value?: string) => value?.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase() || "";
const normalizedSourcePath = (track: Pick<Track, "sourcePath">) => normalizedPath(track.sourcePath);

export function sanitizeLibraryFolders(folders: string[]) {
  const unique = new Map<string, string>();
  for (const folder of folders) {
    const key = normalizedPath(folder);
    if (key && !unique.has(key)) unique.set(key, folder.trim().replace(/\//g, "\\").replace(/\\+$/, ""));
  }
  const sorted = Array.from(unique.entries()).sort(([left], [right]) => left.length - right.length);
  const accepted: Array<[string, string]> = [];
  for (const candidate of sorted) {
    if (accepted.some(([parent]) => candidate[0] === parent || candidate[0].startsWith(`${parent}\\`))) continue;
    accepted.push(candidate);
  }
  return accepted.map(([, original]) => original);
}

const previousTrackFor = (track: Track, previousById: Map<string, Track>, previousByPath: Map<string, Track>) =>
  previousById.get(track.id) || previousByPath.get(normalizedSourcePath(track));

/**
 * A metadata rescan is allowed to refresh artwork, but a temporary tag read
 * failure must never erase artwork that was already known for the same file.
 */
export function preserveScannedArtwork(scanned: Track[], previous: Track[]) {
  const previousById = new Map(previous.map(track => [track.id, track]));
  const previousByPath = new Map(
    previous
      .map(track => [normalizedSourcePath(track), track] as const)
      .filter(([sourcePath]) => sourcePath)
  );

  return scanned.map(track => {
    if (track.coverUrl) return track;
    const previousTrack = previousTrackFor(track, previousById, previousByPath);
    return previousTrack?.coverUrl ? { ...track, coverUrl: previousTrack.coverUrl } : track;
  });
}

/**
 * Merge a complete scan without allowing failed metadata reads, overlapping
 * roots, or duplicate file paths to corrupt the library classification input.
 */
export function mergeScannedLibrary(scanned: ScannedTrack[], previous: Track[]) {
  const previousById = new Map(previous.map(track => [track.id, track]));
  const previousByPath = new Map(
    previous.map(track => [normalizedSourcePath(track), track] as const).filter(([sourcePath]) => sourcePath)
  );
  const unique = new Map<string, Track>();

  for (const scannedTrack of scanned) {
    const { metadataRead, ...cleanTrack } = scannedTrack;
    const oldTrack = previousTrackFor(cleanTrack, previousById, previousByPath);
    let merged: Track = cleanTrack;
    if (metadataRead === false && oldTrack) {
      merged = {
        ...cleanTrack,
        name: oldTrack.name,
        artist: oldTrack.artist,
        album: oldTrack.album,
        genre: oldTrack.genre,
        year: oldTrack.year,
        duration: oldTrack.duration,
        coverUrl: oldTrack.coverUrl || cleanTrack.coverUrl
      };
    } else if (!cleanTrack.coverUrl && oldTrack?.coverUrl) {
      merged = { ...cleanTrack, coverUrl: oldTrack.coverUrl };
    }
    const identity = normalizedSourcePath(merged) || `id:${merged.id}`;
    if (!unique.has(identity)) unique.set(identity, merged);
  }
  return Array.from(unique.values());
}

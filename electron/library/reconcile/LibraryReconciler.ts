import fs from "node:fs";
import { mediaInstanceId } from "../domain/LibraryDomain";
import { libraryPathKey, libraryPathWithin, libraryRootPath } from "../libraryPaths";
import type {
  LegacyLibraryPayload,
  LegacyTrackRecord,
  LibraryReconcileResult,
  LibraryScanResult,
  RootScanResult,
  ScannedTrack
} from "../types";

function normalizedPath(value?: string) {
  if (!value) return "";
  return libraryPathKey(value);
}

// A nested root that is a junction or symbolic link points somewhere else:
// its parent's scan never enters it, so it must stay a root of its own.
function isLinkedDirectory(root: string) {
  try { return fs.lstatSync(root).isSymbolicLink(); }
  catch { return false; }
}

function isLegacyTrack(value: unknown): value is LegacyTrackRecord {
  return Boolean(value) && typeof value === "object"
    && typeof (value as LegacyTrackRecord).id === "string"
    && typeof (value as LegacyTrackRecord).name === "string";
}

function sourceKey(track: Pick<LegacyTrackRecord, "id" | "sourcePath">) {
  return normalizedPath(track.sourcePath || (track as LegacyTrackRecord).location?.sourcePath) || "id:" + track.id;
}

function fingerprintKey(track: LegacyTrackRecord) {
  return typeof track.file?.fingerprint === "string" && track.file.fingerprint ? track.file.fingerprint : "";
}

function removeFingerprintTrack(index: Map<string, ScannedTrack[]>, track: ScannedTrack) {
  const fingerprint = fingerprintKey(track);
  if (!fingerprint) return;
  const candidates = index.get(fingerprint);
  if (!candidates) return;
  const remaining = candidates.filter(candidate => sourceKey(candidate) !== sourceKey(track));
  if (remaining.length) index.set(fingerprint, remaining);
  else index.delete(fingerprint);
}

export function sanitizeLibraryRoots(roots: string[]) {
  const unique = new Map<string, string>();
  for (const root of roots) {
    if (typeof root !== "string" || !root.trim()) continue;
    // Drive roots keep their separator: "E:\" stays absolute, "E:" would not.
    const resolved = libraryRootPath(root);
    const key = normalizedPath(resolved);
    if (!unique.has(key)) unique.set(key, resolved);
  }
  const sorted = [...unique.entries()].sort(([left], [right]) => left.length - right.length);
  const accepted: Array<[string, string]> = [];
  for (const candidate of sorted) {
    if (accepted.some(([parent]) => libraryPathWithin(candidate[0], parent)) && !isLinkedDirectory(candidate[1])) continue;
    accepted.push(candidate);
  }
  return accepted.map(([, original]) => original);
}

function owningRoot(track: LegacyTrackRecord, roots: RootScanResult[]) {
  const location = normalizedPath(track.sourcePath || track.folder);
  if (!location) return undefined;
  return roots
    .map(root => ({ root, key: normalizedPath(root.path) }))
    .filter(({ key }) => libraryPathWithin(location, key))
    .sort((left, right) => right.key.length - left.key.length)[0]?.root;
}

/** The deepest requested root that holds the track, if any. */
function owningRequestedRoot(track: LegacyTrackRecord, rootKeys: string[]) {
  const location = normalizedPath(track.sourcePath || track.folder);
  if (!location) return undefined;
  return rootKeys.filter(key => libraryPathWithin(location, key)).sort((left, right) => right.length - left.length)[0];
}

/**
 * The old file of a track in a partially scanned root is gone: nothing exists
 * at its path (ENOENT only; any other error proves nothing), and the path is
 * not under a folder or link the scan could not read.
 */
function sourceIsGone(track: LegacyTrackRecord, root: RootScanResult) {
  const sourcePath = track.sourcePath || track.location?.sourcePath;
  if (!sourcePath) return false;
  const key = normalizedPath(sourcePath);
  if ((root.unreadableDirectories || []).some(directory => libraryPathWithin(key, normalizedPath(directory)))) return false;
  try { return fs.statSync(sourcePath, { throwIfNoEntry: false }) === undefined; }
  catch { return false; }
}

function cleanScannedTrack(scanned: ScannedTrack, previous?: LegacyTrackRecord): LegacyTrackRecord {
  const { metadataRead, ...clean } = scanned;
  if (!previous) return clean;
  if (previous.onlineMetadata) { clean.onlineMetadata = previous.onlineMetadata; clean.name = previous.name; clean.year = previous.year; clean.genre = previous.genre; }
  if (previous.coverLocked) { clean.coverUrl = previous.coverUrl; clean.coverLocked = true; }
  if (metadataRead === false) {
    // The scan read no tags, so its empty tags and the album identity derived
    // from them describe nothing. Keep the last known ones; without any, the
    // domain upgrade derives them again from the restored flat fields.
    const observed: LegacyTrackRecord = { ...clean };
    delete observed.tags;
    delete observed.albumId;
    return {
      ...observed,
      ...(previous.tags ? { tags: previous.tags } : {}),
      ...(previous.albumId ? { albumId: previous.albumId } : {}),
      name: previous.name,
      artist: previous.artist,
      album: previous.album,
      genre: previous.genre,
      year: previous.year,
      duration: previous.duration ?? clean.duration,
      coverUrl: previous.coverUrl || clean.coverUrl
    };
  }
  return !clean.coverUrl && previous.coverUrl ? { ...clean, coverUrl: previous.coverUrl } : clean;
}

export class LibraryReconciler {
  reconcile(
    previous: LegacyLibraryPayload,
    scan: LibraryScanResult,
    requestedRoots: string[]
  ): LibraryReconcileResult {
    const previousTracks = previous.tracks.filter(isLegacyTrack);
    const scannedRootKeys = new Set(scan.roots.map(root => normalizedPath(root.path)));
    const requestedRootKeys = requestedRoots.filter(root => typeof root === "string" && root.trim()).map(normalizedPath);
    // The root that decides about an old track: the deepest requested root
    // holding it. When that root was not part of this scan (adding one new
    // folder scans only that folder), the track was not observed at all.
    const observingRoot = (track: LegacyTrackRecord) => {
      const requested = owningRequestedRoot(track, requestedRootKeys);
      const scanned = owningRoot(track, scan.roots);
      if (requested && (!scanned || requested.length > normalizedPath(scanned.path).length) && !scannedRootKeys.has(requested))
        return { unscanned: true as const };
      return { root: scanned, requested };
    };
    // Files the scan saw but did not index (0 bytes: a copy or tag editor is
    // rewriting them right now). Their tracks were observed, not deleted.
    const emptyKeys = new Set((scan.failures || []).filter(item => item.code === "EMPTY_FILE").map(item => normalizedPath(item.path)));
    // A track may move only when its old path is known to be gone: its root was
    // scanned completely, it is no longer under any library root, or its root was
    // read in part and the file itself is missing outside the unread folders.
    // Otherwise a same-content copy elsewhere is a second file, not this one moved.
    const mayRelocate = (track: LegacyTrackRecord) => {
      if (emptyKeys.has(sourceKey(track))) return false;
      const owner = observingRoot(track);
      if ("unscanned" in owner) return false;
      if (!owner.root) return !owner.requested;
      if (owner.root.status === "complete") return true;
      return owner.root.status === "partial" && sourceIsGone(track, owner.root);
    };
    const scannedBySource = new Map<string, ScannedTrack>();
    const scannedByMedia = new Map<string, ScannedTrack>();
    const scannedByFingerprint = new Map<string, ScannedTrack[]>();
    for (const track of scan.tracks) {
      const key = sourceKey(track);
      if (!scannedBySource.has(key)) scannedBySource.set(key, track);
      if (track.mediaId && !scannedByMedia.has(track.mediaId)) scannedByMedia.set(track.mediaId, track);
      const fingerprint = fingerprintKey(track);
      if (fingerprint) scannedByFingerprint.set(fingerprint, [...(scannedByFingerprint.get(fingerprint) || []), track]);
    }

    const added: string[] = [];
    const updated: string[] = [];
    const unavailable: string[] = [];
    const removed: string[] = [];
    const preserved: string[] = [];
    const relocated: string[] = [];
    const nextTracks: LegacyTrackRecord[] = [];

    // Reserve every direct path before attempting relocation. A missing copy
    // must never consume another copy which still exists at its original path.
    const matches = new Map<LegacyTrackRecord, ScannedTrack>();
    const reserve = (previousTrack: LegacyTrackRecord, scanned: ScannedTrack) => {
      matches.set(previousTrack, scanned);
      scannedBySource.delete(sourceKey(scanned));
      if (scanned.mediaId) scannedByMedia.delete(scanned.mediaId);
      removeFingerprintTrack(scannedByFingerprint, scanned);
    };
    for (const oldTrack of previousTracks) {
      const direct = scannedBySource.get(sourceKey(oldTrack));
      if (direct) reserve(oldTrack, direct);
    }
    const relocatable = new Set(previousTracks.filter(mayRelocate));
    for (const oldTrack of previousTracks) {
      if (matches.has(oldTrack) || !relocatable.has(oldTrack)) continue;
      const identified = oldTrack.mediaId ? scannedByMedia.get(oldTrack.mediaId) : undefined;
      if (identified) reserve(oldTrack, identified);
    }
    const unmatchedFingerprints = new Map<string, number>();
    for (const oldTrack of previousTracks) {
      if (matches.has(oldTrack) || !relocatable.has(oldTrack)) continue;
      const fingerprint = fingerprintKey(oldTrack);
      if (fingerprint) unmatchedFingerprints.set(fingerprint, (unmatchedFingerprints.get(fingerprint) || 0) + 1);
    }
    for (const oldTrack of previousTracks) {
      if (matches.has(oldTrack) || !relocatable.has(oldTrack)) continue;
      const fingerprint = fingerprintKey(oldTrack);
      const candidates = scannedByFingerprint.get(fingerprint);
      if (unmatchedFingerprints.get(fingerprint) === 1 && candidates?.length === 1) reserve(oldTrack, candidates[0]);
    }

    for (const oldTrack of previousTracks) {
      const key = sourceKey(oldTrack);
      const scanned = matches.get(oldTrack);
      if (scanned) {
        const moved = sourceKey(scanned) !== key;
        const merged = cleanScannedTrack(scanned, oldTrack);
        if (oldTrack.mediaId) {
          merged.id = oldTrack.mediaId;
          merged.mediaId = oldTrack.mediaId;
          if (moved) relocated.push(oldTrack.mediaId);
        }
        nextTracks.push(merged);
        if (JSON.stringify(merged) !== JSON.stringify(oldTrack)) updated.push(oldTrack.id);
        else preserved.push(oldTrack.id);
        continue;
      }

      const owner = observingRoot(oldTrack);
      const root = "unscanned" in owner ? undefined : owner.root;
      if (emptyKeys.has(key)) {
        nextTracks.push(oldTrack);
        preserved.push(oldTrack.id);
        unavailable.push(oldTrack.id);
      } else if (!root) {
        nextTracks.push(oldTrack);
        preserved.push(oldTrack.id);
      } else if (root.status === "complete") {
        removed.push(oldTrack.id);
      } else {
        nextTracks.push(oldTrack);
        preserved.push(oldTrack.id);
        unavailable.push(oldTrack.id);
      }
    }

    // A new copy with the same content as a kept track gets an instance id of
    // its own; sharing the id would make the domain upgrade rename both and
    // break favourites, queue entries and bookmarks of the kept one.
    const keptIds = new Set(nextTracks.flatMap(track => [track.id, track.mediaId].filter((id): id is string => Boolean(id))));
    for (const scanned of scannedBySource.values()) {
      let track = cleanScannedTrack(scanned);
      const mediaId = track.mediaId || track.id;
      if (keptIds.has(mediaId)) {
        const instanceId = mediaInstanceId(mediaId, track.location?.canonicalPath || track.sourcePath || track.id);
        track = { ...track, id: instanceId, mediaId: instanceId };
      }
      keptIds.add(track.id);
      nextTracks.push(track);
      added.push(track.id);
    }

    return {
      added,
      updated,
      relocated,
      unavailable,
      removed,
      preserved,
      failures: scan.failures,
      snapshot: {
        tracks: nextTracks,
        folders: sanitizeLibraryRoots(requestedRoots)
      }
    };
  }
}

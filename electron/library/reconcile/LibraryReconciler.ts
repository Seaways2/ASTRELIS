import path from "node:path";
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
  return path.resolve(value).replace(/\//g, "\\").replace(/\\+$/, "").toLocaleLowerCase();
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
    const resolved = path.resolve(root.trim()).replace(/\//g, "\\").replace(/\\+$/, "");
    const key = normalizedPath(resolved);
    if (!unique.has(key)) unique.set(key, resolved);
  }
  const sorted = [...unique.entries()].sort(([left], [right]) => left.length - right.length);
  const accepted: Array<[string, string]> = [];
  for (const candidate of sorted) {
    if (accepted.some(([parent]) => candidate[0] === parent || candidate[0].startsWith(parent + "\\"))) continue;
    accepted.push(candidate);
  }
  return accepted.map(([, original]) => original);
}

function owningRoot(track: LegacyTrackRecord, roots: RootScanResult[]) {
  const location = normalizedPath(track.sourcePath || track.folder);
  if (!location) return undefined;
  return roots
    .map(root => ({ root, key: normalizedPath(root.path) }))
    .filter(({ key }) => location === key || location.startsWith(key + "\\"))
    .sort((left, right) => right.key.length - left.key.length)[0]?.root;
}

function cleanScannedTrack(scanned: ScannedTrack, previous?: LegacyTrackRecord): LegacyTrackRecord {
  const { metadataRead, ...clean } = scanned;
  if (!previous) return clean;
  if (previous.onlineMetadata) { clean.onlineMetadata = previous.onlineMetadata; clean.name = previous.name; clean.year = previous.year; clean.genre = previous.genre; }
  if (previous.coverLocked) { clean.coverUrl = previous.coverUrl; clean.coverLocked = true; }
  if (metadataRead === false) {
    return {
      ...clean,
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
    for (const oldTrack of previousTracks) {
      if (matches.has(oldTrack)) continue;
      const identified = oldTrack.mediaId ? scannedByMedia.get(oldTrack.mediaId) : undefined;
      if (identified) reserve(oldTrack, identified);
    }
    const unmatchedFingerprints = new Map<string, number>();
    for (const oldTrack of previousTracks) {
      if (matches.has(oldTrack)) continue;
      const fingerprint = fingerprintKey(oldTrack);
      if (fingerprint) unmatchedFingerprints.set(fingerprint, (unmatchedFingerprints.get(fingerprint) || 0) + 1);
    }
    for (const oldTrack of previousTracks) {
      if (matches.has(oldTrack)) continue;
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

      const root = owningRoot(oldTrack, scan.roots);
      if (!root) {
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

    for (const scanned of scannedBySource.values()) {
      const track = cleanScannedTrack(scanned);
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

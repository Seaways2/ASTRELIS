import type { Track } from "../types/audio";

/** What the main process answers for a file that is gone (electron/library/media/sourceAvailability.ts). */
export const SOURCE_MISSING = "SOURCE_MISSING";

/**
 * Finds the library copy of a queued track whose file is no longer where the
 * queue remembers it, for example after a tagging tool reorganised the music
 * folders. The library is rescanned from disk, so it knows the new location.
 *
 * Evidence, strongest first: the same content fingerprint, the same byte size,
 * a duration within half a second, then the same title, file name, album and
 * artist. A match needs the same format and either the same content or a
 * matching duration with a matching title or file name. A tie between the
 * best two candidates is no match: playing the wrong song is worse than none.
 */
export function relocateMissingTrack(track: Track, library: Track[]): Track | undefined {
  const format = normalise(track.format);
  const title = normalise(track.name);
  const base = baseName(track.sourcePath);
  const fingerprint = track.file?.fingerprint;
  let best: Track | undefined, bestScore = 0, tie = false;
  for (const candidate of library) {
    if (!candidate.sourcePath || candidate.sourcePath === track.sourcePath) continue;
    if (normalise(candidate.format) !== format) continue;
    const sameContent = Boolean(fingerprint && candidate.file?.fingerprint === fingerprint);
    const sameSize = track.size > 0 && candidate.size === track.size;
    const closeDuration = Number.isFinite(track.duration) && Number.isFinite(candidate.duration)
      && Math.abs((track.duration as number) - (candidate.duration as number)) < .5;
    const sameTitle = Boolean(title) && normalise(candidate.name) === title;
    const sameBase = Boolean(base) && baseName(candidate.sourcePath) === base;
    if (!(sameContent || ((sameSize || closeDuration) && (sameTitle || sameBase)) || (sameSize && closeDuration))) continue;
    const score = (sameContent ? 6 : 0) + (sameSize ? 3 : 0) + (closeDuration ? 2 : 0) + (sameTitle ? 2 : 0) + (sameBase ? 1 : 0)
      + (normalise(candidate.album) === normalise(track.album) ? 1 : 0) + (normalise(candidate.artist) === normalise(track.artist) ? 1 : 0);
    if (score > bestScore) { best = candidate; bestScore = score; tie = false; }
    else if (score === bestScore) tie = true;
  }
  return tie ? undefined : best;
}

function normalise(value: string | undefined) {
  return (value || "").normalize("NFKC").toLowerCase().replace(/[\s_\-'"’.,;:()[\]【】（）]+/g, "");
}

function baseName(filePath: string | undefined) {
  const name = (filePath || "").split(/[\\/]/).pop() || "";
  // Track numbers ("01.", "2-01 ") come and go when files are renamed.
  return normalise(name.replace(/\.[^.]+$/, "").replace(/^(\d+[\s.\-_]+)+/, ""));
}

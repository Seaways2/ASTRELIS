import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { videoExtensions } from "./videoPlayer";
import { AUDIO_EXTENSIONS } from "./library/media/audioFormats";

// One list for the scanner, file associations at runtime and playback checks.
export { AUDIO_EXTENSIONS, FFMPEG_DECODED_AUDIO_EXTENSIONS, needsDecodedAudio } from "./library/media/audioFormats";

/**
 * Audio and video paths named by `argv`, resolved and de-duplicated, without
 * touching the disk. Callers with many paths (queue restore sends up to 20,000)
 * check them asynchronously instead of stalling the main process.
 */
export function externalAudioPathCandidates(argv: string[], workingDirectory = process.cwd()) {
  const unique = new Map<string, string>();
  for (const argument of argv) {
    if (typeof argument !== "string") continue;
    let candidate = argument.trim();
    if (candidate.length >= 2 && candidate[0] === candidate.at(-1) && (candidate[0] === '"' || candidate[0] === "'"))
      candidate = candidate.slice(1, -1);
    if (!candidate || candidate.startsWith("--")) continue;
    try {
      candidate = candidate.startsWith("file://") ? fileURLToPath(candidate) : path.resolve(workingDirectory, candidate);
      if (!AUDIO_EXTENSIONS.has(path.extname(candidate).toLowerCase()) && !videoExtensions.includes(path.extname(candidate).slice(1).toLowerCase())) continue;
      unique.set(candidate.toLocaleLowerCase(), candidate);
    } catch { /* Command lines also contain the executable and development directory. */ }
  }
  return [...unique.values()];
}

/** Command-line paths (a handful): the candidates that are existing files. */
export function externalAudioPaths(argv: string[], workingDirectory = process.cwd()) {
  return externalAudioPathCandidates(argv, workingDirectory).filter(candidate => {
    try { return fs.statSync(candidate).isFile(); }
    catch { return false; }
  });
}

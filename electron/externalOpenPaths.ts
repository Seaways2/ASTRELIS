import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { videoExtensions } from "./videoPlayer";

export const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".ape", ".dsf", ".aiff", ".aif", ".opus", ".wma", ".dts", ".ac3", ".eac3"]);

export function externalAudioPaths(argv: string[], workingDirectory = process.cwd()) {
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
      if (!fs.statSync(candidate).isFile()) continue;
      unique.set(candidate.toLocaleLowerCase(), candidate);
    } catch { /* Command lines also contain the executable and development directory. */ }
  }
  return [...unique.values()];
}

import path from "node:path";

/** Audio files the library scans and the player accepts. */
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  ".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".ape", ".dsf", ".aiff", ".aif", ".opus", ".wma",
  ".dts", ".ac3", ".eac3", ".wv", ".tta"
]);

/**
 * Formats Chromium and the native host cannot play: they are decoded to WAV
 * through ffmpeg (DecodedAudioCache) before playback. main.ts prepareLocalSource
 * should use this set rather than its own list.
 */
export const FFMPEG_DECODED_AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ape", ".dsf", ".wma", ".dts", ".ac3", ".eac3", ".wv", ".tta"
]);

export function needsDecodedAudio(filePath: string) {
  return FFMPEG_DECODED_AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

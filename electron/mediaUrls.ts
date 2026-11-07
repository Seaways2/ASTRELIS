import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { legacyArtworkUrl } from "./library/media/ArtworkCache";
import { videoDisplayName } from "./library/media/videoDisplayName";
import { videoExtensions } from "./videoPlayer";

export function mediaUrl(filePath: string) {
  return `auralis-media://local/${encodeURIComponent(filePath)}`;
}

export function cachedArtworkUrl(sourcePath: string) {
  return legacyArtworkUrl(sourcePath, path.join(app.getPath("userData"), "artwork-cache"), mediaUrl);
}

export function hydrateLibraryTracks(tracks: unknown[]) {
  return (tracks as Array<Record<string, unknown>>).map(track => {
    const storedCover = typeof track.coverUrl === "string" && track.coverUrl.startsWith("file:")
      ? mediaUrl(fileURLToPath(track.coverUrl))
      : track.coverUrl;
    return {
      ...track,
      ...(!track.onlineMetadata && typeof track.sourcePath === "string" && videoExtensions.includes(path.extname(track.sourcePath).slice(1).toLowerCase()) ? videoDisplayName(track.sourcePath) : {}),
      url: typeof track.sourcePath === "string" ? mediaUrl(track.sourcePath) : track.url,
      coverUrl: storedCover || (typeof track.sourcePath === "string" ? cachedArtworkUrl(track.sourcePath) : undefined)
    };
  });
}

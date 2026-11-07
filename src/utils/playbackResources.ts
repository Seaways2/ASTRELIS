import { isVideoTrack } from "./videoTrack";
/** Do not guess a random next song or preload remote streams. */
export function prefetchTarget<T extends { id: string; sourcePath?: string; format: string }>(
  tracks: T[], index: number, playing: boolean, online: boolean, shuffle: boolean, repeat: string
): T | undefined {
  if (!playing || online || shuffle || repeat === "one" || index < 0 || index >= tracks.length || tracks.length < 2) return;
  const next = index + 1 < tracks.length ? index + 1 : repeat === "all" ? 0 : -1;
  const track = tracks[next];
  if (track?.sourcePath && !isVideoTrack(track) && !isVideoTrack(tracks[index]) && track.format !== "NETEASE" && track.id !== tracks[index].id) return track;
}

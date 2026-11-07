import { Converter } from "opencc-js/t2cn";
import type { Track } from "../types/audio";
import type { MusicCoverCandidate } from "../../electron/library/media/MusicBrainzClient";
const normalize = (value:string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
// Convert only comparison keys; preserve original tags, labels and grouping identities.
let simplify: ReturnType<typeof Converter> | undefined;
const matchKey = (value:string) => normalize(/[\p{Script=Han}]/u.test(value)
  ? (simplify ??= Converter({from:"tw",to:"cn"}))(value.normalize("NFKC")) : value);
const unknown = /^(未知艺术家|本地音频|未识别专辑|未分类专辑|未分类|unknown artist|unknown album|local audio)$/i;
export function groupMusicCovers(tracks: Track[]) {
  const groups = new Map<string,{key:string;ids:string[];album:string;artist:string;title:string}>();
  for (const track of tracks) {
    if (track.coverUrl || track.coverLocked) continue;
    const album = unknown.test(track.album || "") ? "" : (track.album || "");
    const sourceArtist = track.tags?.albumArtist || track.artist || "";
    const artist = unknown.test(sourceArtist) ? "" : sourceArtist;
    const key = album ? JSON.stringify([normalize(album),normalize(artist)]) : track.id;
    let group=groups.get(key);if(!group){group={key,ids:[],album,artist,title:track.name};groups.set(key,group);}group.ids.push(track.id);
  }
  return [...groups.values()];
}
export function confidentMusicCover(album:string, artist:string, candidates:MusicCoverCandidate[]) {
  // Search also returns partial title hits. Only exact album + credited artist
  // (including official aliases and credited collaborators) qualify; multiple exact hits need review.
  if (!album.trim() || !artist.trim()) return undefined;
  const exactAlbums = candidates.filter(candidate => [candidate.title,...(candidate.titleNames || [])].some(name=>matchKey(name) === matchKey(album)));
  const find = (performer:string) => exactAlbums.filter(candidate =>
    [candidate.artist, ...(candidate.artistNames || []), ...(candidate.artistCredits || []).flat()].some(name => matchKey(name) === matchKey(performer)));
  const matches = find(artist);
  if (matches.length) return matches.length === 1 ? matches[0] : undefined;
  // The first credit is the lead; never guess an album from an arbitrary guest singer.
  const parts = artist.split(/\s*(?:[&＆、;；/]|\bfeat\.?|\bfeaturing\b|\bft\.?)\s*/i).map(value=>value.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return undefined;
  const leadMatches = find(parts[0]);
  return leadMatches.length === 1 ? leadMatches[0] : undefined;
}

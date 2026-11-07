import type { FilmMetadata } from "./TmdbClient";
export interface MatchSource { id: string; name: string; year?: number; sourcePath?: string; onlineMetadata?: FilmMetadata }
export interface MatchGroup { key: string; ids: string[]; query: string; year: string; type: "movie" | "tv" }
const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
export function groupFilmMatches(tracks: MatchSource[]): MatchGroup[] {
  const groups = new Map<string, MatchGroup>();
  for (const track of tracks) {
    if (track.onlineMetadata) continue;
    const episode = /(?:^|[ ._-])(S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|第[一二三四五六七八九十百\d]+集)(?:\b|[ ._-]|$)/i.exec(track.name);
    const query = episode ? track.name.slice(0, episode.index).replace(/[ ._-]+$/, "") || track.name : track.name;
    const type = episode ? "tv" : "movie";
    const folder = (track.sourcePath || "").replace(/\\/g, "/").split("/").slice(0, -1).join("/").toLowerCase();
    const key = type === "tv" ? `${folder}|${normalize(query)}|${track.year || ""}` : track.id;
    const group = groups.get(key);
    if (group) group.ids.push(track.id); else groups.set(key, { key, ids: [track.id], query, year: String(track.year || ""), type });
  }
  return [...groups.values()];
}
export function confidentFilmMatch(group: MatchGroup, candidates: FilmMetadata[]) {
  // A single search result needs no additional confirmation.
  const unique = [...new Map(candidates.filter(item => item.mediaType === group.type).map(item => [item.id, item])).values()];
  if (unique.length === 1) return unique[0];
  if (!group.year) return undefined;
  const exact = unique.filter(item => item.mediaType === group.type && String(item.year) === group.year && [item.title, item.originalTitle].some(title => normalize(title) === normalize(group.query)));
  return exact.length === 1 ? exact[0] : undefined;
}

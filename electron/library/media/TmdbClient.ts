import type { ExternalJson } from "../../externalJson";
import { filmSearchQueries } from "./filmSearchQuery";
export interface FilmMetadata {
  provider: "tmdb"; id: number; mediaType: "movie" | "tv"; title: string;
  originalTitle: string; overview: string; year?: number; posterPath?: string;
  genres: string[]; cast: string[]; matchedAt: string;
}
export function validFilmMetadata(value: unknown): value is FilmMetadata {
  const v = value as FilmMetadata;
  return !!v && v.provider === "tmdb" && Number.isSafeInteger(v.id) && v.id > 0 && ["movie", "tv"].includes(v.mediaType)
    && [v.title, v.originalTitle, v.overview, v.matchedAt].every(s => typeof s === "string" && s.length <= 20000)
    && [v.genres, v.cast].every(a => Array.isArray(a) && a.length <= 50 && a.every(s => typeof s === "string" && s.length <= 300))
    && (v.year === undefined || Number.isInteger(v.year)) && (v.posterPath === undefined || /^\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(v.posterPath));
}
export class TmdbClient {
  constructor(private token: () => string, private request: typeof fetch = fetch) {}
  private async bytes(url: URL, image = false) {
    const token = this.token();
    if (!token) throw new Error("请先配置 TMDB API 凭据");
    const headers: Record<string, string> = {};
    if (!image) { if (/^[a-f0-9]{32}$/i.test(token)) url.searchParams.set("api_key", token); else headers.Authorization = `Bearer ${token}`; }
    try {
      const response = await this.request(url, { headers, signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) throw new Error(response.status === 401 ? "TMDB 凭据无效，请重新配置" : response.status === 429 ? "请求过于频繁，请稍后重试" : `TMDB 请求失败（${response.status}）`);
      if (!response.body) throw new Error("TMDB 返回空数据");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > (image ? 8 : 2) * 1024 * 1024) { await reader.cancel(); throw new Error("TMDB 返回数据过大"); } chunks.push(part.value); }
      return Buffer.concat(chunks);
    } catch (error) { if (error instanceof Error && error.message.startsWith("TMDB") || error instanceof Error && error.message.startsWith("请求")) throw error; throw new Error("无法连接 TMDB 或请求超时，请检查网络后重试"); }
  }
  private async json(endpoint: string, params: Record<string, string> = {}) {
    const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
    for (const [key, value] of Object.entries({ language: "zh-CN", ...params })) url.searchParams.set(key, value);
    return JSON.parse((await this.bytes(url)).toString("utf8"));
  }
  private normalize(v: ExternalJson, type: "movie" | "tv"): FilmMetadata {
    const text = (s: unknown) => typeof s === "string" ? s.slice(0, 20000) : "";
    const year = Number(text(v.release_date || v.first_air_date).slice(0, 4));
    return { provider: "tmdb", id: v.id, mediaType: type, title: text(v.title || v.name), originalTitle: text(v.original_title || v.original_name), overview: text(v.overview), ...(year ? { year } : {}), ...(/^\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(v.poster_path) ? { posterPath: v.poster_path } : {}), genres: (v.genres || []).slice(0, 30).map((g: ExternalJson) => text(g.name).slice(0,300)), cast: (v.credits?.cast || []).slice(0, 12).map((g: ExternalJson) => text(g.name).slice(0,300)), matchedAt: new Date().toISOString() };
  }
  async search(query: string, type: "movie" | "tv", year = "") {
    if (!["movie", "tv"].includes(type) || !query.trim() || query.length > 200 || (year && !/^\d{4}$/.test(year))) throw new Error("请输入有效片名与四位年份");
    for (const variant of filmSearchQueries(query)) {
      const data = await this.json(`search/${type}`, { query: variant, include_adult: "false", ...(year ? { [type === "movie" ? "primary_release_year" : "first_air_date_year"]: year } : {}) });
      const results = (data.results || []).slice(0, 20).map((v: ExternalJson) => this.normalize(v, type)).filter(validFilmMetadata);
      // Only broaden an empty result. Ambiguous results remain available for review.
      if (results.length) return results;
    }
    return [];
  }
  async details(type: "movie" | "tv", id: number) {
    if (!["movie", "tv"].includes(type) || !Number.isSafeInteger(id) || id <= 0) throw new Error("无效的影视条目");
    const result = this.normalize(await this.json(`${type}/${id}`, { append_to_response: "credits" }), type);
    if (!validFilmMetadata(result)) throw new Error("TMDB 资料格式错误");
    return result;
  }
  async poster(posterPath: string) {
    if (!/^\/[a-zA-Z0-9_-]+\.(jpg|png)$/.test(posterPath)) throw new Error("无效海报路径");
    return this.bytes(new URL(`https://image.tmdb.org/t/p/w500${posterPath}`), true);
  }
}

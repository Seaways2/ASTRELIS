export interface MusicCoverCandidate {
  id: string; kind: "release" | "release-group"; title: string; artist: string; year: string; artistNames?: string[]; artistCredits?: string[][]; titleNames?: string[];
}
const mbid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validMusicId(id: unknown): id is string { return typeof id === "string" && mbid.test(id); }
const text = (value: unknown) => typeof value === "string" ? value.slice(0, 300) : "";
const escapeQuery = (value: string) => value.replace(/[+\-!(){}[\]^"~*?:\\/|&]/g, " ").replace(/\s+/g, " ").trim();

/** Public, read-only API. One shared queue enforces MusicBrainz's per-IP request limit. */
export class MusicBrainzClient {
  private lane: Promise<unknown> = Promise.resolve();
  private nextRequest = 0;
  private searches = new Map<string, Promise<MusicCoverCandidate[]>>();
  private cache = new Map<string, {until: number; results: MusicCoverCandidate[]}>();
  constructor(private version: string, private request: typeof fetch = fetch, private interval = 1100) {}
  private async bytes(url: URL, image = false): Promise<Buffer> {
    const signal = AbortSignal.timeout(20000);
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const allowed = image ? url.hostname === "coverartarchive.org" || url.hostname === "archive.org" || url.hostname.endsWith(".archive.org") : url.hostname === "musicbrainz.org";
        if (!allowed || url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw Error("music.unsafeUrl");
        const response = await this.request(url, {signal, redirect:"manual", headers:{"User-Agent":`ASTRELIS/${this.version} (desktop music cover matcher)`, Accept:image?"image/*":"application/json"}});
        if ([301,302,303,307,308].includes(response.status)) {
          const target = response.headers.get("location"); await response.body?.cancel();
          if (!image || !target) throw Error("music.unsafeUrl");
          url = new URL(target, url); if (url.protocol === "http:") url.protocol = "https:";
          continue;
        }
        if (response.status === 404 && image) throw Error("music.noCover");
        if (response.status === 429 || response.status === 503) { this.nextRequest = Date.now() + 10000; throw Error("music.rateLimited"); }
        if (!response.ok || !response.body) throw Error("music.requestFailed");
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > (image ? 8 : 2)*1024*1024) { await reader.cancel(); throw Error("music.responseLarge"); } chunks.push(part.value); }
        return Buffer.concat(chunks);
      }
      throw Error("music.unsafeUrl");
    } catch (error) { if (error instanceof Error && error.message.startsWith("music.")) throw error; throw Error("music.networkError"); }
  }
  private json(url: URL) {
    const task = this.lane.then(async () => {
      const wait = this.nextRequest - Date.now(); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      this.nextRequest = Date.now() + this.interval;
      return JSON.parse((await this.bytes(url)).toString("utf8"));
    });
    this.lane = task.catch(() => undefined);
    return task;
  }
  async search(album: string, artist: string, title = ""): Promise<MusicCoverCandidate[]> {
    if ([album,artist,title].some(v=>typeof v!=="string" || v.length>300) || !(album.trim() || title.trim())) throw Error("music.invalidQuery");
    // Album lookups do not depend on the selected song. Reuse across dialogs and tracks.
    const normalize = (value:string) => value.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
    const key = JSON.stringify([normalize(album),normalize(artist),album.trim()?"":normalize(title)]);
    const cached = this.cache.get(key); if (cached && cached.until>Date.now()) return structuredClone(cached.results);
    const existing = this.searches.get(key); if(existing)return structuredClone(await existing);
    if(this.searches.size>=32)throw Error("music.rateLimited");
    const pending=this.searchUncached(album,artist,title,key);
    this.searches.set(key,pending);
    try{return structuredClone(await pending);}finally{this.searches.delete(key);}
  }
  private async searchUncached(album:string,artist:string,title:string,key:string):Promise<MusicCoverCandidate[]> {
    const entity = album.trim() ? "release-group" : "recording";
    const name = escapeQuery(album || title), performer = escapeQuery(artist);
    if (!name) throw Error("music.invalidQuery");
    const url = new URL(`https://musicbrainz.org/ws/2/${entity}/`);
    url.searchParams.set("query", `${entity === "release-group" ? "releasegroup" : "recording"}:"${name}"${performer ? ` AND artist:"${performer}"` : ""}`);
    url.searchParams.set("fmt", "json"); url.searchParams.set("limit", "15");
    let data = await this.json(url);
    // Track tags often list guest singers while the album belongs to the lead artist.
    // Try the complete credit first (also preserves band names containing '&').
    const parts = artist.split(/\s*(?:[&＆、;；/]|\bfeat\.?|\bfeaturing\b|\bft\.?)\s*/i).map(escapeQuery).filter(Boolean);
    if (entity === "release-group" && Array.isArray(data["release-groups"]) && !data["release-groups"].length && parts.length > 1 && parts.length <= 4) {
      url.searchParams.set("query", `releasegroup:"${name}" AND artist:"${parts[0]}"`);
      data = await this.json(url);
    }
    // Some localized titles exist only on a release, not on its release-group index.
    if (entity === "release-group" && Array.isArray(data["release-groups"]) && !data["release-groups"].length && performer) {
      const releaseUrl = new URL("https://musicbrainz.org/ws/2/release/");
      const lead = parts.length > 1 && parts.length <= 4 ? parts[0] : performer;
      releaseUrl.searchParams.set("query", `release:"${name}" AND artist:"${lead}"`);
      releaseUrl.searchParams.set("fmt","json"); releaseUrl.searchParams.set("limit","15");
      const releases = await this.json(releaseUrl);
      data = {"release-groups":(Array.isArray(releases.releases) ? releases.releases : []).slice(0,15)
        .filter((release:any)=>validMusicId(release["release-group"]?.id))
        .map((release:any)=>({...release["release-group"], titleNames:[text(release.title)], "artist-credit":release["artist-credit"], date:release.date}))};
    }
    const results: MusicCoverCandidate[] = [];
    const add = (item: any, kind: MusicCoverCandidate["kind"], credits: any) => {
      if (!validMusicId(item?.id) || !text(item.title)) return;
      const names = Array.isArray(credits) ? credits.map(c=>text(c.name || c.artist?.name)).filter(Boolean).join(" / ") : "";
      // Aliases belong to the credited artist identity. A member's alias alone must
      // never identify an entire collaboration, so expand only single-artist credits.
      const artistNames = [names];
      if (Array.isArray(credits) && credits.length === 1) {
        const artist = credits[0]?.artist;
        artistNames.push(text(artist?.name));
        for (const alias of (Array.isArray(artist?.aliases) ? artist.aliases : []).slice(0,64)) {
          if (!alias.type || alias.type === "Artist name") artistNames.push(text(alias.name));
        }
      }
      const artistCredits = (Array.isArray(credits) ? credits : []).slice(0,32).map(credit =>
        [...new Set([text(credit.name), text(credit.artist?.name),
          ...(Array.isArray(credit.artist?.aliases) ? credit.artist.aliases : []).slice(0,64)
            .filter((alias:any) => !alias.type || alias.type === "Artist name").map((alias:any) => text(alias.name))].filter(Boolean))]);
      if (!results.some(v=>v.id===item.id)) results.push({id:item.id,kind,title:text(item.title),artist:names,
        artistNames:[...new Set(artistNames.filter(Boolean))],artistCredits,titleNames:Array.isArray(item.titleNames)?item.titleNames.map(text):[],year:text(item["first-release-date"] || item.date).slice(0,4)});
    };
    if (entity === "release-group") for (const item of (Array.isArray(data["release-groups"])?data["release-groups"]:[]).slice(0,15)) add(item,"release-group",item["artist-credit"]);
    else for (const recording of (Array.isArray(data.recordings)?data.recordings:[]).slice(0,15)) for (const item of (Array.isArray(recording.releases)?recording.releases:[]).slice(0,10)) add(item,"release",item["artist-credit"] || recording["artist-credit"]);
    const limited = results.slice(0,20);
    this.cache.set(key,{until:Date.now()+300000,results:limited});
    while(this.cache.size>128)this.cache.delete(this.cache.keys().next().value!);
    return structuredClone(limited);
  }
  async cover(kind: MusicCoverCandidate["kind"], id: string) {
    if (!validMusicId(id) || !["release","release-group"].includes(kind)) throw Error("music.invalidId");
    return this.bytes(new URL(`https://coverartarchive.org/${kind}/${id}/front-500`), true);
  }
}

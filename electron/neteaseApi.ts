import type { ExternalJson } from "./externalJson";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeNeteaseCookieHeader } from "./neteaseCookie";

export interface NeteaseSearchItem {
  id: number;
  name: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
}

export interface NeteasePlaylistItem {
  id: number;
  name: string;
  coverUrl: string;
  trackCount: number;
  liked: boolean;
}

type NeteaseResponse = { status?: number; body?: ExternalJson; cookie?: string[] };
type NeteaseModule = (query: Record<string, unknown>) => Promise<NeteaseResponse>;
interface NeteaseModules {
  main: Record<string, NeteaseModule | undefined>;
  generateConfig(): Promise<void>;
}

const inertDotenv = { config: () => ({ parsed: {} }), configDotenv: () => ({ parsed: {} }), parse: () => ({}), populate: () => ({}) };

/**
 * The NetEase packages call require("dotenv").config() when loaded and again
 * for every song URL. dotenv reads .env from the current directory, which is
 * the folder of a media file double-clicked in Explorer, and ENABLE_PROXY /
 * PROXY_URL or the app's own switches would then come from that folder. The
 * app configures the API in code only, so their dotenv is replaced by an
 * inert module before they load.
 */
export function disableNeteaseDotenv() {
  const packageDirectory = path.dirname(require.resolve("@neteasecloudmusicapienhanced/api/main"));
  const lookups = [packageDirectory];
  try { lookups.push(path.dirname(require.resolve("@neteasecloudmusicapienhanced/unblockmusic-utils", { paths: [packageDirectory] }))); }
  catch { /* Optional in some installations. */ }
  for (const directory of lookups) {
    let dotenvPath: string;
    try { dotenvPath = require.resolve("dotenv", { paths: [directory] }); }
    catch { continue; }
    require.cache[dotenvPath] = { id: dotenvPath, filename: dotenvPath, loaded: true, exports: inertDotenv, children: [], paths: [] } as unknown as NodeJS.Module;
  }
}

let modules: NeteaseModules | undefined;
/**
 * Loads the NetEase API modules on first use (about 400 files; not on the
 * startup path). The app calls the module functions directly: the package's
 * Express server is never started, so no local HTTP port exists for other
 * programs or web pages to reach.
 */
export function neteaseModules(): NeteaseModules {
  if (modules) return modules;
  // On a clean Windows account the request module expects this token file to
  // exist already and otherwise crashes the Electron main process at require().
  const anonymousTokenPath = path.join(os.tmpdir(), "anonymous_token");
  if (!fs.existsSync(anonymousTokenPath)) fs.writeFileSync(anonymousTokenPath, "", "utf8");
  disableNeteaseDotenv();
  modules = {
    main: require("@neteasecloudmusicapienhanced/api/main") as Record<string, NeteaseModule | undefined>,
    generateConfig: require("@neteasecloudmusicapienhanced/api/generateConfig") as () => Promise<void>
  };
  return modules;
}

let apiCookie = "";
let startup: Promise<void> | null = null;
let sessionFile = "";

export const configureNeteaseSession = (filePath: string) => {
  sessionFile = filePath;
  try {
    const stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (typeof stored?.cookie === "string") apiCookie = stored.cookie;
  } catch { /* First launch or an invalid session falls back to anonymous mode. */ }
};

const persistSession = () => {
  if (!sessionFile || !apiCookie) return;
  fs.writeFileSync(sessionFile, JSON.stringify({ cookie: apiCookie, updatedAt: Date.now() }), "utf8");
};

const ensureNeteaseApi = () => {
  startup ??= (async () => {
    const { main, generateConfig } = neteaseModules();
    try {
      // The enhanced API creates its XEAPI public key in the OS temp folder,
      // not inside node_modules. A development machine often has this cached;
      // a clean installation does not. Generate it before the first stream.
      await generateConfig();
      if (apiCookie) return;
      const response = await main.register_anonimous!({});
      apiCookie = typeof response?.body?.cookie === "string" ? response.body.cookie : "";
    } catch {
      // Search works without a session; playback availability will report a
      // useful error if NetEase refuses an anonymous stream.
    }
  })().catch(error => {
    startup = null;
    throw error;
  });
  return startup;
};

/**
 * The session cookie as the package's HTTP server would have parsed a Cookie
 * header: name=value pairs, values may contain "=".
 */
export const neteaseCookieObject = (cookie: string) => {
  const parsed: Record<string, string> = {};
  for (const pair of normalizeNeteaseCookieHeader(cookie).split(/;\s*/)) {
    const split = pair.indexOf("=");
    if (split < 1 || split === pair.length - 1) continue;
    const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
    parsed[decode(pair.slice(0, split)).trim()] = decode(pair.slice(split + 1)).trim();
  }
  return parsed;
};

/** Calls one API module (e.g. "cloudsearch") the way its HTTP route would. */
const requestJson = async (name: string, query: Record<string, unknown>, includeCookie = true) => {
  await ensureNeteaseApi();
  const call = neteaseModules().main[name];
  if (typeof call !== "function") throw new Error(`网易云接口不可用 (${name})`);
  let response: NeteaseResponse;
  try {
    response = await call({ ...query, cookie: includeCookie && apiCookie ? neteaseCookieObject(apiCookie) : {} });
  } catch (failure) {
    const status = Number((failure as NeteaseResponse | undefined)?.status) || 0;
    throw new Error(`网易云接口请求失败 (${status || (failure instanceof Error ? failure.message : "unknown")})`);
  }
  const status = Number(response?.status) || 200;
  if (status < 200 || status >= 300) throw new Error(`网易云接口请求失败 (${status})`);
  return (response?.body ?? {}) as ExternalJson;
};

export const createNeteaseQr = async () => {
  const timestamp = Date.now();
  const keyPayload = await requestJson("login_qr_key", { timestamp }, false);
  const key = String(keyPayload?.data?.unikey || keyPayload?.unikey || "");
  if (!key) throw new Error("网易云没有返回二维码登录密钥");
  const qrPayload = await requestJson("login_qr_create", { key, qrimg: true, timestamp }, false);
  const qrImage = String(qrPayload?.data?.qrimg || qrPayload?.qrimg || "");
  const qrUrl = String(qrPayload?.data?.qrurl || qrPayload?.qrurl || "");
  if (!qrImage && !qrUrl) throw new Error("网易云没有返回登录二维码");
  return { key, qrImage, qrUrl };
};

export const checkNeteaseQr = async (key: string) => {
  const payload = await requestJson("login_qr_check", { key, timestamp: Date.now() }, false);
  const code = Number(payload?.code || 0);
  if (code === 803 && typeof payload?.cookie === "string" && payload.cookie) {
    apiCookie = payload.cookie;
    persistSession();
  }
  return {
    code,
    message: String(payload?.message || payload?.msg || ""),
    loggedIn: code === 803 && Boolean(apiCookie)
  };
};

export const getNeteaseLoginStatus = async () => {
  if (!apiCookie) return { loggedIn: false, userId: 0, nickname: "", avatarUrl: "" };
  try {
    const payload = await requestJson("login_status", { timestamp: Date.now() });
    const profile = payload?.data?.profile || payload?.profile;
    return {
      loggedIn: Boolean(profile?.userId),
      userId: Number(profile?.userId || 0),
      nickname: String(profile?.nickname || ""),
      avatarUrl: String(profile?.avatarUrl || "").replace(/^http:/, "https:")
    };
  } catch {
    return { loggedIn: false, userId: 0, nickname: "", avatarUrl: "" };
  }
};

export const logoutNetease = async () => {
  try { await requestJson("logout", { timestamp: Date.now() }); } catch { /* Local cleanup must still complete. */ }
  apiCookie = "";
  if (sessionFile) {
    try { fs.unlinkSync(sessionFile); } catch { /* Missing session file is already logged out. */ }
  }
  try {
    const response = await neteaseModules().main.register_anonimous!({});
    apiCookie = typeof response?.body?.cookie === "string" ? response.body.cookie : "";
  } catch { /* Search can still retry without an anonymous session. */ }
  return { loggedOut: true };
};

const normalizeSong = (song: ExternalJson): NeteaseSearchItem => ({
  id: Number(song?.id),
  name: String(song?.name || "未知曲目"),
  artist: (Array.isArray(song?.ar) ? song.ar : song?.artists || []).map((artist: ExternalJson) => artist?.name).filter(Boolean).join(" / ") || "未知艺术家",
  album: String(song?.al?.name || song?.album?.name || "未知专辑"),
  coverUrl: String(song?.al?.picUrl || song?.album?.picUrl || "").replace(/^http:/, "https:"),
  duration: Math.max(0, Number(song?.dt || song?.duration || 0) / 1000)
});

export const searchNetease = async (query: string, limit = 30): Promise<NeteaseSearchItem[]> => {
  const keywords = query.trim();
  if (!keywords) return [];
  const payload = await requestJson("cloudsearch", { keywords, limit: String(Math.max(1, Math.min(50, limit))), offset: "0" });
  const songs = Array.isArray(payload?.result?.songs) ? payload.result.songs : [];
  return songs.map(normalizeSong).filter((song: NeteaseSearchItem) => Number.isFinite(song.id));
};

export const getNeteasePlaylists = async (): Promise<NeteasePlaylistItem[]> => {
  const status = await getNeteaseLoginStatus();
  if (!status.loggedIn || !status.userId) throw new Error("请先登录网易云音乐");
  const payload = await requestJson("user_playlist", { uid: String(status.userId), limit: "100", offset: "0", timestamp: Date.now() });
  const playlists = Array.isArray(payload?.playlist) ? payload.playlist : [];
  return playlists.map((playlist: ExternalJson, index: number) => ({
    id: Number(playlist?.id),
    name: String(playlist?.name || "未命名歌单"),
    coverUrl: String(playlist?.coverImgUrl || "").replace(/^http:/, "https:"),
    trackCount: Math.max(0, Number(playlist?.trackCount || 0)),
    liked: index === 0 || Number(playlist?.specialType) === 5
  })).filter((playlist: NeteasePlaylistItem) => Number.isFinite(playlist.id));
};

export const getNeteasePlaylistTracks = async (id: number): Promise<NeteaseSearchItem[]> => {
  if (!Number.isFinite(id) || id <= 0) throw new Error("无效的网易云歌单 ID");
  const payload = await requestJson("playlist_track_all", { id: String(id), limit: "1000", offset: "0", timestamp: Date.now() });
  const songs = Array.isArray(payload?.songs) ? payload.songs : [];
  return songs.map(normalizeSong).filter((song: NeteaseSearchItem) => Number.isFinite(song.id));
};

export const resolveNeteaseStream = async (id: number): Promise<string> => {
  if (!Number.isFinite(id) || id <= 0) throw new Error("无效的网易云曲目 ID");
  await ensureNeteaseApi();
  const { main } = neteaseModules();
  let lastReason = "该曲目需要登录、会员权限，或受版权区域限制";
  // A device/account may not have access to the preferred quality. Falling
  // back here keeps a playable song playable instead of failing the track.
  for (const level of ["exhigh", "higher", "standard"]) {
    try {
      const response = await main.song_url_v1!({ id: String(id), level, cookie: apiCookie, randomCNIP: true, https: true });
      const payload = response?.body;
      const item = payload?.data?.[0];
      const url = typeof item?.url === "string" ? item.url.trim() : "";
      if (url) return url;
      lastReason = String(item?.message || item?.msg || lastReason);
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }
  // Older NetEase accounts/CDN regions can still support the legacy bitrate
  // endpoint when the level-based endpoint returns no URL.
  for (const br of [320000, 192000, 128000]) {
    try {
      const response = await main.song_url!({ id: String(id), br, cookie: apiCookie });
      const item = response?.body?.data?.[0];
      const url = typeof item?.url === "string" ? item.url.trim() : "";
      if (url) return url;
      lastReason = String(item?.message || item?.msg || lastReason);
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastReason);
};

export const createNeteaseTrackUrl = (id: number) => `auralis-netease://stream/${id}`;

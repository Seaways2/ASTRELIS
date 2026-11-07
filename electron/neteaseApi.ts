import nodeNet from "node:net";
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

// The enhanced API server imports its request module before its main module.
// On a clean Windows account that request module expects this token to exist
// already and otherwise crashes the entire Electron main process at require().
// Create the same empty bootstrap file that the package's main.js would create.
const anonymousTokenPath = path.join(os.tmpdir(), "anonymous_token");
if (!fs.existsSync(anonymousTokenPath)) fs.writeFileSync(anonymousTokenPath, "", "utf8");

const { serveNcmApi } = require("@neteasecloudmusicapienhanced/api/server") as {
  serveNcmApi(options: { port: number; host: string }): Promise<void>;
};
const { register_anonimous: registerAnonymous } = require("@neteasecloudmusicapienhanced/api/main") as {
  register_anonimous(options: Record<string, unknown>): Promise<{ body?: { cookie?: string } }>;
};
const { song_url_v1: getSongUrlV1, song_url: getSongUrl } = require("@neteasecloudmusicapienhanced/api/main") as {
  song_url_v1(options: Record<string, unknown>): Promise<{ status?: number; body?: any }>;
  song_url(options: Record<string, unknown>): Promise<{ status?: number; body?: any }>;
};
const generateNeteaseConfig = require("@neteasecloudmusicapienhanced/api/generateConfig") as () => Promise<void>;

let apiPort = 0;
let apiCookie = "";
let startup: Promise<number> | null = null;
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

const getFreePort = () => new Promise<number>((resolve, reject) => {
  const server = nodeNet.createServer();
  server.unref();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

export const ensureNeteaseApi = () => {
  if (apiPort) return Promise.resolve(apiPort);
  if (startup) return startup;
  startup = (async () => {
    const port = await getFreePort();
    try {
      // The enhanced API creates its XEAPI public key in the OS temp folder,
      // not inside node_modules. A development machine often has this cached;
      // a clean installation does not. Generate it before the first stream.
      await generateNeteaseConfig();
      if (apiCookie) {
        await serveNcmApi({ port, host: "127.0.0.1" });
        apiPort = port;
        return port;
      }
      const response = await registerAnonymous({});
      apiCookie = typeof response?.body?.cookie === "string" ? response.body.cookie : "";
    } catch {
      // Search works without a session; playback availability will report a
      // useful error if NetEase refuses an anonymous stream.
    }
    await serveNcmApi({ port, host: "127.0.0.1" });
    apiPort = port;
    return port;
  })().catch(error => {
    startup = null;
    throw error;
  });
  return startup;
};

const requestJson = async (route: string, includeCookie = true) => {
  const port = await ensureNeteaseApi();
  const cookieHeader = includeCookie && apiCookie
    ? normalizeNeteaseCookieHeader(apiCookie)
    : "";
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined
  });
  if (!response.ok) throw new Error(`网易云接口请求失败 (${response.status})`);
  return response.json() as Promise<any>;
};

export const createNeteaseQr = async () => {
  const timestamp = Date.now();
  const keyPayload = await requestJson(`/login/qr/key?timestamp=${timestamp}`, false);
  const key = String(keyPayload?.data?.unikey || keyPayload?.unikey || "");
  if (!key) throw new Error("网易云没有返回二维码登录密钥");
  const qrPayload = await requestJson(`/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true&timestamp=${timestamp}`, false);
  const qrImage = String(qrPayload?.data?.qrimg || qrPayload?.qrimg || "");
  const qrUrl = String(qrPayload?.data?.qrurl || qrPayload?.qrurl || "");
  if (!qrImage && !qrUrl) throw new Error("网易云没有返回登录二维码");
  return { key, qrImage, qrUrl };
};

export const checkNeteaseQr = async (key: string) => {
  const payload = await requestJson(`/login/qr/check?key=${encodeURIComponent(key)}&timestamp=${Date.now()}`, false);
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
    const payload = await requestJson(`/login/status?timestamp=${Date.now()}`);
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
  try { await requestJson(`/logout?timestamp=${Date.now()}`); } catch { /* Local cleanup must still complete. */ }
  apiCookie = "";
  if (sessionFile) {
    try { fs.unlinkSync(sessionFile); } catch { /* Missing session file is already logged out. */ }
  }
  try {
    const response = await registerAnonymous({});
    apiCookie = typeof response?.body?.cookie === "string" ? response.body.cookie : "";
  } catch { /* Search can still retry without an anonymous session. */ }
  return { loggedOut: true };
};

const normalizeSong = (song: any): NeteaseSearchItem => ({
  id: Number(song?.id),
  name: String(song?.name || "未知曲目"),
  artist: (Array.isArray(song?.ar) ? song.ar : song?.artists || []).map((artist: any) => artist?.name).filter(Boolean).join(" / ") || "未知艺术家",
  album: String(song?.al?.name || song?.album?.name || "未知专辑"),
  coverUrl: String(song?.al?.picUrl || song?.album?.picUrl || "").replace(/^http:/, "https:"),
  duration: Math.max(0, Number(song?.dt || song?.duration || 0) / 1000)
});

export const searchNetease = async (query: string, limit = 30): Promise<NeteaseSearchItem[]> => {
  const keywords = query.trim();
  if (!keywords) return [];
  const payload = await requestJson(`/cloudsearch?keywords=${encodeURIComponent(keywords)}&limit=${Math.max(1, Math.min(50, limit))}&offset=0`);
  const songs = Array.isArray(payload?.result?.songs) ? payload.result.songs : [];
  return songs.map(normalizeSong).filter((song: NeteaseSearchItem) => Number.isFinite(song.id));
};

export const getNeteasePlaylists = async (): Promise<NeteasePlaylistItem[]> => {
  const status = await getNeteaseLoginStatus();
  if (!status.loggedIn || !status.userId) throw new Error("请先登录网易云音乐");
  const payload = await requestJson(`/user/playlist?uid=${status.userId}&limit=100&offset=0&timestamp=${Date.now()}`);
  const playlists = Array.isArray(payload?.playlist) ? payload.playlist : [];
  return playlists.map((playlist: any, index: number) => ({
    id: Number(playlist?.id),
    name: String(playlist?.name || "未命名歌单"),
    coverUrl: String(playlist?.coverImgUrl || "").replace(/^http:/, "https:"),
    trackCount: Math.max(0, Number(playlist?.trackCount || 0)),
    liked: index === 0 || Number(playlist?.specialType) === 5
  })).filter((playlist: NeteasePlaylistItem) => Number.isFinite(playlist.id));
};

export const getNeteasePlaylistTracks = async (id: number): Promise<NeteaseSearchItem[]> => {
  if (!Number.isFinite(id) || id <= 0) throw new Error("无效的网易云歌单 ID");
  const payload = await requestJson(`/playlist/track/all?id=${id}&limit=1000&offset=0&timestamp=${Date.now()}`);
  const songs = Array.isArray(payload?.songs) ? payload.songs : [];
  return songs.map(normalizeSong).filter((song: NeteaseSearchItem) => Number.isFinite(song.id));
};

export const resolveNeteaseStream = async (id: number): Promise<string> => {
  if (!Number.isFinite(id) || id <= 0) throw new Error("无效的网易云曲目 ID");
  let lastReason = "该曲目需要登录、会员权限，或受版权区域限制";
  // A device/account may not have access to the preferred quality. Falling
  // back here keeps a playable song playable instead of failing the track.
  // Call the API module directly: the package's local Express route can return
  // 404 on some clean packaged installations even though the module is valid.
  for (const level of ["exhigh", "higher", "standard"]) {
    try {
      const response = await getSongUrlV1({ id: String(id), level, cookie: apiCookie, randomCNIP: true, https: true });
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
      const response = await getSongUrl({ id: String(id), br, cookie: apiCookie });
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

import { ipcMain } from "electron";
import {
  checkNeteaseQr,
  createNeteaseQr,
  createNeteaseTrackUrl,
  getNeteaseLoginStatus,
  getNeteasePlaylists,
  getNeteasePlaylistTracks,
  logoutNetease,
  resolveNeteaseStream,
  searchNetease
} from "../neteaseApi";

export interface NeteaseIpcDeps {
  writeLog(level: string, message: string): void;
}

export function registerNeteaseIpc({ writeLog }: NeteaseIpcDeps) {
  ipcMain.handle("netease:search", async (_, query: string) => {
    try {
      return { ok: true, songs: await searchNetease(String(query || "")) };
    } catch (error) {
      return { ok: false, songs: [], error: error instanceof Error ? error.message : "网易云搜索失败" };
    }
  });
  ipcMain.handle("netease:login-status", async () => getNeteaseLoginStatus());
  ipcMain.handle("netease:logout", async () => {
    try { return { ok: true, ...(await logoutNetease()) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "网易云退出登录失败" }; }
  });
  ipcMain.handle("netease:playlists", async () => {
    try { return { ok: true, playlists: await getNeteasePlaylists() }; }
    catch (error) { return { ok: false, playlists: [], error: error instanceof Error ? error.message : "网易云歌单加载失败" }; }
  });
  ipcMain.handle("netease:playlist-tracks", async (_, id: number) => {
    try { return { ok: true, songs: await getNeteasePlaylistTracks(Number(id)) }; }
    catch (error) { return { ok: false, songs: [], error: error instanceof Error ? error.message : "网易云歌单曲目加载失败" }; }
  });
  ipcMain.handle("netease:qr-create", async () => {
    try { return { ok: true, ...(await createNeteaseQr()) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : "二维码创建失败" }; }
  });
  ipcMain.handle("netease:qr-check", async (_, key: string) => {
    try { return { ok: true, ...(await checkNeteaseQr(String(key || ""))) }; }
    catch (error) { return { ok: false, code: 0, loggedIn: false, error: error instanceof Error ? error.message : "扫码状态检查失败" }; }
  });
  ipcMain.handle("netease:prepare", async (_, id: number) => {
    try {
      await resolveNeteaseStream(Number(id));
      writeLog("INFO", `NetEase prepare ${Number(id)}: ready`);
      return { ok: true, url: createNeteaseTrackUrl(Number(id)) };
    } catch (error) {
      writeLog("ERROR", `NetEase prepare ${Number(id)} failed: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, error: error instanceof Error ? error.message : "网易云曲目暂时无法播放" };
    }
  });
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { app, dialog, ipcMain, type BrowserWindow } from "electron";
import { mediaUrl } from "../mediaUrls";

export const customBackgroundExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);
export function customBackgroundDirectory() { return path.join(app.getPath("userData"), "custom-background"); }

export async function clearCustomBackgroundFiles(exceptPath?: string) {
  const directory = customBackgroundDirectory();
  let entries: fs.Dirent[] = [];
  try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
    const candidate = path.join(directory, entry.name);
    if (exceptPath && path.resolve(candidate) === path.resolve(exceptPath)) return;
    await fs.promises.rm(candidate, { force: true });
  }));
}

export interface AppearanceIpcDeps {
  getMainWindow(): BrowserWindow | null;
}

/** Custom player background: single image, image folder, and removal. */
export function registerAppearanceIpc({ getMainWindow }: AppearanceIpcDeps) {
  ipcMain.handle("appearance:background-choose", async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { ok: false, error: "播放器窗口尚未准备完成" };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择播放器背景图片",
      properties: ["openFile"],
      filters: [
        { name: "图片文件", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
        { name: "所有文件", extensions: ["*"] }
      ]
    });
    mainWindow.focus();
    mainWindow.webContents.focus();
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const sourcePath = path.resolve(result.filePaths[0]);
    const extension = path.extname(sourcePath).toLowerCase();
    if (!customBackgroundExtensions.has(extension)) return { ok: false, error: "请选择 PNG、JPG、WebP、BMP 或 GIF 图片" };
    let temporaryPath = "";
    try {
      const stat = await fs.promises.stat(sourcePath);
      if (!stat.isFile()) return { ok: false, error: "所选项目不是图片文件" };
      if (stat.size > 64 * 1024 * 1024) return { ok: false, error: "背景图片不能超过 64 MB" };
      const directory = customBackgroundDirectory();
      await fs.promises.mkdir(directory, { recursive: true });
      temporaryPath = path.join(directory, `.incoming-${crypto.randomUUID()}${extension}`);
      await fs.promises.copyFile(sourcePath, temporaryPath);
      await clearCustomBackgroundFiles(temporaryPath);
      const targetPath = path.join(directory, `background-${crypto.randomUUID()}${extension}`);
      await fs.promises.rename(temporaryPath, targetPath);
      return { ok: true, path: targetPath, url: mediaUrl(targetPath), name: path.basename(sourcePath) };
    } catch (error) {
      if (temporaryPath) await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
      return { ok: false, error: error instanceof Error ? error.message : "无法保存背景图片" };
    }
  });
  ipcMain.handle("appearance:background-folder", async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return {ok:false,error:"播放器尚未准备好"};
    const result = await dialog.showOpenDialog(mainWindow,{title:"选择背景图片文件夹",properties:["openDirectory"]});
    if(result.canceled || !result.filePaths[0]) return {ok:false,canceled:true};
    const folder=result.filePaths[0], directory=customBackgroundDirectory();
    const copied: {path:string;url:string}[]=[];
    try {
      const entries=(await fs.promises.readdir(folder,{withFileTypes:true})).filter(e=>e.isFile() && customBackgroundExtensions.has(path.extname(e.name).toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
      if(!entries.length) return {ok:false,error:"文件夹中没有支持的图片（不包含子文件夹）"};
      await fs.promises.mkdir(directory,{recursive:true});
      const previous=await fs.promises.readdir(directory,{withFileTypes:true});
      for(const entry of entries) {
        const source=path.join(folder,entry.name);
        const stat=await fs.promises.stat(source);
        if(stat.size>64*1024*1024) continue;
        const target=path.join(directory,`background-${crypto.randomUUID()}${path.extname(entry.name).toLowerCase()}`);
        copied.push({path:target,url:mediaUrl(target)});
        await fs.promises.copyFile(source,target);
      }
      if(!copied.length) return {ok:false,error:"图片均超过 64 MB，请选择较小的图片"};
      // Commit only after every new image has been copied; originals are untouched.
      await Promise.all(previous.filter(e=>e.isFile()).map(e=>fs.promises.rm(path.join(directory,e.name),{force:true}).catch(()=>undefined)));
      return {ok:true,images:copied,folder};
    } catch(error) {
      await Promise.all(copied.map(item=>fs.promises.rm(item.path,{force:true}).catch(()=>undefined)));
      return {ok:false,error:error instanceof Error ? error.message : "导入背景文件夹失败"};
    }
  });
  ipcMain.handle("appearance:background-remove", async () => {
    try {
      await clearCustomBackgroundFiles();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "无法删除背景图片" };
    }
  });
}

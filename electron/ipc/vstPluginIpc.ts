import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { LegacyDirectoryImportGate } from "../security/LegacyDirectoryImportGate";
import { isUncOrDevicePath } from "../security/PluginPathPolicy";
import { PluginQuarantineStore, PluginScanCache, writePluginScanLog } from "../pluginScanPersistence";
import {
  activePluginScans,
  getPluginDirectoryStore,
  pluginQuarantinePath,
  pluginScanCachePath,
  pluginScanLogPath,
  scanVstPlugins
} from "../pluginScanService";

export interface VstPluginIpcDeps {
  getMainWindow(): BrowserWindow | null;
}

/**
 * Plugin catalog scanning, quarantine and plugin-directory management. The
 * scanner loads every module in the listed directories, so only the player
 * page may drive it, and a new directory must come from the folder dialog.
 */
export function registerVstPluginIpc({ getMainWindow }: VstPluginIpcDeps) {
  const trusted = (event: IpcMainInvokeEvent) => {
    const window = getMainWindow();
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame);
  };
  /** Folders the user picked in vst:choose-folder; each may be added once. */
  const chosenDirectories = new Set<string>();
  const directoryKey = (directory: string) => path.resolve(directory).toLocaleLowerCase("en-US");
  ipcMain.handle("vst:scan", (event, retryFailures: boolean = false) => {
    if (!trusted(event)) return Promise.reject(new Error("UNTRUSTED_SENDER"));
    return scanVstPlugins(
      progress => event.sender.send("vst:scan-progress", progress),
      { retryFailures: Boolean(retryFailures) }
    );
  });
  ipcMain.handle("vst:scan-control", (event, action: "skip" | "disable", normalizedPath: string) => {
    if (!trusted(event)) return { ok: false };
    if ((action !== "skip" && action !== "disable") || typeof normalizedPath !== "string" || !normalizedPath)
      return { ok: false };
    const controller = activePluginScans.get(normalizedPath);
    if (!controller) return { ok: false };
    controller.abort(action);
    writePluginScanLog(pluginScanLogPath(), "manual", `scan_${action}`, { normalizedPath });
    return { ok: true };
  });
  ipcMain.handle("vst:quarantine-reset", (event, normalizedPath: string) => {
    if (!trusted(event) || typeof normalizedPath !== "string" || !normalizedPath) return { ok: false };
    const quarantine = new PluginQuarantineStore(pluginQuarantinePath());
    const cache = new PluginScanCache(pluginScanCachePath());
    quarantine.reset(normalizedPath);
    cache.deleteModule(normalizedPath);
    try { cache.save(); } catch { return { ok: false }; }
    writePluginScanLog(pluginScanLogPath(), "manual", "quarantine_reset", { normalizedPath });
    return { ok: true };
  });
  // Same file as getPluginDirectoryStore(); checked before anything can create it.
  const legacyImport = new LegacyDirectoryImportGate(path.join(app.getPath("userData"), "plugin-directories-v1.json"));
  ipcMain.handle("vst:directories", event => {
    if (!trusted(event)) return [];
    legacyImport.close();
    return getPluginDirectoryStore().list();
  });
  // One-time migration of folders the renderer stored before 2.x; network shares are not migrated.
  ipcMain.handle("vst:directory-import", (event, directories: string[]) => {
    if (!trusted(event) || !legacyImport.take()) return getPluginDirectoryStore().list();
    return getPluginDirectoryStore().importUserDirectories(Array.isArray(directories)
      ? directories.filter(directory => typeof directory === "string" && path.isAbsolute(directory) && !isUncOrDevicePath(directory))
      : []);
  });
  ipcMain.handle("vst:directory-add", (event, directoryPath: string) => {
    if (!trusted(event)) return { ok: false, error: "UNTRUSTED_SENDER" };
    if (typeof directoryPath !== "string" || !chosenDirectories.delete(directoryKey(directoryPath)))
      return { ok: false, error: "请通过“选择插件目录”添加插件目录" };
    try {
      return { ok: true, ...getPluginDirectoryStore().addUserDirectory(directoryPath) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "插件目录无效" };
    }
  });
  ipcMain.handle("vst:directory-remove", (event, id: string) => ({ ok: trusted(event) && getPluginDirectoryStore().removeDirectory(id) }));
  ipcMain.handle("vst:directory-enabled", (event, id: string, enabled: boolean) => ({
    ok: trusted(event) && getPluginDirectoryStore().setEnabled(id, Boolean(enabled))
  }));
  ipcMain.handle("vst:choose-folder", async event => {
    if (!trusted(event)) return null;
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: "选择插件目录",
      properties: ["openDirectory"]
    });
    const chosen = result.canceled ? null : result.filePaths[0] || null;
    if (chosen) chosenDirectories.add(directoryKey(chosen));
    return chosen;
  });
}

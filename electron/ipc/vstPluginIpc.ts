import { dialog, ipcMain, type BrowserWindow } from "electron";
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

/** Plugin catalog scanning, quarantine and plugin-directory management. */
export function registerVstPluginIpc({ getMainWindow }: VstPluginIpcDeps) {
  ipcMain.handle("vst:scan", (event, retryFailures: boolean = false) =>
    scanVstPlugins(
      progress => event.sender.send("vst:scan-progress", progress),
      { retryFailures: Boolean(retryFailures) }
    )
  );
  ipcMain.handle("vst:scan-control", (_, action: "skip" | "disable", normalizedPath: string) => {
    if ((action !== "skip" && action !== "disable") || typeof normalizedPath !== "string" || !normalizedPath)
      return { ok: false };
    const controller = activePluginScans.get(normalizedPath);
    if (!controller) return { ok: false };
    controller.abort(action);
    writePluginScanLog(pluginScanLogPath(), "manual", `scan_${action}`, { normalizedPath });
    return { ok: true };
  });
  ipcMain.handle("vst:quarantine-reset", (_, normalizedPath: string) => {
    if (typeof normalizedPath !== "string" || !normalizedPath) return { ok: false };
    const quarantine = new PluginQuarantineStore(pluginQuarantinePath());
    const cache = new PluginScanCache(pluginScanCachePath());
    quarantine.reset(normalizedPath);
    cache.deleteModule(normalizedPath);
    try { cache.save(); } catch { return { ok: false }; }
    writePluginScanLog(pluginScanLogPath(), "manual", "quarantine_reset", { normalizedPath });
    return { ok: true };
  });
  ipcMain.handle("vst:directories", () => getPluginDirectoryStore().list());
  ipcMain.handle("vst:directory-import", (_, directories: string[]) =>
    getPluginDirectoryStore().importUserDirectories(Array.isArray(directories) ? directories : [])
  );
  ipcMain.handle("vst:directory-add", (_, directoryPath: string) => {
    try {
      return { ok: true, ...getPluginDirectoryStore().addUserDirectory(directoryPath) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "插件目录无效" };
    }
  });
  ipcMain.handle("vst:directory-remove", (_, id: string) => ({ ok: getPluginDirectoryStore().removeDirectory(id) }));
  ipcMain.handle("vst:directory-enabled", (_, id: string, enabled: boolean) => ({
    ok: getPluginDirectoryStore().setEnabled(id, Boolean(enabled))
  }));
  ipcMain.handle("vst:choose-folder", async () => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: "选择插件目录",
      properties: ["openDirectory"]
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
}

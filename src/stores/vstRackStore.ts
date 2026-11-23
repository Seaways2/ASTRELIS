import { create } from "zustand";

export interface VstRackItem extends VstPluginInfo {
  enabled: boolean;
}

export const toNativeRackPayload = (rack: VstRackItem[]) => rack.map(item => ({
  id: item.formatSpecificPluginId,
  path: item.path,
  enabled: item.enabled
}));

const readJson = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || "") as T; }
  catch { return fallback; }
};

// Codes from the main process (electron/security/PluginPathPolicy.ts and the
// video rack checks) as source texts; the views translate them (tm).
const NATIVE_ERROR_TEXT = new Map([
  ["PLUGIN_NOT_IN_LIVE_CHAIN", "该插件尚未加载到实时处理链"],
  ["PLUGIN_NOT_SCANNED", "该插件尚未通过扫描，请先重新扫描插件"],
  ["PLUGIN_DISABLED", "该插件已被停用或隔离，请在插件列表中恢复后再使用"],
  ["INVALID_PLUGIN_RACK", "插件机架配置无效"],
  ["PLUGIN_PATH_INVALID", "插件路径无效，已拒绝加载"],
  ["PLUGIN_FORMAT_UNAVAILABLE", "该插件格式尚未提供可用的原生运行适配器"],
  ["VIDEO_RACK_INVALID", "视频插件机架配置无效"]
]);
const nativeErrorText = (error?: string) =>
  NATIVE_ERROR_TEXT.get(error?.trim().replace(/^Error:\s*/, "") || "") || error;

const resolveCatalog = (catalog: PluginScanResult): VstPluginInfo[] => {
  const modules = new Map(catalog.modules.map(module => [module.moduleFingerprint, module]));
  const resolved = catalog.descriptors.flatMap(descriptor => {
    const module = modules.get(descriptor.moduleFingerprint);
    if (!module) return [];
    return [{
      ...descriptor,
      id: descriptor.stablePluginUid,
      path: module.modulePath,
      manufacturer: descriptor.vendor,
      loadable: descriptor.compatibility.eligible,
      error: descriptor.compatibility.reasons.join(" / ")
        || (descriptor.scanFailure ? `${descriptor.scanFailure.code} / ${descriptor.scanFailure.stage}: ${descriptor.scanFailure.message}` : undefined)
    }];
  });
  // Multiple installations can expose the same stable class identity. Keep
  // one selectable descriptor while retaining every physical module in the
  // catalog returned by the main process.
  return [...new Map(resolved.map(plugin => [plugin.stablePluginUid, plugin])).values()];
};

const persistedRack = readJson<Array<Record<string, unknown>>>("auralis.vst.rack", []);
const cachedPlugins = readJson<VstPluginInfo[]>("auralis.vst.plugins", [])
  .filter(plugin => Boolean(plugin?.stablePluginUid && plugin?.formatSpecificPluginId && plugin?.moduleFingerprint));
const cachedRack = persistedRack
  .filter(item => Boolean(item.stablePluginUid && item.formatSpecificPluginId && item.moduleFingerprint && item.path))
  .map(item => item as unknown as VstRackItem);
if (!localStorage.getItem("auralis.vst.videoRack")) localStorage.setItem("auralis.vst.videoRack", JSON.stringify(cachedRack));
const initialLowPerformanceMode = readJson<{ lowPerformanceMode?: boolean }>("auralis.ui.settings", {}).lowPerformanceMode === true;
const preferredNativeEnabled = localStorage.getItem("auralis.vst.enabled") === "true";

let errorTimer = 0;
let scanProgressConnected = false;
let rackMigrationComplete = cachedRack.length > 0 || persistedRack.length === 0;

interface VstRackState {
  plugins: VstPluginInfo[];
  rack: VstRackItem[];
  videoRack: VstRackItem[];
  directories: PluginDirectoryInfo[];
  quarantines: PluginQuarantineInfo[];
  scanSession: PluginScanSessionSummary | null;
  scanning: boolean;
  initialized: boolean;
  error: string;
  scanProgress: VstScanProgress;
  engine: VstEngineStatus;
  nativeEnabled: boolean;
  performanceSuspended: boolean;
  runtimeReady: boolean;
  initialize(forVideo?: boolean): Promise<void>;
  scan(retryFailures?: boolean, synchronizeNative?: boolean): Promise<void>;
  controlScan(action: "skip" | "disable"): Promise<void>;
  retryQuarantined(normalizedPath: string): Promise<void>;
  addFolder(): Promise<void>;
  removeFolder(id: string): Promise<void>;
  setFolderEnabled(id: string, enabled: boolean): Promise<void>;
  addToRack(plugin: VstPluginInfo): void;
  toggleRackItem(id: string): void;
  removeFromRack(id: string, confirmRemoval?: boolean): Promise<void>;
  moveRackItem(index: number, direction: -1 | 1): void;
  reorderRack(from: number, to: number): void;
  updateVideoRack(updater: (rack: VstRackItem[]) => VstRackItem[], removedId?: string): Promise<boolean>;
  openEditor(item: VstRackItem): Promise<void>;
  setPerformanceSuspended(suspended: boolean): Promise<void>;
  toggleNativeEngine(): Promise<void>;
  markNativeUnavailable(message?: string): void;
  clearError(): void;
}

export const useVstRackStore = create<VstRackState>((set, get) => {
  let editorOpening = false;
  let videoRackQueue: Promise<unknown> = Promise.resolve();
  const reportError = (message: string) => {
    window.clearTimeout(errorTimer);
    set({ error: message });
    errorTimer = window.setTimeout(() => set({ error: "" }), 4500);
  };

  const persistRack = (rack: VstRackItem[]) => {
    localStorage.setItem("auralis.vst.rack", JSON.stringify(rack));
    window.dispatchEvent(new CustomEvent("auralis:vst-rack", { detail: rack }));
  };

  const nativeRackPayload = () => toNativeRackPayload(get().rack);

  // PLUGIN_NOT_SCANNED: a rack module changed on disk since its scan (an
  // update, say), so the main process refuses it. One rescan brings the
  // catalog and the rack up to date and applies the rack again; a refusal
  // after that is reported. Returns whether it rescanned. A changed module
  // misses the cache and is probed again anyway, so the rescan does not retry
  // quarantined modules: those crashed or hung the scanner and are retried
  // only when the user asks (Rescan).
  let rescanningUnscanned = false;
  const rescanUnscannedPlugins = async () => {
    if (rescanningUnscanned || !window.desktop?.vst) return false;
    rescanningUnscanned = true;
    try { await get().scan(false, true); return true; }
    finally { rescanningUnscanned = false; }
  };

  const syncNativeRack = async () => {
    if (!window.desktop?.nativeAudio) return;
    const plugins = get().nativeEnabled && !get().performanceSuspended ? nativeRackPayload() : [];
    const response = await window.desktop.nativeAudio.command({ type: "rack", plugins });
    // The rescan synchronises the rack itself; that attempt is the retry.
    if (!response?.ok && response?.error === "PLUGIN_NOT_SCANNED" && await rescanUnscannedPlugins()) return;
    set({ runtimeReady: Boolean(response?.ok) });
    if (!response?.ok) reportError(nativeErrorText(response?.error) || "插件链加载失败");
  };

  const updateRack = (updater: (rack: VstRackItem[]) => VstRackItem[], synchronize = true) => {
    const next = updater(get().rack);
    set({ rack: next });
    persistRack(next);
    return synchronize ? syncNativeRack() : Promise.resolve();
  };

  const migrateRack = (source: Array<Record<string, unknown>> | VstRackItem[], plugins: VstPluginInfo[]) => {
    const byStableUid = new Map(plugins.map(plugin => [plugin.stablePluginUid, plugin]));
    const byFormatId = new Map(plugins.map(plugin => [plugin.formatSpecificPluginId, plugin]));
    const migrated: VstRackItem[] = [];
    for (const entry of source) {
      const stableUid = typeof entry.stablePluginUid === "string" ? entry.stablePluginUid : "";
      const legacyId = typeof entry.formatSpecificPluginId === "string"
        ? entry.formatSpecificPluginId
        : typeof entry.id === "string" ? entry.id : "";
      const plugin = byStableUid.get(stableUid) || byFormatId.get(legacyId);
      if (!plugin || !plugin.loadable) continue;
      if (migrated.some(item => item.stablePluginUid === plugin.stablePluginUid)) continue;
      migrated.push({ ...plugin, enabled: entry.enabled !== false });
    }
    return migrated;
  };

  return {
    plugins: cachedPlugins,
    rack: cachedRack,
    videoRack: readJson<VstRackItem[]>("auralis.vst.videoRack", cachedRack.map(item => ({ ...item }))),
    directories: [],
    quarantines: [],
    scanSession: null,
    scanning: false,
    initialized: false,
    error: "",
    scanProgress: { phase: "discovering", completed: 0, total: 0, current: "准备扫描" },
    engine: { available: false, backend: "CHECKING", detail: "正在检测原生宿主…" },
    nativeEnabled: preferredNativeEnabled && !initialLowPerformanceMode,
    performanceSuspended: initialLowPerformanceMode,
    runtimeReady: false,

    initialize: async (forVideo = false) => {
      if (get().initialized || get().performanceSuspended) return;
      set({ initialized: true });
      if (!window.desktop?.vst) return;
      if (!scanProgressConnected) {
        scanProgressConnected = true;
        window.desktop.vst.onScanProgress(progress => set(state => ({
          scanProgress: progress.phase === "scanning"
            ? { ...state.scanProgress, ...progress }
            : { ...progress, modulePath: undefined, normalizedPath: undefined }
        })));
      }
      const legacyFolders = readJson<string[]>("auralis.vst.folders", []);
      if (legacyFolders.length) {
        await window.desktop.vst.importDirectories(legacyFolders);
        localStorage.removeItem("auralis.vst.folders");
      }
      const [engine, directories] = await Promise.all([
        window.desktop.vst.engineStatus(),
        window.desktop.vst.directories()
      ]);
      set({ engine, directories });
      await get().scan(false, !forVideo);
    },

    scan: async (retryFailures = true, synchronizeNative = true) => {
      if (!window.desktop?.vst) return;
      set({ scanning: true, error: "" });
      try {
        const catalog = await window.desktop.vst.scan(retryFailures);
        const plugins = resolveCatalog(catalog);
        localStorage.setItem("auralis.vst.plugins", JSON.stringify(plugins));
        const rackSource = rackMigrationComplete ? get().rack : persistedRack;
        // Video already owns the live Native rack. Refresh the catalog without
        // remapping its active slots until the ordinary music route resumes.
        const nextRack = synchronizeNative ? migrateRack(rackSource, plugins) : get().rack;
        if (synchronizeNative) rackMigrationComplete = true;
        set({
          plugins,
          rack: nextRack,
          directories: catalog.directories,
          quarantines: catalog.quarantines,
          scanSession: catalog.session
        });
        if (synchronizeNative) persistRack(nextRack);
        if (synchronizeNative) await syncNativeRack();
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : "插件扫描失败");
      } finally {
        set({ scanning: false });
      }
    },

    controlScan: async action => {
      const normalizedPath = get().scanProgress.normalizedPath;
      if (!get().scanning || !normalizedPath) return;
      const result = await window.desktop?.vst.controlScan(action, normalizedPath);
      if (!result?.ok) reportError("当前插件已经完成，无法执行此操作");
    },

    retryQuarantined: async normalizedPath => {
      const result = await window.desktop?.vst.resetQuarantine(normalizedPath);
      if (!result?.ok) { reportError("无法重置插件隔离状态"); return; }
      await get().scan(false);
    },

    addFolder: async () => {
      const folder = await window.desktop?.vst.chooseFolder();
      if (!folder) return;
      const result = await window.desktop?.vst.addDirectory(folder);
      if (!result?.ok) { reportError(result?.error || "无法添加插件目录"); return; }
      await get().scan(false);
    },

    removeFolder: async id => {
      const result = await window.desktop?.vst.removeDirectory(id);
      if (!result?.ok) { reportError("标准插件目录不能删除"); return; }
      await get().scan(false);
    },

    setFolderEnabled: async (id, enabled) => {
      const result = await window.desktop?.vst.setDirectoryEnabled(id, enabled);
      if (!result?.ok) { reportError("插件目录状态保存失败"); return; }
      await get().scan(false);
    },

    addToRack: plugin => {
      if (!plugin.loadable || get().rack.some(item => item.stablePluginUid === plugin.stablePluginUid)) return;
      updateRack(rack => [...rack, { ...plugin, enabled: true }]);
    },

    toggleRackItem: id => updateRack(rack => rack.map(item => item.id === id ? { ...item, enabled: !item.enabled } : item)),

    removeFromRack: async (id, confirmRemoval = true) => {
      const item = get().rack.find(entry => entry.id === id);
      if (!item) return;
      if (confirmRemoval) {
        const confirmed = window.desktop?.confirmPluginRemoval
          ? await window.desktop.confirmPluginRemoval(item.name)
          : window.confirm(`从机架中移除“${item.name}”？\n\n删除后会同时清除该插件的参数记忆；以后重新添加时将从插件默认状态开始。`);
        if (!confirmed) return;
      }
      try {
        await updateRack(rack => rack.filter(entry => entry.id !== id), false);
        const cleared = await window.desktop?.nativeAudio.command({
          type: "state-remove",
          id: item.formatSpecificPluginId,
          plugins: nativeRackPayload()
        });
        if (cleared && !cleared.ok) reportError(nativeErrorText(cleared.error) || "插件参数记忆清除失败");
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : "插件参数记忆清除失败");
      }
    },

    moveRackItem: (index, direction) => {
      const target = index + direction;
      if (target < 0 || target >= get().rack.length) return;
      get().reorderRack(index, target);
    },

    reorderRack: (from, to) => {
      if (from === to || from < 0 || to < 0 || from >= get().rack.length || to >= get().rack.length) return;
      updateRack(rack => {
        const next = [...rack];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },

    updateVideoRack: (updater, removedId) => {
      const task = videoRackQueue.catch(() => undefined).then(async () => {
        const next = updater(get().videoRack);
        if (next.length > 32 || new Set(next.map(item => item.formatSpecificPluginId)).size !== next.length) {
          reportError("视频插件机架配置无效");
          return false;
        }
        const response = await window.desktop?.video.control("rack", JSON.stringify({ plugins: toNativeRackPayload(next), removedId }));
        if (!response?.ok) {
          reportError(nativeErrorText(response?.error) || "视频插件机架更新失败");
          return false;
        }
        set({ videoRack: next });
        localStorage.setItem("auralis.vst.videoRack", JSON.stringify(next));
        return true;
      });
      videoRackQueue = task;
      return task;
    },

    openEditor: async item => {
      if (editorOpening) return;
      editorOpening = true;
      set({ error: "" });
      try {
      if (get().nativeEnabled && !get().performanceSuspended) {
        const synced = await window.desktop?.nativeAudio.command({ type: "rack", plugins: nativeRackPayload() });
        // A rescan applies the rack again (and reports a second refusal).
        const rescued = !synced?.ok && synced?.error === "PLUGIN_NOT_SCANNED"
          && await rescanUnscannedPlugins() && get().runtimeReady;
        if (!synced?.ok && !rescued) {
          set({ runtimeReady: false });
          reportError(nativeErrorText(synced?.error) || "插件链同步失败");
          return;
        }
        set({ runtimeReady: true });
        const result = await window.desktop?.nativeAudio.command({ type: "editor", id: item.formatSpecificPluginId });
        if (result && !result.ok) reportError(nativeErrorText(result.error) || "插件编辑器启动失败");
        return;
      }
      const openStandalone = () => window.desktop?.vst.openEditor(item.path, item.formatSpecificPluginId);
      let result = await openStandalone();
      // Main sends PLUGIN_NOT_SCANNED as its text: a changed module gets one
      // rescan, then the editor is opened again.
      if (result && !result.ok && nativeErrorText(result.error) === NATIVE_ERROR_TEXT.get("PLUGIN_NOT_SCANNED")
        && await rescanUnscannedPlugins()) result = await openStandalone();
      if (result && !result.ok) reportError(nativeErrorText(result.error) || "插件编辑器启动失败");
      } catch (reason) { reportError(reason instanceof Error ? reason.message : "插件编辑器启动失败"); }
      finally { editorOpening = false; }
    },

    setPerformanceSuspended: async suspended => {
      if (get().performanceSuspended === suspended && !suspended) return;
      if (suspended) {
        const response = await window.desktop?.nativeAudio.command({ type: "rack", plugins: [] });
        if (response && !response.ok) reportError(response.error || "低性能模式无法旁路 VST 插件链");
        set({ performanceSuspended: true, nativeEnabled: false, runtimeReady: false });
        window.dispatchEvent(new CustomEvent("auralis:vst-enabled", { detail: false }));
        return;
      }

      const shouldRestore = localStorage.getItem("auralis.vst.enabled") === "true";
      set({ performanceSuspended: false, nativeEnabled: false, runtimeReady: false });
      await get().initialize();
      if (!shouldRestore) {
        return;
      }
      set({ performanceSuspended: false, nativeEnabled: true, runtimeReady: false });
      window.dispatchEvent(new CustomEvent("auralis:vst-enabled", { detail: true }));
      await syncNativeRack();
    },

    toggleNativeEngine: async () => {
      if (get().performanceSuspended) {
        reportError("全局低性能模式已暂停 VST 音频处理");
        return;
      }
      const nativeEnabled = !get().nativeEnabled;
      localStorage.setItem("auralis.vst.enabled", String(nativeEnabled));
      set({ nativeEnabled, runtimeReady: false });
      window.dispatchEvent(new CustomEvent("auralis:vst-enabled", { detail: nativeEnabled }));
      await syncNativeRack();
    },

    markNativeUnavailable: message => {
      set({ runtimeReady: false });
      if (message) reportError(message);
    },

    clearError: () => {
      window.clearTimeout(errorTimer);
      set({ error: "" });
    }
  };
});

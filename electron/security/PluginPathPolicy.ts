import fs from "node:fs";
import path from "node:path";
import { createPluginModule } from "../pluginDomain";
import { pluginFormatAdapterForPath } from "../pluginFormatAdapters";
import { PluginQuarantineStore, PluginScanCache } from "../pluginScanPersistence";

/** \\server\share, \\?\UNC\..., \\.\device and //server forms. */
export function isUncOrDevicePath(value: string) {
  return /^[\\/]{2}/.test(value);
}

export interface PluginRackEntry {
  id: string;
  path: string;
  enabled: boolean;
}

/**
 * The renderer names plugin modules by path, and the unsandboxed native host
 * loads whatever it is given. Only modules that the scanner (a separate,
 * disposable process) has already loaded successfully, that have not changed
 * on disk since, and that are neither disabled nor quarantined may reach the
 * playback engine or the editor host.
 */
export class ScannedPluginPolicy {
  constructor(private readonly cachePath: () => string, private readonly quarantinePath: () => string) {}

  /** Undefined when the module may be loaded, otherwise the reason it may not. */
  check(pluginPath: unknown) {
    return this.checkWith(pluginPath, new PluginScanCache(this.cachePath()), new PluginQuarantineStore(this.quarantinePath()));
  }

  /**
   * Validates a rack payload: at most 32 distinct plugins, each enabled one a
   * scanned module. The native host skips disabled entries (loadRack), so a
   * switched-off plugin that was uninstalled or quarantined since must not
   * make the whole rack, and with it video playback, fail.
   */
  checkRack(plugins: unknown): string | undefined {
    if (!Array.isArray(plugins) || plugins.length > 32) return "INVALID_PLUGIN_RACK";
    const ids = new Set<string>();
    for (const plugin of plugins as Partial<PluginRackEntry>[]) {
      if (!plugin || typeof plugin.id !== "string" || !plugin.id || plugin.id.length > 4096
        || typeof plugin.enabled !== "boolean" || ids.has(plugin.id)) return "INVALID_PLUGIN_RACK";
      ids.add(plugin.id);
    }
    if (!plugins.length) return undefined;
    const cache = new PluginScanCache(this.cachePath()), quarantine = new PluginQuarantineStore(this.quarantinePath());
    for (const plugin of plugins as PluginRackEntry[]) {
      if (!plugin.enabled) continue;
      const rejected = this.checkWith(plugin.path, cache, quarantine);
      if (rejected) return rejected;
    }
    return undefined;
  }

  private checkWith(pluginPath: unknown, cache: PluginScanCache, quarantine: PluginQuarantineStore) {
    if (typeof pluginPath !== "string" || !pluginPath || pluginPath.length > 4096 || pluginPath.includes("\0")
      || !path.isAbsolute(pluginPath) || isUncOrDevicePath(pluginPath)) return "PLUGIN_PATH_INVALID";
    if (!pluginFormatAdapterForPath(pluginPath)?.runtimeAvailable) return "PLUGIN_FORMAT_UNAVAILABLE";
    let stat: fs.Stats;
    try { stat = fs.statSync(pluginPath); }
    catch { return "PLUGIN_NOT_SCANNED"; }
    const module = createPluginModule(path.normalize(pluginPath), stat.size, stat.mtimeMs);
    if (!cache.getModule(module)) return "PLUGIN_NOT_SCANNED";
    const record = quarantine.get(module.normalizedPath);
    if (record?.userDisabled || record?.quarantined) return "PLUGIN_DISABLED";
    return undefined;
  }
}

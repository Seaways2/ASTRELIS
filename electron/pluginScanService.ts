import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { app } from "electron";
import {
  AURALIS_COMPATIBILITY_POLICY_VERSION,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  PLUGIN_PROBE_VERSION,
  PLUGIN_SCANNER_PROTOCOL_VERSION,
  createPluginDescriptor,
  createPluginModule,
  normalizeModulePath,
  type PluginDescriptor,
  type PluginModule,
  type PluginScanResult,
  type ScannerFailure
} from "./pluginDomain";
import { PluginDirectoryStore, type DirectoryScanOutcome } from "./pluginDirectories";
import { inspectPluginModule } from "./pluginScannerProtocol";
import { discoverablePluginFormatAdapterForPath, pluginFormatAdapters } from "./pluginFormatAdapters";
import { PluginQuarantineStore, PluginScanCache, writePluginScanLog } from "./pluginScanPersistence";

interface DirectoryDiscovery {
  normalizedPath: string;
  candidates: string[];
  state: "ready" | "missing" | "access-denied" | "no-candidate-modules" | "scanner-error";
  message?: string;
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String((error as NodeJS.ErrnoException).code || "") : "";
}

async function discoverPluginDirectory(directoryPath: string, normalizedPath: string): Promise<DirectoryDiscovery> {
  try {
    const stat = await fs.promises.stat(directoryPath);
    if (!stat.isDirectory()) return { normalizedPath, candidates: [], state: "missing", message: "路径不是文件夹" };
  } catch (error) {
    const code = errorCode(error);
    return {
      normalizedPath,
      candidates: [],
      state: code === "EACCES" || code === "EPERM" ? "access-denied" : "missing",
      message: code || "目录不可用"
    };
  }

  const candidates: string[] = [];
  let nestedFailure = "";
  const visit = async (current: string): Promise<void> => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); }
    catch (error) { nestedFailure ||= errorCode(error) || "目录读取失败"; return; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const lower = entry.name.toLocaleLowerCase("en-US");
      const formatAdapter = discoverablePluginFormatAdapterForPath(fullPath);
      if (formatAdapter && (entry.isFile() || lower.endsWith(".vst3"))) {
        candidates.push(fullPath);
        continue;
      }
      if (entry.isDirectory()) await visit(fullPath);
    }
  };
  await visit(directoryPath);
  if (!candidates.length) {
    return nestedFailure
      ? { normalizedPath, candidates, state: "scanner-error", message: nestedFailure }
      : { normalizedPath, candidates, state: "no-candidate-modules" };
  }
  return { normalizedPath, candidates, state: "ready", ...(nestedFailure ? { message: nestedFailure } : {}) };
}

export function nativePluginHostPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "native-host", "AuralisPluginHost.exe")
    : path.join(__dirname, "../native-host/build/AuralisPluginHost_artefacts/Release/AuralisPluginHost.exe");
}

export interface VstScanProgress {
  phase: "discovering" | "cache" | "scanning" | "complete";
  completed: number;
  total: number;
  current: string;
  modulePath?: string;
  normalizedPath?: string;
}
export function pluginScanCachePath() { return path.join(app.getPath("userData"), "plugin-scan-cache-v1.json"); }
export function pluginQuarantinePath() { return path.join(app.getPath("userData"), "plugin-quarantine-v1.json"); }
export function pluginScanLogPath() { return path.join(app.getPath("userData"), "logs", "plugin-scans.jsonl"); }

function standardPluginDirectories() {
  return pluginFormatAdapters.flatMap(adapter => adapter.discoverForDiagnostics
    ? adapter.standardDirectories(process.env) : []);
}

let pluginDirectoryStore: PluginDirectoryStore | undefined;
export const activePluginScans = new Map<string, AbortController>();
export function getPluginDirectoryStore() {
  pluginDirectoryStore ??= new PluginDirectoryStore(
    path.join(app.getPath("userData"), "plugin-directories-v1.json"),
    standardPluginDirectories()
  );
  return pluginDirectoryStore;
}

export async function scanVstPlugins(
  onProgress?: (progress: VstScanProgress) => void,
  options: { retryFailures?: boolean } = {}
): Promise<PluginScanResult> {
  const sessionId = crypto.randomUUID();
  const startedAt = new Date();
  const startedMs = Date.now();
  const log = (event: string, data: Record<string, unknown> = {}) =>
    writePluginScanLog(pluginScanLogPath(), sessionId, event, data);
  log("session_start", {
    catalogSchemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    scannerProtocolVersion: PLUGIN_SCANNER_PROTOCOL_VERSION,
    probeVersion: PLUGIN_PROBE_VERSION,
    compatibilityPolicyVersion: AURALIS_COMPATIBILITY_POLICY_VERSION
  });

  const directoryStore = getPluginDirectoryStore();
  const directories = directoryStore.list().filter(directory => directory.enabled);
  const discoveries: DirectoryDiscovery[] = [];
  const candidatePaths = new Map<string, string>();
  const directoryCandidates = new Map<string, Set<string>>();
  for (const directory of directories) {
    onProgress?.({ phase: "discovering", completed: candidatePaths.size, total: 0, current: directory.path });
    const discovery = await discoverPluginDirectory(directory.path, directory.normalizedPath);
    discoveries.push(discovery);
    log("directory", {
      path: directory.path,
      normalizedPath: directory.normalizedPath,
      state: discovery.state,
      candidateModules: discovery.candidates.length,
      message: discovery.message || ""
    });
    const keys = new Set<string>();
    for (const candidate of discovery.candidates) {
      const key = normalizeModulePath(candidate);
      candidatePaths.set(key, path.normalize(path.resolve(candidate)));
      keys.add(key);
    }
    directoryCandidates.set(directory.normalizedPath, keys);
  }
  const modules: PluginModule[] = [];
  const descriptors: PluginDescriptor[] = [];
  const cache = new PluginScanCache(pluginScanCachePath());
  const quarantineStore = new PluginQuarantineStore(pluginQuarantinePath());
  const pending: PluginModule[] = [];
  const scannerFailures = new Map<string, ScannerFailure[]>();
  const enumeratedModules = new Set<string>();
  let moduleCacheHits = 0;
  let pluginCacheHits = 0;
  let completed = 0;
  onProgress?.({ phase: "cache", completed, total: candidatePaths.size, current: "读取模块、插件与隔离缓存" });
  for (const [key, file] of candidatePaths) {
    let stat: fs.Stats;
    try { stat = await fs.promises.stat(file); }
    catch (error) {
      scannerFailures.set(key, [{
        code: "ENUMERATION_FAILED", stage: "MODULE_LOAD", modulePath: file,
        message: errorCode(error) || "无法读取插件模块状态", elapsedMs: 0
      }]);
      log("module_stat_failed", { modulePath: file, error: errorCode(error) || "MODULE_STAT_FAILED" });
      continue;
    }
    const module = createPluginModule(file, stat.size, stat.mtimeMs);
    modules.push(module);
    const quarantine = quarantineStore.get(module.normalizedPath);
    if (quarantine && (quarantine.userDisabled || !options.retryFailures)) {
      const skippedFailure: ScannerFailure = {
        code: quarantine.userDisabled ? "USER_DISABLED" : "QUARANTINED",
        stage: quarantine.lastFailureStage,
        modulePath: module.modulePath,
        message: quarantine.userDisabled
          ? "插件已由用户禁用；解除禁用后才会重新扫描"
          : `插件上次扫描失败（${quarantine.lastFailureCode}），本次启动已自动跳过；点击重新扫描可再次尝试`,
        elapsedMs: 0
      };
      scannerFailures.set(module.normalizedPath, [skippedFailure]);
      log(quarantine.userDisabled ? "module_user_disabled_skip" : "module_previous_failure_skip", {
        ...quarantine, moduleFingerprint: module.moduleFingerprint
      });
      completed++;
      continue;
    }
    if (module.format === "VST2") {
      const record = {
        id: module.normalizedPath,
        name: path.basename(file, ".dll"),
        path: file,
        format: "VST2" as const,
        category: "Legacy plugin",
        loadable: false,
        policyRejectionReason: "FORMAT_NOT_AVAILABLE",
        error: "VST2 SDK compatibility layer is not installed"
      };
      const descriptor = createPluginDescriptor(module, record);
      descriptors.push(descriptor);
      cache.putSuccessfulModule(module, [record], [descriptor]);
      enumeratedModules.add(module.normalizedPath);
      log("plugin_result", {
        modulePath: module.modulePath,
        moduleFingerprint: module.moduleFingerprint,
        pluginId: descriptor.formatSpecificPluginId,
        name: descriptor.name,
        vendor: descriptor.vendor,
        catalogState: descriptor.catalogState,
        eligible: descriptor.compatibility.eligible,
        policyReasons: descriptor.compatibility.reasons
      });
      completed++;
      continue;
    }
    const cachedModule = cache.getModule(module);
    if (cachedModule) {
      const cachedDescriptors = cachedModule.records.map(record => cache.getPlugin(module.moduleFingerprint, record.id));
      const policyVersionsCurrent = cachedModule.records.every(record =>
        record.compatibility?.probeVersion === PLUGIN_PROBE_VERSION
        && record.compatibility?.policyVersion === AURALIS_COMPATIBILITY_POLICY_VERSION);
      if (cachedDescriptors.every((descriptor): descriptor is PluginDescriptor => Boolean(descriptor))) {
        Object.assign(module, {
          scannerProtocolVersion: cachedModule.module.scannerProtocolVersion,
          scanElapsedMs: cachedModule.module.scanElapsedMs,
          lastScanStage: cachedModule.module.lastScanStage
        });
        descriptors.push(...cachedDescriptors);
        moduleCacheHits++;
        pluginCacheHits += cachedDescriptors.length;
        enumeratedModules.add(module.normalizedPath);
        completed++;
        log("module_cache_hit", { modulePath: module.modulePath, moduleFingerprint: module.moduleFingerprint, pluginCacheHits: cachedDescriptors.length });
        for (const descriptor of cachedDescriptors) log("plugin_cache_hit", {
          modulePath: module.modulePath,
          moduleFingerprint: module.moduleFingerprint,
          pluginId: descriptor.formatSpecificPluginId,
          name: descriptor.name,
          vendor: descriptor.vendor,
          busCapabilities: descriptor.capabilities,
          catalogState: descriptor.catalogState,
          eligible: descriptor.compatibility.eligible,
          policyReasons: descriptor.compatibility.reasons
        });
        continue;
      }
      if (policyVersionsCurrent) {
        const rebuilt = cachedModule.records.map(record => createPluginDescriptor(module, record));
        descriptors.push(...rebuilt);
        cache.putSuccessfulModule(module, cachedModule.records, rebuilt);
        moduleCacheHits++;
        enumeratedModules.add(module.normalizedPath);
        completed++;
        log("module_cache_hit_plugin_cache_rebuilt", { modulePath: module.modulePath, moduleFingerprint: module.moduleFingerprint, descriptors: rebuilt.length });
        for (const descriptor of rebuilt) log("plugin_cache_rebuilt", {
          modulePath: module.modulePath,
          moduleFingerprint: module.moduleFingerprint,
          pluginId: descriptor.formatSpecificPluginId,
          name: descriptor.name,
          vendor: descriptor.vendor,
          catalogState: descriptor.catalogState,
          eligible: descriptor.compatibility.eligible,
          policyReasons: descriptor.compatibility.reasons
        });
        continue;
      }
      log("module_cache_policy_miss", {
        modulePath: module.modulePath,
        moduleFingerprint: module.moduleFingerprint,
        expectedProbeVersion: PLUGIN_PROBE_VERSION,
        expectedPolicyVersion: AURALIS_COMPATIBILITY_POLICY_VERSION
      });
    } else log("module_cache_miss", { modulePath: module.modulePath, moduleFingerprint: module.moduleFingerprint });
    pending.push(module);
  }
  onProgress?.({ phase: "cache", completed, total: candidatePaths.size, current: `${moduleCacheHits} 个模块缓存命中` });
  for (let index = 0; index < pending.length; index += 4) {
    const group = pending.slice(index, index + 4);
    const inspected = await Promise.all(group.map(async module => {
      const controller = new AbortController();
      activePluginScans.set(module.normalizedPath, controller);
      onProgress?.({
        phase: "scanning", completed, total: candidatePaths.size, current: path.basename(module.modulePath),
        modulePath: module.modulePath, normalizedPath: module.normalizedPath
      });
      log("module_scan_start", { modulePath: module.modulePath, moduleFingerprint: module.moduleFingerprint, format: module.format });
      const inspectedModule = await inspectPluginModule(nativePluginHostPath(), module.modulePath, (stage, elapsedMs) => {
        onProgress?.({
          phase: "scanning", completed, total: candidatePaths.size,
          current: `${path.basename(module.modulePath)} · ${stage} · ${Math.round(elapsedMs)} ms`,
          modulePath: module.modulePath, normalizedPath: module.normalizedPath
        });
      }, controller.signal).finally(() => {
        if (activePluginScans.get(module.normalizedPath) === controller) activePluginScans.delete(module.normalizedPath);
      });
      module.scannerProtocolVersion = inspectedModule.protocolVersion;
      module.scanElapsedMs = inspectedModule.elapsedMs;
      module.lastScanStage = inspectedModule.lastStage;
      if (inspectedModule.failures.length) {
        scannerFailures.set(module.normalizedPath, inspectedModule.failures);
        cache.deleteModule(module.normalizedPath);
        const firstFailure = inspectedModule.failures[0];
        const health = firstFailure.code === "USER_SKIPPED"
          ? undefined
          : firstFailure.code === "USER_DISABLED"
            ? quarantineStore.disable(module, firstFailure)
            : quarantineStore.recordFailure(module, firstFailure);
        log("module_scan_failed", {
          modulePath: module.modulePath,
          moduleFingerprint: module.moduleFingerprint,
          stage: inspectedModule.lastStage,
          elapsedMs: inspectedModule.elapsedMs,
          failures: inspectedModule.failures,
          stderrSummary: inspectedModule.stderrSummary,
          quarantine: health
        });
      } else {
        quarantineStore.recordSuccess(module.normalizedPath);
        enumeratedModules.add(module.normalizedPath);
      }
      const found = inspectedModule.records.map(record => createPluginDescriptor(module, record));
      if (!inspectedModule.failures.length) cache.putSuccessfulModule(module, inspectedModule.records, found);
      for (const descriptor of found) log("plugin_result", {
        modulePath: module.modulePath,
        moduleFingerprint: module.moduleFingerprint,
        pluginId: descriptor.formatSpecificPluginId,
        name: descriptor.name,
        vendor: descriptor.vendor,
        elapsedMs: inspectedModule.elapsedMs,
        lastStage: inspectedModule.lastStage,
        busCapabilities: descriptor.capabilities,
        catalogState: descriptor.catalogState,
        eligible: descriptor.compatibility.eligible,
        policyReasons: descriptor.compatibility.reasons,
        scanFailure: descriptor.scanFailure || null
      });
      log("module_scan_complete", {
        modulePath: module.modulePath,
        moduleFingerprint: module.moduleFingerprint,
        descriptors: found.length,
        elapsedMs: inspectedModule.elapsedMs,
        lastStage: inspectedModule.lastStage,
        stderrSummary: inspectedModule.stderrSummary
      });
      return found;
    }));
    for (const result of inspected) descriptors.push(...result);
    completed += group.length;
    onProgress?.({ phase: "scanning", completed, total: candidatePaths.size, current: group.map(item => path.basename(item.modulePath)).join(", ") });
  }
  cache.retainModules(new Set(candidatePaths.keys()));
  try { cache.save(); } catch (error) { log("cache_write_failed", { message: error instanceof Error ? error.message : String(error) }); }
  const uniqueModules = [...new Map(modules.map(module => [module.normalizedPath, module])).values()];
  const uniqueDescriptors = [...new Map(descriptors.map(descriptor => [`${descriptor.stablePluginUid}\0${descriptor.moduleFingerprint}`, descriptor])).values()]
    .sort((left, right) => left.name.localeCompare(right.name));
  const moduleByPath = new Map(uniqueModules.map(module => [module.normalizedPath, module]));
  const outcomes: DirectoryScanOutcome[] = discoveries.map(discovery => {
    if (discovery.state !== "ready") return {
      normalizedPath: discovery.normalizedPath,
      state: discovery.state,
      candidateModuleCount: discovery.candidates.length,
      acceptedPluginCount: 0,
      ...(discovery.message ? { message: discovery.message } : {})
    };
    const candidateKeys = directoryCandidates.get(discovery.normalizedPath) || new Set<string>();
    const fingerprints = new Set([...candidateKeys].map(key => moduleByPath.get(key)?.moduleFingerprint).filter((value): value is string => Boolean(value)));
    const acceptedPluginCount = uniqueDescriptors.filter(descriptor => fingerprints.has(descriptor.moduleFingerprint) && descriptor.compatibility.eligible).length;
    const failures = [...candidateKeys].flatMap(key => scannerFailures.get(key) || []);
    const state = acceptedPluginCount > 0 ? "ready" : failures.length ? "scanner-error" : "no-accepted-plugins";
    return {
      normalizedPath: discovery.normalizedPath,
      state,
      candidateModuleCount: candidateKeys.size,
      acceptedPluginCount,
      ...(failures.length || discovery.message ? {
        message: [...new Set([
          ...failures.map(item => `${item.code} / ${item.stage}: ${item.message}`),
          discovery.message
        ].filter((value): value is string => Boolean(value)))].join("；")
      } : {})
    };
  });
  const resolvedDirectories = directoryStore.applyScanOutcomes(outcomes);
  const quarantines = quarantineStore.list();
  const finishedAt = new Date();
  const session = {
    id: sessionId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Date.now() - startedMs,
    directoriesScanned: discoveries.length,
    candidateModules: candidatePaths.size,
    modulesEnumerated: enumeratedModules.size,
    pluginDescriptorsDiscovered: uniqueDescriptors.length,
    acceptedPlugins: uniqueDescriptors.filter(descriptor => descriptor.catalogState === "accepted").length,
    policyRejectedPlugins: uniqueDescriptors.filter(descriptor => descriptor.catalogState === "policy-rejected").length,
    failedModules: scannerFailures.size,
    failedPlugins: uniqueDescriptors.filter(descriptor => Boolean(descriptor.scanFailure)).length,
    quarantinedModules: quarantines.filter(record => record.quarantined).length,
    moduleCacheHits,
    pluginCacheHits
  };
  log("session_end", session);
  onProgress?.({ phase: "complete", completed: candidatePaths.size, total: candidatePaths.size, current: `${session.pluginDescriptorsDiscovered} 个插件描述符` });
  return {
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    modules: uniqueModules,
    descriptors: uniqueDescriptors,
    directories: resolvedDirectories,
    failures: [...scannerFailures.values()].flat(),
    quarantines,
    session
  };
}

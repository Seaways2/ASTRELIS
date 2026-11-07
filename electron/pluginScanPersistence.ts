import fs from "node:fs";
import path from "node:path";
import {
  AURALIS_COMPATIBILITY_POLICY_VERSION,
  PLUGIN_PROBE_VERSION,
  PLUGIN_SCANNER_PROTOCOL_VERSION,
  type PluginDescriptor,
  type PluginModule,
  type PluginQuarantineRecord,
  type ScannerFailure,
  type ScannerPluginRecord
} from "./pluginDomain";

const CACHE_SCHEMA_VERSION = 1;
const QUARANTINE_SCHEMA_VERSION = 1;
const QUARANTINE_FAILURE_THRESHOLD = 2;

interface ModuleCacheEntry {
  normalizedPath: string;
  format: PluginModule["format"];
  fileSize: number;
  modifiedTime: number;
  scannerVersion: number;
  probeVersion: number;
  module: PluginModule;
  records: ScannerPluginRecord[];
  scannedAt: string;
}

interface PluginCacheEntry {
  moduleFingerprint: string;
  formatSpecificPluginId: string;
  probeVersion: number;
  compatibilityPolicyVersion: number;
  descriptor: PluginDescriptor;
}

interface CacheFile {
  schemaVersion: number;
  modules: Record<string, ModuleCacheEntry>;
  plugins: Record<string, PluginCacheEntry>;
}

interface QuarantineFile {
  schemaVersion: number;
  records: Record<string, PluginQuarantineRecord>;
}

function readJson<T>(filePath: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) as T; }
  catch { return fallback; }
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function pluginKey(moduleFingerprint: string, formatSpecificPluginId: string) {
  return `${moduleFingerprint}\0${formatSpecificPluginId}\0${PLUGIN_PROBE_VERSION}\0${AURALIS_COMPATIBILITY_POLICY_VERSION}`;
}

export class PluginScanCache {
  private readonly data: CacheFile;

  constructor(private readonly filePath: string) {
    const loaded = readJson<CacheFile>(filePath, { schemaVersion: CACHE_SCHEMA_VERSION, modules: {}, plugins: {} });
    this.data = loaded.schemaVersion === CACHE_SCHEMA_VERSION && loaded.modules && loaded.plugins
      ? loaded : { schemaVersion: CACHE_SCHEMA_VERSION, modules: {}, plugins: {} };
  }

  getModule(module: PluginModule) {
    const entry = this.data.modules[module.normalizedPath];
    if (!entry
      || entry.normalizedPath !== module.normalizedPath
      || entry.format !== module.format
      || entry.fileSize !== module.fileSize
      || entry.modifiedTime !== module.modifiedTime
      || entry.scannerVersion !== PLUGIN_SCANNER_PROTOCOL_VERSION
      || entry.probeVersion !== PLUGIN_PROBE_VERSION
      || !Array.isArray(entry.records)) return undefined;
    return entry;
  }

  getPlugin(moduleFingerprint: string, formatSpecificPluginId: string) {
    const entry = this.data.plugins[pluginKey(moduleFingerprint, formatSpecificPluginId)];
    if (!entry
      || entry.moduleFingerprint !== moduleFingerprint
      || entry.formatSpecificPluginId !== formatSpecificPluginId
      || entry.probeVersion !== PLUGIN_PROBE_VERSION
      || entry.compatibilityPolicyVersion !== AURALIS_COMPATIBILITY_POLICY_VERSION)
      return undefined;
    return entry.descriptor;
  }

  putSuccessfulModule(module: PluginModule, records: ScannerPluginRecord[], descriptors: PluginDescriptor[]) {
    this.deleteModule(module.normalizedPath);
    this.data.modules[module.normalizedPath] = {
      normalizedPath: module.normalizedPath,
      format: module.format,
      fileSize: module.fileSize,
      modifiedTime: module.modifiedTime,
      scannerVersion: PLUGIN_SCANNER_PROTOCOL_VERSION,
      probeVersion: PLUGIN_PROBE_VERSION,
      module,
      records,
      scannedAt: new Date().toISOString()
    };
    for (const descriptor of descriptors) {
      this.data.plugins[pluginKey(descriptor.moduleFingerprint, descriptor.formatSpecificPluginId)] = {
        moduleFingerprint: descriptor.moduleFingerprint,
        formatSpecificPluginId: descriptor.formatSpecificPluginId,
        probeVersion: PLUGIN_PROBE_VERSION,
        compatibilityPolicyVersion: AURALIS_COMPATIBILITY_POLICY_VERSION,
        descriptor
      };
    }
  }

  deleteModule(normalizedPath: string) {
    const existing = this.data.modules[normalizedPath];
    delete this.data.modules[normalizedPath];
    if (!existing) return;
    for (const [key, entry] of Object.entries(this.data.plugins))
      if (entry.moduleFingerprint === existing.module.moduleFingerprint) delete this.data.plugins[key];
  }

  retainModules(normalizedPaths: Set<string>) {
    for (const normalizedPath of Object.keys(this.data.modules))
      if (!normalizedPaths.has(normalizedPath)) this.deleteModule(normalizedPath);
  }

  save() { writeJson(this.filePath, this.data); }
}

export class PluginQuarantineStore {
  private readonly data: QuarantineFile;

  constructor(private readonly filePath: string) {
    const loaded = readJson<QuarantineFile>(filePath, { schemaVersion: QUARANTINE_SCHEMA_VERSION, records: {} });
    this.data = loaded.schemaVersion === QUARANTINE_SCHEMA_VERSION && loaded.records
      ? loaded : { schemaVersion: QUARANTINE_SCHEMA_VERSION, records: {} };
  }

  get(normalizedPath: string) { return this.data.records[normalizedPath]; }
  list() { return Object.values(this.data.records).sort((a, b) => b.lastFailureTime.localeCompare(a.lastFailureTime)); }

  recordFailure(module: PluginModule, failure: ScannerFailure) {
    const previous = this.data.records[module.normalizedPath];
    const critical = failure.code === "PLUGIN_CRASHED" || failure.code === "SCAN_TIMEOUT";
    const previousCritical = previous?.lastFailureCode === "PLUGIN_CRASHED" || previous?.lastFailureCode === "SCAN_TIMEOUT";
    const failureCount = critical && previousCritical ? previous.failureCount + 1 : 1;
    this.data.records[module.normalizedPath] = {
      normalizedPath: module.normalizedPath,
      modulePath: module.modulePath,
      failureCount,
      lastFailureCode: failure.code,
      lastFailureStage: failure.stage,
      lastFailureTime: new Date().toISOString(),
      quarantined: critical && failureCount >= QUARANTINE_FAILURE_THRESHOLD
    };
    this.save();
    return this.data.records[module.normalizedPath];
  }

  disable(module: PluginModule, failure: ScannerFailure) {
    const previous = this.data.records[module.normalizedPath];
    this.data.records[module.normalizedPath] = {
      normalizedPath: module.normalizedPath,
      modulePath: module.modulePath,
      failureCount: Math.max(1, previous?.failureCount || 0),
      lastFailureCode: "USER_DISABLED",
      lastFailureStage: failure.stage,
      lastFailureTime: new Date().toISOString(),
      quarantined: true,
      userDisabled: true
    };
    this.save();
    return this.data.records[module.normalizedPath];
  }

  recordSuccess(normalizedPath: string) {
    if (!this.data.records[normalizedPath]) return;
    delete this.data.records[normalizedPath];
    this.save();
  }

  reset(normalizedPath: string) {
    const existed = Boolean(this.data.records[normalizedPath]);
    delete this.data.records[normalizedPath];
    this.save();
    return existed;
  }

  private save() { writeJson(this.filePath, this.data); }
}

export function writePluginScanLog(filePath: string, sessionId: string, event: string, data: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify({ timestamp: new Date().toISOString(), sessionId, event, ...data })}\n`);
  } catch { /* Diagnostics must never block scanning or playback. */ }
}

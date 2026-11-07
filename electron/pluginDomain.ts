import crypto from "node:crypto";
import path from "node:path";

export const PLUGIN_CATALOG_SCHEMA_VERSION = 4;
export const PLUGIN_SCANNER_PROTOCOL = "auralis-plugin-scan";
export const PLUGIN_SCANNER_PROTOCOL_VERSION = 2;
export const PLUGIN_PROBE_VERSION = 1;
export const AURALIS_COMPATIBILITY_POLICY_VERSION = 1;

export type PluginFormat = "VST3" | "VST2" | "CLAP";
export type PluginBusRole = "main" | "aux" | "sidechain";
export type PluginCompatibilityReason =
  | "FORMAT_NOT_AVAILABLE"
  | "INSTRUMENT_NOT_SUPPORTED"
  | "MIDI_EFFECT_NOT_SUPPORTED"
  | "PLUGIN_HAS_NO_AUDIO_OUTPUT"
  | "NO_MAIN_AUDIO_INPUT"
  | "NO_MAIN_AUDIO_OUTPUT"
  | "MONO_INPUT_ONLY"
  | "MONO_OUTPUT_ONLY"
  | "STEREO_INPUT_UNSUPPORTED"
  | "STEREO_OUTPUT_UNSUPPORTED"
  | "STEREO_INSERT_UNSUPPORTED"
  | "REQUIRES_UNSUPPORTED_BUS_LAYOUT"
  | "ARA_NOT_SUPPORTED"
  | "ARCHITECTURE_MISMATCH";

export interface PluginBusCapability {
  direction: "input" | "output";
  index: number;
  name: string;
  role: PluginBusRole;
  enabledByDefault: boolean;
  defaultLayout: string;
  supportedLayouts: string[];
}

export interface PluginCapabilities {
  audioInputAvailable: boolean;
  audioOutputAvailable: boolean;
  mainInputBuses: number;
  mainOutputBuses: number;
  auxInputBuses: number;
  auxOutputBuses: number;
  sidechainInputBuses: number;
  buses: PluginBusCapability[];
  supportedChannelLayouts: { mainInput: string[]; mainOutput: string[] };
  midiInput: boolean;
  midiOutput: boolean;
  instrument: boolean;
  category: string;
  formatSpecificFlags: Record<string, string | number | boolean>;
  ara: { supported: boolean; required: boolean; variant: boolean };
}

export interface AuralisCompatibilityDecision {
  profile: "AURALIS_STEREO_INSERT";
  eligible: boolean;
  reasons: PluginCompatibilityReason[];
  sampleRate: number;
  blockSize: number;
  processBlocks: number;
  policyVersion?: number;
  probeVersion?: number;
}

export type PluginCatalogState =
  | "accepted"
  | "policy-rejected"
  | "technically-incompatible"
  | "transient-failure"
  | "quarantined"
  | "user-ignored";
export type ScannerStage =
  | "MODULE_LOAD"
  | "ENUMERATION"
  | "INSTANTIATION"
  | "BUS_PROBE"
  | "PREPARE"
  | "PROCESS_TEST"
  | "RELEASE"
  | "DESTROY";
export type ScannerFailureCode =
  | "SCAN_TIMEOUT"
  | "PLUGIN_CRASHED"
  | "NONZERO_EXIT"
  | "SCAN_PROTOCOL_ERROR"
  | "ENUMERATION_FAILED"
  | "INSTANTIATION_FAILED"
  | "ARCHITECTURE_MISMATCH"
  | "PLUGIN_PROBE_FAILED"
  | "USER_SKIPPED"
  | "USER_DISABLED"
  | "QUARANTINED";

export interface ScannerFailure {
  code: ScannerFailureCode;
  stage: ScannerStage;
  modulePath: string;
  pluginId?: string;
  message: string;
  elapsedMs: number;
  exitCode?: number;
  expectedVersion?: number;
  receivedVersion?: number;
}

export interface ScannerPluginRecord {
  id: string;
  name: string;
  path: string;
  format: PluginFormat;
  manufacturer?: string;
  category?: string;
  version?: string;
  instrument?: boolean;
  hasARAExtension?: boolean;
  loadable: boolean;
  capabilities?: PluginCapabilities;
  compatibility?: AuralisCompatibilityDecision;
  policyRejectionReason?: string;
  scanFailure?: ScannerFailure;
  error?: string;
}

export interface PluginModule {
  format: PluginFormat;
  modulePath: string;
  normalizedPath: string;
  moduleFingerprint: string;
  fileSize: number;
  modifiedTime: number;
  scannerProtocolVersion?: number;
  scanElapsedMs?: number;
  lastScanStage?: ScannerStage;
}

export interface PluginDescriptor {
  format: PluginFormat;
  moduleFingerprint: string;
  formatSpecificPluginId: string;
  stablePluginUid: string;
  name: string;
  vendor: string;
  category: string;
  version: string;
  hasARAExtension: boolean;
  capabilities: PluginCapabilities;
  compatibility: AuralisCompatibilityDecision;
  catalogState: PluginCatalogState;
  scanFailure?: ScannerFailure;
}

export interface PluginQuarantineRecord {
  normalizedPath: string;
  modulePath: string;
  failureCount: number;
  lastFailureCode: ScannerFailureCode;
  lastFailureStage: ScannerStage;
  lastFailureTime: string;
  quarantined: boolean;
  userDisabled?: boolean;
}

export interface PluginScanSessionSummary {
  id: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  directoriesScanned: number;
  candidateModules: number;
  modulesEnumerated: number;
  pluginDescriptorsDiscovered: number;
  acceptedPlugins: number;
  policyRejectedPlugins: number;
  failedModules: number;
  failedPlugins: number;
  quarantinedModules: number;
  moduleCacheHits: number;
  pluginCacheHits: number;
}

export type PluginDirectorySource = "standard" | "user";
export type PluginDirectoryState =
  | "not-scanned"
  | "ready"
  | "missing"
  | "access-denied"
  | "no-candidate-modules"
  | "no-accepted-plugins"
  | "scanner-error";

export interface PluginDirectory {
  id: string;
  path: string;
  normalizedPath: string;
  source: PluginDirectorySource;
  enabled: boolean;
  state: PluginDirectoryState;
  candidateModuleCount: number;
  acceptedPluginCount: number;
  message?: string;
}

export interface PluginScanResult {
  schemaVersion: number;
  modules: PluginModule[];
  descriptors: PluginDescriptor[];
  directories: PluginDirectory[];
  failures: ScannerFailure[];
  quarantines: PluginQuarantineRecord[];
  session: PluginScanSessionSummary;
}

const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export function normalizeModulePath(modulePath: string) {
  const resolved = path.normalize(path.resolve(modulePath));
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

export function pluginFormatForPath(modulePath: string): PluginFormat {
  const lower = modulePath.toLocaleLowerCase();
  if (lower.endsWith(".dll")) return "VST2";
  if (lower.endsWith(".clap")) return "CLAP";
  return "VST3";
}

function emptyCapabilities(record: ScannerPluginRecord): PluginCapabilities {
  return {
    audioInputAvailable: false,
    audioOutputAvailable: false,
    mainInputBuses: 0,
    mainOutputBuses: 0,
    auxInputBuses: 0,
    auxOutputBuses: 0,
    sidechainInputBuses: 0,
    buses: [],
    supportedChannelLayouts: { mainInput: [], mainOutput: [] },
    midiInput: false,
    midiOutput: false,
    instrument: Boolean(record.instrument),
    category: record.category || "",
    formatSpecificFlags: {},
    ara: { supported: Boolean(record.hasARAExtension), required: false, variant: Boolean(record.hasARAExtension) }
  };
}

function fallbackCompatibility(record: ScannerPluginRecord): AuralisCompatibilityDecision {
  const reason = record.policyRejectionReason || (!record.scanFailure ? record.error : undefined);
  return {
    profile: "AURALIS_STEREO_INSERT",
    eligible: Boolean(record.loadable),
    reasons: reason ? [reason as PluginCompatibilityReason] : [],
    sampleRate: 48_000,
    blockSize: 512,
    processBlocks: 3,
    policyVersion: AURALIS_COMPATIBILITY_POLICY_VERSION,
    probeVersion: PLUGIN_PROBE_VERSION
  };
}

export function createPluginModule(
  modulePath: string,
  fileSize: number,
  modifiedTime: number
): PluginModule {
  const format = pluginFormatForPath(modulePath);
  const normalizedPath = normalizeModulePath(modulePath);
  // Stage 1 deliberately keeps fingerprinting metadata-only. It excludes the
  // directory location so moving an unchanged module does not change identity.
  const fingerprintMaterial = [
    format,
    path.basename(modulePath).toLocaleLowerCase("en-US"),
    String(fileSize),
    String(modifiedTime)
  ].join("\0");
  return {
    format,
    modulePath: path.normalize(path.resolve(modulePath)),
    normalizedPath,
    moduleFingerprint: digest(fingerprintMaterial),
    fileSize,
    modifiedTime
  };
}

export function createPluginDescriptor(module: PluginModule, record: ScannerPluginRecord): PluginDescriptor {
  const formatSpecificPluginId = record.id;
  const compatibility = record.compatibility || fallbackCompatibility(record);
  const catalogState: PluginCatalogState = record.scanFailure
    ? (record.scanFailure.code === "SCAN_TIMEOUT" || record.scanFailure.code === "PLUGIN_CRASHED" ? "transient-failure" : "technically-incompatible")
    : compatibility.eligible
      ? "accepted"
      : compatibility.reasons.includes("FORMAT_NOT_AVAILABLE") || compatibility.reasons.includes("ARCHITECTURE_MISMATCH")
        ? "technically-incompatible"
        : "policy-rejected";
  return {
    format: module.format,
    moduleFingerprint: module.moduleFingerprint,
    formatSpecificPluginId,
    stablePluginUid: `${module.format.toLocaleLowerCase()}:${digest(`${module.format}\0${formatSpecificPluginId}`).slice(0, 32)}`,
    name: record.name,
    vendor: record.manufacturer || "",
    category: record.category || "",
    version: record.version || "",
    hasARAExtension: Boolean(record.hasARAExtension),
    capabilities: record.capabilities || emptyCapabilities(record),
    compatibility,
    catalogState,
    ...(record.scanFailure ? { scanFailure: record.scanFailure } : {})
  };
}

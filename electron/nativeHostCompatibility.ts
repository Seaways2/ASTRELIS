import fs from "node:fs";
import path from "node:path";

export interface AuralisVersionManifest {
  appVersion: string;
  nativeHostVersion: string;
  controlProtocolVersion: number;
  pcmProtocolVersion: number;
  pluginScannerProtocolVersion: number;
}

export interface NativeHostBuildInfo {
  nativeHostVersion?: string;
  controlProtocolVersion?: number;
  pcmProtocolVersion?: number;
  juceVersion?: string;
}

export function readVersionManifest(appPath: string): AuralisVersionManifest {
  const manifestPath = path.join(appPath, "auralis-version.json");
  const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Partial<AuralisVersionManifest>;
  if (!value.appVersion || !value.nativeHostVersion
    || !Number.isInteger(value.controlProtocolVersion)
    || !Number.isInteger(value.pcmProtocolVersion)
    || !Number.isInteger(value.pluginScannerProtocolVersion)) {
    throw new Error(`AURALIS_VERSION_MANIFEST_INVALID: ${manifestPath}`);
  }
  return value as AuralisVersionManifest;
}

export function nativeHostCompatibilityError(
  manifest: AuralisVersionManifest,
  build: NativeHostBuildInfo
): string | null {
  if (build.nativeHostVersion !== manifest.nativeHostVersion) {
    return `NATIVE_HOST_VERSION_MISMATCH: app=${manifest.appVersion}, expected=${manifest.nativeHostVersion}, actual=${build.nativeHostVersion || "missing"}`;
  }
  if (build.controlProtocolVersion !== manifest.controlProtocolVersion) {
    return `NATIVE_CONTROL_PROTOCOL_MISMATCH: expected=${manifest.controlProtocolVersion}, actual=${build.controlProtocolVersion ?? "missing"}`;
  }
  if (build.pcmProtocolVersion !== manifest.pcmProtocolVersion) {
    return `NATIVE_PCM_PROTOCOL_MISMATCH: expected=${manifest.pcmProtocolVersion}, actual=${build.pcmProtocolVersion ?? "missing"}`;
  }
  return null;
}

import fs from "node:fs";
import path from "node:path";

export type NativeOutputCandidate = {
  backend: "wasapi-shared" | "wasapi-shared-low-latency" | "wasapi-exclusive";
  juceTypeName?: string;
  juceDeviceName: string;
  platformEndpointId?: string;
  sampleRateMode: "system" | "follow-source" | "fixed";
  fixedSampleRate?: number;
  bufferMode: "auto" | "fixed";
  fixedBufferSize?: number;
  exclusiveFallback: "shared-low-latency" | "shared" | "ask";
};

export type NativeOutputPersistence = {
  schemaVersion: 1;
  preferred?: NativeOutputCandidate;
  lastKnownGood: NativeOutputCandidate;
  updatedAt: string;
};

export function nativeOutputStatePath(userDataDirectory: string) {
  return path.join(userDataDirectory, "native-output-v1.json");
}

export function readNativeOutputState(userDataDirectory: string): NativeOutputPersistence | null {
  try {
    const value = JSON.parse(fs.readFileSync(nativeOutputStatePath(userDataDirectory), "utf8")) as NativeOutputPersistence;
    return value?.schemaVersion === 1 && value.lastKnownGood && typeof value.lastKnownGood.juceDeviceName === "string"
      ? value : null;
  } catch { return null; }
}

export function writeNativeOutputState(userDataDirectory: string, value: NativeOutputPersistence) {
  const target = nativeOutputStatePath(userDataDirectory);
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  try { fs.renameSync(temporary, target); }
  catch {
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  }
}

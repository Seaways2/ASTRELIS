import fs from "node:fs";
import readline from "node:readline";
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import { app } from "electron";
import { SingleProcessGate } from "./singleProcessGate";
import { nativeHostCompatibilityError, readVersionManifest, type NativeHostBuildInfo } from "./nativeHostCompatibility";
import { readNativeOutputState } from "./nativeOutputPersistence";
import { nativePluginHostPath } from "./pluginScanService";
import type { PcmDiagnostics, PcmPacketMetadata } from "./pcmDiagnostics";

/**
 * JUCE native host process lifecycle and its line-delimited JSON protocol:
 * single-instance start/stop, correlated requests with per-command timeouts,
 * last-known-good output restore, and renderer PCM forwarding.
 */
export interface NativePlaybackEngineHooks {
  writeLog(level: string, message: string): void;
  getPcmDiagnostics(): PcmDiagnostics | null;
  /** Called when the current host process is lost or retired. */
  onEngineLost(): void;
}

let hooks: NativePlaybackEngineHooks = {
  writeLog: () => undefined,
  getPcmDiagnostics: () => null,
  onEngineLost: () => undefined
};

export function configureNativePlaybackEngine(next: NativePlaybackEngineHooks) {
  hooks = next;
}

const execFileAsync = promisify(execFile);
const writeLog = (level: string, message: string) => hooks.writeLog(level, message);
const pcmDiagnostics = () => hooks.getPcmDiagnostics();

let onlinePcmBackpressured = false;
let onlinePcmDrainEngine: ChildProcessWithoutNullStreams | undefined;
let onlinePcmPackets = 0;
let onlinePcmFrames = 0;
let onlinePcmTransportDrops = 0;
const playbackRequests = new Map<string, { type: string; engine: ChildProcessWithoutNullStreams; resolve(value: unknown): void; reject(reason: unknown): void; timer: NodeJS.Timeout }>();
let playbackRequestSequence = 0;
export let playbackEngineGate: SingleProcessGate<ChildProcessWithoutNullStreams> | null = null;
let nativeOutputRestorePromise: Promise<void> | null = null;

/** Renderer PCM transport counters for diagnostics. */
export function pcmTransportStats() {
  return {
    packets: onlinePcmPackets,
    frames: onlinePcmFrames,
    transportDrops: onlinePcmTransportDrops,
    backpressured: onlinePcmBackpressured
  };
}

export function resetPcmTransportStats() {
  onlinePcmPackets = 0;
  onlinePcmFrames = 0;
  onlinePcmTransportDrops = 0;
  onlinePcmBackpressured = false;
  onlinePcmDrainEngine = undefined;
}

let checkedNativeHostSignature = "";
export function assertNativeHostCompatibility(executable: string) {
  const stat = fs.statSync(executable);
  const signature = `${executable}|${stat.size}|${stat.mtimeMs}`;
  if (signature === checkedNativeHostSignature) return;
  const manifest = readVersionManifest(app.getAppPath());
  if (app.getVersion() !== manifest.appVersion) {
    throw new Error(`APP_VERSION_MANIFEST_MISMATCH: package=${app.getVersion()}, manifest=${manifest.appVersion}`);
  }
  const stdout = execFileSync(executable, ["--build-info"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000
  });
  const build = JSON.parse(stdout) as NativeHostBuildInfo;
  const mismatch = nativeHostCompatibilityError(manifest, build);
  if (mismatch) throw new Error(mismatch);
  checkedNativeHostSignature = signature;
}

export function resetNativeRuntimeAfterEngineLoss() {
  nativeOutputRestorePromise = null;
  hooks.onEngineLost();
}

function rejectPlaybackRequestsForEngine(engine: ChildProcessWithoutNullStreams, error: Error) {
  playbackRequests.forEach((request, requestId) => {
    if (request.engine !== engine) return;
    clearTimeout(request.timer);
    playbackRequests.delete(requestId);
    request.reject(error);
  });
}

function waitForPlaybackEngineExit(engine: ChildProcessWithoutNullStreams, timeoutMs: number) {
  if (engine.exitCode !== null || engine.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>(resolve => {
    const onExit = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { engine.removeListener("exit", onExit); resolve(false); }, timeoutMs);
    engine.once("exit", onExit);
  });
}

export async function stopPlaybackEngine(engine: ChildProcessWithoutNullStreams) {
  if (engine.exitCode !== null || engine.signalCode !== null) return;
  try { engine.stdin.end(); } catch { /* The host may already have closed stdin. */ }
  try { engine.kill(); } catch { /* Fall through to the verified exit wait. */ }
  if (await waitForPlaybackEngineExit(engine, 1200)) return;

  const processId = engine.pid;
  if (processId) {
    try {
      await execFileAsync("taskkill", ["/PID", String(processId), "/T", "/F"], { windowsHide: true, timeout: 5000 });
    } catch (error) {
      if (engine.exitCode === null && engine.signalCode === null)
        writeLog("AUDIO", `Forced Native host termination reported an error for pid=${processId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!await waitForPlaybackEngineExit(engine, 3000))
    throw new Error(`NATIVE_ENGINE_TERMINATION_TIMEOUT: pid=${processId || "unknown"}`);
}

function startPlaybackEngine() {
  const executable = nativePluginHostPath();
  assertNativeHostCompatibility(executable);
  const engine = spawn(executable, ["--engine"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  writeLog("AUDIO", `Native host started: pid=${engine.pid || "unknown"}`);
  const lines = readline.createInterface({ input: engine.stdout });
  lines.on("line", line => {
    try {
      const response = JSON.parse(line) as Record<string, unknown>;
      const requestId = typeof response.requestId === "string" ? response.requestId : "";
      const request = requestId ? playbackRequests.get(requestId) : undefined;
      if (!request || request.engine !== engine) {
        writeLog("AUDIO", `Ignored unsolicited native response without a pending request: ${line.slice(0, 500)}`);
        return;
      }
      playbackRequests.delete(requestId);
      clearTimeout(request.timer);
      if (request.type === "editor") writeLog("VST", `Editor response: request=${requestId}; ok=${String(response.ok)}`);
      if (request.type === "status") pcmDiagnostics()?.recordNativeStatus(response);
      request.resolve(response);
    } catch (error) {
      writeLog("AUDIO", `Invalid native response: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  engine.stderr.on("data", chunk => writeLog("AUDIO", `Native host stderr pid=${engine.pid || "unknown"}: ${String(chunk).trim().slice(0, 800)}`));
  engine.once("exit", (code, signal) => {
    const error = new Error(`JUCE playback engine exited (${code ?? "unknown"})`);
    rejectPlaybackRequestsForEngine(engine, error);
    const wasCurrent = playbackEngineGate?.clearIfCurrent(engine) ?? false;
    writeLog("AUDIO", `Native host exited: pid=${engine.pid || "unknown"}; code=${code ?? "unknown"}; signal=${signal || "none"}; current=${wasCurrent}`);
    if (wasCurrent) resetNativeRuntimeAfterEngineLoss();
  });
  return engine;
}

function nativePlaybackEngineGate() {
  if (!playbackEngineGate) playbackEngineGate = new SingleProcessGate(
    startPlaybackEngine,
    engine => engine.exitCode === null && engine.signalCode === null && !engine.killed,
    stopPlaybackEngine
  );
  return playbackEngineGate;
}

function nativeCommandTimeoutMs(type: unknown) {
  // Cold plugin editors may initialize fonts, GPU resources and license UI.
  if (type === "editor") return 30000;
  if (type === "direct-load" || type === "direct-close") return 20000;
  if (type === "device-apply") return 20000;
  if (type === "device-enumerate" || type === "device-capabilities" || type === "device-status" || type === "output") return 12000;
  if (type === "rack" || type === "state-save") return 12000;
  return 5000;
}

export async function sendPlaybackCommand(command: Record<string, unknown>) {
  const engine = await nativePlaybackEngineGate().ensure();
  return new Promise<unknown>((resolve, reject) => {
    try {
      const manifest = readVersionManifest(app.getAppPath());
      const requestId = `native-${process.pid}-${++playbackRequestSequence}`;
      const requestCommand = {
        ...command,
        protocolVersion: manifest.controlProtocolVersion,
        requestId
      };
      const timer = setTimeout(() => {
        if (command.type === "editor") writeLog("VST", `Editor timed out: id=${String(command.id)}; pid=${engine.pid}; waited=30000ms`);
        const error = new Error(`原生音频引擎响应超时：${String(command.type || "command")}`);
        const wasCurrent = nativePlaybackEngineGate().isCurrent(engine);
        rejectPlaybackRequestsForEngine(engine, error);
        if (wasCurrent) resetNativeRuntimeAfterEngineLoss();
        void nativePlaybackEngineGate().retire(engine).catch(reason => {
          writeLog("AUDIO", `Native host retirement failed after timeout: ${reason instanceof Error ? reason.message : String(reason)}`);
        });
      }, nativeCommandTimeoutMs(command.type));
      if (command.type === "editor") writeLog("VST", `Editor requested: id=${String(command.id)}; pid=${engine.pid}; timeout=30000ms`);
      playbackRequests.set(requestId, { type: String(command.type || "command"), engine, resolve, reject, timer });
      engine.stdin.write(`${JSON.stringify(requestCommand)}\n`);
    } catch (error) { reject(error); }
  });
}

export async function ensureNativeOutputRestored() {
  if (nativeOutputRestorePromise) return nativeOutputRestorePromise;
  nativeOutputRestorePromise = (async () => {
    const saved = readNativeOutputState(app.getPath("userData"));
    if (!saved) return;
    const response = await sendPlaybackCommand({
      type: "device-apply",
      generation: 0,
      candidate: saved.lastKnownGood
    }) as { ok?: boolean; committed?: boolean; degraded?: boolean; error?: string; recovery?: string; actual?: Record<string, unknown> };
    if (response.ok && response.committed) {
      writeLog("AUDIO", `Restored Native last-known-good output: ${String(response.actual?.backend || "unknown")} / ${String(response.actual?.juceDeviceName || "unknown")}`);
      return;
    }
    writeLog("AUDIO", `Native LKG restore rejected; recovery=${response.recovery || "unknown"}; error=${response.error || "unknown"}`);
  })().catch(error => {
    writeLog("AUDIO", `Native LKG restore failed before routing: ${error instanceof Error ? error.message : String(error)}`);
  });
  return nativeOutputRestorePromise;
}

export function sendPlaybackPcm(packet: PcmPacketMetadata & { sampleRate?: number; channels?: number; frames?: number; pcm?: unknown }) {
  const engine = playbackEngineGate?.current();
  if (!engine || engine.killed || !engine.stdin.writable) return false;
  const sampleRate = Math.round(Number(packet.sampleRate) || 0);
  const channels = Math.round(Number(packet.channels) || 0);
  const frames = Math.round(Number(packet.frames) || 0);
  const value = packet.pcm;
  const bytes = value instanceof ArrayBuffer
    ? Buffer.from(value)
    : ArrayBuffer.isView(value)
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!bytes || sampleRate < 8000 || sampleRate > 384000 || channels !== 2 || frames <= 0 || frames > 16384
      || bytes.byteLength !== frames * channels * Float32Array.BYTES_PER_ELEMENT) return false;
  pcmDiagnostics()?.recordMainPacket(packet);
  const base64Started = performance.now();
  const data = bytes.toString("base64");
  const base64Ms = performance.now() - base64Started;
  const jsonStarted = performance.now();
  const line = `${JSON.stringify({
    type: "pcm-data",
    protocolVersion: Math.round(Number(packet.protocolVersion) || 0),
    mediaSessionId: Math.round(Number(packet.mediaSessionId) || 0),
    sequence: Math.round(Number(packet.sequence) || 0),
    sourceFrameCounter: Math.round(Number(packet.sourceFrameCounter) || 0),
    producerTimestamp: Number(packet.producerTimestamp) || Number(packet.producerTimestampUs) || 0,
    sampleRate,
    channels,
    frames,
    data
  })}\n`;
  pcmDiagnostics()?.recordSerialization(base64Ms, performance.now() - jsonStarted);
  onlinePcmPackets++;
  onlinePcmFrames += frames;
  // A false return from write() means Node has queued the packet, not that it
  // failed.  The old early-return path discarded every following audio packet
  // until drain and produced an audible discontinuity.  Keep feeding the
  // bounded stream queue; only reject a genuinely runaway backlog.
  pcmDiagnostics()?.recordStdinWritableLength(engine.stdin.writableLength);
  if (engine.stdin.writableLength > 4 * 1024 * 1024) {
    onlinePcmTransportDrops++;
    return false;
  }
  if (!engine.stdin.write(line)) {
    pcmDiagnostics()?.recordStdinBackpressure();
    if (!onlinePcmBackpressured || onlinePcmDrainEngine !== engine) {
      onlinePcmBackpressured = true;
      onlinePcmDrainEngine = engine;
      engine.stdin.once("drain", () => {
        pcmDiagnostics()?.recordStdinDrain();
        if (onlinePcmDrainEngine === engine) {
          onlinePcmBackpressured = false;
          onlinePcmDrainEngine = undefined;
        }
      });
    }
  }
  pcmDiagnostics()?.recordStdinWritableLength(engine.stdin.writableLength);
  return true;
}

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
 * last-known-good output restore, crash recovery, output-device health and
 * renderer PCM forwarding.
 */
export interface NativePlaybackEngineHooks {
  writeLog(level: string, message: string): void;
  getPcmDiagnostics(): PcmDiagnostics | null;
  /** Called when the current host process is lost or retired. */
  onEngineLost(): void;
  /** Test seam: replaces spawning the real host executable. */
  spawnEngine?: () => ChildProcessWithoutNullStreams;
  /** Test seam: clock in milliseconds. */
  now?: () => number;
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
const clock = () => hooks.now?.() ?? Date.now();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

type NativeResponse = Record<string, unknown>;

let onlinePcmBackpressured = false;
let onlinePcmDrainEngine: ChildProcessWithoutNullStreams | undefined;
let onlinePcmPackets = 0;
let onlinePcmFrames = 0;
let onlinePcmTransportDrops = 0;
const playbackRequests = new Map<string, { type: string; engine: ChildProcessWithoutNullStreams; resolve(value: unknown): void; reject(reason: unknown): void; timer: NodeJS.Timeout }>();
let playbackRequestSequence = 0;
export let playbackEngineGate: SingleProcessGate<ChildProcessWithoutNullStreams> | null = null;
// Every host process restores the persisted output once, before its first command.
const outputRestores = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>();
const engineInstances = new WeakMap<ChildProcessWithoutNullStreams, number>();
let engineInstanceSequence = 0;

/**
 * What the current host is playing. A host that dies takes its source with it;
 * this is what a replacement needs to continue the same track. Source and rack
 * describe one host and are reset when a new host starts; volume and fade are
 * the user's settings and carry over.
 */
const playbackJournal = {
  sourceKind: "none" as "none" | "file" | "other",
  load: null as NativeResponse | null,
  rack: null as NativeResponse | null,
  volume: null as NativeResponse | null,
  fade: null as NativeResponse | null,
  position: 0,
  playing: false
};

function resetHostJournal() {
  playbackJournal.sourceKind = "none";
  playbackJournal.load = null;
  playbackJournal.rack = null;
  playbackJournal.position = 0;
  playbackJournal.playing = false;
}

type RestorePlan = { load: NativeResponse; rack: NativeResponse | null; position: number; playing: boolean };

type EngineLoss = {
  reason: string;
  at: number;
  count: number;
  engineInstance: number;
  suspectPlugins: string[];
  // The lost host's file source; transport requests made meanwhile update it.
  plan: RestorePlan | null;
  restorable: boolean;
  restoreAttempted: boolean;
};

// A lost host is reported through status until a new source is loaded or the
// previous one is restored. A status poll never silently starts an empty host.
let engineLoss: EngineLoss | null = null;
let consecutiveEngineLosses = 0;
let lastEngineLossAt = Number.NEGATIVE_INFINITY;
let sessionRestore: Promise<boolean> | null = null;
const ENGINE_LOSS_WINDOW_MS = 60000;
// One automatic restore per loss window: a plugin that kills the host again
// right after the restore is reported instead of being reloaded in a loop.
const MAX_AUTOMATIC_RESTORES = 1;
// A plugin that crashes the host every minute or two never trips the window
// above, so losses are also counted per set of enabled rack plugins: the same
// set is restored automatically only once in this longer window.
const RACK_LOSS_WINDOW_MS = 10 * 60000;
const MAX_AUTOMATIC_RESTORES_PER_RACK = 1;
const rackLossHistory = new Map<string, number[]>();

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
  hooks.onEngineLost();
}

function isEngineAlive(engine: ChildProcessWithoutNullStreams) {
  return engine.exitCode === null && engine.signalCode === null && !engine.killed;
}

function enabledRackPluginIds(rack: NativeResponse | null) {
  const plugins = rack && Array.isArray(rack.plugins) ? rack.plugins as Record<string, unknown>[] : [];
  return plugins.filter(plugin => plugin && plugin.enabled !== false && typeof plugin.id === "string").map(plugin => String(plugin.id));
}

/** Records a loss against the enabled plugin set; returns its losses in the window. */
function noteRackLoss(pluginIds: string[], now: number) {
  if (!pluginIds.length) return 0;
  const key = [...pluginIds].sort().join("\n");
  const recent = (rackLossHistory.get(key) || []).filter(at => now - at <= RACK_LOSS_WINDOW_MS);
  recent.push(now);
  rackLossHistory.set(key, recent);
  return recent.length;
}

function noteEngineLoss(engine: ChildProcessWithoutNullStreams, reason: string) {
  const now = clock();
  consecutiveEngineLosses = now - lastEngineLossAt <= ENGINE_LOSS_WINDOW_MS ? consecutiveEngineLosses + 1 : 1;
  lastEngineLossAt = now;
  const hostPlan: RestorePlan | null = playbackJournal.sourceKind === "file" && playbackJournal.load
    ? { load: playbackJournal.load, rack: playbackJournal.rack, position: playbackJournal.position, playing: playbackJournal.playing }
    : null;
  // A replacement host that dies before getting the source back keeps the
  // original plan (and its rack, the likely culprit) as the thing to report.
  const plan = hostPlan ?? engineLoss?.plan ?? null;
  const suspectPlugins = enabledRackPluginIds(playbackJournal.rack ?? plan?.rack ?? null);
  const rackLosses = noteRackLoss(suspectPlugins, now);
  const restorable = plan !== null && consecutiveEngineLosses <= MAX_AUTOMATIC_RESTORES
    && rackLosses <= MAX_AUTOMATIC_RESTORES_PER_RACK;
  engineLoss = {
    reason,
    at: now,
    count: consecutiveEngineLosses,
    engineInstance: engineInstances.get(engine) ?? 0,
    suspectPlugins,
    plan,
    restorable,
    restoreAttempted: false
  };
  writeLog("AUDIO", `Native host lost: pid=${engine.pid || "unknown"}; reason=${reason}; consecutive=${consecutiveEngineLosses}; rackLosses=${rackLosses}; source=${playbackJournal.sourceKind}; autoRestore=${restorable}; plugins=${suspectPlugins.join(",") || "none"}`);
}

function engineLostResponse(): NativeResponse {
  const loss = engineLoss;
  return {
    ok: false,
    error: `NATIVE_ENGINE_LOST: ${loss?.reason || "unknown"}`,
    engineLost: true,
    engineLossReason: loss?.reason || "unknown",
    engineLossCount: loss?.count || 0,
    suspectPlugins: loss?.suspectPlugins || [],
    playing: false,
    position: loss?.plan?.position ?? 0,
    duration: 0,
    playbackToken: typeof loss?.plan?.load.playbackToken === "string" ? loss.plan.load.playbackToken : "",
    source: "none",
    sourceState: "stopped"
  };
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
        writeLog("AUDIO", `Forced Native host termination reported an error for pid=${processId}: ${errorText(error)}`);
    }
  }
  if (!await waitForPlaybackEngineExit(engine, 3000))
    throw new Error(`NATIVE_ENGINE_TERMINATION_TIMEOUT: pid=${processId || "unknown"}`);
}

function spawnPlaybackEngineProcess() {
  const executable = nativePluginHostPath();
  assertNativeHostCompatibility(executable);
  return spawn(executable, ["--engine"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
}

function startPlaybackEngine() {
  const engine = hooks.spawnEngine ? hooks.spawnEngine() : spawnPlaybackEngineProcess();
  engineInstances.set(engine, ++engineInstanceSequence);
  resetHostJournal();
  writeLog("AUDIO", `Native host started: pid=${engine.pid || "unknown"}; instance=${engineInstanceSequence}`);
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
      writeLog("AUDIO", `Invalid native response: ${errorText(error)}`);
    }
  });
  engine.stderr.on("data", chunk => writeLog("AUDIO", `Native host stderr pid=${engine.pid || "unknown"}: ${String(chunk).trim().slice(0, 800)}`));
  // A host that is exiting closes its stdin; without a listener the failed
  // write surfaced as an uncaught "write after end" in the main process.
  engine.stdin.on("error", error => {
    writeLog("AUDIO", `Native host stdin closed pid=${engine.pid || "unknown"}: ${error.message}`);
    rejectPlaybackRequestsForEngine(engine, error);
  });
  engine.once("exit", (code, signal) => {
    const error = new Error(`JUCE playback engine exited (${code ?? "unknown"})`);
    rejectPlaybackRequestsForEngine(engine, error);
    const wasCurrent = playbackEngineGate?.clearIfCurrent(engine) ?? false;
    // kill() or closing stdin is how this process stops a host on purpose.
    const intentional = engine.killed || engine.stdin.writableEnded;
    writeLog("AUDIO", `Native host exited: pid=${engine.pid || "unknown"}; code=${code ?? "unknown"}; signal=${signal || "none"}; current=${wasCurrent}; intentional=${intentional}`);
    if (!wasCurrent) return;
    if (!intentional) noteEngineLoss(engine, `exit code=${code ?? "unknown"} signal=${signal || "none"}`);
    resetNativeRuntimeAfterEngineLoss();
  });
  return engine;
}

function nativePlaybackEngineGate() {
  if (!playbackEngineGate) playbackEngineGate = new SingleProcessGate(
    startPlaybackEngine,
    isEngineAlive,
    stopPlaybackEngine,
    {
      // stopPlaybackEngine is itself bounded (~9 s); this is a second fence so
      // a stuck termination can never block every later host start.
      retirementTimeoutMs: 15000,
      onRetirementFailure: (engine, reason) => writeLog("AUDIO", `Native host could not be terminated (pid=${engine.pid || "unknown"}); continuing with a new host: ${errorText(reason)}`)
    }
  );
  return playbackEngineGate;
}

function requestFromEngine(engine: ChildProcessWithoutNullStreams, command: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    try {
      const manifest = readVersionManifest(app.getAppPath());
      const requestId = `native-${process.pid}-${++playbackRequestSequence}`;
      const requestCommand = {
        ...command,
        protocolVersion: manifest.controlProtocolVersion,
        requestId
      };
      const timeoutMs = nativeCommandTimeoutMs(command.type);
      const timer = setTimeout(() => {
        if (command.type === "editor") writeLog("VST", `Editor timed out: id=${String(command.id)}; pid=${engine.pid}; waited=${timeoutMs}ms`);
        const error = new Error(`原生音频引擎响应超时：${String(command.type || "command")}`);
        const wasCurrent = nativePlaybackEngineGate().isCurrent(engine);
        if (wasCurrent) noteEngineLoss(engine, `timeout ${String(command.type || "command")}`);
        rejectPlaybackRequestsForEngine(engine, error);
        if (wasCurrent) resetNativeRuntimeAfterEngineLoss();
        void nativePlaybackEngineGate().retire(engine).catch(reason => {
          writeLog("AUDIO", `Native host retirement failed after timeout: ${errorText(reason)}`);
        });
      }, timeoutMs);
      if (command.type === "editor") writeLog("VST", `Editor requested: id=${String(command.id)}; pid=${engine.pid}; timeout=${timeoutMs}ms`);
      const fail = (error: Error) => {
        if (!playbackRequests.has(requestId)) return;
        clearTimeout(timer);
        playbackRequests.delete(requestId);
        reject(error);
      };
      playbackRequests.set(requestId, { type: String(command.type || "command"), engine, resolve, reject, timer });
      // The host may be exiting between ensure() and here: fail this request
      // now rather than writing into a closed pipe and waiting for the timeout.
      if (!engine.stdin.writable) { fail(new Error(`原生音频引擎已关闭：${String(command.type || "command")}`)); return; }
      engine.stdin.write(`${JSON.stringify(requestCommand)}\n`, error => { if (error) fail(error); });
    } catch (error) { reject(error); }
  });
}

function restoreOutputFor(engine: ChildProcessWithoutNullStreams) {
  const existing = outputRestores.get(engine);
  if (existing) return existing;
  const restore = (async () => {
    const saved = readNativeOutputState(app.getPath("userData"));
    if (!saved) return;
    const response = await requestFromEngine(engine, {
      type: "device-apply",
      generation: 0,
      candidate: saved.lastKnownGood
    }) as { ok?: boolean; committed?: boolean; degraded?: boolean; error?: string; recovery?: string; actual?: Record<string, unknown> };
    if (response.ok && response.committed) {
      writeLog("AUDIO", `Restored Native last-known-good output: ${String(response.actual?.backend || "unknown")} / ${String(response.actual?.juceDeviceName || "unknown")}`);
      return;
    }
    // Not cached as final: the output health check keeps retrying the LKG
    // device, e.g. a TV that was still in standby when the host started.
    writeLog("AUDIO", `Native LKG restore rejected; recovery=${response.recovery || "unknown"}; error=${response.error || "unknown"}`);
  })().catch(error => {
    writeLog("AUDIO", `Native LKG restore failed before routing: ${errorText(error)}`);
  });
  outputRestores.set(engine, restore);
  return restore;
}

async function acquireEngine() {
  const engine = await nativePlaybackEngineGate().ensure();
  await restoreOutputFor(engine);
  return engine;
}

type OutputHealthState = "unknown" | "ok" | "fallback-device" | "no-device" | "stalled";
type OutputHealth = {
  state: OutputHealthState;
  device: string;
  expectedDevice: string;
  inFlight: boolean;
  nextCheckAt: number;
  nextRetryAt: number;
  retryDelayMs: number;
  callbackSample?: { count: number; at: number; generation: number };
  // Failed re-applies that closed and reopened a device which was playing.
  audibleFailures: number;
  // Set once those are capped: the device list (and expected device) at that
  // point; the expected device is tried again only after it changes.
  parkedDevices?: string;
};
const OUTPUT_HEALTH_INTERVAL_MS = 2500;
const OUTPUT_STALL_MS = 4000;
const OUTPUT_RETRY_CHEAP_MS = 3000;
const OUTPUT_RETRY_MAX_MS = 60000;
// Every failed apply on a playing fallback device is an audible dropout.
const MAX_AUDIBLE_OUTPUT_RETRIES = 3;
const outputHealth = new WeakMap<ChildProcessWithoutNullStreams, OutputHealth>();
// Bumped by every output change that does not come from the health check, so
// a check never overrides a device the user is applying at the same moment.
let outputCommandGeneration = 0;
let outputCommandsInFlight = 0;

function outputHealthFor(engine: ChildProcessWithoutNullStreams) {
  let health = outputHealth.get(engine);
  if (!health) {
    health = { state: "unknown", device: "", expectedDevice: "", inFlight: false, nextCheckAt: 0, nextRetryAt: 0, retryDelayMs: 0, audibleFailures: 0 };
    outputHealth.set(engine, health);
  }
  return health;
}

async function checkOutputHealth(engine: ChildProcessWithoutNullStreams, health: OutputHealth) {
  const generation = outputCommandGeneration;
  const device = await requestFromEngine(engine, { type: "device-status" }) as NativeResponse;
  if (!nativePlaybackEngineGate().isCurrent(engine) || !isEngineAlive(engine)) return;
  // HDMI direct output deliberately closes the shared device.
  if (device.directOutput) { health.state = "ok"; health.callbackSample = undefined; return; }
  const now = clock();
  const saved = readNativeOutputState(app.getPath("userData"));
  const expected = saved?.lastKnownGood.juceDeviceName || "";
  const actual = device.state === "active" ? String(device.juceDeviceName || "") : "";
  let state: OutputHealthState;
  if (!actual) state = "no-device";
  else {
    // WASAPI keeps calling back while paused, so a frozen counter means the
    // endpoint was invalidated (TV off, exclusive takeover) under an open device.
    const callbacks = Number(device.callbackCount) || 0;
    const sample = health.callbackSample;
    const progressed = !sample || sample.generation !== generation || callbacks !== sample.count;
    if (progressed) health.callbackSample = { count: callbacks, at: now, generation };
    const stalled = !progressed && sample !== undefined && now - sample.at >= OUTPUT_STALL_MS;
    state = stalled ? "stalled" : expected && actual !== expected ? "fallback-device" : "ok";
  }
  if (state !== health.state && !(health.state === "unknown" && state === "ok"))
    writeLog("AUDIO", `Native output health: ${health.state} -> ${state}; actual=${actual || "none"}; expected=${expected || "system default"}`);
  health.state = state;
  health.device = actual;
  health.expectedDevice = expected;
  if (state === "ok") {
    health.retryDelayMs = 0;
    health.nextRetryAt = 0;
    health.audibleFailures = 0;
    health.parkedDevices = undefined;
    return;
  }
  if (now < health.nextRetryAt || outputCommandsInFlight > 0 || outputCommandGeneration !== generation) return;
  if (state === "fallback-device" && health.parkedDevices !== undefined) {
    const devices = await outputDeviceSignature(engine, expected);
    if (!nativePlaybackEngineGate().isCurrent(engine) || !isEngineAlive(engine)) return;
    if (devices === null || devices === health.parkedDevices) {
      health.nextRetryAt = clock() + OUTPUT_RETRY_MAX_MS;
      return;
    }
    writeLog("AUDIO", `Native output devices changed; retrying ${expected}`);
    health.parkedDevices = undefined;
    health.audibleFailures = 0;
    health.retryDelayMs = 0;
  }
  // Without a saved route the intent is the system default; a different live
  // device is then not an error, only a missing or dead one is.
  const repair = saved
    ? { type: "device-apply", generation: 0, candidate: saved.lastKnownGood }
    : state === "fallback-device" ? null : { type: "output", name: "", generation: 0 };
  if (!repair) return;
  const response = await requestFromEngine(engine, repair) as { ok?: boolean; committed?: boolean; error?: string; recovery?: string };
  if (response.ok && response.committed) {
    writeLog("AUDIO", `Native output re-attached after ${state}: ${expected || "system default"}`);
    health.state = "ok";
    health.retryDelayMs = 0;
    health.nextRetryAt = 0;
    health.callbackSample = undefined;
    return;
  }
  // A missing endpoint is rejected before the open device is touched, so it can
  // be polled cheaply; a failed open/rollback is audible and backs off.
  const cheap = /OUTPUT_DEVICE_NOT_FOUND|OUTPUT_DEVICE_IDENTITY_MISMATCH|DEFAULT_OUTPUT_NOT_FOUND/.test(String(response.error || ""));
  health.retryDelayMs = cheap ? OUTPUT_RETRY_CHEAP_MS : Math.min(Math.max(health.retryDelayMs * 2, 5000), OUTPUT_RETRY_MAX_MS);
  health.nextRetryAt = clock() + health.retryDelayMs;
  // Silence (no-device, stalled) costs nothing to retry; a fallback device that
  // is playing drops out on every failed apply, so that is capped.
  if (cheap || state !== "fallback-device" || ++health.audibleFailures < MAX_AUDIBLE_OUTPUT_RETRIES) return;
  health.parkedDevices = await outputDeviceSignature(engine, expected) ?? "";
  writeLog("AUDIO", `Native output stays on ${actual} after ${health.audibleFailures} failed re-applies of ${expected}; retrying when the device list changes (${response.error || "unknown"})`);
}

/** The output device list plus the expected device, or null when unavailable. */
async function outputDeviceSignature(engine: ChildProcessWithoutNullStreams, expected: string) {
  try {
    const response = await requestFromEngine(engine, { type: "device-enumerate" }) as NativeResponse;
    if (!response.ok || !Array.isArray(response.devices)) return null;
    const names = (response.devices as Record<string, unknown>[])
      .map(device => `${String(device?.juceTypeName || "")}/${String(device?.juceDeviceName || "")}`)
      .sort();
    return JSON.stringify([expected, names]);
  } catch {
    return null;
  }
}

function scheduleOutputHealthCheck(engine: ChildProcessWithoutNullStreams) {
  const health = outputHealthFor(engine);
  const now = clock();
  if (health.inFlight || now < health.nextCheckAt) return;
  health.inFlight = true;
  health.nextCheckAt = now + OUTPUT_HEALTH_INTERVAL_MS;
  void checkOutputHealth(engine, health)
    .catch(error => writeLog("AUDIO", `Native output health check failed: ${errorText(error)}`))
    .finally(() => { health.inFlight = false; });
}

function annotateStatus(engine: ChildProcessWithoutNullStreams, response: NativeResponse) {
  response.engineInstance = engineInstances.get(engine) ?? 0;
  if (engineLoss) return { ...response, ...engineLostResponse() };
  const health = outputHealth.get(engine);
  if (!health || health.state === "ok" || health.state === "unknown" || response.directOutput) return response;
  const annotated: NativeResponse = {
    ...response,
    outputDegraded: true,
    outputState: health.state,
    outputDevice: health.device,
    expectedOutputDevice: health.expectedDevice
  };
  // Without a running device the transport cannot advance or be heard. This is
  // reported beside ok:true, not as a failed status: the renderer treats !ok as
  // a lost backend, which would outlive the device coming back.
  if (health.state === "no-device" || health.state === "stalled")
    annotated.outputError = health.state === "no-device" ? "NATIVE_OUTPUT_DEVICE_LOST" : "NATIVE_OUTPUT_STALLED";
  return annotated;
}

/** Replays the lost host's file source on a new host: rack, load, seek, play. */
async function restoreLostSession() {
  const loss = engineLoss;
  const plan = loss?.plan;
  if (!loss || !plan) return false;
  loss.restoreAttempted = true;
  try {
    const engine = await acquireEngine();
    for (const command of [playbackJournal.volume, playbackJournal.fade]) {
      if (command) await requestFromEngine(engine, command);
    }
    if (plan.rack) {
      const rack = await requestFromEngine(engine, plan.rack) as NativeResponse;
      if (!rack.ok) throw new Error(`rack: ${String(rack.error || "failed")}`);
    }
    const loaded = await requestFromEngine(engine, plan.load) as NativeResponse;
    if (!loaded.ok) throw new Error(`load: ${String(loaded.error || "failed")}`);
    if (plan.position > 0.05)
      await requestFromEngine(engine, { type: "seek", position: plan.position });
    if (plan.playing) {
      const played = await requestFromEngine(engine, { type: "play" }) as NativeResponse;
      if (!played.ok) throw new Error(`play: ${String(played.error || "failed")}`);
    }
    if (engineLoss !== loss || !nativePlaybackEngineGate().isCurrent(engine)) return false;
    engineLoss = null;
    Object.assign(playbackJournal, { sourceKind: "file", load: plan.load, rack: plan.rack, position: plan.position, playing: plan.playing });
    writeLog("AUDIO", `Native session restored after host loss: position=${plan.position.toFixed(2)}; playing=${plan.playing}`);
    return true;
  } catch (error) {
    if (engineLoss === loss) loss.restorable = false;
    writeLog("AUDIO", `Native session restore failed; reporting the lost host instead: ${errorText(error)}`);
    return false;
  }
}

function recordJournal(command: Record<string, unknown>, response: NativeResponse) {
  const type = command.type;
  if (type === "volume") playbackJournal.volume = { type: "volume", value: command.value };
  else if (type === "fade") playbackJournal.fade = { type: "fade", durationMs: command.durationMs };
  if (!response.ok) return;
  if (type === "load") {
    playbackJournal.sourceKind = "file";
    playbackJournal.load = { ...command };
    playbackJournal.position = 0;
    playbackJournal.playing = false;
  } else if (type === "direct-load" || type === "pcm-start") {
    playbackJournal.sourceKind = "other";
    playbackJournal.load = null;
  } else if (type === "pcm-stop" || type === "direct-close") {
    if (playbackJournal.sourceKind === "other") playbackJournal.sourceKind = "none";
  } else if (type === "rack") playbackJournal.rack = { ...command };
  else if (type === "play") playbackJournal.playing = true;
  else if (type === "pause") playbackJournal.playing = false;
  else if (type === "seek") playbackJournal.position = Math.max(0, Number(command.position) || 0);
  else if (type === "status" && playbackJournal.sourceKind === "file"
      && response.playbackToken === playbackJournal.load?.playbackToken) {
    playbackJournal.position = Math.max(0, Number(response.position) || 0);
    playbackJournal.playing = Boolean(response.playing);
  }
}

const SOURCE_COMMANDS = new Set(["load", "direct-load", "pcm-start"]);
// Commands about the lost source: they must not start an empty host.
const LOST_SOURCE_COMMANDS = new Set(["status", "play", "seek"]);
const DEFERRABLE_COMMANDS = new Set(["pause", "volume", "fade"]);

/** Answers a command while a lost host is pending, or returns null to forward it. */
async function handleWhileEngineLost(command: Record<string, unknown>): Promise<NativeResponse | null> {
  const type = String(command.type || "");
  if (!engineLoss || SOURCE_COMMANDS.has(type)) return null;
  const current = playbackEngineGate?.current();
  const live = current && isEngineAlive(current) ? current : null;
  const plan = engineLoss.plan;
  if (type === "rack" && plan) {
    // The replacement must get the rack the user has now, not the one that died.
    plan.rack = { ...command };
    return null;
  }
  if (DEFERRABLE_COMMANDS.has(type)) {
    if (type === "pause" && plan) plan.playing = false;
    else if (type !== "pause") recordJournal(command, { ok: true });
    return live ? null : { ok: true, deferred: true, engineLost: true };
  }
  if (!LOST_SOURCE_COMMANDS.has(type)) return null;
  if (type === "play" && plan) plan.playing = true;
  if (type === "seek" && plan) plan.position = Math.max(0, Number(command.position) || 0);
  if (engineLoss.restorable && !engineLoss.restoreAttempted && !sessionRestore)
    sessionRestore = restoreLostSession().finally(() => { sessionRestore = null; });
  const restore = sessionRestore;
  // The restore already applied this play/seek; replaying it would restart the fade.
  if (restore && await restore) return type === "status" ? null : { ok: true, engineRestored: true };
  return engineLoss ? engineLostResponse() : null;
}

async function forwardPlaybackCommand(command: Record<string, unknown>): Promise<NativeResponse> {
  const answered = await handleWhileEngineLost(command);
  if (answered) return answered;
  const engine = await acquireEngine();
  let response: NativeResponse;
  try {
    response = await requestFromEngine(engine, command) as NativeResponse;
  } catch (error) {
    // A status that was in flight when its host died goes through the loss
    // handling like the next poll would: restore once, otherwise report it.
    if (command.type === "status" && engineLoss?.engineInstance === engineInstances.get(engine))
      return await handleWhileEngineLost(command) ?? forwardPlaybackCommand(command);
    throw error;
  }
  if (!response || typeof response !== "object") return response;
  recordJournal(command, response);
  if (response.ok && SOURCE_COMMANDS.has(String(command.type)) && engineLoss) {
    writeLog("AUDIO", `Native host loss cleared by a new source: ${String(command.type)}`);
    engineLoss = null;
  }
  if (command.type !== "status") return response;
  scheduleOutputHealthCheck(engine);
  return annotateStatus(engine, response);
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
  if (command.type !== "device-apply" && command.type !== "output") return forwardPlaybackCommand(command);
  outputCommandGeneration++;
  outputCommandsInFlight++;
  try { return await forwardPlaybackCommand(command); }
  finally {
    outputCommandsInFlight--;
    outputCommandGeneration++;
  }
}

export async function ensureNativeOutputRestored() {
  // A host that is not running restores its output as part of being started
  // by the next real command; starting one here would let a status poll
  // silently replace a crashed host with an empty one.
  const engine = playbackEngineGate?.current();
  if (!engine || !isEngineAlive(engine)) return;
  await restoreOutputFor(engine);
}

/** Current crash and output-health state, for diagnostics. */
export function nativeEngineHealthSnapshot() {
  const engine = playbackEngineGate?.current();
  const health = engine ? outputHealth.get(engine) : undefined;
  return {
    engineInstance: engine ? engineInstances.get(engine) ?? 0 : 0,
    engineLost: Boolean(engineLoss),
    engineLossReason: engineLoss?.reason || "",
    engineLossCount: engineLoss?.count || 0,
    restorable: Boolean(engineLoss?.restorable && !engineLoss.restoreAttempted),
    outputState: health?.state || "unknown",
    outputDevice: health?.device || "",
    expectedOutputDevice: health?.expectedDevice || "",
    unterminatedHosts: playbackEngineGate?.unterminatedProcesses().length || 0
  };
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

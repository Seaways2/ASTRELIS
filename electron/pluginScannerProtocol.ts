import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import {
  PLUGIN_SCANNER_PROTOCOL,
  PLUGIN_SCANNER_PROTOCOL_VERSION,
  type ScannerFailure,
  type ScannerPluginRecord,
  type ScannerStage
} from "./pluginDomain";

interface ScannerFrameBase {
  protocol: string;
  version: number;
  type: string;
  modulePath?: string;
  elapsedMs?: number;
}

interface ScannerHelloFrame extends ScannerFrameBase { type: "hello"; }
interface ScannerProgressFrame extends ScannerFrameBase {
  type: "progress";
  stage: ScannerStage;
  pluginId?: string;
}
interface ScannerResultFrame extends ScannerFrameBase {
  type: "result";
  plugins: ScannerPluginRecord[];
  failures?: ScannerFailure[];
  lastStage?: ScannerStage;
}
type ScannerFrame = ScannerHelloFrame | ScannerProgressFrame | ScannerResultFrame;

export interface PluginModuleInspection {
  records: ScannerPluginRecord[];
  failures: ScannerFailure[];
  protocolVersion: number;
  elapsedMs: number;
  lastStage: ScannerStage;
  stderrSummary: string;
}

const scannerStages = new Set<ScannerStage>([
  "MODULE_LOAD", "ENUMERATION", "INSTANTIATION", "BUS_PROBE",
  "PREPARE", "PROCESS_TEST", "RELEASE", "DESTROY"
]);

function numericTimeout(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(120_000, Math.max(5_000, Math.round(parsed))) : undefined;
}

export function scannerTimeoutForModule(modulePath: string) {
  return numericTimeout(process.env.AURALIS_PLUGIN_SCAN_TIMEOUT_MS)
    ?? (/waveshell/i.test(path.basename(modulePath)) ? 60_000 : 25_000);
}

export function parseScannerFrame(line: string): ScannerFrame | undefined {
  let value: unknown;
  try { value = JSON.parse(line); }
  catch { return undefined; }
  if (!value || typeof value !== "object") return undefined;
  const frame = value as Partial<ScannerFrame>;
  if (frame.protocol !== PLUGIN_SCANNER_PROTOCOL || typeof frame.version !== "number" || typeof frame.type !== "string")
    return undefined;
  if (frame.type === "progress" && (!frame.stage || !scannerStages.has(frame.stage))) return undefined;
  if (frame.type === "result" && !Array.isArray(frame.plugins)) return undefined;
  if (frame.type !== "hello" && frame.type !== "progress" && frame.type !== "result") return undefined;
  return frame as ScannerFrame;
}

function failure(
  code: ScannerFailure["code"],
  modulePath: string,
  stage: ScannerStage,
  elapsedMs: number,
  message: string,
  extra: Partial<ScannerFailure> = {}
): ScannerFailure {
  return { code, modulePath, stage, elapsedMs: Math.max(0, Math.round(elapsedMs)), message, ...extra };
}

export function classifyScannerExit(
  modulePath: string,
  stage: ScannerStage,
  elapsedMs: number,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  diagnostics: string
) {
  const detail = diagnostics.trim().slice(-2000);
  if (signal || (exitCode != null && (exitCode < 0 || exitCode >= 0x80000000)))
    return failure("PLUGIN_CRASHED", modulePath, stage, elapsedMs,
      `插件扫描子进程崩溃${signal ? ` (${signal})` : exitCode != null ? ` (0x${(exitCode >>> 0).toString(16)})` : ""}${detail ? `：${detail}` : ""}`,
      exitCode == null ? {} : { exitCode });
  return failure("NONZERO_EXIT", modulePath, stage, elapsedMs,
    `插件扫描子进程异常退出${exitCode == null ? "" : ` (${exitCode})`}${detail ? `：${detail}` : ""}`,
    exitCode == null ? {} : { exitCode });
}

function isArchitectureError(error: Error & { code?: string | number; errno?: string | number }) {
  const text = `${error.code ?? ""} ${error.errno ?? ""} ${error.message}`.toLocaleLowerCase();
  return /bad[_ -]?exe|win32|not a valid|architecture|193|%1/.test(text);
}

export function inspectPluginModule(
  executable: string,
  modulePath: string,
  onProgress?: (stage: ScannerStage, elapsedMs: number, pluginId?: string) => void,
  signal?: AbortSignal
): Promise<PluginModuleInspection> {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const timeoutMs = scannerTimeoutForModule(modulePath);
    let lastStage: ScannerStage = "MODULE_LOAD";
    let helloReceived = false;
    let resultFrame: ScannerResultFrame | undefined;
    let versionMismatch: number | undefined;
    let diagnostics = "";
    let timedOut = false;
    let settled = false;
    let abortHandler: (() => void) | undefined;

    const child = spawn(executable, ["--scan-module", modulePath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (inspection: PluginModuleInspection) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
      resolve(inspection);
    };
    const failed = (scanFailure: ScannerFailure) => finish({
      records: [], failures: [scanFailure], protocolVersion: PLUGIN_SCANNER_PROTOCOL_VERSION,
      elapsedMs: scanFailure.elapsedMs, lastStage: scanFailure.stage,
      stderrSummary: diagnostics.trim().slice(-4000)
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      const elapsedMs = Date.now() - startedAt;
      failed(failure("SCAN_TIMEOUT", modulePath, lastStage, elapsedMs,
        `插件扫描在 ${lastStage} 阶段超过 ${timeoutMs} ms`));
    }, timeoutMs);

    abortHandler = () => {
      child.kill();
      const elapsedMs = Date.now() - startedAt;
      const disabled = signal?.reason === "disable";
      failed(failure(disabled ? "USER_DISABLED" : "USER_SKIPPED", modulePath, lastStage, elapsedMs,
        disabled ? "用户已禁用此插件，后续扫描将自动跳过" : "用户已跳过当前插件"));
    };
    if (signal?.aborted) abortHandler();
    else signal?.addEventListener("abort", abortHandler, { once: true });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => {
      diagnostics = `${diagnostics}${String(chunk)}`.slice(-64 * 1024);
    });

    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", line => {
      const frame = parseScannerFrame(line);
      if (!frame) return; // Arbitrary third-party output is never a protocol payload.
      if (frame.version !== PLUGIN_SCANNER_PROTOCOL_VERSION) {
        versionMismatch = frame.version;
        return;
      }
      if (frame.type === "hello") helloReceived = true;
      if (frame.type === "progress") {
        lastStage = frame.stage;
        onProgress?.(frame.stage, Number(frame.elapsedMs) || Date.now() - startedAt, frame.pluginId);
      }
      if (frame.type === "result") resultFrame = frame;
    });

    child.once("error", rawError => {
      const elapsedMs = Date.now() - startedAt;
      const error = rawError as Error & { code?: string | number; errno?: string | number };
      failed(failure(isArchitectureError(error) ? "ARCHITECTURE_MISMATCH" : "NONZERO_EXIT",
        modulePath, lastStage, elapsedMs, error.message));
    });

    child.once("close", (exitCode, signal) => {
      if (settled || timedOut) return;
      const elapsedMs = Date.now() - startedAt;
      if (exitCode !== 0) {
        failed(classifyScannerExit(modulePath, lastStage, elapsedMs, exitCode, signal, diagnostics));
        return;
      }
      if (versionMismatch !== undefined) {
        failed(failure("SCAN_PROTOCOL_ERROR", modulePath, lastStage, elapsedMs,
          `扫描协议版本不兼容：期望 ${PLUGIN_SCANNER_PROTOCOL_VERSION}，收到 ${versionMismatch}`,
          { expectedVersion: PLUGIN_SCANNER_PROTOCOL_VERSION, receivedVersion: versionMismatch }));
        return;
      }
      if (!helloReceived || !resultFrame) {
        failed(failure("SCAN_PROTOCOL_ERROR", modulePath, lastStage, elapsedMs,
          `扫描器未返回完整的 hello/result 帧${diagnostics.trim() ? `：${diagnostics.trim().slice(-1000)}` : ""}`));
        return;
      }
      const reportedStage = resultFrame.lastStage && scannerStages.has(resultFrame.lastStage)
        ? resultFrame.lastStage : lastStage;
      finish({
        records: resultFrame.plugins,
        failures: Array.isArray(resultFrame.failures) ? resultFrame.failures : [],
        protocolVersion: PLUGIN_SCANNER_PROTOCOL_VERSION,
        elapsedMs: Number(resultFrame.elapsedMs) || elapsedMs,
        lastStage: reportedStage,
        stderrSummary: diagnostics.trim().slice(-4000)
      });
    });
  });
}

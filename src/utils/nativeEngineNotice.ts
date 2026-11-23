// How the renderer reads the native host's health fields (electron/
// nativePlaybackEngine.ts engineLostResponse and annotateStatus).

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface NativeHealthReply {
  ok?: boolean;
  error?: string;
  engineLost?: boolean;
  engineLossCount?: number;
  suspectPlugins?: unknown;
  outputDegraded?: boolean;
  outputState?: string;
  outputDevice?: string;
  expectedOutputDevice?: string;
  outputError?: string;
}

/** The reply a failed native command carried, attached to the error it threw. */
export const nativeReplyOf = (error: unknown): NativeHealthReply | undefined => {
  const reply = (error as { nativeReply?: unknown } | null | undefined)?.nativeReply;
  return reply && typeof reply === "object" ? reply as NativeHealthReply : undefined;
};

// Also an Error from another realm (a test sandbox, say).
const isError = (value: unknown): value is Error =>
  value instanceof Error || Object.prototype.toString.call(value) === "[object Error]";

/**
 * True when a reply, or the error a failed command threw, says the native
 * host process is gone (NATIVE_ENGINE_LOST). A deferred command answered
 * while the host is gone ({ ok: true, deferred: true, engineLost: true }) did
 * not fail and is not a loss report.
 */
export function isNativeEngineLost(value: unknown) {
  const reply = isError(value) ? nativeReplyOf(value) : value as NativeHealthReply | null | undefined;
  if (reply && reply.ok === false && reply.engineLost === true) return true;
  const message = isError(value) ? value.message : typeof value === "string" ? value : reply?.ok === false ? reply.error : undefined;
  return typeof message === "string" && message.startsWith("NATIVE_ENGINE_LOST");
}

/**
 * The notice for a lost host. Plug-ins are named only after repeated losses:
 * one crash says little about which module caused it.
 */
export function nativeEngineLostNotice(t: Translate, reply: NativeHealthReply | undefined, pluginName: (id: string) => string) {
  const count = Math.max(0, Math.floor(Number(reply?.engineLossCount) || 0));
  const ids = Array.isArray(reply?.suspectPlugins)
    ? [...new Set((reply!.suspectPlugins as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
  if (count >= 2 && ids.length) return t("native.engineLostPlugins", { count, plugins: ids.map(pluginName).join(", ") });
  return t("native.engineLost");
}

export interface NativeOutputNotice {
  /** Changes only when the condition changes, so a poll does not repeat it. */
  id: string;
  text: string;
  /** Lost or stalled output lasts until the device is back. */
  persistent: boolean;
}

/** The output condition a successful status reports, or null when it is fine. */
export function nativeOutputNotice(t: Translate, status: NativeHealthReply | undefined): NativeOutputNotice | null {
  if (!status?.ok) return null;
  if (status.outputError === "NATIVE_OUTPUT_DEVICE_LOST")
    return { id: "device-lost", text: t("native.outputDeviceLost"), persistent: true };
  if (status.outputError === "NATIVE_OUTPUT_STALLED")
    return { id: "stalled", text: t("native.outputStalled"), persistent: true };
  if (status.outputDegraded && status.outputState === "fallback-device") {
    const device = typeof status.outputDevice === "string" ? status.outputDevice.trim() : "";
    const expected = typeof status.expectedOutputDevice === "string" ? status.expectedOutputDevice.trim() : "";
    if (!device) return null;
    return {
      id: `fallback:${expected}>${device}`,
      text: expected ? t("native.outputFallback", { expected, device }) : t("native.outputFallbackUnnamed", { device }),
      persistent: false
    };
  }
  return null;
}

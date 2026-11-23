import type { Display, Rectangle } from "electron";

// Field reports from high-DPI machines (4K at 225-300 % scaling, older GPUs)
// could not be diagnosed from auralis.log alone: it never said which scale
// factor, work area or acceleration mode the player was running with. These
// formatters keep that information to one compact line per display / GPU so
// the log stays readable, and stay free of runtime Electron imports so they
// can be unit tested in plain Node.

export type DisplayInfo = Pick<Display, "id" | "label" | "scaleFactor" | "bounds" | "workArea" | "rotation" | "internal" | "displayFrequency">;

const FIELD_LIMIT = 120;
/** Driver and monitor strings come from the OS; a broken one must not flood the log. */
function clip(value: unknown, limit = FIELD_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}
function num(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function rect(area: Rectangle | undefined) {
  if (!area) return "?";
  return `${num(area.x) ?? "?"},${num(area.y) ?? "?"} ${num(area.width) ?? "?"}x${num(area.height) ?? "?"}`;
}

/**
 * One line per display. `px~` is the physical size derived from DIP bounds;
 * Windows rounds the DIP size, so 4096 px at 2.25x comes back as 1820 DIP and
 * multiplies to 4095. The tilde marks it as approximate.
 */
export function describeDisplays(displays: DisplayInfo[], primaryId: number | undefined, windowDisplayId: number | undefined, reason: string): string[] {
  if (!displays.length) return [`${reason} no displays reported`];
  return displays.map((display, index) => {
    const scale = num(display.scaleFactor), width = num(display.bounds?.width), height = num(display.bounds?.height);
    const physical = scale !== undefined && width !== undefined && height !== undefined ? `${Math.round(width * scale)}x${Math.round(height * scale)}` : "?";
    const label = clip(display.label);
    const hz = Math.round(num(display.displayFrequency) ?? 0);
    return `${reason} ${index + 1}/${displays.length} id=${display.id}${label ? ` ${JSON.stringify(label)}` : ""}`
      + `${display.id === primaryId ? " primary" : ""}${windowDisplayId !== undefined && display.id === windowDisplayId ? " window" : ""}`
      + ` scale=${scale ?? "?"} bounds=${rect(display.bounds)} work=${rect(display.workArea)} px~${physical}`
      + ` rot=${num(display.rotation) ?? 0}${hz > 0 ? ` ${hz}Hz` : ""} internal=${display.internal ? "yes" : "no"}`;
  });
}

/**
 * Chromium's feature map has ~15 keys whose values are mostly "enabled";
 * grouping by value halves the line and makes the disabled ones stand out.
 */
export function describeGpuFeatureStatus(status: unknown): string {
  if (!status || typeof status !== "object" || Array.isArray(status)) return "features=unknown";
  const entries = Object.entries(status as Record<string, unknown>).map(([key, value]) => [clip(key, 40), clip(value, 40)] as const);
  const compositing = entries.find(([key]) => key === "gpu_compositing")?.[1];
  const acceleration = compositing === undefined ? "unknown" : compositing.startsWith("enabled") ? "hardware" : "software";
  const groups = new Map<string, string[]>();
  for (const [key, value] of entries) groups.set(value, [...(groups.get(value) || []), key]);
  const grouped = [...groups.keys()].sort().map(value => `${value || "empty"}[${groups.get(value)!.sort().join(",")}]`);
  return [`acceleration=${acceleration}`, ...grouped].join(" ");
}

function hexId(value: unknown) {
  const id = num(value);
  return id === undefined ? "?" : `0x${Math.trunc(id).toString(16).padStart(4, "0")}`;
}

/** Reads app.getGPUInfo("basic") defensively; its shape is untyped and varies per driver. */
export function describeGpuDevices(info: unknown): string {
  const record = info && typeof info === "object" ? info as Record<string, unknown> : {};
  const devices = Array.isArray(record.gpuDevice) ? record.gpuDevice.filter(device => device && typeof device === "object") as Record<string, unknown>[] : [];
  if (!devices.length) return "devices=none reported";
  const described = devices.map(device => {
    const name = clip(device.deviceString) || "unnamed";
    const driver = [clip(device.driverVendor), clip(device.driverVersion)].filter(Boolean).join(" ");
    return `${device.active ? "*" : ""}${name}${driver ? ` driver=${driver}` : ""} (${hexId(device.vendorId)}:${hexId(device.deviceId)})`;
  }).join(" | ");
  const aux = record.auxAttributes && typeof record.auxAttributes === "object" ? record.auxAttributes as Record<string, unknown> : {};
  const renderer = clip(aux.glRenderer);
  return renderer ? `${described} gl=${JSON.stringify(renderer)}` : described;
}

export interface DisplayLogTimers { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void }

/**
 * Trailing debounce for display log lines. Windows fires several
 * display-metrics-changed events for one scale or taskbar change; only the
 * settled state is worth logging, together with every distinct reason seen.
 */
export class DisplayLogScheduler {
  private readonly reasons = new Set<string>();
  private handle: unknown;
  private pending = false;
  constructor(
    private readonly flush: (reasons: string[]) => void,
    private readonly delayMs = 500,
    private readonly timers: DisplayLogTimers = { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as NodeJS.Timeout) }
  ) {}
  schedule(reason: string) {
    this.reasons.add(reason);
    if (this.pending) this.timers.clear(this.handle);
    this.pending = true;
    this.handle = this.timers.set(() => {
      this.pending = false; this.handle = undefined;
      const reasons = [...this.reasons];
      this.reasons.clear();
      this.flush(reasons);
    }, this.delayMs);
  }
  dispose() {
    if (this.pending) this.timers.clear(this.handle);
    this.pending = false; this.handle = undefined;
    this.reasons.clear();
  }
}

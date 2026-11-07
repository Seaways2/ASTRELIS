import fs from "node:fs";
import path from "node:path";

export interface DesktopPreferences {
  alwaysOnTop: boolean;
  rememberWindowState: boolean;
  mediaKeysEnabled: boolean;
  closeBehavior: "tray" | "quit";
}

export interface DesktopPreferencesResult {
  ok: boolean;
  preferences: DesktopPreferences;
  error?: string;
}

export const defaultDesktopPreferences: Readonly<DesktopPreferences> = Object.freeze({
  alwaysOnTop: false,
  rememberWindowState: true,
  mediaKeysEnabled: true,
  closeBehavior: "tray"
});

export function normalizeDesktopPreferences(value: unknown): DesktopPreferences {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    alwaysOnTop: typeof input.alwaysOnTop === "boolean" ? input.alwaysOnTop : false,
    rememberWindowState: typeof input.rememberWindowState === "boolean" ? input.rememberWindowState : true,
    mediaKeysEnabled: typeof input.mediaKeysEnabled === "boolean" ? input.mediaKeysEnabled : true,
    closeBehavior: input.closeBehavior === "quit" ? "quit" : "tray"
  };
}

export function validateDesktopPreferencesPatch(value: unknown): Partial<DesktopPreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("桌面设置格式无效");
  const patch: Partial<DesktopPreferences> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "closeBehavior") {
      if (item !== "tray" && item !== "quit") throw new Error("关闭按钮行为无效");
      patch.closeBehavior = item;
    } else if (key === "alwaysOnTop" || key === "rememberWindowState" || key === "mediaKeysEnabled") {
      if (typeof item !== "boolean") throw new Error(`桌面设置 ${key} 必须为开关值`);
      patch[key] = item;
    } else throw new Error(`不支持的桌面设置：${key}`);
  }
  return patch;
}

const mediaKeys = [
  ["MediaPlayPause", "toggle"],
  ["MediaPreviousTrack", "previous"],
  ["MediaNextTrack", "next"],
  ["MediaStop", "stop"]
] as const;
type MediaAction = typeof mediaKeys[number][1];

/** Own only these registrations; failed enabling releases its partial work. */
export class DesktopMediaKeys {
  private owned = new Set<string>();
  constructor(private shortcuts: {
    register(accelerator: string, callback: () => void): boolean;
    unregister(accelerator: string): void;
  }, private onAction: (action: MediaAction) => void) {}

  setEnabled(enabled: boolean) {
    if (!enabled) {
      for (const accelerator of this.owned) this.shortcuts.unregister(accelerator);
      this.owned.clear();
      return;
    }
    const added: string[] = [];
    try {
      for (const [accelerator, action] of mediaKeys) {
        if (this.owned.has(accelerator)) continue;
        if (!this.shortcuts.register(accelerator, () => this.onAction(action)))
          throw new Error(`媒体快捷键注册失败：${accelerator}，可能已被其他程序占用`);
        this.owned.add(accelerator);
        added.push(accelerator);
      }
    } catch (error) {
      for (const accelerator of added) {
        this.shortcuts.unregister(accelerator);
        this.owned.delete(accelerator);
      }
      throw error;
    }
  }
}

interface DesktopRuntime {
  setAlwaysOnTop(enabled: boolean): void;
  setMediaKeysEnabled(enabled: boolean): void;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export class DesktopPreferenceService {
  private preferences: DesktopPreferences = { ...defaultDesktopPreferences };
  private error: string | undefined;
  constructor(private filePath: string, private runtime: DesktopRuntime) {
    try {
      this.preferences = normalizeDesktopPreferences(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.error = `桌面设置读取失败，已使用默认值：${errorMessage(error)}`;
    }
  }

  initialize(): DesktopPreferencesResult {
    try { this.runtime.setMediaKeysEnabled(this.preferences.mediaKeysEnabled); }
    catch (error) {
      this.preferences.mediaKeysEnabled = false;
      this.error = errorMessage(error);
    }
    try { this.runtime.setAlwaysOnTop(this.preferences.alwaysOnTop); }
    catch (error) {
      this.preferences.alwaysOnTop = false;
      this.error = errorMessage(error);
    }
    return this.get();
  }

  get(): DesktopPreferencesResult {
    return { ok: !this.error, preferences: { ...this.preferences }, ...(this.error ? { error: this.error } : {}) };
  }

  update(value: unknown): DesktopPreferencesResult {
    const previous = this.preferences;
    let next: DesktopPreferences;
    try { next = { ...previous, ...validateDesktopPreferencesPatch(value) }; }
    catch (error) { return { ok: false, preferences: { ...previous }, error: errorMessage(error) }; }
    try {
      this.runtime.setMediaKeysEnabled(next.mediaKeysEnabled);
      this.runtime.setAlwaysOnTop(next.alwaysOnTop);
      // A sibling temporary file lets rename keep the previous valid file on
      // write failure; updates never delete window-state or other user data.
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      try {
        fs.writeFileSync(temporaryPath, JSON.stringify(next, null, 2), "utf8");
        fs.renameSync(temporaryPath, this.filePath);
      } finally {
        try { fs.unlinkSync(temporaryPath); } catch { /* Already renamed or never created. */ }
      }
      this.preferences = next;
      this.error = undefined;
      return this.get();
    } catch (error) {
      const errors = [errorMessage(error)];
      // Runtime changes are reversible. Keep the old persisted preference if
      // either registration or writing failed and report a rollback failure.
      try { this.runtime.setMediaKeysEnabled(previous.mediaKeysEnabled); }
      catch (rollbackError) {
        this.preferences = { ...this.preferences, mediaKeysEnabled: false };
        errors.push(errorMessage(rollbackError));
      }
      try { this.runtime.setAlwaysOnTop(previous.alwaysOnTop); }
      catch (rollbackError) { errors.push(errorMessage(rollbackError)); }
      this.error = errors.join("；");
      return this.get();
    }
  }
}

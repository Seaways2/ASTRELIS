import path from "node:path";
import { app, type BrowserWindow } from "electron";

type OutlineModule = {
  restoreTransparency(handle: Buffer): boolean;
  apply(handle: Buffer, square: boolean): boolean;
  setAccentAcrylic(handle: Buffer, enabled: boolean): boolean;
};
let outline: OutlineModule | undefined;

/**
 * Let DWM own the window contour: rounded while floating, square while the
 * window fills the screen. Electron emulates maximize for transparent
 * frameless windows, so DWM cannot detect that state itself.
 */
export function applyNativeWindowOutline(window: BrowserWindow): void {
  if (!outline) {
    const file = app.isPackaged
      ? path.join(process.resourcesPath, "native-window", "window_outline.node")
      : path.join(__dirname, "../native-window/build/Release/window_outline.node");
    outline = require(file) as OutlineModule;
  }
  const fillsScreen = window.isMaximized() || window.isFullScreen();
  if (!outline.apply(window.getNativeWindowHandle(), fillsScreen)) {
    throw new Error("Windows rejected the native window region");
  }
}

/** Apply the Win32 Accent Acrylic path instead of Windows 11 Desktop Acrylic. */
export function setNativeAccentAcrylic(window: BrowserWindow, enabled: boolean): void {
  if (!outline) {
    const file = app.isPackaged
      ? path.join(process.resourcesPath, "native-window", "window_outline.node")
      : path.join(__dirname, "../native-window/build/Release/window_outline.node");
    outline = require(file) as OutlineModule;
  }
  if (!outline.setAccentAcrylic(window.getNativeWindowHandle(), enabled)) {
    throw new Error("Windows rejected the Accent Acrylic policy");
  }
}

/** Restore per-pixel alpha after Mica/Accent Acrylic has been disabled. */
export function restoreNativeTransparency(window: BrowserWindow): void {
  if (!outline || !outline.restoreTransparency(window.getNativeWindowHandle()))
    throw new Error("Windows rejected transparent client composition");
  window.setBackgroundColor("#00000000");
}

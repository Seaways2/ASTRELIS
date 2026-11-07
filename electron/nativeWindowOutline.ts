import path from "node:path";
import { app, type BrowserWindow } from "electron";

type OutlineModule = {
  restoreTransparency(handle: Buffer): boolean;
  apply(handle: Buffer, square: boolean): boolean;
  setAccentAcrylic(handle: Buffer, enabled: boolean): boolean;
};
let outline: OutlineModule | undefined;

/** Clip the HWND itself, including DWM's backing, in physical pixels. */
export function applyNativeWindowOutline(window: BrowserWindow): void {
  if (!outline) {
    const file = app.isPackaged
      ? path.join(process.resourcesPath, "native-window", "window_outline.node")
      : path.join(__dirname, "../native-window/build/Release/window_outline.node");
    outline = require(file) as OutlineModule;
  }
  // Rounded native regions expose a corner of the DWM Mica/Acrylic backing on
  // some Windows compositors. Keep the HWND rectangular in every window state.
  if (!outline.apply(window.getNativeWindowHandle(), true)) {
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

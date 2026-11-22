import { fillsDisplay, restorableNormalBounds, type DisplayAreas, type FitBounds } from "./windowFit";

/**
 * Everything the window-state decisions read, taken from the BrowserWindow in
 * one place. Electron emulates maximize and fullscreen for this transparent
 * thickFrame:false window by resizing it, so `bounds` alone can mean
 * "maximized" (HTML fullscreen reports neither state).
 */
export interface WindowSnapshot {
  bounds: FitBounds;
  /** Electron's restore rectangle; fullscreen entered while maximized overwrites it. */
  normalBounds: FitBounds;
  display: DisplayAreas;
  minimized: boolean;
  maximized: boolean;
  fullScreen: boolean;
  /** Closed to the tray: the window stays alive but invisible. */
  concealed: boolean;
  compact: boolean;
  immersive: boolean;
}

/** Exactly one applies, checked in this order. */
export type WindowPresentation =
  | "concealed" | "minimized" | "compact" | "immersive"
  | "fullscreen" | "maximized"
  /** Fills the display without a reported state: HTML fullscreen, a snap to full size. */
  | "covering"
  | "floating";

export function windowPresentation(window: WindowSnapshot): WindowPresentation {
  if (window.concealed) return "concealed";
  if (window.minimized) return "minimized";
  if (window.compact) return "compact";
  if (window.immersive) return "immersive";
  if (window.fullScreen) return "fullscreen";
  if (window.maximized) return "maximized";
  return fillsDisplay(window.bounds, window.display) ? "covering" : "floating";
}

/** Square contour and the "restore" titlebar icon: the window covers its display. */
export function windowFillsScreen(window: WindowSnapshot) {
  return window.maximized || window.fullScreen || fillsDisplay(window.bounds, window.display);
}

/**
 * Whether the maximize toggle (titlebar button, caption double-click) should
 * restore. isMaximized() alone is not enough: after a display scale change the
 * emulated maximize misses the work area by a pixel and Electron reports false,
 * so the toggle kept maximizing a window that already filled the screen.
 */
export function maximizeToggleRestores(window: WindowSnapshot) {
  return window.maximized || windowPresentation(window) === "covering";
}

export type WindowMode = "compact" | "immersive";

/**
 * Owns the window geometry the app has to remember itself: the last floating
 * bounds (Electron's own restore rectangle cannot be trusted, see
 * restorableNormalBounds), the bounds compact and immersive mode return to,
 * and whether the window currently fills the screen.
 */
export class WindowStateMachine {
  private floating?: FitBounds;
  private filling = false;
  private readonly modeRestore: Partial<Record<WindowMode, FitBounds>> = {};

  /** A new window: forget the previous one's geometry. */
  reset(window: WindowSnapshot) {
    this.floating = undefined;
    this.filling = windowFillsScreen(window);
    delete this.modeRestore.compact;
    delete this.modeRestore.immersive;
  }

  /**
   * Feed every resize, move and state event. Floating bounds are remembered;
   * `changed` reports a flip of the screen-filling state, which Electron does
   * not announce when it happens through setBounds (restore, manual resize, snap).
   */
  observe(window: WindowSnapshot): { filling: boolean; changed: boolean } {
    if (windowPresentation(window) === "floating") this.floating = { ...window.bounds };
    const filling = windowFillsScreen(window);
    const changed = filling !== this.filling;
    this.filling = filling;
    return { filling, changed };
  }

  get fillsScreen() {
    return this.filling;
  }

  /** Floating bounds to return to, valid even when Electron's restore rectangle was overwritten. */
  restoreBounds(window: WindowSnapshot): FitBounds {
    const reported = window.maximized || window.fullScreen ? window.normalBounds : window.bounds;
    return restorableNormalBounds(reported, window.display, this.floating);
  }

  enterMode(mode: WindowMode, window: WindowSnapshot) {
    this.modeRestore[mode] = this.restoreBounds(window);
  }

  /** Bounds to apply when leaving the mode, if it was entered. */
  leaveMode(mode: WindowMode): FitBounds | undefined {
    const bounds = this.modeRestore[mode];
    delete this.modeRestore[mode];
    return bounds;
  }

  /** What the next launch restores: never a compact, immersive or screen-filling rectangle. */
  persisted(window: WindowSnapshot): FitBounds & { maximized: boolean } {
    const bounds = (window.compact && this.modeRestore.compact)
      || (window.immersive && this.modeRestore.immersive)
      || this.restoreBounds(window);
    return { ...bounds, maximized: !window.compact && window.maximized };
  }
}

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

/** Where a mode returns to: the floating bounds, and whether the window was maximized when the mode began. */
export interface ModeRestore {
  bounds: FitBounds;
  maximized: boolean;
}

/**
 * Owns the window geometry the app has to remember itself: the last floating
 * bounds (Electron's own restore rectangle cannot be trusted, see
 * restorableNormalBounds), the state compact and immersive mode return to,
 * and whether the window currently fills the screen.
 */
export class WindowStateMachine {
  private floating?: FitBounds;
  private filling = false;
  /**
   * The maximized state last seen while the window was shown normally.
   * Electron reports isMaximized() === false for the emulated maximize while
   * the window is minimized, so that snapshot must not be persisted as is.
   */
  private lastMaximized = false;
  private readonly modeRestore: Partial<Record<WindowMode, ModeRestore>> = {};

  /** A new window: forget the previous one's geometry. */
  reset(window: WindowSnapshot) {
    this.floating = undefined;
    this.filling = windowFillsScreen(window);
    this.lastMaximized = window.maximized;
    delete this.modeRestore.compact;
    delete this.modeRestore.immersive;
  }

  /**
   * Feed every resize, move and state event. Floating bounds are remembered;
   * `changed` reports a flip of the screen-filling state, which Electron does
   * not announce when it happens through setBounds (restore, manual resize, snap).
   */
  observe(window: WindowSnapshot): { filling: boolean; changed: boolean } {
    const presentation = windowPresentation(window);
    if (presentation === "floating") this.floating = { ...window.bounds };
    // Immersive mode keeps the window's size; it can be maximized or restored there.
    if (presentation === "floating" || presentation === "maximized" || presentation === "covering" || presentation === "immersive")
      this.lastMaximized = window.maximized;
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

  /**
   * Remember where the mode returns to. Compact mode has to unmaximize the
   * window to shrink it, so a window that filled the screen (maximized, or
   * covering it without the reported state) returns maximized. Immersive mode
   * keeps the window's size and lets the user maximize or restore it, so it
   * never re-maximizes on the way out: `maximized` is always false there.
   */
  enterMode(mode: WindowMode, window: WindowSnapshot) {
    this.modeRestore[mode] = { bounds: this.restoreBounds(window), maximized: mode === "compact" && maximizeToggleRestores(window) };
  }

  /** Where to return when leaving the mode, if it was entered. */
  leaveMode(mode: WindowMode): ModeRestore | undefined {
    const restore = this.modeRestore[mode];
    delete this.modeRestore[mode];
    return restore;
  }

  /** What the next launch restores: never a compact, immersive or screen-filling rectangle. */
  persisted(window: WindowSnapshot): FitBounds & { maximized: boolean } {
    const maximized = window.compact ? false
      : window.minimized || window.concealed ? this.lastMaximized
        : window.maximized;
    if (window.compact && this.modeRestore.compact) return { ...this.modeRestore.compact.bounds, maximized: this.modeRestore.compact.maximized };
    // Immersive: the floating bounds it started from, the maximized state it is in now.
    if (window.immersive && this.modeRestore.immersive) return { ...this.modeRestore.immersive.bounds, maximized };
    return { ...this.restoreBounds(window), maximized };
  }
}

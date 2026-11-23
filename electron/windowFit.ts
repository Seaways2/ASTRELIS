export type FitBounds = {x:number;y:number;width:number;height:number};
/** All dimensions are Electron DIPs; Windows already accounts for display scaling. */
export function fitWindowBounds(bounds:FitBounds, work:FitBounds):FitBounds {
  const width=Math.min(work.width,Math.max(Math.min(640,work.width),Number.isFinite(bounds.width)?bounds.width:1500));
  const height=Math.min(work.height,Math.max(Math.min(400,work.height),Number.isFinite(bounds.height)?bounds.height:940));
  return {width:Math.round(width),height:Math.round(height),
    x:Math.round(Math.max(work.x,Math.min(work.x+work.width-width,Number.isFinite(bounds.x)?bounds.x:work.x))),
    y:Math.round(Math.max(work.y,Math.min(work.y+work.height-height,Number.isFinite(bounds.y)?bounds.y:work.y)))};
}
export function fittedUiZoom(width:number,height:number,specialMode=false) {
  if(specialMode || !Number.isFinite(width) || !Number.isFinite(height) || width<=0 || height<=0)return 1;
  return Math.max(.8,Math.min(1,width/1120,height/720));
}

export type DisplayAreas = { bounds?: FitBounds; workArea: FitBounds };

/**
 * DIP rounding slack. After a display scale or resolution change the emulated
 * maximize lands a pixel or so off the work area (1821/1822/1823 x 912/913 in
 * the 2.18.3 field log), and Electron then reports isMaximized() === false.
 */
const FILL_TOLERANCE = 4;

/**
 * Electron emulates maximize and fullscreen for a transparent thickFrame:false
 * window by resizing it to the work area or the display. A window that covers
 * the work area (the display bounds contain it) fills the screen, and such
 * bounds are never a usable "restore" size.
 */
export function fillsDisplay(bounds: FitBounds, display: DisplayAreas) {
  const area = display.workArea;
  return bounds.x <= area.x + FILL_TOLERANCE && bounds.y <= area.y + FILL_TOLERANCE
    && bounds.x + bounds.width >= area.x + area.width - FILL_TOLERANCE
    && bounds.y + bounds.height >= area.y + area.height - FILL_TOLERANCE;
}

/**
 * The bounds the window should return to when it stops filling the screen.
 * Entering fullscreen overwrites Electron's emulated restore rectangle with the
 * maximized bounds, so after leaving fullscreen `getNormalBounds()` reports the
 * work area and unmaximize() changes nothing. A window that was never
 * maximize()d but fills the work area (a default size larger than the screen)
 * also reports maximized, with an empty {0,0,0,0} restore rectangle. Prefer the
 * last floating bounds the app saw, then a centred default.
 */
export function restorableNormalBounds(reported: FitBounds, display: DisplayAreas, remembered?: FitBounds): FitBounds {
  if (usableFloatingBounds(reported, display)) return reported;
  if (remembered && usableFloatingBounds(remembered, display)) return fitWindowBounds(remembered, display.workArea);
  return centredDefaultBounds(display.workArea);
}

/** The floating size with nothing remembered: 75% of the work area, centred. */
export function centredDefaultBounds(work: FitBounds): FitBounds {
  const width = Math.round(work.width * .75), height = Math.round(work.height * .75);
  return fitWindowBounds({ x: work.x + Math.round((work.width - width) / 2), y: work.y + Math.round((work.height - height) / 2), width, height }, work);
}

/**
 * Earlier builds (LV03): the first restore of a window that filled the work area shrank
 * it to the minimum size in the top-left corner, and window-state.json kept
 * that rectangle as the floating size. A saved rectangle that is exactly that
 * (within DIP rounding) is the bug's trace, not a size the user chose.
 */
export function isCollapsedCornerBounds(bounds: FitBounds, work: FitBounds) {
  const near = (value: number, expected: number) => Math.abs(value - expected) <= 2;
  return near(bounds.x, work.x) && near(bounds.y, work.y)
    && near(bounds.width, Math.min(640, work.width)) && near(bounds.height, Math.min(400, work.height));
}

/** A floating size the window can return to: at least the window's minimum size, and not the whole screen. */
function usableFloatingBounds(bounds: FitBounds, display: DisplayAreas) {
  const work = display.workArea;
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width >= Math.min(640, work.width) && bounds.height >= Math.min(400, work.height)
    && !fillsDisplay(bounds, display);
}

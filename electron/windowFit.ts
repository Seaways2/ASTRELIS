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
const sameBounds = (a: FitBounds, b: FitBounds) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Electron emulates maximize and fullscreen for a transparent thickFrame:false
 * window by resizing it to the work area or the display. Such bounds are never
 * a usable "restore" size.
 */
export function fillsDisplay(bounds: FitBounds, display: DisplayAreas) {
  return sameBounds(bounds, display.workArea) || Boolean(display.bounds && sameBounds(bounds, display.bounds));
}

/**
 * The bounds the window should return to when it stops filling the screen.
 * Entering fullscreen overwrites Electron's emulated restore rectangle with the
 * maximized bounds, so after leaving fullscreen `getNormalBounds()` reports the
 * work area and unmaximize() changes nothing. Prefer the last floating bounds
 * the app saw, then a centred default.
 */
export function restorableNormalBounds(reported: FitBounds, display: DisplayAreas, remembered?: FitBounds): FitBounds {
  if (!fillsDisplay(reported, display)) return reported;
  if (remembered && !fillsDisplay(remembered, display)) return fitWindowBounds(remembered, display.workArea);
  const work = display.workArea, width = Math.round(work.width * .75), height = Math.round(work.height * .75);
  return fitWindowBounds({ x: work.x + Math.round((work.width - width) / 2), y: work.y + Math.round((work.height - height) / 2), width, height }, work);
}

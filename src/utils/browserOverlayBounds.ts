export interface OverlayRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const area = (bounds: BrowserBounds) => bounds.width * bounds.height;

export function browserBoundsAroundOverlay(surface: BrowserBounds, overlay: OverlayRect, gap = 8): BrowserBounds | null {
  const surfaceRight = surface.x + surface.width;
  const surfaceBottom = surface.y + surface.height;
  const intersects = overlay.left < surfaceRight && overlay.right > surface.x
    && overlay.top < surfaceBottom && overlay.bottom > surface.y;
  if (!intersects) return surface;

  const candidates: BrowserBounds[] = [
    { x: surface.x, y: surface.y, width: overlay.left - gap - surface.x, height: surface.height },
    { x: overlay.right + gap, y: surface.y, width: surfaceRight - overlay.right - gap, height: surface.height },
    { x: surface.x, y: surface.y, width: surface.width, height: overlay.top - gap - surface.y },
    { x: surface.x, y: overlay.bottom + gap, width: surface.width, height: surfaceBottom - overlay.bottom - gap }
  ].map(bounds => ({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.floor(bounds.width),
    height: Math.floor(bounds.height)
  })).filter(bounds => bounds.width > 0 && bounds.height > 0);

  return candidates.sort((left, right) => area(right) - area(left))[0] || null;
}

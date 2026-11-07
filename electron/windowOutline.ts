import type { Rectangle } from "electron";

// Native clipping also removes the Mica/Acrylic backing outside the CSS corners.
export function roundedWindowShape(width: number, height: number, square: boolean): Rectangle[] {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (square) return [{ x: 0, y: 0, width, height }];
  const radius = Math.min(12, Math.floor(width / 2), Math.floor(height / 2));
  const rects: Rectangle[] = [];
  for (let y = 0; y < radius; y++) {
    const dy = radius - y - .5;
    // Round inward so the native glass cannot extend beyond the CSS arc.
    const inset = Math.ceil(radius - Math.sqrt(radius * radius - dy * dy));
    rects.push({ x: inset, y, width: width - inset * 2, height: 1 });
    rects.push({ x: inset, y: height - y - 1, width: width - inset * 2, height: 1 });
  }
  if (height > radius * 2) rects.push({ x: 0, y: radius, width, height: height - radius * 2 });
  return rects;
}

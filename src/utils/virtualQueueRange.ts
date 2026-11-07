export function virtualQueueRange(total: number, rowHeight: number, visibleTop: number, viewportHeight: number, overscan = 5) {
  const count = Math.max(0, Math.floor(total));
  const height = Math.max(1, rowHeight);
  if (!count) return { offset: 0, limit: 0, totalHeight: 0 };
  // Queue deletion can shrink the body before the browser clamps scrollTop.
  const top = Math.min(Math.max(0, visibleTop), Math.max(0, count * height - viewportHeight));
  const offset = Math.max(0, Math.floor(top / height) - overscan);
  const end = Math.min(count, Math.ceil((top + viewportHeight) / height) + overscan);
  return { offset, limit: Math.max(0, end - offset), totalHeight: count * height };
}

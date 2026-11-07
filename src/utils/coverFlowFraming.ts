const STORAGE_KEY = "astrelis.library.cover-flow-framing.v1";
export const COVER_FLOW_FRAMING_EVENT = "astrelis:cover-flow-framing-change";

type FramingMap = Record<string, number>;
let framingCache: FramingMap | undefined;

function storedFraming(): FramingMap {
  if (framingCache) return framingCache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    framingCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as FramingMap : {};
  } catch {
    framingCache = {};
  }
  return framingCache;
}

export function automaticCoverFlowPosition(aspectRatio: number) {
  // A DVD wrap is usually a landscape spread near 3:2; use its front-cover side.
  return aspectRatio >= 1.35 && aspectRatio <= 1.7 ? 100 : 50;
}

export function shouldAutoCropCoverFlow(aspectRatio: number) {
  return aspectRatio >= 1.35 && aspectRatio <= 1.7;
}

export function hasCustomCoverFlowPosition(source: string) {
  return Number.isFinite(storedFraming()[source]);
}

export function getCoverFlowPosition(source: string, aspectRatio: number) {
  const saved = storedFraming()[source];
  return Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : automaticCoverFlowPosition(aspectRatio);
}

function commit(source: string, position: number | undefined) {
  const values = storedFraming();
  if (position === undefined) delete values[source];
  else values[source] = Math.max(0, Math.min(100, Math.round(position)));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* Keep the current session preference if storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent(COVER_FLOW_FRAMING_EVENT, { detail: { source, position } }));
}

export function setCoverFlowPosition(source: string, position: number) {
  commit(source, position);
}

export function resetCoverFlowPosition(source: string) {
  commit(source, undefined);
}

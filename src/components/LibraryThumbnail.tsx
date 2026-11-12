import { memo, useEffect, useRef, useState } from "react";
import { COVER_FLOW_FRAMING_EVENT, getCoverFlowPosition, hasCustomCoverFlowPosition, shouldAutoCropCoverFlow } from "../utils/coverFlowFraming";
import { LIBRARY_THUMBNAILS_REFRESH_EVENT } from "../utils/libraryThumbnailRefresh";

type ThumbnailSize = 256 | 512 | 1024;
type CachedThumbnail = { url: string; weight: number };
type ArtworkAttention = { focusY: number; topScore: number; bottomScore: number };

function estimateArtworkAttention(image: HTMLImageElement): ArtworkAttention | undefined {
  try {
    const side = 40;
    const canvas = new OffscreenCanvas(side, side);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(image, 0, 0, side, side);
    const pixels = context.getImageData(0, 0, side, side).data;
    const rowScores = new Float64Array(side);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const offset = (y * side + x) * 4;
        const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
        const luminance = red * .299 + green * .587 + blue * .114;
        const leftOffset = x ? offset - 4 : offset;
        const upperOffset = y ? offset - side * 4 : offset;
        const leftLuminance = pixels[leftOffset] * .299 + pixels[leftOffset + 1] * .587 + pixels[leftOffset + 2] * .114;
        const upperLuminance = pixels[upperOffset] * .299 + pixels[upperOffset + 1] * .587 + pixels[upperOffset + 2] * .114;
        const edge = Math.min(1, (Math.abs(luminance - leftLuminance) + Math.abs(luminance - upperLuminance)) / 150);
        const saturation = (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255;
        const likelySkin = red > 88 && green > 35 && blue > 18 && red > green * 1.06 && red > blue * 1.12 && green - blue > 8;
        rowScores[y] += edge * .68 + saturation * .11 + Number(likelySkin) * .62;
      }
      rowScores[y] /= side;
    }
    const bandScore = (from: number, to: number) => {
      let sum = 0;
      for (let y = from; y < to; y++) sum += rowScores[y];
      return sum / (to - from);
    };
    const topScore = bandScore(2, 13);
    const bottomScore = bandScore(27, 38);
    const total = rowScores.reduce((sum, score) => sum + score, 0);
    if (total < .05) return { focusY: 50, topScore, bottomScore };
    const weightedY = rowScores.reduce((sum, score, y) => sum + score * y, 0) / total;
    return { focusY: Math.max(20, Math.min(80, Math.round(weightedY / (side - 1) * 100))), topScore, bottomScore };
  } catch {
    return undefined;
  }
}

function updateEntryLabelPlacement(entry: HTMLElement) {
  const samples = Array.from(entry.querySelectorAll<HTMLImageElement>(".library-entry-media img[data-smart-top]"));
  if (!samples.length) {
    delete entry.dataset.labelEdge;
    return;
  }
  const top = samples.reduce((sum, image) => sum + Number(image.dataset.smartTop || 0), 0) / samples.length;
  const bottom = samples.reduce((sum, image) => sum + Number(image.dataset.smartBottom || 0), 0) / samples.length;
  entry.dataset.labelEdge = top + .025 < bottom ? "top" : "bottom";
}

// Keep ordinary library images small and cap the renderer's decoded thumbnail cache.
const cache = new Map<string, Promise<string>>();
const ready = new Map<string, CachedThumbnail>();
const failed = new Set<string>();
const dimensions = new Map<string, number>();
// Smart framing reads image pixels back on the main thread. A mosaic mounts
// hundreds of tiles, so each cover is analysed once and remembered.
const attentionBySource = new Map<string, ArtworkAttention>();
// The cache holds encoded thumbnail blobs (tens of KB each); decoded pixels belong
// to Chromium's own discardable image cache. Budgeting blobs at their decoded
// size capped a 512px video mosaic at ~128 covers, so a zoomed-out fullscreen
// mosaic (400+ covers) kept revoking and re-reading thumbnails it was showing.
const MAX_READY_WEIGHT = 96 * 1024 * 1024;
const MAX_SOURCE_METADATA = 512;
let readyWeight = 0;
function cacheKey(source: string, size: ThumbnailSize) { return `${size}\0${source}`; }
function rememberSourceValue<T>(values: Map<string, T>, key: string, value: T) {
  values.delete(key);
  values.set(key, value);
  while (values.size > MAX_SOURCE_METADATA) {
    const oldestKey = values.keys().next().value;
    if (oldestKey === undefined) break;
    values.delete(oldestKey);
  }
}
function rememberFailure(key: string) {
  failed.delete(key);
  failed.add(key);
  while (failed.size > MAX_SOURCE_METADATA) {
    const oldestKey = failed.values().next().value;
    if (oldestKey === undefined) break;
    failed.delete(oldestKey);
  }
}
function getReadyThumbnail(source: string, size: ThumbnailSize) {
  const key = cacheKey(source, size), cached = ready.get(key);
  if (!cached) return undefined;
  ready.delete(key);
  ready.set(key, cached);
  return cached.url;
}
function invalidateThumbnail(source: string, size: ThumbnailSize) {
  const key = cacheKey(source, size), cached = ready.get(key);
  cache.delete(key);
  if (cached) {
    ready.delete(key);
    readyWeight -= cached.weight;
    URL.revokeObjectURL(cached.url);
  }
  failed.delete(key);
}
function invalidateRefreshedThumbnails(event: Event) {
  const sources = (event as CustomEvent<{ sources?: string[] }>).detail?.sources;
  sources?.forEach(source => {
    attentionBySource.delete(source);
    invalidateThumbnail(source, 256);
    invalidateThumbnail(source, 512);
    invalidateThumbnail(source, 1024);
  });
}
function keepThumbnail(source: string, size: ThumbnailSize, blob: Blob) {
  const key = cacheKey(source, size), previous = ready.get(key);
  if (previous) { readyWeight -= previous.weight; URL.revokeObjectURL(previous.url); }
  const url = URL.createObjectURL(blob), weight = Math.max(1, blob.size);
  ready.set(key, { url, weight });
  readyWeight += weight;
  while (readyWeight > MAX_READY_WEIGHT && ready.size > 1) {
    const oldestKey = ready.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = ready.get(oldestKey)!;
    ready.delete(oldestKey);
    readyWeight -= oldest.weight;
    URL.revokeObjectURL(oldest.url);
  }
  return url;
}
function framingFor(source: string) {
  const ratio = dimensions.get(source) ?? 1;
  return { source, ratio, position: getCoverFlowPosition(source, ratio), crop: hasCustomCoverFlowPosition(source) || shouldAutoCropCoverFlow(ratio) };
}
function releaseThumbnails() {
  ready.forEach(item => URL.revokeObjectURL(item.url));
  ready.clear();
  failed.clear();
  dimensions.clear();
  cache.clear();
  readyWeight = 0;
}
window.addEventListener("pagehide", releaseThumbnails);
window.addEventListener(LIBRARY_THUMBNAILS_REFRESH_EVENT, invalidateRefreshedThumbnails);
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener("pagehide", releaseThumbnails);
  window.removeEventListener(LIBRARY_THUMBNAILS_REFRESH_EVENT, invalidateRefreshedThumbnails);
  releaseThumbnails();
});
let active = 0;
const MAX_ACTIVE_THUMBNAILS = 6;
const waiting: Array<() => void> = [];
async function thumbnail(source: string, size: ThumbnailSize): Promise<string> {
  const available = getReadyThumbnail(source, size);
  if (available) return available;
  const key = cacheKey(source, size), existing = cache.get(key);
  if (existing) return existing;
  if (failed.has(key)) throw new Error("Thumbnail unavailable");
  const task = (async () => {
    await new Promise<void>(resolve => {
      const start = () => { active++; resolve(); };
      if (active < MAX_ACTIVE_THUMBNAILS) start(); else waiting.push(start);
    });
    try {
      if (source.startsWith("auralis-media://local/")) {
        try {
          const diskThumbnail = await fetch(`${source}.thumb-${size}.png`);
          if (diskThumbnail.ok) return keepThumbnail(source, size, await diskThumbnail.blob());
        } catch { /* An absent or unreadable sidecar falls back to the original artwork. */ }
      }
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Artwork: ${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      try {
        const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Thumbnail canvas unavailable");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await canvas.convertToBlob({ type: "image/webp", quality: size === 256 ? .82 : .9 });
        return keepThumbnail(source, size, blob);
      } finally { bitmap.close(); }
    } finally {
      active--;
      waiting.shift()?.();
    }
  })();
  cache.set(key, task);
  task.then(() => {
    if (cache.get(key) === task) cache.delete(key);
  }, () => {
    if (cache.get(key) === task) {
      cache.delete(key);
      rememberFailure(key);
    }
  });
  return task;
}

export const LibraryThumbnail = memo(function LibraryThumbnail({ source, coverFlow = false, highResolution = false, smartFocus = false, fullscreen = false }: { source: string; coverFlow?: boolean; highResolution?: boolean; smartFocus?: boolean; fullscreen?: boolean }) {
  const image = useRef<HTMLImageElement>(null);
  const [result, setResult] = useState<{ source: string; size: ThumbnailSize; url: string }>();
  const [framing, setFraming] = useState(() => framingFor(source));
  const [smartFraming, setSmartFraming] = useState<{ source: string; focusY: number } | undefined>(() => {
    const known = smartFocus ? attentionBySource.get(source) : undefined;
    return known ? { source, focusY: known.focusY } : undefined;
  });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const currentFraming = framing.source === source ? framing : framingFor(source);
  const requestedSize: ThumbnailSize = highResolution ? 512 : 256;
  const settledUrl = result?.source === source
    && (result.url === source || getReadyThumbnail(source, result.size) === result.url)
    ? result.url
    : undefined;
  const displayUrl = getReadyThumbnail(source, requestedSize)
    ?? (requestedSize !== 256 ? getReadyThumbnail(source, 256) : undefined)
    ?? (settledUrl && (result?.size === requestedSize || requestedSize !== 256 && result?.size === 256) ? settledUrl : undefined);

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const sources = (event as CustomEvent<{ sources?: string[] }>).detail?.sources;
      if (!sources?.includes(source)) return;
      setResult(current => current?.source === source ? undefined : current);
      setRefreshVersion(version => version + 1);
    };
    window.addEventListener(LIBRARY_THUMBNAILS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(LIBRARY_THUMBNAILS_REFRESH_EVENT, onRefresh);
  }, [source]);

  useEffect(() => {
    const element = image.current;
    const entry = element?.closest<HTMLElement>(".library-entry");
    if (!element) return;
    const clear = () => {
      delete element.dataset.smartTop;
      delete element.dataset.smartBottom;
      if (entry) updateEntryLabelPlacement(entry);
    };
    const apply = (attention: ArtworkAttention) => {
      element.dataset.smartTop = String(attention.topScore);
      element.dataset.smartBottom = String(attention.bottomScore);
      setSmartFraming(current => current?.source === source && current.focusY === attention.focusY ? current : { source, focusY: attention.focusY });
      if (entry) updateEntryLabelPlacement(entry);
    };
    let idle = 0;
    const analyse = () => {
      idle = 0;
      if (!element.complete || !element.naturalWidth) return;
      const attention = estimateArtworkAttention(element);
      if (!attention) return;
      rememberSourceValue(attentionBySource, source, attention);
      apply(attention);
    };
    // Analyse when the main thread is idle, never inside a pan or a mount burst.
    const update = () => {
      const known = attentionBySource.get(source);
      if (known) { apply(known); return; }
      if (!idle) idle = window.requestIdleCallback ? window.requestIdleCallback(analyse, { timeout: 1000 }) : window.setTimeout(analyse, 0);
    };
    if (smartFocus) {
      element.addEventListener("load", update);
      if (element.complete && element.naturalWidth) update();
      else { const known = attentionBySource.get(source); if (known) apply(known); }
    } else {
      clear();
      setSmartFraming(undefined);
    }
    return () => {
      if (idle) { if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle); }
      element.removeEventListener("load", update);
      clear();
    };
  }, [source, smartFocus]);

  useEffect(() => {
    let cancelled = false;
    setFraming(framingFor(source));
    const onFramingChange = (event: Event) => {
      const detail = (event as CustomEvent<{ source: string; position?: number }>).detail;
      if (detail?.source !== source) return;
      setFraming(current => current.source === source
        ? {
          ...current,
          position: detail.position === undefined ? getCoverFlowPosition(source, current.ratio) : detail.position,
          crop: detail.position !== undefined || shouldAutoCropCoverFlow(current.ratio)
        }
        : current);
    };
    if (coverFlow) window.addEventListener(COVER_FLOW_FRAMING_EVENT, onFramingChange);
    if (getReadyThumbnail(source, requestedSize)) return () => window.removeEventListener(COVER_FLOW_FRAMING_EVENT, onFramingChange);
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void thumbnail(source, requestedSize).then(url => {
        if (!cancelled) setResult({ source, size: requestedSize, url });
      }).catch(() => {
        if (cancelled) return;
        if (requestedSize === 256) {
          setResult({ source, size: 256, url: source });
          return;
        }
        void thumbnail(source, 256).then(url => {
          if (!cancelled) setResult({ source, size: 256, url });
        }).catch(() => {
          if (!cancelled) setResult({ source, size: 256, url: source });
        });
      });
    }, { root: fullscreen
      ? image.current?.closest<HTMLElement>(".music-library.library-mosaic-fullscreen")
        ?? image.current?.closest<HTMLElement>(".library-infinite-viewport")
        ?? image.current?.closest<HTMLElement>(".library-fullscreen-scroll")
        ?? null
      : image.current?.closest<HTMLElement>(".library-infinite-viewport")
        ?? image.current?.closest<HTMLElement>(".library-fullscreen-scroll")
        ?? image.current?.closest<HTMLElement>(".page-content")
        ?? null, rootMargin: "180px" });
    if (image.current) observer.observe(image.current);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener(COVER_FLOW_FRAMING_EVENT, onFramingChange);
    };
  }, [source, coverFlow, requestedSize, refreshVersion, fullscreen]);

  const focusY = smartFraming?.source === source ? smartFraming.focusY : 50;
  return <img draggable={false} ref={image} className={coverFlow ? `library-thumbnail-flow${currentFraming.crop ? " library-thumbnail-flow-cropped" : ""}` : undefined}
    style={coverFlow ? { objectPosition: `${currentFraming.position}% center` } : smartFocus ? { objectPosition: `50% ${focusY}%` } : undefined}
    onLoad={event => {
      const ratio = event.currentTarget.naturalHeight ? event.currentTarget.naturalWidth / event.currentTarget.naturalHeight : 1;
      rememberSourceValue(dimensions, source, ratio);
      setFraming({ source, ratio, position: getCoverFlowPosition(source, ratio), crop: shouldAutoCropCoverFlow(ratio) || hasCustomCoverFlowPosition(source) });
    }}
    src={displayUrl} alt="" decoding="async" />;
});

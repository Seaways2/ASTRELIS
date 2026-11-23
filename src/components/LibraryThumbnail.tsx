import { memo, useEffect, useRef, useState } from "react";
import { COVER_FLOW_FRAMING_EVENT, getCoverFlowPosition, hasCustomCoverFlowPosition, shouldAutoCropCoverFlow } from "../utils/coverFlowFraming";
import { LIBRARY_THUMBNAILS_REFRESH_EVENT } from "../utils/libraryThumbnailRefresh";
import { createThumbnailQueue, createThumbnailStore, isAbandonedThumbnail } from "../utils/libraryThumbnailCache";
import { canReuseOriginal, capThumbnailTier, nextThumbnailTier, requiredThumbnailSide, sufficientThumbnailTiers, thumbnailFallbackOrder, thumbnailTierFor, type ThumbnailBox, type ThumbnailFit, type ThumbnailSize } from "../utils/libraryThumbnailTier";

type ReadyThumbnail = { url: string; size: ThumbnailSize };
type ThumbnailFitting = { box: ThumbnailBox; fit: ThumbnailFit };
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
const cache = new Map<string, Promise<ReadyThumbnail>>();
const failed = new Set<string>();
const dimensions = new Map<string, number>();
// Decoded source long side: caps the tier so small covers are not asked for at 1024.
const sourceSide = new Map<string, number>();
// Last measured tier per cover, so a remount prefers the tier it showed before measuring again.
const lastTierBySource = new Map<string, ThumbnailSize>();
// Smart framing reads image pixels back on the main thread. A mosaic mounts
// hundreds of tiles, so each cover is analysed once and remembered.
const attentionBySource = new Map<string, ArtworkAttention>();
// The cache holds encoded thumbnail blobs (tens of KB each); decoded pixels belong
// to Chromium's own discardable image cache. Budgeting blobs at their decoded
// size capped a 512px video mosaic at ~128 covers, so a zoomed-out fullscreen
// mosaic (400+ covers) kept revoking and re-reading thumbnails it was showing.
// Tiers follow device pixels now and a 1024 webp is 3-4x a 512 one, so the
// budget grows with it; covers on screen are pinned and never evicted.
const MAX_READY_WEIGHT = 160 * 1024 * 1024;
// Small numbers and objects per source; the ratio and side feed tier selection,
// so large libraries must not lose them while paging.
const MAX_SOURCE_METADATA = 2048;
const store = createThumbnailStore({ maxWeight: MAX_READY_WEIGHT, revoke: url => URL.revokeObjectURL(url) });
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
  return store.get(cacheKey(source, size));
}
/** First ready tier in display order, so a cover never waits blank while a cached tier exists. */
function readyThumbnailFor(source: string, requested: ThumbnailSize): ReadyThumbnail | undefined {
  for (const size of thumbnailFallbackOrder(requested)) {
    const url = getReadyThumbnail(source, size);
    if (url) return { url, size };
  }
  return undefined;
}
function hasSufficientThumbnail(source: string, requested: ThumbnailSize) {
  return sufficientThumbnailTiers(requested).some(size => store.has(cacheKey(source, size)));
}
function invalidateThumbnail(source: string, size: ThumbnailSize) {
  const key = cacheKey(source, size);
  cache.delete(key);
  store.invalidate(key);
  failed.delete(key);
}
function invalidateRefreshedThumbnails(event: Event) {
  const sources = (event as CustomEvent<{ sources?: string[] }>).detail?.sources;
  sources?.forEach(source => {
    attentionBySource.delete(source);
    sourceSide.delete(source);
    invalidateThumbnail(source, 256);
    invalidateThumbnail(source, 512);
    invalidateThumbnail(source, 1024);
  });
}
function keepThumbnail(source: string, size: ThumbnailSize, blob: Blob) {
  const url = URL.createObjectURL(blob), weight = Math.max(1, blob.size);
  return store.keep(cacheKey(source, size), url, weight);
}
function framingFor(source: string) {
  const ratio = dimensions.get(source) ?? 1;
  return { source, ratio, position: getCoverFlowPosition(source, ratio), crop: hasCustomCoverFlowPosition(source) || shouldAutoCropCoverFlow(ratio) };
}
function releaseThumbnails() {
  store.clear();
  failed.clear();
  dimensions.clear();
  sourceSide.clear();
  lastTierBySource.clear();
  cache.clear();
}
window.addEventListener("pagehide", releaseThumbnails);
window.addEventListener(LIBRARY_THUMBNAILS_REFRESH_EVENT, invalidateRefreshedThumbnails);
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener("pagehide", releaseThumbnails);
  window.removeEventListener(LIBRARY_THUMBNAILS_REFRESH_EVENT, invalidateRefreshedThumbnails);
  releaseThumbnails();
});
const MAX_ACTIVE_THUMBNAILS = 6;
// Interest is per source: a card claims its cover when it intersects and releases it on unmount.
const queue = createThumbnailQueue(MAX_ACTIVE_THUMBNAILS);
async function thumbnail(source: string, requested: ThumbnailSize, fitting?: ThumbnailFitting): Promise<ReadyThumbnail> {
  const size = capThumbnailTier(requested, sourceSide.get(source));
  const available = getReadyThumbnail(source, size);
  if (available) return { url: available, size };
  const key = cacheKey(source, size), existing = cache.get(key);
  if (existing) return existing;
  if (failed.has(key)) throw new Error("Thumbnail unavailable");
  const task = queue.run(source, async (): Promise<ReadyThumbnail> => {
    // Electron writes only the 256px sidecar (ArtworkCache.cacheArtworkThumbnail);
    // probing 512/1024 was a guaranteed 404 before every larger thumbnail.
    if (size === 256 && source.startsWith("auralis-media://local/")) {
      try {
        const diskThumbnail = await fetch(`${source}.thumb-${size}.png`);
        if (diskThumbnail.ok) return { url: keepThumbnail(source, size, await diskThumbnail.blob()), size };
      } catch { /* An absent or unreadable sidecar falls back to the original artwork. */ }
    }
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Artwork: ${response.status}`);
    const original = await response.blob();
    const bitmap = await createImageBitmap(original);
    try {
      const side = Math.max(bitmap.width, bitmap.height), ratio = bitmap.width / bitmap.height;
      rememberSourceValue(sourceSide, source, side);
      rememberSourceValue(dimensions, source, ratio);
      // The card measured its tier with a guessed (square or 16:9) ratio; once the real aspect
      // reaches it the card asks again, so size for the real aspect now instead of encoding twice.
      const wanted = fitting ? nextThumbnailTier(size, thumbnailTierFor(requiredThumbnailSide(fitting.box, ratio, fitting.fit))) : size;
      // Kept under the tier the source can fill, which is the key later requests are capped to.
      // Video frames are at most 512px on disk (VideoLibraryProbe), so video cards stay at 512.
      const tier = capThumbnailTier(wanted, side);
      const ready = getReadyThumbnail(source, tier);
      if (ready) return { url: ready, size: tier };
      // Video frames (512px), MusicBrainz covers (256px) and many embedded covers
      // already fit: their own bytes need no canvas and no convertToBlob readback.
      if (canReuseOriginal(original.type, original.size, side, tier)) return { url: keepThumbnail(source, tier, original), size: tier };
      const scale = Math.min(1, tier / side);
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      // A CPU-backed canvas: the default accelerated one paid a GPU ReadbackImagePixels on every
      // convertToBlob (the archive's 37 readbacks while paging), larger now that tiers reach 1024.
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Thumbnail canvas unavailable");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: "image/webp", quality: tier === 256 ? .82 : .9 });
      return { url: keepThumbnail(source, tier, blob), size: tier };
    } finally { bitmap.close(); }
  });
  cache.set(key, task);
  task.then(() => {
    if (cache.get(key) === task) cache.delete(key);
  }, error => {
    if (cache.get(key) === task) {
      cache.delete(key);
      // A job skipped because its cards left is not a broken cover.
      if (!isAbandonedThumbnail(error)) rememberFailure(key);
    }
  });
  return task;
}

// One observer for every cover; device-pixel-content-box reports the box in
// physical pixels at any Windows scaling, ignoring 3D cover-flow transforms.
const sizeCallbacks = new WeakMap<Element, (box: ThumbnailBox) => void>();
let sizeObserver: ResizeObserver | undefined;
function deviceBox(entry: ResizeObserverEntry): ThumbnailBox {
  const device = entry.devicePixelContentBoxSize?.[0];
  if (device) return { width: device.inlineSize, height: device.blockSize };
  const scale = window.devicePixelRatio || 1;
  return { width: entry.contentRect.width * scale, height: entry.contentRect.height * scale };
}
function observeDeviceSize(element: Element, callback: (box: ThumbnailBox) => void) {
  sizeObserver ??= new ResizeObserver(entries => entries.forEach(entry => sizeCallbacks.get(entry.target)?.(deviceBox(entry))));
  sizeCallbacks.set(element, callback);
  try { sizeObserver.observe(element, { box: "device-pixel-content-box" }); }
  catch { sizeObserver.observe(element); }
  return () => {
    sizeObserver?.unobserve(element);
    if (sizeCallbacks.get(element) === callback) sizeCallbacks.delete(element);
  };
}
// Resize, maximise and zoom animations would walk a card through every tier; upgrade once the size settles.
const TIER_UPGRADE_DELAY = 150;

export const LibraryThumbnail = memo(function LibraryThumbnail({ source, coverFlow = false, highResolution = false, smartFocus = false, fullscreen = false }: { source: string; coverFlow?: boolean; highResolution?: boolean; smartFocus?: boolean; fullscreen?: boolean }) {
  const image = useRef<HTMLImageElement>(null);
  const [result, setResult] = useState<{ source: string; size: ThumbnailSize; url: string }>();
  const [framing, setFraming] = useState(() => framingFor(source));
  const [smartFraming, setSmartFraming] = useState<{ source: string; focusY: number } | undefined>(() => {
    const known = smartFocus ? attentionBySource.get(source) : undefined;
    return known ? { source, focusY: known.focusY } : undefined;
  });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [tier, setTier] = useState<ThumbnailSize>();
  const fitting = useRef<ThumbnailFitting>();
  const currentFraming = framing.source === source ? framing : framingFor(source);
  // Until the first load, highResolution only hints that a video frame is 16:9.
  const ratioHint = dimensions.get(source) ?? (highResolution ? 16 / 9 : 1);
  const fallbackTier: ThumbnailSize = highResolution ? 512 : 256;
  // Nothing is requested before the cover has been measured, so no guessed tier is generated.
  const requestedSize = tier === undefined ? undefined : capThumbnailTier(tier, sourceSide.get(source));
  const shown = readyThumbnailFor(source, requestedSize ?? lastTierBySource.get(source) ?? fallbackTier);
  const displayKey = shown ? cacheKey(source, shown.size) : undefined;
  // The original artwork stands in only after every thumbnail tier failed.
  const displayUrl = shown?.url ?? (result?.source === source && result.url === source ? source : undefined);

  useEffect(() => {
    const element = image.current;
    if (!element) return;
    let timer = 0;
    // A collapsed box (hidden, or a view that does not size the image) gets no initial
    // observation. Resize observations are delivered in the frame after observe(), before
    // the second animation frame, so the old fixed tier applies only if nothing was measured.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => { frame = 0; setTier(current => current ?? fallbackTier); });
    });
    const stopObserving = observeDeviceSize(element, box => {
      window.clearTimeout(timer);
      if (!(box.width > 0) || !(box.height > 0)) { setTier(current => current ?? fallbackTier); return; }
      const fit = getComputedStyle(element).objectFit === "contain" ? "contain" : "cover";
      fitting.current = { box, fit };
      const measured = thumbnailTierFor(requiredThumbnailSide(box, ratioHint, fit));
      setTier(current => current ?? measured);
      timer = window.setTimeout(() => setTier(current => nextThumbnailTier(current, measured)), TIER_UPGRADE_DELAY);
    });
    return () => { window.clearTimeout(timer); window.cancelAnimationFrame(frame); stopObserving(); };
    // crop and coverFlow switch object-fit through classes without resizing the box.
  }, [ratioHint, fallbackTier, currentFraming.crop, coverFlow]);

  useEffect(() => {
    if (tier !== undefined) rememberSourceValue(lastTierBySource, source, tier);
  }, [source, tier]);

  useEffect(() => {
    if (!displayKey) return;
    store.pin(displayKey);
    return () => store.unpin(displayKey);
  }, [displayKey]);

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
    return () => window.removeEventListener(COVER_FLOW_FRAMING_EVENT, onFramingChange);
  }, [source, coverFlow, refreshVersion]);

  useEffect(() => {
    // The requested tier or the one above is enough; anything else only bridges the wait.
    if (requestedSize === undefined || hasSufficientThumbnail(source, requestedSize)) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    const request = (size: ThumbnailSize, retry = true) => {
      // The 256 fallback after a failed larger tier must not be upgraded back into it.
      void thumbnail(source, size, size === requestedSize ? fitting.current : undefined).then(ready => {
        if (!cancelled) setResult({ source, ...ready });
      }).catch(error => {
        if (cancelled) return;
        // This card holds a claim, so a skip means it joined a shared task abandoned just before; ask once more.
        if (isAbandonedThumbnail(error)) { if (retry) request(size, false); return; }
        if (size !== 256) request(256);
        else setResult({ source, size: 256, url: source });
      });
    };
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      // Releasing on unmount lets the queue skip covers that fast paging only passed through.
      release ??= queue.claim(source);
      request(requestedSize);
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
      release?.();
      observer.disconnect();
    };
  }, [source, requestedSize, refreshVersion, fullscreen]);

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

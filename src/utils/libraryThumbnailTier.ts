// Thumbnail tier math, kept import-free so tests can load it with transpileModule.
export const THUMBNAIL_SIZES = [256, 512, 1024] as const;
export type ThumbnailSize = typeof THUMBNAIL_SIZES[number];
export type ThumbnailFit = "cover" | "contain";
export type ThumbnailBox = { width: number; height: number };

const REUSABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Long side, in device pixels, an image of `ratio` (width / height) occupies once object-fit lays it into `box` (already device pixels). */
export function requiredThumbnailSide(box: ThumbnailBox, ratio: number, fit: ThumbnailFit) {
  if (!(box.width > 0) || !(box.height > 0)) return 0;
  const aspect = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
  const heightFromWidth = box.width / aspect;
  // cover fills the box and crops the overflow; contain fits the whole image inside it.
  const imageHeight = fit === "cover" ? Math.max(heightFromWidth, box.height) : Math.min(heightFromWidth, box.height);
  return imageHeight * Math.max(aspect, 1);
}

// Only 256px sidecars exist on disk; every larger tier is a fetch, a full decode and
// often an encode. Without slack a 225% mosaic tile of ~340-680 device px asked for
// 1024 and left its free sidecar, so a slight (<=1.25x) upscale is accepted instead.
// The old fixed 256 tier was a 2x+ upscale at 225%, which is what looked blurry.
const TIER_UPSCALE_TOLERANCE = 1.25;

/** Smallest tier upscaled by at most TIER_UPSCALE_TOLERANCE on screen. */
export function thumbnailTierFor(side: number): ThumbnailSize {
  return THUMBNAIL_SIZES.find(size => size * TIER_UPSCALE_TOLERANCE >= side) ?? 1024;
}

/** Ready tiers that stop generation of `requested`: itself or one tier above. A 1024 blob left by cover flow
 * still stands in for a 256 mosaic tile while it loads, but is not decoded at full size for every small tile. */
export function sufficientThumbnailTiers(requested: ThumbnailSize): ThumbnailSize[] {
  const above = THUMBNAIL_SIZES.find(size => size > requested);
  return above === undefined ? [requested] : [requested, above];
}

/** Never ask for a tier above the source: a 300px or 512px cover has nothing more to give at 1024. */
export function capThumbnailTier(tier: ThumbnailSize, sourceSide?: number): ThumbnailSize {
  if (sourceSide === undefined || !(sourceSide > 0)) return tier;
  // No tolerance here: a 600px source stays whole at 1024 (and is reused as is) instead of shrinking to 512.
  const sourceTier = THUMBNAIL_SIZES.find(size => size >= sourceSide) ?? 1024;
  return sourceTier < tier ? sourceTier : tier;
}

/** A mounted cover only moves up: shrinking keeps the sharper image instead of decoding a smaller one. */
export function nextThumbnailTier(current: ThumbnailSize | undefined, measured: ThumbnailSize): ThumbnailSize {
  return current === undefined || measured > current ? measured : current;
}

/** Display order: the requested tier, then any larger ready tier (sharper, and no reason to generate the smaller one),
 * then smaller tiers largest first while the requested tier decodes. */
export function thumbnailFallbackOrder(requested: ThumbnailSize): ThumbnailSize[] {
  return [requested, ...THUMBNAIL_SIZES.filter(size => size > requested), ...THUMBNAIL_SIZES.filter(size => size < requested).reverse()];
}

/** Sources already within the tier keep their own bytes: re-encoding them only cost a readback.
 * The byte limit is one byte per tier pixel: JPEG and WebP covers sit well under it, while
 * near-raw PNGs (2-3 bytes per pixel) would fill the blob budget, so they are re-encoded once. */
export function canReuseOriginal(type: string, bytes: number, side: number, tier: ThumbnailSize) {
  return REUSABLE_TYPES.has(type.toLowerCase()) && side > 0 && side <= tier && bytes > 0 && bytes <= tier * tier;
}

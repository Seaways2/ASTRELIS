const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const compiled = ts.transpileModule(read("src/utils/libraryThumbnailTier.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const loaded = { exports: {} };
Function("exports", compiled)(loaded.exports);
const { requiredThumbnailSide, thumbnailTierFor, capThumbnailTier, nextThumbnailTier, thumbnailFallbackOrder, canReuseOriginal, sufficientThumbnailTiers } = loaded.exports;

const tierAt = (cssWidth, cssHeight, scale, ratio = 1, fit = "cover") =>
  thumbnailTierFor(requiredThumbnailSide({ width: cssWidth * scale, height: cssHeight * scale }, ratio, fit));

test("the tier follows the cover's size in device pixels", () => {
  // 225% Windows scaling: a 244px CSS cover is 549 device pixels, a 1.07x upscale of 512 (the old 256 was 2.1x).
  assert.equal(tierAt(244, 244, 2.25), 512);
  assert.equal(tierAt(300, 300, 2.25), 1024);
  assert.equal(tierAt(200, 200, 1), 256);
  assert.equal(tierAt(300, 300, 1.5), 512);
  // 3x a 400px box is 1200 device pixels; 1024 is the largest tier.
  assert.equal(tierAt(400, 400, 3), 1024);
  // Up to 1.25x upscale stays on a tier, so a 225% mosaic tile keeps its free 256px sidecar a little longer.
  assert.equal(thumbnailTierFor(256), 256);
  assert.equal(thumbnailTierFor(320), 256);
  assert.equal(thumbnailTierFor(321), 512);
  assert.equal(thumbnailTierFor(640), 512);
  assert.equal(thumbnailTierFor(641), 1024);
  // A box that has not been laid out asks for the smallest tier.
  assert.equal(thumbnailTierFor(requiredThumbnailSide({ width: 0, height: 300 }, 1, "cover")), 256);
});

test("object-fit and aspect decide how much of the image is on screen", () => {
  const portrait = { width: 200, height: 300 };
  // cover fills the 2:3 box, so a 16:9 frame is ~1.78x the box height wide.
  assert.ok(Math.abs(requiredThumbnailSide(portrait, 16 / 9, "cover") - 300 * 16 / 9) < 1e-9);
  // contain fits it inside: its long side is just the box width.
  assert.ok(Math.abs(requiredThumbnailSide(portrait, 16 / 9, "contain") - 200) < 1e-9);
  // Portrait art in a square box: the long side is the height either way it is fitted.
  assert.equal(requiredThumbnailSide({ width: 300, height: 300 }, 2 / 3, "contain"), 300);
  assert.equal(requiredThumbnailSide({ width: 300, height: 300 }, 2 / 3, "cover"), 450);
  // A bad ratio is treated as square.
  assert.equal(requiredThumbnailSide({ width: 300, height: 200 }, Number.NaN, "cover"), 300);
});

test("tiers never exceed what the source can fill", () => {
  assert.equal(capThumbnailTier(1024, 512), 512);
  assert.equal(capThumbnailTier(1024, 200), 256);
  assert.equal(capThumbnailTier(1024, 513), 1024);
  assert.equal(capThumbnailTier(256, 4000), 256);
  assert.equal(capThumbnailTier(1024, undefined), 1024);
});

test("a mounted cover only moves up a tier", () => {
  assert.equal(nextThumbnailTier(undefined, 256), 256);
  assert.equal(nextThumbnailTier(256, 1024), 1024);
  assert.equal(nextThumbnailTier(1024, 256), 1024);
});

test("display prefers the requested tier, then sharper, then smaller ready tiers", () => {
  assert.deepEqual(thumbnailFallbackOrder(256), [256, 512, 1024]);
  assert.deepEqual(thumbnailFallbackOrder(512), [512, 1024, 256]);
  assert.deepEqual(thumbnailFallbackOrder(1024), [1024, 512, 256]);
});

test("a much larger ready tier only stands in; the requested tier is still generated", () => {
  assert.deepEqual(sufficientThumbnailTiers(256), [256, 512]);
  assert.deepEqual(sufficientThumbnailTiers(512), [512, 1024]);
  assert.deepEqual(sufficientThumbnailTiers(1024), [1024]);
});

test("small enough originals are kept instead of re-encoded", () => {
  assert.equal(canReuseOriginal("image/jpeg", 60_000, 512, 512), true);
  assert.equal(canReuseOriginal("image/PNG", 60_000, 256, 256), true);
  assert.equal(canReuseOriginal("image/gif", 60_000, 256, 512), false);
  assert.equal(canReuseOriginal("", 60_000, 256, 512), false);
  assert.equal(canReuseOriginal("image/jpeg", 60_000, 600, 512), false);
  // Over one byte per tier pixel: a near-raw PNG goes through the encoder rather than filling the blob budget.
  assert.equal(canReuseOriginal("image/jpeg", 1024 * 1024, 1000, 1024), true);
  assert.equal(canReuseOriginal("image/png", 1024 * 1024 + 1, 1000, 1024), false);
  assert.equal(canReuseOriginal("image/png", 512 * 512 * 3, 512, 512), false);
});

test("the thumbnail component sizes covers from device pixels and skips pointless work", () => {
  const thumbnail = read("src/components/LibraryThumbnail.tsx");
  assert.doesNotMatch(thumbnail, /const requestedSize: ThumbnailSize = highResolution \? 512 : 256/);
  assert.match(thumbnail, /devicePixelContentBoxSize/);
  assert.match(thumbnail, /box: "device-pixel-content-box"/);
  assert.match(thumbnail, /window\.devicePixelRatio/);
  assert.match(thumbnail, /thumbnailTierFor\(requiredThumbnailSide\(box, ratioHint, fit\)\)/);
  // Only the 256px sidecar is ever written by Electron.
  assert.match(thumbnail, /if \(size === 256 && source\.startsWith\("auralis-media:\/\/local\/"\)\) \{\s*try \{\s*const diskThumbnail = await fetch\(`\$\{source\}\.thumb-\$\{size\}\.png`\);/);
  const reuse = thumbnail.indexOf("canReuseOriginal(original.type"), encode = thumbnail.indexOf("convertToBlob(");
  assert.ok(reuse > 0 && encode > reuse, "originals are checked before any canvas readback");
  // The encode canvas is CPU-backed, so convertToBlob does not read pixels back from the GPU.
  const job = thumbnail.slice(thumbnail.indexOf("async function thumbnail("), thumbnail.indexOf("convertToBlob("));
  assert.match(job, /canvas\.getContext\("2d", \{ willReadFrequently: true \}\)/);
  // The first encode is sized for the decoded aspect, not the square or 16:9 guess, so it is not redone.
  assert.match(job, /requiredThumbnailSide\(fitting\.box, ratio, fitting\.fit\)/);
  assert.match(job, /rememberSourceValue\(dimensions, source, ratio\);/);
  assert.match(thumbnail, /hasSufficientThumbnail\(source, requestedSize\)/);
  assert.doesNotMatch(thumbnail, /hasReadyAtLeast/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("the App shell does not re-render for volume changes", () => {
  const app = read("src/App.tsx");
  assert.doesNotMatch(app, /usePlayerStore\(\)/, "a bare store subscription re-renders the whole window on every fader move");
  assert.match(app, /usePlayerStore\(useShallow\(selectShellState\)\)/);
  assert.match(app, /const \{ volume, \.\.\.shell \} = store;/);
  assert.doesNotMatch(app, /state\.volume/);
  // Volume consumers subscribe on their own.
  assert.match(app, /<WithStoreVolume>\{\(volume, muted\) => <ChannelStripPopover/);
  assert.match(app, /usePlayerStore\.subscribe\(\(next, previous\) => \{\s*if \(next\.volume !== previous\.volume/);
});

test("native volume commands are coalesced to the newest value", () => {
  const app = read("src/App.tsx");
  assert.match(app, /function createLatestNativeVolumeSender\(\)/);
  assert.match(app, /if \(nativePlayback\) sendNativeVolume\(muted \? 0 : volume\);/);
});

test("fader reads its track geometry once per gesture", () => {
  const fader = read("src/components/MainVolumeFader.tsx");
  assert.match(fader, /if \(phase === "start" \|\| !dragBounds\.current\)/);
  assert.equal((fader.match(/getBoundingClientRect\(\)/g) || []).length, 1);
});

test("volume persistence is debounced and flushed on pagehide", () => {
  const store = read("src/stores/playerStore.ts");
  assert.match(store, /setVolume: \(volume\) => \{\s*persistVolume\(volume\);/);
  assert.match(store, /addEventListener\?\.\("pagehide", flushPersistedVolume\)/);
});

test("overview thumbnails draw a thinner population without starving any tile", () => {
  const overview = read("src/visualizers/VisualizerOverview.tsx");
  assert.match(overview, /<VisualizerCanvas [^>]*\bthumbnail \/>/);
  const canvas = read("src/visualizers/VisualizerCanvas.tsx");
  assert.match(canvas, /const particleCount = thinned\(starCount\);/);
  // A shared draw budget always skipped the tiles registered last in rAF order.
  assert.doesNotMatch(canvas, /thumbnailFrameBudget/);
  // The canvas size comes from ResizeObserver, not a forced layout every frame.
  assert.match(canvas, /if \(now - lastSizeCheck >= CANVAS_SIZE_RECHECK_MS\) \{\s*lastSizeCheck = now;\s*syncCanvasSize\(\);/);
});

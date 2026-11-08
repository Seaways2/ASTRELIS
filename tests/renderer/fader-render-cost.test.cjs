const { readAppSource } = require("./helpers/appSource.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("the App shell does not re-render for volume changes", () => {
  const app = readAppSource();
  assert.doesNotMatch(app, /usePlayerStore\(\)/, "a bare store subscription re-renders the whole window on every fader move");
  assert.match(app, /usePlayerStore\(useShallow\(selectShellState\)\)/);
  assert.match(app, /const \{ volume, currentTime, \.\.\.shell \} = store;/);
  assert.doesNotMatch(app, /state\.volume/);
});

test("the App shell does not re-render for playback ticks", () => {
  const app = readAppSource();
  // currentTime changes several times per second while playing.
  assert.doesNotMatch(app, /state\.currentTime/);
  assert.match(app, /<WithDisplayTime online=\{onlineSession\}>\{displayTime => <>\s*<time>\{formatTime\(displayTime\)\}<\/time>/);
  assert.match(app, /currentTime=\{displayTime\} duration=\{displayDuration\}/);
  // The shell only needs to know whether playback has left zero.
  assert.match(app, /const hasPlaybackProgress = usePlayerStore\(store => \(onlineSession \? store\.onlineMedia\?\.currentTime \?\? 0 : store\.currentTime\) > \.05\);/);
  // Volume consumers subscribe on their own.
  assert.match(app, /<WithStoreVolume>\{\(volume, muted\) => <ChannelStripPopover/);
  assert.match(app, /usePlayerStore\.subscribe\(\(next, previous\) => \{\s*if \(next\.volume !== previous\.volume/);
});

test("native volume commands are coalesced to the newest value", () => {
  const app = readAppSource();
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
  assert.match(overview, /<VisualizerCanvas [^>]*\bthumbnail\b[^>]*\/>/);
  const canvas = read("src/visualizers/VisualizerCanvas.tsx");
  assert.match(canvas, /const particleCount = thinned\(starCount\);/);
  // A shared draw budget always skipped the tiles registered last in rAF order.
  assert.doesNotMatch(canvas, /thumbnailFrameBudget/);
  // The canvas size comes from ResizeObserver, not a forced layout every frame.
  assert.match(canvas, /if \(now - lastSizeCheck >= CANVAS_SIZE_RECHECK_MS\) \{\s*lastSizeCheck = now;\s*syncCanvasSize\(\);/);
});

test("particle populations stop growing above the default bar count", () => {
  const canvas = read("src/visualizers/VisualizerCanvas.tsx");
  assert.match(canvas, /export const PARTICLE_EFFECT_UNIT_CAP = 90;/);
  assert.match(canvas, /const particleUnits = Math\.min\(settings\.barCount, PARTICLE_EFFECT_UNIT_CAP\);/);
  // Particle counts never scale with the raw bar setting...
  assert.doesNotMatch(canvas, /settings\.barCount \*/);
  // ...while the spectrum still draws every requested bar.
  assert.match(canvas, /const bars = Math\.max\(12, Math\.min\(settings\.barCount, data\.length\)\);/);
});

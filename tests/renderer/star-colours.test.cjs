// Runs the starfield and black hole against a context that records the
// colour and position of every filled circle, and checks how the galaxy
// palette is spread over their stars.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const load = (relative, requireFn = () => ({})) => {
  const exports = {};
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  Function("exports", "require", output)(exports, requireFn);
  return exports;
};
const palette = load("src/visualizers/galaxyPalette.ts");
const modules = {
  "./framePacing": load("src/visualizers/framePacing.ts"),
  "./galaxyPalette": palette,
  "./musicDynamics": load("src/visualizers/musicDynamics.ts")
};
const { createVisualizerScene } = load("src/visualizers/visualizerScene.ts", name => modules[name]);

const accent = "#38d3e1";
const colours = palette.galaxyPalette([0x38, 0xd3, 0xe1]);
const names = {
  [palette.rgba(colours.warm, 1)]: "warm",
  [palette.rgba(colours.ice, 1)]: "ice",
  [accent]: "accent",
  [palette.rgba(colours.nebula, 1)]: "jewel"
};

function fills(mode, width = 1600, height = 900) {
  const drawn = [];
  let circle = null;
  const state = {};
  const context = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (key === "beginPath") return () => { circle = null; };
      if (key === "arc") return (x, y) => { circle = { x, y }; };
      if (key === "fill") return () => { if (circle && typeof state.fillStyle === "string" && names[state.fillStyle]) drawn.push({ ...circle, tint: names[state.fillStyle] }); };
      return () => undefined;
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  globalThis.OffscreenCanvas = class { constructor(width, height) { Object.assign(this, { width, height, getContext: () => context }); } };
  globalThis.Path2D = class { moveTo() {} lineTo() {} arc() {} };
  const settings = { smoothing: .76, sensitivity: 1, barCount: 90, barOpacity: 1, lineWidth: 1.5, animationSpeed: 1, decaySpeed: 1, peakHoldMs: 650, lowPerformance: false };
  const scene = createVisualizerScene({ width: 300, height: 150, getContext: () => context }, { mode, accent, settings, glowStrength: 0, playbackActive: true, backgroundBrightness: 1, backgroundOpacity: 1 });
  scene.resize({ width, height, ratio: 1, left: 0, top: 0, cssWidth: width, cssHeight: height, viewportWidth: width, viewportHeight: height });
  const silence = new Uint8Array(256);
  scene.draw(10000, { getFrequencyData: () => silence, meters: () => ({ sampleRate: 48000 }) });
  return drawn;
}
const share = (drawn, tint) => drawn.filter(star => star.tint === tint).length / drawn.length;

test("Black Hole Pulse colours its stars warm near the hole, cool outside, a few jewels further out", () => {
  // Glow off: one filled circle per star or mote.
  const drawn = fills("pulse");
  const distance = star => Math.hypot(star.x - 800, star.y - 450);
  const mean = tint => { const stars = drawn.filter(star => star.tint === tint); return stars.reduce((sum, star) => sum + distance(star), 0) / stars.length; };
  for (const tint of ["warm", "ice", "accent", "jewel"]) assert.ok(share(drawn, tint) > 0, `no ${tint} stars`);
  assert.ok(mean("warm") < mean("ice") * .6, `warm stars average ${Math.round(mean("warm"))} px out, blue-white ${Math.round(mean("ice"))} px`);
  assert.ok(mean("jewel") > mean("warm"), "jewel stars sit outside the warm core");
  assert.ok(share(drawn, "jewel") < .05, `jewels are ${(share(drawn, "jewel") * 100).toFixed(1)}% of stars`);
});

test("Starfield Motion stays mostly the accent, with the galaxy palette as accents", () => {
  const drawn = fills("particles");
  assert.ok(drawn.length > 300);
  // Mostly the theme accent; the other colours are accents.
  const expected = { accent: .65, ice: .22, warm: .11, jewel: .02 };
  for (const [tint, target] of Object.entries(expected))
    assert.ok(Math.abs(share(drawn, tint) - target) < .07, `${tint}: ${(share(drawn, tint) * 100).toFixed(0)}%, expected ~${target * 100}%`);
});

test("Black Hole Pulse keeps its warm stars around the hole at any window shape", () => {
  for (const [width, height] of [[1600, 900], [600, 1000], [1600, 500]]) {
    const drawn = fills("pulse", width, height);
    // The orbit the warm zone is measured against, at silence and default line width.
    const orbit = Math.min(width, height) * .35 * (.72 + 1.5 * .19);
    const warm = drawn.filter(star => star.tint === "warm");
    const inside = warm.filter(star => Math.hypot(star.x - width / 2, star.y - height / 2) < orbit * 1.45).length;
    assert.ok(warm.length > 10, `${width}x${height}: only ${warm.length} warm stars`);
    assert.ok(inside / warm.length > .95, `${width}x${height}: ${warm.length - inside} of ${warm.length} warm stars stray beyond the hole`);
    assert.ok(drawn.some(star => star.tint === "ice" && Math.hypot(star.x - width / 2, star.y - height / 2) > orbit * 1.5), `${width}x${height}: no cool stars outside`);
  }
});

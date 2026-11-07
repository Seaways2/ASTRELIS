const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const source = read("src/utils/browserOverlayBounds.ts");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const loaded = { exports: {} };
Function("exports", "module", output)(loaded.exports, loaded);
const { browserBoundsAroundOverlay } = loaded.exports;

test("channel strip keeps the largest unobstructed browser rectangle visible", () => {
  const surface = { x: 20, y: 180, width: 1395, height: 608 };
  const panel = { left: 1194, top: 243, right: 1498, bottom: 861 };
  assert.deepEqual(browserBoundsAroundOverlay(surface, panel), {
    x: 20, y: 180, width: 1166, height: 608
  });
});

test("browser bounds remain unchanged when the renderer overlay does not intersect", () => {
  const surface = { x: 20, y: 180, width: 900, height: 600 };
  const panel = { left: 1000, top: 200, right: 1300, bottom: 700 };
  assert.deepEqual(browserBoundsAroundOverlay(surface, panel), surface);
});

test("a fully covering overlay falls back to hiding the native browser", () => {
  assert.equal(browserBoundsAroundOverlay(
    { x: 20, y: 180, width: 900, height: 600 },
    { left: 0, top: 0, right: 1000, bottom: 900 }
  ), null);
});

test("channel strip publishes its panel bounds instead of blindly hiding YouTube", () => {
  const channel = read("src/components/ChannelStripPopover.tsx");
  const online = read("src/components/OnlineBrowser.tsx");
  assert.match(channel, /bounds: \{ left: bounds\.left, top: bounds\.top, right: bounds\.right, bottom: bounds\.bottom \}/);
  assert.match(channel, /\[open, position\.left, position\.top, query, vst\.rack\.length\]/,
    "the final committed panel position must republish bounds after maximize or restore");
  assert.match(online, /browserBoundsAroundOverlay\(bounds\(\), overlayBounds\)/);
});

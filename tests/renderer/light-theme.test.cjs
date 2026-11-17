// The light theme used the chosen accent as is: with a pale accent (Ice Blue,
// Monochrome, a light custom colour) the active tab, the import buttons, time
// readouts and peak values could hardly be read, and the visualizers, which
// add light, almost vanished on the pale window.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const color = (() => {
  const exports = {};
  Function("exports", ts.transpileModule(read("src/utils/color.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports);
  return exports;
})();

const BRIGHT_SURFACE = "rgb(239 247 248)";
const DIM_SURFACE = "rgb(178 198 202)";
const THEMES = { "Cyber Cyan": "#38d3e1", "Neon Purple": "#9b7cff", "Signal Green": "#45e397", "Amber Console": "#ffb44d", "Ice Blue": "#9edcff", Monochrome: "#d7dde2" };

test("every theme colour reads as text on the light window, at any window opacity", () => {
  for (const [name, accent] of Object.entries(THEMES)) {
    for (const surface of [BRIGHT_SURFACE, DIM_SURFACE]) {
      const ink = color.readableAccent(accent, surface);
      const ratio = color.contrastRatio(color.parseColor(ink), color.parseColor(surface));
      assert.ok(ratio >= 4.5, `${name} on ${surface}: ${ink} only reaches ${ratio.toFixed(2)}:1`);
    }
  }
});

test("the accent keeps its hue and is only deepened as far as needed", () => {
  // Already readable: unchanged.
  assert.equal(color.readableAccent("#1d5f8a", BRIGHT_SURFACE), "#1d5f8a");
  const ice = color.parseColor(color.readableAccent(THEMES["Ice Blue"], BRIGHT_SURFACE));
  assert.ok(ice[2] > ice[0], "Ice Blue stays blue");
  const amber = color.parseColor(color.readableAccent(THEMES["Amber Console"], BRIGHT_SURFACE));
  assert.ok(amber[0] > amber[2], "Amber stays warm");
  // Not darker than it has to be: one step lighter would fall short.
  assert.ok(color.contrastRatio(ice, color.parseColor(BRIGHT_SURFACE)) < 6);
  // Unparseable input passes through.
  assert.equal(color.readableAccent("var(--x)", BRIGHT_SURFACE), "var(--x)");
});

test("the interface uses the readable accent only in the light theme; visualizers keep the chosen colour", () => {
  const app = read("src/App.tsx");
  assert.match(app, /const interfaceAccent = useMemo\(\(\) => lightTheme \? readableAccent\(state\.accent, lightSurface\) : state\.accent,/);
  assert.match(app, /"--accent": interfaceAccent,\s*"--accent-raw": state\.accent,/);
  assert.match(app, /<VisualizerCanvas mode=\{state\.visualizer\} accent=\{state\.accent\}/);
});

test("in the light theme the visualizers play on a deep-space stage", () => {
  const modules = read("src/styles/workspace-modules.css");
  const rule = modules.match(/\.app-shell\.theme-light:not\(\.has-custom-background\):not\(\.obs-mode\):not\(\.immersive-mode\) :is\(\.visual-area:not\(\.overview-active\), \.visual-module\) \{([^}]*)\}/);
  assert.ok(rule, "light-theme stage rule missing");
  assert.match(rule[1], /background: radial-gradient\([^;]*#08141a 100%\);/);
  assert.match(rule[1], /border-radius: 12px;/);
});

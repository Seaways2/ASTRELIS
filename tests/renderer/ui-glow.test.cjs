// Icons and display panels share the energy rings' accent glow (6 px reach,
// 58% accent, scaled by the glow setting), off in the light theme and in ECO.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const globalCss = read("src/styles/global.css");
const surfaces = read("src/styles/surfaces.css");
const ringGlow = String.raw`0 0 calc\(6px \* var\(--glow-strength\)\) color-mix\(in srgb, var\(--accent\) 58%, transparent\)`;

test("every interface icon gets the energy-ring glow, except rows of long lists", () => {
  const rule = globalCss.match(/:where\(\.app-shell\) :where\(svg\.lucide, svg\.ui-icon\):not\(:is\(([^)]*)\) \*\) \{([^}]*)\}/);
  assert.ok(rule, "icon glow rule missing");
  assert.match(rule[2], new RegExp(`filter: drop-shadow\\(${ringGlow}\\)`));
  for (const list of [".queue-list", ".playlist-table", ".netease-results", ".channel-rack-list"]) assert.ok(rule[1].includes(list), `${list} not excluded`);
  // The same glow the rings themselves use.
  assert.match(globalCss, new RegExp(`\\.energy-ring\\s*\\) \\{ filter: drop-shadow\\(${ringGlow}\\); \\}`));
  // The hand-drawn volume icon opts in with the shared class.
  assert.match(read("src/components/VolumeLevelIcon.tsx"), /<svg className="ui-icon"/);
});

test("display panels glow with the same accent strength and reach as the rings", () => {
  assert.match(surfaces, /--panel-glow: color-mix\(in srgb, var\(--accent\) 58%, transparent\);/);
  assert.match(surfaces, /--panel-glow-reach: calc\(6px \* var\(--glow-strength\)\);/);
  const panelRule = surfaces.match(/:is\(\.panel, \.setting-card,[^{]*\) \{([^}]*)\}/);
  assert.ok(panelRule, "panel surface rule missing");
  assert.match(panelRule[1], /box-shadow: [^;]*0 0 var\(--panel-glow-reach\) var\(--panel-glow\);/);
  // A panel inside a panel is not a second glowing sheet.
  assert.match(surfaces, /A grouping container is not a second sheet of glass[\s\S]*?box-shadow: none;/);
});

test("the light theme and ECO mode keep icons and panels unlit", () => {
  assert.match(surfaces, /\.app-shell\.theme-light \{[^}]*--panel-glow: transparent;/);
  assert.match(globalCss, /\.app-shell\.theme-light svg \{ filter: none; \}/);
  const eco = globalCss.match(/\.app-shell\.low-performance-mode \*::after \{([^}]*)\}/);
  assert.ok(eco && /box-shadow: none !important;/.test(eco[1]) && /filter: none !important;/.test(eco[1]));
});

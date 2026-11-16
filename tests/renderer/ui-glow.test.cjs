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

test("the page scroller leaves a gutter for panel glows without moving the panels", () => {
  const rule = surfaces.match(/\.app-shell:not\(\.obs-mode\):not\(\.immersive-mode\) \.page-content \{([^}]*)\}/);
  assert.ok(rule, "page-content gutter rule missing");
  // As wide as the glow (plus a little), never wider than the page's own padding.
  assert.match(surfaces, /--panel-glow-gutter: min\(calc\(var\(--panel-glow-reach\) \+ 2px\), 14px\);/);
  // Padding and an equal negative margin: the content box stays where it was.
  assert.match(rule[1], /padding-inline: var\(--panel-glow-gutter\);/);
  assert.match(rule[1], /margin-inline: calc\(-1 \* var\(--panel-glow-gutter\)\);/);
  // The page's side padding the gutter borrows from must stay at least 14px.
  const page = globalCss.match(/\.workspace-page \{[^}]*padding: 24px (\d+)px 24px (\d+)px;/);
  assert.ok(page && Number(page[1]) >= 14 && Number(page[2]) >= 14, "workspace-page side padding is narrower than the gutter cap");
});

test("buttons rest with a dimmer panel glow and reach panel strength on hover or when active", () => {
  // Dimmer than the panels at rest, off in the light theme.
  const rest = surfaces.match(/--button-glow: color-mix\(in srgb, var\(--accent\) (\d+)%, transparent\);/);
  assert.ok(rest && Number(rest[1]) >= 25 && Number(rest[1]) < 58, "resting button glow should be visible but below the panels' 58%");
  assert.match(surfaces, /\.app-shell\.theme-light \{[^}]*--button-glow: transparent;[^}]*--button-glow-inner: transparent;/);
  const shadow = String.raw`box-shadow:\s*inset 0 0 calc\(\d+px \* var\(--glow-strength\)\) var\(--button-glow-inner\),\s*0 0 var\(--panel-glow-reach\) var\(--button-glow\);`;
  // Sidebar buttons, visualizer mode tabs and the tune toggles: zero specificity, before the bloom rule.
  const restRule = globalCss.match(/:where\(\.sidebar nav button, \.mode-tabs button, \.visual-tune-toggle\) \{([^}]*)\}/);
  assert.ok(restRule && new RegExp(shadow).test(restRule[1]), "resting glow rule missing");
  const bloom = globalCss.match(/\.sidebar nav button:hover,\s*\.sidebar nav button\.active,[^{]*\) \{([^}]*)\}/);
  assert.ok(bloom && /0 0 var\(--panel-glow-reach\) var\(--panel-glow\);/.test(bloom[1]), "hover and active should reach the panel glow");
  assert.ok(globalCss.indexOf(restRule[0]) < globalCss.indexOf(bloom[0]), "the resting rule must come before hover and active");
  // The round transport controls and the volume trigger get the same halo; play carries the full panel glow.
  const round = globalCss.match(/\.transport \.controls button:not\(\.play\),\s*[^{]*\.volume-popover-trigger \{([^}]*)\}/);
  assert.ok(round && new RegExp(shadow).test(round[1]), "transport halo rule missing");
  assert.match(globalCss, /\.transport \.controls \.play \{[^}]*0 0 var\(--panel-glow-reach\) var\(--panel-glow\);/);
});

test("the mode tab strip leaves room for its tabs' glow", () => {
  const strip = surfaces.match(/\.app-shell:not\(\.obs-mode\):not\(\.immersive-mode\) \.mode-tabs \{([^}]*)\}/);
  assert.ok(strip, "mode-tabs gutter rule missing");
  assert.match(strip[1], /padding: min\(var\(--panel-glow-gutter\), 6px\);/);
  assert.match(strip[1], /margin: calc\(-1 \* min\(var\(--panel-glow-gutter\), 6px\)\);/);
  // Narrower than the 7px gap to the tune toggles beside the strip.
  assert.match(globalCss, /\.visual-head-actions \{[^}]*gap: 7px;/);
});

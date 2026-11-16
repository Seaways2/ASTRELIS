// Icons and display panels share the energy rings' accent glow (6 px reach,
// 58% accent, scaled by the glow setting), off in the light theme and in ECO.
// Sidebar buttons and visualizer mode tabs stay calm at rest and bloom on
// hover or when active; the round transport controls rest inside a soft halo.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const globalCss = read("src/styles/global.css");
const surfaces = read("src/styles/surfaces.css");
const ringGlow = String.raw`0 0 calc\(6px \* var\(--glow-strength\)\) color-mix\(in srgb, var\(--accent\) 58%, transparent\)`;
/** The declarations of the first rule whose selector matches (a regex source). */
const block = (css, selector) => css.match(new RegExp(`${selector} \\{([^}]*)\\}`))?.[1] ?? null;

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
  assert.match(surfaces, /\.app-shell\.theme-light \{[^}]*--panel-glow: transparent;[^}]*--button-glow: transparent;/);
  assert.match(globalCss, /\.app-shell\.theme-light svg \{ filter: none; \}/);
  const eco = globalCss.match(/\.app-shell\.low-performance-mode \*::after \{([^}]*)\}/);
  assert.ok(eco && /box-shadow: none !important;/.test(eco[1]) && /filter: none !important;/.test(eco[1]));
});

test("the page scroller leaves a gutter for panel glows without moving the panels", () => {
  const rule = block(surfaces, String.raw`\.app-shell:not\(\.obs-mode\):not\(\.immersive-mode\) \.page-content`);
  assert.ok(rule, "page-content gutter rule missing");
  // As wide as the glow (plus a little), never wider than the page's own padding.
  assert.match(surfaces, /--panel-glow-gutter: min\(calc\(var\(--panel-glow-reach\) \+ 2px\), 14px\);/);
  // Padding and an equal negative margin: the content box stays where it was.
  assert.match(rule, /padding-inline: var\(--panel-glow-gutter\);/);
  assert.match(rule, /margin-inline: calc\(-1 \* var\(--panel-glow-gutter\)\);/);
  // The page's side padding the gutter borrows from must stay at least 14px.
  const page = globalCss.match(/\.workspace-page \{[^}]*padding: 24px (\d+)px 24px (\d+)px;/);
  assert.ok(page && Number(page[1]) >= 14 && Number(page[2]) >= 14, "workspace-page side padding is narrower than the gutter cap");
});

test("sidebar buttons and mode tabs are calm at rest and bloom on hover or when active", () => {
  // Tried and rejected as boxy: a halo around each button, and one lit panel
  // or strip around the group. Neither the buttons nor their containers glow at rest.
  assert.doesNotMatch(globalCss, /:where\([^)]*(\.sidebar nav button|\.mode-tabs button|\.visual-tune-toggle)[^)]*\) \{\s*box-shadow:[^}]*--button-glow/);
  assert.doesNotMatch(surfaces, /\.sidebar nav \{/);
  assert.doesNotMatch(surfaces, /\.mode-tabs(?: button[^{]*)? \{/);
  // One bloom for hover and active, softer than the panels.
  const bloom = globalCss.match(/calm at rest, then bloom on focus[\s\S]*?\.sidebar nav button:hover,\s*\.sidebar nav button\.active,([^{]*)\) \{([^}]*)\}/);
  assert.ok(bloom, "bloom rule missing");
  for (const selector of [".mode-tabs button:hover", ".mode-tabs button.active", ".visual-tune-toggle:hover", ".visual-tune-toggle.active"]) assert.ok(bloom[1].includes(selector), `${selector} missing from the bloom rule`);
  assert.match(bloom[2], /inset 0 0 calc\(14px \* var\(--glow-strength\)\) color-mix\(in srgb, var\(--accent\) 9%, transparent\),\s*0 0 calc\(12px \* var\(--glow-strength\)\) color-mix\(in srgb, var\(--accent\) 18%, transparent\);/);
  assert.doesNotMatch(bloom[2], /--panel-glow\b/);
});

test("the round transport controls rest inside a soft halo and play carries the panel glow", () => {
  const rest = surfaces.match(/--button-glow: color-mix\(in srgb, var\(--accent\) (\d+)%, transparent\);/);
  assert.ok(rest && Number(rest[1]) >= 25 && Number(rest[1]) < 58, "the resting halo should be visible but below the panels' 58%");
  const round = globalCss.match(/\.transport \.controls button:not\(\.play\),\s*[^{]*\.volume-popover-trigger \{([^}]*)\}/);
  assert.ok(round, "transport halo rule missing");
  assert.match(round[1], /inset 0 0 calc\(10px \* var\(--glow-strength\)\) var\(--button-glow-inner\),\s*0 0 var\(--panel-glow-reach\) var\(--button-glow\);/);
  assert.match(globalCss, /\.transport \.controls \.play \{[^}]*0 0 var\(--panel-glow-reach\) var\(--panel-glow\);/);
});

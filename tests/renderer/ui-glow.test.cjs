// Icons and display panels share the energy rings' accent glow (6 px reach,
// 58% accent, scaled by the glow setting), off in the light theme and in ECO.
// Frameless buttons glow as a group: the navigation is one lit panel and the
// visualizer mode tabs one segmented strip.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const globalCss = read("src/styles/global.css");
const surfaces = read("src/styles/surfaces.css");
const ringGlow = String.raw`0 0 calc\(6px \* var\(--glow-strength\)\) color-mix\(in srgb, var\(--accent\) 58%, transparent\)`;
const darkOnly = String.raw`\.app-shell:not\(\.obs-mode\):not\(\.immersive-mode\):not\(\.theme-light\):not\(\.low-performance-mode\)`;
/** The declarations of the first rule whose selector matches (a regex source). */
const block = (css, selector) => css.match(new RegExp(`${selector} \\{([^}]*)\\}`))?.[1] ?? null;
const groupGlow = /box-shadow: inset 0 0 0 1px var\(--surface-glass-border\), 0 0 var\(--panel-glow-reach\) var\(--panel-glow\);/;
/** Splits a comma-separated CSS value at commas outside parentheses. */
function topLevelParts(value) {
  const parts = [];
  let depth = 0, current = "";
  for (const character of value) {
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (character === "," && depth === 0) { parts.push(current.trim()); current = ""; } else current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

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

test("frameless buttons glow as a group, not one by one", () => {
  // Only the framed tune toggles rest with a halo of their own, dimmer than the panels.
  const rest = surfaces.match(/--button-glow: color-mix\(in srgb, var\(--accent\) (\d+)%, transparent\);/);
  assert.ok(rest && Number(rest[1]) >= 25 && Number(rest[1]) < 58, "resting button glow should be visible but below the panels' 58%");
  const restRule = globalCss.match(/:where\(([^)]*)\) \{\s*box-shadow:\s*inset 0 0 calc\(\d+px \* var\(--glow-strength\)\) var\(--button-glow-inner\),\s*0 0 var\(--panel-glow-reach\) var\(--button-glow\);/);
  assert.ok(restRule, "resting glow rule missing");
  assert.equal(restRule[1].trim(), ".visual-tune-toggle", "sidebar buttons and mode tabs must not carry a halo each");

  // The navigation is one lit panel; padding and an equal negative margin keep its buttons in place.
  const nav = block(surfaces, String.raw`${darkOnly} \.sidebar nav`);
  assert.ok(nav, "navigation panel rule missing");
  assert.match(nav, groupGlow);
  assert.match(nav, /padding: var\(--group-inset\);/);
  assert.match(nav, /margin: calc\(-1 \* var\(--group-inset\)\);/);
  // The panel and its 6px glow must fit the sidebar's 12px side padding.
  const inset = nav.match(/--group-inset: (\d+)px;/);
  assert.match(globalCss, /\.sidebar \{[^}]*padding: 20px 12px 14px;/);
  assert.ok(inset && Number(inset[1]) + 6 <= 12, "the navigation panel's glow would be cut off by the sidebar");
  // The icon rail (8px side padding) and short windows (4px top padding) get a tighter panel.
  assert.match(surfaces, /@media \(max-width: 1250px\), \(max-height: 720px\) \{[^}]*\.sidebar nav \{ --group-inset: 3px; \}/);
});

test("hover blooms softly and only the active button reaches panel strength", () => {
  const hover = globalCss.match(/bloom softly on hover[\s\S]*?\.sidebar nav button:hover,[^{]*\) \{([^}]*)\}/);
  const active = globalCss.match(/the active one is lit at panel strength[\s\S]*?\.sidebar nav button\.active,[^{]*\) \{([^}]*)\}/);
  assert.ok(hover && active, "hover and active rules missing");
  assert.doesNotMatch(hover[1], /--panel-glow\b/);
  assert.match(active[1], /0 0 var\(--panel-glow-reach\) var\(--panel-glow\);/);
  // The round transport controls and the volume trigger keep a soft halo; play carries the full panel glow.
  const round = globalCss.match(/\.transport \.controls button:not\(\.play\),\s*[^{]*\.volume-popover-trigger \{([^}]*)\}/);
  assert.ok(round && /0 0 var\(--panel-glow-reach\) var\(--button-glow\);/.test(round[1]), "transport halo rule missing");
  assert.match(globalCss, /\.transport \.controls \.play \{[^}]*0 0 var\(--panel-glow-reach\) var\(--panel-glow\);/);
});

test("the mode tabs are one glowing segmented strip lit from the inside", () => {
  const strip = block(surfaces, String.raw`${darkOnly} \.mode-tabs`);
  assert.ok(strip, "mode tab strip rule missing");
  assert.match(strip, groupGlow);
  // 3px each side, taken back by the margin: under the 7px gap to the toggles beside it.
  assert.match(strip, /padding: 3px;/);
  assert.match(strip, /margin: -3px;/);
  assert.match(globalCss, /\.visual-head-actions \{[^}]*gap: 7px;/);
  // The strip scrolls, so it clips outer glows: hover and active use inset light only.
  for (const state of [":hover", String.raw`\.active`]) {
    const rule = block(surfaces, String.raw`${darkOnly} \.mode-tabs button${state}`);
    assert.ok(rule, `mode tab ${state} rule missing`);
    const shadows = topLevelParts(rule.match(/box-shadow:([^;]*);/)[1]);
    assert.ok(shadows.length > 0 && shadows.every(part => part.startsWith("inset")), `mode tab ${state} draws outside itself: ${shadows.join(" | ")}`);
  }
  assert.match(block(surfaces, String.raw`${darkOnly} \.mode-tabs button\.active`), /filter: none;/);
});

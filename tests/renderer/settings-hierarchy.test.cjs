// The appearance, system and audio device pages read as crowded when every row
// title was bold, selects were dark 40 px slabs, single-word choices were large
// cards and the device status was a box inside the panel. These tests keep the
// quieter layout: regular row titles, compact selects, title-left rows,
// segmented choices and the status beside the device form.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const modules = read("src/styles/workspace-modules.css");
const page = read("src/components/WorkspacePage.tsx");

test("row titles are regular labels in a secondary ink on every settings page", () => {
  const rule = modules.match(/\.app-shell :is\(\.settings-layout, \.device-page-grid\) \.setting-title > b \{([^}]*)\}/);
  assert.ok(rule, "shared row title rule missing");
  assert.match(rule[1], /font-weight: 400;/);
  assert.match(rule[1], /color: var\(--setting-label-ink\);/);
  // The appearance titles share the same rule, and no settings title is bold any more.
  assert.match(modules, /\.app-shell \.appearance-layout :is\(\.setting-title > b, [^{]*\),\n\.app-shell :is\(\.settings-layout, \.device-page-grid\) \.setting-title > b \{/);
  assert.doesNotMatch(modules, /\.system-setting-row b \{[^}]*font-weight: 600/);
  // Both themes define the label ink and the control colours.
  for (const block of [modules.match(/^\.app-shell \{([^}]*)\}/m)[1], modules.match(/^\.app-shell\.theme-light \{([^}]*)\}/m)[1]]) {
    for (const name of ["--setting-label-ink", "--setting-control-ink", "--setting-control-fill", "--setting-control-border", "--setting-divider"]) assert.ok(block.includes(`${name}:`), `${name} missing`);
  }
});

test("selects on the settings pages are compact with a faint fill and the UI font", () => {
  const rule = modules.match(/\.app-shell :is\(\.appearance-layout, \.settings-layout, \.device-page-grid\) select \{([^}]*)\}/);
  assert.ok(rule, "settings select rule missing");
  assert.match(rule[1], /height: 34px; min-height: 34px;/);
  assert.match(rule[1], /background-color: var\(--setting-control-fill\);/);
  assert.match(rule[1], /font-family: inherit;/);
  // The tag after a select only repeated its value.
  assert.doesNotMatch(page, /colorMode\.toUpperCase\(\)|glassMaterial\.toUpperCase\(\)/);
});

test("the background picker is a row: title, thumbnail, then the file name", () => {
  assert.match(page, /<b>\{t\("appearance\.customBackground"\)\}<\/b>\s*<span\s+className="custom-background-thumbnail"[\s\S]*?<\/span>\s*<small className=\{backgroundError \? "error" : ""\}>/);
  assert.match(modules, /\.custom-background-tile \{ height: auto; min-height: 44px; grid-template-columns: var\(--setting-title-width\) 34px/);
});

test("every system setting row puts the title left and the control right", () => {
  const system = read("src/components/SystemSettings.tsx");
  assert.doesNotMatch(system, /\bwide\b/);
  assert.match(system, /<div className="system-setting-row">/);
  assert.doesNotMatch(read("src/styles/settings.css") + modules, /system-setting-wide/);
  assert.match(modules, /\.app-shell \.system-setting-control input\[type="range"\] \{ flex: 0 0 120px; \}/);
});

test("the audio device page is one form with segmented choices and the status beside it", () => {
  // Policy and mode are rows of the form, each a group of segments.
  assert.match(page, /<div className="native-mode-options" role="group" aria-label=\{t\("device\.playbackPolicy"\)\}>/);
  assert.match(page, /<div className="native-mode-options" role="group" aria-label=\{t\("device\.outputMode"\)\}>/);
  assert.match(page, /aria-pressed=\{selectedNativeBackend === mode\.backend\}/);
  const strip = modules.match(/\.app-shell \.device-page-grid \.native-mode-options \{([^}]*)\}/);
  assert.ok(strip && /display: inline-flex;/.test(strip[1]) && /width: max-content;/.test(strip[1]), "choices should form one strip");
  assert.match(modules, /\.app-shell \.device-page-grid \.native-mode-options button \{[^}]*min-height: 30px;[^}]*border: 0;/);
  // Title column and a bounded control column instead of full-width controls.
  assert.match(modules, /--output-title: 140px; --output-gap: 20px; --output-control: 520px;/);
  assert.match(modules, /\.app-shell \.device-page-grid \.unified-output-section \{ display: grid; grid-template-columns: var\(--output-title\) minmax\(0, var\(--output-control\)\);/);
  // The apply button and the status column derive from the same widths.
  assert.match(modules, /margin-left: calc\(var\(--output-title\) \+ var\(--output-gap\)\);/);
  // The status sits beside the form on a wide panel and below it on a narrow one.
  assert.match(modules, /\.device-page-grid \.native-output-overview \{[^}]*container-type: inline-size;/);
  assert.match(modules, /@container \(min-width: 1000px\) \{\s*\.app-shell \.output-config-body \{ grid-template-columns: calc\(var\(--output-title\) \+ var\(--output-gap\) \+ var\(--output-control\)\) minmax\(0, 1fr\); \}/);
  assert.match(modules, /\.app-shell \.output-config-body > \.native-overview-status \{[^}]*background: transparent;/);
  // In the light theme only the chosen segment is filled.
  assert.match(modules, /\.workspace-page \.native-mode-options button:not\(\.active\):not\(:hover\) \{ background: transparent !important; \}/);
});

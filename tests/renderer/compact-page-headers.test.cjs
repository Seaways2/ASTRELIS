const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("the playlist puts the music/video tabs and its actions on one row", () => {
  const page = read("src/components/WorkspacePage.tsx");
  assert.match(page, /<div className="page-toolbar"><QueueTabs \/><div className="playlist-toolbar-actions">/);
  // The tabs carry the counts, so the separate track count line is gone.
  assert.doesNotMatch(page, /<span>\{state\.tracks\.length\} \{t\("common\.tracks"\)\}<\/span>/);
  assert.doesNotMatch(read("src/components/PlaylistTable.tsx"), /QueueTabs/);
  // The floating queue drawer keeps its own tabs.
  assert.match(read("src/components/QueuePanel.tsx"), /<QueueTabs \/>/);
});

test("plugin engine status moves to the page title row and scan counts join the section header", () => {
  const rack = read("src/components/VstRack.tsx");
  assert.match(rack, /\{statusSlot \? createPortal\(engineStatus, statusSlot\) : engineStatus\}/);
  assert.match(rack, /querySelector<HTMLElement>\(":scope > header > \.page-header-aside"\)/);
  assert.match(rack, /<div className="vst-scan-counts"/);
  assert.doesNotMatch(rack, /FILTERED BY POLICY|SCAN FAILED/);
  assert.match(read("src/components/WorkspacePage.tsx"), /<div className="page-header-aside" \/>/);
});

test("the native output switch is a large labelled switch beside its title", () => {
  const page = read("src/components/WorkspacePage.tsx");
  assert.match(page, /<input role="switch" disabled=\{nativeControlsBusy \|\| state\.uiSettings\.hdmiDirectEnabled\} type="checkbox"/);
  assert.match(page, /t\("device\.nativeOn"\) : t\("device\.nativeOff"\)/);
  assert.doesNotMatch(page, /"NATIVE ON" : "WEB FALLBACK"/);
  const styles = read("src/styles/global.css");
  assert.match(styles, /\.native-overview-header \{ display: flex; align-items: center; justify-content: flex-start;/);
  const modules = read("src/styles/workspace-modules.css");
  assert.match(modules, /\.native-overview-header \.native-output-switch input:checked::before \{ transform: translateX\(18px\); \}/);
  const i18n = read("src/i18n/index.ts");
  for (const key of ["device.nativeOn", "device.nativeOff", "device.nativeHdmi"]) assert.equal(i18n.split(`"${key}"`).length - 1, 3, key);
});

test("the native output switch follows the theme accent", () => {
  const modules = read("src/styles/workspace-modules.css");
  assert.match(modules, /\.native-output-switch\.active \{ color: var\(--accent\);/);
  assert.match(modules, /\.native-output-switch input:checked \{ background: var\(--accent\); \}/);
  assert.doesNotMatch(read("src/styles/global.css"), /\.native-output-switch\.active, \.loopback-status\.active/);
});

test("setting explanations sit behind an info mark instead of small text", () => {
  const hint = read("src/components/Hint.tsx");
  // Top-layer popover: never clipped by scrolling panels; shown on hover and keyboard focus.
  assert.match(hint, /setAttribute\("popover", "manual"\)/);
  assert.match(hint, /onMouseEnter=\{show\} onMouseLeave=\{hide\} onFocus=\{show\} onBlur=\{hide\}/);
  // A click on the mark inside a <label> must not toggle the control.
  assert.match(hint, /event\.preventDefault\(\); event\.stopPropagation\(\);/);
  const page = read("src/components/WorkspacePage.tsx");
  for (const key of ["appearance.colorMode", "background.auto", "appearance.glass", "appearance.opacity", "appearance.glow", "appearance.animations", "appearance.lowPerformanceMode"]) {
    assert.ok(page.includes(`<b>{t("${key}")}</b><Hint>{t("${key}Hint")}</Hint>`), key);
  }
  assert.doesNotMatch(page, /<p>\{t\("device\.hdmiHint"\)\}<\/p>|<small>\{t\("device\.hdmiFormats"\)\}<\/small>|<p>\{t\("device\.directHint"\)\}<\/p>/);
  assert.match(read("src/components/SystemSettings.tsx"), /<Hint id=\{`\$\{id\}-hint`\}>\{hint\}<\/Hint>/);
  assert.match(read("src/components/CacheSettings.tsx"), /hint=\{t\("cache\.hint"\)\}/);
  assert.match(read("src/components/AtmosphereSettings.tsx"), /<Hint>\{t\(`fx\.\$\{key\}Hint`\)\}<\/Hint>/);
});

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

test("setting explanations show when hovering the title, with no icon", () => {
  const hint = read("src/components/Hint.tsx");
  // Top-layer popover anchored to the title that contains the Hint; no icon is drawn.
  assert.match(hint, /tip\.setAttribute\("popover", "manual"\)/);
  assert.match(hint, /anchor\.addEventListener\("mouseenter", show\);\s*anchor\.addEventListener\("mouseleave", hide\);/);
  assert.match(hint, /anchor\.setAttribute\("aria-describedby"/);
  assert.doesNotMatch(hint, /lucide-react|<Info/);
  const modules = read("src/styles/workspace-modules.css");
  assert.match(modules, /\.hint \{ display: contents; \}/);
  assert.match(modules, /\.app-shell \.has-hint \{ cursor: help; \}/);
  const page = read("src/components/WorkspacePage.tsx");
  for (const key of ["appearance.colorMode", "background.auto", "appearance.glass", "appearance.opacity", "appearance.glow", "appearance.animations", "appearance.lowPerformanceMode"]) {
    assert.ok(page.includes(`<b>{t("${key}")}</b><Hint>{t("${key}Hint")}</Hint>`), key);
  }
  assert.doesNotMatch(page, /<p>\{t\("device\.hdmiHint"\)\}<\/p>|<small>\{t\("device\.hdmiFormats"\)\}<\/small>/);
  assert.match(read("src/components/SystemSettings.tsx"), /<Hint id=\{`\$\{id\}-hint`\}>\{hint\}<\/Hint>/);
  assert.match(read("src/components/CacheSettings.tsx"), /hint=\{t\("cache\.hint"\)\}/);
});

test("native-only configuration shows only while native output is on", () => {
  const page = read("src/components/WorkspacePage.tsx");
  assert.match(page, /\{nativeOutputOn && <>\s*<div className="unified-output-section native-mode-section">\s*<span className="setting-title"><b>\{t\("device\.outputMode"\)\}/);
  assert.match(page, /<\/fieldset>\s*<\/>\}/);
});

test("a refreshed cover is analysed again for smart framing", () => {
  const thumbnail = read("src/components/LibraryThumbnail.tsx");
  assert.match(thumbnail, /sources\?\.forEach\(source => \{\s*attentionBySource\.delete\(source\);/);
});

test("settings use compact, aligned rows and fill wide windows", () => {
  const modules = read("src/styles/workspace-modules.css");
  // Appearance: one title column and one title style per page.
  assert.match(modules, /--setting-title-width: 150px; --setting-control-width: 360px;/);
  assert.match(modules, /grid-template-columns: var\(--setting-title-width\) minmax\(0, var\(--setting-control-width\)\) 52px;/);
  assert.match(modules, /\.appearance-layout \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); align-items: stretch; \}/);
  // System settings: three narrow cards; the audio cache fills the two columns beside performance.
  assert.match(modules, /\.settings-layout \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); align-items: stretch; \}/);
  assert.match(modules, /\.settings-layout > \.cache-settings \{ grid-column: span 2; \}/);
  // Cache: sizes grouped, actions on the same row.
  assert.match(modules, /\.cache-settings dl \{ display: flex;/);
  assert.match(modules, /\.cache-settings > \.cache-actions \{ grid-column: 2; grid-row: 2;/);
  assert.doesNotMatch(read("src/components/AtmosphereSettings.tsx"), /atmosphere-note/);
  assert.match(read("src/components/WorkspacePage.tsx"), /hint=\{t\("fx\.motionHint"\)\}/);
});

test("cover flow hides the sort menu", () => {
  const library = read("src/components/MusicLibrary.tsx");
  assert.match(library, /\{libraryView !== "flow" && <LibraryMenu className="library-sort-controls"/);
});

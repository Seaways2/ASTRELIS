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

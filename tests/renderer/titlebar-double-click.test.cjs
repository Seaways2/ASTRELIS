// With a popover open the titlebar is no drag region (so the press that closes
// the popover reaches the page). A double-click starting there then reached
// Windows only as one caption click and did not maximize. Checked in headless
// Chrome: with the tuning panel open, a double-click on the bare titlebar
// closes it and maximizes once; a single press only closes it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.resolve(__dirname, "../../src/App.tsx"), "utf8").replace(/\r\n/g, "\n");

test("the press that closes a popover holds the titlebar for a double-click", () => {
  // The click-outside handler runs first (capture pointerdown) and starts the hold.
  assert.match(app, /if \(event\.button === 0 && target\.closest\("\.titlebar"\) && !target\.closest\(TITLEBAR_CONTROLS\)\) holdTitlebarForDoubleClick\(\);/);
  assert.match(app, /titlebarGraceTimer\.current = window\.setTimeout\(\(\) => setTitlebarGrace\(false\), 550\);/);
  // While held the titlebar stays a page element, and its double-click maximizes.
  assert.match(app, /const titlebarHoldsForDoubleClick = titlebarGrace \|\| transientPopoverOpen;/);
  assert.match(app, /\$\{titlebarHoldsForDoubleClick \? "popover-open" : ""\}/);
  assert.match(app, /onDoubleClick=\{event => \{ if \(titlebarGrace && !\(event\.target as Element\)\.closest\(TITLEBAR_CONTROLS\)\) \{ releaseTitlebar\(\); toggleMaximize\(\); \} \}\}/);
  // Buttons in the titlebar keep their own clicks.
  assert.match(app, /const TITLEBAR_CONTROLS = "button, a, input, select, \[role='button'\]";/);
});
